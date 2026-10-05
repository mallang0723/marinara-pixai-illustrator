/*
 * PixAI Illustrator Bridge — Marinara Engine full-page extension (MVP)
 *
 * This file is injected by Marinara as:  run(identity, async (marinara) => { <this file> })
 * so top-level `await` and a final `return cleanup` are valid.
 *
 * Pipeline per agent run:
 *   1. poll  GET  /api/agents/runs/:chatId/custom          (Marinara, same-origin)
 *   2. parse resultData.text  →  PIXAI_PROMPT / PIXAI_NEGATIVE / PIXAI_RATIO
 *   3. POST  https://api.pixai.art/v2/image/create          (PixAI, cross-origin)
 *   4. GET   https://api.pixai.art/v1/task/:id   (poll ≥1.5s) (PixAI, cross-origin)
 *   5. GET   outputs.mediaUrls[0]  → blob                    (PixAI/CDN, cross-origin)
 *   6. POST  /api/gallery/:chatId/upload  (multipart)        (Marinara)
 *   7. PATCH /api/chats/:chatId/messages/:messageId/extra    (Marinara)
 *
 * Every stage records {stage, ok, status, error} so a CORS failure is attributable
 * to the exact step (query GET / create POST / media download) that failed.
 */

"use strict";

const PIXAI_BASE = "https://api.pixai.art";
const POLL_RUNS_MS = 4000;          // Marinara run polling
const POLL_TASK_MS = 2000;          // PixAI task polling (docs: not faster than 1.5s)
const TASK_TIMEOUT_MS = 180000;
const MAX_REMEMBERED_RUNS = 500;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2000; // UTF-16 budget, truncated only at code-point boundaries
const ASPECT_RATIOS = ["1:1","2:3","3:2","3:4","4:3","3:5","5:3","9:16","16:9"];
// Verified in 2.4.4 shared/src and 2.4.6 shared/dist/constants/security:
// public presence marker, NOT an authentication token. Origin trust still applies.
const CSRF_HEADER = "x-marinara-csrf";
const ACTIVE_CHAT_KEY = "marinara-active-chat-id"; // chat.store.ts STORAGE_KEY
const SESSION_KEY_NAME = "pixai-bridge-session-key";

const DEFAULTS = {
  enabled: false,
  rememberKey: true,
  modelVersionId: "1983308862240288769", // Tsubaki.2 (docs/references/models)
  aspectRatio: "2:3",
  size: "1k",
  mode: "standard",
  promptHelper: "disable",
  loras: [], // user-supplied LoRA version IDs and weights; no default selected
  negativeDefault: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry",
  processedRunIds: [],
};

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
let settings = { ...DEFAULTS, ...(await marinara.storage.get()) };
settings.enabled = settings.enabled === true; // restore only an explicitly saved ON
let apiKey = settings.rememberKey !== false && typeof settings.apiKey === "string" ? settings.apiKey : "";
let busy = false;
let stopped = false;
const startedAt = Date.now();
const sessionSeen = new Set();
const requestControllers = new Set();
const pendingDelays = new Map();
let releaseLeader = null;
let isLeader = false;
let boundAgentId = null;
let armedAt = startedAt;
let saveQueue = Promise.resolve();
let stopRevision = 0;
const stageLog = [];          // ring buffer of stage results for the panel

try {
  // Remove the legacy tab-only copy; never silently migrate it to the server.
  sessionStorage.removeItem(SESSION_KEY_NAME);
} catch { /* ignore */ }

function log(level, ...args) { marinara.log[level](...args); }

function ensureRunning() {
  if (stopped) throw new DOMException("확장이 중지되었습니다.", "AbortError");
}

async function checkedFetch(url, init = {}) {
  ensureRunning();
  const controller = new AbortController();
  requestControllers.add(controller);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
  signal.addEventListener("abort", () => requestControllers.delete(controller), { once: true });
  try {
    const response = await marinara.fetch(url, { ...init, signal });
    ensureRunning();
    // Keep controller through body consumption; cleanup can abort a streaming body too.
    return response;
  } catch (err) {
    requestControllers.delete(controller);
    throw err;
  }
}

async function delay(ms) {
  ensureRunning();
  return new Promise((resolve, reject) => {
    const timer = marinara.setTimeout(() => { pendingDelays.delete(timer); resolve(); }, ms);
    pendingDelays.set(timer, reject);
  });
}

function recordStage(stage, ok, detail) {
  const entry = { t: new Date().toISOString().slice(11, 19), stage, ok, detail: String(detail ?? "") };
  stageLog.unshift(entry);
  if (stageLog.length > 40) stageLog.length = 40;
  renderLog();
  log(ok ? "info" : "error", `[${stage}] ${ok ? "OK" : "FAIL"} ${entry.detail}`);
}

async function saveSettings(patch) {
  const revision = stopRevision;
  const write = saveQueue.then(async () => {
    ensureRunning();
    const next = { ...settings, ...patch };
    if (revision !== stopRevision) next.enabled = false;
    const { processedRunIds, apiKey: savedKey, rememberKey, ...rest } = next;
    // Background saves must not resurrect credentials deleted by another tab.
    const credentials = Object.hasOwn(patch, "apiKey") ? { apiKey: savedKey, rememberKey } : {};
    await marinara.storage.patch({ ...rest, ...credentials, processedRunIds: processedRunIds.slice(-MAX_REMEMBERED_RUNS) });
    ensureRunning();
    // A stop during an in-flight write wins even if its queued persistence fails.
    if (revision !== stopRevision) next.enabled = false;
    settings = next;
  });
  saveQueue = write.catch(() => {}); // a rejected write must not poison later saves
  return write;
}

// ─────────────────────────────────────────────────────────────
// Helpers: Marinara same-origin API
// ─────────────────────────────────────────────────────────────
async function mfetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  const method = (init.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) headers.set(CSRF_HEADER, "1");
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await checkedFetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  return res;
}

function activeChatId() {
  try { return localStorage.getItem(ACTIVE_CHAT_KEY) || null; } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// Helpers: PixAI API (cross-origin, each stage attributable)
// ─────────────────────────────────────────────────────────────
function pixaiHeaders(json = false) {
  const h = { Authorization: `Bearer ${apiKey}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function describeFetchError(err) {
  // A CORS block surfaces as TypeError("Failed to fetch") with no status.
  if (err instanceof TypeError) return "네트워크/CORS 오류 가능 — Network 탭 확인";
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return "중지/시간 초과 — 과금 여부 확인 전 재시도 금지";
  return "처리 실패 — 키·프롬프트·원격 응답 본문은 로그하지 않습니다.";
}

function parseLoras(input) {
  // Accept the unreleased draft's comma string when loading old settings.
  const entries = typeof input === "string"
    ? (input.trim() ? input.split(",").map((entry) => {
      const parts = entry.trim().split(":");
      if (parts.length !== 2) throw new Error("LoRA 형식 오류");
      return { modelId: parts[0].trim(), weight: parts[1].trim() };
    }) : []) : input;
  if (!Array.isArray(entries)) throw new Error("LoRA 목록 형식 오류");
  if (entries.length > 5) throw new Error("LoRA는 최대 5개입니다.");
  const seen = new Set();
  return entries.map((entry) => {
    const modelId = entry?.modelId;
    if (typeof modelId !== "string" || !/^[1-9]\d*$/.test(modelId)) throw new Error("LoRA ID는 양의 정수 문자열이어야 합니다.");
    const raw = String(entry.weight ?? "");
    if (!/^(\d+(?:\.\d+)?|\.\d+)$/.test(raw)) throw new Error("LoRA weight는 숫자여야 합니다.");
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("LoRA weight는 0~1이어야 합니다.");
    if (seen.has(modelId)) throw new Error("LoRA ID가 중복되었습니다.");
    seen.add(modelId);
    return { modelId, weight };
  });
}

function truncatePrompt(value) {
  const text = String(value ?? "");
  let end = 0;
  for (const point of text) {
    if (end + point.length > MAX_PROMPT_CHARS) break;
    end += point.length;
  }
  return text.slice(0, end);
}

async function pixaiCreateTask(prompt, negativePrompt, aspectRatio) {
  if (typeof settings.modelVersionId !== "string" || !/^[1-9]\d*$/.test(settings.modelVersionId)) throw new Error("모델 ID는 양의 정수 문자열이어야 합니다.");
  const loras = parseLoras(settings.loras);
  const body = {
    modelVersionId: settings.modelVersionId,
    prompt: truncatePrompt(prompt),
    negativePrompt: truncatePrompt(negativePrompt || settings.negativeDefault),
    aspectRatio: ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : (ASPECT_RATIOS.includes(settings.aspectRatio) ? settings.aspectRatio : DEFAULTS.aspectRatio),
    size: settings.size,
    batchSize: 1,
    promptHelper: settings.promptHelper,
  };
  if (settings.mode) body.mode = settings.mode;
  if (loras.length) body.loras = loras;
  let res;
  try {
    res = await checkedFetch(`${PIXAI_BASE}/v2/image/create`, { method: "POST", headers: pixaiHeaders(true), body: JSON.stringify(body), credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
  } catch (err) {
    recordStage("pixai.create POST", false, describeFetchError(err));
    throw err;
  }
  const text = await res.text();
  if (!res.ok) {
    recordStage("pixai.create POST", false, `HTTP ${res.status}`);
    throw new Error(`create failed ${res.status}`);
  }
  const task = JSON.parse(text);
  recordStage("pixai.create POST", true, `task ${task.id} status=${task.status}`);
  return task;
}

async function pixaiWaitTask(taskId) {
  const started = Date.now();
  while (Date.now() - started < TASK_TIMEOUT_MS) {
    await delay(POLL_TASK_MS);
    let res;
    try {
      res = await checkedFetch(`${PIXAI_BASE}/v1/task/${encodeURIComponent(taskId)}`, { headers: pixaiHeaders(), credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    } catch (err) {
      recordStage("pixai.task GET", false, describeFetchError(err));
      throw err;
    }
    if (!res.ok) {
      recordStage("pixai.task GET", false, `HTTP ${res.status}`);
      throw new Error(`task poll failed ${res.status}`);
    }
    const task = await res.json();
    if (task.status === "completed") {
      recordStage("pixai.task GET", true, `completed, media=${(task.outputs?.mediaUrls || []).length}`);
      return task;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      recordStage("pixai.task GET", false, `status=${task.status}`);
      throw new Error(`task ${task.status}`);
    }
  }
  recordStage("pixai.task GET", false, "timeout");
  throw new Error("task timeout");
}

function safeMediaUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["d2doj8oszwtcqy.cloudfront.net", "api.pixai.art"].includes(url.hostname)) throw new Error("허용되지 않은 이미지 호스트");
  return url.href;
}

async function pixaiDownload(task) {
  const url = task.outputs?.mediaUrls?.[0];
  const mediaId = task.outputs?.mediaIds?.[0];
  // Try the direct media URL first, then the authenticated /v1/media/{id}/image redirect.
  const attempts = [];
  if (url) {
    try { attempts.push({ label: "mediaUrl", url: safeMediaUrl(url), headers: {} }); }
    catch { recordStage("pixai.download", false, "허용되지 않은 이미지 URL"); }
  }
  if (mediaId) attempts.push({ label: "media/:id/image", url: `${PIXAI_BASE}/v1/media/${encodeURIComponent(mediaId)}/image`, headers: pixaiHeaders() });
  let lastErr = null;
  for (const a of attempts) {
    try {
      const res = await checkedFetch(a.url, { headers: a.headers, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
      if (!res.ok) { recordStage(`pixai.download (${a.label})`, false, `HTTP ${res.status}`); lastErr = new Error(`HTTP ${res.status}`); continue; }
      const mime = (res.headers.get("content-type") || "").split(";")[0].toLowerCase();
      if (!["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(mime)) throw new Error("이미지 MIME 오류");
      if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("이미지 크기 초과");
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          ensureRunning();
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_IMAGE_BYTES) throw new Error("이미지 크기 초과");
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const blob = new Blob(chunks, { type: mime });
      if (!blob.size) throw new Error("empty image");
      recordStage(`pixai.download (${a.label})`, true, `${blob.size} bytes ${blob.type}`);
      return blob;
    } catch (err) {
      recordStage(`pixai.download (${a.label})`, false, describeFetchError(err));
      lastErr = err;
    }
  }
  throw lastErr || new Error("no media to download");
}

// ─────────────────────────────────────────────────────────────
// Helpers: Marinara gallery + message attachment
// ─────────────────────────────────────────────────────────────
function extFromBlob(blob) {
  const t = (blob.type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("gif")) return "gif";
  if (t.includes("avif")) return "avif";
  return "png";
}

async function uploadToGallery(chatId, blob, prompt) {
  const ext = extFromBlob(blob);
  const fd = new FormData();
  fd.append("file", blob, `pixai-${Date.now()}.${ext}`);
  fd.append("prompt", prompt);
  fd.append("provider", "pixai");
  fd.append("model", settings.modelVersionId);
  const res = await mfetch(`/gallery/${encodeURIComponent(chatId)}/upload`, { method: "POST", body: fd });
  const text = await res.text();
  if (!res.ok) { recordStage("gallery.upload", false, `HTTP ${res.status}`); throw new Error("upload failed"); }
  const image = JSON.parse(text);
  const expected = `/api/gallery/file/${encodeURIComponent(chatId)}/`;
  if (typeof image.url !== "string" || !image.url.startsWith(expected) || image.url.includes("..")) throw new Error("gallery URL 오류");
  recordStage("gallery.upload", true, "uploaded");
  return image; // { id, url, ... }
}

async function attachToMessage(chatId, messageId, image, prompt, blob) {
  // Read current extra so we merge instead of overwriting attachments.
  const listRes = await mfetch(`/chats/${encodeURIComponent(chatId)}/messages`);
  if (!listRes.ok) throw new Error("메시지 조회 실패 — 기존 첨부 보존을 위해 중단");
  let existing = [];
  if (listRes.ok) {
    const msgs = await listRes.json();
    const m = Array.isArray(msgs) ? msgs.find((x) => x.id === messageId) : null;
    if (!m) throw new Error("대상 메시지 없음");
    const extra = typeof m.extra === "string" ? JSON.parse(m.extra) : (m.extra ?? {});
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("메시지 extra 형식 오류");
    if (extra.attachments !== undefined && !Array.isArray(extra.attachments)) throw new Error("첨부 형식 오류");
    if (Array.isArray(extra?.attachments)) existing = extra.attachments;
  }
  const attachment = { type: "image", url: image.url, prompt, galleryId: image.id, filename: `pixai.${extFromBlob(blob)}` };
  const res = await mfetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/extra`, {
    method: "PATCH",
    body: JSON.stringify({ attachments: [...existing, attachment] }),
  });
  if (!res.ok) { recordStage("message.attach", false, `HTTP ${res.status}`); throw new Error("attach failed"); }
  recordStage("message.attach", true, `message ${messageId}`);
  // Immediate preview: React Query won't refetch on its own; inject a preview until the next reload.
  const el = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (el && !el.querySelector(".pixai-bridge-preview")) {
    const img = document.createElement("img");
    img.className = "pixai-bridge-preview";
    img.src = image.url;
    img.alt = "PixAI";
    el.appendChild(img);
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

// ─────────────────────────────────────────────────────────────
// Agent result parsing
// Agent (Post-Processing / Context Injection) returns plain text:
//   PIXAI_PROMPT: 1girl, ...
//   PIXAI_NEGATIVE: ...        (optional)
//   PIXAI_RATIO: 2:3           (optional)
// or a single line  SKIP
// ─────────────────────────────────────────────────────────────
function parseAgentText(text) {
  if (typeof text !== "string" || !text || /^\s*SKIP\s*$/i.test(text)) return null;
  const get = (k) => { const m = text.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, "im")); return m ? m[1].trim() : ""; };
  const prompt = get("PIXAI_PROMPT");
  if (!prompt) return null;
  const ratio = get("PIXAI_RATIO");
  const fallback = ASPECT_RATIOS.includes(settings.aspectRatio) ? settings.aspectRatio : DEFAULTS.aspectRatio;
  return { prompt: truncatePrompt(prompt), negative: truncatePrompt(get("PIXAI_NEGATIVE")), ratio: ASPECT_RATIOS.includes(ratio) ? ratio : fallback };
}

// ─────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────
async function processRun(run) {
  const parsed = parseAgentText(run.resultData?.text);
  if (!parsed) { recordStage("agent.parse", true, `run ${run.id}: SKIP / no PIXAI_PROMPT`); return; }
  if (!apiKey) { recordStage("agent.parse", false, "no API key set — open panel"); return; }
  recordStage("agent.parse", true, `run ${run.id}`);
  const task = await pixaiCreateTask(parsed.prompt, parsed.negative, parsed.ratio);
  const done = await pixaiWaitTask(task.id);
  const blob = await pixaiDownload(done);
  const image = await uploadToGallery(run.chatId, blob, parsed.prompt);
  await attachToMessage(run.chatId, run.messageId, image, parsed.prompt, blob);
}

async function pollOnce() {
  if (stopped || !isLeader || !settings.enabled || busy || !apiKey || !boundAgentId) return;
  const chatId = activeChatId();
  if (!chatId) return;
  busy = true;
  try {
    const res = await mfetch(`/agents/runs/${encodeURIComponent(chatId)}/custom?limit=5`);
    if (!res.ok) { recordStage("agent.runs GET", false, `HTTP ${res.status}`); return; }
    const runs = await res.json();
    if (!Array.isArray(runs) || runs.length === 0) return;
    const seen = new Set([...settings.processedRunIds, ...sessionSeen]);
    // Oldest first among the unseen ones; only runs that carry our marker.
    const candidates = runs.filter((r) => r.agentConfigId === boundAgentId && r.chatId === chatId && Date.parse(r.createdAt) > armedAt && !seen.has(r.id) && r.resultType === "context_injection" && typeof r.resultData?.text === "string" && /PIXAI_PROMPT|^\s*SKIP\s*$/im.test(r.resultData.text)).reverse();
    for (const run of candidates) {
      if (stopped || !settings.enabled) break;
      // Mark BEFORE calling PixAI so a crash/reload never double-bills the same run.
      await saveSettings({ processedRunIds: [...settings.processedRunIds, run.id] });
      sessionSeen.add(run.id);
      if (stopped || !settings.enabled) break;
      try { await processRun(run); } catch (err) { recordStage("run", false, describeFetchError(err)); }
    }
  } catch (err) {
    recordStage("agent.runs GET", false, describeFetchError(err));
  } finally {
    busy = false;
  }
}


// ─────────────────────────────────────────────────────────────
// Diagnostics (staged CORS check)
// ─────────────────────────────────────────────────────────────
async function runDiagnostics(includeCreate) {
  if (stopped || busy) return;
  if (includeCreate && !isLeader) { recordStage("diag", false, "같은 브라우저의 다른 탭이 실행 중이거나 Web Locks 미지원입니다. localhost에서 한 탭만 사용하세요."); return; }
  if (!apiKey) { recordStage("diag", false, "set API key first"); return; }
  if (includeCreate && !confirm("이미지 1장 생성으로 PixAI 크레딧을 소모합니다. 계속할까요?")) return;
  busy = true;
  try {
  // Stage 1: query GET
  try {
    const r = await checkedFetch(`${PIXAI_BASE}/v1/task/diagnostic-nonexistent`, { headers: pixaiHeaders(), credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    recordStage("diag.task GET", true, `HTTP ${r.status} (any status = CORS passed)`);
    if (!r.ok && r.status !== 404) return;
  } catch (err) { recordStage("diag.task GET", false, describeFetchError(err)); return; }
  if (!includeCreate) return;
  // Stage 2+3: real create (costs credits) → poll → download
  try {
    const task = await pixaiCreateTask("1girl, solo, simple background, upper body, smile", "", "1:1");
    const done = await pixaiWaitTask(task.id);
    await pixaiDownload(done);
    recordStage("diag", true, "all PixAI stages passed — direct browser calls work");
  } catch (err) { recordStage("diag", false, "stopped at first failing stage above"); }
  } finally { busy = false; }
}

// ─────────────────────────────────────────────────────────────
// Panel UI (DOM injected — full-page runtime has no marinara.ui)
// ─────────────────────────────────────────────────────────────
const root = document.createElement("div");
root.className = "pixai-bridge-root";
root.innerHTML = `
  <button class="pixai-bridge-toggle" title="PixAI Bridge">🎨</button>
  <div class="pixai-bridge-panel" hidden>
    <div class="pixai-bridge-row"><strong>PixAI Illustrator Bridge</strong><span class="pixai-bridge-status"></span></div>
    <label>API key <input type="password" class="pb-key" placeholder="pixai api key" autocomplete="off"></label>
    <label class="pixai-bridge-inline"><input type="checkbox" class="pb-remember"> API 키 기억 (기본값, 저장 버튼으로 적용)</label>
    <button class="pb-delete-key" type="button">저장된 키 삭제</button>
    <p>확장 저장소에 평문 저장됩니다. 데이터 폴더 접근 가능자는 키를 볼 수 있습니다. Marinara 서버에 접속할 수 있는 사람·프로그램은 확장 저장소 API(GET /api/personal-extensions/:id/storage)로 키를 읽을 수 있습니다. 네이티브 PixAI 연결(업스트림 PR 예정)은 암호화 저장하며 이 확장과 다릅니다.</p>
    <label>모델 <select class="pb-model-preset">
      <option value="1983308862240288769">Tsubaki.2</option>
      <option value="1861558740588989558">Haruka v2</option>
      <option value="1954632828118619567">Hoshino v2</option>
      <option value="custom">직접 입력 (modelVersionId)</option>
    </select></label>
    <label>modelVersionId <input class="pb-model" inputmode="numeric"></label>
    <div>LoRA (최대 5개, 버전 ID / 가중치 0~1)</div>
    <div class="pb-loras"></div><button class="pb-lora-add" type="button">LoRA 행 추가</button>
    <div class="pixai-bridge-grid">
      <label>ratio <select class="pb-ratio">${ASPECT_RATIOS.map(r=>`<option>${r}</option>`).join("")}</select></label>
      <label>size <select class="pb-size"><option>1k</option><option>1.5k</option></select></label>
      <label>mode <select class="pb-mode"><option value="">(none)</option><option>lite</option><option>standard</option><option>pro</option><option>ultra</option></select></label>
      <label>promptHelper <select class="pb-helper"><option>disable</option><option>enable</option></select></label>
    </div>
    <label>negative default <textarea class="pb-neg" rows="2"></textarea></label>
    <label class="pixai-bridge-inline"><input type="checkbox" class="pb-enabled"> 자동 처리 켜기 (활성 채팅의 새 에이전트 실행 감시)</label>
    <div class="pixai-bridge-row">
      <button class="pb-save">저장</button>
      <button class="pb-diag1">진단 1: GET만</button>
      <button class="pb-diag2">진단 2: 생성+다운로드 (크레딧 소모)</button>
      <button class="pb-clear">자동 처리 중지·기준 재설정</button>
    </div>
    <pre class="pixai-bridge-log"></pre>
  </div>`;
document.body.appendChild(root);

const q = (sel) => root.querySelector(sel);
const panel = q(".pixai-bridge-panel");
q(".pixai-bridge-toggle").addEventListener("click", () => { panel.hidden = !panel.hidden; });

q(".pb-key").value = apiKey;
q(".pb-remember").checked = settings.rememberKey !== false;
q(".pb-model").value = settings.modelVersionId;
const preset = q(".pb-model-preset");
preset.value = [...preset.options].some((option) => option.value === settings.modelVersionId) ? settings.modelVersionId : "custom";
q(".pb-model").disabled = preset.value !== "custom";
preset.addEventListener("change", () => {
  q(".pb-model").disabled = preset.value !== "custom";
  if (preset.value !== "custom") q(".pb-model").value = preset.value;
});
function addLoraRow(modelId = "", weight = 1) {
  if (q(".pb-loras").children.length >= 5) return;
  const row = document.createElement("div");
  row.className = "pb-lora-row";
  const idInput = document.createElement("input");
  idInput.className = "pb-lora-id";
  idInput.inputMode = "numeric";
  idInput.placeholder = "LoRA 버전 ID";
  idInput.setAttribute("aria-label", "LoRA 버전 ID");
  idInput.value = modelId;
  const weightInput = document.createElement("input");
  weightInput.className = "pb-lora-weight";
  weightInput.type = "number";
  weightInput.min = "0"; weightInput.max = "1"; weightInput.step = "0.01";
  weightInput.setAttribute("aria-label", "LoRA 가중치");
  weightInput.value = String(weight);
  const remove = document.createElement("button");
  remove.className = "pb-lora-remove";
  remove.type = "button";
  remove.textContent = "삭제";
  remove.addEventListener("click", () => row.remove());
  row.append(idInput, weightInput, remove);
  q(".pb-loras").appendChild(row);
}
try { parseLoras(settings.loras).forEach((item) => addLoraRow(item.modelId, item.weight)); }
catch (err) { recordStage("settings.LoRA", false, err.message); }
q(".pb-lora-add").addEventListener("click", () => addLoraRow());
q(".pb-ratio").value = settings.aspectRatio;
q(".pb-size").value = settings.size;
q(".pb-mode").value = settings.mode;
q(".pb-helper").value = settings.promptHelper;
q(".pb-neg").value = settings.negativeDefault;
q(".pb-enabled").checked = settings.enabled;

q(".pb-save").addEventListener("click", async () => {
  if (stopped || busy) { recordStage("settings", false, "작업 완료 후 설정을 저장하세요."); return; }
  busy = true;
  try {
  let loras;
  try {
    if (!/^[1-9]\d*$/.test(q(".pb-model").value.trim())) throw new Error("모델 ID는 양의 정수 문자열이어야 합니다.");
    loras = parseLoras([...q(".pb-loras").children].map((row) => ({
      modelId: row.querySelector(".pb-lora-id").value.trim(), weight: row.querySelector(".pb-lora-weight").value,
    })));
  } catch (err) { recordStage("settings", false, err.message); return; }
  if (q(".pb-enabled").checked) {
    if (!isLeader) { recordStage("settings", false, "Web Locks 지원 localhost 브라우저 한 탭에서만 자동 처리할 수 있습니다."); return; }
    if (!q(".pb-key").value.trim()) { recordStage("settings", false, "키 입력 필요"); return; }
    try {
      const res = await mfetch("/agents");
      if (!res.ok) throw new Error();
      const agents = await res.json();
      const matches = Array.isArray(agents) ? agents.filter((agent) => agent.name === "PixAI Director" && typeof agent.type === "string" && agent.type.startsWith("custom-")) : [];
      if (matches.length !== 1) throw new Error();
      if (!settings.enabled || !boundAgentId || !apiKey) armedAt = Date.now();
      boundAgentId = matches[0].id;
    } catch { recordStage("settings", false, "가져온 PixAI Director가 정확히 한 개 필요합니다."); return; }
  }
  const nextKey = q(".pb-key").value.trim();
  const rememberKey = q(".pb-remember").checked;
  try { await saveSettings({
    rememberKey,
    apiKey: rememberKey ? nextKey : "",
    modelVersionId: q(".pb-model").value.trim(),
    loras,
    aspectRatio: q(".pb-ratio").value,
    size: q(".pb-size").value,
    mode: q(".pb-mode").value,
    promptHelper: q(".pb-helper").value,
    negativeDefault: truncatePrompt(q(".pb-neg").value),
    enabled: q(".pb-enabled").checked,
  }); } catch { recordStage("settings", false, "설정 저장 실패 — 자동 처리는 이전 상태 유지"); return; }
  apiKey = nextKey;
  recordStage("settings", true, `saved (key ${apiKey ? "set" : "EMPTY"}; auto=${settings.enabled})`);
  renderStatus();
  } finally { busy = false; }
});
q(".pb-delete-key").addEventListener("click", async () => {
  if (stopped || busy) { recordStage("settings", false, "작업 완료 후 키를 삭제하세요."); return; }
  busy = true;
  stopRevision++;
  settings.enabled = false;
  q(".pb-enabled").checked = false;
  try {
    await saveSettings({ apiKey: "", rememberKey: false, enabled: false });
    apiKey = "";
    q(".pb-key").value = "";
    q(".pb-remember").checked = false;
    recordStage("settings", true, "저장된 키 삭제 완료; 자동 처리 OFF");
  } catch { recordStage("settings", false, "키 삭제 실패 — 저장소 연결을 확인하고 다시 삭제하세요. 자동 처리 OFF"); }
  finally { busy = false; renderStatus(); }
});
q(".pb-diag1").addEventListener("click", () => { apiKey = q(".pb-key").value.trim() || apiKey; runDiagnostics(false); });
q(".pb-diag2").addEventListener("click", () => { apiKey = q(".pb-key").value.trim() || apiKey; runDiagnostics(true); });
q(".pb-clear").addEventListener("click", async () => {
  if (stopped) return;
  stopRevision++;
  settings.enabled = false;
  q(".pb-enabled").checked = false;
  armedAt = Date.now();
  renderStatus();
  try { await saveSettings({ enabled: false }); }
  catch { recordStage("settings", false, "중지는 적용됐지만 설정 저장 실패 — 새로고침 뒤 확인하세요."); return; }
  finally { renderStatus(); }
  recordStage("settings", true, "자동 처리 중지; 과거 run은 재생성하지 않습니다. 진행 중 1건은 비활성화/새로고침으로 중지하세요.");
  renderStatus();
});

function renderStatus() {
  const reason = stopped ? "확장 중지" : !settings.enabled ? "자동 처리 설정 꺼짐" : !apiKey ? "API 키 입력·저장 필요"
    : !isLeader ? "다른 탭 실행 중 또는 Web Locks 대기·미지원" : !boundAgentId ? "PixAI Director 확인 필요 — 한 개 가져온 뒤 저장"
    : !activeChatId() ? "활성 채팅 없음" : "";
  q(".pixai-bridge-status").textContent = `${reason ? `OFF · ${reason}` : "ON"} · key ${apiKey ? "✓" : "✗"} · chat ${activeChatId() ? "✓" : "✗"}`;
}
function renderLog() {
  const pre = q(".pixai-bridge-log");
  if (pre) pre.textContent = stageLog.map((e) => `${e.t} ${e.ok ? "✅" : "❌"} ${e.stage}: ${e.detail}`).join("\n");
}

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
// Same-origin, same-browser single leader. Cross-device use is unsupported.
async function restoreAutomaticProcessing() {
  if (busy) return;
  if (!settings.enabled || !apiKey || stopped) return;
  const revision = stopRevision;
  busy = true;
  try {
    const res = await mfetch("/agents");
    if (!res.ok) throw new Error();
    const agents = await res.json();
    const matches = Array.isArray(agents) ? agents.filter((agent) => agent.name === "PixAI Director" && typeof agent.type === "string" && agent.type.startsWith("custom-")) : [];
    if (matches.length !== 1) throw new Error();
    if (!stopped && settings.enabled && revision === stopRevision) boundAgentId = matches[0].id;
    // armedAt remains the load boundary: never replay pre-load runs.
  } catch { recordStage("settings", false, "자동 처리 복원 보류 — PixAI Director 한 개와 연결 상태를 확인하고 저장하세요."); }
  finally { busy = false; renderStatus(); }
}
if (navigator.locks?.request) {
  void navigator.locks.request("pixai-illustrator-single-runner", { ifAvailable: true }, async (lock) => {
    if (!lock || stopped) return;
    isLeader = true;
    await restoreAutomaticProcessing();
    if (stopped) { isLeader = false; return; }
    await new Promise((resolve) => { releaseLeader = resolve; });
    isLeader = false;
  }).catch(() => { isLeader = false; });
}
renderStatus();
const timer = marinara.setInterval(() => { renderStatus(); void pollOnce(); }, POLL_RUNS_MS);
log("info", "PixAI Illustrator Bridge loaded");

return () => {
  stopped = true;
  settings.enabled = false;
  for (const controller of requestControllers) controller.abort();
  requestControllers.clear();
  for (const [timer, reject] of pendingDelays) {
    marinara.clearTimeout(timer);
    reject(new DOMException("중지", "AbortError"));
  }
  pendingDelays.clear();
  releaseLeader?.();
  apiKey = "";
  settings.apiKey = ""; // clear this instance, not the remembered server value
  try { sessionStorage.removeItem(SESSION_KEY_NAME); } catch { /* ignore */ }
  marinara.clearInterval(timer);
  root.remove();
  document.querySelectorAll(".pixai-bridge-preview").forEach((n) => n.remove());
};

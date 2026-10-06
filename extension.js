/*
 * PixAI Illustrator Bridge — Marinara Engine full-page extension (MVP)
 *
 * This file is injected by Marinara as:  run(identity, async (marinara) => { <this file> })
 * so top-level `await` and a final `return cleanup` are valid.
 *
 * Pipeline per agent run:
 *   1. poll  GET  /api/agents/runs/:chatId/custom          (Marinara, same-origin)
 *   2. parse resultData.text  →  PIXAI_PROMPT / PIXAI_NEGATIVE / PIXAI_RATIO
 *   3. probe GET /v2/task/0, then POST /v2/image/create     (PixAI, cross-origin)
 *   4. GET   /v2/task/:id (404 only → v1, poll ≥1.5s)       (PixAI, cross-origin)
 *   5. GET   outputs.mediaUrls[0]  → blob                    (PixAI/CDN, cross-origin)
 *   6. POST  /api/gallery/:chatId/upload  (multipart)        (Marinara)
 *   7. PATCH /api/chats/:chatId/messages/:messageId/extra    (Marinara)
 *
 * Every stage records {stage, ok, status, error} so a CORS failure is attributable
 * to the exact step (query GET / create POST / media download) that failed.
 */

"use strict";

if (window[Symbol.for("pixai-illustrator-fetch-v2")]?.active) return () => {};

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

const STYLE_PRESETS = ["anime-watercolor-impasto", "art-crayon", "bold-line-soft-color", "chibi", "classic-japanese", "clean-flat-illustration", "colored-pencil-grain", "cool-warm-oil-contrast", "desaturated-cool", "flat-anime-pastel", "glossy-glass-anime", "grey-blocks-lineless", "hard-line-monochrome-accent", "high-contrast-retro-vivid", "holographic", "korean-style", "lineart-watercolor-airy", "low-saturation-expressive-eyes", "lucid-dreamy", "luminous-retro-impasto", "minimal-flat-color", "modern-oil-glamour", "moe-pastel", "oil-watercolor-blend", "painterly-doodle", "paper-watercolor", "pencil-sketch", "poster-graffiti", "retro-comic-fusion", "retro-oil-glamour", "retro-tv-anime", "semi-realistic", "stable-vaporwave", "tinted-sketch", "vintage-collage"];
const STYLE_MODELS = ["1983308862240288769"];
const V2_DEFAULTS = {
  schemaVersion: 2, characterProfiles: {}, personaProfiles: {}, personaAppearanceEnabled: false,
  styleTags: "", styleTagsPosition: "prefix", pixaiStyle: null,
  selfieInterceptEnabled: false, characterSelfieRecoveryEnabled: false, selfieUseRecentContext: false,
  operationLedger: [], stopEpoch: 0,
};

async function storageLock(fn) {
  if (!navigator.locks?.request) throw new Error("저장 잠금 미지원 — localhost/HTTPS에서 사용하세요.");
  return navigator.locks.request("pixai-illustrator-storage", {}, fn);
}

function validateStorage(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored) || (stored.schemaVersion !== undefined && stored.schemaVersion !== 2)) throw new Error("저장소 버전/형식 오류");
  for (const key of ["enabled","rememberKey","selfieInterceptEnabled","personaAppearanceEnabled","characterSelfieRecoveryEnabled","selfieUseRecentContext"]) if (stored[key] !== undefined && typeof stored[key] !== "boolean") throw new Error("옵션 형식 오류");
  if (stored.styleTags !== undefined && typeof stored.styleTags !== "string") throw new Error("화풍 형식 오류");
  if (stored.styleTagsPosition !== undefined && !["prefix","suffix"].includes(stored.styleTagsPosition)) throw new Error("화풍 위치 오류");
  if (stored.stopEpoch !== undefined && (!Number.isSafeInteger(stored.stopEpoch) || stored.stopEpoch < 0)) throw new Error("중지 버전 오류");
  for (const key of ["characterProfiles","personaProfiles"]) if (stored[key] !== undefined) {
    if (!stored[key] || typeof stored[key] !== "object" || Array.isArray(stored[key])) throw new Error("프로필 형식 오류");
    for (const [id,row] of Object.entries(stored[key])) {
      if (["__proto__","constructor","prototype"].includes(id) || !row || typeof row !== "object" || Array.isArray(row) || typeof row.fixedTags !== "string") throw new Error("프로필 행 형식 오류");
      if (row.aliases !== undefined && (!Array.isArray(row.aliases) || row.aliases.some(v=>typeof v !== "string"))) throw new Error("별칭 형식 오류");
      if (row.loras !== undefined) parseLoras(row.loras);
    }
  }
  if (stored.operationLedger !== undefined) {
    const fail = () => { throw new Error("작업 기록 형식 오류"); };
    const object = value => value && typeof value === "object" && !Array.isArray(value);
    const id = value => typeof value === "string" && value.length > 0 && value.trim() === value;
    const anchorId = value => id(value) && /^[A-Za-z0-9_-]{1,128}$/.test(value);
    if (!Array.isArray(stored.operationLedger)) fail();
    const seen = new Set();
    for (const row of stored.operationLedger) {
      if (!object(row) || !id(row.operationId) || seen.has(row.operationId) ||
          !["selfie","illustration","diagnostic"].includes(row.source) || !object(row.anchor) ||
          !["claimed","creating","taskKnown","downloaded","uploaded","attached","failedBeforeCreate","ambiguous","attachmentFailed","complete"].includes(row.state)) fail();
      seen.add(row.operationId);
      const anchor = row.anchor;
      if (row.source === "diagnostic") {
        if (Object.keys(anchor).length) fail();
      } else {
        if (!anchorId(anchor.chatId)) fail();
        if (row.source === "selfie" && !anchorId(anchor.characterId)) fail();
        if (row.source === "illustration" && (!anchorId(anchor.messageId) || !Number.isSafeInteger(anchor.swipeIndex) || anchor.swipeIndex < 0)) fail();
      }
      for (const key of ["taskId","galleryId"]) if (row[key] !== undefined && !id(row[key])) fail();
      for (const key of ["createdAt","updatedAt"]) if (typeof row[key] !== "string" || !Number.isFinite(Date.parse(row[key]))) fail();
      if (["taskKnown","downloaded","uploaded","attached","attachmentFailed","complete"].includes(row.state) && !id(row.taskId)) fail();
      if ((["uploaded","attached","attachmentFailed"].includes(row.state) || (row.state === "complete" && row.source !== "diagnostic")) && !id(row.galleryId)) fail();
      if (["attached","attachmentFailed"].includes(row.state) && row.source !== "illustration") fail();
      if (row.state === "uploaded" && row.source === "diagnostic") fail();
    }
  }
}

async function migrateSettings() {
  return storageLock(async () => {
    const stored = await marinara.storage.get();
    validateStorage(stored);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error("저장소 형식 오류");
    if (stored.schemaVersion !== undefined && stored.schemaVersion !== 2) throw new Error("지원하지 않는 저장소 버전");
    for (const key of ["characterProfiles", "personaProfiles"]) {
      if (stored[key] !== undefined && (!stored[key] || typeof stored[key] !== "object" || Array.isArray(stored[key]))) throw new Error("프로필 형식 오류");
    }
    if (stored.operationLedger !== undefined && !Array.isArray(stored.operationLedger)) throw new Error("작업 기록 형식 오류");
    if (stored.schemaVersion === 2) return stored;
    const patch = {};
    for (const [key, value] of Object.entries(V2_DEFAULTS)) if (!Object.hasOwn(stored, key)) patch[key] = structuredClone(value);
    await marinara.storage.patch(patch);
    return { ...stored, ...patch };
  });
}

const DEFAULTS = {
  ...V2_DEFAULTS,
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
let storageError = "";
let loadedSettings;
try { loadedSettings = await migrateSettings(); }
catch { loadedSettings = {}; storageError = "저장소 이행/버전 오류 또는 Web Locks 미지원 — 유료 실행 차단"; }
let settings = { ...DEFAULTS, ...loadedSettings };
settings.enabled = settings.enabled === true; // restore only an explicitly saved ON
let apiKey = settings.rememberKey !== false && typeof settings.apiKey === "string" ? settings.apiKey : "";
let busy = false;
let taskAccessCheck = null; // Promise cached for this extension session, never persisted.
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
let operationQueue = Promise.resolve();
const inflight = new Map();
const operationChats = new Map();
const selfiePreviews = new Map();
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

function savePosition(value) {
  const write = saveQueue.then(async () => {
    ensureRunning();
    // Engine PATCH reads/merges/writes the whole document, even for disjoint keys.
    await storageLock(async () => {
      ensureRunning();
      await marinara.storage.patch({ uiPosition: value });
    });
    ensureRunning();
    settings.uiPosition = value;
  });
  saveQueue = write.catch(() => {});
  return write;
}

async function saveSettings(patch, { emergency = false } = {}) {
  const revision = stopRevision;
  const epoch = settings.stopEpoch || 0;
  const write = saveQueue.then(async () => {
    ensureRunning();
    const allowed = new Set(["apiKey", "rememberKey", "enabled", "selfieInterceptEnabled", "characterSelfieRecoveryEnabled", "personaAppearanceEnabled", "selfieUseRecentContext", "modelVersionId", "loras", "aspectRatio", "size", "mode", "promptHelper", "negativeDefault", "styleTags", "styleTagsPosition", "pixaiStyle", "processedRunIds"]);
    if (Object.keys(patch).some(k => !allowed.has(k))) throw new Error("설정 소유 키 오류");
    if (!Object.keys(patch).length) return;
    const offOnly = Object.entries(patch).every(([k,v]) => ["enabled", "selfieInterceptEnabled", "characterSelfieRecoveryEnabled", "personaAppearanceEnabled", "selfieUseRecentContext", "rememberKey"].includes(k) ? v === false : k === "apiKey" && v === "");
    if (!isLeader && !offOnly) throw new Error("설정은 실행 탭에서 저장하세요. OFF·긴급 중지·키 삭제는 모든 탭에서 가능합니다.");
    await storageLock(async () => {
      const fresh = await marinara.storage.get();
      const owned = { ...patch };
      if (revision !== stopRevision || (fresh.stopEpoch || 0) !== epoch) {
        if (fresh.apiKey === "" && fresh.rememberKey === false) {apiKey="";taskAccessCheck=null;}
        if ((fresh.stopEpoch || 0) !== epoch) stopRevision++;
        for (const k of ["enabled", "selfieInterceptEnabled", "characterSelfieRecoveryEnabled"]) if (owned[k] === true) owned[k] = false;
        if (owned.apiKey) { delete owned.apiKey; delete owned.rememberKey; }
      }
      if (emergency) owned.stopEpoch = (fresh.stopEpoch || 0) + 1;
      if (owned.processedRunIds) owned.processedRunIds = owned.processedRunIds.slice(-MAX_REMEMBERED_RUNS);
      await marinara.storage.patch(owned);
      Object.assign(settings, owned);
      settings.stopEpoch = owned.stopEpoch ?? fresh.stopEpoch ?? 0;
      if (revision !== stopRevision) { settings.enabled = false; settings.selfieInterceptEnabled = false; }
    });
  });
  saveQueue = write.catch(() => {});
  return write;
}

async function saveProfile(map, id, row) {
  if (!isLeader || !["characterProfiles", "personaProfiles"].includes(map) || !id || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("프로필 저장 대상 오류");
  const write = saveQueue.then(() => storageLock(async () => {
    ensureRunning();
    const fresh = await marinara.storage.get();
    const merged = { ...fresh[map], [id]: structuredClone(row) };
    await marinara.storage.patch({ [map]: merged });
    settings[map] = merged;
  }));
  saveQueue = write.catch(() => {});
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

async function ensureTaskAccess() {
  if (!taskAccessCheck) {
    taskAccessCheck = (async () => {
      try {
        // Authorization triggers the same preflight as polling. No task is created.
        // A missing task (404) or unauthorized key (401) still proves CORS access.
        const res = await checkedFetch(`${PIXAI_BASE}/v2/task/0`, { headers: pixaiHeaders(), credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
        return { status: res.status };
      } catch (err) {
        return { error: err };
      }
    })();
  }
  const result = await taskAccessCheck;
  if (result.error) {
    const detail = result.error instanceof TypeError
      ? "PixAI 결과 조회 연결을 확인하지 못했습니다 (네트워크/CORS 오류 가능). 연결을 확인하고 새로고침 후 다시 시도하세요. 생성 요청은 보내지 않았습니다."
      : `결과 조회 사전 확인 실패 — 생성 요청은 보내지 않았습니다. ${describeFetchError(result.error)}`;
    recordStage("pixai.preflight GET", false, detail);
    throw result.error;
  }
  if (!((result.status >= 200 && result.status < 300) || result.status === 404)) throw new Error(`조회 사전 확인 HTTP ${result.status} — 생성하지 않았습니다.`);
  return result.status;
}

async function pixaiCreateTask(prompt, negativePrompt, aspectRatio, options = settings, composed = null, beforePost = null) {
  if (typeof options.modelVersionId !== "string" || !/^[1-9]\d*$/.test(options.modelVersionId)) throw new Error("모델 ID는 양의 정수 문자열이어야 합니다.");
  const loras = parseLoras(composed?.loras || options.loras);
  const body = {
    modelVersionId: options.modelVersionId,
    prompt: truncatePrompt(prompt),
    negativePrompt: truncatePrompt(negativePrompt || options.negativeDefault),
    aspectRatio: ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : (ASPECT_RATIOS.includes(options.aspectRatio) ? options.aspectRatio : DEFAULTS.aspectRatio),
    size: options.size,
    batchSize: 1,
    promptHelper: options.promptHelper,
  };
  if (composed?.style) body.style = composed.style;
  if (options.mode) body.mode = options.mode;
  if (loras.length) body.loras = loras;
  await ensureTaskAccess();
  const guard = beforePost ? await beforePost() : null;
  let res;
  try {
    // No await between this local stop/key/leadership/abort check and dispatch.
    if (guard) guard();
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
      res = await checkedFetch(`${PIXAI_BASE}/v2/task/${encodeURIComponent(taskId)}`, { headers: pixaiHeaders(), credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
      // Undocumented v2 route: only a real HTTP 404 permits legacy fallback.
      if (res.status === 404) {
        recordStage("pixai.task GET", true, "v2 HTTP 404 → v1 폴백");
        res = await checkedFetch(`${PIXAI_BASE}/v1/task/${encodeURIComponent(taskId)}`, { headers: pixaiHeaders(), credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
      }
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
    const legacyHint = a.label === "media/:id/image"
      ? " — v1 media 폴백은 도메인 Origin에서 CORS/CSRF 정책으로 차단될 수 있습니다. mediaUrls CDN 경로 또는 IP 접속을 확인하세요."
      : "";
    try {
      const res = await checkedFetch(a.url, { headers: a.headers, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
      if (!res.ok) { recordStage(`pixai.download (${a.label})`, false, `HTTP ${res.status}${legacyHint}`); lastErr = new Error(`HTTP ${res.status}`); continue; }
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
      recordStage(`pixai.download (${a.label})`, false, describeFetchError(err) + legacyHint);
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

function validateChatImage(image, chatId) {
  const strings = ["id","chatId","filePath","prompt","provider","model","createdAt","url"];
  const expected = `/api/gallery/file/${encodeURIComponent(chatId)}/`;
  if (!image || strings.some(k => typeof image[k] !== "string") || !image.id || !image.filePath || !Number.isFinite(Date.parse(image.createdAt)) || image.chatId !== chatId || !image.url.startsWith(expected) || /(?:\.\.|%2e|%2f|%5c|[?#\\])/i.test(image.url) || ["width","height"].some(k=>image[k] !== null && !(Number.isFinite(image[k]) && image[k] > 0))) throw Object.assign(new Error("갤러리 응답 계약 불일치"),{contract:true});
  return image;
}

async function uploadToGallery(chatId, blob, prompt, options = settings) {
  const ext = extFromBlob(blob);
  const fd = new FormData();
  fd.append("file", blob, `pixai-${Date.now()}.${ext}`);
  fd.append("prompt", prompt);
  fd.append("provider", "pixai");
  fd.append("model", options.modelVersionId);
  const res = await mfetch(`/gallery/${encodeURIComponent(chatId)}/upload`, { method: "POST", body: fd });
  const text = await res.text();
  if (!res.ok) { recordStage("gallery.upload", false, `HTTP ${res.status}`); throw new Error("upload failed"); }
  const image = JSON.parse(text);
  const expected = `/api/gallery/file/${encodeURIComponent(chatId)}/`;
  if (typeof image.url !== "string" || !image.url.startsWith(expected) || image.url.includes("..")) throw new Error("gallery URL 오류");
  validateChatImage(image,chatId);
  recordStage("gallery.upload", true, "uploaded");
  return image; // { id, url, ... }
}

async function attachToMessage(chatId, messageId, image, prompt, blob, swipeIndex) {
  // Read current extra so we merge instead of overwriting attachments.
  const listRes = await mfetch(`/chats/${encodeURIComponent(chatId)}/messages`);
  if (!listRes.ok) throw new Error("메시지 조회 실패 — 기존 첨부 보존을 위해 중단");
  let existing = [];
  if (listRes.ok) {
    const msgs = await listRes.json();
    const m = Array.isArray(msgs) ? msgs.find((x) => x.id === messageId) : null;
    if (!m) throw new Error("대상 메시지 없음");
    if (Number.isInteger(swipeIndex) && m.activeSwipeIndex !== swipeIndex) throw new Error("대상 swipe 변경 — 갤러리만 보존합니다.");
    const extra = typeof m.extra === "string" ? JSON.parse(m.extra) : (m.extra ?? {});
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("메시지 extra 형식 오류");
    if (extra.attachments !== undefined && !Array.isArray(extra.attachments)) throw new Error("첨부 형식 오류");
    if (Array.isArray(extra?.attachments)) existing = extra.attachments;
  }
  const attachment = { type: "image", url: image.url, prompt, galleryId: image.id, filename: `pixai.${extFromBlob(blob)}` };
  const res = await mfetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/extra${Number.isInteger(swipeIndex) ? `?swipeIndex=${swipeIndex}` : ""}`, {
    method: "PATCH",
    body: JSON.stringify({ attachments: [...existing.filter(a=>a.galleryId !== image.id), attachment] }),
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
  const get = (k) => { const m = text.match(new RegExp(`^[ \t]*${k}[ \t]*:[ \t]*([^\r\n]*)$`, "im")); return m ? m[1].trim() : ""; };
  const prompt = get("PIXAI_PROMPT");
  if (!prompt) return null;
  const ratio = get("PIXAI_RATIO");
  const fallback = ASPECT_RATIOS.includes(settings.aspectRatio) ? settings.aspectRatio : DEFAULTS.aspectRatio;
  let characters = null;
  let selectorWarning = false;
  const raw = get("PIXAI_CHARACTERS");
  if (raw) {
    try {
      const values = JSON.parse(raw);
      if (raw.length > 4096 || !Array.isArray(values) || values.length > 64 || values.some(v => typeof v !== "string" || !v.trim() || v.length > 200 || /[\x00-\x1f\x7f]/.test(v))) throw new Error();
      characters = [...new Set(values.map(v => v.normalize("NFC").trim()))];
    } catch { selectorWarning = true; }
  }
  return { prompt: truncatePrompt(prompt), negative: truncatePrompt(get("PIXAI_NEGATIVE")), ratio: ASPECT_RATIOS.includes(ratio) ? ratio : fallback, characters, persona: get("PIXAI_PERSONA") === "true", selectorWarning };
}

function appearanceOf(card) {
  const data = typeof card.data === "string" ? JSON.parse(card.data) : card.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("카드 data 계약 불일치");
  for (const value of [data.extensions?.appearance, data.appearance]) if (typeof value === "string" && value.trim()) return { text:value.trim(), source:"appearance", warning:"" };
  if (typeof data.description === "string" && data.description.trim()) return { text:data.description.trim(), source:"description", warning:"외모 전용 정보 없음 — Description에 외모가 있는지 확인하세요." };
  return { text:"", source:"none", warning:"외모 정보 없음 → 카드 Appearance 칸이나 고정 태그를 채우세요." };
}

async function personaAppearance(options, chat, present) {
  if (!options.personaAppearanceEnabled || !present) return "";
  const id = chat.personaCharacterId ? `character:${chat.personaCharacterId}` : chat.personaId;
  if (!id) return "";
  const fixed = options.personaProfiles?.[id]?.fixedTags;
  if (fixed) return fixed;
  const path = chat.personaCharacterId ? `/characters/${encodeURIComponent(chat.personaCharacterId)}` : `/characters/personas/${encodeURIComponent(id)}`;
  const res = await mfetch(path);
  if (!res.ok) throw new Error("페르소나 조회 실패");
  const value = await res.json();
  if (chat.personaCharacterId) return appearanceOf(value).text;
  if (typeof value.appearance !== "string") throw new Error("페르소나 appearance 계약 불일치");
  return value.appearance.trim();
}

async function readChatCards(chatId) {
  const res = await mfetch(`/chats/${encodeURIComponent(chatId)}`);
  if (!res.ok) throw new Error("채팅 조회 실패");
  const chat = await res.json();
  const ids = typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : chat.characterIds;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new Error("채팅 참가자 계약 불일치");
  const cards = [];
  for (const id of [...new Set(ids)]) {
    const response = await mfetch(`/characters/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error("캐릭터 조회 실패");
    const card = await response.json();
    if (card.id !== id) throw new Error("캐릭터 ID 불일치");
    const data = typeof card.data === "string" ? JSON.parse(card.data) : card.data;
    cards.push({ ...card, name: data?.name || card.name || id });
  }
  return { chat, cards };
}

async function preparePrompt(chatId, parsed, options, characterId, request = {}) {
  const { chat, cards } = await readChatCards(chatId);
  if (characterId && (chat.mode !== "conversation" || !cards.some(c => c.id === characterId))) throw new Error("Conversation 참가 캐릭터를 선택하세요.");
  const ids = characterId ? [characterId] : resolveCharacters(parsed,cards,options.characterProfiles || {});
  const profiles = ids.map(id => options.characterProfiles?.[id] || {});
  const appearances = ids.map(id => appearanceOf(cards.find(c=>c.id===id)));
  const warnings = appearances.map((a,i) => profiles[i].fixedTags ? "" : a.warning).filter(Boolean);
  if (!ids.length || parsed.selectorWarning) warnings.push("캐릭터 이름 미해결 — 단일 참가자 fallback 외에는 프로필을 적용하지 않습니다.");
  let persona = "";
  try { persona = await personaAppearance(options,chat,!characterId && parsed.persona); }
  catch { warnings.push("페르소나 자료 미지원/조회 실패 — 생략했습니다."); }
  const context = [];
  if (request.context) context.push(request.context);
  if (characterId && options.selfieUseRecentContext) {
    const r = await mfetch(`/chats/${encodeURIComponent(chatId)}/messages`);
    if (!r.ok) throw new Error("최근 대화 조회 실패");
    const messages = await r.json();
    if (!Array.isArray(messages)) throw new Error("최근 대화 계약 불일치");
    context.unshift(...messages.filter(m=>["user","assistant"].includes(m.role) && !m.hidden && !m.isHidden && Date.parse(m.createdAt) <= (request.startedAt || Date.now())).slice(-4).map(m=>cutText(m.content,200)));
  }
  const result = composePrompt(options,{ scene:parsed.prompt,negative:parsed.negative,profiles,appearances,persona,selfie:!!characterId,context });
  result.warnings.push(...warnings);
  return result;
}

function cutText(value, limit) {
  let out = "";
  for (const point of String(value || "")) { if (out.length + point.length > limit) break; out += point; }
  return out;
}

function validateStyle(style) {
  if (style == null) return undefined;
  if (style.type === "preset" && Object.keys(style).sort().join() === "key,type" && STYLE_PRESETS.includes(style.key)) return { type: "preset", key: style.key };
  if (style.type === "custom" && Object.keys(style).sort().join() === "custom,type" && typeof style.custom === "string" && style.custom.trim() && style.custom.length <= 500) return { type: "custom", custom: style.custom.trim() };
  throw new Error("PixAI style 형식/프리셋 오류 (custom 1–500자)");
}

function composePrompt(options, input) {
  const selected = validateStyle(options.pixaiStyle);
  const style = STYLE_MODELS.includes(options.modelVersionId) ? selected : undefined;
  const budget = 2000 - (style?.type === "custom" ? style.custom.length + 2 : 0);
  const seen = new Set(), truncated = [], warnings = [];
  const tags = value => String(value || "").split(",").map(v => v.trim()).filter(v => {
    if (!v) return false;
    const key = v.normalize("NFC").toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const profiles = input.profiles || [];
  const styleTags = tags(options.styleTags);
  const fixed = tags(profiles.map(p => p.fixedTags || "").concat(input.persona || "").join(", "));
  const minimum = tags(input.selfie ? "solo, selfie, upper body, looking at viewer" : "");
  // Dedupe follows semantic priority; budgets prefer scene over supplemental prose.
  const supplements = (input.appearances || []).map(a => ({ ...a, text: String(a.text || "").trim() })).filter(a => a.text);
  let sceneValue = String(input.scene || "");
  for (const a of supplements) sceneValue = sceneValue.split(`[${a.source === "description" ? "Description" : "Appearance"}: ${a.text}]`).join("");
  for (const value of input.context || []) sceneValue = sceneValue.split(`[최근 대화 원문 발췌: ${cutText(value,200)}]`).join("");
  const scene = tags(sceneValue);
  const required = [...styleTags, ...fixed, ...minimum];
  if (required.join(", ").length > budget) throw new Error("화풍·고정 외모·최소 구도가 2,000자 예산을 초과합니다.");
  let used = required.join(", ").length;
  const take = (value, label) => {
    const room = budget - used - (used ? 2 : 0);
    const part = cutText(value, Math.max(0, room));
    if (part !== value) truncated.push(label);
    if (part) used += part.length + (used ? 2 : 0);
    return part;
  };
  const sceneText = take(scene.join(", "), "장면 뒤쪽");
  const supplementText = [];
  for (const a of supplements.sort((a,b) => (a.source === "description") - (b.source === "description"))) {
    const value = `[${a.source === "description" ? "Description" : "Appearance"}: ${a.text}]`;
    if (used + value.length + (used ? 2 : 0) <= budget) { supplementText.push(take(value,a.source)); }
    else truncated.push(a.source);
  }
  const contextText = [];
  for (const text of [...(input.context || [])].reverse()) {
    const value = `[최근 대화 원문 발췌: ${cutText(text,200)}]`;
    if (used + value.length + 2 <= budget) contextText.unshift(take(value,"최근 대화")); else truncated.push("최근 대화");
  }
  const core = [...fixed, ...supplementText, ...minimum, sceneText, ...contextText].filter(Boolean);
  const prompt = (options.styleTagsPosition === "suffix" ? [...core, ...styleTags] : [...styleTags, ...core]).join(", ");
  const merged = mergeLoras(profiles, options.loras);
  warnings.push(...merged.warnings);
  if (selected && !style) warnings.push("확인된 Tsubaki 모델이 아니므로 style은 전송하지 않습니다. 화풍 태그는 유지됩니다.");
  return { prompt, negative: cutText(input.negative || options.negativeDefault,2000), loras: merged.loras, style, truncated, warnings,
    portions: { style: styleTags.join(", ").length, fixed: fixed.join(", ").length, scene: sceneText.length, supplement: supplementText.join(", ").length, context: contextText.join(", ").length } };
}

function mergeLoras(profiles, global) {
  const merged = new Map(), warnings = [];
  for (const p of profiles) for (const item of parseLoras(p.loras || [])) {
    if (merged.has(item.modelId) && merged.get(item.modelId).weight !== item.weight) throw new Error("캐릭터 LoRA 가중치 충돌");
    merged.set(item.modelId, item);
  }
  for (const item of parseLoras(global || [])) {
    if (merged.has(item.modelId)) {
      if (merged.get(item.modelId).weight !== item.weight) warnings.push("캐릭터 LoRA 가중치가 전역 설정보다 우선합니다.");
    } else merged.set(item.modelId, item);
  }
  if (merged.size > 5) throw new Error("병합 LoRA 5개 초과 — 프로필/전역 행을 수정하세요.");
  return { loras: [...merged.values()], warnings };
}

function resolveCharacters(parsed, cards, profiles) {
  if (!parsed.characters) return cards.length === 1 ? [cards[0].id] : [];
  if (parsed.characters.length > cards.length) return [];
  const ids = [];
  const norm = v => String(v || "").normalize("NFC").trim();
  for (const name of parsed.characters) {
    const matches = cards.filter(c => [c.name, ...(profiles[c.id]?.aliases || [])].some(v => norm(v) === norm(name)));
    if (matches.length !== 1) return [];
    if (!ids.includes(matches[0].id)) ids.push(matches[0].id);
  }
  return ids;
}

async function matchSelfie(input, init = {}) {
  try {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input),location.href);
    const method = String(init.method ?? request?.method ?? "GET").toUpperCase();
    if (url.origin !== location.origin || url.search || url.hash || method !== "POST") return null;
    const match = url.pathname.match(/^\/api\/gallery\/([A-Za-z0-9_-]{1,128})\/selfie$/);
    if (!match) return null;
    const raw = init.body !== undefined ? init.body : request ? await request.clone().text() : null;
    if (typeof raw !== "string" || raw.length > 600000) return null;
    const body = JSON.parse(raw);
    if (!body || Array.isArray(body) || typeof body !== "object" || typeof body.characterId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.characterId)) return null;
    const strings = ["context","promptOverride","negativePromptOverride"], booleans = ["previewOnly","queueImageGenerationRequests","debugMode"];
    if (Object.keys(body).some(k=>!["characterId",...strings,...booleans].includes(k))) return null;
    if (strings.some(k=>body[k] !== undefined && (typeof body[k] !== "string" || body[k].length > 200000)) || booleans.some(k=>body[k] !== undefined && typeof body[k] !== "boolean")) return null;
    return {chatId:match[1],body,signal:init.signal ?? request?.signal,startedAt:Date.now()};
  } catch { return null; }
}

function abortCaller(work, signal) {
  if (!signal) return work;
  return new Promise((resolve,reject) => {
    const abort = () => reject(new DOMException("호출 취소 — 이미 접수된 작업은 갤러리까지 계속됩니다.","AbortError"));
    if (signal.aborted) abort(); else signal.addEventListener("abort",abort,{once:true});
    work.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
  });
}

function installSelfieAdapter() {
  const symbol = Symbol.for("pixai-illustrator-fetch-v2");
  if (window[symbol]?.active) return () => {};
  const previous = window.fetch;
  const owner = {active:true};
  window[symbol] = owner;
  const wrapper = async function(...args) {
    if (!owner.active || stopped || !settings.selfieInterceptEnabled) return previous.apply(this,args);
    const revision = stopRevision;
    const matched = await matchSelfie(...args);
    if (!matched) return previous.apply(this,args);
    // A supported request interrupted while parsing belongs to this adapter:
    // forwarding it could charge the native provider after an emergency stop.
    if (revision !== stopRevision || !owner.active || stopped || !settings.selfieInterceptEnabled) throw new DOMException("셀피 요청 중지", "AbortError");
    matched.revision = revision;
    try { return await abortCaller(handleSelfie(matched),matched.signal); }
    catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error.contract) { owner.active = false; recordStage("selfie",false,"응답 계약 불일치 — 이 세션의 셀피 대체를 껐습니다. 다음 요청은 원본 이미지 연결을 사용하며 비용이 발생할 수 있습니다."); }
      return new Response(JSON.stringify({error:error.status === 409 ? "같은 채팅 작업 중 또는 검토 설정 변경 — 완료/재검토 후 요청하세요." : "Bridge 요청 실패 — 원본 재전송 없음. 작업 기록에서 미접수/접수 불명을 확인하세요."}),{status:error.status || 502,headers:{"Content-Type":"application/json"}});
    }
  };
  window.fetch = wrapper;
  return () => {
    owner.active = false;
    if (window.fetch === wrapper) window.fetch = previous;
    if (window[symbol] === owner) delete window[symbol];
  };
}

function promptSignature(options) {
  const keys = ["modelVersionId","aspectRatio","size","mode","promptHelper","loras","negativeDefault","styleTags","styleTagsPosition","pixaiStyle","characterProfiles","personaProfiles","personaAppearanceEnabled","selfieUseRecentContext"];
  return JSON.stringify(keys.map(k=>options[k]));
}

async function handleSelfie(request) {
  if (storageError || stopped) throw new Error("저장소/실행 상태 오류");
  if (request.signal?.aborted) throw new DOMException("호출 취소","AbortError");
  const {chatId,body} = request;
  const target = `${chatId}:${body.characterId}`;
  if (!body.previewOnly && inflight.has(`selfie:${target}`)) return new Response(JSON.stringify(await inflight.get(`selfie:${target}`)),{headers:{"Content-Type":"application/json"}});
  const signature = promptSignature(settings);
  const previous = selfiePreviews.get(target);
  if (!body.previewOnly && body.promptOverride && previous && previous.signature !== signature) throw Object.assign(new Error("설정 변경 — 무료 미리보기를 다시 여세요."),{status:409});
  const prepare = async options => {
    // Re-read membership even for a reviewed override; do not trust a stale card target.
    const result = await preparePrompt(chatId,{prompt:body.promptOverride || "solo, selfie, upper body, looking at viewer",negative:body.negativePromptOverride || "",persona:false},options,body.characterId,{...request,context:body.context});
    if (previous && body.promptOverride === previous.result.prompt && previous.signature === promptSignature(options)) {
      return {...structuredClone(previous.result),negative:body.negativePromptOverride === undefined ? previous.result.negative : result.negative};
    }
    return result;
  };
  if (body.previewOnly) {
    const result = await prepare(structuredClone(settings));
    selfiePreviews.set(target,{signature,result});
    if (selfiePreviews.size > 30) selfiePreviews.delete(selfiePreviews.keys().next().value);
    showPreview(result);
    return new Response(JSON.stringify({items:[{id:"conversation-selfie",kind:"selfie",title:"PixAI 셀피",prompt:result.prompt,negativePrompt:result.negative}]}),{headers:{"Content-Type":"application/json"}});
  }
  // Shared target is resolved in the coordinator before its 409 check.
  const image = await coordinate({operationId:`selfie:${crypto.randomUUID()}`,source:"selfie",anchor:{chatId,characterId:body.characterId},signal:request.signal,revision:request.revision,prepare,
    confirm:() => confirm("셀피 이미지 1장을 생성하며 PixAI 크레딧을 소모합니다. 완료 후 재요청도 추가 비용입니다. 계속할까요?")});
  return new Response(JSON.stringify(image),{headers:{"Content-Type":"application/json"}});
}

function showPreview(result) {
  const element = q(".pb-preview");
  if (element) element.textContent = JSON.stringify(result,null,2);
}

function isUnresolved(row) {
  return !["complete", "attached", "failedBeforeCreate"].includes(row.state);
}

async function writeReceipt(operation, state, fields = {}) {
  // Receipts must remain writable after cleanup/stop; no prompts, keys or headers.
  await storageLock(async () => {
    const fresh = await marinara.storage.get();
    validateStorage(fresh);
    if (fresh.schemaVersion !== 2 || !Array.isArray(fresh.operationLedger)) throw new Error("작업 저장소 계약 오류");
    let rows = fresh.operationLedger;
    const previous = rows.find(r => r.operationId === operation.operationId);
    if (!previous) {
      if (rows.some(r => r.operationId === operation.operationId || (isUnresolved(r) &&
        (operation.source === "diagnostic" ? r.source === "diagnostic" : r.anchor?.chatId === operation.anchor.chatId)))) throw new Error("미해결 작업 확인 후 명시적으로 해제하세요.");
      if (rows.filter(isUnresolved).length >= 500) throw new Error("미해결 작업 기록 한도 초과");
    }
    const now = new Date().toISOString();
    const row = { operationId:operation.operationId, source:operation.source, anchor:operation.anchor,
      state, createdAt:previous?.createdAt || now, updatedAt:now };
    for (const key of ["taskId", "galleryId"]) if (fields[key] || previous?.[key]) row[key] = fields[key] || previous[key];
    rows = rows.filter(r => r.operationId !== row.operationId).concat(row);
    const unresolved = rows.filter(isUnresolved);
    const completed = rows.filter(r => !isUnresolved(r)).slice(-Math.max(0,500-unresolved.length));
    rows = unresolved.concat(unresolved.length >= 500 ? [] : completed);
    validateStorage({ operationLedger:rows });
    await marinara.storage.patch({ operationLedger:rows });
    settings.operationLedger = rows;
    renderLedger();
  });
}

async function assertOperation(operation, refreshPrivacy = false) {
  const feature = operation.source === "selfie" ? "selfieInterceptEnabled" : operation.source === "illustration" ? "enabled" : null;
  const checkLocal = () => {
    if (stopped || operation.revision !== stopRevision) throw new DOMException("작업 중지", "AbortError");
    if (storageError || !isLeader || !apiKey) throw Object.assign(new Error("저장소·실행 탭·키 확인 필요"),{status:409});
    if (!operation.creating && operation.signal?.aborted) throw new DOMException("호출 취소", "AbortError");
    if (!operation.creating && feature && settings[feature] === false) throw new DOMException("기능 OFF — 새 생성 중지", "AbortError");
  };
  checkLocal();
  const fresh = await marinara.storage.get();
  checkLocal();
  validateStorage(fresh);
  if (!operation.creating && feature && fresh[feature] === false) throw new DOMException("기능 OFF — 새 생성 중지", "AbortError");
  if (fresh.schemaVersion !== 2) throw new Error("저장소 버전 충돌 — 구버전 탭을 닫으세요.");
  if (!operation.receipted && fresh.operationLedger?.some(r=>r.operationId === operation.operationId)) throw new Error("이미 기록된 작업 — 재생성하지 않습니다.");
  if ((fresh.stopEpoch || 0) !== operation.epoch) throw new DOMException("다른 탭에서 중지했습니다.", "AbortError");
  if (refreshPrivacy) {
    // Another tab may have opted out. Freeze privacy choices before preparing this job only.
    for (const key of ["selfieUseRecentContext", "personaAppearanceEnabled"]) {
      if (typeof fresh[key] === "boolean") operation.options[key] = fresh[key];
    }
  }
  return checkLocal;
}

function coordinate(spec) {
  const target = spec.source === "selfie" ? `selfie:${spec.anchor.chatId}:${spec.anchor.characterId}` : spec.operationId;
  // R2: same-target sharing must be checked before same-chat rejection.
  if (inflight.has(target)) return inflight.get(target);
  if (spec.source === "selfie" && operationChats.has(spec.anchor.chatId)) return Promise.reject(Object.assign(new Error("같은 채팅 이미지 작업 완료 후 요청하세요."), {status:409}));
  const operation = { ...spec, options:structuredClone(settings), revision:spec.revision ?? stopRevision, epoch:settings.stopEpoch || 0, creating:false };
  operationChats.set(spec.anchor.chatId, (operationChats.get(spec.anchor.chatId) || 0) + 1);
  const promise = operationQueue.then(() => executeOperation(operation));
  const tracked = promise.finally(() => {
    inflight.delete(target);
    const count = operationChats.get(spec.anchor.chatId) - 1;
    if (count) operationChats.set(spec.anchor.chatId,count); else operationChats.delete(spec.anchor.chatId);
  });
  inflight.set(target,tracked);
  operationQueue = tracked.catch(() => {});
  return tracked;
}

async function executeOperation(operation) {
  let state = "", taskId, galleryId;
  const receipt = async (next, fields) => { await writeReceipt(operation,next,fields); state = next; operation.receipted = true; };
  try {
    await saveQueue;
    await assertOperation(operation, true);
    const composed = await operation.prepare(operation.options);
    await assertOperation(operation);
    if (operation.confirm && !operation.confirm()) throw new DOMException("비용 확인 취소","AbortError");
    await ensureTaskAccess();
    await receipt("claimed");
    await assertOperation(operation);
    await receipt("creating");
    await assertOperation(operation);
    const task = await pixaiCreateTask(composed.prompt,composed.negative,operation.ratio,operation.options,composed,async()=>{
      try {
        const checkLocal = await assertOperation(operation);
        return () => {
          try {
            checkLocal();
            if (operation.signal?.aborted) throw new DOMException("호출 취소","AbortError");
            // Validation and all async guards finished; the next statement dispatches POST.
            operation.creating = true;
          } catch(error) { operation.creating=false; throw error; }
        };
      }
      catch(error){operation.creating=false;throw error;}
    });
    if (typeof task.id !== "string" || !task.id) throw new Error("접수 응답 ID 불명");
    taskId = task.id;
    await receipt("taskKnown",{taskId});
    await assertOperation(operation);
    const done = await pixaiWaitTask(taskId);
    await assertOperation(operation);
    const blob = await pixaiDownload(done);
    await receipt("downloaded");
    await assertOperation(operation);
    if (operation.source === "diagnostic") { await receipt("complete"); return null; }
    const image = await uploadToGallery(operation.anchor.chatId,blob,composed.prompt,operation.options);
    galleryId = image.id;
    await receipt("uploaded",{galleryId});
    await assertOperation(operation);
    if (operation.source === "illustration") {
      await attachToMessage(operation.anchor.chatId,operation.anchor.messageId,image,composed.prompt,blob,operation.anchor.swipeIndex);
      await receipt("attached");
    } else await receipt("complete");
    recordStage("operation",true,"갤러리 저장 완료 — 호출 취소 후에도 작업 기록에서 확인할 수 있습니다.");
    return image;
  } catch (error) {
    if (state) {
      const failure = galleryId ? (operation.source === "illustration" ? "attachmentFailed" : "uploaded") : taskId ? state : operation.creating ? "ambiguous" : "failedBeforeCreate";
      try { await receipt(failure,{taskId,galleryId}); } catch { recordStage("ledger",false,"영수증 갱신 실패 — 새 생성 전에 계정과 갤러리를 확인하세요."); }
    }
    recordStage("operation",false,operation.creating ? "접수 여부/완료 불명 — 자동 재생성 없음. 작업 영수증과 계정을 확인하세요." : "이번 요청 생성 안 함 — 설정·잠금·저장소·조회 확인 실패 또는 취소");
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────
async function prepareIllustration(anchor, parsed, options) {
  if (!anchor.messageId) throw new Error("삽화 대상 메시지 없음");
  const response = await mfetch(`/chats/${encodeURIComponent(anchor.chatId)}/messages`);
  if (!response.ok) throw new Error("삽화 대상 조회 실패");
  const messages = await response.json();
  const message = Array.isArray(messages) ? messages.find(m=>m.id === anchor.messageId) : null;
  if (!message || message.role !== "assistant" || !Number.isInteger(message.activeSwipeIndex) || message.activeSwipeIndex < 0) throw new Error("삽화 메시지/swipe 계약 불일치");
  if (Number.isInteger(anchor.swipeIndex) && anchor.swipeIndex !== message.activeSwipeIndex) throw new Error("삽화 대상 swipe 변경");
  anchor.swipeIndex = message.activeSwipeIndex;
  return preparePrompt(anchor.chatId,parsed,options);
}

async function processRun(run) {
  const parsed = parseAgentText(run.resultData?.text);
  if (!parsed) { recordStage("agent.parse", true, "SKIP / no PIXAI_PROMPT"); return; }
  const anchor = {chatId:run.chatId,messageId:run.messageId,...(Number.isInteger(run.swipeIndex) ? {swipeIndex:run.swipeIndex} : {})};
  return coordinate({ operationId:`run:${run.id}`, source:"illustration",anchor,ratio:parsed.ratio,
    prepare:options => prepareIllustration(anchor,parsed,options) });
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
  if (includeCreate && !isLeader) { recordStage("diag", false, "실행 탭·Web Locks가 필요합니다."); return; }
  if (!apiKey) { recordStage("diag", false, "키 입력 필요"); return; }
  if (includeCreate && !confirm("이미지 1장 생성으로 PixAI 크레딧을 소모합니다. 계속할까요?")) return;
  busy = true;
  try {
    if (!includeCreate) {
      const status = await ensureTaskAccess();
      recordStage("diag.task GET",true,`v2 HTTP ${status} — 실제 생성 성공 보장 아님`);
    } else await coordinate({operationId:`diagnostic:${crypto.randomUUID()}`,source:"diagnostic",anchor:{},ratio:"1:1",
      prepare:async options => composePrompt(options,{scene:"solo, simple background, upper body",negative:""})});
  } catch (err) { recordStage("diag",false,describeFetchError(err)); }
  finally { busy = false; }
}

// ─────────────────────────────────────────────────────────────
// Panel UI (DOM injected — full-page runtime has no marinara.ui)
// ─────────────────────────────────────────────────────────────
function clampPosition(point, size, viewport) {
  const axis = (value, origin, extent, length) => Math.min(
    Math.max(origin + 8, origin + extent - length - 8),
    Math.max(origin + 8, Number.isFinite(value) ? value : origin + 8),
  );
  return { x: axis(point?.x, viewport.x, viewport.width, size.width), y: axis(point?.y, viewport.y, viewport.height, size.height) };
}

const root = document.createElement("div");
root.className = "pixai-bridge-root";
root.innerHTML = `
  <button class="pixai-bridge-toggle" type="button" title="PixAI Bridge — 드래그로 이동" aria-label="PixAI 패널 열기/닫기" aria-expanded="false">🎨</button>
  <div class="pixai-bridge-panel" hidden>
    <div class="pixai-bridge-row pb-drag-handle" title="드래그로 패널 이동"><strong>PixAI Illustrator Bridge</strong><span class="pixai-bridge-status"></span></div>
    <button class="pb-position-reset" type="button">위치 초기화</button>
    <label>API key <input type="password" class="pb-key" placeholder="pixai api key" autocomplete="off"></label>
    <label class="pixai-bridge-inline"><input type="checkbox" class="pb-remember"> API 키 기억 (기본값, 저장 버튼으로 적용)</label>
    <button class="pb-delete-key" type="button">저장된 키 삭제</button>
    <p>확장 저장소에 평문 저장됩니다. 외모 태그·페르소나 설정·작업 영수증도 평문입니다. 데이터 폴더 접근 가능자는 키를 볼 수 있습니다. Marinara 서버에 접속할 수 있는 사람·프로그램은 확장 저장소 API(GET /api/personal-extensions/:id/storage)로 키를 읽을 수 있습니다. 네이티브 PixAI 연결(업스트림 PR 예정)은 암호화 저장하며 이 확장과 다릅니다.</p>
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
    <details><summary>화풍·PixAI style</summary>
      <label>PixAI style (Tsubaki 전용)<select class="pb-style-type"><option value="none">없음</option><option value="preset">프리셋</option><option value="custom">custom</option></select></label>
      <label>프리셋<select class="pb-style-preset">${STYLE_PRESETS.map(v=>`<option>${v}</option>`).join("")}</select></label>
      <label>custom (1–500자)<textarea class="pb-style-custom"></textarea></label>
      <p>Tsubaki 모델에서만 적용됩니다. 확인된 ID 외에는 style을 보내지 않습니다.</p>
      <label>화풍 태그 (모든 모델)<textarea class="pb-style-tags"></textarea></label>
      <label>태그 위치<select class="pb-style-position"><option value="prefix">앞</option><option value="suffix">뒤</option></select></label>
      <button class="pb-style-save" type="button">화풍 설정 저장</button>
    </details>
    <details><summary>캐릭터·페르소나 프로필</summary>
      <button class="pb-profiles-load" type="button">현재 채팅 프로필 읽기</button><div class="pb-profiles"></div>
      <label class="pixai-bridge-inline"><input type="checkbox" class="pb-persona"> 등장하는 페르소나 외모 추가</label>
      <p class="pb-persona-id"></p><label>페르소나 고정 태그<textarea class="pb-persona-tags"></textarea></label><button class="pb-persona-save" type="button">페르소나 저장</button>
      <p class="pb-persona-context">Director persona context: 프로필 읽기 후 확인</p>
      <p>확장 옵션과 Agents의 persona context는 별개입니다. Director ON은 전체 자료를 LLM에 보낼 수 있으며, 확장 OFF로 이미 포함된 묘사를 제거하지 않습니다. 셀피는 solo입니다.</p>
    </details>
    <label class="pixai-bridge-inline"><input type="checkbox" class="pb-selfie"> 셀피 대체 (Director 불필요, 기본 OFF)</label>
    <label class="pixai-bridge-inline"><input type="checkbox" class="pb-recent"> 셀피에 최근 대화 원문 포함 (기본 OFF)</label>
    <p>최근 user/assistant 4개, 각 최대 200자 원문을 PixAI에 보냅니다. 번역·장면 추론은 하지 않습니다. queue 요청은 단일 큐로 대체하며 debug 원문은 기록하지 않습니다. 캐릭터 명령 복구는 제공하지 않습니다.</p>
    <label>무료 셀피 미리보기 대상<select class="pb-preview-character"></select></label>
    <button class="pb-preview-free" type="button">무료 미리보기 (프로필 읽기 후)</button><pre class="pb-preview"></pre>
    <details><summary>작업 영수증 (과금 취소 아님)</summary><pre class="pb-ledger"></pre>
      <label>계정·갤러리 확인한 operation ID<input class="pb-release-id"></label><button class="pb-release" type="button">미해결 차단 명시 해제</button>
    </details>
    <button class="pb-stop" type="button">전체 긴급 중지</button>
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
function setupMovablePanel() {
  const button = q(".pixai-bridge-toggle");
  const header = q(".pb-drag-handle");
  const events = new AbortController();
  const options = { signal: events.signal };
  let position = settings.uiPosition || {};
  let drag = null;
  let suppressClick = false;
  const viewport = () => {
    const v = window.visualViewport;
    return { x: v?.offsetLeft || 0, y: v?.offsetTop || 0, width: v?.width || window.innerWidth, height: v?.height || window.innerHeight };
  };
  const place = (element, point) => {
    const p = clampPosition(point, element.getBoundingClientRect(), viewport());
    element.style.left = `${p.x}px`;
    element.style.top = `${p.y}px`;
    return p;
  };
  const layout = () => {
    if (stopped) return;
    const v = viewport();
    const b = place(button, position.button || { x: v.x + v.width - 48, y: v.y + v.height - 108 });
    panel.style.maxWidth = `${Math.max(0, v.width - 16)}px`;
    panel.style.maxHeight = `${Math.max(0, Math.min(v.height * 0.7, v.height - 16))}px`;
    if (!panel.hidden) {
      const size = panel.getBoundingClientRect();
      place(panel, position.panel || { x: b.x + button.offsetWidth - size.width, y: b.y - size.height - 8 });
    }
  };
  const persist = (value) => {
    // Use the existing serial queue without touching busy, credentials or billing.
    void savePosition(value).catch(() => {
      if (!stopped) recordStage("position", false, "위치 저장 실패 — 현재 화면에만 적용됩니다. 다시 이동하거나 초기화하세요.");
    });
  };
  const finish = (event, cancelled = false) => {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    drag = null;
    if (current.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id);
    if (cancelled) { position = current.before; layout(); }
    else if (current.moved) persist(position);
    else if (current.key === "button" && event.pointerType === "touch") {
      // Some touch browsers omit compatibility click after a small pointer move.
      button.click();
      suppressClick = true; // swallow a later native click, not keyboard activation
    }
  };
  for (const [handle, element, key] of [[button, button, "button"], [header, panel, "panel"]]) {
    handle.addEventListener("pointerdown", (event) => {
      if (stopped || drag || !event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      const rect = element.getBoundingClientRect();
      drag = { id: event.pointerId, handle, key, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false, before: position };
      handle.setPointerCapture(event.pointerId);
    }, options);
    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      suppressClick = true;
      const p = place(element, { x: drag.left + dx, y: drag.top + dy });
      position = { ...position, [key]: p };
      // Moving the palette re-anchors the panel next to it, even while open.
      if (key === "button") position.panel = null;
      layout();
    }, options);
    handle.addEventListener("pointerup", event => finish(event), options);
    handle.addEventListener("pointercancel", event => finish(event, true), options);
    handle.addEventListener("lostpointercapture", event => finish(event, true), options);
  }
  button.addEventListener("click", (event) => {
    // Native keyboard activation has detail=0 and must survive a previous drag.
    if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); return; }
    suppressClick = false;
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
    layout();
  }, options);
  q(".pb-position-reset").addEventListener("click", () => {
    position = {};
    layout();
    persist(null);
  }, options);
  window.addEventListener("resize", layout, options);
  window.visualViewport?.addEventListener("resize", layout, options);
  window.visualViewport?.addEventListener("scroll", layout, options);
  // Content changes (LoRA rows/logs/status) must not push the panel off-screen.
  const observer = new ResizeObserver(layout);
  observer.observe(panel);
  layout();
  return () => {
    events.abort();
    observer.disconnect();
    if (drag?.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
    drag = null;
  };
}
const cleanupPosition = setupMovablePanel();
const cleanupSelfie = installSelfieAdapter();

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

q(".pb-style-type").value = settings.pixaiStyle?.type || "none";
q(".pb-style-preset").value = settings.pixaiStyle?.key || STYLE_PRESETS[0];
q(".pb-style-custom").value = settings.pixaiStyle?.custom || "";
q(".pb-style-tags").value = settings.styleTags;
q(".pb-style-position").value = settings.styleTagsPosition;
for (const [selector,key] of [[".pb-selfie","selfieInterceptEnabled"],[".pb-recent","selfieUseRecentContext"],[".pb-persona","personaAppearanceEnabled"]]) {
  q(selector).checked = settings[key] === true;
  q(selector).addEventListener("change",async()=>{
    const on=q(selector).checked;
    try {await saveSettings({[key]:on});recordStage("settings",true,"옵션 저장됨");}
    catch {q(selector).checked=settings[key] === true;recordStage("settings",false,"옵션 저장 실패 — 실행 탭과 저장소를 확인하세요.");}
  });
}
q(".pb-style-save").addEventListener("click",async()=>{try {await saveSettings(readV2Controls());recordStage("style",true,"화풍 저장됨");}catch{recordStage("style",false,"화풍 저장 실패 — style·2,000자 예산·실행 탭을 확인하세요.");}});
q(".pb-profiles-load").addEventListener("click",()=>{void loadProfileRows().catch(()=>recordStage("profiles",false,"프로필 조회 실패 — 현재 채팅·카드 계약 확인"));});
q(".pb-preview-free").addEventListener("click",async()=>{
  try {const chatId=activeChatId(),characterId=q(".pb-preview-character").value;if(!chatId || !characterId) throw new Error();await handleSelfie({chatId,body:{characterId,previewOnly:true},startedAt:Date.now()});}
  catch {recordStage("preview",false,"미리보기 실패 — 프로필을 읽고 저장된 설정을 확인하세요.");}
});
q(".pb-stop").addEventListener("click",()=>{void emergencyStop();});
q(".pb-release").addEventListener("click",async()=>{
  const id=q(".pb-release-id").value.trim();
  if (!isLeader || !id || inflight.size || !confirm("기록 차단을 해제하면 다음 요청은 다시 과금될 수 있습니다. PixAI 계정과 갤러리를 확인했습니까?")) return;
  try {await storageLock(async()=>{const fresh=await marinara.storage.get();const rows=fresh.operationLedger.filter(r=>r.operationId!==id);await marinara.storage.patch({operationLedger:rows});settings.operationLedger=rows;});renderLedger();}
  catch {recordStage("ledger",false,"차단 해제 저장 실패");}
});
const stopChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("pixai-illustrator-stop-v2") : null;
if (stopChannel) stopChannel.onmessage = event => {if(event.data?.type === "stop"){stopLocalWork();if(event.data.deleteKey){apiKey="";q(".pb-key").value="";}void syncStopState();}};
renderLedger();

q(".pb-save").addEventListener("click", async () => {
  if (stopped || busy || inflight.size) { recordStage("settings", false, "작업 완료 후 설정을 저장하세요."); return; }
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
    if (!isLeader) { recordStage("settings", false, "Web Locks 지원 localhost/HTTPS 브라우저 한 탭에서만 자동 처리할 수 있습니다."); return; }
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
  const saveRevision = stopRevision;
  const edited = {
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
  };
  const changed = Object.fromEntries(Object.entries(edited).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(settings[k])));
  if (nextKey === apiKey && rememberKey === settings.rememberKey) {delete changed.apiKey;delete changed.rememberKey;}
  try { await saveSettings(changed); } catch { recordStage("settings", false, "설정 저장 실패 — 자동 처리는 이전 상태 유지"); return; }
  if (saveRevision !== stopRevision) return;
  if (apiKey !== nextKey) taskAccessCheck = null;
  apiKey = nextKey;
  recordStage("settings", true, `saved (key ${apiKey ? "set" : "EMPTY"}; auto=${settings.enabled})`);
  renderStatus();
  } finally { busy = false; }
});
q(".pb-delete-key").addEventListener("click", () => { if (!stopped) void emergencyStop(true); });
q(".pb-diag1").addEventListener("click", () => { runDiagnostics(false); });
q(".pb-diag2").addEventListener("click", () => { runDiagnostics(true); });
q(".pb-clear").addEventListener("click", async () => {
  if (stopped) return;
  stopRevision++;
  settings.enabled = false;
  q(".pb-enabled").checked = false;
  armedAt = Date.now();
  renderStatus();
  try { await saveSettings({ enabled: false }, { emergency: true }); }
  catch { recordStage("settings", false, "중지는 적용됐지만 설정 저장 실패 — 새로고침 뒤 확인하세요."); return; }
  finally { renderStatus(); }
  recordStage("settings", true, "자동 처리 중지 — 진행 중 작업도 다음 경계에서 중단됩니다. 접수된 과금은 취소되지 않으니 영수증을 확인하세요.");
  renderStatus();
});

function readV2Controls() {
  const type = q(".pb-style-type").value;
  const patch = { pixaiStyle:type === "none" ? null : type === "preset" ? {type,key:q(".pb-style-preset").value} : {type,custom:q(".pb-style-custom").value},
    styleTags:q(".pb-style-tags").value,styleTagsPosition:q(".pb-style-position").value };
  composePrompt({...settings,...patch},{scene:"",selfie:true});
  for (const profile of Object.values(settings.characterProfiles || {})) composePrompt({...settings,...patch},{scene:"",profiles:[profile],selfie:true});
  return patch;
}

async function loadProfileRows() {
  const chatId = activeChatId();
  if (!chatId) throw new Error("활성 채팅 없음");
  const {chat,cards} = await readChatCards(chatId);
  const list = q(".pb-profiles"); list.replaceChildren();
  const selector = q(".pb-preview-character"); selector.replaceChildren();
  for (const card of cards) {
    const profile = settings.characterProfiles[card.id] || {};
    const option = document.createElement("option"); option.value = card.id; option.textContent = `${card.name} (${card.id})`; selector.append(option);
    const row = document.createElement("fieldset");
    const title = document.createElement("legend"); title.textContent = `${card.name} · ${card.id}`; row.append(title);
    const field = (label,value) => { const el = document.createElement("label"), input = document.createElement("textarea"); el.textContent = label; input.value = value; input.rows = 2; el.append(input); row.append(el); return input; };
    const aliases = field("별칭 (한 줄에 하나)",(profile.aliases || []).join("\n"));
    const fixed = field("고정 외모 태그",profile.fixedTags || "");
    const loras = field("전용 LoRA (버전ID:가중치, 쉼표 구분)",parseLoras(profile.loras || []).map(l=>`${l.modelId}:${l.weight}`).join(","));
    const status = document.createElement("p");
    const appearance = appearanceOf(card);
    status.textContent = profile.fixedTags ? "고정 외모 설정 있음" : appearance.warning || "Appearance 있음 — 미리보기에서 확인하세요.";
    if (profile.loras?.length && !appearance.text && !profile.fixedTags) status.textContent += " LoRA 설정 있음 / 외모 텍스트 없음";
    row.append(status);
    const copy = document.createElement("select"); copy.setAttribute("aria-label","이전 ID 프로필 복사");
    const empty = document.createElement("option");empty.value="";empty.textContent="이전 ID 프로필을 명시적으로 복사";copy.append(empty);
    for (const [id,p] of Object.entries(settings.characterProfiles)) if (id !== card.id) {const o=document.createElement("option");o.value=id;o.textContent=`${p.displayName || id} (${id})`;copy.append(o);}
    copy.addEventListener("change",()=>{const p=settings.characterProfiles[copy.value];if(p){fixed.value=p.fixedTags || "";aliases.value=(p.aliases || []).join("\n");loras.value=parseLoras(p.loras || []).map(l=>`${l.modelId}:${l.weight}`).join(",");}});row.append(copy);
    const save = document.createElement("button");save.type="button";save.textContent="이 캐릭터 프로필 저장";
    save.addEventListener("click",async()=>{
      try {
        const next={displayName:card.name,aliases:aliases.value.split("\n").map(v=>v.normalize("NFC").trim()).filter(Boolean),fixedTags:fixed.value,loras:parseLoras(loras.value)};
        if (next.aliases.some(v=>v.length>200 || /[\x00-\x1f\x7f]/.test(v))) throw new Error("별칭 형식 오류");
        composePrompt(settings,{scene:"",profiles:[next],selfie:true});
        await saveProfile("characterProfiles",card.id,next);status.textContent="프로필 저장됨 — 무료 미리보기에서 확인하세요.";
      } catch { status.textContent="저장 실패 — 태그 길이·LoRA·실행 탭을 확인하세요."; }
    });row.append(save);list.append(row);
  }
  const personaId = chat.personaCharacterId ? `character:${chat.personaCharacterId}` : chat.personaId;
  q(".pb-persona-id").textContent = personaId || "이 채팅의 페르소나 없음";
  q(".pb-persona-tags").value = settings.personaProfiles[personaId]?.fixedTags || "";
  q(".pb-persona-save").onclick = async () => {
    try { if (!personaId) throw new Error(); const fixedTags=q(".pb-persona-tags").value;composePrompt(settings,{scene:"",persona:fixedTags});await saveProfile("personaProfiles",personaId,{fixedTags});recordStage("persona",true,"프로필 저장됨"); }
    catch {recordStage("persona",false,"페르소나 프로필 저장 실패");}
  };
  const response = await mfetch("/agents");
  const agents = response.ok ? await response.json() : [];
  const matches = Array.isArray(agents) ? agents.filter(a=>a.name === "PixAI Director") : [];
  const agentSettings = typeof matches[0]?.settings === "string" ? safeJson(matches[0].settings) : matches[0]?.settings;
  q(".pb-persona-context").textContent = matches.length === 1 ? `Director persona context: ${agentSettings?.contextSources?.persona === true ? "ON" : "OFF/미확인"}` : "Director 중복/없음 — Agents에서 확인하세요. 수동 셀피는 사용 가능합니다.";
}

function stopLocalWork() {
  stopRevision++;
  settings.enabled = false; settings.selfieInterceptEnabled = false; settings.characterSelfieRecoveryEnabled = false;
  armedAt = Date.now(); taskAccessCheck = null;
  for (const controller of requestControllers) controller.abort();
  requestControllers.clear();
  for (const [timer,reject] of pendingDelays) { marinara.clearTimeout(timer);reject(new DOMException("전체 중지","AbortError")); }
  pendingDelays.clear();
  for (const selector of [".pb-enabled",".pb-selfie"]) if (q(selector)) q(selector).checked = false;
}

async function emergencyStop(deleteKey = false) {
  stopLocalWork();
  const patch = {enabled:false,selfieInterceptEnabled:false,characterSelfieRecoveryEnabled:false};
  if (deleteKey) { patch.apiKey="";patch.rememberKey=false;apiKey="";settings.apiKey="";q(".pb-key").value="";q(".pb-remember").checked=false; }
  stopChannel?.postMessage({type:"stop",deleteKey});
  try { await saveSettings(patch, { emergency: true });recordStage("stop",true,"전체 중지됨 — 접수된 과금은 취소되지 않습니다. 미해결 작업 기록을 확인하세요."); }
  catch {recordStage("stop",false,"현재 탭 중지됨 / 서버 저장 실패 — 다른 탭을 닫고 저장 상태를 확인하세요.");}
  renderStatus();
}

async function syncStopState() {
  if (stopped) return;
  try {
    const fresh = await marinara.storage.get();
    if (fresh.schemaVersion !== 2) {storageError="저장소 버전 충돌 — 구버전 탭을 닫고 다시 가져오세요.";stopLocalWork();return;}
    if ((fresh.stopEpoch || 0) !== (settings.stopEpoch || 0)) {
      stopLocalWork(); settings.stopEpoch=fresh.stopEpoch || 0;
      if (fresh.apiKey === "" && fresh.rememberKey === false) {apiKey="";q(".pb-key").value="";}
    }
    settings.operationLedger = fresh.operationLedger;
    renderLedger();
  } catch { /* Every paid boundary also rechecks storage and fails closed. */ }
}

function renderStatus() {
  const reason = storageError ? storageError : stopped ? "확장 중지" : !settings.enabled ? "자동 처리 설정 꺼짐" : !apiKey ? "API 키 입력·저장 필요"
    : !isLeader ? "다른 탭 실행 중 또는 Web Locks 대기·미지원" : !boundAgentId ? "PixAI Director 확인 필요 — 한 개 가져온 뒤 저장"
    : !activeChatId() ? "활성 채팅 없음" : "";
  q(".pixai-bridge-status").textContent = `${reason ? `OFF · ${reason}` : "ON"} · key ${apiKey ? "✓" : "✗"} · chat ${activeChatId() ? "✓" : "✗"}`;
}
function renderLedger() {
  const element = q(".pb-ledger");
  if (element) element.textContent = (settings.operationLedger || []).map(r => `${r.operationId} · ${r.state} · task ${r.taskId || "—"} · gallery ${r.galleryId || "—"}`).join("\n");
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
const timer = marinara.setInterval(() => { renderStatus(); void syncStopState().then(()=>pollOnce()); }, POLL_RUNS_MS);
log("info", "PixAI Illustrator Bridge loaded");

return () => {
  stopped = true;
  cleanupPosition();
  cleanupSelfie();
  stopChannel?.close();
  selfiePreviews.clear();
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

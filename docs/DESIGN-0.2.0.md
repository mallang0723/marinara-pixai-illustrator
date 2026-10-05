# PixAI Illustrator Bridge 0.2.0 설계

**상태: SYHO-87 단계 1–5·7 로컬 구현 후보. 배포 승인 아님.** 오프라인 계약 검증 결과와 제한은 [구현 기록](IMPLEMENTATION-0.2.0.md)에 있습니다. 브라우저 fixture는 실행 환경의 Chromium 소켓 권한 제한으로 미완료이며 실제 가져오기·독립 검수·사용자 확인도 대기입니다.

**목표:** 서버 이미지 연결 없이 Conversation 셀피를 생성하고, 삽화·셀피에 공통 외모·화풍 설정을 적용한다.

**구조:** 기존 단일 `extension.js`와 생성·다운로드·업로드 경로를 유지한다. 수동 셀피는 좁게 제한한 fetch 대체, 캐릭터 명령 SSE 복구(B)는 후속 버전으로 보류한다. 모든 입구는 하나의 과금 작업 조정기를 거친다.

**기술:** 기존 full-page JavaScript/DOM, Fetch/ReadableStream, Web Locks, Marinara storage/API, Node test runner 및 기존 Chromium fixture. 새 프레임워크·서버·런타임 의존성은 도입하지 않는다.

## 1. 근거와 범위

### 읽은 계약

- 확장 기준: 0.1.4 소스 `64a7100`. `extension.js:114–143` 저장, `211–299` PixAI 조회·생성, `366–413` 업로드·첨부, `425–475` 디렉터 처리, `790–839` 실행·해제.
- Marinara 계약 기준: staging `9d3d6154d`의 아래 파일. 조사 중 로컬 HEAD는 `dac79b5f7`였으므로 주요 계약은 `9d3d6154d` 객체도 직접 읽어 대조했다. 이후 버전 전체 호환을 주장하지 않는다.
  - `packages/server/src/routes/gallery.routes.ts:1207–1245`: Conversation·참가 캐릭터·이미지 연결 검사. `previewOnly`보다 이미지 연결 검사가 먼저다.
  - `packages/client/src/hooks/use-gallery.ts:8–19,125–140`: `ChatImage`, 셀피 POST, 완료 후 갤러리 query 무효화. 수동 경로는 메시지 첨부가 아니다.
  - `packages/client/src/lib/api-client.ts:298–302`: 전역 fetch 사용.
  - `packages/client/src/lib/personal-extension-traffic.ts:76–81`: 확장 fetch도 `window.fetch`를 통과한다. 재귀 방지가 필요하다.
  - `packages/server/src/services/generation/conversation-selfie-command-runtime.ts:104–114,124–132,366–391`: 연결 없음과 생성 실패가 모두 `selfie_error`; 연결 없음 분기만 이미지 호출 이전이다. 오류에는 messageId·swipeIndex가 없다. 성공 이벤트에는 messageId가 있다.
  - `packages/client/src/hooks/use-generate.ts:1846,2629,2766–2790`: `/generate` SSE, `message_saved`, `selfie`, `selfie_error` 처리. 실패 토스트는 원래 클라이언트의 동작이다.
  - `packages/server/src/routes/chats.routes.ts:2474–2543`: extra PATCH는 `?swipeIndex=N` 지정 가능. 배열 원자 append가 아니라 읽기·병합·쓰기이므로 타 작성자와의 충돌은 남는다.
  - `packages/server/src/routes/characters.routes.ts:1406–1409,2436–2439`: 카드 및 페르소나 조회. 페르소나 경로는 `/api/characters/personas/:id`이며 `/api/personas/:id`가 아니다.
- PixAI 공식 [Create Image v2](https://platform.pixai.art/en/docs/api-v2/image/createImage), [모델 참고](https://platform.pixai.art/en/docs/references/models). 2026-10-05 createImage 공개 페이지에서 style preset 목록과 custom prefix 설명을 확인했다. 실제 생성은 하지 않았다.

### 포함

1. `/selfie`와 갤러리 셀피 버튼의 공통 요청 대체.
2. 캐릭터 명령 오류 복구(B)는 제외. 원본 스트림·오류를 변경하지 않음.
3. 캐릭터 ID별 고정 외모 태그·LoRA, 이름 기반 디렉터 출력 호환.
4. 선택적 페르소나 외모 및 외모 부족 안내.
5. Tsubaki용 PixAI `style`과 모든 모델용 화풍 태그.
6. 저장값 이행·과금 안전·오프라인 및 실제 가져오기 검증.

## 2. 셀피 경로 비교와 결정

| 방식 | 수동 `/selfie`·갤러리 | 캐릭터 명령 | 깨지는 지점 / 비용 위험 | 결정 |
|---|---|---|---|---|
| A. `window.fetch`에서 셀피 POST 대체 | 같은 UI·응답·갤러리 갱신을 유지 가능 | 서버 내부 호출이라 포착 불가 | URL/body/ChatImage 변경, fetch 사전 캡처·XHR 전환, 다른 확장의 래퍼. 원본과 PixAI 둘 다 보내면 이중 과금 | 수동 경로 채택 |
| B. `/api/generate` SSE에서 `selfie_error` 관측 | 해당 없음 | 연결 없음 오류에 한해 복구 가능 | 이벤트명·오류 문구·저장 이벤트 변경, messageId 부재, 그룹·스와이프 상관관계. 일반 오류 복구는 이미 과금됐을 수 있음 | 보류, 이번 구현 제외 |
| C. DOM 버튼·토스트 감시 | 접근성/번역/React 재렌더에 취약 | 토스트만으로 메시지 식별 불가 | 중복 listener, 이름/최신 메시지 추측, 원본 호출 취소 실패 | 채택하지 않음 |
| D. 서버 네이티브 연결/공식 확장 hook | 가장 안정적인 장기 경로 | 안정적인 messageId·swipe 앵커 가능 | 서버 설치·업스트림 변경 필요 | 이번 범위 밖, 장기 대안 |
| E. 별도 확장 셀피 버튼 | 안전한 수동 대체 입구 | 명령 자동 연동 불가 | 원래 두 UI를 해결하지 못함 | 장애 안내에서만 제시, 이번 필수 UI로 추가하지 않음 |

**결정:** 이번 구현은 A이며 B는 제공하지 않는다. 아래 B 상세 설계는 후속 검토 참고로만 남긴다. B가 앵커를 확정하지 못하면 생성하지 않는다. “모든 캐릭터 명령을 지원”한다고 표기하지 않는다.

### 2.1 A — 요청 소유권을 먼저 확정

- 설정 `selfieInterceptEnabled=false`로 이행. 자동 삽화 `enabled`와 독립이며 Director가 없어도 수동 셀피 사용 가능.
- 같은 origin의 정확한 `POST /api/gallery/<chatId>/selfie`만 검사한다. 문자열/URL/Request 및 init override를 지원하고, Request body는 clone하여 원본을 소비하지 않는다. 쿼리·body 미지원 필드·다른 메서드·타 origin은 건드리지 않는다.
- JSON object, 유효한 characterId, Conversation 채팅, 실제 참가 ID를 검증한다. `context`, `promptOverride`, `negativePromptOverride`는 프롬프트 자료로만 받는다. **ChatArea는 `queueImageGenerationRequests`, `debugMode`를 평상시에도 보낸다**(`ChatArea.tsx:1582–1585`). 이 boolean 필드의 존재를 미지원으로 분류하면 실제 `/selfie`를 놓친다. 둘 다 허용하되 queue는 Bridge의 단일 큐 정책으로 대체하고 debug는 원문 로깅 없이 무시한다고 고지한다. 그 밖의 미지원 필드는 원본 통과이며 별도 PixAI 작업을 만들지 않는다.
- `previewOnly:true`는 서버에 보내지 않고 같은 로컬 composer로 무료 응답을 만든다. 서버의 `gallery.routes.ts:1420–1440`과 같은 `{items:[{id:"conversation-selfie",kind:"selfie",title,prompt,negativePrompt}]}` envelope를 사용하며 계산하지 않은 width/height는 생략한다. preview는 claim/create/upload 0회다. UI의 kind 및 optional dimension 소비 계약을 실제 prompt-review fixture에서 검사해야 한다. preview 결과를 재전송한 override에서 화풍·고정 태그가 이중 추가되지 않도록 composer dedupe를 적용하고, 최종 설정이 달라졌으면 다시 검토를 요구한다. 서버 `previewOnly`를 호출하는 방식과는 다르다.
- 지원 요청의 소유권을 획득한 뒤 키/잠금/카드 조회/검증 실패가 나면 JSON 오류 응답으로 종료한다. **실패를 숨기고 원본 POST를 자동 재전송하지 않는다.** 패널은 “이번 요청 생성 안 함”과 “접수 여부 불명”을 구분한다.
- OFF 또는 계약 미지원으로 인계하기 **전**에는 원래 fetch를 그대로 호출한다. 이미 인계받은 요청의 실패는 원본 재호출 대신 사용자가 OFF 후 새로 요청하도록 안내한다. 원본 복귀와 유료 retry를 구분한다.
- 성공 경로: 카드·채팅 읽기 → 로컬 프롬프트 미리보기/검증 → 공통 조정기 → 조회 사전 확인 → PixAI create → poll → download → gallery upload.
- 업로드가 돌려준 실제 `ChatImage`를 검증해 `Response(JSON.stringify(image), {status:200, headers:{'Content-Type':'application/json'}})`에 넣는다. `id,chatId,filePath,prompt,provider,model,createdAt,url` 및 nullable width/height 계약을 검사한다. 가짜 ID·시간·파일경로는 만들지 않는다. 이 응답으로 기존 hook의 갤러리 갱신이 실행된다.
- 수동 셀피는 갤러리에만 저장한다. “가장 최근 메시지”에 임의 첨부하지 않는다.
- 호출자의 abort를 존중한다. create 이후 abort는 결제 취소가 아니며 작업 영수증을 남기고 원본/새 create를 보내지 않는다.

### 2.2 B — 후속 버전으로 보류 (이번 구현 제외)

**아래 B 설계와 관련 검증은 후속 참고이며 이번 완료 조건이 아니다. C1/C2 및 B 전용 C6도 함께 보류한다.** `characterSelfieRecoveryEnabled=false`를 별도로 둔다. A만으로 B가 구현됐다고 보지 않는다.

1. 정확한 같은-origin `POST /api/generate` 요청의 chatId를 캡처한다. 실제 응답이 정상 SSE일 때만 관측한다. 생성 요청 자체·body·서버 명령은 수정하지 않는다.
2. 원본 바이트를 그대로 전달하는 단일 reader pass-through를 사용한다. clone().text()로 전체 스트림을 버퍼링하지 않는다. TextDecoder streaming, CRLF, chunk 분할, 여러 data 줄, 종료 잔여 프레임, abort·cancel 전파를 fixture로 검증한다. 파서 버퍼는 프레임 최대 256 KiB로 제한하며 초과 시 관측만 끈다. 원본 대화 스트림은 계속 전달한다.
3. 아래 오류 **정확 일치**만 후보로 모은다: `No image generation connection configured for this chat. Set one in Chat Settings.` 또 처리 전 GET 채팅 metadata에서 `imageGenConnectionId`가 비어 있는지 확인한다. 다른 오류/번역/알 수 없는 버전/`selfie` 성공은 생성하지 않는다. 오류를 부분 문자열로 분류하지 않는다.
4. 스트림 완료 때까지 기다린다. 같은 요청에서 관측된 `message_saved` 중 role=assistant, characterId 일치, chatId 일치인 **고유한 messageId+activeSwipeIndex 하나**만 허용한다. 중복 snapshot은 같은 앵커로 축약한다. 오류가 여러 번이면 같은 앵커에 1회만 처리한다. assistant row가 없거나 여러 개거나 swipeIndex가 없으면 중단한다. user 저장 이벤트는 제외한다.
5. GET 메시지/스와이프 자료로 앵커의 실재·소속을 재확인한다. 단일 캐릭터 Conversation부터 허용하고 그룹 응답·분기·regenerate/continue·다른 생성 스트림과 겹침은 0.2.0에서 복구 제외한다. 스트림 자체가 끊겼거나 정상 종료가 확인되지 않아도 생성하지 않는다. 이렇게 해도 event 순서/ID 계약은 실제 fixture와 가져오기에서 입증해야 하는 출시 게이트다.
6. 공통 조정기에 `chatId,messageId,swipeIndex,characterId`를 전달한다. 최신 채팅/최신 메시지/DOM 이름을 다시 선택하지 않는다. PixAI 이미지 생성 후 갤러리 업로드, **대상 swipe의 기존 attachments**와 병합해 `PATCH .../extra?swipeIndex=N`으로 저장한다. 활성 swipe가 달라지면 현재 화면용 extra를 덮지 않는다. 대상 swipe를 조회할 수 없으면 첨부는 중단하고 갤러리 결과만 보존한다.
7. 성공은 패널과 임시 preview로 알린다. 원본 `selfie_error` 토스트는 숨기거나 가짜 `selfie` 이벤트로 바꾸지 않는다. “Marinara 연결 오류 후 Bridge 복구 완료”를 구별해 표시하며 재진입 후 영구 첨부를 확인한다. 실패 토스트 제거는 별도 UX 변경이다.

**한계:** 서버는 이미 실패했으며 확장은 그 뒤 복구한다. 서버가 브라우저 SSE 밖에서 자율 실행한 명령, 꺼진 탭·모바일 백그라운드에서 놓친 이벤트는 복구하지 않는다. 완전한 자동 복구에는 구조화된 오류 코드+messageId+swipeIndex를 제공하는 업스트림 hook이 필요하다.

### 2.3 래퍼 수명과 안전 복귀

- 설치 시 이전 fetch 함수를 캡처하고 symbol 기반 인스턴스 가드로 이중 설치를 막는다. 비대상 호출은 원래 this/인자를 유지해 즉시 이전 함수로 보낸다.
- 확장 내부 `/generate`·셀피 경로 호출은 하지 않는다. 기존 `marinara.fetch`가 전역 래퍼를 거치는 점을 고려해 내부 호출 식별/재진입 가드를 테스트한다. 픽스된 endpoint 매칭만으로도 업로드·PixAI·storage는 통과해야 한다.
- cleanup에서 자기 래퍼가 여전히 현재 fetch일 때만 이전 함수를 복원한다. 뒤에 다른 래퍼가 붙었으면 그것을 덮지 않고 자기 래퍼를 stopped pass-through로 바꾼다. abort·reader·listener를 정리한다.
- 계약 검사 실패 시 해당 어댑터를 세션 동안 끄고 버전 불일치 사유를 알린다. 동작 중인 대화 스트림을 예외로 깨지 않는다. 후속 셀피는 원본 경로이며 원본 이미지 연결의 비용이 발생할 수 있음을 고지한다.

## 3. 셀피 프롬프트: 기본은 로컬 템플릿

| 선택 | 장점 | 단점/설치 부담 | 판단 |
|---|---|---|---|
| 로컬 템플릿 | 추가 LLM 비용·agent import 없음, 결정적·테스트 용이 | 자유문/한국어 외모를 영어 태그로 정확히 번역하지 못함, 긴 대화에서 의상·장면 추론 불가 | 0.2.0 기본 |
| 별도 Selfie Director | 카드·최근 대화를 영어 장면으로 재작성 가능 | agent JSON 추가 설치·AI 연결·LLM 비용, 실행/상관관계 API 설계 추가, prompt injection·timeout | 후속 옵션, 이번에는 추가하지 않음 |
| 기존 Director 결과 재사용 | 추가 설치 없음 | 수동 셀피 시 최신 run 없음/다른 장면/다른 캐릭터 가능 | 임의 재사용 금지 |
| 서버 previewOnly | 원래 품질 유지 | 이미지 연결 검사에 먼저 막힘 | 사용하지 않음 |

### 자료 수집과 조합

- 카드 `data`가 JSON 문자열/객체인 두 형태를 검증한다. 외모 후보는 비어 있지 않은 `data.extensions.appearance` → `data.appearance` → Description 순서. 기존 서버의 빈 문자열 fallback 문제까지 답습하지 않는다.
- 고정 태그가 있으면 identity 자료로 우선 사용한다. 카드 텍스트는 보충 설명이며 고정 hair/eyes 등의 상충을 자동 추론·교정하지 않는다. 사용자가 미리보기에서 확인한다. Description 전체를 외모로 확정하지 않는다.
- 기본 selfie scene은 `solo, selfie, upper body, looking at viewer` 등 성별·의상·나이를 추측하지 않는 구도. 고정 태그와 카드 외모 요약 문자열을 붙인다. 템플릿은 번역기가 아니므로 원문 짧은 설명도 들어갈 수 있다.
- 최근 대화 포함은 별도 `selfieUseRecentContext=false` opt-in. ON이면 대상 요청 시작 시점까지의 user/assistant 최신 4개에서 각각 최대 200 UTF-16 단위를 데이터 구획으로 가져온다. system/tool/hidden 메시지는 제외한다. 장면 추론을 했다고 표시하지 않고 “최근 대화 원문 발췌”로 보인다. 가공 없는 대화 외부 전송 위험과 품질 한계를 고지한다.
- A의 context는 같은 원문 구획에, promptOverride는 scene 대신 사용한다. 어느 경우에도 화풍·외모 고정 태그, 길이 제한, validation을 우회하지 못한다. B는 오류에 원래 명령의 장면 prompt가 없으므로 일반 셀피 구도+선택한 최근 발췌를 쓴다.
- 텍스트는 실행 지시가 아니라 데이터다. HTML/Markdown 실행·카드 이미지 업로드·URL fetch는 하지 않는다. 미성년자를 성적/암시적으로 묘사하지 않는 기존 Director 정책을 유지한다.
- persona는 해당 장면에 등장한다고 명시된 경우만 추가한다. 수동/캐릭터 셀피의 기본은 solo이며 persona 옵션 ON만으로 2인 사진이 되지 않는다.
- 무료 미리보기는 패널에서 최종 prompt, 출처별 분량, LoRA, style, 잘린 항목을 보여 준다. 카드·대화 원문은 로그나 작업 ledger에 저장하지 않는다.

### 외모 없음 안내

- 고정 태그·Appearance·Description 모두 비면 **“외모 정보 없음 → 카드 Appearance 칸이나 고정 태그를 채우세요.”**
- Description만 있으면 **“외모 전용 정보 없음 — Description에 외모가 있는지 확인하세요.”** 텍스트가 존재한다는 이유로 외모 확인 완료라 하지 않는다.
- LoRA만 있으면 “LoRA 설정 있음 / 외모 텍스트 없음”을 함께 표시한다. 기본은 경고이며 generic selfie 생성 자체를 금지하지 않는다. 임의 hair/eye 태그를 만들어 보완하지 않는다.

## 4. 캐릭터 설정표·디렉터·페르소나

### 4.1 저장 구조 (schemaVersion=2)

기존 최상위 키는 유지한다. 아래는 **키/자료형 계약**이다. B 설정은 false 예약값이며 실제 observer나 실행 옵션이 아니다.

| 새 키 | 기본값 / 값 |
|---|---|
| `schemaVersion` | `2` |
| `characterProfiles` | `{ [characterId]: {displayName, aliases: string[], fixedTags: string, loras: [{modelId: string, weight: number}]} }` |
| `personaAppearanceEnabled` | `false` |
| `personaProfiles` | `{ [personaId 또는 character:<id>]: {fixedTags: string} }` |
| `styleTags` / `styleTagsPosition` | `""` / `"prefix"` (`prefix` 또는 `suffix`) |
| `pixaiStyle` | `null` 또는 `{type:"preset",key}` 또는 `{type:"custom",custom}` |
| `selfieInterceptEnabled` | `false` |
| `characterSelfieRecoveryEnabled` | `false` |
| `selfieUseRecentContext` | `false` |
| `operationLedger` | `[]`: §7의 과금 영수증만, 카드/프롬프트/키 없음 |

**ID가 정본**이다. displayName은 UI 라벨이며 개명해도 설정을 유지한다. 이름은 디렉터가 ID를 모를 때의 해석용이다. Unicode NFC+양끝 공백 제거 후 정확히 비교한다. 대소문자/부분 문자열/발음 유사 추정은 하지 않는다.

현재 채팅 참가자 집합 안에서 카드 이름 또는 사용자가 등록한 alias가 정확히 하나일 때만 ID로 해석한다. 동명이인·alias 충돌은 자동 선택하지 않고 이름 미해결 안내를 낸다. 삭제·재가져오기되어 ID가 바뀐 카드는 설정을 자동 이전하지 않는다. UI에서 기존 프로필을 새 카드에 명시적으로 연결할 수 있도록 계획한다. 다른 채팅의 동명 인물은 검색하지 않는다.

### 4.2 Director 출력과 구버전 호환

기존 3줄과 `SKIP` 의미는 유지하고 새 줄을 **선택 사항**으로 추가한다.

```text
PIXAI_PROMPT: solo, upper body, smiling, park
PIXAI_NEGATIVE: text, watermark
PIXAI_RATIO: 2:3
PIXAI_CHARACTERS: ["Example Character"]
PIXAI_PERSONA: false
```

- `PIXAI_CHARACTERS`는 쉼표로 이름을 split하지 않고 한 줄 JSON 문자열 배열로 파싱한다. 쉼표가 들어간 이름도 보존한다. 중복 이름 제거, 최대 참가자 수 이하, 제어문자·과도한 입력 거부. 이 줄은 selector일 뿐 API/LoRA 지시를 수용하지 않는다.
- 0.1.x JSON을 그대로 써도 기존 prompt/negative/ratio로 생성한다. character 줄이 없으면 **참가자가 한 명인 채팅에서만** 그 ID를 fallback. 다인 채팅이면 고정 태그·전용 LoRA만 생략하고 구 디렉터 장면+전역 화풍·전역 LoRA를 유지하며 안내한다. 깨진 새 줄도 legacy fallback하되 경고한다.
- 일치하지 않는 이름을 발견하면 다른 사람을 추정하지 않는다. 전체 선택이 불명확한 경우 프로필 자동 적용을 생략한다. 단일 대상이 body에 있는 셀피는 이름 파싱을 거치지 않는다.
- 새 Director는 “화풍·품질 태그는 쓰지 않고 인원·외모·포즈·배경·조명 중심으로” 작성한다. 구 Director의 `masterpiece` 등은 의미를 추정해 삭제하지 않고 그대로 유지한다. 정규화 후 정확히 같은 태그만 dedupe한다.
- 새 파일도 `kind:marinara.agent`, `version:1`, `functions:[]`, post_processing/context_injection, 기존 이름·type과 모든 도구 OFF를 유지한다. 0.2.0은 확장 버전이지 agent bundle schema version 2가 아니다.
- 재가져오기로 Director가 두 개면 기존처럼 자동 삽화는 OFF 사유를 표시한다. 기존 agent를 몰래 삭제·수정하지 않는다. 수동 셀피는 Director 중복과 무관하게 사용 가능하다.

### 4.3 페르소나 옵션의 두 경계

- 확장 ON: 현재 채팅의 personaId 또는 personaCharacterId를 기준으로 해당 외모 자료만 읽는다. 글로벌 active persona를 쓰지 않는다. fixedTags 우선, 카드형 페르소나는 동일 appearance 추출, 일반 페르소나는 조회 결과의 appearance를 검증한다. 결과 구조 미지원이면 생략+경고한다.
- 삽화는 `PIXAI_PERSONA:true`일 때만 페르소나 외모를 붙인다. 구 디렉터는 이 정보가 없으므로 자동으로 “2인 장면”을 추측하지 않는다. 수동 선택 없이 persona 외모를 추가하지 않는다.
- 확장 옵션과 Director의 `contextSources.persona`는 서로 다른 설정이다. 기본 bundle은 기존처럼 false. 자연스러운 2인 장면을 원하면 사용자가 Agents에서 persona context를 ON으로 바꾸고 확장도 ON으로 설정한다. 패널에 두 상태/설정 안내를 표시한다. 확장이 공유 Director JSON을 자동 PATCH하지 않는다.
- Director ON이면 전체 페르소나 컨텍스트가 선택한 LLM에 전달될 수 있다. 확장 OFF는 이 LLM 전송을 철회하지 않고, 이미 prompt에 포함된 페르소나 묘사를 삭제할 수도 없다. 두 옵션의 개인정보 경계를 README에서 분명히 한다.

### 4.4 LoRA 병합 규칙

- 모든 ID는 양의 정수 **문자열**, weight는 유한수 0..1. 현재 `parseLoras` 제약을 재사용한다. 전역 목록과 각 프로필 목록 각각 최대 5개.
- 선택 캐릭터 순서(디렉터 배열 순, 셀피는 단일 ID)로 전용 LoRA를 수집하고 그 뒤 전역 LoRA를 합친다.
- 같은 ID/같은 weight는 1개. 캐릭터와 전역이 같은 ID면 캐릭터 weight 우선이며 미리보기에 override 표시.
- 서로 다른 캐릭터의 동일 ID/다른 weight는 모호하므로 **생성 전 차단**한다. 배열 순서로 묵살하거나 평균을 내지 않는다.
- 최종 unique ID가 5개 초과하면 **생성 전 차단**한다. 자동으로 5개만 남기지 않는다. 수정할 프로필/전역 행을 표시한다.
- DiT/SDXL 호환은 사용자가 LoRA 페이지에서 확인한다. 숫자 ID만으로 구조 호환성을 보증하지 않는다.

## 5. 화풍·style·2,000자

### UI 배치

1. 기존 상단 키/기억/삭제/노출 고지.
2. 모델 → **PixAI style (Tsubaki 전용)**: 없음 / 프리셋 / custom, custom일 때 입력칸. 항상 “Tsubaki 모델에서만 적용됩니다”.
3. **화풍 태그 (모든 모델)** + 앞(기본)/뒤 선택. PixAI style과 별개의 입력이다.
4. 전역 LoRA·크기·비율·모드·negative.
5. 접을 수 있는 캐릭터 카드형 표: 현재 채팅의 이름+ID 구별표시, 고정 태그, LoRA 행, 외모 상태, 프로필 저장. 페르소나는 별도 접이 영역.
6. 셀피 대체 ON, 최근 대화 사용 ON, 기존 자동 삽화 ON을 분리. B 옵션은 UI에 제공하지 않는다. 각 OFF 이유·비용/전송 설명.
7. 무료 미리보기·GET 진단·기존 유료 진단·중지·작업 상태. 좁은 화면에서 가로표 대신 카드형 행. 기존 드래그·위치·키보드 접근성 유지.

### 합치기와 자르기

- 기본 최종 prompt: **화풍 → 캐릭터 고정(및 등장 persona) → 카드 보충 → 디렉터/셀피 장면**.
- suffix 선택은 최종 배치만 **캐릭터 고정 → 카드 보충 → 장면 → 화풍**으로 바꾼다. 길이 예산 우선순위는 바뀌지 않는다. suffix에서도 화풍을 먼저 확보한다.
- 중복 비교는 comma 태그의 trim·NFC·소문자·연속 공백 축약 기준. 보존 우선순위는 화풍 → 고정 → 카드 → 장면이고 출력은 최초 원문 표기를 유지한다. 가중치 괄호·밑줄·상충 색깔은 의미를 추정해 변환하지 않는다. 자유문 보충은 태그가 아닌 하나의 구획으로 취급한다.
- 2,000 **UTF-16 코드 단위** 상한을 기존과 같이 유지. 구분자 `, `와 설명 구획의 문자도 계산한다. code-point 경계로 잘라 서로게이트 반쪽 금지.
- 예산: 화풍 전체와 고정 전체, 최소 selfie 구도(셀피일 때)를 먼저 예약. 이것만으로 초과하면 **저장/생성 validation 오류**이며 identity를 몰래 자르지 않는다. 나머지에서 장면 핵심을 먼저 확보하고 카드 보충 및 최근 대화는 낮은 우선순위로 둔다. 초과 시 **최근 대화의 오래된 발췌 → Description 보충 → Appearance 보충 → 장면의 뒤쪽 태그** 순으로 제거한다. 화풍·고정은 제거하지 않는다. 잘림 내역을 미리보기에 표시한다.
- negative는 기존 “명시 negative 우선, 비면 negativeDefault”를 유지하고 별도 2,000 상한. style과 섞지 않는다.
- PixAI `style.custom`은 서비스가 prompt 앞에 주입하는 별도 필드다. 확장이 같은 문자열을 prompt에 다시 붙이지 않는다. 체감 순서는 **서비스 style prefix → 확장 prompt**이나 preset의 내부 전개/토큰 수는 알 수 없다.
- custom은 제품 차원의 500 UTF-16 상한(공식 API 상한 주장 아님), 비어 있으면 validation 오류. 보수적으로 custom 길이와 구분자도 2,000 예산에서 예약한다. preset은 전개 길이를 계산할 수 없으므로 2,000은 전송 prompt 필드 보장이지 서비스 내부 결합 길이 보장이 아니다.

### style 검증

- 없음은 `style` 필드 생략, preset/custom은 oneOf로 정확한 키만 직렬화한다. DOM·저장소에서 목록 밖 preset이 들어오면 요청 차단+수정 안내, 임의 값을 보내지 않는다.
- 공식 설명상 Tsubaki.2/3 계열만 적용하며 다른 모델은 무시할 수 있다. 확장은 **확인된 Tsubaki 버전 ID allowlist**에만 style을 보낸다. 최초 allowlist는 기존 Tsubaki.2 `1983308862240288769`.
- Haruka/Hoshino 및 검증되지 않은 직접 입력 ID에서는 선택을 보관하되 style을 전송하지 않고 경고한다. 이름에 Tsubaki가 들어간다는 이유로 추정하지 않는다.
- Tsubaki.3의 스타일 지원 설명은 API 모델 버전 사용 가능성과 별개다. 현재 README의 422 관측 이력이 있으므로 ID를 만들어 프리셋에 추가하지 않는다. 별도 무과금 문서 확인과 승인된 생성 검증 후 allowlist를 갱신한다.
- 화풍 태그는 모델과 관계없이 항상 prompt에 적용한다. style과 화풍이 상충하면 모델이 따르는 정도를 보장하지 않는다.

#### 고정 preset allowlist (35종)

```text
anime-watercolor-impasto
art-crayon
bold-line-soft-color
chibi
classic-japanese
clean-flat-illustration
colored-pencil-grain
cool-warm-oil-contrast
desaturated-cool
flat-anime-pastel
glossy-glass-anime
grey-blocks-lineless
hard-line-monochrome-accent
high-contrast-retro-vivid
holographic
korean-style
lineart-watercolor-airy
low-saturation-expressive-eyes
lucid-dreamy
luminous-retro-impasto
minimal-flat-color
modern-oil-glamour
moe-pastel
oil-watercolor-blend
painterly-doodle
paper-watercolor
pencil-sketch
poster-graffiti
retro-comic-fusion
retro-oil-glamour
retro-tv-anime
semi-realistic
stable-vaporwave
tinted-sketch
vintage-collage
```

원격 목록을 매 실행 동적으로 신뢰하지 않는다. 설계 목록과 구현의 개수/중복/set equality fixture를 남긴다. 이번 공개 페이지 조회에서는 중첩 enum을 추출하지 못해 공식 enum과의 equality는 미확인이다. 문서가 바뀌면 검토 후 목록을 갱신한다.

## 6. 0.1.4 → 0.2.0 저장값 이행

현재 `savePosition`은 uiPosition만 patch하지만, `saveSettings`는 credentials를 제외한 설정 대부분을 다시 쓴다. **0.2.0에서는 후자를 그대로 재사용하지 않는다.** 오래된 탭이 다른 키를 되살리지 않게 소유 키 단위 patch로 바꾼다.

1. storage GET. `schemaVersion` 없음은 0.1.x로 해석한다. 메모리에만 새 기본값을 합치고 키·모델·enabled·processedRunIds·uiPosition의 원본값은 유지한다.
2. schemaVersion=2면 재이행하지 않는다. 알 수 없는 더 높은 버전/잘못된 타입은 자동 유료 실행을 막고 설정 오류를 표시한다. malformed 저장소를 defaults 전체로 덮지 않는다.
3. 같은 브라우저의 별도 storage Web Lock 안에서 fresh GET 후, 아직 없는 새 키만 `patch`하고 마지막에 schemaVersion=2를 포함해 한 번 저장한다. 키/위치/old run 값을 migration payload에 넣지 않는다. 실패하면 새 기능은 OFF, 성공한 척하지 않는다. 부작용 없는 재실행 가능.
4. 0.1.4 `enabled=true`는 보존하되 기존 키·leader·단일 Director 검증이 끝나야 삽화만 복원한다. 새 셀피·persona·recent 옵션은 false이며 자동으로 켜지지 않는다.
5. migration은 apiKey를 복사·백업·로그하지 않는다. rememberKey=false인데 서버에 잔존하는 키도 자동 채택하지 않는다. 세션키 자동 서버 이전 금지와 기존 삭제 규칙을 유지한다.

| 작성자 | patch 허용 키 |
|---|---|
| 위치 이동/초기화 | `uiPosition`만 |
| 키 저장 | `apiKey,rememberKey`만 |
| 키 삭제·전체 긴급 중지 | `apiKey,rememberKey,enabled,selfieInterceptEnabled,characterSelfieRecoveryEnabled` (명시적 복합 동작) |
| 자동 삽화 토글/기준 재설정 | `enabled`만; armedAt는 메모리 |
| 생성 설정 저장 | 사용자가 실제 편집한 모델·LoRA·ratio·size·mode·helper·negative·style 키만 |
| 캐릭터/페르소나 표 저장 | 해당 top-level map만; fresh GET 후 해당 ID 행만 병합 |
| 각 opt-in | 해당 boolean 키만 |
| 작업 기록 | `operationLedger`만; 구 삽화 중복 ID 호환 기록은 `processedRunIds`만 별도 patch |

모든 쓰기는 직렬 큐, 새 작업은 저장 완료 후 허용. stopRevision 검사로 대기 중인 ON 저장보다 중지가 우선한다. follower 탭은 일반 과금 설정 쓰기를 막되 긴급 중지·각 기능 OFF·키 삭제는 허용한다. map RMW와 이행은 같은 storage Web Lock으로 보호한다. 저장 stopEpoch와 메모리 stopRevision으로 중지가 대기 ON보다 우선한다. 지도형 값은 서버의 nested merge를 가정하지 않고 map 전체를 fresh-read/merge/patch한다. storage의 atomic compare-and-swap은 없으므로 **기기·브라우저 간 동시 편집은 지원하지 않는다**. 위치 patch와 다른 키 patch는 서로 되돌릴 수 없어야 한다.

롤백은 모든 처리 OFF 후 0.1.4로 돌아간다. 새 키는 삭제하지 않고 구버전이 무시하게 둔다. 구버전과 신버전을 다른 탭에서 동시에 실행하지 않는다. 키 백업 파일을 만들지 않는다.

## 7. 과금 조정기와 중복 방지

### 공통 원칙

셀피 A/B·삽화·유료 진단 **모두** 동일한 생성 전 조회 확인을 거친다. `GET /v2/task/0`의 응답은 CORS 접근 확인일 뿐 실제 task 조회/키 유효성 보장이 아니다. 2xx/404만 생성 진행, 401/403/429/5xx·네트워크/CORS/timeout은 생성 차단으로 0.1.4의 단순 HTTP 접근 확인보다 강화한다. 실제 task 조회는 v2의 **실제 404에서만** v1 fallback, 나머지는 중단. 키 변경·재시작 시 사전 확인 캐시를 무효화한다. API key 자체를 캐시 키나 로그로 남기지 않는다.

- 같은 origin·브라우저 Web Lock `pixai-illustrator-single-runner`와 단일 작업 큐 유지. 잠금 없는 환경은 과금 동작 금지. 다기기 동시 실행은 여전히 미지원.
- 기존 자동 삽화 `processedRunIds` 및 로드/armedAt 이전 제외를 유지한다. B 이벤트는 설치 이후 관측한 새 스트림만. 과거 메시지를 스캔해 복구하지 않는다.
- 큐 대기마다 설정 snapshot을 만들고 처리 직전 key/stopRevision/대상 유효성을 다시 검사한다. 실행 중 모델 변경이 upload metadata에 섞이지 않게 모델·prompt·LoRA를 작업 snapshot으로 고정한다.
- 조회·입력 validation 완료 후 **create 전에** 영속 claim 저장. 저장 실패면 POST 0회. create 결과 불명 시 자동 재시도/원본 재호출 0회. exactly-once 결제는 서버 idempotency 없이 보장할 수 없고, 이 설계는 at-most-one create 시도에 가깝다.

### 작업 키와 영수증

- 삽화: `run:<runId>` + chatId/messageId/swipe 앵커(확보 가능한 경우).
- A: 요청 수신 때 UUID 하나. 같은 chatId+characterId의 실행 중 클릭들은 동일 promise를 공유한다. 완료 후 재클릭은 새 이미지 요청이므로 비용 확인을 다시 받는다. 세션 재시작 후 같은 대상에 미해결 작업이 있으면 새 create를 막고 계정 확인/사용자 명시 해제로 푼다. body hash가 영구 요청 ID라고 가정하지 않는다.
- B: `selfie:<chatId>:<messageId>:<swipeIndex>:<characterId>`. duplicate error/replayed frame은 같은 키. streamId만 키로 삼으면 재접속에 중복되므로 사용하지 않는다.
- ledger: operationId/source/anchor/state/taskId/galleryId/createdAt/updatedAt만. 상태는 `claimed → creating → taskKnown → downloaded → uploaded → attached` 또는 `failedBeforeCreate / ambiguous / attachmentFailed / complete`.
- create 직전 creating을 저장하고, 응답 수신 즉시 taskId를 저장한다. 그 사이 crash는 ambiguous. taskId를 알면 조회/다운로드/첨부만 재개하는 향후 수동 복구가 가능하지만 **0.2.0은 자동 재개하지 않는다**.
- 완료 ledger는 최근 500건으로 제한, 미해결 creating/ambiguous/taskKnown/uploaded 실패는 자동 퇴출하지 않는다. 미해결 기록 때문에 한도를 넘으면 새 생성 차단+정리 안내. 기록 삭제는 과금 취소가 아니다.

### 셀피와 Director의 같은 턴 경쟁 (B 관련 부분은 보류)

B 대상 스트림이 열리면 그 chat의 Director run을 보류한다. 스트림이 종료되고 B 후보와 앵커를 확인한 뒤 셀피가 차지한 message/swipe는 삽화를 skipped 처리한다. B가 preflight/validation에서 실패해도 같은 턴을 삽화로 자동 재청구하지 않는다. 후보가 없으면 보류한 삽화만 처리한다. 단일 스트림이 아닌 경우 B는 제외하고 경고하며, 중복 위험이 판별되지 않는 동안 해당 턴 자동 삽화도 보수적으로 보류한다. 새로고침은 기존 armedAt 경계로 옛 run을 처리하지 않는다.

R2: 같은 chatId+characterId 실행 중 요청의 promise 공유를 먼저 검사하고, 그 외에만 409를 적용한다. A는 메시지 앵커가 없으므로 B/삽화와 자동으로 같은 장면이라 판정할 수 없다. 같은 채팅에서 다른 이미지 작업이 실행/대기 중이면 A 요청은 409와 대기 안내로 거절한다. 완료 후 별도의 수동 셀피 요청은 추가 비용이라는 확인을 받는다.

### 후단 실패

- create 접수 후 조회/다운로드 실패: taskId 또는 ambiguous 유지, 재생성 금지.
- 업로드 성공 후 첨부 실패: galleryId 유지, “갤러리 저장됨/메시지 첨부 실패”. create를 반복하지 않는다.
- 업로드 응답 자체를 잃었으면 무조건 upload 재시도도 하지 않는다. 중복 갤러리 여부 확인 필요.
- 기존 attachments를 galleryId로 중복 제거. 확장 내부 첨부는 앵커별 직렬화. 다른 확장/서버가 동시에 전체 배열을 바꾸는 lost-update는 공개 제한이며 성공을 가장하지 않는다.
- 전체 중지는 세 입구를 즉시 막는다. 이미 접수된 PixAI 작업 취소·환불을 약속하지 않는다. 확장 비활성화는 fetch 복귀·요청 abort·메모리키 정리를 한다.

## 8. 파일별 변경 계획과 규모

아래 목록의 단계 1–5·7을 로컬 구현했다. 서버 소스·운영 상태 변경과 B는 제외했다. 브라우저·실제 가져오기 단계의 미완료는 구현 기록에 별도로 표시한다.

| 파일 | 예정 변경 |
|---|---|
| `extension.js` | 소유 키 저장/migration, profile/parser/composer/style allowlist, 공통 작업 큐/ledger, A fetch adapter, UI/cleanup (B 제외). 단일 파일 내 책임별 함수로 분리 |
| `extension.css` | 접이 영역·모바일 프로필 행·warning/preview. 기존 position 동작 유지 |
| `agent/pixai-director.agent.json` | 선택 character/persona 줄·scene 중심 지시, 기본 persona=false 유지 |
| `agent-prompt.txt` | bundle과 동일 프로토콜 설명 동기화 |
| `agent/validate-agent.mjs` | 선택 줄·schema version1·함수/도구 OFF·persona 기본 검증 |
| `agent/IMPORT.ko.md` | 구 agent 유지/신 agent 교체·중복 제거·persona opt-in 안내 |
| `test/offline.test.cjs`, `test/safety.test.cjs`, `test/review.test.cjs` | 기존 안전 제약 회귀, 새 composer 요청 필드 |
| `test/remote-origin.test.cjs`, `test/restore-busy.test.cjs`, `test/reload-browser.cjs`, `test/position.test.cjs` | strict preflight·키별 patch·중지·복원·위치 noninterference |
| 신규 `test/settings-v2.test.cjs` | migration/idempotency·stale tab·map merge |
| 신규 `test/prompt-v2.test.cjs` | names/legacy/persona/LoRA/style/budget/dedupe |
| 신규 `test/selfie.test.cjs` | 요청 match/ownership/ledger/abort (B 제외) |
| 신규 `test/selfie-browser.cjs` | 네트워크 차단 브라우저 fixture로 A 및 경쟁·cleanup 검증 |
| `test/fixture.html`, `test/browser-test.cjs` | 새 패널 및 기존 fixture 계약 확장 |
| `README.md`, `CHANGELOG.md`, `manifest.json` | 독립 검수 후 지원 범위·호환/과금/키·버전 표기 |
| `tools/build.py` | 새 docs/tests의 ZIP 포함 규칙 확인, 필요한 경우만 변경 |

예상 구현 규모는 extension 기능부 약 700–1,100줄, CSS 약 80–140줄, 새/변경 tests 약 900–1,400줄 수준의 **설계 추정**이다. SSE 앵커와 저장/경쟁 제약 때문에 “셀피 POST 몇 줄 래핑”으로 완료되지 않는다. 네이티브 서버 코드 변경은 0줄을 목표로 한다.

### 구현 순서 (각 묶음 30–90분, 테스트부터)

1. storage 소유 키·migration: failing fixture → 최소 구현 → 저장/위치/중지 회귀.
2. profile·legacy parser·LoRA: 동명이인/구 JSON/충돌 failing case → 순수 함수 → 단위검증.
3. composer·style·budget: Unicode/후치 화풍/35 enum 검증 → 구현 → 실제 payload 비교.
4. 공통 ledger/조정기: claim 실패·POST timeout·중복 진단 fixture → 큐 구현 → create 횟수 assertion.
5. A: 원본/대체/abort/Request 타입 failing case → fetch adapter → 브라우저 fixture. **A가 통과하기 전 B를 붙이지 않는다.**
6. B: 원본 SSE·저장 앵커 fixture → observer/제한적 matcher → 경쟁·swipe 검증. 앵커 게이트가 실패하면 B를 지원으로 선언하지 않고 검토로 되돌린다.
7. 패널·문서·agent 업데이트 → 기존 전체 테스트 → 실제 격리 Marinara import → 독립 검수 → 사용자 확인.

이번 로컬 구현 승인은 단계 1–5·7에 한하며 자동 커밋·push·배포·유료 생성은 없다.

## 구현 조건 확정

- C3: A 오류는 non-2xx `{error:string}`. 유입 admin/CSRF 헤더는 PixAI·로그·ledger에 전달하지 않는다.
- C4: 공용 storage Web Lock RMW, follower 긴급 OFF/키 삭제 허용, 중지 우선.
- C5: create 전 caller abort는 생성하지 않는다. create 이후 caller만 거절하고 갤러리 저장을 계속한다. 전체 중지는 후단도 중단하고 미해결 영수증을 보존한다.
- C1/C2/B 전용 C6: B 전체와 함께 보류. B 실행 옵션과 observer는 구현하지 않는다.
- R1: B 제외. R2: 동일 대상 공유 우선. R3: 외모·ledger 평문 고지. R4: 0.1.x는 버전 신호를 보내지 않으므로 완전한 탐지 불가; 혼용 금지와 확인 가능한 schema 변경 경고.

## 9. 검증 계획과 출시 게이트

### 단위/계약 (모든 외부 요청 mock)

- 0.1.4 ON/OFF/기억 안 함/키 삭제/위치/processed IDs 유지, migration 2회 동일, patch 실패·future schema 차단.
- 저장 payload allowlist: 위치가 enabled/키/프로필을 포함하지 않음, ledger가 uiPosition/키를 쓰지 않음. 중지와 대기 ON 저장 경쟁.
- character ID 개명 유지, 동명이인·alias·쉼표 이름·삭제 카드, 0.1.x 3줄/새 줄/SKIP/불량 JSON. persona OFF가 새 조회/추가를 안 함.
- LoRA 0/5/6개, 문자열 큰 ID, weight 경계/NaN/중복·충돌.
- preset 정확히 35 unique·공식 목록과 동일, 잘못된 key 전송 0, Haruka style 생략+화풍 유지, custom 빈값/500 초과.
- 1,999/2,000/2,001 및 emoji 경계, suffix 화풍 보존, 고정 초과 차단, dedupe 우선순위·negative 독립.
- preflight CORS/401/429/5xx/timeout에서 create 0; 404에서만 허용. POST 응답 유실·disable 후 create 재시도 0. 실제 task 404만 v1 fallback.

### 브라우저 fixture (실제 PixAI 연결 금지)

- `/selfie`와 갤러리 버튼에 해당하는 동일 요청 fixture: 원본 selfie POST 0, create 1, 실제 mock upload 응답이 ChatImage로 돌아오고 소비자가 갤러리 invalidate. 평상시 queue/debug boolean 포함 요청 및 prompt review ON의 preview→override 재전송도 검사한다. preview 단독은 create 0이고 prefix가 두 번 붙지 않아야 한다.
- OFF/미지원 요청은 원본 1, create 0. follower/busy/잘못된 카드/취소는 처리권에 맞춰 오류, 원본과 PixAI 동시 호출 0.
- fetch string/URL/Request, 이미 소비된 body, 다른 확장 앞/뒤 wrapper, disable/re-enable, cleanup 이중 호출·재귀 없음.
- **보류(B, 이번 게이트 아님):** SSE 1바이트 단위 chunk/CRLF/multiline/초과 프레임/부정 JSON/reader cancel; 전달 바이트가 원본과 동일. 관측 오류가 본문 스트리밍을 깨지 않음.
- **보류(B, 이번 게이트 아님):** 연결 없음 오류+유일 assistant 앵커는 create 1. 일반 자기 오류/성공 selfie/앵커 없음/다수 assistant/그룹/continue/regenerate/stream abort는 create 0.
- **보류(B, 이번 게이트 아님):** `message_saved` 전후 error 양쪽, user 저장 무시, 같은 이벤트 반복, Director 동시 run·재로드·두 탭에서 중복 0.
- 첨부 시 다른 swipe로 전환, 대상 삭제, 기존 attachments 보존, 업로드 성공+PATCH 실패 표시. 390px 터치·키보드·위치 reset 회귀.

로컬 검증 명령(실행 결과·환경 제한은 구현 기록):

```sh
node --test test/*.test.cjs
node agent/validate-agent.mjs "$MARINARA_REPO"
node test/browser-test.cjs
node test/reload-browser.cjs
node test/position-browser.cjs
node test/selfie-browser.cjs
node test/storage-export.mjs
python3 tools/build.py
```

브라우저 스크립트에 필요한 `MARINARA_REPO`는 기존 의존성이 있는 Engine checkout으로 지정한다. 서버 데이터나 credentials를 읽지 않는다. 이번 환경에서 Chromium 실행은 차단되었으므로 브라우저 통과를 주장하지 않는다.

### 실제 Marinara 가져오기

- 운영 데이터 대신 합성 성인 캐릭터 1명·별도 테스트 채팅·이미지 연결 없음의 localhost와 승인된 원격 HTTPS 환경. Extension ZIP과 agent JSON의 서로 다른 import 경로를 실제 UI로 확인한다.
- 첫 단계는 전송 차단 fixture/GET 진단 및 무료 preview. 실 PixAI 생성은 사용자가 모델·옵션·예상 비용을 확인하고 승인한 사례에만 한다. 테스트 횟수를 이유로 무단 생성하지 않는다.
- A 셀피 1건: gallery에 정상 저장, 메시지 첨부가 새로 생기지 않음, 새로고침 후 gallery 1건 유지.
- B 실험은 이번 범위에서 제외한다. 원래 명령·SSE·오류가 변하지 않는지만 확인한다.
- 기존 0.1.x Director 삽화와 새 Director/profiles를 각각 검증. persona는 explicit ON+등장 true의 경우에만 외모 추가.
- 실제 외부 응답은 taskId·HTTP·operation 상태만 기록, 키·카드/대화 전문은 공개 artifact에 포함하지 않는다.

### 사용자가 눌러볼 순서 (모두 미실행·사용자 검토 게이트)

1. 기존 0.1.4에서 저장한 모델·LoRA·팔레트 위치가 남고 새 셀피 옵션이 OFF인지 본다. 무료 preview에서 캐릭터 고정 태그/화풍 순서와 스타일 경고를 확인한다.
2. “셀피 대체” ON → Conversation에서 `/selfie` → 갤러리 1장. 갤러리 셀피 버튼도 별도 유료 요청임을 확인한 후 시험한다.
3. 캐릭터 명령 복구(B)는 제공하지 않는다. `/generate`와 원래 오류를 변경하지 않는지 확인한다.
4. 캐릭터 고정 hair/eyes·전용 LoRA를 저장하고 다음 이미지에서 확인한다. 얼굴 일관성의 완전 보장은 아니다.
5. persona 옵션 두 경계를 확인하고 새 Director의 2인 장면에서 외모 반영을 비교한다. OFF에 대한 privacy 고지를 읽는다.
6. Tsubaki style을 고르고 Haruka로 바꾸면 style 미전송 경고, 화풍 태그 유지. 무료 preview에서 2,000자 잘림과 suffix 위치를 본다.
7. 새로고침·확장 OFF: 기존 작업 재생성 없음, 원래 셀피 경로 복귀, 위치/키 설정 유지. 실패 시 재클릭 전에 task/ledger 상태를 확인한다.

**완료선:** 위 계약 테스트, A 실가져오기, 기존 삽화/키/위치 회귀, 독립 검수, 사용자 확인을 모두 충족해야 0.2.0 공개를 제안한다. 현재 오프라인 단위/통합·스키마/저장 검증은 실행했지만 브라우저 UI·실가져오기·독립 검수·사용자 확인은 아직 충족하지 않았다.

## 10. 하지 않는 것과 남은 판단

- 로컬 소스 변경·오프라인 테스트·후보 빌드만 수행한다. push·release·서비스 설정 변경·유료 API 호출은 하지 않는다. 커밋은 승인됐으나 현재 환경의 .git 읽기 전용 제한으로 생성하지 못했다.
- 네이티브 PixAI 프로바이더, Noodle/아바타/비디오/게임 갤러리, 참조 이미지, 새 LLM 에이전트 자동 설치, 카드/페르소나 자동 수정은 제외.
- 모든 캐릭터 명령·다인/연속/재생성·서버 자율 명령 복구, 원본 실패 토스트 제거, 다기기 exactly-once, 서버 attachment 원자 append, 장기 작업 자동 재개는 제외.
- Tsubaki.3 API 가용성·preset의 내부 프롬프트 길이·LoRA 구조 호환을 숫자만으로 보증하지 않는다.
- 검토에서 확정할 핵심은 **B 제외·원래 오류 유지**, **추가 LLM 없는 템플릿 품질 한계**, **LoRA/고정 태그 초과 시 차단**, **strict preflight로 기존보다 보수적인 과금 조건**이다. 승인 전에는 지원 완료라 표기하지 않는다.

## 리비전 이력

| 날짜 | 변경 |
|---|---|
| 2026-10-05 | 0.2.0 설계·안전·검증 초안 |

| 2026-10-05 | SYHO-87: 단계 1–5·7 승인, B/C1/C2/B-C6 보류 및 C3–C5/R1–R4 확정 |
| 2026-10-05 | 단계 1–5·7 로컬 후보 상태·브라우저 차단·공식 enum 미확인·사용자 체크리스트 미실행 명시 |

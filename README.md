# PixAI Illustrator Bridge 0.2.0

**0.2.0 진단 경로의 실기기 생성·다운로드 성공이 보고됐습니다.** 독립 검수는 통과했으며, 갤러리 저장·새로고침 유지와 셀피/자동 삽화 경로의 실기기 확인은 남아 있습니다. 진단 성공이 모든 사용 경로의 성공을 보장하지는 않습니다. 상세 결과는 [구현 기록](./docs/IMPLEMENTATION-0.2.0.md), 계약은 [설계](./docs/DESIGN-0.2.0.md)를 보세요.

| 파일 | 가져오는 곳 |
|---|---|
| `marinara-pixai-illustrator-v0.2.0.zip` | Settings › Addons › External Extensions › Import (ZIP 그대로) |
| `pixai-director.agent.json` | Agents › Import agents (자동 삽화에만 필요) |

확장은 PixAI 공식 API에 이미지 1장을 요청해 Marinara 갤러리에 저장합니다. 자동 삽화는 대상 메시지에 첨부하고, 수동 셀피는 갤러리에만 저장합니다. 셀피에는 Director나 서버 이미지 연결이 필요하지 않습니다. 번들은 에이전트가 텍스트를 작성하고 확장이 이미지를 생성하는 구조입니다.

## 범위와 조건

| 기능 | 0.2.0 구현 범위 |
|---|---|
| 새 Director run 자동 삽화 | 기존 로드/활성화 시각 경계와 단일 Director 검사 유지 |
| Conversation `/selfie`·갤러리 셀피 | 같은 origin의 정확한 POST 요청을 opt-in 대체, 무료 prompt review 지원 |
| 캐릭터 명령의 SSE 오류 복구(B) | 제외. 원래 `/generate`와 오류를 변경하지 않음 |
| ID별 고정 외모·별칭·LoRA, 페르소나 외모 | 프로필 편집·무료 미리보기 지원, 페르소나 기본 OFF |
| 화풍 태그·PixAI style | 앞/뒤 화풍, 검증된 Tsubaki ID에만 style 전송 |
| Noodle·아바타·비디오·참조 이미지 | 제외 |

Web Locks를 제공하는 localhost/HTTPS 브라우저 한 프로필·한 출처에서 사용하세요. 다른 기기/브라우저/포트의 동시 실행은 지원하지 않습니다. 0.1.x 탭은 모두 닫으세요. 구버전은 버전 신호를 보내지 않고 전체 설정을 다시 쓰므로 완전한 혼용 감지는 불가능합니다. schema 변경이 보이면 중지·경고하지만 같은 schema가 유지된 구버전 쓰기까지 탐지하지는 못합니다.

## 설치와 첫 확인

### GitHub 주소로 설치·업데이트

커뮤니티의 **GitHub 확장 관리자 1.0.1**을 별도로 가져오고 코드를 검토·승인한 경우 다음 방법을 사용할 수 있습니다. 이 관리자는 제3자 확장이며, 이 저장소에 포함되거나 자동 설치되지 않습니다. 관리자와 PixAI 확장 모두 `full_page_access`를 사용합니다.

1. Settings › Addons › External Extensions의 **GitHub 확장 관리**를 열고 `https://github.com/mallang0723/marinara-pixai-illustrator`를 입력해 **패키지 찾기**를 누릅니다.
2. **설치 대상 선택을 반드시 확인하세요.** 1.0.1은 최신 정식 Release ZIP을 첫 선택지로 표시하고, `manifest.json`은 기본 브랜치 `main`의 코드를 가져옵니다. 2026-10-14 검증 당시에는 정식 Release가 `v0.1.4 / marinara-pixai-illustrator-v0.1.4.zip`, main은 0.2.0 Pre-release였습니다. 0.2.0이 정식 Release로 승격되면 첫 선택지도 0.2.0 ZIP으로 바뀝니다. 주소 입력 자체가 항상 main이나 항상 최신 버전을 설치한다는 뜻은 아닙니다.
3. **내용 확인**에서 버전·권한·코드를 검토한 뒤 설치합니다. 새 코드는 **비활성**으로 저장됩니다. Marinara 기본 External Extensions 화면에서 정확한 코드 해시를 승인하고 새로고침한 뒤 🎨 패널을 확인하세요. 키 입력·유료 생성은 설치 확인과 별개입니다.
4. 기존 ZIP 설치본이 있으면 새로 설치하지 말고 같은 이름의 **PixAI Illustrator Bridge** 항목에서 **GitHub 주소 연결** → 패키지 선택 → **이 저장소 연결**을 사용합니다. 연결만으로 기존 코드는 바뀌지 않습니다. 이후 **업데이트 확인** → **업데이트 보기** → **업데이트 설치**를 사용하세요.

업데이트는 선택한 배포 경로를 따라가며, JS·CSS·권한의 변경으로 판정합니다. 버전·설명·README만 바뀌면 업데이트가 아닙니다. 이름 또는 runtime이 달라진 패키지는 자동 교체하지 않습니다. 업데이트 후 같은 확장 ID와 저장 설정을 유지하지만 다시 비활성화되므로 새 해시 승인과 새로고침이 필요합니다. 과금 중에는 업데이트하지 말고 먼저 작업 영수증을 확인하세요.

**1.0.1 제한:** Release ZIP 연결은 파일명을 저장합니다. 다음 정식 Release의 ZIP 이름에 새 버전이 들어가면 기존 경로가 없어져 확인을 건너뛸 수 있습니다. 그때 **주소 변경**으로 새 Release ZIP을 다시 선택하세요. 루트 `manifest.json` 연결은 이 파일명 문제 없이 main을 따라가지만, main에 Pre-release 코드가 있으면 그것도 가져오므로 버전을 확인하세요. 저장소 `dist/`의 일반 `.zip`은 이 관리자의 소스 ZIP 검색 조건(`.personal-extension.zip`)에 해당하지 않으며, 검증 당시 선택지에는 나타나지 않았습니다.

### ZIP으로 설치

1. 모든 이전 확장 탭을 닫고, 로컬 후보 파일의 `SHA256SUMS`를 확인합니다. 소스·해시와 `full_page_access` 권한을 검토하세요.
2. Marinara의 외부 확장 허용 설정과 Danger Zone › Allow third-party extension imports를 확인하고 ZIP을 가져옵니다. 기존 서버 설정을 이 확장이 수정하지는 않습니다.
3. 자동 삽화가 필요하면 Allow custom Agent imports를 켜고 JSON을 Agents로 가져옵니다. [별도 가져오기 안내](./agent/IMPORT.ko.md)를 따르세요. 중복 가져오기는 새 Director를 만듭니다. 정확히 한 개만 유지하세요.
4. 🎨 패널에서 모델·LoRA·키를 입력하고 저장합니다. 기존 모델·위치·ON/OFF는 유지되며 새 셀피·페르소나·최근 대화 옵션은 OFF로 이행합니다.
5. **현재 채팅 프로필 읽기** → 외모 태그/LoRA 저장 → **무료 미리보기**에서 최종 prompt, negative, 출처별 분량, style, LoRA, 잘림·경고를 확인합니다. 무료 미리보기는 PixAI GET/create/upload와 작업 claim을 하지 않습니다.
6. **진단 1: GET만**으로 결과 조회 접근을 확인합니다. 실제 task나 키 유효성을 보장하지는 않습니다.
7. 사용자 비용 승인 후에만 **셀피 대체**를 켜거나 **진단 2**를 실행합니다. 셀피 대체는 자동 삽화 ON 및 Director와 독립입니다. 완료 후 다시 누르면 별도 유료 요청입니다.
8. 합성 성인 캐릭터의 격리 채팅에서 갤러리 저장과 새로고침 후 유지, 셀피의 메시지 미첨부를 확인합니다. 실제 생성은 별도 사용자 승인 게이트입니다.

ZIP과 JSON의 가져오는 곳이 다릅니다. JSON을 External Extensions에 넣거나 ZIP을 Agents에 넣지 마세요. 구버전 JSON의 함수 개수 오탐은 빈 `functions:[]`가 있는 현재 파일로 회피합니다. JSON schema는 계속 `version:1`입니다.

## 외모·화풍·페르소나

ID가 정본이고 이름은 화면 표시 및 디렉터 이름 해석용입니다. 현재 참가자 안에서 NFC·공백 정리 후 카드 이름/별칭이 정확히 하나일 때만 선택합니다. 동명이인이나 불명확한 이름은 프로필 적용을 생략하고 안내합니다. 구 3줄 Director는 참가자 한 명일 때만 fallback하며 다인 채팅에서는 전역 화풍·LoRA와 구 장면을 사용합니다. 재가져오기로 ID가 달라졌으면 프로필 카드의 이전 ID 선택란에서 명시적으로 복사 후 저장하세요.

카드의 비어 있지 않은 `extensions.appearance` → `appearance` → Description 순으로 보충합니다. Description만 있으면 외모 확인 경고, LoRA만 있으면 텍스트 없음 경고를 냅니다. 로컬 템플릿은 번역/장면 추론을 하지 않으며 성별·나이·의상을 만들어 넣지 않습니다.

캐릭터 전용 LoRA가 같은 ID의 전역 weight보다 우선합니다. 두 캐릭터의 weight 충돌이나 합계 5개 초과는 생성 전에 차단합니다. ID는 큰 숫자도 문자열로 보존하고 weight는 0..1입니다. 베이스 모델 구조와 LoRA 호환은 모델 페이지에서 확인하세요.

화풍·고정 외모·셀피 최소 구도를 먼저 예약합니다. 필수 태그만으로 2,000 UTF-16 단위를 넘으면 차단합니다. 남은 예산에서 장면을 먼저 확보하고 Appearance·Description·최근 대화의 낮은 우선순위 자료를 줄입니다. suffix에서도 화풍은 잘리지 않습니다. 코드포인트 경계는 지키지만 grapheme 묶음 전체 보존은 보장하지 않습니다. negative는 별도 2,000자입니다.

PixAI style과 화풍 태그는 독립입니다. style은 `1983308862240288769` (Tsubaki.2)에만 전송하고 다른 ID에서는 선택을 보관하며 경고합니다. custom은 제품 상한 500자로 제한하고 2,000자 예산에서도 길이를 예약합니다. preset 내부 전개 길이는 알 수 없습니다. 35개 고정 목록은 2026-10-05 [공식 Create Image 문서](https://platform.pixai.art/en/docs/api-v2/image/createImage)의 공개 HTML에서 추출한 목록과 개수·중복·set equality를 검사했습니다. 출처 fixture는 `test/fixtures/pixai-style-presets.json`입니다.

페르소나는 **확장 외모 옵션 ON + 새 Director의 `PIXAI_PERSONA:true`**일 때만 읽습니다. 현재 채팅의 persona ID만 사용하며 solo 셀피에는 추가하지 않습니다. Agents의 `contextSources.persona`는 별도 옵션이고 동봉 JSON의 기본값은 false입니다. Director에서 ON이면 전체 페르소나 컨텍스트가 선택한 LLM에 전송될 수 있습니다. 확장 OFF는 그 전송을 철회하거나 이미 작성된 prompt의 묘사를 삭제하지 않습니다.

최근 대화 옵션은 별도 opt-in입니다. 요청 시작까지의 숨기지 않은 user/assistant 최근 4개에서 각 최대 200자를 **원문**으로 PixAI에 보냅니다. 미리보기로 확인하세요. 카드·대화 자료는 HTML로 실행하거나 URL로 fetch하지 않습니다.

## 모델과 비용

| 모델 | 버전 ID |
|---|---|
| Tsubaki.2 | `1983308862240288769` |
| Haruka v2 | `1861558740588989558` |
| Hoshino v2 | `1954632828118619567` |

[PixAI 모델 페이지](https://pixai.art)의 주소 마지막 숫자인 **버전 ID**를 사용합니다. LoRA 항목은 `{modelId:"버전ID",weight:0.7}`입니다. 다른 모델에서는 Tsubaki 전용 mode를 `(none)`으로 설정하세요. 모델·LoRA·모드의 실제 지원/비용은 계정과 서비스 정책에 따라 다릅니다. Tsubaki.3 ID를 추정해 추가하지 않습니다.

모든 유료 입구(자동 삽화·셀피·진단 2)는 한 조정기와 `pixai-illustrator-single-runner` 잠금을 사용합니다. `GET /v2/task/0`은 **읽을 수 있는 HTTP 응답을 받으면 CORS 접근 통과**로 봅니다. 401/403은 **키 확인 필요**로 생성 차단하고, 나머지 HTTP 상태(400/404/422/429/500 포함)는 코드를 기록하되 생성은 차단하지 않습니다. 네트워크/CORS/timeout으로 응답을 읽지 못하면 생성 차단합니다. 이 확인은 실제 task 조회·키 유효성·생성 성공 보장이 아닙니다.

캐시 재사용은 2xx/404만 유지합니다. 그 밖의 응답은 생성 허용 여부와 별개로 캐시하지 않아 다음 호출에서 다시 조회합니다. 키 변경·설정 저장·재실행은 성공 캐시도 무효화합니다. **실제 task 조회**는 여전히 v2의 404에서만 v1으로 폴백하고, 그 밖의 오류는 중단합니다.

진단 실패 시 `pixai.preflight GET`와 `diag`의 HTTP 코드 또는 확장 검증 문구를 확인하세요. 임의 오류 원문·원격 응답 본문·키·프롬프트는 표시하지 않습니다. 브라우저가 응답을 숨긴 네트워크/CORS 오류에서는 HTTP 코드를 알 수 없으며 401/403으로 추정하지 않습니다. 설정을 고친 뒤 **진단 1(GET만)**부터 다시 확인하세요.

create 전에 claim/creating을 저장하고 응답 즉시 taskId를 저장합니다. 저장 실패면 생성하지 않습니다. POST 결과 불명은 `ambiguous`로 남기며 원본 셀피 POST나 새 create를 자동 재시도하지 않습니다. 같은 실행 중 chat+character 요청을 공유한 뒤, 다른 같은 채팅 작업에만 409를 적용합니다. 완료 후 재클릭은 새 비용입니다. 진단 2는 생성+다운로드만 하며 갤러리에 올리지 않습니다.

caller abort는 결제 취소가 아닙니다. create 전에는 생성하지 않고, 이후에는 호출자를 거절하되 이미 만든 작업을 갤러리까지 계속합니다. **전체 긴급 중지·키 삭제·자동 처리 중지 버튼·확장 비활성화**는 후단도 중단하고 미해결 기록을 남깁니다. 다른 탭에서도 중지/OFF/키 삭제가 가능합니다. 같은 origin 중지 알림과 저장 stopEpoch를 확인하지만 이미 서버가 접수한 작업의 취소·환불은 보장하지 않습니다.

체크박스의 **자동 삽화/셀피 대체 OFF는 위 중지 버튼과 다릅니다**. create 전 작업만 차단하고 이미 과금된 작업은 갤러리까지 보존합니다. 최근 대화/페르소나 OFF는 다음 작업의 자료 수집부터 적용하며 이미 보낸 자료를 철회하지 않습니다. 이 일반 OFF 저장은 stopEpoch를 올리지 않습니다.

미해결 작업은 자동 재개·퇴출하지 않습니다. 같은 채팅/진단 재생성을 막으므로 계정과 갤러리를 확인한 뒤 operation ID로 차단을 명시 해제하세요. 완료 기록은 최대 500건이고 미해결이 한도를 채우면 새 작업을 막습니다. 해제는 과금 취소가 아니며 다음 요청은 새 비용입니다. 업로드 응답 유실도 자동 업로드 재시도를 하지 않습니다.

## 셀피 계약과 복귀

같은 origin의 정확한 `POST /api/gallery/<chatId>/selfie`, 참가자 ID, Conversation 계약만 대체합니다. `queueImageGenerationRequests`, `debugMode` boolean은 허용하되 단일 큐 정책으로 처리하고 debug 원문은 기록하지 않습니다. 쿼리·미지원 필드·다른 메서드·타 origin·OFF는 원본 fetch로 통과합니다. **대체권을 획득한 뒤 실패한 요청은 원본으로 재전송하지 않습니다.** 오류는 non-2xx `{error:string}`이고, caller 취소는 AbortError입니다. inbound admin/CSRF 헤더는 PixAI·로그·ledger로 전달하지 않습니다.

무료 preview와 override는 같은 composer를 쓰며, 미리보기 후 설정 변경은 재검토를 요구합니다. 반환 ChatImage는 실제 upload 응답을 검사합니다. 응답 계약 불일치로 세션 대체가 꺼지면 다음 요청은 원본 이미지 연결을 사용하며 원본 비용이 발생할 수 있습니다. fetch 사전 캡처·XHR 전환·다른 확장/서버 버전은 실제 가져오기에서 확인해야 합니다.

## 개인정보와 저장

**확장 저장소는 서버 HTTP 접근자에게 평문으로 노출될 수 있습니다.** 키뿐 아니라 캐릭터/페르소나 외모 태그·별칭·LoRA·작업 영수증도 해당합니다. 서버 접속자/프로그램은 `GET /api/personal-extensions/:id/storage`로 읽을 수 있습니다. 데이터 폴더·백업에도 남을 수 있습니다. 네이티브 연결의 암호화와 이 확장은 별개입니다.

| 자료 | 저장/전송 |
|---|---|
| API 키 | 기억 기본 ON, 저장 버튼으로 서버 평문 저장. OFF 저장은 서버 값을 비우고 현재 메모리에만 보관 |
| 프로필·화풍·설정·위치 | 서버 확장 저장소, 키별 patch. map은 공유 storage Web Lock 아래 fresh GET/병합 |
| 영수증 | operationId/source/anchor/state/taskId/galleryId/시각만 저장. 키·헤더·카드·대화·prompt 없음 |
| prompt/negative | PixAI 전송, 결과 prompt는 Marinara 갤러리/삽화 첨부에도 저장 |
| 이미지 | PixAI/CDN → Marinara 갤러리, 삽화는 메시지 첨부 |
| Director 컨텍스트 | 선택한 LLM으로 채팅/캐릭터 및 명시 설정한 persona 자료 전송 가능 |

키·원격 응답 본문은 로그하지 않습니다. 소스 ZIP 내보내기에는 저장 키가 포함되지 않지만 서버 전체 백업은 다릅니다. 브라우저 데이터 삭제만으로 서버 키를 지울 수 없습니다. `full_page_access`, 같은 출처 코드, 다른 확장, 개발자 도구로부터 키를 격리하지 않습니다. 구 sessionStorage 키는 로드/cleanup 때 삭제만 합니다.

## 중지·제거·롤백

1. **전체 긴급 중지**를 누르고 작업 영수증을 확인합니다. **저장된 키 삭제**는 busy 중에도 메모리 키를 즉시 비우며 저장 실패를 별도로 표시합니다. 실패하면 서버 연결을 확인해 다시 삭제하세요.
2. Director를 비활성화하고 필요하면 삭제합니다. 확장을 비활성화/제거하면 fetch wrapper와 listener·요청·메모리키를 정리합니다. 기억한 서버 키는 명시 삭제하지 않는 한 남습니다.
3. 갤러리·첨부·서버 백업·PixAI 자료는 별도로 삭제합니다. 확장 제거가 외부 서비스 자료까지 지우지는 않습니다.
4. 0.1.4 롤백은 모든 기능 OFF 후 모든 탭을 닫고 진행합니다. 새 저장 키는 남겨 두어 구버전이 무시하게 합니다. 키 백업 파일은 만들지 마세요.

팔레트·패널 헤더 드래그, Enter/Space, 위치 초기화는 유지합니다. 6px 미만은 클릭/탭이고 창 크기/회전에서 화면 안으로 보정합니다. 위치 patch는 과금 설정을 쓰지 않습니다.

## 한계와 검증

- 자동 삽화는 클라이언트/서버 시계 동기화가 전제이며 활성 채팅을 4초 간격으로 감시합니다. 오래된 run은 재생성하지 않습니다.
- 서버 idempotency/CAS가 없으므로 다기기 exactly-once 과금·다른 작성자와 attachment 원자 append는 보장하지 않습니다. 대상 swipe가 바뀌면 갤러리만 보존합니다.
- CDN은 허용 HTTPS 호스트·MIME·20 MiB를 검사하고 redirect를 거부합니다. v1 media fallback은 Origin 정책으로 실패할 수 있습니다.
- Chromium fixture 5개(기존 UI·reload·desktop/390px touch 위치·셀피 A·진단)와 Node 테스트 106개가 통과했습니다. OFF 중 과금 작업 보존·안전한 오류 표시·캐시 무효화를 유지하고, preflight HTTP 판정표를 정정했습니다. 합성 Chromium 검증은 실기기나 실생성 성공을 증명하지 않습니다.
- **사용자 실기기 보고(2026-10-14, 릴리스 v0.2.0 ZIP, iPhone·AWS Marinara):** 유효 키로 task 0을 조회한 진단 1의 preflight/diag.task GET은 HTTP 400이었고 CORS 접근 통과·생성 허용으로 처리됐습니다. 진단 2는 create POST 접수 → 약 10초 뒤 task completed → 833,528 bytes `image/webp` 다운로드에 성공했습니다. 이 결과는 사용자 보고이며 유지관리자가 해당 기기에서 재실행한 결과는 아닙니다. 갤러리 저장·새로고침 유지 및 셀피/자동 삽화 경로는 아직 미확인입니다. Tailscale HTTPS 환경의 실제 실패 상태도 별도 미확인입니다.

기존 Engine `node_modules`를 재사용하고 설치하지 않습니다. 아래 명령은 확장 저장소 루트에서 실행합니다. 예시 Engine 경로가 다르면 첫 줄을 실제 체크아웃으로 바꾸세요:

```sh
export MARINARA_REPO="$HOME/Marinara-Engine"
node --test test/*.test.cjs
node --test --test-isolation=none test/*.test.cjs
node agent/validate-agent.mjs "$MARINARA_REPO"
node test/browser-test.cjs
node test/reload-browser.cjs
node test/position-browser.cjs
node test/selfie-browser.cjs
node test/diagnostics-browser.cjs
node test/storage-export.mjs
python3 tools/build.py
```

`MARINARA_REPO`를 기존 Engine 체크아웃에 지정하세요. 브라우저 harness는 외부 네트워크를 차단하며 합성 응답만 사용합니다. 빌드는 소스·테스트·설계와 에이전트 JSON을 포함한 ZIP 및 SHA256SUMS를 만들고 원본 바이트를 대조합니다. dist 해시를 담는 구현 기록은 자기참조를 피하려고 ZIP 밖에 둡니다. 배포/서버 실행은 하지 않습니다.

## 라이선스

Copyright (c) 2026 mallang0723

GNU Affero General Public License v3.0. [LICENSE](./LICENSE), [제3자 고지](./THIRD_PARTY_NOTICES.md)를 참고하세요. PixAI와 Marinara Engine의 공식 배포물이 아닙니다.

## 리비전 이력

| 날짜 | 대상 | 변경 |
|---|---|---|
| 2026-10-02 | README | 0.1.0 공개 배포 후보 상태, 9단계 localhost 검증 절차와 배포 예정 산출물 명시 |
| 2026-10-02 | README | 모델/LoRA 스키마, 비용, 권한, 개인정보, 제거와 동시성 제한 정리 |
| 2026-10-02 | README | CORS 보고서의 외부 관측 출처와 공개 전 3개 승인 게이트 명시 |
| 2026-10-02 | README | 안전 보강·빌드·범위 정정 (유지관리자) |
| 2026-10-02 | README | 시계 전제·상한·키 삭제 명시 |
| 2026-10-02 | README | 0.1.2 즉시 중지·코드포인트 경계 명시 |
| 2026-10-05 | README | 0.1.3 키 기억·설치 경로 정정 |
| 2026-10-05 | README | 자동 처리 복원·OFF 사유·실측 보고 |
| 2026-10-05 | README | 서버 API 키 노출면 고지 보강 |
| 2026-10-05 | README | 공개본 정리 — 설치 파일 2개(확장 ZIP·에이전트 JSON), 지원 범위, 모델·LoRA ID 찾는 법, 검증 기록, 저작권 확정 |
| 2026-10-05 | README | 0.1.4 원격 조회·과금 전 확인·제한 명시 |
| 2026-10-05 | README | 팔레트·패널 이동과 위치 저장 안내 |
| 2026-10-05 | README | 구버전 JSON 함수 오탐 안내 |
| 2026-10-05 | README | 사전 확인 실패 턴 재시도 제한 안내 |
| 2026-10-05 | README | 0.2.0 로컬 후보 범위·프로필·A/abort·평문 노출·브라우저 미검증 게이트 명시 |
| 2026-10-05 | README | 브라우저·71개·공식 preset 검증 갱신 |
| 2026-10-06 | README | 기능 OFF 의미·검증 환경변수 명시 |
| 2026-10-06 | README | 진단 오류·캐시 재시도·검증 한계 정리 |
| 2026-10-06 | README | HTTP 도달성·인증 차단 판정 정정 |
| 2026-10-12 | README | 0.2.0 Pre-release 공개 상태로 정정 |
| 2026-10-14 | README·manifest | GitHub 설치·선택·업데이트 안내 |
| 2026-10-14 | README·manifest | 실기기 보고·승격 준비 문구 반영 |

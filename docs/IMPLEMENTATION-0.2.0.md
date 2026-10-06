# 0.2.0 구현 기록 (SYHO-87)

**상태: 조건부 검수 수정에 이어 실기 차단 보고의 오류 표시·preflight 캐시 수정 완료, 새 후보 한정 재검수 대기. 사용자 iPhone Safari/Tailscale HTTPS 재시험·공개는 미완료.** B/SSE 복구는 제외했습니다. 이번 작업에서 실제 PixAI 생성, 자격 증명 열람, 운영/원격 서버 조작, push/release는 수행하지 않았습니다. 모든 테스트 자료는 합성입니다.

기준은 `main 64a7100`입니다. 이전 중단 변경을 보존하고 설계와 제공된 검토 문서를 전부 읽어 이어 구현했습니다. 기존 Engine node_modules만 사용했고 새 의존성 설치는 없습니다.

## 구현 결과

- 없는 v2 키만 이행, malformed/future schema 유료 실행 차단. 소유 키 patch와 migration/profile RMW의 공용 storage Web Lock, follower 중지·키 삭제, stopRevision/stopEpoch를 적용했습니다.
- ID 프로필·별칭·legacy/JSON 이름 parser, LoRA 충돌·5개 제한, persona 옵션+명시 등장 경계, 화풍·style allowlist·UTF-16 예산·suffix 보존·dedupe를 구현했습니다.
- 자동 삽화·셀피·유료 진단이 동일 조정기를 사용합니다. strict preflight → claim/creating 저장 → create 한 번 → taskId 저장 → 후단 영수증 순서입니다. 모델·prompt·LoRA는 snapshot이며 접수 불명 재시도·미해결 자동 퇴출은 없습니다.
- A는 정확한 origin/path/method/body, string/URL/Request/init override, clone, 무료 preview→override, 설정 변경 재검토, 실제 ChatImage 검사, 원본 재전송 금지, cleanup을 지원합니다.
- caller abort는 create 전 생성 0, create 후 caller 거절+gallery 계속입니다. 전체 중지/키 삭제/cleanup은 후단 중단·미해결 기록입니다. 삽화는 생성 전에 message/active swipe를 확인하고 첨부 시 변경됐다면 갤러리만 보존합니다.
- 패널에 프로필/이전 ID 명시 복사·persona 경계·화풍·무료 preview·ledger/명시 해제·전체 중지를 추가했습니다. 새 opt-in 기본 OFF, Director 선택 줄·import validator·한국어 운영 문서를 동기화했습니다.

## 순차 TDD 증거

RED는 실제 실행한 실패, GREEN은 assertion을 유지한 재실행입니다. 이미 구현된 동작의 추가 회귀 테스트에는 RED 이력을 주장하지 않습니다.

| 순서 | 동작 | RED 관측 | GREEN |
|---|---|---|---|
| 1 | migration/idempotency/future schema | 이전 중단 로그의 구현 없음 | settings-v2 통과 |
| 2 | 소유 키/map lock/stop wins | 이전 중단 로그 실패 | 기존 6개 회귀 포함 통과 |
| 3 | 이름·LoRA·composer·persona | 중단 로그 helper 미구현 (`appearanceOf` 등) | prompt-v2 4개 통과 |
| 4 | strict preflight | 401 등 `Missing expected rejection` 재현 | create 0, 당시 전체 34/34 |
| 5 | claim/ambiguous/재생성 차단 | `missing helper coordinate` | creating < POST, 저장 실패 POST 0 |
| 6 | 모든 유료 입구 연결 | 구 processRun의 `pixaiCreateTask is not defined` | 공통 coordinator 검사 통과 |
| 7 | 요청 매칭 | `missing helper matchSelfie` | string/URL/Request/init·원본 body 보존 |
| 8 | wrapper·abort·cleanup | `missing helper installSelfieAdapter` | 원본 0·409·뒤 wrapper 보존 |
| 9 | 무료 preview/override | `missing helper handleSelfie` | claim/create 0·변경 설정 409 |
| 10 | ChatImage | `missing helper validateChatImage` | 필드 누락·외부 URL 거부 |
| 11 | style 패널 validation | `missing helper readV2Controls` | preset/2,000자 초과 차단 |
| 12 | malformed 저장값 | `missing helper validateStorage` | malformed opt-in/profile/ledger patch 0 |
| 13 | 최종 POST 경계 중지 | `Missing expected rejection` | preflight 뒤 중지 POST 0 |
| 14 | 외모 보충 override dedupe | Appearance가 두 번 붙음 | 같은 preview 재조합 동일 |
| 15 | follower 응답 | follower가 AbortError를 던짐 | non-2xx error JSON·원본 0 |
| 16 | agent 선택 줄 | PIXAI_CHARACTERS assertion 실패 | JSON/원문 일치·persona OFF |
| 17 | stale 키 메모리 복원 | 삭제된 합성 키가 메모리에 남음 | stopEpoch 충돌 시 키 비움 |
| 18 | 빈 protocol 줄 | negative가 PIXAI_RATIO 줄 소비 | 빈 negative 유지 |
| 19 | 삽화 대상 검증 | `missing helper prepareIllustration` | 대상 없으면 거부·swipe snapshot |

추가 GREEN 회귀: 같은 target promise identity/409 우선, caller abort 후 gallery 완료, 모델 snapshot, 미해결 500건 차단, 독립 큐 두 개의 map lock 병합, busy follower 키 삭제, 설계 preset 35개 set equality. 실제 helper 전체 경로 fixture는 preview → create → poll → download → gallery 호출 수·header 경계·ledger 비밀 제외를 확인합니다.

기존 helper fixture에 공용 lock/fresh GET과 실제 coordinator를 공급했습니다. 직렬 저장 assertion은 서버에 병합된 상태를 관찰하도록 적응하고 기존 assertion을 유지했습니다. remote-origin의 **401 이후 생성 허용**만 승인된 strict preflight에 맞춰 생성 0회로 강화했습니다. browser fixture에는 migration/locks와 대상 카드·메시지 응답을 추가했습니다. 위치 1 drag=1 write assertion은 별도 확인한 migration 쓰기 이후부터 계수합니다.

## 실제 실행 결과

아래는 2026-10-06 수정 후 직접 재실행 결과입니다. 확장 저장소 루트에서 먼저 `export MARINARA_REPO="$HOME/Marinara-Engine"`를 실행합니다. 실제 검증 Engine checkout은 `/home/syhekate/Marinara-Engine`이며 다른 환경에서는 경로를 바꿔야 합니다. validator에도 아래와 같이 같은 경로 인자를 전달합니다.

| 명령 | 결과 |
|---|---|
| `node --test test/*.test.cjs` | PASS: 102/102, skip 0 |
| `node --test --test-isolation=none test/*.test.cjs` | PASS: 102/102, skip 0 |
| `node agent/validate-agent.mjs "$MARINARA_REPO"` | PASS: 실제 import·Zod, agent 1/functions 0, 능력 15개 OFF, persona OFF, prompt 일치 |
| `node test/storage-export.mjs` | PASS: 실제 Engine 평문 저장/삭제, export에서 합성 키·프로필·ledger 제외 |
| `node test/browser-test.cjs` | 부모 최종 직접 재실행 PASS: 키 기억/삭제/실패·회귀·외부 전송 0 |
| `node test/reload-browser.cjs` | 부모 최종 직접 재실행 PASS: ON/OFF·중복 방지·follower·stop |
| `node test/position-browser.cjs` | 부모 최종 직접 재실행 PASS: desktop 및 390px touch/rotation |
| `node test/selfie-browser.cjs` | PASS: preview·Request·gallery·C3·abort·poll 중 최근 대화 OFF·stop·cleanup |
| `node test/diagnostics-browser.cjs` | PASS: 실제 진단 버튼 401/403 표시·실패 재조회·성공 재사용·동일키 저장/키 변경 무효화·모델 오류·비밀 비노출·create 0 |
| `python3 tools/build.py` | PASS: 감싼 JS 문법·소스 40개 ZIP/JSON 원본 바이트 대조 |
| `git diff --check` | PASS |

초기 구현 도구는 420초 제한으로 중단돼 변경을 회수해 이어 작업했습니다. 위임 sandbox에서는 Chromium이 `setsockopt: Operation not permitted`로 종료됐지만 부모 환경에서는 실행 가능했습니다. 부모가 모바일 fixture의 다중 paragraph selector 실패를 재현하고 `.pixai-bridge-panel > p:first-of-type`로 좁혔습니다. 독립 리뷰 4건 수정 이후 부모가 브라우저 4개·validator·storage export를 직접 다시 실행해 전부 통과했습니다. 실제 Marinara UI import·실 PixAI 생성 성공을 뜻하지 않습니다.

[PixAI 공개 Create Image](https://platform.pixai.art/en/docs/api-v2/image/createImage)의 HTML 내 `Available presets` 원문에서 35개 키를 직접 추출했습니다(2026-10-05). `test/fixtures/pixai-style-presets.json`에 출처·목록을 보존했고 `test/official-presets.test.cjs`로 구현 allowlist와 개수·중복·set equality를 확인했습니다. 루트 OpenAPI YAML URL은 404였으나 공개 페이지 원문으로 검증을 완료했습니다. 실제 PixAI API 호출은 없습니다.

## 조건 C1–C6 / 권고 R1–R4

| 항목 | 결정·증거·한계 |
|---|---|
| C1 | B 대상/종료 판정은 전체 B와 함께 보류. SSE observer 없음 |
| C2 | B Response/청크/reader cancel 보류. A fetch cleanup은 구현·오프라인 검사 |
| C3 | non-2xx `{error:string}`·409. inbound admin/CSRF를 PixAI/로그/ledger에 복사하지 않음. 통합 fixture 검증 |
| C4 | migration/map/ledger 공유 storage lock, follower OFF/키 삭제/전체 중지, stopRevision+stopEpoch·방송·저장 재확인. stale 키 메모리 복원 차단. 다기기 CAS 없음 |
| C5 | create 전 abort 0회, 이후 gallery 계속+caller reject, global stop은 미해결 기록. 단위·통합 검증 |
| C6 | B 전용 Director 보류 큐 자체 없음. 해당 조건 보류. 일반 run은 기존 처리 ID/오류 종결 유지 |
| R1 | B 제외, UI 실행 옵션 없음 |
| R2 | 같은 target inflight 공유 먼저, 다른 같은 chat 작업에 409 |
| R3 | README·패널에 키/외모/persona/ledger의 서버 HTTP 평문 노출 고지 |
| R4 | schema 변경 시 중지·경고. 0.1.x는 신호 없이 전체 설정을 써 동일 schema 유지 시 탐지 불가. 혼용 금지·탭 닫기 명시 |

## 커밋과 산출물

위임 sandbox에서는 `.git/index.lock: Read-only file system`으로 커밋이 막혔습니다. 부모가 검증 후 승인된 로컬 커밋을 selective staging으로 수행했습니다. `git add -A`, push/release는 하지 않았습니다.

- `bb4daaf`: 설계·구현 범위·조건 고정.
- `2dc75a6`: 저장/프로필/composer/ledger/A/UI·안전 수정·회귀 테스트.
- `1ef97ff`: agent 프로토콜·한국어 문서·0.2.0 빌드 설정.
- 최종 증거 문서 커밋은 별도이며 자기 해시를 본문에 넣지 않습니다.

| 로컬 dist 파일 | SHA-256 |
|---|---|
| `marinara-pixai-illustrator-v0.2.0.zip` | `a2ee8b1bb90ede2fc3a5545c3119645841d5448bcf1f57916901db67d958c79c` |
| `pixai-director.agent.json` | `805bbbddb4ab80eb667451c6fca6301809ddaeef2d8a0c8aa558315972794152` |

`dist/SHA256SUMS`와 함께 로컬 생성했습니다. dist는 gitignore 대상입니다. ZIP에 설계는 포함하고, 해시 자기참조를 피하려고 이 구현 기록은 포함하지 않습니다. 실제 import/배포 승인을 의미하지 않습니다.

## 남은 사용자 검토 순서 (미실행)

1. 조건부 검수의 조건 1 회귀 테스트와 새 산출물 해시를 한정 재검수받습니다. 오프라인 브라우저 4개와 공식 preset 목록 대조는 완료했습니다.
2. 구버전 탭을 닫고 운영 데이터와 분리한 Marinara에 ZIP/agent를 각각 올바른 UI로 가져옵니다. 기존 모델·LoRA·키 기억 정책·위치·ON 보존과 새 opt-in OFF를 확인합니다.
3. 합성 성인 캐릭터로 프로필·개명·동명이인·이전 ID 복사·무료 preview를 확인합니다. 실제 prompt review kind/optional dimensions와 gallery query 무효화를 확인합니다.
4. 별도 승인한 모델·비용으로만 셀피 1건을 확인합니다. gallery 유지·메시지 미첨부·재요청 비용·abort 후 gallery·전체 중지 후 ledger를 확인하며 자동 반복 생성하지 않습니다.
5. 구/새 Director 삽화, persona 두 옵션+등장 true, 모델별 style 경고, LoRA 충돌·2,000자·suffix·최근 원문 opt-in을 비교합니다.
6. 새로고침/cleanup 복귀, follower emergency OFF/키 삭제, 터치·키보드·위치를 확인합니다. 미해결 기록은 계정/갤러리 확인 후에만 해제합니다.
7. 독립 검수와 사용자 확인 후 공개 여부를 결정합니다. B는 이번 완료 대상이 아닙니다.

## 독립 검수 4건 수정 — 2026-10-05

요청 범위만 수정했고 커밋은 부모가 수행하도록 남겼습니다. 이번 작업에서는 네트워크, PixAI, 서버, 자격 증명에 접근하지 않았습니다. 부모의 position-browser selector 수정을 그대로 보존했습니다.

`test/review-races.test.cjs`를 먼저 추가해 실제 helper를 실행했습니다. 최초 RED는 14개 중 13개 실패·1개 통과(기존 caller abort 차단)였고, 구현 수정 후 같은 14개 assertion이 모두 GREEN이었습니다. 이후 엄격한 영수증 검사가 정상 삽화/진단 lifecycle을 허용하는 추가 GREEN 회귀 1개와 migration 검사를 더했습니다.

| 독립 검수 | RED 관측 | 수정 및 GREEN 증거 |
|---|---|---|
| P1 위치 저장/리셋 RMW 충돌 | 두 위치 테스트에서 OFF가 `true`로 복원됨 | `savePosition`의 null 리셋까지 공용 `pixai-illustrator-storage` Web Lock 사용. 독립 tab 큐와 서버 전체 객체 read/merge/write를 겹쳐 시도하며 OFF·stopEpoch·영수증 보존, 동시 서버 read 없음 확인. 모든 storage PATCH 경로가 같은 lock 안에 있음 |
| P1 최종 조회 중 stop 뒤 POST | stop·키 삭제·leadership 상실·cleanup 및 microtask 중지에서 실제 create transport 호출 1회 | storage await 직후 상태 재검사. 비동기 guard가 반환한 동기 guard를 POST 직전에 실행해 revision/stop·키·leadership·abort를 재검사. 중단 시 POST 0·failedBeforeCreate, create 이후 caller abort의 gallery 완료 유지 |
| P1 body parsing 중 stop 우회 | 지연된 Request clone body를 푼 뒤 Bridge 또는 native 호출 1회 | 매칭 전에 ingress stopRevision 보존, parsing 후 revision·intercept·owner·cleanup 검사, coordinator에도 ingress revision 전달. stop, stop 후 재활성화, opt-out, cleanup 모두 AbortError·Bridge/native POST 0·원본 body 미소비 |
| P2 malformed ledger 중복 차단 우회 | `anchor:{}`가 거절되지 않고 claim 시 주입한 잘못된 영수증 뒤 POST 1회 | source enum·객체/문자열 타입·비어 있지 않은 ID·source별 chat/character/message/swipe anchor·timestamp·상태별 task/gallery ID 검사. 중복 operation ID도 거부. migration, paid guard, lock 안의 fresh ledger와 새 receipt 검증. 26개 malformed 변형 및 claim 직전 주입에서 POST 0·기존 ledger 보존 |

기존 helper fixture에는 실제 `validateStorage`와 stopRevision을 공급했습니다. capacity fixture의 500개 영수증에는 유효한 character anchor와 timestamp를 채웠고 기존 한도 assertion은 유지했습니다. 테스트를 완화하지 않았습니다.

이 수정 묶음 당시 70/70 PASS였으며 이후 공식 preset fixture를 더해 최종 **71/71 PASS**를 확인했습니다. 새 컨텍스트 재리뷰는 **APPROVED — Scope A**, 핵심 경로 29/29 통과로 반환됐습니다. 이 자체 리뷰는 별도 정식 구현 검수를 대신하지 않습니다.

## 조건부 구현 검수 후 수정 — 2026-10-06

SYHO-88의 조건부 판정 후 필수 수정만 반영했습니다. 위의 C1–C6/R1–R4 표는 **설계 검수** 번호이며 아래는 **구현 검수** 번호입니다.

| 항목 | 반영·검증 |
|---|---|
| 조건 1 | 일반 OFF와 명시적 emergency 저장을 분리. stopEpoch는 전체 중지·키 삭제·자동 처리 중지 버튼에서만 증가. 기능 OFF는 create 전을 차단하고 이미 POST를 보낸 작업은 갤러리까지 진행. 프라이버시 옵션은 작업 준비 시 한 번 snapshot하며 follower의 OFF도 다음 작업에 반영 |
| 조건 2 | CHANGELOG의 Chromium 실패 문장을 과거 sandbox 제약과 실제 부모 환경 통과로 구분. ZIP 재빌드와 아래 SHA-256 갱신 |
| R2 | Appearance/Description이 자동 삽화 프롬프트에도 추가되어 외부 전송된다는 변경 사실을 CHANGELOG에 명시 |
| R3 | 모델/LoRA 검증과 비동기 guard를 통과한 **동기 POST 직전 guard**에서만 creating=true. 입력 실패는 failedBeforeCreate, 실제 POST 결과 불명만 ambiguous 유지 |
| R5 | README·설계·이 문서에 MARINARA_REPO export와 validator 경로 인자 명시 |
| R1 / R4 | 0.2.1로 이월. follower 409 안내 세분화와 카드 조회 실패 시 선택적 보충 생략은 이번 과금 보존 수정에 섞지 않음. 현재는 기존 보수적 오류 종료를 유지 |

`test/feature-off.test.cjs` 11개는 최근 대화 OFF 중 poll→gallery, persona 다음 snapshot, follower 기능/프라이버시 OFF, 명시 긴급 중지, 모델 검증 실패, 최종 guard 직전 OFF, 삽화/셀피 각각 create 전 차단·create 후 보존을 검사합니다. RED로 일반 OFF의 stopEpoch 증가/유료 작업 중단, create 전 OFF 미차단, 검증 실패의 ambiguous 분류, follower privacy 다음 snapshot 미반영을 관측한 뒤 수정해 GREEN을 확인했습니다. 추가 정상 경로 검사는 RED를 주장하지 않습니다.

`test/selfie-browser.cjs`에는 실제 체크박스 조작으로 최근 대화 ON → 셀피 poll 대기 → 최근 대화 OFF → poll 해제 → ChatImage/gallery/complete 및 stopEpoch 불변을 확인하는 회귀를 추가했습니다. 기존 create mock은 실제 POST 직전 guard를 호출하도록 수정했고, 과거 중지 테스트는 일반 OFF가 아니라 명시 emergency 의도를 전달하도록 변경했습니다. 과금 중단/키 삭제/최종 guard/caller abort 기존 assertion은 유지했습니다.

## 실기 차단 보고 후 진단 수정 — 2026-10-06

- **확인한 원인:** 비허용 HTTP 상태는 preflight 로그 이전에 throw했고, `describeFetchError`가 내부 검증 오류까지 일반 문구로 숨겼습니다. 실패 결과도 세션 캐시에 남았습니다. 다만 **기존 코드에도 실제 키 값이 바뀌면 캐시를 비우는 분기는 있었습니다.** 사용자 시각 기록만으로 키 저장 무효화 자체가 전혀 없었다거나 실제 응답이 401/403이었다고 단정하지 않습니다. 동일 키 저장은 무효화하지 않았고, 실패 재시도·진행 중 요청 경쟁을 함께 수정했습니다.
- **오류 경계:** `bridgeError`에서 검토된 확장 문구만 WeakMap의 객체 동일성으로 신뢰합니다. 숫자 HTTP 코드는 100–599 정수만 표시합니다. 임의 `Error.message`, JSON 파서가 담은 원문, 원격 status/body, 키·프롬프트·ID는 신뢰 문구에 섞지 않습니다. 진단·조정기·설정·셀피에서 동일 포맷터를 사용합니다.
- **캐시:** 현재 인증값의 진행 중 조회를 공유하고 2xx/404만 재사용합니다. HTTP/네트워크 실패는 제거해 다음 호출에서 다시 조회합니다. 명시적 저장은 동일 키/빈 patch여도 성공 캐시를 비웁니다. 이전 promise 실패가 새로운 캐시를 지우지 않도록 동일성 검사합니다.
- **TDD/검수:** 위임 구현의 초기 신규 테스트 16개 중 13개 실패·3개 통과를 로그에서 확인했습니다. 이후 신규 테스트 20개 통과, 부모 직접 전체 102개와 Chromium 5종·validator·storage export 통과. 구현 CLI는 420초 제한으로 종료되어 변경을 회수했고 부모가 직접 검증했습니다. 별도 read-only 리뷰는 요구사항/보안 모두 APPROVED, 신규 20개 통과를 보고했습니다.
- **독립 수용 검사:** 부모가 작성한 `test/diagnostics-browser.cjs`는 전체 확장과 실제 UI 버튼/로그를 390px Chromium에서 실행합니다. 401/403 본문에 비밀 sentinel을 넣어 코드만 보이는지, 실패→재조회→성공 캐시→동일키 저장→키 변경을 순서대로 확인합니다. 초기 harness의 모델 입력은 preset 상태에서 disabled여서 custom 선택을 추가했습니다. 실제 외부 전송은 차단했고 create 0회입니다.
- **한계:** Safari 실기 원인은 아직 미확정입니다. 새 ZIP으로 진단 1부터 재시험하여 표시된 단계·코드로 확인해야 합니다. 실제 유료 생성·계정·키 유효성을 이 오프라인 결과로 주장하지 않습니다. 0.2.1 이월 R1 세부 원인 분류/R4 카드 조회 폴백은 확대 구현하지 않았습니다.

## 리비전 이력

| 날짜 | 변경 |
|---|---|
| 2026-10-05 | 중단 작업의 저장 이행 RED/GREEN 기록 시작 |
| 2026-10-05 | 단계 1–5·7·55개 검증·C/R·브라우저/커밋 차단·해시·사용자 게이트 기록 |
| 2026-10-05 | 경쟁 수정·71개·브라우저·목록·커밋 검증 |
| 2026-10-06 | 조건부 검수 수정·82개·새 해시 반영 |
| 2026-10-06 | 진단·캐시 수정 및 102개·브라우저 검증 |

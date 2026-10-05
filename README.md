# PixAI Illustrator Bridge 0.1.4

**설치 요약: 받을 파일은 두 개입니다.**

| 파일 | 넣는 곳 |
|---|---|
| `marinara-pixai-illustrator-v0.1.4.zip` | 설정 › Addons › **External Extensions** › Import (압축 풀지 말고 ZIP 그대로) |
| `pixai-director.agent.json` | **Agents** 패널 › **Import agents** (Danger Zone의 *Allow custom Agent imports* 먼저 켜기) |

JSON을 External Extensions에 넣거나 ZIP을 Agents에 넣으면 "No personal extensions were found" 같은 오류가 납니다.

> **상태(2026-10-05):** 실제 Marinara 2.4.6(staging)에서 RP 턴 삽화 생성 → 갤러리 저장 → 메시지 첨부를 확인했고, 독립 보안 검토를 통과했습니다. 지원 범위는 아래 "지원 범위"를 보세요.

Marinara Engine의 사용자 에이전트가 만든 이미지 프롬프트를 읽어 PixAI 공식 API에 이미지 1장을 요청하고, 결과를 채팅 갤러리에 저장한 뒤 해당 메시지에 첨부하는 전체 페이지 확장입니다. 별도 프록시는 포함하지 않습니다.

## 지원 범위

| 기능 | 지원 |
|---|---|
| RP·대화 모드 턴 삽화(에이전트가 장면을 고르면 이미지 1장 → 메시지 첨부) | ✅ |
| 모델 선택·LoRA 최대 5개 | ✅ |
| 원격 웹서버(도메인 주소) 지원(0.1.4~) | HTTPS·Web Locks 브라우저, 서버/클라이언트 시계 동기화 전제. v2 결과 조회 사용; 원격 실측·독립 검토 대기 |
| `/selfie` 명령, Noodle, 아바타 등 Marinara 내장 이미지 기능 | ❌ — 이 기능들은 Marinara 내장 이미지 연결을 씁니다. PixAI 네이티브 연결은 Marinara 본체 기여로 따로 진행 중입니다 |
| 캐릭터 카드 이미지 참조 | ❌ — PixAI API가 참조 이미지 입력을 받지 않습니다 |
| 캐릭터별 고정 태그·LoRA | 다음 버전(0.2.0) 예정 |

## 구성

- 확장: [`manifest.json`](./manifest.json), [`extension.js`](./extension.js), `extension.css`
- 수동 작성 에이전트 가져오기 패키지: [`agent/pixai-director.agent.json`](./agent/pixai-director.agent.json)과 [가져오기 안내](./agent/IMPORT.ko.md)
- 검사 자료: [`test/offline.test.cjs`](./test/offline.test.cjs), [`test/browser-test.cjs`](./test/browser-test.cjs), [`agent/validate-agent.mjs`](./agent/validate-agent.mjs)
- 문서: 이 문서, [변경 기록](./CHANGELOG.md), [제3자 고지](./THIRD_PARTY_NOTICES.md), [라이선스 전문](./LICENSE)

`agent/` 패키지는 이 저장소에서 수동 작성한 번들 가져오기 자료입니다. Professor Mari가 만들거나 내보낸 패키지가 아닙니다. 에이전트는 텍스트 프롬프트만 작성하며 이미지 생성은 별도 확장이 담당합니다.

릴리스에 올라가는 파일은 `marinara-pixai-illustrator-v0.1.4.zip`, `pixai-director.agent.json`, `SHA256SUMS` 세 개입니다. 소스에서 직접 만들려면 `python3 tools/build.py`를 실행합니다(확장 ZIP과 체크섬 생성).

확장 ZIP은 소스·문서·테스트·빌드 스크립트를 포함합니다. 빌드는 감싼 `node --check`, ZIP 무결성과 원본 바이트 일치를 검사합니다. 배포 파일이 있는 `dist/`에서 `sha256sum -c SHA256SUMS`로 확인합니다.

개발 검증: `node --test test/*.test.cjs`, `MARINARA_REPO=/path/to/Marinara-Engine node test/browser-test.cjs`, `node agent/validate-agent.mjs /path/to/Marinara-Engine`. 화면 재현은 같은 환경변수로 `node test/screenshots.cjs`를 실행합니다. 브라우저 fixture는 모든 네트워크를 차단하며 실제 앱 설치 테스트와 다릅니다.

저장·내보내기 검증: `MARINARA_REPO=/path/to/Marinara-Engine node test/storage-export.mjs`. 실제 Engine 함수를 메모리 fixture에서 실행해 평문 저장/삭제와 확장 ZIP 내보내기의 키 제외를 검사합니다. 서버 데이터나 실제 키를 읽지 않습니다.

자동 처리 복원 검증: 같은 환경변수로 `node test/reload-browser.cjs`. 저장 ON/OFF, 로드/켜기 이전 run 제외, 키 없음·Director 중복·다른 탭 차단 및 복원 중 중지 우선순위를 네트워크 차단 fixture에서 검사합니다.

위치 조작 검증: 같은 환경변수로 `node test/position-browser.cjs`. 실제 Chromium 마우스·390px 터치 입력으로 드래그/탭, 저장·복원·초기화, 회전·클램프, 본문 스크롤, Enter/Space를 검사합니다.

## 설치 (localhost 또는 원격 HTTPS)

1. 릴리스의 `SHA256SUMS`로 두 파일의 해시를 확인합니다(`sha256sum -c SHA256SUMS`). 원하면 ZIP 안의 소스를 먼저 읽어 보세요.
2. Marinara를 `localhost` 또는 원격 HTTPS 주소로 열고 `.env`의 `ENABLE_EXTERNAL_EXTENSIONS=true` 적용 여부를 확인합니다.
3. Settings → Advanced → Danger Zone에서 **Allow third-party extension imports**를 켭니다.
4. Addons → External Extensions에서 `marinara-pixai-illustrator-v0.1.4.zip`을 가져와 `full_page_access` 요청을 확인한 뒤 **Review and Run**을 승인합니다.
5. Danger Zone에서 **Allow custom Agent imports**를 켠 뒤 Agents → **Import agents**에서 `pixai-director.agent.json`을 선택합니다.
6. 에이전트가 Post-Processing, Context Injection, Add as Prompt Section OFF, 모든 능력과 도구 OFF인지 확인하고 대상 채팅에서 Enable Agents를 켭니다.
7. 🎨 패널에서 모델·LoRA·생성 옵션과 키를 입력하고, 자동 처리 OFF로 먼저 **저장**한 뒤 **진단 1: GET만**을 실행합니다.
8. 필요할 때만 비용 확인창에 동의해 **진단 2**를 한 번 실행합니다. 모델·LoRA 설정을 확인한 뒤 자동 처리를 켜고 저장합니다.
9. 실제 채팅 한 턴에서 이미지 1장 → 갤러리 → 메시지 첨부를 확인하고, 새로고침 뒤 첨부 유지와 비재생성을 확인합니다.

구버전 PixAI Director JSON은 가져오기 성공 후 “안전을 위해 번들된 함수 1개를 건너뛰었습니다”가 떠도 무해합니다. 이 파일에는 함수가 없으며 Marinara의 개수 계산 오탐입니다(0.1.4 파일은 빈 `functions` 목록으로 회피).

가져오기 UI나 항목 이름은 Marinara 버전에 따라 달라질 수 있습니다. [agent/IMPORT.ko.md](./agent/IMPORT.ko.md)도 참고하세요. 지원 범위는 **Web Locks를 제공하는 최신 localhost/HTTPS 브라우저 한 프로필·한 출처**입니다. 같은 서버를 다른 브라우저/기기/포트로 동시에 사용하지 마세요. 정확히 한 개의 `PixAI Director`를 가져와 이름을 유지합니다. 새로고침 시 저장된 자동 처리 ON/OFF를 복원하며, **시계가 동기화된 환경에서 로드 이전·다시 켜기 이전 run은 소급 처리하지 않습니다.** 저장된 ON은 키·단일 탭 잠금·Director 확인이 끝나야 실제 실행됩니다. 상태줄 OFF 옆에 설정 꺼짐/키 없음/잠금 대기/Director 확인 필요/활성 채팅 없음의 이유가 표시됩니다. 체크박스는 저장 설정, 상태줄은 실제 실행 가능 여부입니다.

🎨 버튼과 패널 헤더는 마우스·터치로 드래그해 옮길 수 있습니다(6px 미만은 클릭/탭, Enter/Space도 열기·닫기). 위치는 이동을 마칠 때 확장 저장소에 자동 저장·복원하며 **위치 초기화**로 되돌립니다. 버튼을 옮기면 패널을 버튼 근처에 다시 배치하고, 패널만 옮긴 위치는 유지합니다. 창 크기·모바일 회전 시 화면 안으로 보정하며 본문은 그대로 스크롤됩니다.

## 모델과 LoRA

`PIXAI_RATIO`는 패널과 같은 9종 허용 목록을 적용하며, 그 밖의 값은 저장된 기본 비율로 대체합니다(설정값도 유효하지 않으면 `2:3`). Agent 프롬프트의 목록도 동일합니다. 프롬프트와 네거티브는 각 2,000 UTF-16 코드 단위 이내에서 **코드포인트 경계**로 자릅니다. 경계에 걸린 이모지 서로게이트 쌍은 통째로 제외하며, 기본 네거티브·진단 요청에도 같은 상한을 적용합니다. 결합문자/ZWJ 묶음 전체 보존을 보장하는 grapheme 단위 처리는 아닙니다.

패널에는 Tsubaki.2, Haruka v2, Hoshino v2 프리셋과 사용자 지정 `modelVersionId` 입력이 있습니다. 모델 ID는 정밀도 손실을 피하도록 양의 정수 형태의 **문자열**로 보관하고 전송합니다.

### 모델·LoRA ID 찾는 법

PixAI API에는 모델·LoRA 목록이나 검색 기능이 없습니다. ID는 **pixai.art 웹사이트의 모델 페이지 주소**에서 직접 가져옵니다.

1. [pixai.art](https://pixai.art)에서 쓰고 싶은 모델이나 LoRA 페이지를 엽니다.
2. 원하는 버전을 고르면 주소가 `https://pixai.art/model/<모델ID>/<버전ID>` 꼴이 됩니다.
3. **마지막 숫자(버전 ID)**를 복사해 넣습니다. 앞의 모델 ID가 아닙니다.
   - 베이스 모델 → 패널의 *사용자 지정 modelVersionId*
   - LoRA → LoRA 행의 ID 칸, 가중치는 0~1

| 프리셋 | 버전 ID | 구조 |
|---|---|---|
| Tsubaki.2 | `1983308862240288769` | DiT |
| Haruka v2 | `1861558740588989558` | SDXL |
| Hoshino v2 | `1954632828118619567` | SDXL |

주의할 점(2026-10-05 기준):
- 공식 API 문서에 올라온 베이스 모델은 위 세 개뿐입니다. 사이트에 있는 다른 모델은 API가 거부할 수 있습니다. 예를 들어 Tsubaki.3(2026-09-16 공개)은 버전 ID를 넣으면 `HTTP 422`로 거부됐습니다.
- LoRA는 **베이스 모델과 구조가 맞아야** 합니다. SDXL용 LoRA를 DiT 모델(Tsubaki.2)에 걸면 무시되거나 거부될 수 있습니다. LoRA 페이지에 적힌 베이스 모델을 확인하세요.
- API 키는 [PixAI 개발자 플랫폼](https://platform.pixai.art)에서 발급합니다.

LoRA는 행을 추가하거나 삭제해 설정합니다. PixAI 공식 요청 스키마에 맞춰 다음 제약을 적용합니다.

근거(2026-10-02 확인): [Create Image v2](https://platform.pixai.art/en/docs/api-v2/image/createImage), [모델 목록](https://platform.pixai.art/en/docs/references/models). 요청은 `loras: [{modelId: "LoRA버전ID", weight: 0.7}]` 형태입니다. `id`나 `modelVersionId`가 LoRA 항목 키인 것은 아닙니다.

- 최대 5개
- `modelId`: LoRA의 **VERSION ID**를 담는 양의 정수 문자열
- `weight`: 숫자 `0` 이상 `1` 이하
- 같은 `modelId` 중복 불가

모델 선택, LoRA 목록, 비율, 크기, 모드, 프롬프트 도우미, 기본 네거티브 프롬프트, 자동 처리 설정과 처리된 run ID는 `marinara.storage`에 저장됩니다. API 키도 기본으로 여기에 기억하며, 패널 로드 시 자동으로 채웁니다. 기억 옵션을 끄고 저장하면 서버의 키 값은 비워지고 현재 실행의 메모리에서만 사용합니다. 새로고침 시 저장된 ON/OFF를 따르되 키가 없으면 자동 실행하지 않습니다. 키/Director 문제를 해결한 뒤 켜고 저장하면 그 시점부터 새 run만 처리합니다.

## 비용과 진단

PixAI 과금 단위는 “크레딧 1개”라고 단정하지 않습니다. 생성 요청은 **IMAGE 1장**을 청구하며 실제 크레딧 비용은 계정·모델·모드 등 PixAI 정책에 따라 달라질 수 있습니다. `batchSize`는 1로 고정되어 있습니다.

- 진단 1은 존재하지 않는 task를 조회하는 GET이며 이미지 생성을 요청하지 않습니다.
- 자동 처리·진단 생성 모두 생성 전에 `GET /v2/task/0`으로 결과 조회 접근을 확인합니다. Authorization 헤더로 실제 조회와 같은 프리플라이트를 유발하며, 404/401 등 읽을 수 있는 HTTP 응답은 CORS가 열렸다는 뜻일 뿐 키 유효성·서비스 정상 여부를 보장하지 않습니다. 네트워크/CORS 오류나 시간 초과면 create를 보내지 않고 패널에 원인을 표시합니다.
- 진단 1과 생성 전 확인은 성공/실패 결과를 **현재 확장 실행 세션 메모리**에 공유합니다. 연결·키를 고친 뒤에는 새로고침하거나 확장을 다시 실행해 캐시를 갱신하세요. 저장소에는 기록하지 않습니다.
- 진단 2는 실제 IMAGE 1장을 생성하고 다운로드하므로 비용이 발생합니다.
- 진단 2를 반복하거나 실제 턴을 다시 생성하면 매번 추가 비용이 발생할 수 있습니다.

2026-10-02 CORS 통과 보고는 모든 Origin에 대한 보장이 아닙니다. 2026-10-05 원격 도메인 실측 보고에서 v1 task/media 프리플라이트 차단과 v2 task·CDN 접근 가능이 확인되어 v2 우선으로 변경했습니다. 이 보고 수용과 오프라인 fixture 검증은 v0.1.4 실제 원격 통합 실행 증거와 구분합니다.

## 권한과 보안 경계

확장은 매니페스트에서 `full_page_access`를 요청합니다. 이는 샌드박스 없는 넓은 권한이므로 가져오기 전에 전체 소스와 해시를 검토해야 합니다. 확장은 다음 범위에 접근합니다.

- 활성 Marinara 페이지의 DOM, `localStorage`, 구버전 키 삭제만을 위한 `sessionStorage`
- Marinara의 동일 출처 에이전트 run, 메시지, 갤러리 API
- `https://api.pixai.art`와 허용된 HTTPS 이미지 호스트 (`d2doj8oszwtcqy.cloudfront.net`)
- Marinara 확장 저장소 `marinara.storage`

에이전트 패키지는 privileged capability와 도구를 요청하지 않습니다. 다만 활성화하면 선택된 AI 연결로 일반 LLM 요청이 발생하며, 구성상 채팅 기록과 캐릭터 컨텍스트를 읽습니다.

Marinara 변경 요청에는 `x-marinara-csrf: 1`을 보냅니다. 인수 확인 기록상 이 원본 상수는 2.4.4의 `shared/src/constants/security.ts`와 2.4.6의 `shared/dist/constants/security.js`에 있습니다. 이 값은 공개된 **presence marker**이며 토큰 교환이나 비밀 인증값이 아닙니다. 브라우저의 Origin 신뢰 판단은 별도의 보안 경계입니다.

## 개인정보와 저장 위치

| 데이터 | 위치/전송 | 삭제·주의 |
|---|---|---|
| PixAI API 키 | 기본은 서버 측 `marinara.storage`에 평문 저장, 사용 중 JS 메모리 | 데이터 폴더 접근 가능자는 키를 볼 수 있습니다. Marinara 서버에 접속할 수 있는 사람·프로그램은 확장 저장소 API(`GET /api/personal-extensions/:id/storage`)로 키를 읽을 수 있습니다. 기억을 끄고 저장하거나 **저장된 키 삭제**를 누르십시오. 브라우저 사이트 데이터 삭제만으로 서버 키가 지워지지 않습니다. |
| 모델·LoRA·생성 설정 | `marinara.storage` | 확장 제거 전 설정 초기화 기능은 없습니다. Marinara의 확장 데이터 삭제 절차를 함께 확인하십시오. |
| 처리된 run ID | `marinara.storage`, 최근 최대 500개 및 실행 세션 메모리 | 기준 재설정은 자동 처리를 끄고 과거 run을 제외하며 재생성하지 않습니다. |
| 활성 채팅 ID | 기존 `localStorage["marinara-active-chat-id"]`를 읽기만 함 | Marinara 내부 키이며 버전 변경 시 동작이 깨질 수 있습니다. |
| 프롬프트·네거티브·비율 | PixAI API로 전송 | 채팅/캐릭터에서 파생된 내용이 외부 서비스로 나갈 수 있으므로 민감정보를 넣지 마십시오. |
| 생성 이미지 | PixAI/CDN에서 다운로드 후 Marinara 갤러리와 메시지 첨부에 저장 | PixAI와 Marinara 양쪽의 보관·삭제 정책을 확인하십시오. |
| 에이전트 컨텍스트 | 사용자가 선택한 AI 연결로 전송 가능 | 채팅 기록과 캐릭터 정보가 포함될 수 있습니다. |

**확장 저장소는 암호화하지 않는 JSON 저장소입니다.** 서버 데이터 폴더와 그 백업에 접근 가능한 사람은 키를 볼 수 있습니다. Marinara 서버에 접속할 수 있는 사람·프로그램은 확장 저장소 API(`GET /api/personal-extensions/:id/storage`)로 키를 읽을 수 있습니다. 네이티브 PixAI 연결(업스트림 PR 예정)은 암호화 저장을 사용하지만 이 확장은 그 암호화 API를 사용할 수 없습니다. `full_page_access`, 같은 출처의 코드, 브라우저 확장, 개발자 도구, 침해된 페이지로부터 키를 격리하지 않습니다.

키는 로그·오류 메시지·확장 소스 ZIP 내보내기에 포함하지 않습니다. 단, 서버 전체 데이터/설정 백업은 평문 저장소를 포함할 수 있으므로 비밀 자료로 취급하세요. 구버전 `sessionStorage` 옵션은 제거했고, 이전 탭 키는 로드/비활성화 시 삭제하며 서버로 자동 이전하지 않습니다. 저장된 키 삭제는 현재 저장소 값을 빈 문자열로 덮어쓰며 과거 백업이나 이미 열린 다른 탭의 메모리까지 지우지는 않습니다. 다른 탭도 닫으세요.

## 제거

확장을 비활성화하면 해당 실행의 메모리 키와 구버전 탭 키를 지웁니다. 기억한 서버 키는 재사용을 위해 남습니다. 제거 전에 명시적으로 키를 삭제하세요. 저장/삭제 실패는 패널에 표시되며 성공으로 처리하지 않습니다. 진행 중 작업이 있으면 완료 후 키를 삭제하세요.

1. 먼저 🎨 패널에서 자동 처리를 끄고 저장합니다.
2. **저장된 키 삭제**를 누르고 성공 표시를 확인합니다(키 입력·기억 옵션·자동 처리도 OFF). 또는 API 키 기억 옵션을 끄고 저장합니다.
3. 대상 채팅에서 PixAI Director를 비활성화하고, Agents에서 가져온 에이전트를 삭제합니다.
4. Addons → External Extensions에서 PixAI Illustrator Bridge를 중지·제거합니다.
5. 남은 `marinara.storage` 데이터, 생성된 갤러리 이미지와 메시지 첨부는 사용 중인 Marinara 버전이 제공하는 데이터 관리 절차를 확인해 별도로 삭제합니다.

확장 제거만으로 PixAI 측 작업·이미지, Marinara 갤러리 파일, 메시지 첨부 또는 브라우저 사이트 데이터가 모두 삭제된다고 보장하지 않습니다.

## 알려진 제한

- v2 조회 경로는 PixAI 문서에 없는 경로라 바뀔 수 있습니다 → 실제 task 조회의 **HTTP 404에서만 v1 폴백**합니다. 401/429/5xx·네트워크/CORS 오류에서는 폴백하지 않습니다. v1 폴백은 도메인 Origin에서 다시 차단될 수 있습니다.
- 사전 확인용 task 0의 404는 없는 task와 없어진 경로를 구분하지 못합니다. 세션 중 정책 변경·실제 task 조회·다운로드 실패까지 미리 보장하는 안전장치는 아닙니다. 다운로드는 `mediaUrls` CDN 우선이며, v1 media 폴백 실패에는 도메인 Origin 제한 가능성을 표시합니다.

- **자동 처리 중지·기준 재설정**은 busy 중에도 메모리상 OFF를 즉시 적용하고 저장만 큐로 처리합니다. 이미 시작한 1건은 첨부까지 계속할 수 있지만 같은 poll의 나머지 후보는 시작하지 않습니다. 저장 완료 대기 중 중지되면 유료 호출 전에 다시 확인합니다. 저장 실패나 이전 쓰기 완료가 중지를 취소하지 않습니다. 진행 중 요청도 끊으려면 확장을 비활성화하세요(이미 접수된 과금 취소는 보장하지 않음).

- **브라우저와 Marinara 서버의 시계 동기화가 전제입니다.** 오래된 run 제외는 클라이언트 활성화 시각과 서버 run 시각 비교이며, 원격 서버 시계가 앞서면 켜기 전 run 처리, 뒤처지면 새 run 누락 가능성이 있습니다. 0.1.4는 원격 도메인의 CORS 경로만 개선하며 시계 오차 보정·서버 기준선은 포함하지 않습니다. 저장 요청은 직렬화됩니다.
- 첨부 병합 전 메시지 전체 목록을 읽습니다. 단순 `limit` 추가는 오래된 대상 메시지 누락 위험이 있어 이번 수정에서는 하지 않았습니다. 커서 탐색은 별도 성능 개선 대상으로 남깁니다.

- 같은 출처·브라우저에서는 Web Lock으로 한 탭만 유료 작업을 실행합니다. 다른 브라우저/기기/출처는 잠금을 공유하지 않으므로 동시 사용은 지원하지 않습니다. 다른 탭을 닫은 뒤 사용할 탭을 새로고침하세요.
- run ID는 유료 생성 호출 **전에** 처리 완료로 표시됩니다. 이후 생성·다운로드·갤러리·첨부가 실패하면 중복 과금은 줄이지만 그 run의 작업은 유실되며 자동 재시도되지 않습니다.
- 첨부 배열은 읽은 뒤 전체 배열을 다시 쓰는 방식입니다. 동시에 다른 첨부 쓰기가 일어나면 마지막 쓰기가 앞선 변경을 덮는 lost-update가 생길 수 있습니다.
- 현재 활성 채팅만 4초마다 폴링합니다. 자동 처리 활성화 시각 이후의 run만 받으며, 연결된 `agentConfigId`가 일치해야 합니다. 꺼져 있던 동안의 결과·다른 채팅의 과거 결과는 소급 처리하지 않습니다.
- 비활성화는 요청 abort와 후속 단계 중지를 시도하지만 이미 서버가 받은 생성의 과금 취소는 보장하지 않습니다. POST 오류/타임아웃을 자동 재시도하지 않습니다.
- 이미지 다운로드는 HTTPS 호스트·래스터 MIME·20 MiB 한도를 검사하고 리다이렉트를 거부합니다. CDN 호스트가 바뀌거나 인증 media 경로가 리다이렉트하면 안전하게 중단됩니다.
- 즉시 미리보기는 DOM에 임시 삽입합니다. 정식 첨부 표시는 새로고침이나 채팅 재진입 뒤 확인해야 합니다.
- 참조 이미지, 배경 전용 처리, 셀피 명령 연동은 구현하지 않았습니다.
- 오프라인 단위/브라우저 fixture와 에이전트 스키마 검사는 실제 Marinara 가져오기, 실제 한 턴, 실제 PixAI 비용·응답, 장기 실행 또는 보안 승인을 대신하지 않습니다.

## 검증 기록

- 실제 Marinara 2.4.6(staging)에서 확장·에이전트 가져오기와 RP 턴 삽화 생성·메시지 첨부를 사용자가 확인했습니다(v0.1.2, 2026-10-05). v0.1.3 변경분은 오프라인 테스트와 독립 검토로 확인했습니다.
- 독립 보안 검토를 통과했습니다(키 저장·노출 경로, 다운로드 호스트, 중복 과금 방지).
- v0.1.4는 오프라인 회귀 검증 대상이며, 변경분 독립 검토와 사용자 원격 실측은 별도입니다. 이 버전 작업에서는 실제 생성·배포를 수행하지 않습니다.

## 라이선스

Copyright (c) 2026 mallang0723

GNU Affero General Public License v3.0으로 배포합니다. 전문은 [LICENSE](./LICENSE), 외부 서비스·상표 고지는 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 보세요. PixAI와 Marinara Engine의 공식 배포물이 아닙니다.

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

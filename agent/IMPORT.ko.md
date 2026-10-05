# PixAI Director — 별도 Agent 가져오기

`pixai-director.agent.json`은 Marinara **Agents** 패널로 가져오는 단일 JSON 패키지입니다. Personal Extension ZIP이 아니며, 공식 Download Agents 카탈로그용 capability package도 아닙니다. 확장 ZIP과 별도로 배포하고 이 JSON만 선택하세요.

## UI 절차 (현재 로컬 소스 기준)

1. **Settings → Advanced → Danger Zone → Allow custom Agent imports**를 켭니다. 외부 Agent 실행을 허용하는 보안 설정이므로 내용을 검토하고 결정하세요. `.env` 수정은 필요 없습니다.
2. **Agents** 패널의 **Import agents** 버튼을 누릅니다. **Download Agents**, **Import agent folder**, Personal Extensions 가져오기를 선택하지 않습니다.
3. `pixai-director.agent.json` 파일을 선택합니다.
4. **Review Agent Import Permissions**에서 이름 `PixAI Director`, phase `post_processing`을 확인합니다. **Requested permissions**에는 **This Agent does not request any privileged capabilities.**가 나와야 합니다.
5. **Approve Permissions and Import**를 누릅니다. 권한을 추가할 필요는 없습니다.
6. **Custom Agents → PixAI Director**를 열고 **Pipeline Phase: Post-Processing**, **Result Type: Context Injection**, 모든 **Custom Agent Abilities** OFF, **Add as Prompt Section** OFF인지 확인합니다. **Tools / Function Calling**에서도 도구를 선택하지 마세요.
7. 사용을 원할 때만 대상 채팅의 **Chat Settings → Enable Agents**를 켜고 **Custom Agents**에서 `PixAI Director`를 추가합니다. Agent는 채팅의 AI 연결을 사용합니다. 라이브러리 가져오기 자체가 실행을 시작하지는 않습니다.

외부 Agent 허용 토글을 다시 끄면 가져온 Agent의 실행도 차단됩니다. 중복 가져오기는 기존 Agent를 갱신하지 않고 새로운 custom identity를 만듭니다.

## 설정과 범위

- 동봉된 `../agent-prompt.txt`와 동일한 내용을 JSON 문자열에 담았습니다. 출력은 `PIXAI_PROMPT`, `PIXAI_NEGATIVE`, `PIXAI_RATIO` 또는 `SKIP`입니다. 0.1.1에서 비율 9종과 필드별 2,000자 제한 안내를 통일했습니다.
- `phase: post_processing`, `resultType: context_injection`, `injectAsSection: false`를 명시했습니다.
- 현재 로컬 스키마의 15개 능력을 모두 false로 지정했습니다. `enabledTools`는 빈 배열이며 실제 import 정규화 과정에서 제거됩니다. 다른 단계의 결과 읽기도 껐습니다.
- 프롬프트의 캐릭터 외형 지침을 지원하도록 읽기용 컨텍스트는 `chatHistory`, `characters`만 켰습니다. 이 설정은 privileged abilities와 별개이며 나머지 컨텍스트 소스는 껐습니다.
- API 연결 ID, 이미지 경로, PixAI 키, 실행 코드 및 함수 정의를 포함하지 않습니다. 별도 확장 없이 이 Agent 자체는 이미지를 생성하지 않습니다. 채팅에서 실행하면 선택된 AI 연결에 일반적인 LLM 요청은 발생할 수 있습니다.

## 오프라인 검증

기존 의존성이 있는 Marinara-Engine 체크아웃과 Node가 필요합니다. 새 설치는 하지 않습니다. `agent/`의 부모 폴더에서:

```sh
node agent/validate-agent.mjs /path/to/Marinara-Engine
```

검증기는 기존 esbuild로 실제 체크아웃의 import 유틸리티와 Zod 스키마를 메모리에서 묶어 실행합니다. 앱 서버, 브라우저, 확장 및 PixAI를 실행하지 않고 앱 파일/데이터도 쓰지 않습니다. 실제 `getFolderImportEntries`, `normalizeAgentImportEntry`, `createAgentConfigSchema`, `importAgentConfigSchema`를 검사하며 요청 권한 0개, 모든 능력 OFF, 원본 프롬프트 일치 및 잘못된 입력 거부를 확인합니다. 전체 앱에서의 실행/확장 연동 검증을 의미하지 않습니다.

## 형식 근거

공식 저장소의 README, `packages/director/manifest.json`, `packages/director/agents.json`을 확인했습니다. 공식 카탈로그는 `schemaVersion`, `entrypoints`, 파일 해시와 permissions를 가진 capability package이며, 수동 사용자 Agent 가져오기와 다른 형식입니다. 이 파일은 로컬 Engine의 `marinara.agent` / `version: 1` / `config` 전송 형식을 사용합니다.

- https://github.com/Pasta-Devs/Marinara-Agents
- https://github.com/Pasta-Devs/Marinara-Agents/blob/main/packages/director/manifest.json
- https://github.com/Pasta-Devs/Marinara-Agents/blob/main/packages/director/agents.json
- Engine: `packages/client/src/lib/agent-transfer.ts`
- Engine: `packages/shared/src/schemas/agent.schema.ts`
- Engine: `packages/shared/src/types/agent.ts`
- Engine: `packages/client/src/components/panels/AgentsPanel.tsx`
- Engine: `docs/agents/custom-agents.md`

## 리비전 이력

| 날짜 | 변경 |
|---|---|
| 2026-10-02 | 수동 Agent 패키지·검증 안내 (유지관리자) |
| 2026-10-02 | 비율·길이 안내 갱신 |
| 2026-10-05 | v0.1.2 실사용 성공 보고 반영 |

# MANUAL.ko.md 스크린샷 촬영 목록

`docs/MANUAL.ko.md`가 참조하는 그림 목록입니다. 파일은 이 폴더(`docs/images/manual/`)에 둡니다.

## 공통 규칙

- **API 키는 반드시 가립니다.** 입력칸은 `password` 형식이라 점으로 보이지만, 붙여넣기 직후·자동완성 팝업·브라우저 키 저장 제안 팝업이 뜬 상태는 찍지 않습니다.
- **개인 대화 내용은 찍지 않습니다.** 합성(가상) **성인** 테스트 캐릭터와 격리된 테스트 채팅만 사용합니다. 예외: `real-profile-card.png`의 공개 배포 커뮤니티 도우미 캐릭터 "작햄띠니".
- 작업 영수증의 operation ID·task ID·gallery ID, 캐릭터 ID는 테스트용이면 보여도 됩니다. 실사용 계정이면 가립니다.
- 폭: **iPhone 단계는 모바일 폭 390px**(실기기 또는 브라우저 기기 에뮬레이션), 나머지는 데스크톱(폭 1280px 이상). 패널 자체는 어느 쪽이든 최대 360px입니다.
- 로그 시각은 UTC로 찍힙니다. 그대로 두세요.
- 21·23은 실제 브라우저 확인창만 촬영하고 **취소**했습니다. 24는 확인창이 없어서 **미촬영**입니다. 실제 PixAI 호출·LLM 생성은 하지 않았습니다.
- 390px은 Chromium 에뮬레이션이며 Safari 실기기 검증이 아닙니다. 07은 데스크톱 설정 창 크롭, 21·23은 격리 가상 디스플레이의 실제 Chromium 확인창 크롭입니다.

## 목록

| 파일 | 화면·도달 경로 | 최종 판정 |
|---|---|---|
| `01-danger-zone-extension-imports.png` | Settings › Advanced › Danger Zone › Allow third-party extension imports | 촬영 완료, 390px |
| `02-danger-zone-agent-imports.png` | 같은 화면 › Allow custom Agent imports ON | 촬영 완료, 390px |
| `03-external-extensions-import.png` | Addons › External Extensions › Import Extension File | 촬영 완료, 390px. OS 파일 선택창 제외 |
| `04-extension-enabled.png` | ZIP 가져오기·승인·새로고침 후 목록 | 촬영 완료, 0.2.0 Enabled·Full page access |
| `05-agent-import-review.png` | Agents › Import agents › Choose Files › JSON | 촬영 완료, 데스크톱 권한 검토 |
| `06-director-agent-settings.png` | Custom Agents › PixAI Director › Pipeline Phase | 촬영 완료, Post-Processing·능력 상단 |
| `06b-director-result-type.png` | 같은 편집 화면 › Result Type | 추가 촬영, Context Injection |
| `06c-director-prompt-section.png` | 같은 편집 화면 › Add as Prompt Section | 추가 촬영, Disabled·Tools 0개 |
| `07-chat-enable-agents.png` | Conversation › Chat Settings › Agents › Custom Agents › Director › Add | 촬영 완료, 데스크톱 창 크롭. 실제 저장 metadata enableAgents=true·활성 Director 1개 |
| `08-github-manager-package-pick.png` | GitHub 확장 관리 › 저장소 주소 입력 | 촬영 완료, 390px. 승격 후 선택지는 아직 확인 중이므로 주소 입력 단계만 수록 |
| `09-palette-and-status.png` | 테스트 채팅 › 🎨 | 촬영 완료, OFF·가짜 키·chat ✓ |
| `10-panel-key.png` | 패널 상단 | 촬영 완료, 가짜 키 password 마스킹 |
| `11-panel-model-lora.png` | 모델 아래 LoRA 행 추가 | 촬영 완료, 비어 있는 예시 행은 촬영 후 삭제 |
| `12-panel-grid-negative.png` | ratio/size/mode/promptHelper·negative | 촬영 완료 |
| `13-style-details.png` | 화풍·PixAI style 펼침 | 촬영 완료 |
| `14-profiles-closed.png` | 캐릭터·페르소나 프로필 접힘 | 촬영 완료 |
| `15-persona-section.png` | 현재 채팅 프로필 읽기 후 페르소나 영역 | 촬영 완료, 테스트 채팅은 페르소나 없음 |
| `16-selfie-recent-checkboxes.png` | 셀피 대체·최근 대화 체크박스 | 촬영 완료 |
| `17-preview-target-filled.png` | 프로필 읽기 후 대상 선택 | 촬영 완료, 합성 성인 하린 |
| `18-free-preview-output.png` | 무료 미리보기 | 촬영 완료. 긴 결과 상자의 일부는 내부 스크롤 |
| `19-receipt-section.png` | 작업 영수증 펼침 | 촬영 완료, 무과금 QA이므로 실제 유료 작업 행 없음 |
| `20-bottom-controls.png` | 패널 하단 | 촬영 완료 |
| `21-diag2-confirm.png` | 진단 2 클릭 직후 | 실제 Chromium 확인창 크롭, 촬영 후 취소 |
| `22-emergency-stop-log.png` | 전체 긴급 중지 | 촬영 완료, 실제 중지 로그 |
| `23-selfie-confirm.png` | 셀피 대체 ON 후 테스트 채팅의 정확한 selfie POST | 실제 Chromium 확인창 크롭, 촬영 후 취소 |
| `24-auto-illustration-attached.png` | 자동 삽화 완성 | **미촬영**. 확인창이 없으므로 과금 금지 조건 아래 실행 불가. 본문의 깨진 이미지 참조는 제거 |
| `real-profile-card.png` | 제공된 공개 도우미 캐릭터 프로필 | 기존 이미지 사용, 공개 캐릭터 노출 승인 |
| `real-diag1-http400.png` | 제공된 실기기 진단 1 결과 | 기존 이미지 사용, 이번 QA의 실호출 아님 |
| `real-diag2-success.png` | 제공된 실기기 진단 2 결과 | 기존 이미지 사용, 이번 QA의 실생성 아님 |
| `real-preview-empty-target.png` | 제공된 대상 미선택 오류 | **패널만 348×431로 크롭**, 왼쪽 개인 대화 제거 |

## 리비전 이력

| 날짜 | 변경 |
|---|---|
| 2026-10-14 | 최초 작성 (MANUAL.ko.md v0.2.0 기준, 실사 4장 반영) |
| 2026-10-14 | 촬영 결과·무과금 예외·크롭 기록 |

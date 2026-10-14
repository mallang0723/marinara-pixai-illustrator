# 사용 설명서 0.2.0 QA 기록

2026-10-14 · 문서·촬영 범위. 제품 JS/CSS·버전·배포 ZIP은 변경하지 않았습니다.

## 환경과 비용 경계

- Engine 2.4.6, build `2.4.6+9d3d6154d251`, 별도 빈 DATA_DIR·테스트 env·별도 Chromium 프로필.
- 합성 성인 캐릭터(28세)와 새 Conversation 채팅, 연결 없음·개인 대화 없음. 키는 가짜이며 화면에서 password 마스킹했습니다.
- 일반 화면: headless Chromium, 모바일 폭 390px 또는 데스크톱 1440px. 실제 확인창: 격리 Xvfb의 headed Chromium에서 창을 촬영·크롭했습니다. 호스트의 사용자 데스크톱을 촬영하지 않았습니다.
- 진단 2·셀피 확인창은 실제 native `confirm`이며 둘 다 취소했습니다. 해당 실행의 차단 라우트에 도착한 PixAI 요청도 **0건**입니다. 실제 생성·LLM 요청·갤러리 업로드는 실행하지 않았습니다.
- 기존 `real-` 이미지의 실기기 성공은 제공받은 근거입니다. 이번 QA의 실생성 결과가 아닙니다.

## 확인 범위

| 항목 | 근거와 판정 |
|---|---|
| 1. 설정 경로·잠금 | 실제 모바일 More › Settings, Advanced › Danger Zone 확인. 서버 `ENABLE_EXTERNAL_EXTENSIONS=true` 없이 확장 토글 비활성 관측 |
| 2. ZIP 설치·정확한 코드 승인 | 실제 Import Extension File → 비활성 초안 → Enable → Run Exact Code → 팔레트 표시 |
| 3. ZIP 재가져오기 중복 | 실제 확인창에서 Save Disabled Update 후 같은 ID의 설치본 1개. **동일 ZIP/해시라 활성 상태는 유지**됨. 변경 코드 업데이트와 구별 |
| 4. Director 가져오기 | Import agents → Choose Files → JSON → Review Agent Import Permissions → Approve Permissions and Import |
| 5. Director 설정 | 실제 편집 화면에서 Post-Processing·Context Injection·Add as Prompt Section Disabled·Tools 0/17 확인. JSON과 대조 |
| 6. 채팅에 추가 | Conversation › Agents › Custom Agents › PixAI Director › Add. 실제 metadata `enableAgents=true`, `activeAgentIds` 1개. 별도 Enable Agents 토글 없음 |
| 7. 프로필·무료 미리보기 | 실제 캐릭터 조회 후 대상 채워짐, prompt/negative/loras/truncated/warnings/portions 결과 확인. 페르소나 없는 상태 촬영 |
| 8. 최근 대화 OFF의 context | 실제 설치본에 OFF 상태로 `previewOnly:true` + 200자 넘는 합성 context 요청. **앞 200자 포함·201번째 제외**, PixAI 요청 0건 |
| 9. 비용 확인창 | 진단 2·셀피 실제 native 확인창 촬영 후 취소. 자동 삽화에는 확인창 없음(`extension.js` coordinate 호출 경로 대조) |
| 10. 저장·중지·UTC | 패널 저장·전체 긴급 중지 실행, 실제 로그 확인. 자동 처리 저장 버튼과 busy 차단은 `extension.js:1317` 이후, UTC는 `extension.js:194` 대조 |
| 11. GitHub 관리자 | 1.0.1 실제 가져오기·활성화·공개 주소 검색 재실행. 승격 전에는 첫 선택지 0.1.4. 설명서는 요청대로 **0.2.0 Latest 승격 후 기준**, 우회 설치 지시 없음. 그림 08은 실제 주소 입력 단계만 수록. 설치·업데이트 검증은 앞선 동일 기준선 QA 기록 참조 |
| 12. 실기기·실생성 | **확인 중 유지**: Latest 승격 후 첫 선택지, iPhone Safari/원격 HTTPS 실패, 셀피/자동 삽화 실생성·갤러리·새로고침 유지. 무료 preview·코드 확인으로 성공을 대신 주장하지 않음 |

## 개인정보 수정 후보

`extension.js:655–663`은 요청 `context`를 무조건 추가한 뒤, 최근 대화 옵션 ON일 때만 메시지 조회를 추가합니다. `extension.js:720–723`에서 각각 200자 제한을 적용합니다. 따라서 옵션 OFF가 모든 대화 관련 전송을 차단하지 않습니다.

**0.2.1 후보:** 최근 메시지 조회와 요청 context의 동의 경계를 일치시킬지, 별도 명시적 옵션으로 분리할지 결정해야 합니다. 이번 작업은 이 예외를 설명서 5-7·7-3·알려진 제한과 README에 명시했을 뿐 제품 코드를 고치지 않았습니다. 실제 PixAI 전송을 실행하지 않고 공통 composer의 무료 preview 결과로 확인했습니다.

## 이미지 판정

- 원안 번호 01~23: 23장. 06의 아래 설정을 보여 주는 보충 2장 포함 **신규 25장**.
- 기존 제공 이미지 4장 포함 **총 29장, 2,080,196 bytes**. 신규분 2,007,795 bytes.
- 24 자동 삽화 완성은 **미촬영**: 확인창이 없어 비용 금지 조건과 충돌. 성공 화면을 합성하지 않고 본문의 이미지 참조를 제거했습니다.
- 03의 OS 파일 선택창, 08의 승격 후 선택지, 19의 실제 유료 작업 행은 촬영하지 않았습니다. 각 캡션·SHOTLIST에 범위를 명시했습니다.
- 개인 채팅이 있던 `real-preview-empty-target.png`는 패널만 **348×431**로 크롭했습니다.
- 전체 이미지 contact sheet를 육안 확인했고, 본문의 로컬 이미지 링크는 모두 존재합니다.

## 검증

- `MARINARA_REPO=<Engine 경로> node --test test/*.test.cjs`: **106 통과 / 실패 0**.
- 번호 슬롯 집계: 01~23 존재, 24만 의도적 제외. 본문 이미지 참조 누락 0건.
- `git diff --check` 통과. 기존 배포 artifact는 재빌드하지 않았습니다.
- push·태그·Release 상태 변경 없음.

## 리비전 이력

| 날짜 | 변경 |
|---|---|
| 2026-10-14 | 촬영·정정·무과금 QA 근거 기록 |

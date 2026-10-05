# 제3자 고지 및 provenance

대상 버전: `0.1.3`

이 문서는 법률 자문이 아닙니다.

## 저작권과 라이선스

Copyright (c) 2026 mallang0723. 이 프로젝트의 코드와 문서는 저작권자가 AI 도구를 사용해 작성했으며, GNU Affero General Public License v3.0을 적용합니다. [`LICENSE`](./LICENSE)는 Free Software Foundation이 배포한 AGPLv3 전문입니다.

## 외부 서비스와 상표

### PixAI

확장은 사용자가 제공한 인증 정보로 PixAI API와 PixAI가 반환한 이미지 호스트에 접속합니다. PixAI 코드, 모델 가중치, 이미지 또는 API 키를 이 프로젝트에 번들하지 않습니다. Tsubaki.2, Haruka v2, Hoshino v2 이름과 ID는 사용자가 선택할 API 모델 식별자로만 표시됩니다.

PixAI 및 관련 이름·상표는 각 권리자에게 귀속됩니다. 이 프로젝트는 PixAI의 공식 배포물 또는 보증된 통합이라고 주장하지 않습니다. 사용자는 공개 전 최신 PixAI 약관, API 정책, 요금, 콘텐츠 및 개인정보 정책을 별도로 확인해야 합니다.

### Marinara Engine

이 프로젝트는 Marinara Engine의 personal extension 및 custom agent 가져오기 형식을 대상으로 하지만 Marinara Engine 자체를 번들하지 않습니다. Marinara 및 관련 이름·상표는 각 권리자에게 귀속됩니다. Marinara 2.4.6(staging)에서 가져오기와 한 턴 동작을 확인했습니다(2026-10-05). 이후 버전 호환은 보장하지 않습니다.

에이전트 자료는 [`agent/`](./agent/)에서 수동 작성한 가져오기 패키지입니다. Professor Mari가 생성하거나 내보낸 패키지가 아니며, Professor Mari의 코드나 에이전트 패키지를 포함한다고 주장하지 않습니다.

## 개발·검사 도구

배포물에는 `node_modules`나 제3자 라이브러리 소스 사본을 포함할 계획이 없습니다.

- `test/offline.test.cjs`는 Node.js 내장 모듈을 사용합니다.
- `test/browser-test.cjs`는 사용자가 별도로 보유한 Marinara 체크아웃의 `@playwright/test`와 Chromium을 찾도록 작성되었으며, 이를 번들하지 않습니다.
- `agent/validate-agent.mjs`는 사용자가 별도로 보유한 Marinara 체크아웃의 `esbuild`와 Marinara 스키마/가져오기 코드를 메모리에서 사용하며, 이를 번들하지 않습니다.

이 도구들의 존재는 해당 외부 프로젝트의 라이선스가 이 프로젝트에 자동으로 포함되었다는 뜻이 아닙니다. 최종 ZIP에 제3자 코드를 새로 넣으면 배포 전에 해당 라이선스와 고지를 다시 조사해야 합니다.


## 리비전 이력

| 날짜 | 대상 | 변경 |
|---|---|---|
| 2026-10-02 | 라이선스 | AGPLv3 전문의 복사 출처와 소유자 승인 필요성을 기록 |
| 2026-10-02 | 제3자 | PixAI, Marinara, 수동 작성 에이전트 및 검사 도구의 번들 범위를 구분 |
| 2026-10-02 | 미확정 사항 | 이름·저작권·정책·빌드·런타임·보안·공개 승인 게이트를 공개 전 확인 사항으로 기록 |
| 2026-10-02 | 정리 | 개인 경로 제거·빌드 상태 정정 (유지관리자) |
| 2026-10-02 | 공개본 | 내부 운영 이름 일반화 |
| 2026-10-02 | 버전 | 0.1.2 후보로 갱신 |
| 2026-10-05 | 공개본 | 저작권자 확정(mallang0723), 미확정 사항 정리, 0.1.3 갱신 |

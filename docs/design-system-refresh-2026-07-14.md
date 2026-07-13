# 보드게임 아틀리에 디자인 리프레시

## 1. Intent brief

- **대상:** 친구들과 방을 만들고, 게임을 고르고, 짧은 보드게임을 반복해서 플레이하는 사용자
- **핵심 과업:** 로비에서 게임의 성격과 인원 조건을 빠르게 파악하고, 플레이 중 현재 차례·가능 행동·점수를 한눈에 읽는다.
- **감정 목표:** 차가운 게임 포털보다 잘 관리된 보드게임 공방의 실제 테이블에 앉은 느낌
- **제약:** 기존 다크 테마와 게임 로직을 유지하고, 한글 가독성·키보드 포커스·360px 터치 조작을 보장한다.

## 2. Direction proposals

1. **클럽 에디토리얼:** 큰 제목, 종이 라벨, 차분한 여백. 탐색은 좋지만 플레이 도구의 물성이 약하다.
2. **디지털 네온 테이블:** 강한 발광과 유리 패널. 실시간 상태는 선명하지만 장시간 플레이에 피로하고 기존 목재 톤과 충돌한다.
3. **피지컬 크래프트 테이블:** 월넛, 녹색 펠트, 황동, 에나멜 타일. 게임마다 다른 부품을 품으면서도 하나의 장소로 묶인다.

선택은 **3번을 기반으로 1번의 정보 위계**를 결합한다. 기본 카드 그리드, 파란 SaaS 팔레트, 의미 없는 반복 글로우는 사용하지 않는다.

## 3. Design system snapshot

- **색:** Obsidian `#090d0c`, Forest `#102d25`, Felt `#17463a`, Walnut `#4a2e1f`, Brass `#d3ad67`, Ivory `#f4ead4`, Oxblood `#7b2e35`
- **타입:** 제목은 `Georgia` 계열의 절제된 세리프, 조작·숫자·본문은 시스템 산세리프. 숫자는 tabular-nums.
- **간격:** 4px 기반. 주요 단계는 8 / 12 / 16 / 24 / 32px.
- **반경:** 작은 제어 8px, 패널 14px. 게임 타일과 카드는 6–12px로 물성에 맞춘다.
- **깊이:** 표면 → 인셋 가장자리 → 짧은 접촉 그림자 → 황동 포커스 링의 4단계.
- **모션:** 선택과 차례 변경에만 140–220ms. `prefers-reduced-motion`에서는 이동과 반복 효과를 제거한다.
- **시그니처:** 네 모서리의 황동 인레이와 얇은 에나멜 하이라이트. 상단 바, 게임 박스, 상태 칩, 게임 보드, 결과 패널에 반복한다.

## 4. Build plan

1. 생성형 이미지로 세 신규 게임의 무문자 커버를 만들고 HTML 제목과 분리한다.
2. 마지막 CSS 레이어에 공통 토큰·황동 모서리·포커스·반응형 규칙을 둔다.
3. 카드 대결은 펠트와 옥스블러드 카드, 타일 대결은 적색 점/청색 선 에나멜, 모자이크는 보석 유리 조각으로 구분한다.
4. 로비와 플레이 헤더의 밀도, 터치 크기, 상태 대비를 360/768/1280에서 검증한다.

## 5. QA and critique checklist

- Swap: 게임 표면을 서로 바꾸면 정체성이 흐려지는가?
- Squint: 흐리게 보아도 현재 차례와 기본 행동이 가장 먼저 보이는가?
- Signature: 황동 모서리와 에나멜 하이라이트가 최소 5개 영역에 반복되는가?
- Token: 임의 색·간격·그림자 대신 토큰이 쓰였는가?
- Accessibility: 44px 터치 표적, 명확한 focus-visible, 충분한 대비, reduced-motion을 지키는가?
- Responsive: 360/768/1280에서 가로 넘침, 잘림, 조작 불능이 없는가?

## 6. QA and critique result

- **1280px:** 홈·게임 라이브러리에서 가로 넘침 0, 깨진 이미지 0, 44px 미만 버튼 0.
- **768px:** 라이브러리 페이지 이동 버튼이 40×44px인 것을 발견해 44×44px로 수정. 카드 대결 베팅 제어의 4열 정의가 실제 3개 자식과 달라 내부 제어가 눌리던 문제를 3열 정의와 820px 전환점으로 수정했다.
- **360px:** 라이브러리와 모자이크 러시 실제 플레이 화면에서 가로 넘침 0, 44px 미만 버튼 0.
- **실제 2인 세션:** QA 봇을 두 번째 좌석에 연결해 페이스업 듀얼, 문양 공방, 모자이크 러시를 시작했다. 세 모듈 모두 올바른 `data-game-id`, 조작 가능한 상태, 깨진 이미지 0, 콘솔 warning/error 0을 확인했다.
- **Swap:** 옥스블러드 카드, 적점/청선 에나멜 타일, 다색 보석 조각으로 세 게임의 표면 언어가 서로 교환 불가능하다.
- **Squint:** 공통 헤더의 현재 단계·활성 플레이어, 각 게임 중앙의 공격/팟/퍼즐이 가장 높은 대비를 가진다.
- **Signature:** 황동 인레이가 상단 바, 라이브러리 헤더, 게임 박스, 상태 칩, 게임 셸, 결과 패널에 반복된다.
- **Token:** 공통 팔레트·그림자·간격은 `generated-design.css`의 atelier 토큰을 사용하며 게임 고유색만 모듈 범위에서 덮어쓴다.

## 7. Flow-first selection pass

- **게임 선택 히어로 이미지:** 녹색 펠트, 월넛 프레임, 황동 부품을 위에서 본 16:9 게임 라이브러리 테이블을 생성했다. 텍스트와 로고는 이미지에 넣지 않고 실제 HTML 제목·필터가 가독성을 담당한다.
- **빈 테이블 이미지:** 닫힌 무명 게임 상자와 주사위·타일·말을 위에서 본 4:3 정물 이미지를 생성해, 선택 전 상태가 단순 장식이 아니라 다음 행동을 설명하도록 했다.
- **적용 자산:** `game-library-table-v2.webp`는 라이브러리 상단의 낮은 대비 배경, `game-selection-empty-v2.webp`는 중앙 테이블의 선택 안내 이미지로 사용한다.
- **검색 상태:** 검색 결과가 1개면 게임 상자를 156px(모바일 168px) 안에서 중앙 정렬하고, 결과가 없으면 복구 버튼이 있는 빈 상태를 유지한다.
- **모바일 플레이 순서:** 모자이크 러시는 퍼즐→점수, 문양 공방은 현재 공격→내 손패/행동→공개 기록 순서로 바꿨다. 플레이 헤더의 일시정지·로비·나가기에는 520px 이하에서도 텍스트 라벨을 유지한다.
- **점수 레이아웃:** 문양 공방 점수판은 2/3/4인 수에 맞춰 열 개수를 조정하고, 모자이크 러시의 점수 레일은 내용 높이까지만 차지한다.

### 생성 프롬프트 기록

- `game-library-table-v2.webp`: “Premium editorial top-down board-game library table, deep green wool felt inside a walnut and aged-brass frame, tasteful dice, enamel tiles, cards and wooden pawns gathered near the edges, clear calm center for interface copy, warm directional light, realistic tactile materials, restrained board-game atelier mood, no words, no letters, no logos, 16:9.”
- `game-selection-empty-v2.webp`: “Top-down product still life of a closed generic board-game box on deep green felt, small dice, red and blue enamel tiles and wooden pawns arranged naturally around it, walnut and aged-brass details, warm soft studio light, realistic tactile craft materials, clean readable silhouette, no words, no letters, no logo, 4:3.”

### 재검수 결과

- 프로덕션 빌드, 17개 카탈로그 등록, 세 신규 게임 규칙 시뮬레이션, 소켓 좌석 인증·중복 액션 방지, 프라이버시, 타임아웃 검사를 통과했다.
- 전체 회귀에서 35개 인원별 시작 조합과 17개 게임 완주 시나리오를 모두 통과했다. 페이스업 듀얼 2액션, 문양 공방 247액션, 모자이크 러시 36액션을 포함해 각 게임이 종료·승자 확정까지 도달했다.
- 실제 1인 모자이크 러시와 QA 봇을 연결한 2인 문양 공방·페이스업 듀얼을 브라우저에서 시작하고 행동을 전송했다.
- 360/768/1280px에서 문서 가로 넘침 0, 깨진 이미지 0을 확인했다. 360px 플레이 조작부의 표시 버튼은 모두 44px 이상이다.
- 첫 브라우저 검수에서 단일 검색 결과가 기존 고우선순위 CSS에 밀리는 충돌을 발견했고, 로비 범위 선택자를 강화해 중앙 156px 정렬로 재검증했다.

# Board Game Room 인터랙션 UI 리디자인 작업 지시서

작성일: 2026-07-08

## 1. 목적

현재 화면은 보드게임 질감과 카드 UI를 일부 갖고 있지만, 사용자가 말한 "인터랙션 디자인 페이지" 수준의 직접 조작 경험과는 다르다. 이번 리디자인은 단순 hover, glow, 카드 확대가 아니라 **오브젝트를 잡고, 놓고, 펼치고, 좌석에 앉히는 상호작용**을 앱의 핵심 조작 방식으로 만든다.

이 문서는 구현자가 각 UI를 어떤 형태로 만들고, 어떤 기능을 포함하고, 어떤 방식으로 검증해야 하는지 세세하게 지시하기 위한 작업 기준서다.

## 2. 참고 방향

참고 사이트와 적용 기준:

- Awwwards Drag/Gesture: 드래그, 홀드, 제스처가 실제 네비게이션과 상태 전환이 되는 방식.
- Codrops Page Transition: 카드/목록 요소가 전체 콘텐츠 화면으로 확대, 전환, 재배치되는 방식.
- GSAP Draggable: 관성, snap, revert, drag bounds, release feedback.
- Bruno Simon: 화면을 읽는 것이 아니라 공간을 직접 움직이며 탐색하는 방식.
- Active Theory/Lusion/Resn 계열: UI 요소를 평면 컴포넌트가 아닌 장면의 오브젝트로 다루는 방식.

이번 앱에 적용할 해석:

- 홈은 "방 목록"이 아니라 "테이블 홀"이다.
- 게임 선택은 "버튼 목록"이 아니라 "게임 박스를 꺼내 테이블에 펼치는 행동"이다.
- 플레이어는 텍스트 항목이 아니라 "말/token"이다.
- 선택 가능 상태는 텍스트보다 위치, 밝기, 잠금, 깊이로 먼저 전달한다.

## 3. 피해야 할 구현

다음은 이번 작업에서 실패로 간주한다.

- 카드 hover 시 살짝 커지고 그림자만 바뀌는 수준.
- 설명 문구가 인터랙션을 대신하는 구조.
- 버튼/폼/표를 목재 배경 위에 올린 구조.
- 게임 선택이 여전히 `button grid -> selected text -> start button` 중심인 구조.
- 모바일에서 드래그가 안 되면 경험이 무너지는 구조.
- 애니메이션은 있지만 상태 모델은 없는 구조.

## 4. 전체 정보 구조

### 4.1 페이지 구성

1. `Home / Table Hall`
   - 방 목록, 방 만들기, 최근 방 복귀를 테이블 장면으로 표현.

2. `Room Lobby / Focused Table`
   - 특정 방 안에 들어간 상태.
   - 좌석, 플레이어 말, 게임 선택 테이블을 표시.

3. `Game Picker / Game Box Shelf`
   - 게임 박스를 선반에서 꺼내 중앙 테이블에 올리는 화면.

4. `Unfolded Game Preview`
   - 선택된 게임 박스가 열리고 미니 보드가 펼쳐진 상태.

5. `Playing View`
   - 기존 게임 플레이 화면.
   - 이번 작업의 핵심 범위는 아니지만 진입/복귀 transition과 헤더 정리는 포함한다.

## 5. 공통 디자인 시스템 지시

### 5.1 시각 언어

사용할 오브젝트:

- 테이블: 방 또는 현재 게임 공간.
- 좌석: 참가 가능한 자리.
- 플레이어 말: 사용자 identity.
- 게임 박스: 게임 선택 항목.
- 박스 뚜껑: 선택 전 대표 이미지.
- 펼쳐진 보드판: 선택 후 게임 미리보기.
- 선반: 게임 목록.
- 트레이: 내 말, 방 만들기, 빠른 행동.

색상:

- 배경: 어두운 딥 그린 펠트.
- 테이블 테두리: 월넛 목재.
- 조작 가능 오브젝트: 더 밝은 테두리와 깊이.
- 선택 불가 오브젝트: 뒤쪽 선반, 낮은 채도, 낮은 조도.
- 확정 상태: 테이블 조명, 보드 펼침, 선명한 말 배치.

재질:

- 테이블: `club-felt` 계열.
- 목재 프레임: `club-walnut` 계열.
- 게임 박스: 게임 대표 이미지 + 박스 두께 + 살짝 닳은 모서리.
- 플레이어 말: 현재 아바타 색과 모양 유지.
- 보드판: 게임별 미니 보드 UI.

### 5.2 모션 원칙

모션은 장식이 아니라 상태 이해를 위해 사용한다.

- 잡기: 오브젝트가 손 위로 올라오듯 `lift`.
- 이동: 포인터/터치 추적.
- 놓기: 가까운 슬롯으로 `snap`.
- 취소: 원래 위치로 `revert`.
- 선택: 박스가 테이블 중앙에 고정.
- 펼침: 박스 뚜껑/대표 이미지에서 보드판으로 전환.
- 시작: 보드판이 실제 게임 화면으로 이어짐.

필수 reduced motion:

- 사용자가 reduced motion이면 이동 거리는 줄이고 `fade + scale`로 대체한다.
- 기능 상태는 그대로 유지한다.

## 6. UI별 상세 작업 지시

## 6.1 Global App Shell

### 기능

- 앱 전체를 하나의 보드게임 카페/테이블 공간으로 보이게 한다.
- 상단 바는 최소화한다.
- 현재 페이지가 홈인지, 방 내부인지, 플레이 중인지에 따라 배경 깊이와 테이블 크기를 다르게 한다.

### 디자인

- `Board Game Room` 브랜드는 작게 유지한다.
- 설명 문구 `웹에서 즐기는 보드게임`은 홈 진입 첫 화면에서만 보이거나 제거한다.
- 상단 바가 콘텐츠보다 강하면 안 된다.
- 화면의 주인공은 항상 테이블 장면이어야 한다.

### 구현 방식

- `AppShell` 또는 기존 `.app-shell`에 상태 class를 명확히 둔다.
  - `is-home`
  - `is-room-lobby`
  - `is-playing`
- 배경은 고정 질감 하나와 조명 레이어 하나로 제한한다.
- 콘텐츠 카드마다 제각각 배경을 덧칠하지 않는다.

### 검증

- 390, 768, 1280px 캡처에서 첫 시선이 상단 바가 아니라 테이블로 가야 한다.
- `h1`은 하나만 유지한다.
- 상단 바가 모바일에서 세로 공간을 과하게 차지하지 않아야 한다.

### 이유

현재 문제는 패널이 많아 "앱 관리 화면"처럼 보이는 것이다. 전역 쉘부터 테이블 공간이 중심이 되어야 이후 홈/게임 선택이 인터랙션 장면처럼 보인다.

## 6.2 Home / Table Hall

### 기능

- 열린 방들을 테이블 오브젝트로 보여준다.
- 방이 없으면 빈 테이블 하나와 내 플레이어 말 트레이를 보여준다.
- 사용자는 빈 테이블에 내 말을 올려 방을 만든다.
- 사용자는 열린 테이블을 눌러 방에 입장한다.
- 방 목록 텍스트 표는 보조 정보로만 둔다.

### 디자인

- 중앙에는 넓은 펠트 테이블 공간을 배치한다.
- 열린 방 하나는 작은 테이블 하나로 표현한다.
- 테이블 위에는 다음 요소가 보여야 한다.
  - 방장 아바타 말
  - 현재 인원 말 개수
  - 빈 좌석
  - 선택된 게임 박스 또는 `게임 선택 전` 상태
- 빈 방 상태에서는 안내 문구보다 빈 테이블 오브젝트가 먼저 보여야 한다.

### 상호작용

데스크톱:

- 방 테이블 hover:
  - 해당 테이블이 앞으로 나온다.
  - 좌석 말이 정렬된다.
  - 입장 가능한 테이블이면 테두리가 밝아진다.
- 방 테이블 click:
  - 테이블이 확대된다.
  - 입장 action이 테이블 위에 나타난다.
- 내 말 drag:
  - 빈 테이블 위로 이동하면 테이블이 반응한다.
  - drop하면 방 생성 요청.
  - 실패하면 말이 트레이로 돌아온다.

모바일:

- 방 테이블 tap:
  - 바로 입장하지 말고 focused state를 연다.
  - focused state에서 큰 `입장` action 제공.
- 빈 테이블 tap:
  - 방 생성 확인 없이 바로 생성하거나, 작은 확정 affordance를 보여준다.
  - 장황한 모달 금지.

### 상태 모델

- `empty`
- `rooms-visible`
- `room-hovered`
- `room-focused`
- `player-token-lifted`
- `player-token-over-empty-table`
- `creating-room`
- `joining-room`
- `connection-offline`

### 구현 지시

- 새 컴포넌트 후보:
  - `InteractiveHomeScene`
  - `RoomTableObject`
  - `EmptyRoomTable`
  - `PlayerTokenTray`
  - `FocusedRoomPopover`
- `rooms` 데이터를 테이블 오브젝트 배열로 매핑한다.
- 방 코드 입력 UI는 제거하거나 개발용 fallback으로 숨김 처리한다.
- `최근 방 복귀`는 테이블 focus 상태 안의 작은 action으로 통합한다.

### 검증

- 방 없음 캡처:
  - 빈 테이블과 내 말이 보여야 한다.
  - 텍스트가 화면을 설명하는 주체가 아니어야 한다.
- 방 1개 캡처:
  - 테이블 위 말 개수로 `1/4`가 직관적으로 보여야 한다.
- 방 4개 이상 캡처:
  - 테이블들이 겹치거나 텍스트가 넘치면 실패.
- Playwright:
  - 빈 테이블 tap/drag로 `room:create` 호출 확인.
  - 열린 테이블 tap으로 `room:join` 호출 확인.
  - connection offline 상태에서는 테이블 action disabled 확인.

### 이유

방 목록을 텍스트로 읽는 것은 사용자가 원한 인터랙션 디자인이 아니다. 실제 보드게임 모임처럼 "어느 테이블에 앉을지"를 고르는 장면이어야 한다.

## 6.3 Player Identity / Token Tray

### 기능

- 플레이어 이름과 아바타를 말/token으로 보여준다.
- 이름 입력은 부차적이다.
- 아바타 조합은 말 외형 변경으로 즉시 반영된다.
- 내 말은 방 만들기와 좌석 입장의 핵심 조작 오브젝트다.

### 디자인

- 하단 또는 우측에 작은 트레이를 둔다.
- 트레이에는 내 말, 이름, 아바타 편집 버튼만 둔다.
- 큰 폼처럼 보이면 안 된다.
- 아바타 편집은 작은 drawer 또는 popover로 연다.

### 상호작용

- 내 말 hover/tap: 살짝 들림.
- 내 말 drag: 방 생성 가능.
- 아바타 변경: 말 외형이 즉시 바뀜.
- 이름 변경: 말 옆 nameplate에 반영.

### 상태 모델

- `token-idle`
- `token-editing`
- `token-dragging`
- `token-docked`
- `token-seated`

### 구현 지시

- 기존 `AvatarCustomizer`는 유지하되 홈에서는 compact mode로 렌더링한다.
- 아바타 편집 popover는 테이블 장면을 가리지 않게 하단 sheet로 둔다.
- localStorage avatar 저장은 유지한다.

### 검증

- 모바일에서 아바타 편집창이 화면 높이 45%를 넘지 않는다.
- 이름 input 높이는 44px 이상.
- 아바타 변경 후 방 생성 시 서버 snapshot에도 avatar가 전달된다.

### 이유

플레이어 이름 입력 폼은 인터랙티브 장면을 끊는다. 플레이어를 "말"로 표현해야 방 생성/입장 조작과 연결된다.

## 6.4 Room Lobby / Focused Table

### 기능

- 방 내부에서는 하나의 큰 테이블을 보여준다.
- 좌석은 리스트가 아니라 테이블 주변 자리로 표현한다.
- 방장, 현재 사용자, 연결 끊김, 빈 좌석이 구분되어야 한다.
- 방 삭제/나가기는 하나의 `테이블 떠나기` action으로 정리하되, 방장일 때는 방 닫기 의미가 명확해야 한다.

### 디자인

- 중앙 큰 테이블.
- 좌석은 테이블 주변 1~4개 위치에 배치.
- 각 좌석은 플레이어 말 + 이름표.
- 빈 좌석은 비어 있는 outline seat.
- 오프라인은 말이 뒤로 물러나거나 반투명.

### 상호작용

- 좌석 hover/tap:
  - 해당 플레이어 정보 nameplate 표시.
- 방장 action:
  - `방 닫기`는 위험색 작은 아이콘.
  - 실수 방지로 짧은 hold 또는 confirm affordance 사용 가능.
- 비방장 action:
  - `나가기`만 제공.

### 상태 모델

- `seat-empty`
- `seat-filled`
- `seat-current`
- `seat-host`
- `seat-offline`
- `room-closing`
- `leaving-room`

### 구현 지시

- 기존 `SeatRow`는 데스크톱 lobby에서는 `SeatAroundTable`로 대체한다.
- 모바일에서는 좌석을 테이블 위/아래 compact stack으로 두되, 리스트처럼 보이지 않게 한다.
- `SeatRow`는 접근성 fallback 또는 작은 화면 fallback으로 남겨둘 수 있다.

### 검증

- 2인/3인/4인 방 스냅샷을 각각 만든다.
- 각 좌석 위치가 겹치지 않는지 확인한다.
- 오프라인 플레이어가 현재 차례일 때 시각적으로 구분되는지 확인한다.

### 이유

방 내부가 좌측 리스트와 우측 패널로 보이면 보드게임 준비 공간이 아니라 관리자 화면처럼 느껴진다.

## 6.5 Game Shelf

### 기능

- 모든 게임을 게임 박스 오브젝트로 보여준다.
- 현재 인원에서 가능한 게임은 앞쪽 선반에 둔다.
- 불가능한 게임은 뒤쪽 또는 잠긴 박스로 표현한다.
- 게임 박스는 탭/드래그 가능한 선택 오브젝트다.

### 디자인

- 데스크톱:
  - 테이블 한쪽 또는 하단에 선반.
  - 2줄 이하로 보이되, 많으면 shelf scroll.
  - 각 박스는 대표 이미지, 게임명, 인원수만 표시.
- 모바일:
  - 하단 고정 shelf.
  - 2열 grid 또는 horizontal snap carousel 중 하나를 선택.
  - 사용자가 힘들게 옆으로 계속 넘기지 않도록 2열 grid 우선.

### 상호작용

- hover/focus:
  - 박스가 선반에서 살짝 앞으로 나옴.
  - 중앙 테이블에는 preview만 바뀜.
- tap:
  - 박스가 중앙 테이블로 이동.
  - 보드 unfold.
  - 방장이면 선택 요청.
- drag:
  - 포인터를 따라 박스 이동.
  - 테이블에 가까우면 drop zone이 반응.
  - 놓으면 unfold.
- drag cancel:
  - 원래 shelf 위치로 복귀.

### 상태 모델

- `box-locked`
- `box-available`
- `box-hovered`
- `box-focused`
- `box-lifted`
- `box-dragging`
- `box-over-table`
- `box-dropped`
- `box-selected`

### 구현 지시

- 새 컴포넌트 후보:
  - `GameShelf`
  - `GameBoxObject`
  - `GameBoxImage`
  - `GameAvailabilityLock`
- `GameDefinition.visual`에 필요한 경우 `boxArt`, `boxColor`, `objectShape` 메타를 추가한다.
- 현재 `GameCoverImage`를 박스 뚜껑 이미지로 재사용한다.
- 불가능 게임의 버튼은 disabled만 하지 말고 박스 위치/조도/잠금으로 표현한다.

### 검증

- 각 인원수 1/2/3/4 기준으로 가능한 게임만 앞쪽에 보이는지 확인.
- disabled 게임은 키보드 focus가 가지 않거나, focus 가능 시 이유가 aria로 전달되어야 한다.
- 390px에서 게임명 긴 항목이 박스 밖으로 넘치면 실패.

### 이유

게임 선택을 목록에서 고르면 사용자가 원하는 인터랙션 페이지와 다르다. 물건을 꺼내는 행위가 선택 행위가 되어야 한다.

## 6.6 Game Box Drag / Tap Interaction

### 기능

- 박스를 집고 이동하고 놓는 조작을 실제 상태 전환으로 구현한다.
- tap-only 환경에서도 동일한 결과가 나온다.

### 디자인

- lifted 상태:
  - 박스가 선반보다 위 레이어로 올라온다.
  - 그림자가 길어진다.
  - 약간 회전한다.
- over-table 상태:
  - 테이블 중앙 drop zone이 밝아진다.
  - 놓을 위치가 보인다.
- dropped 상태:
  - 박스가 테이블 중앙 슬롯에 snap.
  - 박스 뚜껑 열림 transition으로 넘어간다.

### 구현 방식

- CSS hover만 사용 금지.
- 상태 기반 구현 필수:
  - pointer down
  - pointer move
  - pointer up
  - cancel
  - keyboard select
- 라이브러리 후보:
  - `framer-motion` 또는 `motion` for React.
  - 드래그 관성이 부족하면 `gsap/Draggable`.
- 최소 구현:
  - React state + pointer events + transform.
- 고급 구현:
  - motion layoutId로 shelf 위치에서 table 위치로 shared layout transition.

### 상태 전환

```text
shelf
  -> hovered
  -> lifted
  -> dragging
  -> over-table
  -> dropped
  -> opening
  -> unfolded
  -> selected
```

취소 전환:

```text
dragging -> canceled -> shelf
```

### 검증

- Playwright에서 mouse drag로 상태 class 변화를 확인한다.
- 모바일 viewport에서는 tap으로 `dropped -> unfolded`가 되는지 확인한다.
- keyboard Enter/Space로도 선택 가능해야 한다.
- reduced motion에서도 선택 기능이 동작해야 한다.

### 이유

인터랙션 디자인 페이지의 핵심은 "사용자의 조작이 화면의 물리적 상태를 바꾸는 것"이다. class/state 분리 없이 애니메이션만 있으면 검증할 수 없다.

## 6.7 Central Game Table / Drop Zone

### 기능

- 게임 박스가 올라오는 중앙 무대.
- 아무 게임도 선택되지 않은 상태, preview 상태, dropped 상태, unfolded 상태를 명확히 구분한다.

### 디자인

- 빈 상태:
  - 테이블 중앙에 가벼운 슬롯만 보임.
  - 설명 문구 최소화.
- preview 상태:
  - 선택 후보 게임의 실루엣 또는 박스 shadow가 보임.
- dropped 상태:
  - 박스가 중앙에 고정.
- unfolded 상태:
  - 보드판이 박스에서 펼쳐져 테이블 위를 차지.

### 상호작용

- 게임 박스를 drag over하면 테이블이 살짝 열리는 느낌.
- drop하면 보드가 펼쳐짐.
- 다른 게임을 올리면 기존 보드가 접히고 새 박스가 열린다.

### 상태 모델

- `table-empty`
- `table-previewing`
- `table-ready-to-drop`
- `table-box-dropped`
- `table-opening`
- `table-unfolded`
- `table-game-selected`

### 구현 지시

- 새 컴포넌트 후보:
  - `CentralGameTable`
  - `TableDropZone`
  - `GameBoxOpeningSequence`
  - `UnfoldedBoardPreview`
- table state는 `LobbyPanel` 내부 useState 또는 별도 hook으로 관리.
- 서버의 selectedGameId와 local preview state를 분리한다.
  - preview: 클라이언트 로컬.
  - selected: 서버 확정.

### 검증

- preview만 했는데 서버 selectedGameId가 바뀌면 실패.
- drop/tap 확정 후 서버 selectedGameId가 바뀌어야 한다.
- selectedGame이 없는 상태에서 시작 버튼은 보이지 않거나 비활성.

### 이유

지금 문제는 preview와 selected가 너무 쉽게 섞여 사용자가 "게임을 꺼내 봤다"와 "이 게임으로 확정했다"를 구분하기 어렵다는 점이다.

## 6.8 Unfolded Board Preview

### 기능

- 게임 박스가 열린 뒤 실제 미니 보드가 펼쳐진다.
- 게임별 대표 규칙을 말보다 보드 형태로 보여준다.
- 방장은 여기서 `이 게임으로 시작`을 확정한다.

### 디자인

- 박스 이미지가 왼쪽/뒤쪽에 남고, 보드판이 중앙에 펼쳐진다.
- 게임 제목, 인원수는 작게만 표시.
- 설명 문단은 기본 숨김.
- 필요 시 작은 정보 아이콘을 눌러 룰 링크 또는 원본 설명을 연다.

### 게임별 미니 보드 지시

- 구룡투: 두 플레이어의 숨긴 타일 스택과 중앙 공개 슬롯.
- 쿼리도: 9x9 보드, 말 2/4개, 벽 슬롯 일부.
- 아발론: 육각 보드와 흑백 구슬 배치.
- 고스트: 6x6 보드와 정체가 숨겨진 유령.
- 카왈레: 4x4 스택 높이가 보이는 돌.
- 오목: 목재 격자와 흑백 돌.
- 알까기: 원형 판과 알 배치.
- 꾹꾹이: 쿠션판과 작은/큰 말 외형.
- 다빈치: 비공개 타일 랙.
- 블로커스: 20x20 격자와 색상 조각.
- 요트: 주사위 트레이와 점수판 일부.
- 인쉬: 링/마커 네트워크.
- 행맨: 글자 슬롯과 추측 키패드.

### 상태 모델

- `preview-loading`
- `preview-ready`
- `preview-unfolding`
- `preview-unfolded`
- `preview-error`

### 구현 지시

- 기존 `BoardPreview`를 계속 쓰되, "박스가 열린 후 보드"로 역할을 명확히 한다.
- fallback 문자열 `게임을 선택해주세요` 같은 문구가 보이면 실패.
- 미니 보드는 실제 게임 컴포넌트를 그대로 넣지 말고, 가볍고 고정된 preview만 사용한다.

### 검증

- 각 게임 preview 캡처를 저장한다.
- preview에서 텍스트가 보드 위에 겹치지 않아야 한다.
- 이미지 로딩 실패 시 깨진 이미지 아이콘 대신 게임별 fallback board가 보여야 한다.

### 이유

게임 선택 단계에서는 룰 설명보다 "이 게임이 어떤 보드인지"가 먼저 보여야 한다.

## 6.9 Start / Ready Action

### 기능

- 게임이 펼쳐진 뒤에만 시작 action이 나타난다.
- 방장만 시작 가능하다.
- 인원수 불일치 시 시작 불가 이유를 오브젝트 상태로 보여준다.

### 디자인

- 일반 초록 버튼 대신 테이블 위 `시작 레버`, `확정 토큰`, 또는 `Start seal`처럼 보이게 한다.
- 선택 전에는 action 영역 자체가 작거나 숨겨져야 한다.
- 불가능 상태는 붉은 경고 박스가 아니라 닫힌 레버/잠긴 seal로 표현한다.

### 상태 모델

- `start-hidden`
- `start-disabled-count`
- `start-disabled-nonhost`
- `start-ready`
- `start-pressed`
- `starting`

### 구현 지시

- `selectedGame && canStart`일 때만 강한 primary action.
- 비방장은 시작 버튼을 보지 않거나, 작은 "방장 대기" 상태만 본다.
- 모바일에서는 펼쳐진 보드 아래 sticky action으로 둔다.

### 검증

- 비방장 화면에서 시작 버튼이 활성화되면 실패.
- 인원수 불가능 게임에서 시작 가능하면 실패.
- 시작 action은 390px에서도 보이되 보드를 가리지 않아야 한다.

### 이유

게임 선택 화면에서 가장 중요한 행동은 "박스를 펼쳐보고 확정하기"다. 시작 버튼이 처음부터 강하면 오브젝트 조작 경험을 방해한다.

## 6.10 Room List Fallback / Accessibility Layer

### 기능

- 시각적 테이블 장면을 못 쓰는 사용자를 위해 접근 가능한 리스트 구조를 유지한다.
- 스크린리더와 키보드 사용자는 방과 게임을 순서대로 선택할 수 있어야 한다.

### 디자인

- 화면상으로는 테이블 오브젝트가 우선.
- semantic list는 같은 오브젝트에 role/label로 제공.
- 별도 긴 표를 다시 보여주지 않는다.

### 구현 지시

- 방 테이블은 `button` 또는 focus 가능한 `article + button` 조합.
- `aria-label`: `${hostName}의 방, ${playerCount}/${maxPlayers}명, ${status}`.
- 게임 박스는 `button`.
- disabled 게임은 `aria-disabled`와 이유 텍스트를 제공.

### 검증

- Tab 순서:
  1. 내 말/이름
  2. 빈 테이블/방 테이블
  3. 게임 박스
  4. 펼쳐진 게임 시작 action
- focus ring이 보드 질감 위에서도 보여야 한다.
- 스크린리더 label에 방 코드 대신 필요한 정보가 들어가야 한다.

### 이유

인터랙션 디자인은 시각적으로 풍부해질수록 접근성을 잃기 쉽다. 오브젝트형 UI도 실제 HTML control로 남아야 한다.

## 6.11 Mobile Interaction

### 기능

- 모바일에서는 drag가 없어도 동일한 선택 경험이 가능해야 한다.
- 하단 게임 선반, 중앙 테이블, 상단 좌석 정보가 자연스럽게 이어져야 한다.

### 디자인

- 홈:
  - 상단 브랜드 최소화.
  - 중앙 테이블.
  - 하단 내 말 트레이.
- 방 로비:
  - 상단 좌석 strip.
  - 중앙 게임 테이블.
  - 하단 게임 박스 grid/shelf.
- 게임 박스:
  - 2열 grid 우선.
  - 너무 많은 horizontal carousel 금지.

### 상호작용

- tap game box:
  - 중앙 테이블로 이동.
  - 보드 unfold.
- long press:
  - lifted 상태 진입.
  - 손을 떼면 중앙 테이블에 놓기.
- swipe shelf:
  - 필요한 경우만 사용.
- back/cancel:
  - 펼쳐진 보드를 접고 shelf로 돌아감.

### 검증

- 390x844에서:
  - 첫 화면 가로 overflow 없음.
  - 게임 박스 2열이 잘림 없이 보임.
  - 시작 action이 보드를 가리지 않음.
  - 손가락 터치 영역 44px 이상.
- 360px에서도 핵심 조작 가능.

### 이유

데스크톱 drag 중심으로 만들면 모바일에서 바로 실패한다. 모바일은 tap-to-place가 1차 조작이어야 한다.

## 6.12 Transition to Playing View

### 기능

- 게임 시작 시 펼쳐진 보드 preview에서 실제 게임 화면으로 자연스럽게 전환한다.

### 디자인

- 보드 preview가 화면 중앙으로 확장된다.
- 좌석/선반은 뒤로 물러난다.
- 실제 게임 UI가 갑자기 튀어나오면 안 된다.

### 구현 방식

- shared layout transition 후보:
  - `layoutId=game-board-${gameId}`.
- CSS-only fallback:
  - preview fade out, game shell fade/scale in.

### 검증

- 시작 후 1초 이내에 실제 게임 화면이 조작 가능해야 한다.
- reduced motion에서는 즉시 전환하되 깜빡임 없어야 한다.

### 이유

게임 선택에서 플레이로 이어지는 연결이 끊기면 "박스를 펼쳤다"는 경험이 사라진다.

## 7. 구현 단계별 지시

### Phase 0. 현 UI 격리

작업:

- 기존 홈/로비 CSS 중 과도한 `body ... !important` 규칙 목록화.
- 새 인터랙션 컴포넌트에 `ir-*` prefix class 사용.
- 기존 UI와 충돌하지 않도록 새 파일 분리.

산출물:

- `src/components/interactive/`
- `src/styles-interactive.css` 또는 CSS module.

검증:

- 기존 게임 플레이 화면 스타일이 깨지지 않아야 한다.

### Phase 1. Home Table Hall 프로토타입

작업:

- 빈 테이블, 내 말, 열린 방 테이블 1~4개 렌더링.
- 탭으로 방 생성/입장 연결.
- 드래그는 데스크톱에서만 1차 구현.

검증:

- 방 없음/방 있음/방 4개 캡처.
- `room:create`, `room:join` 호출 Playwright 테스트.

### Phase 2. Game Shelf 프로토타입

작업:

- 13개 게임 박스 렌더링.
- 현재 인원 기반 available/locked 분리.
- tap으로 중앙 테이블에 놓기.
- selected 서버 상태와 preview 로컬 상태 분리.

검증:

- 인원수 1/2/3/4별 가능한 게임 snapshot.
- tap 후 `table-unfolded` 상태 확인.

### Phase 3. Drag/Drop 고도화

작업:

- 데스크톱 pointer drag.
- drop zone 반응.
- cancel/revert.
- snap 위치.

검증:

- Playwright mouse drag.
- drag cancel 테스트.
- over-table 상태 class 확인.

### Phase 4. Unfolded Board Preview

작업:

- 게임별 preview board 연결.
- 박스 열림 sequence.
- 다른 게임 선택 시 이전 보드 접힘.

검증:

- 13개 게임 preview 캡처.
- 이미지 로딩 실패 fallback.

### Phase 5. Mobile Flow

작업:

- tap-to-place.
- 하단 2열 shelf.
- sticky start action.
- long press lifted 상태 optional.

검증:

- 360/390/430px Playwright 캡처.
- 터치 타깃 검사.
- 가로 overflow 검사.

### Phase 6. Final QA / Northflank

작업:

- build.
- catalog/privacy/timeouts QA.
- visual QA.
- 커밋/푸시.
- Northflank 실제 URL 캡처.

검증:

- 로컬과 Northflank 캡처 비교.
- 배포 커밋 해시 확인.

## 8. Playwright 검증 시나리오

필수 테스트 파일 후보:

- `tmp/qa-interactive-home.spec.ts`
- `tmp/qa-game-shelf.spec.ts`
- `tmp/qa-mobile-interaction.spec.ts`
- 이후 안정화되면 `scripts/qa-interactive-ui.ts`로 승격.

### 테스트 1. 홈 빈 상태

검증:

- `.ir-table-hall`
- `.ir-empty-table`
- `.ir-player-token`
- `.ir-create-drop-zone`
- horizontal overflow <= 2px

왜:

- 빈 상태에서 사용자가 방을 어떻게 만들지 시각적으로 보여야 한다.

### 테스트 2. 방 있는 상태

검증:

- `.ir-room-table` 개수.
- 각 table의 aria-label.
- `1/4`가 텍스트만 아니라 seat token 개수로 표현.
- room focus 후 action 노출.

왜:

- 방 목록이 표가 아니라 테이블 오브젝트로 바뀌었는지 확인한다.

### 테스트 3. 게임 박스 tap

검증:

- `.ir-game-box[data-state="shelf"]`
- tap 후 `.ir-central-table[data-state="unfolded"]`
- selected game name 일치.
- start action 활성 조건 일치.

왜:

- 모바일 핵심 조작이 drag 없이 동작해야 한다.

### 테스트 4. 게임 박스 drag/drop

검증:

- pointer down 후 `lifted`.
- move 후 `dragging`.
- drop zone 진입 후 `over-table`.
- release 후 `dropped`, `opening`, `unfolded`.

왜:

- 인터랙션이 CSS hover가 아니라 실제 조작 상태인지 확인한다.

### 테스트 5. locked game

검증:

- 현재 인원 불가 게임은 locked.
- click해도 selectedGameId 변경 없음.
- reason이 aria로 제공.

왜:

- 인원수 규칙이 오브젝트 UI에서도 깨지면 안 된다.

### 테스트 6. reduced motion

검증:

- `prefers-reduced-motion` emulation.
- 조작 가능.
- 긴 이동/반복 애니메이션 없음.

왜:

- 인터랙션이 접근성 설정 때문에 기능을 잃으면 안 된다.

## 9. 완료 기준

아래 조건을 모두 만족해야 한다.

- 홈은 방 목록 표가 아니라 테이블 홀로 보인다.
- 방 만들기는 내 말/token을 테이블에 앉히는 경험으로 보인다.
- 게임 선택은 박스를 꺼내 테이블에 놓고 보드를 펼치는 경험으로 보인다.
- 모바일은 drag 없이 tap으로 완성된 흐름을 제공한다.
- 상태 모델이 DOM/class/data-state로 검증 가능하다.
- 설명 문구 없이도 사용자가 다음 행동을 알 수 있다.
- 로컬 QA와 Northflank 배포 QA가 모두 통과한다.


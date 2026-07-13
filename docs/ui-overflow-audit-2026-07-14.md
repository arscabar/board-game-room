# UI overflow audit — 2026-07-14

## Intent brief

- Audience: 모바일과 태블릿에서도 테이블 게임을 플레이하는 사용자
- Core task: 게임 선택, 상태 확인, 보드 조작을 화면 잘림 없이 수행
- Tone: 기존의 짙은 펠트·황동·목재 보드게임 클럽 미학 유지
- Constraint: 페이지 전체 가로 스크롤과 임의 축소를 만들지 않고, 손패처럼 긴 콘텐츠만 내부 스크롤 허용

## Direction proposals

1. **Containment-first — selected.** Grid/flex 자식에 `min-inline-size: 0`을 주고, 보드와 도구가 부모 폭 안에서 재배치되게 한다.
2. Scroll-first. 좁은 화면의 대부분을 가로 스크롤로 넘긴다. 정보 탐색 부담이 커서 손패·기록 트랙에만 제한했다.
3. Scale-first. 게임판 전체를 축소한다. 터치 타깃과 글자 가독성이 떨어져 사용하지 않았다.

## Design system snapshot

- Surface: obsidian/forest felt, walnut frame, brass edge
- Type: serif display headings + Korean-readable sans body
- Spacing: 4–8px compact action gaps, 44px minimum interactive targets
- Responsive behavior: 520px 이하 경기 헤더 2단, 820px 이하 문양 공방 헤더/점수판 재배치
- Overflow policy: page overflow 금지, wrapping 우선, 타일 기록/손패는 명시적 horizontal scroller

## Build plan and applied fixes

- 공통 패널과 게임 모듈에 최소 폭 0 및 최대 폭 100% containment 추가
- 360px 경기 헤더를 제목/상태와 4개 액션의 2단 구조로 변경해 게임명 말줄임 제거
- 모바일 게임 선반의 음수 좌우 여백 제거
- 모자이크 러시 격자의 content-box 폭 계산을 border-box/부모 폭 기준으로 변경
- 문양 공방의 태블릿 점수판을 2열로 전환하고 공개 타일의 flex 축소 방지
- 긴 메시지와 확인 문구에 안전한 줄바꿈 적용

## QA and critique

Measured with the in-app browser at 360×900, 768×900, and 1280×900.

| Surface | Before | After |
| --- | --- | --- |
| Home | page overflow 0 | page overflow 0 |
| Game library | shelf clipped by 4px at 360px | clipped candidates 0 |
| Mosaic Rush | title ellipsis + module clipped by 9px at 360px | clipped/outside candidates 0 at all widths |
| Face-up Duel | title ellipsis at 360px | clipped candidates 0 |
| Pattern Workshop | names clipped at 768px; first compact record tile collapsed to 0px | clipped candidates 0 |

The tile hand and public-history rows can extend beyond the viewport by design, but remain contained by their own `overflow-x: auto` scrollers. No global `overflow: hidden`, font shrinking, or whole-game scaling was introduced.

# 모자이크 러시 (`mosaic-rush`) 구현 명세

참고 계통: 제한 시간 안에 지정된 폴리오미노로 목표 영역을 덮는 우봉고형 동시 퍼즐. 공식 퍼즐과 보드 아트를 사용하지 않고 조각·문제·기호를 모두 자체 제작한다.

## 1. MVP 범위

- 1–4명
- 9라운드
- 3조각 난이도만 우선 제공
- 독자 조각 12종
- 독자 퍼즐 보드 최소 24장 × 기호 6개 = 144 challenge
- 1차 제한 시간 60초
- 1차에 아무도 해결하지 못한 경우에만 2차 60초
- classic 무작위 토큰 점수와 fixed-rank 무운 점수 두 모드
- 4조각 난이도와 데일리·커스텀 퍼즐은 2차 범위

60초는 실제 모래시계를 디지털에 옮기기 위한 독자 하우스 상수이며 사용자 규칙에 표시한다.

## 2. 조각·퍼즐 데이터

```ts
type Cell = { x: number; y: number };

interface MosaicPieceDefinition {
  id: string;
  label: string;
  cells: Cell[];      // 원점 정규화 기본형
  pattern: string;    // 색 외 접근성 구분
}

interface MosaicChallenge {
  id: string;
  symbol: 0|1|2|3|4|5;
  requiredPieceIds: [string, string, string];
  targetCells: Cell[];
  solutionHash: string;
  solutionCount: number;
  difficulty: 1|2|3|4|5;
  generatorVersion: string;
}

interface MosaicBoardCard {
  id: string;
  challenges: [
    MosaicChallenge,
    MosaicChallenge,
    MosaicChallenge,
    MosaicChallenge,
    MosaicChallenge,
    MosaicChallenge
  ];
}
```

좌표 정규화:

- 정수 격자만 허용
- target의 minX/minY를 0으로 이동
- cell을 `y,x` 순서로 정렬
- 중복 cell 금지
- piece transform은 D4 군의 회전 4개 × 반전 2개를 생성한 뒤 signature 중복 제거

기존 `src/game-modules/blokus/index.tsx:135-175`의 normalize·transform·orientation 패턴을 `src/game-modules/polyomino-utils.ts` 공통 유틸로 추출해 재사용한다. 기존 Blokus 동작은 추출 전후 fixture로 동일함을 확인한다.

## 3. 퍼즐 생성·검수 파이프라인

신규 스크립트: `scripts/generate-mosaic-puzzles.ts`

1. 12개 독자 조각 정의를 읽는다.
2. 3개 조각 조합을 고른다.
3. 무작위 합법 배치로 연결된 target mask를 만든다.
4. exact-cover 백트래킹으로 solution count를 계산한다.
5. 1개 이상의 해답이 있는 challenge만 저장한다.
6. bounding box, 구멍 수, 오목한 모서리, 해답 수, 탐색 노드 수로 난이도를 추정한다.
7. 동일 target signature와 지나친 대칭 문제를 제거한다.
8. seed와 generatorVersion을 기록한다.
9. 생성 JSON을 별도 validator로 다시 읽어 모든 solutionHash를 검증한다.
10. 사람이 3회 이상 플레이하고 중앙 풀이 시간과 오답률을 콘텐츠 장부에 기록한다.

MVP 콘텐츠 게이트:

- challenge 144개 이상
- difficulty 1–3이 각각 최소 30개
- 특정 piece가 전체 문제의 35%를 넘지 않음
- 모든 challenge에 검증된 해답 1개 이상
- 공식 퍼즐과 시각적으로 비교해 복제한 문제가 아님을 사람 검토

## 4. 배치 제출

```ts
interface PiecePlacement {
  pieceId: string;
  x: number;
  y: number;
  rotation: 0|1|2|3;
  flipped: boolean;
}

interface MosaicSubmitPayload {
  roundId: string;
  puzzleId: string;
  draftRevision: number;
  placements: PiecePlacement[];
}
```

서버 검증:

- payload 크기 상한과 JSON 숫자의 finite·safe integer 검사
- roundId와 player puzzleId 일치
- 필요한 piece가 정확히 한 번씩만 존재
- transform 후 cell 중복 없음
- 모든 cell이 target 안에 있음
- 배치 cell 합집합이 target cell set과 정확히 같음
- deadline 전 서버 수신
- 해당 player가 아직 solved가 아님

순위는 클라이언트 시간이나 animation 완료 시간이 아니라 서버가 유효 제출 검증을 완료한 순서다.

## 5. 로컬 draft와 재접속

- drag·move·rotate·flip은 React local state에서 즉시 처리한다.
- 매 pointer move를 서버 액션으로 보내지 않는다.
- 500ms debounce 또는 조각 drop 때 `mosaic/checkpoint`를 보낸다.
- checkpoint는 개인 `draftRevision`만 증가시키고 순위·전역 room revision에는 영향을 주지 않는 별도 draft 채널로 저장한다.
- 다른 플레이어와 viewerId:null projection에는 draft를 포함하지 않는다.
- 새로고침하면 마지막 checkpoint를 복원하며, 마지막 500ms 이내 미전송 이동은 잃을 수 있다.
- `submit`은 phase-scoped concurrency를 사용해 다른 플레이어의 제출로 전역 revision이 바뀌어도 같은 roundId라면 검증한다.
- 연결이 끊긴 참가자가 있어도 deadline에서 미제출 실패로 처리하고 다음 단계로 진행한다. `모두 제출할 때까지` 무기한 기다리지 않는다.

## 6. 상태 모델

```ts
type MosaicPhase =
  | "round-setup"
  | "solving"
  | "second-chance"
  | "reward"
  | "tie-break"
  | "finished";

type RewardColor = "crimson" | "azure" | "jade" | "amber";

interface MosaicPrivateState {
  phase: MosaicPhase;
  scoringMode: "classic" | "fixed-rank";
  playerIds: string[];
  roundNumber: number;
  roundId: string;
  rolledSymbol: 0|1|2|3|4|5;
  puzzleDeck: Record<string, string[]>;
  puzzleDiscard: string[];
  puzzleByPlayer: Record<string, string>;
  drafts: Record<string, {
    revision: number;
    placements: PiecePlacement[];
  }>;
  solvedAt: Record<string, number | null>;
  solveRank: string[];
  rewardBag: Record<RewardColor, number>;
  trackAzure: number;
  trackAmber: number;
  rewards: Record<string, Record<RewardColor, number>>;
  solvedCounts: Record<string, number>;
  deadlineAt: number | null;
  tieBreakerIds: string[];
  winnerId: string | null;
  message: string;
}
```

초기 classic 토큰:

- azure 19, amber 19, crimson 10, jade 10
- track으로 azure 9와 amber 9를 먼저 이동
- bag 초기값: azure 10, amber 10, crimson 10, jade 10
- 값: crimson 4, azure 3, jade 2, amber 1

보존 불변식:

- track + bag + 모든 player rewards의 색별 합이 초기 색별 개수와 같다.
- 라운드마다 trackAzure와 trackAmber가 정확히 1씩 줄어든다.
- 1명만 해결하면 사용되지 않은 amber 1개를 bag으로 반환한다.
- 아무도 해결하지 못하면 azure와 amber를 모두 bag으로 반환한다.
- reward draw는 bag에서 without-replacement다.

## 7. 예약 이벤트와 라운드 전이

| 현재 | 이벤트 | 다음 | 처리 |
|---|---|---|---|
| round-setup | 서버 start | solving | symbol, puzzles, drafts, 60초 deadline |
| solving | valid submit | solving | solvedAt·rank, 해당 player interaction 종료 |
| solving | deadline, 해결자 있음 | reward | 추가 기회 없음 |
| solving | deadline, 해결자 없음 | second-chance | 같은 puzzle·draft, 새 60초 deadline |
| second-chance | valid submit | second-chance | solvedAt·rank |
| second-chance | deadline | reward | 성공자 기준 보상 |
| reward | 서버 settle | round-setup/finished | 토큰 이동, 9라운드 검사 |
| 9라운드 종료 | 최고점 1명 | finished | winnerId |
| 9라운드 종료 | 최고점 동률 | tie-break | 동점자만 새 challenge, deadline 없음 |
| tie-break | 첫 valid submit | finished | winnerId |

첫 번째 해결자가 나와도 남은 플레이어는 현재 deadline까지 계속 푼다. 첫 시간 동안 아무도 못 풀었을 때만 second chance가 열린다.

## 8. 보상

classic:

- 1위: track azure 1 + bag random 1
- 2위: track amber 1 + bag random 1
- 3·4위: bag random 1
- 실패: 없음
- 미지급 track 토큰은 라운드 종료 때 bag으로 반환

fixed-rank:

- 1위 crimson, 2위 azure, 3위 jade, 4위 amber
- 물리 토큰 재고와 무관한 점수 배지 모드로 구현해 classic bag 불변식과 섞지 않는다.

동일 서버 tick 안의 valid submit은 수신 큐 순서를 사용한다. 공동순위는 MVP에서 지원하지 않는다.

## 9. 공개 상태

모든 플레이어에게 공개:

- round, phase, rolledSymbol, deadline
- 자신의 puzzle target·required pieces
- 다른 사람의 solved 여부와 순위, token 합계

자기에게만 공개:

- 자신의 draft와 puzzleId

다른 플레이어와 null viewer에게 비공개:

- 개인 target mask, requiredPieceIds, draft placements
- 퍼즐 덱 순서와 solutionHash
- reward bag의 다음 추첨 결과

다른 플레이어에게 퍼즐 보드 자체를 보여 주지 않아 화면 공유를 통한 풀이 간섭을 줄인다. 결과 화면에서는 target 썸네일만 선택적으로 공개할 수 있다.

## 10. UI

데스크톱:

- 중앙 60%: target grid와 배치 preview
- 좌측: 필요한 조각 3개
- 상단: round, symbol, deadline, 1차/2차 표시
- 우측: 해결 순위, solved 상태, 토큰 점수
- 하단: 회전, 뒤집기, 제거, 전체 초기화, 제출

모바일:

- target grid는 가능한 정사각형으로 상단 고정
- 조각 tray는 3개 모두 동시에 보이게 함
- 선택 조각 이동은 drag와 `선택 → 칸 → 회전` 버튼 방식을 모두 지원
- grid 확대·축소보다 셀 크기를 화면에 맞추고, 큰 target은 pan을 허용

접근성:

- 조각은 색 외에 ID·패턴·실루엣으로 구분한다.
- grid 전체 cell을 모두 읽지 않고 `조각 L, 기준점 행 2 열 4, 90도, 충돌 없음` 같은 요약을 기본 제공한다.
- 화살표 이동, R 회전, F 뒤집기, Delete 제거, Enter 제출, Esc 취소.
- timer를 텍스트로 제공하고 10초·5초 알림은 소리와 진동을 각각 끌 수 있다.

## 11. 파일 작업표

| 파일 | 작업 |
|---|---|
| `src/shared/games.ts` | `[1,2,3,4]` 정의 |
| `src/game-modules/polyomino-utils.ts` | Blokus에서 transform 유틸 추출 |
| `src/game-modules/mosaic-rush/index.tsx` | reducer, projection, 동시 UI |
| `src/game-modules/mosaic-rush/pieces.ts` | 독자 조각 정의 |
| `src/game-modules/mosaic-rush/puzzles.generated.json` | 검증된 독자 challenge |
| `src/game-modules/mosaic-rush/exact-cover.ts` | 서버 검증과 generator 공용 solver |
| `src/game-modules/ui-styles/mosaic-rush.css` | grid·tray·반응형 |
| `scripts/generate-mosaic-puzzles.ts` | seed 생성기 |
| `scripts/validate-mosaic-puzzles.ts` | 독립 validator |
| `scripts/qa-all-games.ts` | 1–4인 동시 playthrough |
| `scripts/qa-privacy.ts` | 다른 player puzzle·draft 차단 |
| `scripts/qa-timeouts.ts` | 1차·2차·reward·tie-break 예약 이벤트 |
| `docs/18-mosaic-rush.md` | 사용자 규칙 |

## 12. 테스트 벡터

- 모든 piece의 D4 transform signature 중복 제거
- exact target과 같은 placement만 accept
- 겹침, 바깥, 누락, extra piece, duplicate piece 거절
- NaN, Infinity, 소수, 거대 좌표, 과대 payload 거절
- 4명이 같은 round revision에서 거의 동시에 submit해도 각 1회 처리
- 첫 deadline 전 한 명 성공 시 second chance 없음
- 아무도 성공하지 않으면 second chance 정확히 한 번
- 한 명 성공/0명 성공 때 미지급 track token bag 반환
- 9라운드 뒤 유일 최고점 finished
- 동점자만 tie-break interaction 가능
- 다른 player와 null viewer에 puzzle·draft·solution 없음
- refresh 후 마지막 checkpoint 복원
- 4명 중 1명 연결 종료 상태에서도 deadline 뒤 reward·다음 라운드 진행
- fixed seed의 puzzle 배분과 token draw 재현

## 13. 완료 기준

- 독자 challenge 144개가 validator를 통과한다.
- 100 seed × 4인 9라운드 시뮬레이션에서 토큰 보존 불변식이 유지된다.
- 4인 동시 submit과 deadline 경합 테스트가 1,000회 반복 통과한다.
- 360px에서 target과 3개 piece, 제출 버튼에 접근 가능하다.
- mouse, touch, keyboard 세 입력 방식으로 퍼즐을 완성할 수 있다.
- Blokus transform 유틸 추출 전후 기존 QA 결과가 같다.
- 공식 퍼즐·이미지 파일이 저장소에 포함되지 않는다.

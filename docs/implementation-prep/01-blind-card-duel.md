# 페이스아웃 듀얼 (`blind-card-duel`) 구현 명세

참고 계통: 한국형 블라인드 숫자카드 포커. 공식 방송판 복제가 아니라 조사된 구조를 빈틈없이 표준화한 독자 하우스 룰이다.

## 1. MVP 규칙 상수

```ts
const PLAYER_COUNT = 2;
const STARTING_STACK = 30;
const ANTE = 1;
const RANKS = [1,2,3,4,5,6,7,8,9,10] as const;
const COPIES_PER_RANK = 2;
const MIN_OPEN = 1;
const MIN_RAISE_INCREMENT = 1;
const FOLD_TEN_PENALTY = 10;
const ACTION_TIME_MS = 30_000;
const TIME_BANK_MS = 30_000;
```

- 총 20장 덱이며 손이 끝나도 사용 카드를 되돌리지 않는다.
- 다음 손을 시작할 때 덱이 2장 미만이면 20장을 새로 섞는다.
- 첫 선 플레이어는 서버 난수로 정하고 이후 손마다 교대한다.
- `체크`는 없다. 선 플레이어는 앤티 뒤 최소 1칩을 추가 베팅한다.
- 레이즈는 현재 상대 총 투입액보다 최소 1 높고 effective stack을 넘지 않는다.
- 사이드 팟은 없다.
- 칩, 포인트, 전적에는 현금·유료재화·상품 가치가 없다.

## 2. 상태 모델

```ts
type BlindCardPhase =
  | "dealing"
  | "betting"
  | "showdown"
  | "settlement"
  | "finished";

type BlindCard = {
  id: string;
  rank: 1|2|3|4|5|6|7|8|9|10;
};

interface BlindCardPrivateState {
  phase: BlindCardPhase;
  players: [string, string];
  deck: BlindCard[];
  discard: BlindCard[];
  hands: Record<string, BlindCard | null>;
  stacks: Record<string, number>;
  contributions: Record<string, number>;
  pot: number; // 현재 손 + 동률 이월분
  carriedFromTie: boolean;
  openerId: string;
  actorId: string | null;
  currentBetTo: number;
  lastAggressorId: string | null;
  handNumber: number;
  revealedRanks: Record<string, number | null>;
  timeoutCounts: Record<string, number>;
  timeBankMs: Record<string, number>;
  deadlineAt: number | null;
  winnerId: string | null;
  message: string;
}
```

불변 조건:

- `stackA + stackB + pot === 60`
- 카드 한 장은 deck, discard, A hand, B hand 중 한 곳에만 있다.
- `betting` 단계의 actor는 정확히 한 명이다.
- 쇼다운 직전 콜이 성립하면 두 contribution이 같다.
- stack, contribution, pot은 0 이상의 정수다.
- 음수 칩과 빚은 없다.

## 3. 공개 상태

```ts
interface BlindCardPublicState {
  phase: BlindCardPhase;
  viewerId: string | null;
  players: Array<{
    id: string;
    stack: number;
    contribution: number;
    visibleCardRank: number | null;
    cardPresent: boolean;
  }>;
  pot: number;
  carriedFromTie: boolean;
  openerId: string;
  actorId: string | null;
  currentBetTo: number;
  handNumber: number;
  deckCount: number;
  discardCount: number;
  deadlineAt: number | null;
  winnerId: string | null;
  message: string;
}
```

projection 규칙:

- A 뷰: B의 rank만 보이고 A의 rank는 `null`이다.
- B 뷰: A의 rank만 보이고 B의 rank는 `null`이다.
- `viewerId:null`: betting 중 두 rank 모두 `null`이다.
- showdown: 두 rank 모두 공개한다.
- fold: 각 플레이어가 이미 보고 있던 상대 카드만 유지하며 자기 카드는 새로 공개하지 않는다.
- 카드 ID는 허용되지 않은 뷰에 보내지 않는다.
- moveLog에는 `A가 10을 들고 폴드`처럼 숨은 정보를 쓰지 않고, 정산 뒤 `10 벌칙 적용`만 기록한다.

## 4. 액션

```ts
type BlindCardAction =
  | { type: "blind/open"; payload: { to: number } }
  | { type: "blind/call" }
  | { type: "blind/raise"; payload: { to: number } }
  | { type: "blind/fold" };
```

공통 검증:

- 현재 phase가 `betting`
- 요청자가 `actorId`
- 금액은 안전한 정수
- expectedRevision 일치
- 서버 deadline 전 수신

`open`:

- opener의 첫 행동에만 가능
- `to >= ANTE + MIN_OPEN`
- 최대값은 `내 contribution + min(내 stack, 상대가 맞출 수 있는 금액)`

`raise`:

- 상대의 현재 contribution보다 최소 1 높음
- effective stack을 넘지 않음
- 상대가 이미 all-in이면 불가

`call`:

- 필요한 칩을 낼 수 있을 때만 가능
- 2인 effective-stack 상한 때문에 부분 콜은 발생하지 않음
- 적용 뒤 즉시 showdown

`fold`:

- 상대가 먼저 pot을 획득한다.
- 폴드한 숨은 rank가 10이면 폴드 후 남은 stack에서 `min(10, stack)`을 상대에게 이전한다.
- 시간 초과도 같은 서버 액션으로 처리한다.

## 5. 상태 전이

| 현재 | 이벤트 | 다음 | 처리 |
|---|---|---|---|
| dealing | 서버 deal | betting | 앤티, 두 장, 상대 카드 projection, opener actor |
| betting | open/raise | betting | contribution·pot 갱신, actor 교대 |
| betting | call | showdown | 두 카드 공개 |
| betting | fold/timeout | settlement | pot 지급, 필요 시 10 벌칙 |
| showdown | 높은 카드 | settlement | 승자에게 pot 지급 |
| showdown | 동률 | settlement | pot 유지, `carriedFromTie=true` |
| settlement | 한쪽 stack 0, pot 0 | finished | 상대 승리 |
| settlement | 다음 앤티 가능 | dealing | opener 교대, handNumber 증가 |
| settlement | 동률 이월인데 한쪽이 앤티 불가 | dealing 또는 finished | pot을 반씩 반환 후 다시 종료 조건 확인 |

특수 경계:

- 앤티를 내기 전 stack이 0이면 즉시 finished다.
- 앤티 뒤 두 사람 중 한 명의 추가 유효 베팅 가능액이 0이면 자동 showdown한다.
- 동률 pot은 두 사람의 동일 contribution 합이므로 항상 짝수다. 앤티 불가 시 정확히 절반씩 반환할 수 있다.
- 10 벌칙으로 폴드 플레이어가 0이 되면 즉시 패배한다.
- 종료 판정은 모든 정산과 벌칙 이후 한 번만 한다.

## 6. 타이머

- 매 행동 기본 30초.
- 남은 시간이 0이 되면 time bank에서 최대 30초를 이어 사용한다.
- time bank도 0이면 서버가 `blind/fold`와 같은 정산을 실행한다.
- 연결이 끊겨도 deadline은 유지한다.
- 2회 연속 시간 초과는 매치 몰수로 처리한다.
- 현 공통 일시정지는 캐주얼 방에서 방장 1회만 허용하도록 후속 룸 설정이 필요하다. 그 전까지 포커 모듈에서는 pause를 노출하지 않는 것이 안전하다.

## 7. UI 구성

데스크톱:

1. 상단: 상대 이름, stack, 타이머, 크게 보이는 상대 카드
2. 중앙: deck count, pot, 이번 손 contribution, opener 표시
3. 하단: `?` 카드 뒷면, 내 stack, Fold / Call N / Raise slider·stepper
4. 우측: 공개된 과거 카드 기록과 텍스트 행동 로그

모바일:

- 상대 카드와 pot을 첫 화면에 유지한다.
- 행동 바는 화면 하단 safe-area 위에 고정한다.
- raise 금액은 `-`, 숫자, `+`, 빠른 선택 25%·50%·최대 버튼을 제공한다.
- 로그는 바텀시트로 접는다.

접근성:

- 자기 카드는 항상 `내 카드는 볼 수 없습니다`로 읽는다.
- 숨은 rank를 DOM attribute, title, test id에 넣지 않는다.
- pot, call 금액, actor, 남은 시간을 live region으로 알린다.
- Fold와 최대 Raise는 확인 단계를 제공하되 10 여부를 암시하지 않는다.

## 8. 파일 작업표

| 파일 | 작업 |
|---|---|
| `src/shared/games.ts` | 정의 추가, `[2]`, 독자 제목·설명 |
| `src/game-modules/blind-card-duel/index.tsx` | 상태, reducer, projection, 컴포넌트 |
| `src/game-modules/ui-styles/blind-card-duel.css` | 반응형 카드·테이블·행동 바 |
| `src/game-modules/catalog.ts` | 서버 카탈로그 등록 |
| `src/game-modules/ui-registry.ts` | lazy UI 등록 |
| `server/index.ts` | 점수 추출과 scheduled timeout 연결 |
| `scripts/qa-privacy.ts` | A/B/null projection exact allowlist |
| `scripts/qa-timeouts.ts` | 자동 fold와 10 벌칙 |
| `scripts/qa-all-games.ts` | 결정적 playthrough |
| `docs/16-blind-card-duel.md` | 사용자용 1분·상세 규칙 |

## 9. 테스트 벡터

1. A=7, B=4, call → A pot 획득
2. A=5, B=5 → pot 이월, 새 손 앤티 뒤 총량 보존
3. A의 숨은 카드=10, A fold, 남은 stack 14 → B에게 추가 10
4. A의 숨은 카드=10, A fold, 남은 stack 6 → B에게 추가 6, A 패배
5. A의 숨은 카드=9, timeout → 일반 fold, 벌칙 없음
6. 동일 actionId call 3회 → 정산 1회
7. 오래된 revision raise → 상태 무변경
8. A snapshot에 A rank 없음, B rank 있음
9. null viewer snapshot에 두 rank 없음
10. refresh 후 동일 상대 카드·stack·deadline 복원
11. 덱 20장에 각 rank 정확히 2개, 중복 card id 없음
12. 덱 0장인 손 종료 후 다음 손 전에만 reshuffle

## 10. 완료 기준

- 위 12개 테스트가 모두 자동화된다.
- 100개의 seed에서 칩 총량과 카드 유일성 property test가 통과한다.
- 네트워크·DOM·접근성 스냅샷에서 자기 rank 문자열이 발견되지 않는다.
- 360px, 768px, 1440px에서 카드와 행동 버튼이 겹치지 않는다.
- 키보드만으로 open, call, raise, fold가 가능하다.
- build와 모든 기존 QA가 통과한다.

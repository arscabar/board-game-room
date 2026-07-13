# 공통 플랫폼 선행 변경 명세

## 1. 현재 구조에서 확인된 제약

- `src/game-modules/types.ts:3-10`: `GameContext`에 서버 시각과 RNG가 없다.
- `src/game-modules/types.ts:12-15`: 액션이 `type/payload`만 가져 중복 전송과 오래된 상태 요청을 구분할 수 없다.
- `src/game-modules/types.ts:24-34`: 결과가 다음 예약 이벤트와 동시 행동자를 표현하지 못한다.
- `server/index.ts:333-340`: `viewerId`가 없으면 현재 private state에서 새 projection을 만들지 않는다.
- `server/index.ts:893-939`: 타이머가 `activePlayerId` 한 명과 단일 `turnDeadlineAt`에 묶여 있다.
- `server/index.ts:1435-1490`: `game:action`이 revision·actionId 없이 곧바로 `applyAction`을 호출한다.
- `src/App.tsx:2167-2203`: 모듈 활성화가 한 명의 `activePlayerId`와 게임 ID 예외에 의존한다.
- `src/App.tsx:2417-2435`: `InteractiveGameWrapper`도 `isMyTurn`만 전달받으므로 동시 행동 capability를 함께 반영해야 한다.
- `src/game-modules/catalog.ts:94-95`: 지원 인원을 1–4명으로 제한한다.
- `src/shared/eligibility.ts:3`: 방 최대 인원이 4명으로 고정되어 있다.
- `src/components/interactive-space/CafeTableObject.tsx:70-76`: 로비 테이블 좌석을 최대 4개만 그린다.

## 2. 결정된 확장 방식

기존 게임을 한 번에 재작성하지 않고 하위 호환 필드를 추가한다.

### 2.1 액션 전송 봉투

```ts
interface GameActionEnvelope {
  actionId: string;
  expectedRevision: number;
  action: GameAction;
}
```

서버 처리 규칙:

1. 인증된 방·좌석을 확인한다.
2. 같은 `actionId`가 처리된 적 있으면 저장된 ack를 그대로 반환한다.
3. 기본 `strict` 게임은 `expectedRevision !== room.gameState.revision`이면 상태를 바꾸지 않고 최신 snapshot과 충돌 오류를 반환한다.
4. 액션을 적용하고 `revision += 1`한다.
5. `(roomCode, playerId, actionId)` 기준 최근 결과를 방 수명 동안 제한된 LRU에 보관한다.

동시 게임은 다른 플레이어의 정상 제출 때문에 전역 revision이 바뀌므로 예외가 필요하다.

```ts
type ActionConcurrency = "strict" | "phase-scoped";
```

- `strict`: 포커·타일 공방처럼 전역 revision이 정확히 일치해야 한다.
- `phase-scoped`: 모자이크 러시처럼 payload의 `roundId`, `puzzleId`, 개인 `draftRevision`이 현재 값과 일치하고 해당 플레이어가 아직 완료하지 않았다면, 다른 플레이어 때문에 전역 revision이 증가했어도 제출을 허용한다.
- phase-scoped도 이전 라운드 제출, 이미 완료한 사람의 재제출, 마감 후 제출은 거절한다.
- actionId 멱등성은 두 방식 모두 동일하다.

하위 호환 기간에는 기존 `{ action }` 요청도 받고 서버가 임시 actionId와 현재 revision을 부여한다. 신규 세 게임은 봉투 사용을 필수로 한다.

### 2.2 서버 서비스 주입

모듈 파일은 서버와 브라우저 번들 양쪽에서 import되므로 `node:crypto`를 게임 모듈에서 직접 import하지 않는다.

```ts
interface GameServices {
  now: number;
  randomInt(maxExclusive: number): number;
  randomId(): string;
}

interface GameContext {
  // 기존 필드 유지
  services: GameServices;
}
```

- 운영 서버는 CSPRNG 기반 `randomInt`를 제공한다.
- QA는 seed 기반 결정적 구현을 주입한다.
- 각 셔플은 Fisher–Yates를 공통 유틸로 수행한다.
- 재현이 필요한 테스트는 seed와 초기 덱 순서의 해시만 테스트 로그에 남긴다.

### 2.3 상호작용 capability

```ts
type InteractionMode = "turn" | "simultaneous" | "phase";

interface GameActionResult {
  // 기존 필드 유지
  interactivePlayerIds?: string[];
  deadlineAt?: number | null;
  scheduledEvent?: ScheduledGameEvent | null;
}
```

- `turn`: 기존 `activePlayerId`와 동일하게 한 명만 행동한다.
- `simultaneous`: `interactivePlayerIds`에 포함된 모든 사람이 행동한다.
- `phase`: 단계마다 한 명 또는 여러 명이 바뀐다.
- `App.tsx`는 게임 ID 하드코딩 대신 `interactivePlayerIds.includes(currentPlayer.id)`로 `disabled`와 `InteractiveGameWrapper`의 `canInteract`를 계산한다.
- 필드가 없는 기존 게임은 `activePlayerId`로 fallback한다.

### 2.4 예약 이벤트

```ts
interface ScheduledGameEvent {
  id: string;
  type: string;
  dueAt: number;
}

interface GameModule {
  applyScheduledEvent?: (
    state: unknown,
    event: ScheduledGameEvent,
    context: GameContext
  ) => GameActionResult;
}
```

- 서버는 방별 이벤트 하나 이상을 `(roomCode, eventId)`로 예약한다.
- 새 결과가 같은 ID를 대체하거나 `null`을 반환하면 이전 타이머를 취소한다.
- callback은 방·eventId·dueAt·revision을 다시 검사한 뒤 원자적으로 적용한다.
- 타임아웃과 사용자 액션이 경합하면 서버 event loop에서 먼저 검증을 통과한 한쪽만 revision을 변경한다.
- 기존 턴 타이머는 당장 제거하지 않고 신규 세 게임부터 예약 이벤트를 사용한다.

### 2.5 공개 상태와 로그

- `snapshotRoom`은 `viewerId: null`이어도 현재 private state를 `getPublicState`에 통과시킨다.
- `viewerId: null`은 관전자 또는 비인증 뷰로 취급하고 모든 손·카드·뒷면 타일·개인 퍼즐 draft를 제거한다.
- `moveLog`에는 숨은 카드, 타일 ID, 퍼즐 정답, RNG seed를 기록하지 않는다.
- 운영 감사 로그가 필요하면 일반 RoomSnapshot과 분리한다.

### 2.6 통계 확장

`server/index.ts`의 `scoreForPlayer`에 다음을 추가한다.

- `blind-card-duel`: 최종 보유 칩
- `parity-tile-duel`: 개인 또는 팀 누적 점수
- `mosaic-rush`: 총 보석 가치와 해결 퍼즐 수

팀전은 2차 범위이므로 첫 구현에서는 개인 `winnerId`만 사용한다.

## 3. 예상 수정 파일

| 파일 | 변경 |
|---|---|
| `src/game-modules/types.ts` | 서비스, 상호작용자, 예약 이벤트, action envelope 타입 |
| `src/shared/types.ts` | runtime revision, interactivePlayerIds, gameDeadlineAt |
| `server/index.ts` | envelope 검증, LRU, RNG/clock 주입, 예약 이벤트, null viewer projection, 통계 |
| `src/App.tsx` | capability 기반 disabled·InteractiveGameWrapper와 deadline 표시 |
| `src/shared/timers.ts` | 기존 턴 타이머와 신규 모듈 deadline 역할 분리 |
| `scripts/qa-action-envelope.ts` | revision·멱등성·deadline 경합 테스트 신규 추가 |
| `scripts/qa-game-catalog.ts` | `docFile` 문자열뿐 아니라 실제 문서 존재 여부 검사 |
| `package.json` | `qa:actions` 스크립트 추가 |

## 4. 공통 완료 기준

- 같은 action envelope를 3번 보내도 상태 revision은 1만 증가한다.
- strict 게임의 오래된 revision 요청은 상태를 바꾸지 않고 최신 revision을 돌려준다.
- phase-scoped 게임은 같은 라운드의 서로 다른 플레이어 동시 제출을 모두 수락하되 이전 라운드 제출은 거절한다.
- seed를 고정하면 100회 셔플 결과가 재현된다.
- 우봉고형 public state에서 4명이 동시에 `disabled=false`가 될 수 있다.
- 예약 이벤트가 대체·취소된 뒤 낡은 callback이 상태를 변경하지 못한다.
- `viewerId:null` snapshot에 포커 카드, 타일 패 값, 퍼즐 개인 배치가 없다.
- 기존 14개 게임의 QA와 build가 회귀 없이 통과한다.

## 5. 구현 순서

1. action envelope와 revision
2. RNG·clock 주입
3. capability 기반 interaction
4. 예약 이벤트
5. null viewer projection
6. 신규 공통 QA
7. 블라인드 카드 듀얼 착수

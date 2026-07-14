# 타이거 앤 드래곤 (`parity-tile-duel`) 구현 명세

참고 계통: 타이거 앤 드래곤의 공격·방어·패스 구조. 공개 가능한 기본 에셋과 전장 데이터는 독자 제작하며, 정식판을 목표로 하면 Oink/Arclight 라이선스 및 계약 판본 검증을 별도 진행한다.

## 1. MVP 범위

- 인원: 2–4명 개인전
- 목표 점수: 10점
- 4인 팀전과 공식 5인전은 2차 범위
- 숫자 타일: 값 `n`을 `n`개씩, 1–8 총 36개
- 홀수 대응 특수 타일 1개, 짝수 대응 특수 타일 1개
- 매치 시작 때 뒷면 전장 1장을 서버가 무작위로 골라 공개하고 매치 끝까지 유지
- 독자 개발 fixture 전장 3종으로 엔진을 완성한 뒤 정식 데이터 적용 여부 결정

인원별 패:

| 인원 | 기본 패 | 시작자 패 | 미사용 |
|---:|---:|---:|---:|
| 2 | 13 | 14 | 11 |
| 3 | 11 | 12 | 4 |
| 4 | 9 | 10 | 1 |

## 2. 타일과 방어식

```ts
type NumberTile = {
  id: string;
  kind: "number";
  value: 1|2|3|4|5|6|7|8;
};

type SpecialTile = {
  id: string;
  kind: "odd-special" | "even-special";
};

type DuelTile = NumberTile | SpecialTile;
```

```ts
function canDefend(attack: DuelTile, defense: DuelTile): boolean {
  if (attack.kind === "number" && defense.kind === "number") {
    return attack.value === defense.value;
  }
  if (attack.kind === "number") {
    return attack.value % 2 === 0
      ? defense.kind === "even-special"
      : defense.kind === "odd-special";
  }
  if (defense.kind !== "number") return false;
  return attack.kind === "even-special"
    ? defense.value % 2 === 0
    : defense.value % 2 === 1;
}
```

- 특수 타일도 공격과 방어에 모두 사용할 수 있다.
- 방어할 수 있어도 패스할 수 있다.
- 방어에 성공한 플레이어가 즉시 새 공격자가 된다.

## 3. 상태 모델

```ts
type TileDuelPhase =
  | "round-setup"
  | "choose-attack"
  | "await-defense"
  | "continuation"
  | "round-result"
  | "finished";

interface TurnPair {
  defense: { tileId: string; faceDown: boolean } | null;
  attack: { tileId: string } | null;
}

interface TileDuelPrivateState {
  phase: TileDuelPhase;
  playerIds: string[];
  battlefieldId: string;
  targetScore: number;
  scores: Record<string, number>;
  roundNumber: number;
  startSeat: number;
  attackerId: string | null;
  responderId: string | null;
  currentAttack: { playerId: string; tileId: string } | null;
  hands: Record<string, DuelTile[]>;
  unusedTiles: DuelTile[];
  boards: Record<string, {
    openingAttackId: string | null;
    pairs: TurnPair[];
  }>;
  passedPlayerIds: string[];
  timeoutCounts: Record<string, number>;
  deadlineAt: number | null;
  winnerId: string | null;
  lastRoundWinnerId: string | null;
  lastFinishTileId: string | null;
  message: string;
}
```

타일 보존 불변식:

- 38개 tile id는 hands, unusedTiles, 모든 공개 board slot 중 정확히 한 곳에 있다.
- 뒷면 보너스 타일도 board에 이동한 실제 tile id다.
- `await-defense`에는 currentAttack과 responderId가 존재한다.
- 새 currentAttack이 생기면 `passedPlayerIds=[]`로 초기화한다.

## 4. 응답 순환

1. 공격자가 타일을 공개 공격으로 낸다.
2. 공격자의 왼쪽에 있는 생존 좌석부터 responder가 된다.
3. responder는 합법 방어 또는 패스를 선택한다.
4. 패스하면 `passedPlayerIds`에 추가하고 다음 좌석으로 이동한다.
5. 다른 플레이어가 방어하면 pass 기록을 지우고 그 플레이어가 새 공격을 선택한다.
6. 공격자를 제외한 모두가 패스해 다시 공격자 차례가 되면 `continuation`으로 전환한다.
7. continuation에서는 보너스 뒷면 타일과 새 공개 공격을 한 원자 액션으로 낸다.

누군가 새 공격을 낼 때마다 이전에 패스했던 사람도 다시 응답할 수 있다.

## 5. 액션

```ts
type TileDuelAction =
  | { type: "tile/attack"; payload: { tileId: string } }
  | { type: "tile/defend"; payload: { tileId: string } }
  | { type: "tile/pass" }
  | {
      type: "tile/continue";
      payload: { bonusTileId: string | null; attackTileId: string };
    }
  | { type: "tile/next-round" };
```

`attack`:

- phase=`choose-attack`, actor=`attackerId`
- 소유한 손 타일
- 공개 공격으로 이동한 즉시 손이 0이면 라운드 종료

`defend`:

- phase=`await-defense`, actor=`responderId`
- 소유 타일이고 `canDefend`가 true
- 연결된 가장 왼쪽 빈 방어 slot에 공개 배치
- 손이 0이면 새 공격 없이 즉시 라운드 종료
- 손이 남으면 responder가 attacker가 되고 phase=`choose-attack`

`pass`:

- 방어 가능 여부와 관계없이 허용
- 다음 responder 또는 continuation을 서버가 결정

`continue`:

- phase=`continuation`, actor=`attackerId`
- 손이 2개 이상이면 서로 다른 `bonusTileId`와 `attackTileId`가 필요
- bonus는 뒷면 방어 slot, attack은 공개 공격 slot으로 원자 이동
- 손이 1개면 `bonusTileId=null`만 허용하고 마지막 한 장을 공개 공격으로 내며 라운드 종료

## 6. 점수 데이터 경계

```ts
interface BattlefieldDefinition {
  id: string;
  name: string;
  scoreFinish(input: {
    finishTile: DuelTile;
    winnerId: string;
    boards: TileDuelPrivateState["boards"];
    playerCount: number;
    roundContext: Record<string, unknown>;
  }): { base: number; bonus: number; reasons: string[] };
}
```

공통 우선 규칙:

- 숫자 1 마무리: 10점
- 특수 타일 마무리: 1점, 뒷면 보너스 없음
- 2인전: 뒷면 보너스 점수 없음

마지막 두 규칙은 현재 `중간` 신뢰도이므로 계약 판본 검증 항목으로 테스트 이름에 `provisional`을 붙인다.

개발 fixture:

1. `flat`: 숫자 2–8은 2점
2. `parity`: 3·5·7은 3점, 2·4·6·8은 4점
3. `risk-one`: 1은 공통 10점, 그 외 3점

공식 전장 10종은 라이선스와 실물 규칙 대조 후 별도 `licensed-battlefields.ts`에 추가한다. 핵심 reducer가 특정 전장 이름을 하드코딩해서는 안 된다.

## 7. 공개 상태

공개:

- scores, battlefield, round, start seat
- current attack과 responder
- 모든 앞면 공격·방어 타일
- 뒷면 보너스의 위치와 개수
- 각 플레이어 handCount
- pass 순서와 timeoutCount

비공개:

- 상대와 팀원의 손 타일 값·ID
- unusedTiles
- 뒷면 보너스의 값·ID

projection에서는 숨은 타일을 실제 ID 대신 위치 기반 임시 key로 바꾼다. moveLog에도 `hidden bonus`만 기록한다.

## 8. 라운드와 종료

라운드 종료 우선순위:

1. 공격 또는 방어 적용
2. 손이 0인지 검사
3. 마지막 공개 타일 결정
4. battlefield score 계산
5. 점수 반영
6. 10점 이상이면 match finished
7. 아니면 round-result 후 다음 start seat을 왼쪽으로 이동

한 라운드에 한 명만 점수를 받으므로 개인전 동시 10점은 발생하지 않는다.

## 9. 타이머·이탈

- 응답: 25초, 만료 시 자동 pass
- 공격·continuation: 40초
- 공격 선택 첫 만료: 20초 추가 유예와 경고
- 추가 유예 만료: 해당 라운드 몰수, 점수 없음, start seat 이동
- 같은 플레이어의 공격 몰수 2회: 매치 몰수
- 자동으로 임의 타일을 내지 않는다.
- 재접속해도 서버 deadline은 유지된다.

## 10. UI

데스크톱:

- 중앙: 현재 공격 타일, 공격자→응답자 흐름
- 좌석별: 공격·방어 쌍 보드와 handCount
- 하단: 내 타일 랙, `방어`, `패스`, `공격` 버튼
- 우측: 전장 점수 카드와 점수 계산 근거

모바일:

- 상단 점수·전장 요약
- 중앙 current attack과 responder
- 하단 타일 랙 2행과 고정 행동 바
- continuation은 `보너스 선택 → 공격 선택 → 두 타일 확인` 3단계 UI

접근성:

- 숫자 타일에는 숫자만 크게 표시하고, 별도 규칙표에서 `호랑이 ↔ 2·4·6·8`, `용 ↔ 1·3·5·7` 관계를 항상 문자로 확인할 수 있게 한다.
- `숫자 4 타일, 현재 공격을 방어할 수 있음`처럼 읽는다.
- board의 DOM 순서는 실제 공격·방어 시간 순서와 일치한다.
- 뒷면은 값·ID 없이 `보너스 타일`로만 읽는다.

## 11. 파일 작업표

| 파일 | 작업 |
|---|---|
| `src/shared/games.ts` | `[2,3,4]` 정의 |
| `src/game-modules/parity-tile-duel/index.tsx` | reducer, projection, UI |
| `src/game-modules/parity-tile-duel/battlefields.ts` | 독자 fixture와 점수 인터페이스 |
| `src/game-modules/ui-styles/parity-tile-duel.css` | 타일 랙·보드·반응형 |
| `src/game-modules/catalog.ts` | 등록 |
| `src/game-modules/ui-registry.ts` | lazy 등록 |
| `server/index.ts` | 점수 추출, timeout scheduled event |
| `scripts/qa-privacy.ts` | 상대 패·unused·뒷면 값 차단 |
| `scripts/qa-timeouts.ts` | auto pass·공격 몰수 |
| `scripts/qa-all-games.ts` | 2·3·4인 playthrough |
| `docs/17-parity-tile-duel.md` | 사용자 규칙 |

## 12. 테스트 벡터

- 36개 숫자 타일의 값별 개수가 정확히 n개
- 인원별 deal count와 unused count 일치
- 모든 attack×defense 조합 100% 행렬 테스트
- 방어 가능해도 pass 허용
- 방어 후 새 공격 시 pass 목록 초기화
- 전원 pass 뒤 continuation 정확히 한 번
- 1장 남은 continuation은 bonus 금지
- 공격으로 손 0, 방어로 손 0 모두 즉시 종료
- 숨은 bonus와 unused tile이 모든 비소유 snapshot에서 제거
- 2인 provisional bonus 0, 특수 마무리 provisional 1
- target 10점 도달 즉시 종료
- duplicate defend·deadline 경합에서 타일 1회만 이동
- reconnect 후 자기 패만 동일하게 복원

## 13. 완료 기준

- 2·3·4인 deterministic playthrough가 각 20 seed에서 끝난다.
- 어떤 seed에서도 타일 38개 보존 불변식이 깨지지 않는다.
- 응답 자동 pass와 공격 몰수가 서버 예약 이벤트로 재현된다.
- privacy snapshot에 상대 tile id·value가 없다.
- 360px에서 최대 초기 패 14개를 스크롤 없이 모두 표시할 필요는 없지만, 키보드·터치로 모든 타일에 접근할 수 있다.
- 공식 전장 데이터가 없어도 fixture 3종으로 완전한 매치가 가능하다.

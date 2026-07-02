# Game module guide

새 게임은 `src/game-modules/<game-id>/index.tsx` 폴더 하나를 기준으로 추가합니다.

## 필수 파일과 등록 순서

1. `src/shared/games.ts`
   - `GameDefinition`을 추가합니다.
   - `id`는 폴더명, `module.id`, QA 식별자와 같아야 합니다.
   - `allowedPlayerCounts`, `learnUrl`, `docFile`, `table` 메타데이터를 빠뜨리지 않습니다.

2. `src/game-modules/<game-id>/index.tsx`
   - `module`과 `Component`를 export합니다.
   - `module.id`는 `GameDefinition.id`와 같아야 합니다.
   - `createInitialState`, `getPublicState`, `applyAction`을 구현합니다.
   - 비공개 정보가 있는 게임은 `getPublicState`에서 `viewerId` 기준으로 반드시 가립니다.

3. `src/game-modules/catalog.ts`
   - 새 모듈을 import합니다.
   - `gameCatalog`에 `registerGame("<game-id>", module, Component)` 한 줄을 추가합니다.

4. QA
   - 최소 `npm run qa:catalog`를 통과해야 합니다.
   - 비공개 정보가 있으면 `scripts/qa-privacy.ts`에 노출 방지 테스트를 추가합니다.
   - 자동 플레이가 가능하면 `scripts/qa-all-games.ts`에 playthrough 시나리오를 추가합니다.

## 구현 규칙

- 서버에 저장되는 `state`에는 비공개 원본 정보를 보관할 수 있지만, `getPublicState`는 플레이어별 공개 정보만 반환해야 합니다.
- 액션은 `{ type, payload }` 형태를 유지합니다.
- UI 컴포넌트는 직접 서버 상태를 바꾸지 않고 `onAction`만 호출합니다.
- 승리 시 `applyAction`은 `winnerId`, `phase`, `message`를 반환해야 전적 저장과 UI 종료 처리가 안정적입니다.

## 빠른 검증

```powershell
npm run qa:catalog
npm run build
npm run qa:privacy
npm run qa:games
```

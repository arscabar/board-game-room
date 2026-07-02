# Game module guide

새 게임은 `src/game-modules/<game-id>/index.tsx` 폴더 하나를 기준으로 추가합니다. 먼저 스캐폴딩으로 기본 파일을 만들고, 게임 정의와 카탈로그 등록을 연결한 뒤 실제 룰을 채우는 흐름을 권장합니다.

## 빠른 생성

```powershell
npm run create:game my-game "My Game" 2,4
```

이 명령은 아래 파일을 만듭니다.

```text
src/game-modules/my-game/index.tsx
```

그리고 터미널에 `src/shared/games.ts`에 넣을 `GameDefinition` 초안과 `src/game-modules/catalog.ts`에 넣을 import/register 줄을 출력합니다. 배열을 자동 수정하지 않는 이유는 게임 설명, 룰, 표시 순서, 우선순위를 사람이 직접 검토하는 편이 안전하기 때문입니다.

## 필수 파일과 등록 순서

1. `src/shared/games.ts`
   - `GameDefinition`을 추가합니다.
   - `id`는 폴더명, `module.id`, QA 식별자와 같아야 합니다.
   - `allowedPlayerCounts`, `learnUrl`, `docFile`, `table` 메타데이터를 빠뜨리지 않습니다.
   - `table.kind`는 로비 미리보기와 기본 보드 톤을 결정합니다. 기존 값 중 가장 가까운 것을 고르고, 특수 보드는 나중에 추가합니다.
   - `visual.iconKind`, `visual.thumbnailHint`, `visual.motionHint`, `visual.texture`는 선택 필드지만 새 게임에서는 반드시 검토합니다. 로비 행 썸네일, 설명 패널 시각 힌트, 애니메이션 QA가 이 값을 기준으로 정리됩니다.

2. `src/game-modules/<game-id>/index.tsx`
   - `module`과 `Component`를 export합니다.
   - `module.id`는 `GameDefinition.id`와 같아야 합니다.
   - `createInitialState`, `getPublicState`, `applyAction`을 구현합니다.
   - 비공개 정보가 있는 게임은 `getPublicState`에서 `viewerId` 기준으로 반드시 가립니다.
   - 스캐폴딩 파일의 `sample-action`은 임시 코드입니다. 실제 액션 타입과 상태 구조로 교체해야 합니다.

3. `src/game-modules/catalog.ts`
   - 새 모듈을 import합니다.
   - `gameCatalog`에 `registerGame("<game-id>", module, Component)` 한 줄을 추가합니다.

4. 디자인/모션
   - `GameDefinition.table.kind`가 로비 아이콘과 미니 보드 톤을 결정하므로 실제 보드와 가장 가까운 값을 고릅니다.
   - `GameDefinition.visual.iconKind`로 아이콘 계열을 덮어쓸 수 있습니다. `thumbnailHint`는 설명 패널의 시각 힌트 문구, `motionHint`는 핵심 조작 모션, `texture`는 주 오브젝트 질감입니다.
   - 로비 설명 패널의 `BoardPreview`가 충분히 직관적이지 않으면 `src/App.tsx`의 `BoardPreviewStage`에 게임별 미니 썸네일을 추가합니다.
   - 로비 게임 목록의 축소 썸네일도 같은 `BoardPreviewStage`를 재사용하므로, 82px 폭에서도 형태가 읽히는지 확인합니다.
   - 모듈 컴포넌트에는 상태를 나타내는 class를 명확히 둡니다. 예: `selected`, `legal`, `blocked`, `hidden`, `revealed`, `held`, `winner`, `path`, `preview`, `invalid`.
   - 오브젝트 질감은 모듈 고유 prefix 또는 `src/styles.css`의 공통 디자인 레이어에 추가합니다.
   - 모션은 `transform`과 `opacity` 중심으로 만들고, `prefers-reduced-motion: reduce`에서 반복 모션이 꺼지는지 확인합니다.
   - 비공개 정보가 있는 게임은 숨김 상태가 데이터뿐 아니라 UI에서도 뒷면/마스크/잠금 표현으로 명확해야 합니다.

5. QA
   - 최소 `npm run qa:catalog`를 통과해야 합니다.
   - 비공개 정보가 있으면 `scripts/qa-privacy.ts`에 노출 방지 테스트를 추가합니다.
   - 자동 플레이가 가능하면 `scripts/qa-all-games.ts`에 playthrough 시나리오를 추가합니다.

## 새 게임 구현 순서

1. 룰 문서를 먼저 정리합니다.
   - 플레이 인원
   - 공개 정보와 비공개 정보
   - 세팅
   - 턴 액션
   - 승리/무승부 조건
   - 점수 저장 방식

2. 상태 모델을 정합니다.
   - 서버 전용 원본 상태: 비밀 카드, 비밀 단어, 숨겨진 타일 값 포함 가능
   - 공개 상태: 현재 viewer에게 보여도 되는 정보만 포함
   - UI 임시 상태: 선택 중인 말, hover, 회전, 필터 등은 React state로만 둡니다.

3. `createInitialState`를 구현합니다.
   - 인원수별 초기 배치
   - 선공
   - 비공개 더미/패/단어
   - `phase`, `message` 기본값

4. `getPublicState`를 구현합니다.
   - 공개 게임은 그대로 반환해도 됩니다.
   - 추리/카드/단어 게임은 반드시 `viewerId` 기준으로 숨깁니다.
   - 상대에게 보이면 안 되는 원본 ID, 카드 값, 비밀 단어, 선택 타일을 제거합니다.

5. `applyAction`을 구현합니다.
   - 액션 타입 검증
   - 현재 차례 검증
   - 합법 수 검증
   - 상태 변경
   - 다음 플레이어/턴/라운드
   - 종료 시 `winnerId`, `phase`, `message`

6. `Component`를 구현합니다.
   - `publicState`만 보고 렌더링합니다.
   - 서버 상태 변경은 `onAction`으로만 요청합니다.
   - disabled일 때 조작 버튼이 눌리지 않아야 합니다.
   - 버튼, 말, 타일, 카드, 주사위 같은 주요 오브젝트에는 조작 가능/선택됨/불가 상태 class를 둡니다.

7. 테스트를 추가합니다.
   - `qa:catalog`: 등록/메타데이터 검증
   - `qa:privacy`: 비공개 정보 노출 방지
   - `qa:games`: 시작/플레이스루/승자 발생
   - 디자인 확인: 로비 미니 보드, 게임 플레이 화면, 모바일 360px 캡처

## 구현 규칙

- 서버에 저장되는 `state`에는 비공개 원본 정보를 보관할 수 있지만, `getPublicState`는 플레이어별 공개 정보만 반환해야 합니다.
- 액션은 `{ type, payload }` 형태를 유지합니다.
- UI 컴포넌트는 직접 서버 상태를 바꾸지 않고 `onAction`만 호출합니다.
- 승리 시 `applyAction`은 `winnerId`, `phase`, `message`를 반환해야 전적 저장과 UI 종료 처리가 안정적입니다.
- 새 CSS는 가능하면 해당 모듈 컴포넌트 안의 `<style>` 또는 모듈 고유 class prefix를 사용합니다.
- 공통 UI 규칙을 바꿀 때는 `src/styles.css`의 전체 앱 레이아웃에 영향이 없는지 캡처로 확인합니다.
- 새 게임의 디자인 체크는 `DESIGN_UPGRADE_PLAN.md`의 미니 보드, 상태 아이콘, 모션, 접근성 항목과 맞춰 진행합니다.

## 빠른 검증

```powershell
npm run qa:catalog
npm run build
npm run qa:privacy
npm run qa:games
```

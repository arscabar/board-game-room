import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getBattlefield, getBattlefieldDisplay } from "../src/game-modules/parity-tile-duel/battlefields";

type Contract = {
  label: string;
  pattern: RegExp;
};

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function verify(group: string, contents: string, contracts: Contract[]) {
  for (const contract of contracts) {
    assert.match(contents, contract.pattern, `${group}: ${contract.label}`);
  }
  console.log(`  PASS ${group} (${contracts.length} contracts)`);
}

const blindSource = source("../src/game-modules/blind-card-duel/index.tsx");
const blindCss = source("../src/game-modules/ui-styles/blind-card-duel.css");
const paritySource = source("../src/game-modules/parity-tile-duel/index.tsx");
const parityCss = source("../src/game-modules/ui-styles/parity-tile-duel.css");
const mosaicSource = source("../src/game-modules/mosaic-rush/index.tsx");
const mosaicCss = source("../src/game-modules/ui-styles/mosaic-rush.css");

console.log("Three-game accessibility/browser contract QA (source contracts)");
console.log("  INFO Playwright is not a project dependency; this suite does not claim browser execution.");
console.log("  INFO Rendered-markup coverage remains in qa:new-games.");

verify("인디언 포커 포커스 흐름", blindSource, [
  {
    label: "폴드 확인이 열리면 확정 버튼으로 포커스를 이동해야 함",
    pattern: /if \(confirmFold\) \{\s*confirmFoldButtonRef\.current\?\.focus\(\);/s
  },
  {
    label: "취소는 복원 플래그를 세우고 확인 UI를 닫아야 함",
    pattern: /restoreFoldFocusRef\.current = true;\s*setConfirmFold\(false\);/s
  },
  {
    label: "확인 UI가 닫힌 뒤 원래 폴드 버튼으로 포커스를 복원해야 함",
    pattern: /if \(restoreFoldFocusRef\.current\) \{\s*restoreFoldFocusRef\.current = false;\s*foldButtonRef\.current\?\.focus\(\);/s
  },
  {
    label: "전송이 접수된 폴드만 결과 포커스를 예약해야 함",
    pattern: /if \(submitAction\(\{ type: "fold" \}\)\) focusFoldResultRef\.current = true;/
  },
  {
    label: "베팅 종료 후 상태 메시지로 포커스를 이동해야 함",
    pattern: /if \(!focusFoldResultRef\.current \|\| state\.phase === "betting"\) return;[\s\S]*messageRef\.current\?\.focus\(\{ preventScroll: true \}\);/
  },
  {
    label: "상태와 폴드 버튼에 안정적인 자동화 식별자가 있어야 함",
    pattern: /data-bcd-focus-target="status"[\s\S]*data-bcd-focus-target="fold-confirm"[\s\S]*data-bcd-focus-target="fold"/
  }
]);

verify("인디언 포커 포커스 표시", blindCss, [
  {
    label: "프로그램 방식으로 이동한 상태 메시지에도 포커스 표시가 있어야 함",
    pattern: /\.bcd-message:focus-visible\s*\{[^}]*outline:/s
  },
  {
    label: "베팅 조작 영역은 최소 44px 높이를 유지해야 함",
    pattern: /\.bcd-actions button,\s*\.bcd-actions input\s*\{[^}]*min-height:\s*44px/s
  }
]);

verify("타이거 앤 드래곤 모달 접근성", paritySource, [
  {
    label: "전장 설명은 body 포털의 modal dialog여야 함",
    pattern: /data-ptd-battlefield-portal[\s\S]*role="dialog"[\s\S]*aria-modal="true"[\s\S]*document\.body/
  },
  {
    label: "모달이 열릴 때 배경을 inert와 aria-hidden으로 보호해야 함",
    pattern: /element\.setAttribute\("inert", ""\);\s*element\.setAttribute\("aria-hidden", "true"\);/s
  },
  {
    label: "늦게 추가된 body 형제도 MutationObserver로 보호해야 함",
    pattern: /new MutationObserver\([\s\S]*protectBackgroundElement\(addedNode\)[\s\S]*observe\(document\.body, \{ childList: true \}\)/
  },
  {
    label: "프로그램 방식 포커스 이탈을 캡처 단계에서 차단해야 함",
    pattern: /document\.addEventListener\("focusin", keepFocusInPortal, true\);/
  },
  {
    label: "모달 종료 시 observer, focus listener, body overflow를 모두 복원해야 함",
    pattern: /backgroundObserver\.disconnect\(\);[\s\S]*removeEventListener\("focusin", keepFocusInPortal, true\)[\s\S]*document\.body\.style\.overflow = previousBodyOverflow;/
  },
  {
    label: "Tab과 Shift+Tab 양방향 포커스 순환이 있어야 함",
    pattern: /event\.shiftKey && document\.activeElement === first[\s\S]*last\.focus\(\)[\s\S]*document\.activeElement === last[\s\S]*first\.focus\(\)/
  },
  {
    label: "실제 호출 버튼을 기억하고 닫힐 때 포커스를 되돌려야 함",
    pattern: /battlefieldReturnFocusRef\.current = trigger[\s\S]*scheduleBattlefieldFocus\(\(\) => trigger\)/
  },
  {
    label: "예약된 포커스 이동은 교체하거나 언마운트할 때 취소해야 함",
    pattern: /battlefieldFocusFrameRef\.current !== null[\s\S]*cancelAnimationFrame\(battlefieldFocusFrameRef\.current\)[\s\S]*useEffect\(\(\) => \(\) => \{[\s\S]*cancelAnimationFrame\(battlefieldFocusFrameRef\.current\)/
  }
]);

verify("타이거 앤 드래곤 확인 상태", paritySource, [
  {
    label: "확인 버튼은 본인 확인, disabled, 제출 중 상태를 모두 반영해야 함",
    pattern: /const canAcknowledgeBattlefield = Boolean\([\s\S]*!hasAcknowledgedBattlefield[\s\S]*!disabled[\s\S]*!isSubmitting[\s\S]*\);/
  },
  {
    label: "확인 현황은 atomic live status여야 함",
    pattern: /role="status" aria-live="polite" aria-atomic="true" aria-label="환경 확인 현황"/
  },
  {
    label: "확인 후 버튼은 재제출 불가하고 대기 상태를 알려야 함",
    pattern: /disabled=\{!canAcknowledgeBattlefield \|\| hasAcknowledgedBattlefield\}[\s\S]*hasAcknowledgedBattlefield \? "다른 플레이어 확인 대기 중"/
  }
]);

verify("타이거 앤 드래곤 저동작 적용 상태", parityCss, [
  {
    label: "저동작 환경에서도 적용 안내는 800ms 동안 보이는 상태를 유지해야 함",
    pattern: /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.ptd-battlefield-overlay\.is-applying\s*\{[^}]*opacity:\s*1\s*!important;[^}]*animation:\s*none\s*!important;/
  },
  {
    label: "저동작 환경에서는 흡수 링을 표시하지 않아야 함",
    pattern: /\.ptd-battlefield-overlay\.is-applying::after\s*\{\s*display:\s*none;\s*\}/
  },
  {
    label: "터치 중심 기기에서는 모달 배경 블러 비용을 제거해야 함",
    pattern: /@media \(pointer: coarse\)\s*\{\s*\.ptd-battlefield-overlay\s*\{\s*backdrop-filter:\s*none;/
  }
]);

for (const battlefieldId of ["balance-hall", "patient-kiln", "high-window"]) {
  const battlefield = getBattlefield(battlefieldId);
  const twoPlayerDisplay = getBattlefieldDisplay(battlefield, 2);
  const fourPlayerDisplay = getBattlefieldDisplay(battlefield, 4);
  assert.equal(twoPlayerDisplay.bonusLabel, "2인 보너스 없음", `${battlefield.name}: 2인 보너스 레이블`);
  assert.match(twoPlayerDisplay.description, /2인 대결에서는 뒷면 보너스를 계산하지 않습니다/, `${battlefield.name}: 2인 설명`);
  assert(twoPlayerDisplay.rules.some((rule) => /특수 타일 마무리는 보너스 없이 1점/.test(rule)), `${battlefield.name}: 특수 타일 공통 규칙`);
  assert.equal(fourPlayerDisplay.bonusLabel, `보너스 최대 ${battlefield.bonusLimit}`, `${battlefield.name}: 다인 보너스 레이블`);
  assert(fourPlayerDisplay.rules.some((rule) => rule.includes(`최대 ${battlefield.bonusLimit}점`)), `${battlefield.name}: 다인 보너스 규칙`);
}
console.log("  PASS 타이거 앤 드래곤 인원별 점수 설명 (3 battlefields × 5 contracts)");

verify("우봉고 회전·반전 의미", mosaicSource, [
  {
    label: "회전 버튼은 현재 각도를 accessible name으로 노출해야 함",
    pattern: /aria-label=\{`회전\. 현재 \$\{rotation \* 90\}도`\}/
  },
  {
    label: "회전은 0, 90, 180, 270도 순환이어야 함",
    pattern: /setRotation\(\(value\) => \(value \+ 1\) % 4\)/
  },
  {
    label: "반전 토글은 aria-pressed와 동일한 상태를 사용해야 함",
    pattern: /aria-pressed=\{flipped\}[\s\S]*setFlipped\(\(value\) => !value\)/
  },
  {
    label: "실루엣과 배치 요청이 동일한 rotation, flipped 값을 사용해야 함",
    pattern: /(?=[\s\S]*PieceSilhouette id=\{pieceId\} rotation=\{rotation\} flipped=\{flipped\})(?=[\s\S]*payload: \{ pieceId, x, y, rotation, flipped \})/
  },
  {
    label: "퍼즐 변경 시 회전과 반전 상태를 초기화해야 함",
    pattern: /setRotation\(0\);\s*setFlipped\(false\);\s*\}, \[state\.puzzle\?\.id\]\);/s
  },
  {
    label: "스크롤 가능한 퍼즐 영역은 키보드 포커스와 안내 이름을 제공해야 함",
    pattern: /className="mosaic-rush__grid-scroll"[\s\S]*role="region"[\s\S]*좁은 화면에서는 좌우로 스크롤할 수 있습니다[\s\S]*tabIndex=\{0\}/
  }
]);

verify("우봉고 360/768/1280 레이아웃 계약", mosaicCss, [
  {
    label: "좁은 화면에서도 각 열은 최소 44px이어야 함",
    pattern: /min-inline-size:\s*calc\(var\(--mosaic-columns\) \* 44px\)/
  },
  {
    label: "각 퍼즐 셀은 44px 정사각형이어야 함",
    pattern: /\.mosaic-rush__cell\s*\{[^}]*min-inline-size:\s*44px[^}]*min-block-size:\s*44px[^}]*aspect-ratio:\s*1/s
  },
  {
    label: "360px 계약을 포함하는 400px breakpoint가 있어야 함",
    pattern: /@media \(max-width:\s*400px\)/
  },
  {
    label: "768px 인접 계약을 위한 760px breakpoint가 있어야 함",
    pattern: /@media \(max-width:\s*760px\)/
  },
  {
    label: "1280px에서 보드는 430px 상한과 퍼즐 비율을 사용해야 함",
    pattern: /inline-size:\s*min\(100%, var\(--mosaic-fit-width\)\)[^}]*max-inline-size:\s*var\(--mosaic-fit-width\)[^}]*aspect-ratio:\s*var\(--mosaic-aspect\)/s
  },
  {
    label: "보드 넘침은 페이지가 아니라 내부 스크롤 영역에 머물러야 함",
    pattern: /\.mosaic-rush__grid-scroll\s*\{[^}]*max-inline-size:\s*100%[^}]*overflow-x:\s*auto/s
  },
  {
    label: "키보드 포커스가 보이는 스크롤 영역이어야 함",
    pattern: /\.mosaic-rush__grid-scroll:focus-visible\s*\{[^}]*outline:/s
  }
]);

console.log("Three-game accessibility/browser contract QA passed.");

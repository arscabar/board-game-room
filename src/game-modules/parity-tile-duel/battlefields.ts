export type ParityTileKind = "number" | "odd-special" | "even-special";

export interface ParityTile {
  id: string;
  kind: ParityTileKind;
  value?: number;
}

export interface BattlefieldScore {
  points: number;
  reasons: string[];
}

export interface BattlefieldDefinition {
  id: string;
  name: string;
  description: string;
  numberRules: string[];
  bonusLimit: number;
  score: (tile: ParityTile, bonusCount: number, playerCount: number) => BattlefieldScore;
}

export interface BattlefieldDisplay {
  description: string;
  bonusLabel: string;
  rules: string[];
}

function commonScore(tile: ParityTile): BattlefieldScore | null {
  if (tile.kind !== "number") {
    return { points: 1, reasons: ["문양패 마무리 1점", "문양패에는 보너스가 붙지 않습니다."] };
  }
  if (tile.value === 1) {
    return { points: 10, reasons: ["숫자 1 마무리 10점"] };
  }
  return null;
}

function scored(
  tile: ParityTile,
  bonusCount: number,
  playerCount: number,
  base: number,
  baseReason: string,
  bonusLimit: number
): BattlefieldScore {
  const exceptional = commonScore(tile);
  if (exceptional) return exceptional;
  const appliedBonus = playerCount === 2 ? 0 : Math.min(bonusCount, bonusLimit);
  return {
    points: base + appliedBonus,
    reasons: [
      baseReason,
      playerCount === 2
        ? "2인 대결에서는 뒷면 보너스를 계산하지 않습니다."
        : `뒷면 보너스 ${appliedBonus}점`
    ]
  };
}

/** 독자 제작 점수 전장. 상용 게임의 전장명·문구·배점은 사용하지 않는다. */
export const BATTLEFIELDS: BattlefieldDefinition[] = [
  {
    id: "balance-hall",
    name: "균형의 회랑",
    description: "짝수와 홀수의 마무리 점수가 다른 전장입니다. 어떤 계열을 남길지 끝까지 조율해야 합니다.",
    numberRules: ["짝수 2·4·6·8 마무리는 4점", "홀수 3·5·7 마무리는 3점"],
    bonusLimit: 2,
    score: (tile, bonus, count) => {
      const even = tile.kind === "number" && (tile.value ?? 0) % 2 === 0;
      return scored(tile, bonus, count, even ? 4 : 3, even ? "2·4·6·8 마무리 4점" : "3·5·7 마무리 3점", 2);
    }
  },
  {
    id: "patient-kiln",
    name: "인내의 가마",
    description: "숫자 마무리의 기본 점수는 2점이며, 오래 쌓은 뒷면 타일이 힘을 발휘하는 전장입니다.",
    numberRules: ["숫자 2·3·4·5·6·7·8 마무리는 2점"],
    bonusLimit: 3,
    score: (tile, bonus, count) => scored(tile, bonus, count, 2, "숫자 마무리 2점", 3)
  },
  {
    id: "high-window",
    name: "높은 창의 공방",
    description: "높은 숫자를 지켜 마무리할수록 더 큰 점수를 얻는 전장입니다.",
    numberRules: ["숫자 2·3·4·5 마무리는 2점", "숫자 6·7·8 마무리는 5점"],
    bonusLimit: 1,
    score: (tile, bonus, count) => {
      const high = tile.kind === "number" && (tile.value ?? 0) >= 6;
      return scored(tile, bonus, count, high ? 5 : 2, high ? "높은 숫자 마무리 5점" : "낮은 숫자 마무리 2점", 1);
    }
  }
];

export function getBattlefield(id: string) {
  return BATTLEFIELDS.find((field) => field.id === id) ?? BATTLEFIELDS[0];
}

export function getBattlefieldDisplay(field: BattlefieldDefinition, playerCount: number): BattlefieldDisplay {
  const bonusRule = playerCount === 2
    ? "2인 대결에서는 뒷면 보너스를 계산하지 않습니다."
    : `뒷면 보너스는 최대 ${field.bonusLimit}점까지 추가됩니다.`;
  return {
    description: `${field.description} ${bonusRule}`,
    bonusLabel: playerCount === 2 ? "2인 보너스 없음" : `보너스 최대 ${field.bonusLimit}`,
    rules: [
      "숫자 1로 마무리하면 10점",
      ...field.numberRules,
      "호랑이·용 특수 타일 마무리는 보너스 없이 1점",
      bonusRule
    ]
  };
}

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
  score: (tile: ParityTile, bonusCount: number, playerCount: number) => BattlefieldScore;
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
    description: "홀수 마무리 3점, 짝수 마무리 4점. 보너스는 최대 2점입니다.",
    score: (tile, bonus, count) => {
      const even = tile.kind === "number" && (tile.value ?? 0) % 2 === 0;
      return scored(tile, bonus, count, even ? 4 : 3, even ? "짝수 마무리 4점" : "홀수 마무리 3점", 2);
    }
  },
  {
    id: "patient-kiln",
    name: "인내의 가마",
    description: "숫자 마무리 2점. 쌓아 둔 보너스는 최대 3점까지 더합니다.",
    score: (tile, bonus, count) => scored(tile, bonus, count, 2, "숫자 마무리 2점", 3)
  },
  {
    id: "high-window",
    name: "높은 창의 공방",
    description: "2–5는 2점, 6–8은 5점. 보너스는 최대 1점입니다.",
    score: (tile, bonus, count) => {
      const high = tile.kind === "number" && (tile.value ?? 0) >= 6;
      return scored(tile, bonus, count, high ? 5 : 2, high ? "높은 숫자 마무리 5점" : "낮은 숫자 마무리 2점", 1);
    }
  }
];

export function getBattlefield(id: string) {
  return BATTLEFIELDS.find((field) => field.id === id) ?? BATTLEFIELDS[0];
}


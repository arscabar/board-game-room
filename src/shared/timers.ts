export const timedGameIds = [
  "davinci-code-plus",
  "blokus",
  "yacht-dice",
  "blind-card-duel",
  "parity-tile-duel",
  "mosaic-rush"
] as const;

const timedGameIdSet = new Set<string>(timedGameIds);

export const turnTimerOptions = [
  { label: "1분", value: 60_000 },
  { label: "2분", value: 120_000 },
  { label: "3분", value: 180_000 },
  { label: "5분", value: 300_000 }
] as const;

export function gameUsesTurnTimer(gameId: string | null | undefined) {
  return Boolean(gameId && timedGameIdSet.has(gameId));
}

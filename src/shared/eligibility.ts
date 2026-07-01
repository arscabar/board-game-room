import type { GameDefinition } from "./types";

export const ROOM_MAX_PLAYERS = 4;

export function canPlayGame(game: GameDefinition, playerCount: number) {
  return game.allowedPlayerCounts.includes(playerCount);
}

export function formatAllowedPlayers(game: GameDefinition) {
  const counts = game.allowedPlayerCounts;
  if (counts.length === 1) {
    return `${counts[0]}명`;
  }

  const isContinuous = counts.every((count, index) => index === 0 || count === counts[index - 1] + 1);
  if (isContinuous) {
    return `${counts[0]}~${counts[counts.length - 1]}명`;
  }

  return `${counts.join(", ")}명`;
}

export function gameAvailabilityLabel(game: GameDefinition, playerCount: number) {
  if (canPlayGame(game, playerCount)) {
    return "선택 가능";
  }

  return `${formatAllowedPlayers(game)} 필요`;
}

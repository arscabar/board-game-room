import type { GameDefinition } from "./types";

const rasterGameCoverIds = new Set([
  "abalone-classic",
  "blind-card-duel",
  "blokus",
  "davinci-code-plus",
  "ghosts",
  "guryongtu",
  "hangman-board-game",
  "mosaic-rush",
  "parity-tile-duel",
  "qawale",
  "quoridor",
  "yacht-dice",
  "yinsh"
]);

const commercialGameCovers: Record<string, string> = {
  "blind-card-duel": "/board-assets/game-covers/blind-card-duel-commercial-v2.webp",
  "parity-tile-duel": "/board-assets/game-covers/parity-tile-duel-commercial-v2.webp",
  "mosaic-rush": "/board-assets/game-covers/mosaic-rush-commercial-v2.webp"
};

export function gameCoverSrc(game: GameDefinition) {
  const commercialCover = commercialGameCovers[game.id];

  if (commercialCover) {
    return commercialCover;
  }

  return `/board-assets/game-covers/${game.id}.${rasterGameCoverIds.has(game.id) ? "webp" : "svg"}`;
}

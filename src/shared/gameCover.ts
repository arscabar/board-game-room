import type { GameDefinition } from "./types";

const rasterGameCoverIds = new Set([
  "abalone-classic",
  "blokus",
  "davinci-code-plus",
  "ghosts",
  "guryongtu",
  "hangman-board-game",
  "qawale",
  "quoridor",
  "yacht-dice",
  "yinsh"
]);

export function gameCoverSrc(game: GameDefinition) {
  return `/board-assets/game-covers/${game.id}.${rasterGameCoverIds.has(game.id) ? "webp" : "svg"}`;
}

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { GameComponentProps } from "./types";

type GameComponent = ComponentType<GameComponentProps<any>>;
type GameComponentLoader = LazyExoticComponent<GameComponent>;

const gameComponents: Record<string, GameComponentLoader> = {
  guryongtu: lazy(() => import("./guryongtu").then((module) => ({ default: module.Component as GameComponent }))),
  quoridor: lazy(() => import("./quoridor").then((module) => ({ default: module.Component as GameComponent }))),
  "abalone-classic": lazy(() => import("./abalone-classic").then((module) => ({ default: module.Component as GameComponent }))),
  ghosts: lazy(() => import("./ghosts").then((module) => ({ default: module.Component as GameComponent }))),
  qawale: lazy(() => import("./qawale").then((module) => ({ default: module.Component as GameComponent }))),
  "davinci-code-plus": lazy(() => import("./davinci-code-plus").then((module) => ({ default: module.Component as GameComponent }))),
  blokus: lazy(() => import("./blokus").then((module) => ({ default: module.Component as GameComponent }))),
  "yacht-dice": lazy(() => import("./yacht-dice").then((module) => ({ default: module.Component as GameComponent }))),
  yinsh: lazy(() => import("./yinsh").then((module) => ({ default: module.Component as GameComponent }))),
  "hangman-board-game": lazy(() => import("./hangman-board-game").then((module) => ({ default: module.Component as GameComponent })))
};

export function getGameComponent(gameId: string | null | undefined) {
  if (!gameId) {
    return null;
  }
  return gameComponents[gameId] ?? null;
}

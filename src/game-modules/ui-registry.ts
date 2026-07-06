import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { GameComponentProps } from "./types";

type GameComponent = ComponentType<GameComponentProps<any>>;
type GameComponentLoader = LazyExoticComponent<GameComponent>;
type GameModuleWithComponent = { Component: GameComponent };

const loadSharedGameStyles = () => import("./ui-styles/shared-board.css");

function lazyGame(
  loader: () => Promise<GameModuleWithComponent>,
  styleLoaders: Array<() => Promise<unknown>>
): GameComponentLoader {
  return lazy(async () => {
    const [module] = await Promise.all([loader(), loadSharedGameStyles(), ...styleLoaders.map((loadStyle) => loadStyle())]);
    return { default: module.Component as GameComponent };
  });
}

const gameComponents: Record<string, GameComponentLoader> = {
  guryongtu: lazyGame(() => import("./guryongtu"), [() => import("./ui-styles/guryongtu.css")]),
  quoridor: lazyGame(() => import("./quoridor"), [() => import("./ui-styles/quoridor.css")]),
  "abalone-classic": lazyGame(() => import("./abalone-classic"), [() => import("./ui-styles/abalone-classic.css")]),
  ghosts: lazyGame(() => import("./ghosts"), [() => import("./ui-styles/ghosts.css")]),
  qawale: lazyGame(() => import("./qawale"), [() => import("./ui-styles/qawale.css")]),
  omok: lazyGame(() => import("./omok"), [() => import("./ui-styles/omok.css")]),
  alkkagi: lazyGame(() => import("./alkkagi"), [() => import("./ui-styles/alkkagi.css")]),
  kkukkkuki: lazyGame(() => import("./kkukkkuki"), [() => import("./ui-styles/kkukkkuki.css")]),
  "davinci-code-plus": lazyGame(() => import("./davinci-code-plus"), [() => import("./ui-styles/davinci-code-plus.css")]),
  blokus: lazyGame(() => import("./blokus"), [() => import("./ui-styles/blokus.css")]),
  "yacht-dice": lazyGame(() => import("./yacht-dice"), [() => import("./ui-styles/yacht-dice.css")]),
  yinsh: lazyGame(() => import("./yinsh"), [() => import("./ui-styles/yinsh.css")]),
  "hangman-board-game": lazyGame(() => import("./hangman-board-game"), [() => import("./ui-styles/hangman-board-game.css")])
};

export function getGameComponent(gameId: string | null | undefined) {
  if (!gameId) {
    return null;
  }
  return gameComponents[gameId] ?? null;
}

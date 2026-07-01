import type { ComponentType } from "react";
import type { GameComponentProps, GameModule } from "./types";
import { module as abaloneModule, Component as AbaloneComponent } from "./abalone-classic";
import { module as blokusModule, Component as BlokusComponent } from "./blokus";
import { module as davinciModule, Component as DavinciComponent } from "./davinci-code-plus";
import { module as ghostsModule, Component as GhostsComponent } from "./ghosts";
import { module as guryongtuModule, Component as GuryongtuComponent } from "./guryongtu";
import { module as hangmanModule, Component as HangmanComponent } from "./hangman-board-game";
import { module as qawaleModule, Component as QawaleComponent } from "./qawale";
import { module as quoridorModule, Component as QuoridorComponent } from "./quoridor";
import { module as yachtModule, Component as YachtComponent } from "./yacht-dice";
import { module as yinshModule, Component as YinshComponent } from "./yinsh";

export interface GameRegistration {
  module: GameModule;
  Component: ComponentType<GameComponentProps<any>>;
}

export const gameRegistrations: Record<string, GameRegistration> = {
  "abalone-classic": {
    module: abaloneModule,
    Component: AbaloneComponent
  },
  blokus: {
    module: blokusModule,
    Component: BlokusComponent
  },
  "davinci-code-plus": {
    module: davinciModule,
    Component: DavinciComponent
  },
  ghosts: {
    module: ghostsModule,
    Component: GhostsComponent
  },
  guryongtu: {
    module: guryongtuModule,
    Component: GuryongtuComponent
  },
  "hangman-board-game": {
    module: hangmanModule,
    Component: HangmanComponent
  },
  qawale: {
    module: qawaleModule,
    Component: QawaleComponent
  },
  quoridor: {
    module: quoridorModule,
    Component: QuoridorComponent
  },
  "yacht-dice": {
    module: yachtModule,
    Component: YachtComponent
  },
  yinsh: {
    module: yinshModule,
    Component: YinshComponent
  }
};

export function getGameRegistration(gameId: string | null | undefined) {
  if (!gameId) {
    return null;
  }

  return gameRegistrations[gameId] ?? null;
}

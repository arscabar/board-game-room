import type { ComponentType } from "react";
import { games } from "../shared/games";
import type { GameDefinition } from "../shared/types";
import type { GameComponentProps, GameModule } from "./types";
import { module as abaloneModule, Component as AbaloneComponent } from "./abalone-classic";
import { module as alkkagiModule, Component as AlkkagiComponent } from "./alkkagi";
import { module as blokusModule, Component as BlokusComponent } from "./blokus";
import { module as davinciModule, Component as DavinciComponent } from "./davinci-code-plus";
import { module as ghostsModule, Component as GhostsComponent } from "./ghosts";
import { module as guryongtuModule, Component as GuryongtuComponent } from "./guryongtu";
import { module as hangmanModule, Component as HangmanComponent } from "./hangman-board-game";
import { module as kkukkkukiModule, Component as KkukkkukiComponent } from "./kkukkkuki";
import { module as masterpieceCopyModule, Component as MasterpieceCopyComponent } from "./masterpiece-copy";
import { module as omokModule, Component as OmokComponent } from "./omok";
import { module as qawaleModule, Component as QawaleComponent } from "./qawale";
import { module as quoridorModule, Component as QuoridorComponent } from "./quoridor";
import { module as yachtModule, Component as YachtComponent } from "./yacht-dice";
import { module as yinshModule, Component as YinshComponent } from "./yinsh";
import { module as blindCardDuelModule, Component as BlindCardDuelComponent } from "./blind-card-duel";
import { module as parityTileDuelModule, Component as ParityTileDuelComponent } from "./parity-tile-duel";
import { module as mosaicRushModule, Component as MosaicRushComponent } from "./mosaic-rush";

export interface GameRegistration {
  id: string;
  definition: GameDefinition;
  module: GameModule;
  Component: ComponentType<GameComponentProps<any>>;
}

const definitionsById = new Map(games.map((game) => [game.id, game]));

function registerGame(
  id: string,
  module: GameModule,
  Component: ComponentType<GameComponentProps<any>>
): GameRegistration {
  const definition = definitionsById.get(id);
  if (!definition) {
    throw new Error(`Game module '${id}' does not have a matching shared game definition.`);
  }

  return {
    id,
    definition,
    module,
    Component
  };
}

export const gameCatalog = [
  registerGame("guryongtu", guryongtuModule, GuryongtuComponent),
  registerGame("quoridor", quoridorModule, QuoridorComponent),
  registerGame("abalone-classic", abaloneModule, AbaloneComponent),
  registerGame("ghosts", ghostsModule, GhostsComponent),
  registerGame("qawale", qawaleModule, QawaleComponent),
  registerGame("omok", omokModule, OmokComponent),
  registerGame("alkkagi", alkkagiModule, AlkkagiComponent),
  registerGame("kkukkkuki", kkukkkukiModule, KkukkkukiComponent),
  registerGame("davinci-code-plus", davinciModule, DavinciComponent),
  registerGame("blokus", blokusModule, BlokusComponent),
  registerGame("masterpiece-copy", masterpieceCopyModule, MasterpieceCopyComponent),
  registerGame("yacht-dice", yachtModule, YachtComponent),
  registerGame("yinsh", yinshModule, YinshComponent),
  registerGame("hangman-board-game", hangmanModule, HangmanComponent),
  registerGame("blind-card-duel", blindCardDuelModule, BlindCardDuelComponent),
  registerGame("parity-tile-duel", parityTileDuelModule, ParityTileDuelComponent),
  registerGame("mosaic-rush", mosaicRushModule, MosaicRushComponent)
] satisfies GameRegistration[];

export const gameRegistrations: Record<string, GameRegistration> = Object.fromEntries(
  gameCatalog.map((registration) => [registration.id, registration])
);

export function getGameRegistration(gameId: string | null | undefined) {
  if (!gameId) {
    return null;
  }

  return gameRegistrations[gameId] ?? null;
}

export function validateGameCatalog() {
  const errors: string[] = [];
  const definitionIds = new Set(games.map((game) => game.id));
  const registrationIds = new Set(gameCatalog.map((registration) => registration.id));

  for (const game of games) {
    if (!registrationIds.has(game.id)) {
      errors.push(`${game.id}: shared game definition exists but no game module is registered.`);
    }
    if (!game.title.trim()) {
      errors.push(`${game.id}: title is required.`);
    }
    if (!game.learnUrl.trim()) {
      errors.push(`${game.id}: learnUrl is required.`);
    }
    if (!game.docFile.trim()) {
      errors.push(`${game.id}: docFile is required.`);
    }
    if (game.allowedPlayerCounts.length === 0 || game.allowedPlayerCounts.some((count) => count < 1 || count > 4)) {
      errors.push(`${game.id}: allowedPlayerCounts must contain values between 1 and 4.`);
    }
  }

  for (const registration of gameCatalog) {
    if (!definitionIds.has(registration.id)) {
      errors.push(`${registration.id}: registered module has no shared game definition.`);
    }
    if (registration.module.id !== registration.id) {
      errors.push(`${registration.id}: module.id '${registration.module.id}' does not match registration id.`);
    }
    if (registration.definition.id !== registration.id) {
      errors.push(`${registration.id}: definition.id '${registration.definition.id}' does not match registration id.`);
    }
  }

  if (registrationIds.size !== gameCatalog.length) {
    errors.push("Duplicate game ids exist in gameCatalog.");
  }
  if (definitionIds.size !== games.length) {
    errors.push("Duplicate game ids exist in shared games.");
  }

  return errors;
}

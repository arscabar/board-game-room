import { gameCatalog, validateGameCatalog } from "../src/game-modules/catalog";
import { games } from "../src/shared/games";

const errors = validateGameCatalog();

console.table(
  gameCatalog.map((registration) => ({
    id: registration.id,
    title: registration.definition.title,
    players: registration.definition.allowedPlayerCounts.join(","),
    module: registration.module.id
  }))
);

if (errors.length > 0) {
  throw new Error(`Game catalog validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

console.log(`Game catalog OK: ${gameCatalog.length} modules registered for ${games.length} game definitions.`);

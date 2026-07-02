import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const cliArgs = userArgs();

function userArgs() {
  const args = process.argv.slice(1);
  const scriptIndex = args.findIndex((arg) => arg.replace(/\\/g, "/").endsWith("scripts/create-game-module.ts"));
  return scriptIndex === -1 ? args : args.slice(scriptIndex + 1);
}

function argValue(name: string) {
  const prefix = `--${name}=`;
  const index = cliArgs.indexOf(`--${name}`);
  if (index !== -1) {
    return cliArgs[index + 1];
  }
  return cliArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function printHelp() {
  console.log(`
Create a starter game module.

Usage:
  npm run create:game my-game "My Game" 2,4
  npx tsx scripts/create-game-module.ts --id=my-game --title="My Game" --players=2,4

Options:
  positional  npm-friendly form: <id> ["title"] [players]
  --id        Direct tsx form. Kebab-case game id. Must match the folder name, module.id, and GameDefinition.id.
  --title     Direct tsx form. Display title. Defaults to a title-cased id.
  --players   Direct tsx form. Comma-separated player counts. Defaults to 2.

After generation:
  1. Add the printed GameDefinition snippet to src/shared/games.ts.
  2. Add the printed import/register lines to src/game-modules/catalog.ts.
  3. Replace the starter rules and UI with the real game.
  4. Run npm run qa:catalog && npm run build.
`.trim());
}

function toTitle(id: string) {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function toPascalCase(id: string) {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("");
}

function toCamelCase(id: string) {
  const pascal = toPascalCase(id);
  return pascal.slice(0, 1).toLowerCase() + pascal.slice(1);
}

function parsePlayers(value: string | undefined) {
  const players = (value ?? "2")
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((count) => Number.isInteger(count) && count >= 1 && count <= 4);
  return [...new Set(players)].sort((a, b) => a - b);
}

function splitPositionalArgs(args: string[]) {
  const id = args[0] ?? "";
  const rest = args.slice(1);
  const playerParts: string[] = [];

  while (rest.length > 0 && /^\d+([,\s]+\d+)*$/.test(rest[rest.length - 1])) {
    playerParts.unshift(rest.pop() ?? "");
  }

  return {
    id,
    title: rest.join(" "),
    players: playerParts.join(",")
  };
}

function moduleTemplate(id: string, title: string, pascalName: string) {
  return `import type { GameComponentProps, GameModule } from "../types";
import { nextPlayerId } from "../types";

type ${pascalName}State = {
  phase: "playing" | "finished";
  message: string;
  winnerId: string | null;
  actions: Array<{ playerId: string; playerName: string; label: string }>;
};

function assert${pascalName}State(state: unknown): ${pascalName}State {
  if (!state || typeof state !== "object") {
    throw new Error("${title} state is invalid.");
  }
  return state as ${pascalName}State;
}

export const module: GameModule = {
  id: "${id}",
  createInitialState: ({ players }) =>
    ({
      phase: "playing",
      message: \`\${players[0]?.name ?? "첫 플레이어"} 차례입니다.\`,
      winnerId: null,
      actions: []
    }) satisfies ${pascalName}State,
  getPublicState: (state) => assert${pascalName}State(state),
  applyAction: (state, action, context) => {
    const currentState = assert${pascalName}State(state);
    if (currentState.phase === "finished") {
      throw new Error("이미 끝난 게임입니다.");
    }
    if (action.type !== "${id}/sample-action") {
      throw new Error("지원하지 않는 행동입니다.");
    }

    const currentPlayer = context.players.find((player) => player.id === context.currentPlayerId);
    const actions = [
      ...currentState.actions,
      {
        playerId: context.currentPlayerId,
        playerName: currentPlayer?.name ?? "플레이어",
        label: String((action.payload as { label?: unknown } | undefined)?.label ?? "행동")
      }
    ];
    const winnerId = actions.length >= 5 ? context.currentPlayerId : null;
    const nextActivePlayerId = winnerId ? null : nextPlayerId(context.players, context.activePlayerId);

    return {
      state: {
        ...currentState,
        phase: winnerId ? "finished" : "playing",
        winnerId,
        actions,
        message: winnerId ? \`\${currentPlayer?.name ?? "플레이어"} 승리\` : "다음 플레이어 차례입니다."
      } satisfies ${pascalName}State,
      log: \`\${currentPlayer?.name ?? "플레이어"} sample action\`,
      activePlayerId: nextActivePlayerId,
      turnNumber: context.turnNumber + 1,
      phase: winnerId ? "finished" : "playing",
      message: winnerId ? \`\${currentPlayer?.name ?? "플레이어"} 승리\` : "다음 플레이어 차례입니다.",
      winnerId
    };
  }
};

export function Component({
  currentPlayer,
  publicState,
  disabled,
  onAction
}: GameComponentProps<${pascalName}State>) {
  const state = assert${pascalName}State(publicState);

  return (
    <div className="game-module generic-game-module">
      <section className="module-card">
        <h3>${title}</h3>
        <p>{state.message}</p>
        <button
          className="module-action"
          type="button"
          disabled={disabled || state.phase === "finished"}
          onClick={() => onAction({ type: "${id}/sample-action", payload: { label: "sample" } })}
        >
          샘플 행동
        </button>
      </section>
      <section className="module-card">
        <h4>진행 기록</h4>
        {state.actions.length === 0 ? (
          <p>아직 행동이 없습니다.</p>
        ) : (
          <ol>
            {state.actions.map((entry, index) => (
              <li key={\`\${entry.playerId}-\${index}\`}>
                {entry.playerName}: {entry.label}
              </li>
            ))}
          </ol>
        )}
        {currentPlayer ? <p>현재 접속: {currentPlayer.name}</p> : null}
      </section>
    </div>
  );
}
`;
}

function gameDefinitionSnippet(id: string, title: string, players: number[]) {
  return `{
  id: "${id}",
  title: "${title}",
  original: "${title}",
  allowedPlayerCounts: [${players.join(", ")}],
  scoreState: "점수제 아님",
  priority: "중간",
  genre: "장르를 입력하세요",
  board: "보드 구성을 입력하세요",
  docFile: "${id}.md",
  learnUrl: "https://example.com",
  accent: "#2f6f73",
  summary: "게임 요약을 입력하세요.",
  components: ["구성품을 입력하세요"],
  setup: ["세팅 규칙을 입력하세요"],
  turnFlow: ["턴 진행 규칙을 입력하세요"],
  winCondition: "승리 조건을 입력하세요.",
  implementation: ["구현할 룰을 입력하세요"],
  table: {
    kind: "duel",
    primaryMetric: "주요 상태",
    secondaryMetric: "보조 상태",
    uiHint: "테이블 UI 힌트를 입력하세요"
  }
}`;
}

async function main() {
  if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
    printHelp();
    return;
  }

  const positional = splitPositionalArgs(cliArgs.filter((arg) => !arg.startsWith("--")));
  const id = (argValue("id") ?? positional.id ?? "").trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    throw new Error("A kebab-case --id is required. Example: --id=my-game");
  }

  const title = (argValue("title") ?? positional.title ?? toTitle(id)).trim() || toTitle(id);
  const players = parsePlayers(argValue("players") ?? positional.players);
  if (players.length === 0) {
    throw new Error("--players must contain values between 1 and 4. Example: --players=2,4");
  }

  const pascalName = toPascalCase(id);
  const camelName = toCamelCase(id);
  const gameDir = path.join(root, "src", "game-modules", id);
  const indexFile = path.join(gameDir, "index.tsx");

  await fs.mkdir(gameDir, { recursive: true });
  try {
    await fs.writeFile(indexFile, moduleTemplate(id, title, pascalName), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${path.relative(root, indexFile)} already exists.`);
    }
    throw error;
  }

  console.log(`Created ${path.relative(root, indexFile)}`);
  console.log("\nAdd this GameDefinition to src/shared/games.ts:\n");
  console.log(gameDefinitionSnippet(id, title, players));
  console.log("\nAdd these lines to src/game-modules/catalog.ts:\n");
  console.log(`import { module as ${camelName}Module, Component as ${pascalName}Component } from "./${id}";`);
  console.log(`registerGame("${id}", ${camelName}Module, ${pascalName}Component),`);
  console.log("\nThen run:");
  console.log("npm run qa:catalog");
  console.log("npm run build");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import { module as abaloneModule } from "../src/game-modules/abalone-classic";
import { module as blokusModule } from "../src/game-modules/blokus";
import { module as kkukkkukiModule } from "../src/game-modules/kkukkkuki";
import { module as quoridorModule } from "../src/game-modules/quoridor";
import { module as yinshModule } from "../src/game-modules/yinsh";
import { solutionForMosaicChallenge } from "../src/game-modules/mosaic-rush";
import { validateGameCatalog } from "../src/game-modules/catalog";
import { games, getGameById } from "../src/shared/games";
import type { Ack, GameDefinition, RoomSnapshot } from "../src/shared/types";
import type { GameAction, GameContext, GameModule } from "../src/game-modules/types";
import type { StatsSummary } from "../src/shared/stats";

type QaClient = {
  name: string;
  socket: Socket;
  playerId: string;
  room: RoomSnapshot | null;
};

type GameTable = {
  code: string;
  game: GameDefinition;
  clients: QaClient[];
};

type QaResult = {
  gameId: string;
  title: string;
  players: number;
  mode: string;
  run?: number;
  actions: number;
  completed: boolean;
  winner: string;
  note: string;
};

type PlayOptions = {
  playerCount?: number;
  seed?: number;
};

type PlayScenario = (baseUrl: string, options?: PlayOptions) => Promise<QaResult>;

const CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "choice",
  "fourKind",
  "fullHouse",
  "smallStraight",
  "largeStraight",
  "yacht"
];

const qaAvatar = {
  body: "pawn",
  face: "smile",
  accessory: "none",
  palette: "teal"
} as const;

const qawaleScript: Array<{ playerIndex: number; action: GameAction }> = [
  {
    playerIndex: 0,
    action: {
      type: "distribute",
      payload: { source: { row: 0, col: 0 }, path: [{ row: 1, col: 0 }, { row: 2, col: 0 }, { row: 3, col: 0 }] }
    }
  },
  {
    playerIndex: 1,
    action: {
      type: "distribute",
      payload: { source: { row: 0, col: 3 }, path: [{ row: 1, col: 3 }, { row: 2, col: 3 }, { row: 3, col: 3 }] }
    }
  },
  {
    playerIndex: 0,
    action: {
      type: "distribute",
      payload: { source: { row: 1, col: 3 }, path: [{ row: 2, col: 3 }, { row: 3, col: 3 }] }
    }
  },
  {
    playerIndex: 1,
    action: {
      type: "distribute",
      payload: {
        source: { row: 3, col: 3 },
        path: [{ row: 2, col: 3 }, { row: 1, col: 3 }, { row: 0, col: 3 }, { row: 0, col: 2 }, { row: 0, col: 1 }]
      }
    }
  },
  {
    playerIndex: 0,
    action: {
      type: "distribute",
      payload: { source: { row: 3, col: 0 }, path: [{ row: 2, col: 0 }, { row: 1, col: 0 }, { row: 0, col: 0 }, { row: 0, col: 1 }] }
    }
  },
  {
    playerIndex: 1,
    action: {
      type: "distribute",
      payload: { source: { row: 0, col: 0 }, path: [{ row: 0, col: 1 }, { row: 0, col: 2 }] }
    }
  },
  {
    playerIndex: 0,
    action: {
      type: "distribute",
      payload: { source: { row: 0, col: 1 }, path: [{ row: 1, col: 1 }, { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 }] }
    }
  },
  {
    playerIndex: 1,
    action: {
      type: "distribute",
      payload: { source: { row: 1, col: 1 }, path: [{ row: 0, col: 1 }, { row: 0, col: 0 }] }
    }
  }
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createRng(seed: number) {
  let current = seed >>> 0;
  return () => {
    current = (current * 1664525 + 1013904223) >>> 0;
    return current / 2 ** 32;
  };
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object", "Could not allocate a QA port.");
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000, label = "condition") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForHealth(baseUrl: string) {
  await waitFor(async () => {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, 15000, "server health");
}

async function startServer() {
  const port = process.env.QA_PORT ? Number(process.env.QA_PORT) : await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  if (process.env.QA_EXTERNAL_SERVER === "true") {
    await waitForHealth(baseUrl);
    return { baseUrl, child: null as ChildProcessWithoutNullStreams | null };
  }

  const statsFile = path.join(os.tmpdir(), `board-game-room-qa-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    STATS_FILE: statsFile
  };
  delete env.DATABASE_URL;
  const child = spawn(process.execPath, [tsxCli, "server/index.ts"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  const lines: string[] = [];
  child.stdout.on("data", (chunk) => lines.push(String(chunk).trim()));
  child.stderr.on("data", (chunk) => lines.push(String(chunk).trim()));
  child.once("exit", (code) => {
    if (code !== null && code !== 0) {
      lines.push(`server exited with ${code}`);
    }
  });

  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${lines.join("\n")}`);
  }

  return { baseUrl, child };
}

async function stopServer(child: ChildProcessWithoutNullStreams | null) {
  if (!child || child.killed) {
    return;
  }
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    await delay(250);
    return;
  }
  child.kill();
  await delay(250);
}

async function createClient(baseUrl: string, name: string): Promise<QaClient> {
  const socket = io(baseUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ["websocket", "polling"]
  });
  const client: QaClient = { name, socket, playerId: "", room: null };
  socket.on("room:state", (room: RoomSnapshot) => {
    client.room = room;
  });
  socket.connect();
  await waitFor(() => socket.connected, 5000, `${name} socket connection`);
  return client;
}

async function emitAck<T>(client: QaClient, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    client.socket.timeout(5000).emit(event, payload, (error: Error | null, response: Ack<T>) => {
      if (error) {
        reject(error);
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? `${event} failed`));
        return;
      }
      if (response.data && typeof response.data === "object" && "status" in response.data) {
        client.room = response.data as RoomSnapshot;
      }
      resolve(response.data as T);
    });
  });
}

async function settleTable(table: GameTable) {
  const reference = table.clients.find((client) => client.room)?.room;
  if (!reference) {
    return;
  }
  await waitFor(
    () =>
      table.clients.every(
        (client) =>
          client.room?.code === table.code &&
          client.room.gameState.activePlayerId === reference.gameState.activePlayerId &&
          client.room.gameState.turnNumber === reference.gameState.turnNumber &&
          client.room.gameState.phase === reference.gameState.phase
      ),
    1500,
    `${table.game.id} room broadcast`
  ).catch(() => undefined);
}

async function createStartedRoom(baseUrl: string, gameId: string, playerCount: number): Promise<GameTable> {
  const game = getGameById(gameId);
  assert(game, `Unknown game ${gameId}`);
  const clients: QaClient[] = [];
  const host = await createClient(baseUrl, `${game.title}-P1`);
  clients.push(host);

  const created = await emitAck<{ room: RoomSnapshot; playerId: string }>(host, "room:create", { name: host.name });
  host.playerId = created.playerId;
  host.room = created.room;

  for (let index = 2; index <= playerCount; index += 1) {
    const client = await createClient(baseUrl, `${game.title}-P${index}`);
    clients.push(client);
    const joined = await emitAck<{ room: RoomSnapshot; playerId: string }>(client, "room:join", {
      code: created.room.code,
      name: client.name
    });
    client.playerId = joined.playerId;
    client.room = joined.room;
  }

  await waitFor(
    () => clients.every((client) => client.room?.players.filter((player) => player.connected).length === playerCount),
    3000,
    `${gameId} joins`
  );
  await emitAck<RoomSnapshot>(host, "room:select-game", { code: created.room.code, gameId });
  await emitAck<RoomSnapshot>(host, "room:start-game", { code: created.room.code });
  await settleTable({ code: created.room.code, game, clients });
  assert(host.room?.status === "playing", `${game.title} did not start.`);
  assert(host.room?.gameState.publicState, `${game.title} did not expose public state.`);

  return { code: created.room.code, game, clients };
}

async function closeTable(table: GameTable, returnLobby = false) {
  if (returnLobby && table.clients[0]?.socket.connected) {
    await emitAck<RoomSnapshot>(table.clients[0], "room:return-lobby", { code: table.code }).catch(() => undefined);
  }
  for (const client of table.clients) {
    client.socket.disconnect();
  }
  await delay(20);
}

function activeClient(table: GameTable) {
  const activePlayerId = table.clients[0].room?.gameState.activePlayerId;
  assert(activePlayerId, `${table.game.title} has no active player.`);
  const client = table.clients.find((candidate) => candidate.playerId === activePlayerId);
  assert(client, `${table.game.title} active client is missing.`);
  return client;
}

function publicState<T = any>(table: GameTable, client = table.clients[0]) {
  const state = client.room?.gameState.publicState as T | undefined;
  assert(state, `${table.game.title} public state is missing.`);
  return state;
}

function recordFrom(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function winnerLabel(table: GameTable) {
  const room = table.clients[0].room;
  const state = recordFrom(room?.gameState.publicState);
  const winnerIds = new Set<string>();
  const runtimeWinner = (room?.gameState as Record<string, unknown> | undefined)?.winnerId;
  const publicWinner = state?.winnerId;

  if (typeof runtimeWinner === "string" && runtimeWinner) {
    winnerIds.add(runtimeWinner);
  }
  if (typeof publicWinner === "string" && publicWinner) {
    winnerIds.add(publicWinner);
  }
  if (Array.isArray(state?.winnerIds)) {
    for (const winnerId of state.winnerIds) {
      if (typeof winnerId === "string" && winnerId) {
        winnerIds.add(winnerId);
      }
    }
  }

  if (winnerIds.size === 0) {
    return "-";
  }

  return [...winnerIds]
    .map((winnerId) => room?.players.find((player) => player.id === winnerId)?.name ?? winnerId)
    .join(", ");
}

async function gameAction(table: GameTable, client: QaClient, action: GameAction) {
  assert(client.room, `${table.game.title} client room is not ready.`);
  const state = recordFrom(client.room.gameState.publicState);
  const scopedAction: GameAction = {
    ...action,
    actionId: action.actionId ?? `qa-${client.playerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    expectedRevision: action.expectedRevision ?? client.room.gameState.revision,
    scopeId: action.scopeId ?? (typeof state?.scopeId === "string" ? state.scopeId : undefined)
  };
  const room = await emitAck<RoomSnapshot>(client, "game:action", { code: table.code, action: scopedAction });
  client.room = room;
  await settleTable(table);
  return room;
}

function contextFor(table: GameTable, currentPlayerId: string): GameContext {
  const room = table.clients[0].room;
  assert(room, `${table.game.title} room is not ready.`);
  return {
    game: table.game,
    players: room.players,
    activePlayerId: room.gameState.activePlayerId,
    currentPlayerId,
    turnNumber: room.gameState.turnNumber,
    roundNumber: room.gameState.roundNumber
  };
}

function tryLocal(module: GameModule, table: GameTable, state: unknown, action: GameAction, playerId: string) {
  return module.applyAction(clone(state), action, contextFor(table, playerId));
}

async function runStartMatrix(baseUrl: string): Promise<QaResult[]> {
  const results: QaResult[] = [];
  for (const game of games) {
    for (const count of game.allowedPlayerCounts) {
      console.log(`[matrix] ${game.title} ${count}p`);
      const table = await createStartedRoom(baseUrl, game.id, count);
      const room = table.clients[0].room;
      results.push({
        gameId: game.id,
        title: game.title,
        players: count,
        mode: "start",
        actions: 0,
        completed: room?.status === "playing" && room.selectedGameId === game.id,
        winner: "-",
        note: "room create/join/select/start"
      });
      await closeTable(table, true);
    }
  }
  return results;
}

async function playGuryongtu(baseUrl: string, _options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "guryongtu", 2);
  let actions = 0;
  const plans = new Map<string, number[]>(
    table.clients.map((client, index) => [
      client.playerId,
      index === 0 ? [9, 8, 7, 6, 5, 4, 3, 2, 1] : [8, 7, 6, 5, 4, 3, 2, 1, 9]
    ])
  );

  while (publicState<any>(table).phase !== "complete" && actions < 20) {
    const client = activeClient(table);
    const remaining = publicState<any>(table, client).remainingTiles[client.playerId] as number[];
    const tile = plans.get(client.playerId)?.find((candidate) => remaining.includes(candidate)) ?? remaining[0];
    await gameAction(table, client, { type: "guryongtu/select-tile", payload: { tile } });
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "complete" && winner !== "-";
  await closeTable(table);
  return { gameId: "guryongtu", title: "구룡투", players: 2, mode: "playthrough", actions, completed, winner, note: "full duel" };
}

async function playOmok(baseUrl: string, _options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "omok", 2);
  let actions = 0;
  const plans = new Map<string, Array<{ row: number; col: number }>>([
    [table.clients[0].playerId, [3, 4, 5, 6, 7].map((col) => ({ row: 7, col }))],
    [table.clients[1].playerId, [3, 4, 5, 6].map((col) => ({ row: 8, col }))]
  ]);

  while (publicState<any>(table).phase === "playing" && actions < 12) {
    const client = activeClient(table);
    const plan = plans.get(client.playerId);
    assert(plan && plan.length > 0, "Omok scripted coordinate not found.");
    await gameAction(table, client, { type: "omok/place-stone", payload: plan.shift() });
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "complete" && winner !== "-";
  await closeTable(table);
  return { gameId: "omok", title: "오목", players: 2, mode: "playthrough", actions, completed, winner, note: "scripted horizontal five" };
}

async function playAlkkagi(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const playerCount = options.playerCount ?? 4;
  const table = await createStartedRoom(baseUrl, "alkkagi", playerCount);
  let actions = 0;

  while (publicState<any>(table).phase !== "complete" && actions < 120) {
    const client = activeClient(table);
    const state = publicState<any>(table, client);
    const myEggs = state.eggs.filter((egg: any) => egg.ownerId === client.playerId && egg.alive);
    const targetKings = state.eggs.filter((egg: any) => egg.ownerId !== client.playerId && egg.kind === "king" && egg.alive);
    assert(myEggs.length > 0, "Alkkagi active player has no eggs.");
    assert(targetKings.length > 0, "Alkkagi target king not found.");

    const pairs = myEggs.flatMap((shooter: any) =>
      targetKings.map((target: any) => ({
        shooter,
        target,
        distance: Math.hypot(shooter.x - target.x, shooter.y - target.y)
      }))
    );
    const preferredPairs = pairs.filter((pair: any) => pair.shooter.kind !== "king");
    const { shooter, target } = (preferredPairs.length > 0 ? preferredPairs : pairs).sort((a: any, b: any) => a.distance - b.distance)[0];
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const size = Math.hypot(dx, dy) || 1;
    await gameAction(table, client, {
      type: "alkkagi/flick",
      payload: { eggId: shooter.id, vector: { x: (dx / size) * 170, y: (dy / size) * 170 } }
    });
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "complete" && winner !== "-";
  const arenaName = String(publicState<any>(table)?.arena?.name ?? "경기장 미확인");
  await closeTable(table);
  return { gameId: "alkkagi", title: "알까기", players: playerCount, mode: "playthrough", actions, completed, winner, note: `physics flick survival / ${arenaName}` };
}

function kkukkkukiLegalActions(state: any, playerId: string): GameAction[] {
  const actions: GameAction[] = [];
  if (state.phase === "playing") {
    const reserve = state.reserves[playerId] ?? { small: 0, large: 0 };
    const sizes = [
      reserve.small > 0 ? "small" : null,
      reserve.large > 0 ? "large" : null
    ].filter((size): size is "small" | "large" => Boolean(size));
    for (const size of sizes) {
      for (let row = 0; row < 6; row += 1) {
        for (let col = 0; col < 6; col += 1) {
          if (!state.board[row][col]) {
            actions.push({ type: "kkukkkuki/place-piece", payload: { row, col, size } });
          }
        }
      }
    }
  } else if (state.phase === "choose-line") {
    for (const line of state.pendingLines ?? []) {
      actions.push({ type: "kkukkkuki/choose-line", payload: { lineKey: line.key } });
    }
  } else if (state.phase === "choose-piece") {
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        if (state.board[row][col]?.ownerId === playerId) {
          actions.push({ type: "kkukkkuki/remove-piece", payload: { row, col } });
        }
      }
    }
  }
  return actions;
}

function kkukkkukiLinePotential(state: any, playerId: string) {
  let score = 0;
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      for (const [dr, dc] of directions) {
        let own = 0;
        let large = 0;
        let empty = 0;
        let blocked = false;
        for (let index = 0; index < 3; index += 1) {
          const nextRow = row + dr * index;
          const nextCol = col + dc * index;
          if (nextRow < 0 || nextRow >= 6 || nextCol < 0 || nextCol >= 6) {
            blocked = true;
            break;
          }
          const piece = state.board[nextRow][nextCol];
          if (!piece) {
            empty += 1;
          } else if (piece.ownerId === playerId) {
            own += 1;
            if (piece.size === "large") {
              large += 1;
            }
          } else {
            own -= 3;
          }
        }
        if (!blocked && own > 0) {
          score += own * 15 + large * 34 - empty * 2;
        }
      }
    }
  }
  return score;
}

function kkukkkukiActionScore(table: GameTable, client: QaClient, action: GameAction, rng: () => number) {
  const state = publicState<any>(table, client);
  const outcome = tryLocal(kkukkkukiModule, table, state, action, client.playerId);
  const nextState = outcome.state as any;
  const reserve = nextState.reserves[client.playerId] ?? { small: 0, large: 0 };
  let score = rng();
  if (outcome.winnerId === client.playerId || nextState.winnerId === client.playerId) {
    score += 1_000_000;
  }
  if (nextState.phase === "choose-line" && nextState.pendingPlayerId === client.playerId) {
    score += 50_000;
  }
  if (nextState.phase === "choose-piece" && nextState.pendingPlayerId === client.playerId) {
    score += 20_000;
  }
  score += reserve.large * 120 - reserve.small * 3;
  score += kkukkkukiLinePotential(nextState, client.playerId);
  if (recordFrom(action.payload)?.size === "large") {
    score += 50;
  }
  return { action, score };
}

function kkukkkukiActions(table: GameTable, client: QaClient, rng: () => number) {
  const state = publicState<any>(table, client);
  return kkukkkukiLegalActions(state, client.playerId)
    .map((action) => {
      try {
        return kkukkkukiActionScore(table, client, action, rng);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score) as Array<{ action: GameAction; score: number }>;
}

async function playKkukkkuki(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "kkukkkuki", 2);
  const rng = createRng(options.seed ?? 1);
  let actions = 0;

  while (publicState<any>(table).phase !== "complete" && actions < 140) {
    const client = activeClient(table);
    const legal = kkukkkukiActions(table, client, rng);
    assert(legal.length > 0, "Kkukkkuki legal action not found.");
    await gameAction(table, client, legal[0].action);
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "complete" && winner !== "-";
  await closeTable(table);
  return { gameId: "kkukkkuki", title: "꾹꾹이", players: 2, mode: "playthrough", actions, completed, winner, note: "generated legal pushes to large-piece win" };
}

async function playYacht(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const playerCount = options.playerCount ?? 4;
  const table = await createStartedRoom(baseUrl, "yacht-dice", playerCount);
  let actions = 0;

  while (publicState<any>(table).phase !== "complete" && actions < playerCount * CATEGORIES.length * 3) {
    const client = activeClient(table);
    await gameAction(table, client, { type: "yacht-dice/roll" });
    actions += 1;
    const state = publicState<any>(table, client);
    const scores = state.scores[client.playerId] ?? {};
    const category = CATEGORIES.find((candidate) => scores[candidate] === undefined);
    assert(category, "Yacht category not found.");
    await gameAction(table, client, { type: "yacht-dice/score-category", payload: { category } });
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "complete" && winner !== "-";
  await closeTable(table);
  return { gameId: "yacht-dice", title: "요트 다이스", players: playerCount, mode: "playthrough", actions, completed, winner, note: "all score sheets filled" };
}

function masterpieceAnalysis(index: number) {
  const samples = [
    { hue: 0.58, saturation: 0.64, lightness: 0.48, coverage: 0.52, balanceX: 0.52, balanceY: 0.5, stroke: 0.78, pixelSimilarity: 0.74, structureSimilarity: 0.68 },
    { hue: 0.14, saturation: 0.52, lightness: 0.57, coverage: 0.44, balanceX: 0.46, balanceY: 0.55, stroke: 0.65, pixelSimilarity: 0.58, structureSimilarity: 0.54 },
    { hue: 0.68, saturation: 0.38, lightness: 0.42, coverage: 0.36, balanceX: 0.61, balanceY: 0.43, stroke: 0.52, pixelSimilarity: 0.42, structureSimilarity: 0.48 },
    { hue: 0.05, saturation: 0.72, lightness: 0.62, coverage: 0.63, balanceX: 0.38, balanceY: 0.6, stroke: 0.7, pixelSimilarity: 0.51, structureSimilarity: 0.45 }
  ];
  return samples[index % samples.length];
}

async function playMasterpieceCopy(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const playerCount = options.playerCount ?? 4;
  const table = await createStartedRoom(baseUrl, "masterpiece-copy", playerCount);
  let actions = 0;
  const initial = publicState<any>(table);
  assert(initial.phase === "drawing", "Masterpiece copy should start in drawing phase.");
  const remainingMs = initial.deadlineAt - Date.now();
  assert(remainingMs > 120_000 && remainingMs <= 150_500, "Masterpiece copy should use a fixed 2:30 timer.");
  const referenceIds = new Set(table.clients.map((client) => publicState<any>(table, client).referenceId));
  assert(referenceIds.size === 1, "Masterpiece copy should show the same reference painting to every player.");

  for (let index = 0; index < table.clients.length; index += 1) {
    const imageData = `data:image/png;base64,${Buffer.from(`masterpiece-${index}`).toString("base64")}`;
    await gameAction(table, table.clients[index], {
      type: "painting/submit",
      payload: { imageData, analysis: masterpieceAnalysis(index) }
    });
    actions += 1;
  }

  const scanning = publicState<any>(table, table.clients[table.clients.length - 1]);
  assert(scanning.phase === "scanning", "Masterpiece copy should scan after every player submits.");
  assert((scanning.rankings ?? []).length === playerCount, "Masterpiece copy should rank every submitted player.");
  await gameAction(table, table.clients[0], { type: "painting/complete" });
  actions += 1;

  const state = publicState<any>(table);
  const winner = winnerLabel(table);
  const completed = state.phase === "complete" && winner !== "-";
  await closeTable(table);
  return {
    gameId: "masterpiece-copy",
    title: "명화 따라그리기",
    players: playerCount,
    mode: "playthrough",
    actions,
    completed,
    winner,
    note: "fixed 2:30 simultaneous drawing, scan reveal, similarity ranking"
  };
}

async function playHangman(baseUrl: string, _options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "hangman-board-game", 2);
  let actions = 0;
  const rounds = [
    { first: "APPLE", second: "BERRY" },
    { first: "CLOUD", second: "DELTA" },
    { first: "EAGLE", second: "FLOUR" }
  ];

  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    await gameAction(table, table.clients[0], { type: "hangman-board-game/setup-secret", payload: { word: round.first } });
    await gameAction(table, table.clients[1], { type: "hangman-board-game/setup-secret", payload: { word: round.second } });
    await gameAction(table, table.clients[0], { type: "hangman-board-game/guess-word", payload: { word: round.second } });
    actions += 3;
    if (index < rounds.length - 1) {
      assert(publicState<any>(table).phase === "round-complete", "Hangman round should be complete before next round.");
      await gameAction(table, table.clients[0], { type: "hangman-board-game/next-round" });
      actions += 1;
    }
  }

  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "complete" && winner !== "-";
  await closeTable(table);
  return { gameId: "hangman-board-game", title: "행맨 보드게임", players: 2, mode: "playthrough", actions, completed, winner, note: "best-of-three secret setup and solve" };
}

async function playBlindCardDuel(baseUrl: string, _options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "blind-card-duel", 2);
  let actions = 0;
  while (!winnerLabel(table).includes("페이스업") && winnerLabel(table) === "-" && actions < 12) {
    const first = activeClient(table);
    const firstState = publicState<any>(table, first);
    const target = firstState.maxBetTo;
    assert(typeof target === "number" && target > firstState.currentBetTo, "Blind duel all-in target missing.");
    await gameAction(table, first, { type: "blind/open", payload: { to: target } });
    actions += 1;
    const second = activeClient(table);
    await gameAction(table, second, { type: "blind/call" });
    actions += 1;
    if (winnerLabel(table) !== "-") break;
    await waitFor(() => {
      const phase = publicState<any>(table).phase;
      return phase === "betting" || phase === "complete";
    }, 5_000, "blind duel next hand");
  }
  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "complete" && winner !== "-";
  await closeTable(table);
  return { gameId: "blind-card-duel", title: "페이스업 듀얼", players: 2, mode: "playthrough", actions, completed, winner, note: "server all-in, projection, showdown lifecycle" };
}

async function playParityTileDuel(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const playerCount = options.playerCount ?? 3;
  const table = await createStartedRoom(baseUrl, "parity-tile-duel", playerCount);
  let actions = 0;
  while (publicState<any>(table).phase !== "finished" && actions < 400) {
    if (publicState<any>(table).phase === "round-result") {
      await waitFor(() => publicState<any>(table).phase !== "round-result", 5_000, "parity next round");
      continue;
    }
    const client = activeClient(table);
    const state = publicState<any>(table, client);
    const hand = state.hand as Array<{ id: string }>;
    assert(hand.length > 0, "Parity active player has no projected hand.");
    if (state.phase === "choose-attack") {
      await gameAction(table, client, { type: "tile/attack", payload: { tileId: hand[0].id } });
    } else if (state.phase === "await-defense") {
      await gameAction(table, client, { type: "tile/pass" });
    } else if (state.phase === "continuation") {
      await gameAction(table, client, {
        type: "tile/continue",
        payload: hand.length >= 2
          ? { bonusTileId: hand[0].id, attackTileId: hand[1].id }
          : { bonusTileId: null, attackTileId: hand[0].id }
      });
    } else {
      throw new Error(`Unknown parity phase ${state.phase}`);
    }
    actions += 1;
  }
  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "finished" && winner !== "-";
  await closeTable(table);
  return { gameId: "parity-tile-duel", title: "문양 공방", players: playerCount, mode: "playthrough", actions, completed, winner, note: "private hands, pass laps, continuation and scoring" };
}

async function playMosaicRush(baseUrl: string, _options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "mosaic-rush", 1);
  const client = table.clients[0];
  let actions = 0;
  while (publicState<any>(table, client).phase !== "complete" && actions < 40) {
    const puzzle = publicState<any>(table, client).puzzle;
    const placements = solutionForMosaicChallenge(puzzle.card, puzzle.symbol);
    for (const placement of placements) {
      await gameAction(table, client, { type: "mosaic/place", payload: placement });
      actions += 1;
    }
    await gameAction(table, client, { type: "mosaic/submit" });
    actions += 1;
    if (publicState<any>(table, client).phase === "reward") {
      await waitFor(
        () => publicState<any>(table, client).phase !== "reward",
        5_000,
        "mosaic reward phase"
      );
    }
  }
  const winner = winnerLabel(table);
  const completed = publicState<any>(table, client).phase === "complete" && winner !== "-";
  await closeTable(table);
  return { gameId: "mosaic-rush", title: "모자이크 러시", players: 1, mode: "playthrough", actions, completed, winner, note: "nine server-validated simultaneous puzzle rounds" };
}

async function playQuoridor(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const playerCount = options.playerCount ?? 2;
  const table = await createStartedRoom(baseUrl, "quoridor", playerCount);
  let actions = 0;
  const wallClient = activeClient(table);
  const wallState = publicState<any>(table, wallClient);
  let wallAction: GameAction | null = null;
  for (const orientation of ["horizontal", "vertical"] as const) {
    for (let row = 0; row < 8 && !wallAction; row += 1) {
      for (let col = 0; col < 8 && !wallAction; col += 1) {
        const action = { type: "placeWall", payload: { orientation, row, col } };
        try {
          tryLocal(quoridorModule, table, wallState, action, wallClient.playerId);
          wallAction = action;
        } catch {
          // Try the next wall coordinate.
        }
      }
    }
  }
  assert(wallAction, "Quoridor legal wall placement not found.");
  await gameAction(table, wallClient, wallAction);
  actions += 1;

  while (!publicState<any>(table).winnerId && actions < playerCount * 20) {
    const client = activeClient(table);
    const state = publicState<any>(table, client);
    const player = state.players.find((candidate: any) => candidate.id === client.playerId);
    assert(player, "Quoridor active player state missing.");
    const neighbors = [
      { row: player.row - 1, col: player.col },
      { row: player.row + 1, col: player.col },
      { row: player.row, col: player.col - 1 },
      { row: player.row, col: player.col + 1 }
    ];
    const candidates = neighbors
      .map((target) => {
        const action = { type: "movePawn", payload: target };
        try {
          const outcome = tryLocal(quoridorModule, table, state, action, client.playerId);
          const distance =
            player.goal === "top"
              ? target.row
              : player.goal === "bottom"
                ? 8 - target.row
                : player.goal === "left"
                  ? target.col
                  : 8 - target.col;
          return { action, outcome, distance };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{ action: GameAction; distance: number }>;
    assert(candidates.length > 0, "Quoridor legal move not found.");
    candidates.sort((a, b) => a.distance - b.distance);
    await gameAction(table, client, candidates[0].action);
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = Boolean(publicState<any>(table).winnerId) && winner !== "-";
  await closeTable(table);
  return { gameId: "quoridor", title: "쿼리도", players: playerCount, mode: "playthrough", actions, completed, winner, note: "wall placement plus pawn path to goal" };
}

async function playQawale(baseUrl: string, _options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "qawale", 2);
  let actions = 0;
  const firstClient = activeClient(table);
  const secondClient = table.clients.find((client) => client.playerId !== firstClient.playerId);
  assert(secondClient, "Qawale second player is missing.");
  const turnOrder = [firstClient, secondClient];
  for (const step of qawaleScript) {
    const client = turnOrder[step.playerIndex];
    assert(table.clients[0].room?.gameState.activePlayerId === client.playerId, "Qawale scripted player is not active.");
    await gameAction(table, client, step.action);
    actions += 1;
    if (publicState<any>(table).winnerId) {
      break;
    }
  }
  const winner = winnerLabel(table);
  const completed = Boolean(publicState<any>(table).winnerId) && winner !== "-";
  await closeTable(table);
  return { gameId: "qawale", title: "카왈레", players: 2, mode: "playthrough", actions, completed, winner, note: "scripted four-in-line" };
}

async function playDavinci(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const playerCount = options.playerCount ?? 2;
  const table = await createStartedRoom(baseUrl, "davinci-code-plus", playerCount);
  let actions = 0;

  while (!publicState<any>(table).winnerId && actions < playerCount * 90) {
    const client = activeClient(table);
    const state = publicState<any>(table, client);
    if (state.phase === "draw") {
      await gameAction(table, client, { type: "draw" });
      actions += 1;
      continue;
    }
    const activePlayer = state.players.find((player: any) => player.id === client.playerId);
    const target = state.players.find(
      (player: any) =>
        player.id !== client.playerId &&
        !player.eliminated &&
        !(activePlayer?.teamId && player.teamId === activePlayer.teamId) &&
        player.hand.some((tile: any) => !tile.revealed)
    );
    assert(target, "Da Vinci target not found.");
    const hiddenIndex = target.hand.findIndex((tile: any) => !tile.revealed);
    assert(hiddenIndex >= 0, "Da Vinci hidden tile not found.");
    const targetClient = table.clients.find((candidate) => candidate.playerId === target.id);
    assert(targetClient, "Da Vinci target client missing.");
    const targetOwnState = publicState<any>(table, targetClient);
    const targetOwnPlayer = targetOwnState.players.find((player: any) => player.id === target.id);
    const targetTile = targetOwnPlayer.hand[hiddenIndex];
    const guess = targetTile.kind === "joker" ? "joker" : targetTile.value;
    assert(guess === "joker" || Number.isInteger(guess), "Da Vinci target value hidden from its owner.");
    await gameAction(table, client, {
      type: "guess",
      payload: { targetPlayerId: target.id, tileIndex: hiddenIndex, guess }
    });
    actions += 1;
    if (!publicState<any>(table).winnerId && publicState<any>(table).phase === "decide") {
      await gameAction(table, client, { type: "continue" });
      actions += 1;
    }
  }

  const winner = winnerLabel(table);
  const completed = Boolean(publicState<any>(table).winnerId) && winner !== "-";
  await closeTable(table);
  return { gameId: "davinci-code-plus", title: "다빈치 코드 플러스", players: playerCount, mode: "playthrough", actions, completed, winner, note: "hidden info per viewer and correct guesses" };
}

function legalGhostActions(table: GameTable, client: QaClient) {
  const state = publicState<any>(table, client);
  const pieces = state.pieces.filter((piece: any) => piece.ownerId === client.playerId && !piece.captured && !piece.escaped);
  const occupied = new Set(
    state.pieces
      .filter((piece: any) => !piece.captured && !piece.escaped)
      .map((piece: any) => `${piece.row},${piece.col}`)
  );
  const actions: GameAction[] = [];
  for (const piece of pieces) {
    for (const delta of [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 }]) {
      const to = { row: piece.row + delta.row, col: piece.col + delta.col };
      if (to.row >= 0 && to.row < state.boardSize && to.col >= 0 && to.col < state.boardSize && !occupied.has(`${to.row},${to.col}`)) {
        actions.push({ type: "moveGhost", payload: { pieceId: piece.id, to } });
      }
    }
  }
  return actions;
}

async function playGhosts(baseUrl: string, _options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "ghosts", 2);
  const p1 = table.clients[0];
  const setupKinds = ["bad", "good", "good", "bad", "good", "bad", "bad", "good"];
  await gameAction(table, table.clients[0], { type: "ghosts/setup", payload: { kinds: setupKinds } });
  await gameAction(table, table.clients[1], { type: "ghosts/setup", payload: { kinds: setupKinds } });
  let actions = 0;
  const escapePath = [
    { row: 4, col: 0 },
    { row: 3, col: 0 },
    { row: 2, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: 0 },
    { row: -1, col: 0 }
  ];
  let p1Step = 0;

  while (!publicState<any>(table).winnerId && actions < 20) {
    const client = activeClient(table);
    if (client.playerId === p1.playerId) {
      await gameAction(table, client, { type: "moveGhost", payload: { pieceId: "p1-ghost-5", to: escapePath[p1Step] } });
      p1Step += 1;
    } else {
      const fallback = legalGhostActions(table, client).find((action: any) => action.payload.to.col !== 0 && action.payload.to.row >= 0 && action.payload.to.row <= 5);
      assert(fallback, "Ghosts legal waiting move not found.");
      await gameAction(table, client, fallback);
    }
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = Boolean(publicState<any>(table).winnerId) && winner !== "-";
  await closeTable(table);
  return { gameId: "ghosts", title: "고스트", players: 2, mode: "playthrough", actions, completed, winner, note: "good ghost escape" };
}

const BLOKUS_EDGE_DIRECTIONS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];

const BLOKUS_CORNER_DIRECTIONS = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 }
];

function normalizeBlokusCells(cells: Array<{ x: number; y: number }>) {
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  return cells
    .map((cell) => ({ x: cell.x - minX, y: cell.y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function transformBlokusCells(cells: Array<{ x: number; y: number }>, rotation: number, flipped: boolean) {
  let transformed = cells.map((cell) => ({ x: flipped ? -cell.x : cell.x, y: cell.y }));
  for (let index = 0; index < rotation % 4; index += 1) {
    transformed = transformed.map((cell) => ({ x: -cell.y, y: cell.x }));
  }
  return normalizeBlokusCells(transformed);
}

function blokusCellsForPlacement(
  piece: { cells: Array<{ x: number; y: number }> },
  x: number,
  y: number,
  rotation: number,
  flipped: boolean
) {
  return transformBlokusCells(piece.cells, rotation, flipped).map((cell) => ({ x: cell.x + x, y: cell.y + y }));
}

function blokusInBounds(cell: { x: number; y: number }) {
  return cell.x >= 0 && cell.x < 20 && cell.y >= 0 && cell.y < 20;
}

function blokusPlacementIsLegal(
  state: any,
  player: any,
  pieceId: string,
  cells: Array<{ x: number; y: number }>
) {
  if (player.placedPieceIds.includes(pieceId)) {
    return false;
  }
  if (cells.some((cell) => !blokusInBounds(cell) || state.board[cell.y][cell.x] !== null)) {
    return false;
  }
  if (player.placedPieceIds.length === 0) {
    return cells.some((cell) => cell.x === player.corner.x && cell.y === player.corner.y);
  }
  const touchesOwnEdge = cells.some((cell) =>
    BLOKUS_EDGE_DIRECTIONS.some((direction) => state.board[cell.y + direction.y]?.[cell.x + direction.x] === player.id)
  );
  if (touchesOwnEdge) {
    return false;
  }
  return cells.some((cell) =>
    BLOKUS_CORNER_DIRECTIONS.some((direction) => state.board[cell.y + direction.y]?.[cell.x + direction.x] === player.id)
  );
}

function blokusAnchors(state: any, player: any) {
  if (player.placedPieceIds.length === 0) {
    return [player.corner];
  }

  const anchors = new Map<string, { x: number; y: number }>();
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      if (state.board[y][x] !== player.id) {
        continue;
      }
      for (const direction of BLOKUS_CORNER_DIRECTIONS) {
        const anchor = { x: x + direction.x, y: y + direction.y };
        if (!blokusInBounds(anchor) || state.board[anchor.y][anchor.x] !== null) {
          continue;
        }
        const touchesOwnEdge = BLOKUS_EDGE_DIRECTIONS.some(
          (edgeDirection) => state.board[anchor.y + edgeDirection.y]?.[anchor.x + edgeDirection.x] === player.id
        );
        if (!touchesOwnEdge) {
          anchors.set(`${anchor.x},${anchor.y}`, anchor);
        }
      }
    }
  }
  return [...anchors.values()];
}

function blokusActions(table: GameTable, client: QaClient) {
  const state = publicState<any>(table, client);
  const player = state.players.find((candidate: any) => candidate.id === state.activeColorId && candidate.ownerId === client.playerId);
  assert(player, "Blokus active player state missing.");
  const pieces = player.remainingPieceIds
    .map((pieceId: string) => state.pieceCatalog.find((piece: any) => piece.id === pieceId))
    .filter(Boolean)
    .sort((first: any, second: any) => second.cells.length - first.cells.length);
  const anchors = blokusAnchors(state, player);

  for (const piece of pieces) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      for (const flipped of [false, true]) {
        const orientedCells = transformBlokusCells(piece.cells, rotation, flipped);
        for (const anchor of anchors) {
          for (const orientedCell of orientedCells) {
            const x = anchor.x - orientedCell.x;
            const y = anchor.y - orientedCell.y;
            const cells = blokusCellsForPlacement(piece, x, y, rotation, flipped);
            if (blokusPlacementIsLegal(state, player, piece.id, cells)) {
              return [{ action: { type: "place-piece", payload: { pieceId: piece.id, x, y, rotation, flipped } }, score: 0 }];
            }
          }
        }
      }
    }
  }
  return [];
}

async function playBlokus(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const playerCount = options.playerCount ?? 2;
  const table = await createStartedRoom(baseUrl, "blokus", playerCount);
  let actions = 0;

  while (publicState<any>(table).phase !== "finished" && actions < playerCount * 60) {
    const client = activeClient(table);
    const state = publicState<any>(table, client);
    const player = state.players.find((candidate: any) => candidate.id === state.activeColorId && candidate.ownerId === client.playerId);
    assert(player, "Blokus active player missing.");
    const legal = blokusActions(table, client);
    if (legal.length > 0) {
      await gameAction(table, client, legal[0].action);
    } else {
      assert(!player.canMove, "Blokus local generator found no move while public state says canMove=true.");
      await gameAction(table, client, { type: "pass" });
    }
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "finished" && winner !== "-";
  await closeTable(table);
  return { gameId: "blokus", title: "블로커스", players: playerCount, mode: "playthrough", actions, completed, winner, note: "legal placement until finish" };
}

function abaloneCombos(cells: Array<{ q: number; r: number }>) {
  const directions = [
    { id: "E", q: 1, r: 0 },
    { id: "W", q: -1, r: 0 },
    { id: "SE", q: 0, r: 1 },
    { id: "NW", q: 0, r: -1 },
    { id: "SW", q: -1, r: 1 },
    { id: "NE", q: 1, r: -1 }
  ];
  const key = (coord: { q: number; r: number }) => `${coord.q},${coord.r}`;
  const set = new Set(cells.map(key));
  const combos: Array<Array<{ q: number; r: number }>> = cells.map((cell) => [cell]);

  for (const direction of directions) {
    for (const cell of cells) {
      const second = { q: cell.q + direction.q, r: cell.r + direction.r };
      const third = { q: second.q + direction.q, r: second.r + direction.r };
      if (set.has(key(second))) {
        combos.push([cell, second]);
      }
      if (set.has(key(second)) && set.has(key(third))) {
        combos.push([cell, second, third]);
      }
    }
  }

  const seen = new Set<string>();
  return combos.filter((combo) => {
    const signature = combo.map(key).sort().join(";");
    if (seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
}

function parseAbaloneKey(coordKey: string) {
  const [q, r] = coordKey.split(",").map(Number);
  return { q, r };
}

function abaloneActions(table: GameTable, client: QaClient, rng: () => number) {
  const state = publicState<any>(table, client);
  const own = Object.entries(state.marbles)
    .filter(([, owner]) => owner === client.playerId)
    .map(([coordKey]) => parseAbaloneKey(coordKey));
  const directions = ["E", "W", "SE", "NW", "SW", "NE"];
  const actions: Array<{ action: GameAction; score: number }> = [];

  for (const cells of abaloneCombos(own)) {
    for (const direction of directions) {
      const action = { type: "move", payload: { cells, direction } };
      try {
        const before = state.pushedOff[client.playerId] ?? 0;
        const outcome = tryLocal(abaloneModule, table, state, action, client.playerId);
        const after = (outcome.state as any).pushedOff[client.playerId] ?? 0;
        const message = String((outcome.state as any).message ?? "");
        const score = (after - before) * 10000 + (/pushed|밀/.test(message) ? 100 : 0) + rng();
        actions.push({ action, score });
      } catch {
        // Not a legal move.
      }
    }
  }

  actions.sort((a, b) => b.score - a.score);
  return actions;
}

async function playAbalone(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "abalone-classic", 2);
  const rng = createRng(options.seed ?? 1);
  let actions = 0;

  while (!publicState<any>(table).winnerId && actions < 300) {
    const client = activeClient(table);
    const legal = abaloneActions(table, client, rng);
    assert(legal.length > 0, "Abalone legal move not found.");
    await gameAction(table, client, legal[0].action);
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = Boolean(publicState<any>(table).winnerId) && winner !== "-";
  await closeTable(table);
  return { gameId: "abalone-classic", title: "아발론 클래식", players: 2, mode: "playthrough", actions, completed, winner, note: "generated legal moves to six pushes" };
}

function colorForYinshPlayer(state: any, playerId: string) {
  return state.players.white.id === playerId ? "white" : "black";
}

function yinshLinePotential(state: any, color: string) {
  let best = 0;
  const directions = [
    [1, 0],
    [0, 1],
    [1, -1]
  ];
  const valid = new Set(state.points.map((point: any) => point.key));
  for (const point of state.points) {
    for (const [dq, dr] of directions) {
      let count = 0;
      for (let index = 0; index < 5; index += 1) {
        const coordKey = `${point.q + dq * index},${point.r + dr * index}`;
        if (!valid.has(coordKey)) {
          count = -999;
          break;
        }
        if (state.markers[coordKey] === color) {
          count += 1;
        }
      }
      best = Math.max(best, count);
    }
  }
  return best;
}

function yinshPublicFromOutcome(table: GameTable, outcome: ReturnType<GameModule["applyAction"]>) {
  const nextActive = outcome.activePlayerId ?? table.clients[0].room?.gameState.activePlayerId ?? table.clients[0].playerId;
  return yinshModule.getPublicState(outcome.state, {
    ...contextFor(table, nextActive),
    activePlayerId: nextActive,
    turnNumber: outcome.turnNumber ?? table.clients[0].room?.gameState.turnNumber ?? 1,
    roundNumber: outcome.roundNumber ?? table.clients[0].room?.gameState.roundNumber ?? 1,
    viewerId: nextActive
  } as GameContext & { viewerId: string | null });
}

function yinshActions(table: GameTable, client: QaClient, rng: () => number) {
  const state = publicState<any>(table, client);
  const color = colorForYinshPlayer(state, client.playerId);
  const presets: Record<string, string[]> = {
    white: ["-4,0", "-3,0", "-2,0", "-1,0", "0,0"],
    black: ["-4,1", "-3,1", "-2,1", "-1,1", "0,1"]
  };
  const rawActions: GameAction[] = [];

  if (state.phase === "ring-placement") {
    const occupied = new Set([...Object.keys(state.rings), ...Object.keys(state.markers)]);
    for (const point of state.points) {
      if (!occupied.has(point.key)) {
        rawActions.push({ type: "place-ring", payload: { key: point.key } });
      }
    }
  } else if (state.phase === "move") {
    for (const [ringKey, ringColor] of Object.entries(state.rings)) {
      if (ringColor !== color) {
        continue;
      }
      for (const point of state.points) {
        rawActions.push({ type: "move-ring", payload: { from: ringKey, to: point.key } });
      }
    }
  } else if (state.phase === "remove-row") {
    state.pendingRows.forEach((row: any, rowIndex: number) => {
      if (row.color !== color) {
        return;
      }
      for (const [ringKey, ringColor] of Object.entries(state.rings)) {
        if (ringColor === color) {
          rawActions.push({ type: "remove-row", payload: { rowIndex, ringKey } });
        }
      }
    });
  }

  const actions: Array<{ action: GameAction; score: number }> = [];
  for (const action of rawActions) {
    try {
      const beforeRemoved = state.ringsRemoved[color] ?? 0;
      const outcome = tryLocal(yinshModule, table, state, action, client.playerId);
      const nextState = yinshPublicFromOutcome(table, outcome) as any;
      let score = 0;
      if (outcome.winnerId === client.playerId) {
        score += 1_000_000;
      }
      if ((nextState.ringsRemoved[color] ?? 0) > beforeRemoved) {
        score += 50_000;
      }
      if (nextState.phase === "remove-row") {
        score += 10_000;
      }
      score += yinshLinePotential(nextState, color) * 100;
      if (state.phase === "ring-placement") {
        const key = (action.payload as any).key;
        const nextIndex = state.ringsPlaced[color] ?? 0;
        if (key === presets[color][nextIndex]) {
          score += 100_000;
        } else if (presets[color].includes(key)) {
          score += 1_000;
        }
      }
      actions.push({ action, score: score + rng() });
    } catch {
      // Not a legal YINSH action.
    }
  }

  actions.sort((a, b) => b.score - a.score);
  return actions;
}

async function playYinsh(baseUrl: string, options: PlayOptions = {}): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "yinsh", 2);
  const rng = createRng(options.seed ?? 1);
  let actions = 0;

  while (publicState<any>(table).phase !== "finished" && actions < 80) {
    const client = activeClient(table);
    const legal = yinshActions(table, client, rng);
    assert(legal.length > 0, "YINSH legal action not found.");
    await gameAction(table, client, legal[0].action);
    actions += 1;
  }

  const winner = winnerLabel(table);
  const completed = publicState<any>(table).phase === "finished" && winner !== "-";
  await closeTable(table);
  return { gameId: "yinsh", title: "인쉬", players: 2, mode: "playthrough", actions, completed, winner, note: "ring placement, rows, removals, win" };
}

function createYinshMarkerPoolFixture(markersRemaining: number, ringsRemoved: { white: number; black: number }) {
  const game = getGameById("yinsh");
  assert(game, "Unknown game yinsh");
  const players = [
    { id: "yinsh-white", name: "YINSH White", seat: 1, connected: true, isHost: true, joinedAt: 1, avatar: qaAvatar },
    { id: "yinsh-black", name: "YINSH Black", seat: 2, connected: true, isHost: false, joinedAt: 2, avatar: qaAvatar }
  ];
  const state = yinshModule.createInitialState({ game, players }) as any;
  state.phase = "move";
  state.rings = { "0,0": "white", "1,0": "black" };
  state.markers = {};
  state.markersRemaining = markersRemaining;
  state.ringsPlaced = { white: 5, black: 5 };
  state.ringsRemoved = ringsRemoved;
  state.pendingRows = [];
  state.rowResolution = null;
  state.winnerId = null;
  state.winnerIds = [];
  return { game, players, state };
}

function runYinshMarkerPoolChecks() {
  const winning = createYinshMarkerPoolFixture(1, { white: 2, black: 1 });
  const winningContext: GameContext = {
    game: winning.game,
    players: winning.players,
    activePlayerId: "yinsh-white",
    currentPlayerId: "yinsh-white",
    turnNumber: 20,
    roundNumber: 10
  };
  const winningOutcome = yinshModule.applyAction(
    winning.state,
    { type: "move-ring", payload: { from: "0,0", to: "0,1" } },
    winningContext
  );
  const winningState = winningOutcome.state as any;
  assert(winningState.phase === "finished", "YINSH should finish when the last marker is used.");
  assert(winningState.markersRemaining === 0, "YINSH marker pool should decrement to zero.");
  assert(winningState.winnerId === "yinsh-white", "YINSH marker exhaustion should award the player with more removed rings.");

  const tied = createYinshMarkerPoolFixture(0, { white: 1, black: 1 });
  const tiedContext: GameContext = {
    game: tied.game,
    players: tied.players,
    activePlayerId: "yinsh-white",
    currentPlayerId: "yinsh-white",
    turnNumber: 21,
    roundNumber: 10
  };
  const tiedOutcome = yinshModule.applyAction(
    tied.state,
    { type: "move-ring", payload: { from: "0,0", to: "0,1" } },
    tiedContext
  );
  const tiedState = tiedOutcome.state as any;
  assert(tiedState.phase === "finished", "YINSH should finish if no marker is available for a ring move.");
  assert(tiedState.winnerId === null, "YINSH tied marker exhaustion should not expose a single winner.");
  assert(
    Array.isArray(tiedState.winnerIds) && tiedState.winnerIds.length === 0,
    "YINSH tied marker exhaustion should be recorded as a draw, not two wins."
  );
  console.log("[unit] YINSH marker pool exhaustion");
}

async function waitForStats(baseUrl: string, minimumMatches: number) {
  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/stats/summary`);
    if (!response.ok) {
      return false;
    }
    const summary = (await response.json()) as StatsSummary;
    return summary.totalMatches >= minimumMatches;
  }, 5000, `stats to record ${minimumMatches} matches`);
}

const scenarios: Array<{ gameId: string; play: PlayScenario }> = [
  { gameId: "guryongtu", play: playGuryongtu },
  { gameId: "quoridor", play: playQuoridor },
  { gameId: "abalone-classic", play: playAbalone },
  { gameId: "ghosts", play: playGhosts },
  { gameId: "qawale", play: playQawale },
  { gameId: "omok", play: playOmok },
  { gameId: "alkkagi", play: playAlkkagi },
  { gameId: "kkukkkuki", play: playKkukkkuki },
  { gameId: "davinci-code-plus", play: playDavinci },
  { gameId: "blokus", play: playBlokus },
  { gameId: "masterpiece-copy", play: playMasterpieceCopy },
  { gameId: "yacht-dice", play: playYacht },
  { gameId: "yinsh", play: playYinsh },
  { gameId: "hangman-board-game", play: playHangman },
  { gameId: "blind-card-duel", play: playBlindCardDuel },
  { gameId: "parity-tile-duel", play: playParityTileDuel },
  { gameId: "mosaic-rush", play: playMosaicRush }
];

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? process.env[`QA_${name.toUpperCase().replace(/-/g, "_")}`];
}

async function runMaxPlaythroughs(baseUrl: string) {
  const results: QaResult[] = [];
  const configuredSeedBase = argValue("seed-base");
  let seed = Number(configuredSeedBase ?? 1000);
  if (!Number.isFinite(seed)) {
    seed = 1000;
  }
  const onlyGameId = argValue("max-game");
  const configuredRunCount = Number(argValue("max-runs-count") ?? 3);
  const runCount = Number.isSafeInteger(configuredRunCount) && configuredRunCount > 0 ? configuredRunCount : 3;
  const selectedScenarios = onlyGameId ? scenarios.filter((scenario) => scenario.gameId === onlyGameId) : scenarios;

  if (onlyGameId && selectedScenarios.length === 0) {
    throw new Error(`Unknown max-game: ${onlyGameId}`);
  }

  for (const scenario of selectedScenarios) {
    const game = getGameById(scenario.gameId);
    assert(game, `Unknown game ${scenario.gameId}`);
    const playerCount = Math.max(...game.allowedPlayerCounts);
    const scenarioSeed = !configuredSeedBase && scenario.gameId === "yinsh" ? 1010 : seed;

    for (let run = 1; run <= runCount; run += 1) {
      console.log(`[max-playthrough] ${game.title} ${playerCount}p ${run}/${runCount}`);
      const result = await scenario.play(baseUrl, { playerCount, seed: scenarioSeed + run });
      result.mode = "max-playthrough";
      result.run = run;
      result.players = playerCount;
      results.push(result);
      console.log(
        `[ok] ${result.title} ${result.players}p run=${run}: ${result.actions} actions, completed=${result.completed}, winner=${result.winner}`
      );
    }
    seed += 100;
  }

  return results;
}

function printResults(results: QaResult[]) {
  console.table(
    results.map((result) => ({
      game: result.title,
      players: result.players,
      run: result.run ?? "-",
      mode: result.mode,
      actions: result.actions,
      completed: result.completed,
      winner: result.winner,
      note: result.note
    }))
  );
}

async function main() {
  const catalogErrors = validateGameCatalog();
  if (catalogErrors.length > 0) {
    throw new Error(`Game catalog validation failed:\n${catalogErrors.map((error) => `- ${error}`).join("\n")}`);
  }

  runYinshMarkerPoolChecks();
  if (process.argv.includes("--yinsh-marker-pool-only") || process.env.QA_MODE === "yinsh-marker-pool") {
    return;
  }

  const { baseUrl, child } = await startServer();
  const results: QaResult[] = [];
  try {
    if (process.argv.includes("--max-runs") || process.env.QA_MODE === "max-runs") {
      results.push(...await runMaxPlaythroughs(baseUrl));
      await waitForStats(baseUrl, results.filter((result) => result.completed).length);
      printResults(results);
      const failed = results.filter((result) => !result.completed || result.winner === "-");
      if (failed.length > 0) {
        throw new Error(`Max QA failed: ${failed.map((result) => `${result.title}/${result.players}p/run${result.run}`).join(", ")}`);
      }
      return;
    }

    results.push(...await runStartMatrix(baseUrl));

    for (const scenario of scenarios) {
      console.log(`[playthrough] ${scenario.play.name}`);
      const result = await scenario.play(baseUrl);
      results.push(result);
      console.log(`[ok] ${result.title} ${result.mode}: ${result.actions} actions, completed=${result.completed}, winner=${result.winner}`);
    }

    const completedPlaythroughs = results.filter((result) => result.mode === "playthrough" && result.completed).length;
    await waitForStats(baseUrl, completedPlaythroughs);

    const failed = results.filter((result) => !result.completed);
    printResults(results);
    if (failed.length > 0) {
      throw new Error(`QA failed: ${failed.map((result) => `${result.title}/${result.mode}/${result.players}p`).join(", ")}`);
    }
  } finally {
    await stopServer(child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

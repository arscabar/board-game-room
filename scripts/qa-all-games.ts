import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import { module as abaloneModule } from "../src/game-modules/abalone-classic";
import { module as blokusModule } from "../src/game-modules/blokus";
import { module as quoridorModule } from "../src/game-modules/quoridor";
import { module as yinshModule } from "../src/game-modules/yinsh";
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
  actions: number;
  completed: boolean;
  note: string;
};

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

  const statsFile = path.join(os.tmpdir(), `board-game-room-qa-${Date.now()}.json`);
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

async function gameAction(table: GameTable, client: QaClient, action: GameAction) {
  const room = await emitAck<RoomSnapshot>(client, "game:action", { code: table.code, action });
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
        note: "room create/join/select/start"
      });
      await closeTable(table, true);
    }
  }
  return results;
}

async function playGuryongtu(baseUrl: string): Promise<QaResult> {
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

  const completed = publicState<any>(table).phase === "complete";
  await closeTable(table);
  return { gameId: "guryongtu", title: "구룡투", players: 2, mode: "playthrough", actions, completed, note: "full duel" };
}

async function playYacht(baseUrl: string): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "yacht-dice", 4);
  let actions = 0;

  while (publicState<any>(table).phase !== "complete" && actions < 140) {
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

  const completed = publicState<any>(table).phase === "complete";
  await closeTable(table);
  return { gameId: "yacht-dice", title: "요트 다이스", players: 4, mode: "playthrough", actions, completed, note: "all score sheets filled" };
}

async function playHangman(baseUrl: string): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "hangman-board-game", 2);
  await gameAction(table, table.clients[0], { type: "hangman-board-game/setup-secret", payload: { word: "APPLE" } });
  await gameAction(table, table.clients[1], { type: "hangman-board-game/setup-secret", payload: { word: "BERRY" } });
  await gameAction(table, table.clients[0], { type: "hangman-board-game/guess-word", payload: { word: "BERRY" } });

  const completed = publicState<any>(table).phase === "complete";
  await closeTable(table);
  return { gameId: "hangman-board-game", title: "행맨 보드게임", players: 2, mode: "playthrough", actions: 3, completed, note: "secret setup and solve" };
}

async function playQuoridor(baseUrl: string): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "quoridor", 2);
  let actions = 0;

  while (!publicState<any>(table).winnerId && actions < 30) {
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

  const completed = Boolean(publicState<any>(table).winnerId);
  await closeTable(table);
  return { gameId: "quoridor", title: "쿼리도", players: 2, mode: "playthrough", actions, completed, note: "pawn path to goal" };
}

async function playQawale(baseUrl: string): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "qawale", 2);
  let actions = 0;
  for (const step of qawaleScript) {
    const client = table.clients[step.playerIndex];
    assert(table.clients[0].room?.gameState.activePlayerId === client.playerId, "Qawale scripted player is not active.");
    await gameAction(table, client, step.action);
    actions += 1;
    if (publicState<any>(table).winnerId) {
      break;
    }
  }
  const completed = Boolean(publicState<any>(table).winnerId);
  await closeTable(table);
  return { gameId: "qawale", title: "카왈레", players: 2, mode: "playthrough", actions, completed, note: "scripted four-in-line" };
}

async function playDavinci(baseUrl: string): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "davinci-code-plus", 2);
  let actions = 0;

  while (!publicState<any>(table).winnerId && actions < 20) {
    const client = activeClient(table);
    const state = publicState<any>(table, client);
    const target = state.players.find((player: any) => player.id !== client.playerId && !player.eliminated);
    assert(target, "Da Vinci target not found.");
    const hiddenIndex = target.hand.findIndex((tile: any) => !tile.revealed);
    assert(hiddenIndex >= 0, "Da Vinci hidden tile not found.");
    const targetClient = table.clients.find((candidate) => candidate.playerId === target.id);
    assert(targetClient, "Da Vinci target client missing.");
    const targetOwnState = publicState<any>(table, targetClient);
    const targetOwnPlayer = targetOwnState.players.find((player: any) => player.id === target.id);
    const guess = targetOwnPlayer.hand[hiddenIndex].value;
    assert(Number.isInteger(guess), "Da Vinci target value hidden from its owner.");
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

  const completed = Boolean(publicState<any>(table).winnerId);
  await closeTable(table);
  return { gameId: "davinci-code-plus", title: "다빈치 코드 플러스", players: 2, mode: "playthrough", actions, completed, note: "hidden info per viewer and correct guesses" };
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

async function playGhosts(baseUrl: string): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "ghosts", 2);
  const p1 = table.clients[0];
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

  const completed = Boolean(publicState<any>(table).winnerId);
  await closeTable(table);
  return { gameId: "ghosts", title: "고스트", players: 2, mode: "playthrough", actions, completed, note: "good ghost escape" };
}

function blokusActions(table: GameTable, client: QaClient) {
  const state = publicState<any>(table, client);
  const player = state.players.find((candidate: any) => candidate.id === client.playerId);
  assert(player, "Blokus active player state missing.");
  for (const pieceId of player.remainingPieceIds) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      for (const flipped of [false, true]) {
        for (let y = 0; y < 20; y += 1) {
          for (let x = 0; x < 20; x += 1) {
            const action = { type: "place-piece", payload: { pieceId, x, y, rotation, flipped } };
            try {
              tryLocal(blokusModule, table, state, action, client.playerId);
              return [{ action, score: 0 }];
            } catch {
              // Not a legal placement.
            }
          }
        }
      }
    }
  }
  return [];
}

async function playBlokus(baseUrl: string): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "blokus", 2);
  let actions = 0;

  while (publicState<any>(table).phase !== "finished" && actions < 80) {
    const client = activeClient(table);
    const state = publicState<any>(table, client);
    const player = state.players.find((candidate: any) => candidate.id === client.playerId);
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

  const completed = publicState<any>(table).phase === "finished";
  await closeTable(table);
  return { gameId: "blokus", title: "블로커스", players: 2, mode: "playthrough", actions, completed, note: "legal placement until finish" };
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
        const score = (after - before) * 10000 + (message.includes("pushed") ? 100 : 0) + rng();
        actions.push({ action, score });
      } catch {
        // Not a legal move.
      }
    }
  }

  actions.sort((a, b) => b.score - a.score);
  return actions;
}

async function playAbalone(baseUrl: string): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "abalone-classic", 2);
  const rng = createRng(1);
  let actions = 0;

  while (!publicState<any>(table).winnerId && actions < 300) {
    const client = activeClient(table);
    const legal = abaloneActions(table, client, rng);
    assert(legal.length > 0, "Abalone legal move not found.");
    await gameAction(table, client, legal[0].action);
    actions += 1;
  }

  const completed = Boolean(publicState<any>(table).winnerId);
  await closeTable(table);
  return { gameId: "abalone-classic", title: "아발론 클래식", players: 2, mode: "playthrough", actions, completed, note: "generated legal moves to six pushes" };
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

async function playYinsh(baseUrl: string): Promise<QaResult> {
  const table = await createStartedRoom(baseUrl, "yinsh", 2);
  const rng = createRng(1);
  let actions = 0;

  while (publicState<any>(table).phase !== "finished" && actions < 80) {
    const client = activeClient(table);
    const legal = yinshActions(table, client, rng);
    assert(legal.length > 0, "YINSH legal action not found.");
    await gameAction(table, client, legal[0].action);
    actions += 1;
  }

  const completed = publicState<any>(table).phase === "finished";
  await closeTable(table);
  return { gameId: "yinsh", title: "인쉬", players: 2, mode: "playthrough", actions, completed, note: "ring placement, rows, removals, win" };
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

async function main() {
  const { baseUrl, child } = await startServer();
  const results: QaResult[] = [];
  try {
    results.push(...await runStartMatrix(baseUrl));
    const scenarios = [
      playGuryongtu,
      playQuoridor,
      playAbalone,
      playGhosts,
      playQawale,
      playDavinci,
      playBlokus,
      playYacht,
      playYinsh,
      playHangman
    ];

    for (const scenario of scenarios) {
      console.log(`[playthrough] ${scenario.name}`);
      const result = await scenario(baseUrl);
      results.push(result);
      console.log(`[ok] ${result.title} ${result.mode}: ${result.actions} actions, completed=${result.completed}`);
    }

    const completedPlaythroughs = results.filter((result) => result.mode === "playthrough" && result.completed).length;
    await waitForStats(baseUrl, completedPlaythroughs);

    const failed = results.filter((result) => !result.completed);
    console.table(
      results.map((result) => ({
        game: result.title,
        players: result.players,
        mode: result.mode,
        actions: result.actions,
        completed: result.completed,
        note: result.note
      }))
    );
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

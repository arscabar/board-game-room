import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { games, getGameById } from "../src/shared/games";
import { canPlayGame, ROOM_MAX_PLAYERS } from "../src/shared/eligibility";
import type { Ack, GameRuntimeState, MoveEntry, PlayerSnapshot, RoomSnapshot } from "../src/shared/types";
import { getGameRegistration } from "../src/game-modules/registry";
import type { GameAction } from "../src/game-modules/types";
import type { MatchRecord, MatchResult } from "../src/shared/stats";
import { createMatchId, createStatsStore, normalizePlayerKey } from "./statsStore";

interface MutablePlayer extends PlayerSnapshot {
  disconnectedAt?: number;
}

interface RoomRecord {
  code: string;
  maxPlayers: number;
  players: MutablePlayer[];
  selectedGameId: string | null;
  status: "lobby" | "playing";
  gameState: GameRuntimeState;
  gamePrivateState: unknown;
  statsRecorded: boolean;
  createdAt: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map<string, RoomRecord>();
const DISCONNECT_GRACE_MS = 120_000;
const statsStore = createStatsStore();
const statsReady = statsStore.init();
statsReady.catch((error) => {
  console.error("Stats store initialization failed.", error);
});

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, rooms: rooms.size });
});

app.get("/api/games", (_request, response) => {
  response.json(games);
});

app.get("/api/stats/summary", async (_request, response) => {
  try {
    await statsReady;
    response.json(await statsStore.getSummary());
  } catch (error) {
    response.status(503).json({ error: statsErrorMessage(error) });
  }
});

app.get("/api/stats/leaderboard", async (request, response) => {
  const gameId =
    typeof request.query.gameId === "string" && request.query.gameId && request.query.gameId !== "all"
      ? request.query.gameId
      : null;
  const limit = parseLimit(request.query.limit, 20);

  try {
    await statsReady;
    response.json(await statsStore.getLeaderboard(gameId, limit));
  } catch (error) {
    response.status(503).json({ error: statsErrorMessage(error) });
  }
});

app.get("/api/stats/player/:name", async (request, response) => {
  try {
    await statsReady;
    response.json(await statsStore.getPlayerStats(request.params.name, parseLimit(request.query.limit, 10)));
  } catch (error) {
    response.status(503).json({ error: statsErrorMessage(error) });
  }
});

app.get("/api/stats/recent", async (request, response) => {
  try {
    await statsReady;
    response.json(await statsStore.getRecentMatches(parseLimit(request.query.limit, 12)));
  } catch (error) {
    response.status(503).json({ error: statsErrorMessage(error) });
  }
});

const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath));
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(distPath, "index.html"));
});

function createEmptyRuntime(): GameRuntimeState {
  return {
    activePlayerId: null,
    turnNumber: 0,
    roundNumber: 1,
    moveLog: [],
    startedAt: null
  };
}

function statsErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "통계 저장소에 연결할 수 없습니다.";
  return message.slice(0, 180);
}

function parseLimit(value: unknown, fallback: number) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function normalizeName(name: unknown) {
  const trimmed = String(name ?? "").trim();
  return trimmed.slice(0, 16);
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function getNextSeat(players: PlayerSnapshot[]) {
  for (let seat = 1; seat <= ROOM_MAX_PLAYERS; seat += 1) {
    if (!players.some((player) => player.seat === seat)) {
      return seat;
    }
  }
  return ROOM_MAX_PLAYERS + 1;
}

function buildGameContext(room: RoomRecord, currentPlayerId: string) {
  const game = getGameById(room.selectedGameId);
  if (!game) {
    return null;
  }

  return {
    game,
    players: snapshotPlayers(room),
    activePlayerId: room.gameState.activePlayerId,
    currentPlayerId,
    turnNumber: room.gameState.turnNumber,
    roundNumber: room.gameState.roundNumber
  };
}

function snapshotPlayers(room: RoomRecord) {
  return room.players
    .map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      connected: player.connected,
      isHost: player.isHost,
      joinedAt: player.joinedAt
    }))
    .sort((a, b) => a.seat - b.seat);
}

function snapshotRoom(room: RoomRecord, viewerId: string | null = null): RoomSnapshot {
  const registration = getGameRegistration(room.selectedGameId);
  const context = viewerId ? buildGameContext(room, viewerId) : null;
  const publicState =
    room.status === "playing" && registration && context
      ? registration.module.getPublicState(room.gamePrivateState, { ...context, viewerId })
      : room.gameState.publicState;

  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    players: snapshotPlayers(room),
    selectedGameId: room.selectedGameId,
    status: room.status,
    gameState: {
      ...room.gameState,
      publicState,
      moveLog: [...room.gameState.moveLog]
    },
    createdAt: room.createdAt
  };
}

async function broadcastRoom(room: RoomRecord) {
  const sockets = await io.in(room.code).fetchSockets();
  for (const roomSocket of sockets) {
    const viewerId = roomSocket.data.playerId as string | undefined;
    roomSocket.emit("room:state", snapshotRoom(room, viewerId ?? null));
  }
}

function reply<T>(ack: ((response: Ack<T>) => void) | undefined, response: Ack<T>) {
  if (typeof ack === "function") {
    ack(response);
  }
}

function currentPlayer(socket: Socket, room: RoomRecord) {
  const playerId = socket.data.playerId as string | undefined;
  return room.players.find((player) => player.id === playerId) ?? null;
}

function requireRoom(socket: Socket, code: unknown) {
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  const room = rooms.get(normalizedCode);
  if (!room) {
    return { room: null, error: "방을 찾을 수 없습니다." };
  }

  const player = currentPlayer(socket, room);
  if (!player) {
    return { room: null, error: "이 방의 플레이어가 아닙니다." };
  }

  return { room, player, error: null };
}

function assertHost(player: PlayerSnapshot | null | undefined) {
  return Boolean(player?.isHost);
}

function connectedPlayers(room: RoomRecord) {
  return room.players.filter((player) => player.connected).sort((a, b) => a.seat - b.seat);
}

function assignHost(room: RoomRecord) {
  if (room.players.some((player) => player.isHost && player.connected)) {
    return;
  }

  const nextHost = connectedPlayers(room)[0] ?? room.players.sort((a, b) => a.seat - b.seat)[0];
  room.players.forEach((player) => {
    player.isHost = player.id === nextHost?.id;
  });
}

function clearInvalidSelection(room: RoomRecord) {
  const selectedGame = getGameById(room.selectedGameId);
  if (!selectedGame) {
    room.selectedGameId = null;
    return;
  }

  if (!canPlayGame(selectedGame, connectedPlayers(room).length)) {
    room.selectedGameId = null;
  }
}

function pruneDisconnected(room: RoomRecord) {
  if (room.status !== "lobby") {
    return;
  }

  const now = Date.now();
  room.players = room.players.filter((player) => {
    if (player.connected) {
      return true;
    }
    return !player.disconnectedAt || now - player.disconnectedAt < DISCONNECT_GRACE_MS;
  });

  if (room.players.length > 0) {
    assignHost(room);
    clearInvalidSelection(room);
  }
}

function appendLog(room: RoomRecord, player: PlayerSnapshot, action: string) {
  const entry: MoveEntry = {
    id: randomUUID(),
    time: Date.now(),
    playerId: player.id,
    playerName: player.name,
    action: action.trim().slice(0, 120)
  };
  room.gameState.moveLog = [entry, ...room.gameState.moveLog].slice(0, 40);
}

function advanceTurn(room: RoomRecord) {
  const players = connectedPlayers(room);
  if (players.length === 0) {
    room.gameState.activePlayerId = null;
    return;
  }

  const currentIndex = players.findIndex((player) => player.id === room.gameState.activePlayerId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % players.length;
  room.gameState.activePlayerId = players[nextIndex].id;
  room.gameState.turnNumber += 1;
  if (nextIndex === 0 && currentIndex !== -1) {
    room.gameState.roundNumber += 1;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberFromPlayerRecord(record: unknown, playerId: string) {
  const value = asRecord(record)?.[playerId];
  return finiteNumber(value);
}

function sumNumericValues(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  let total = 0;
  let hasNumber = false;
  for (const item of Object.values(record)) {
    const number = finiteNumber(item);
    if (number !== null) {
      total += number;
      hasNumber = true;
    }
  }

  return hasNumber ? total : null;
}

function winnerIdsFrom(room: RoomRecord) {
  const privateState = asRecord(room.gamePrivateState);
  const publicState = asRecord(room.gameState.publicState);
  const winnerIds = new Set<string>();

  for (const value of [privateState?.winnerIds, publicState?.winnerIds]) {
    if (Array.isArray(value)) {
      for (const winnerId of value) {
        if (typeof winnerId === "string" && winnerId) {
          winnerIds.add(winnerId);
        }
      }
    }
  }

  for (const value of [room.gameState.winnerId, privateState?.winnerId, publicState?.winnerId]) {
    if (typeof value === "string" && value) {
      winnerIds.add(value);
    }
  }

  return [...winnerIds];
}

function phaseFrom(room: RoomRecord) {
  const privateState = asRecord(room.gamePrivateState);
  const publicState = asRecord(room.gameState.publicState);
  return String(room.gameState.phase ?? privateState?.phase ?? publicState?.phase ?? "");
}

function roomGameIsFinished(room: RoomRecord) {
  if (winnerIdsFrom(room).length > 0) {
    return true;
  }

  return ["complete", "finished"].includes(phaseFrom(room));
}

function scoreForPlayer(gameId: string, state: unknown, playerId: string) {
  const record = asRecord(state);
  if (!record) {
    return null;
  }

  if (gameId === "yacht-dice") {
    const totals = numberFromPlayerRecord(record.totals, playerId);
    if (totals !== null) return totals;
    return sumNumericValues(asRecord(record.scores)?.[playerId]);
  }

  if (gameId === "guryongtu") {
    return numberFromPlayerRecord(record.scores, playerId);
  }

  if (gameId === "hangman-board-game") {
    return numberFromPlayerRecord(record.wins, playerId);
  }

  if (gameId === "abalone-classic") {
    return numberFromPlayerRecord(record.pushedOff, playerId);
  }

  if (gameId === "blokus" && Array.isArray(record.board)) {
    return record.board.reduce((total, row) => {
      if (!Array.isArray(row)) return total;
      return total + row.filter((cell) => cell === playerId).length;
    }, 0);
  }

  if (gameId === "yinsh") {
    const players = asRecord(record.players);
    const ringsRemoved = asRecord(record.ringsRemoved);
    if (!players || !ringsRemoved) return null;

    for (const [color, player] of Object.entries(players)) {
      if (asRecord(player)?.id === playerId) {
        return finiteNumber(ringsRemoved[color]);
      }
    }
  }

  return null;
}

function resultForPlayer(playerId: string, winnerIds: string[]): MatchResult {
  if (winnerIds.length === 0) {
    return "draw";
  }
  return winnerIds.includes(playerId) ? "win" : "loss";
}

function buildMatchRecord(room: RoomRecord): MatchRecord | null {
  const game = getGameById(room.selectedGameId);
  if (!game || !roomGameIsFinished(room)) {
    return null;
  }

  const finishedAt = Date.now();
  const winnerIds = winnerIdsFrom(room);
  const players = snapshotPlayers(room).map((player) => ({
    playerId: player.id,
    playerKey: normalizePlayerKey(player.name),
    playerName: player.name,
    score: scoreForPlayer(game.id, room.gamePrivateState, player.id),
    result: resultForPlayer(player.id, winnerIds)
  }));

  return {
    id: createMatchId(room.code, game.id, room.gameState.startedAt),
    gameId: game.id,
    gameTitle: game.title,
    roomCode: room.code,
    startedAt: room.gameState.startedAt,
    finishedAt,
    durationMs: room.gameState.startedAt ? finishedAt - room.gameState.startedAt : null,
    winnerIds,
    players
  };
}

async function recordRoomStatsIfFinished(room: RoomRecord) {
  if (room.statsRecorded) {
    return;
  }

  const match = buildMatchRecord(room);
  if (!match) {
    return;
  }

  room.statsRecorded = true;
  try {
    await statsReady;
    await statsStore.recordMatch(match);
  } catch (error) {
    room.statsRecorded = false;
    console.error("Failed to record game stats.", error);
  }
}

io.on("connection", (socket) => {
  socket.on("room:create", (payload: { name?: string }, ack?: (response: Ack<{ room: RoomSnapshot; playerId: string }>) => void) => {
    const name = normalizeName(payload?.name);
    if (!name) {
      reply(ack, { ok: false, error: "이름을 입력해야 방을 만들 수 있습니다." });
      return;
    }

    const code = createRoomCode();
    const player: MutablePlayer = {
      id: randomUUID(),
      name,
      seat: 1,
      connected: true,
      isHost: true,
      joinedAt: Date.now()
    };

    const room: RoomRecord = {
      code,
      maxPlayers: ROOM_MAX_PLAYERS,
      players: [player],
      selectedGameId: null,
      status: "lobby",
      gameState: createEmptyRuntime(),
      gamePrivateState: null,
      statsRecorded: false,
      createdAt: Date.now()
    };

    rooms.set(code, room);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    socket.join(code);
    reply(ack, { ok: true, data: { room: snapshotRoom(room), playerId: player.id } });
    broadcastRoom(room);
  });

  socket.on("room:join", (payload: { code?: string; name?: string }, ack?: (response: Ack<{ room: RoomSnapshot; playerId: string }>) => void) => {
    const code = String(payload?.code ?? "").trim().toUpperCase();
    const name = normalizeName(payload?.name);
    const room = rooms.get(code);

    if (!room) {
      reply(ack, { ok: false, error: "방 코드를 확인해주세요." });
      return;
    }

    if (!name) {
      reply(ack, { ok: false, error: "이름을 입력해야 입장할 수 있습니다." });
      return;
    }

    if (room.status !== "lobby") {
      reply(ack, { ok: false, error: "이미 게임이 시작된 방입니다." });
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      reply(ack, { ok: false, error: "이 방은 이미 4명이 모두 입장했습니다." });
      return;
    }

    const player: MutablePlayer = {
      id: randomUUID(),
      name,
      seat: getNextSeat(room.players),
      connected: true,
      isHost: false,
      joinedAt: Date.now()
    };

    room.players.push(player);
    clearInvalidSelection(room);
    assignHost(room);
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    reply(ack, { ok: true, data: { room: snapshotRoom(room), playerId: player.id } });
    broadcastRoom(room);
  });

  socket.on("room:select-game", (payload: { code?: string; gameId?: string }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (!assertHost(result.player)) {
      reply(ack, { ok: false, error: "방장만 게임을 선택할 수 있습니다." });
      return;
    }

    if (result.room.status !== "lobby") {
      reply(ack, { ok: false, error: "게임 중에는 선택을 바꿀 수 없습니다." });
      return;
    }

    const game = getGameById(payload?.gameId);
    if (!game) {
      reply(ack, { ok: false, error: "게임 정보를 찾을 수 없습니다." });
      return;
    }

    const playerCount = connectedPlayers(result.room).length;
    if (!canPlayGame(game, playerCount)) {
      reply(ack, { ok: false, error: `${game.title}은 현재 ${playerCount}명으로 시작할 수 없습니다.` });
      return;
    }

    result.room.selectedGameId = game.id;
    reply(ack, { ok: true, data: snapshotRoom(result.room) });
    broadcastRoom(result.room);
  });

  socket.on("room:start-game", (payload: { code?: string }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (!assertHost(result.player)) {
      reply(ack, { ok: false, error: "방장만 게임을 시작할 수 있습니다." });
      return;
    }

    const game = getGameById(result.room.selectedGameId);
    const playerList = connectedPlayers(result.room);
    if (!game || !canPlayGame(game, playerList.length)) {
      reply(ack, { ok: false, error: "현재 인원에 맞는 게임을 먼저 선택해주세요." });
      return;
    }

    result.room.status = "playing";
    result.room.gameState = createEmptyRuntime();
    result.room.statsRecorded = false;
    result.room.gameState.activePlayerId = playerList[0]?.id ?? null;
    result.room.gameState.turnNumber = 1;
    result.room.gameState.startedAt = Date.now();
    const registration = getGameRegistration(game.id);
    result.room.gamePrivateState = registration
      ? registration.module.createInitialState({ game, players: snapshotPlayers(result.room) })
      : null;
    if (registration) {
      const context = buildGameContext(result.room, result.player.id);
      result.room.gameState.publicState = context
        ? registration.module.getPublicState(result.room.gamePrivateState, { ...context, viewerId: result.player.id })
        : null;
    }
    appendLog(result.room, result.player, `${game.title} 게임 시작`);
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
    broadcastRoom(result.room);
  });

  socket.on("game:action", (payload: { code?: string; action?: GameAction }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (result.room.status !== "playing") {
      reply(ack, { ok: false, error: "게임이 시작된 뒤에만 행동할 수 있습니다." });
      return;
    }

    const registration = getGameRegistration(result.room.selectedGameId);
    const context = result.player ? buildGameContext(result.room, result.player.id) : null;
    if (!registration || !context) {
      reply(ack, { ok: false, error: "이 게임은 아직 세부 플레이 모듈이 연결되지 않았습니다." });
      return;
    }

    const action = payload?.action;
    if (!action || typeof action.type !== "string") {
      reply(ack, { ok: false, error: "게임 행동 형식이 올바르지 않습니다." });
      return;
    }

    try {
      const outcome = registration.module.applyAction(result.room.gamePrivateState, action, context);
      result.room.gamePrivateState = outcome.state;
      if (outcome.activePlayerId !== undefined) {
        result.room.gameState.activePlayerId = outcome.activePlayerId;
      }
      if (outcome.turnNumber !== undefined) {
        result.room.gameState.turnNumber = outcome.turnNumber;
      }
      if (outcome.roundNumber !== undefined) {
        result.room.gameState.roundNumber = outcome.roundNumber;
      }
      if (outcome.phase !== undefined) {
        result.room.gameState.phase = outcome.phase;
      }
      if (outcome.message !== undefined) {
        result.room.gameState.message = outcome.message;
      }
      if (outcome.winnerId !== undefined) {
        result.room.gameState.winnerId = outcome.winnerId;
      }
      const viewerState = registration.module.getPublicState(result.room.gamePrivateState, {
        ...context,
        activePlayerId: result.room.gameState.activePlayerId,
        turnNumber: result.room.gameState.turnNumber,
        roundNumber: result.room.gameState.roundNumber,
        viewerId: result.player.id
      });
      result.room.gameState.publicState = viewerState;
      if (outcome.log) {
        appendLog(result.room, result.player, outcome.log);
      }
      void recordRoomStatsIfFinished(result.room);
      reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
      broadcastRoom(result.room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "게임 행동 처리 중 오류가 발생했습니다.";
      reply(ack, { ok: false, error: message });
    }
  });

  socket.on("room:record-action", (payload: { code?: string; action?: string }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (result.room.status !== "playing") {
      reply(ack, { ok: false, error: "게임이 시작된 뒤에 행동을 기록할 수 있습니다." });
      return;
    }

    const action = String(payload?.action ?? "").trim();
    if (!action) {
      reply(ack, { ok: false, error: "기록할 행동을 입력해주세요." });
      return;
    }

    appendLog(result.room, result.player, action);
    reply(ack, { ok: true, data: snapshotRoom(result.room) });
    broadcastRoom(result.room);
  });

  socket.on("room:advance-turn", (payload: { code?: string }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (result.room.status !== "playing") {
      reply(ack, { ok: false, error: "진행 중인 게임이 없습니다." });
      return;
    }

    const activePlayer = result.room.players.find((player) => player.id === result.room.gameState.activePlayerId);
    if (activePlayer && activePlayer.id !== result.player?.id && !result.player?.isHost) {
      reply(ack, { ok: false, error: "현재 차례의 플레이어 또는 방장만 턴을 넘길 수 있습니다." });
      return;
    }

    appendLog(result.room, result.player, "턴 종료");
    advanceTurn(result.room);
    reply(ack, { ok: true, data: snapshotRoom(result.room) });
    broadcastRoom(result.room);
  });

  socket.on("room:return-lobby", (payload: { code?: string }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (!assertHost(result.player)) {
      reply(ack, { ok: false, error: "방장만 로비로 돌아갈 수 있습니다." });
      return;
    }

    void recordRoomStatsIfFinished(result.room);
    result.room.status = "lobby";
    result.room.gameState = createEmptyRuntime();
    result.room.gamePrivateState = null;
    result.room.statsRecorded = false;
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
    broadcastRoom(result.room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode as string | undefined;
    const playerId = socket.data.playerId as string | undefined;
    if (!code || !playerId) {
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      return;
    }

    const player = room.players.find((roomPlayer) => roomPlayer.id === playerId);
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
    }

    assignHost(room);
    clearInvalidSelection(room);
    if (room.status === "playing" && room.gameState.activePlayerId === playerId) {
      advanceTurn(room);
    }
    broadcastRoom(room);

    setTimeout(() => {
      const staleRoom = rooms.get(code);
      if (!staleRoom) {
        return;
      }

      pruneDisconnected(staleRoom);
      if (staleRoom.players.length === 0 || connectedPlayers(staleRoom).length === 0) {
        rooms.delete(code);
        return;
      }

      broadcastRoom(staleRoom);
    }, DISCONNECT_GRACE_MS);
  });
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

function localNetworkUrls(serverPort: number) {
  return Object.values(os.networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .filter((networkInterface) => networkInterface.family === "IPv4" && !networkInterface.internal)
    .map((networkInterface) => `http://${networkInterface.address}:${serverPort}`);
}

httpServer.listen(port, host, () => {
  console.log(`Board Game Room server listening on http://localhost:${port}`);
  for (const url of localNetworkUrls(port)) {
    console.log(`LAN access: ${url}`);
  }
});

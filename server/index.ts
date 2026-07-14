import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { games, getGameById } from "../src/shared/games";
import { canPlayGame, ROOM_MAX_PLAYERS } from "../src/shared/eligibility";
import { gameUsesTurnTimer } from "../src/shared/timers";
import type { Ack, GameRuntimeState, MoveEntry, PlayerAvatar, PlayerSnapshot, PublicRoomListItem, RoomSnapshot } from "../src/shared/types";
import { getGameRegistration } from "../src/game-modules/registry";
import type { GameAction, GameActionResult, GameContext, GameSystemAction } from "../src/game-modules/types";
import type { MatchRecord, MatchResult } from "../src/shared/stats";
import { createMatchId, createStatsStore, normalizePlayerKey } from "./statsStore";

interface MutablePlayer extends PlayerSnapshot {
  clientKey?: string;
  disconnectedAt?: number;
}

interface RoomRecord {
  code: string;
  maxPlayers: number;
  players: MutablePlayer[];
  ownerPlayerId: string;
  ownerClientKey?: string;
  selectedGameId: string | null;
  status: "lobby" | "playing";
  gameState: GameRuntimeState;
  gamePrivateState: unknown;
  postGameNotices: Record<string, string>;
  statsRecorded: boolean;
  createdAt: number;
  processedActionIds: Set<string>;
  matchRngSeed: string | null;
  activeSocketIdByPlayerId: Map<string, string>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.set("etag", "weak");
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map<string, RoomRecord>();
const DISCONNECT_GRACE_MS = 24 * 60 * 60 * 1000;
const EMPTY_ROOM_GRACE_MS = parsePositiveInteger(process.env.EMPTY_ROOM_GRACE_MS, 30 * 60 * 1000);
const DEFAULT_TURN_TIMER_MS = 120_000;
const MIN_TURN_TIMER_MS = 30_000;
const MAX_TURN_TIMER_MS = 600_000;
const MAX_PROCESSED_ACTION_IDS = 2_048;
const turnTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const emptyRoomCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const statsStore = createStatsStore();
const statsReady = statsStore.init();
statsReady.catch((error) => {
  console.error("Stats store initialization failed.", error);
});

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, rooms: rooms.size, emptyRoomGraceMs: EMPTY_ROOM_GRACE_MS });
});

app.get("/api/games", (_request, response) => {
  response.json(games);
});

app.get("/api/rooms", (_request, response) => {
  response.json(publicRoomList());
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

app.post("/api/stats/identity", async (request, response) => {
  try {
    await statsReady;
    const clientKey = normalizeClientKey(request.body?.clientKey);
    if (!clientKey) {
      response.status(400).json({ error: "유효한 사용자 식별자가 필요합니다." });
      return;
    }
    const fallbackName = typeof request.body?.name === "string" ? request.body.name : "플레이어";
    response.json(
      await statsStore.getPlayerStatsByKey(
        playerKeyFromClientKey(clientKey),
        normalizeName(fallbackName) || "플레이어",
        parseLimit(request.body?.limit, 10)
      )
    );
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
const oneDaySeconds = 24 * 60 * 60;
const sevenDaysSeconds = 7 * oneDaySeconds;
const oneYearSeconds = 365 * oneDaySeconds;
const hashedViteAssetPattern = /^assets\/(?:.+\/)?[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/;

function normalizedDistPath(filePath: string) {
  return path.relative(distPath, filePath).split(path.sep).join("/");
}

function setStaticCacheHeaders(response: express.Response, filePath: string) {
  const relativePath = normalizedDistPath(filePath);

  if (relativePath === "index.html") {
    setHtmlNoStoreHeaders(response);
    return;
  }

  if (hashedViteAssetPattern.test(relativePath)) {
    response.setHeader("Cache-Control", `public, max-age=${oneYearSeconds}, immutable`);
    return;
  }

  if (/^(?:board-assets|brand|game-assets)\//.test(relativePath)) {
    response.setHeader("Cache-Control", `public, max-age=${sevenDaysSeconds}, stale-while-revalidate=${oneDaySeconds}`);
    return;
  }

  response.setHeader("Cache-Control", `public, max-age=${oneDaySeconds}, stale-while-revalidate=${sevenDaysSeconds}`);
}

function setHtmlNoStoreHeaders(response: express.Response) {
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  response.setHeader("Surrogate-Control", "no-store");
}

app.use(
  express.static(distPath, {
    etag: true,
    index: false,
    lastModified: true,
    setHeaders: setStaticCacheHeaders
  })
);
app.get(/.*/, (_request, response) => {
  setHtmlNoStoreHeaders(response);
  response.sendFile(path.join(distPath, "index.html"), {
    lastModified: true
  });
});

function createEmptyRuntime(): GameRuntimeState {
  return {
    activePlayerId: null,
    revision: 0,
    turnNumber: 0,
    roundNumber: 1,
    moveLog: [],
    startedAt: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    turnTimerMs: DEFAULT_TURN_TIMER_MS,
    paused: false,
    pausedAt: null,
    pausedBy: null,
    totalPausedMs: 0,
    timeoutCounts: {},
    lastTimeoutAt: null,
    interactivePlayerIds: []
  };
}

function clearPostGameNotices(room: RoomRecord) {
  room.postGameNotices = {};
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

function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeName(name: unknown) {
  const trimmed = String(name ?? "").trim();
  return trimmed.slice(0, 16);
}

const defaultAvatar: PlayerAvatar = {
  body: "pawn",
  face: "smile",
  accessory: "none",
  palette: "teal"
};

const avatarOptions = {
  body: ["pawn", "round", "bot", "crest"],
  face: ["smile", "focus", "wink", "calm"],
  accessory: ["none", "crown", "glasses", "cap", "spark"],
  palette: ["teal", "amber", "blue", "rose", "violet", "ivory"]
} as const;

function pickAvatarValue<T extends keyof typeof avatarOptions>(key: T, value: unknown, fallback: PlayerAvatar[T]) {
  return avatarOptions[key].includes(value as never) ? (value as PlayerAvatar[T]) : fallback;
}

function normalizeAvatar(avatar: unknown): PlayerAvatar {
  const record = asRecord(avatar);
  if (!record) {
    return { ...defaultAvatar };
  }

  return {
    body: pickAvatarValue("body", record.body, defaultAvatar.body),
    face: pickAvatarValue("face", record.face, defaultAvatar.face),
    accessory: pickAvatarValue("accessory", record.accessory, defaultAvatar.accessory),
    palette: pickAvatarValue("palette", record.palette, defaultAvatar.palette)
  };
}

function payloadHasAvatar(payload: unknown) {
  return Boolean(payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "avatar"));
}

function normalizeClientKey(clientKey: unknown) {
  const trimmed = String(clientKey ?? "").trim();
  if (!trimmed || trimmed.length > 128) {
    return "";
  }
  return /^[a-zA-Z0-9:_-]+$/.test(trimmed) ? trimmed : "";
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function stablePlayerId(clientKey: string) {
  return `player-${shortHash(clientKey)}`;
}

function playerKeyFromClientKey(clientKey: string) {
  const normalized = normalizeClientKey(clientKey);
  return normalized ? `guest:${shortHash(normalized)}` : normalizePlayerKey("플레이어");
}

function statsKeyForPlayer(player: MutablePlayer) {
  return player.clientKey ? playerKeyFromClientKey(player.clientKey) : normalizePlayerKey(player.name);
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
    roundNumber: room.gameState.roundNumber,
    rngSeed: room.matchRngSeed ?? undefined,
    now: Date.now()
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
      joinedAt: player.joinedAt,
      avatar: normalizeAvatar(player.avatar)
    }))
    .sort((a, b) => a.seat - b.seat);
}

function canDeleteRoom(room: RoomRecord, player: MutablePlayer | PlayerSnapshot | null | undefined) {
  if (!player) {
    return false;
  }
  const mutablePlayer = player as MutablePlayer;
  if (room.ownerClientKey && mutablePlayer.clientKey && room.ownerClientKey === mutablePlayer.clientKey) {
    return true;
  }
  return room.ownerPlayerId === player.id;
}

function snapshotRoom(room: RoomRecord, viewerId: string | null = null): RoomSnapshot {
  const registration = getGameRegistration(room.selectedGameId);
  const projectionPlayerId = viewerId ?? snapshotPlayers(room)[0]?.id ?? null;
  const context = projectionPlayerId ? buildGameContext(room, projectionPlayerId) : null;
  const viewerPlayer = viewerId ? room.players.find((player) => player.id === viewerId) ?? null : null;
  const publicState =
    room.status === "playing" && registration && context
      ? registration.module.getPublicState(room.gamePrivateState, { ...context, viewerId })
      : room.gameState.publicState;
  const viewerPostGameNotice = viewerId ? room.postGameNotices[viewerId] : undefined;

  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    players: snapshotPlayers(room),
    selectedGameId: room.selectedGameId,
    status: room.status,
    gameState: {
      ...room.gameState,
      postGameNotice: viewerPostGameNotice ?? null,
      publicState,
      moveLog: [...room.gameState.moveLog]
    },
    createdAt: room.createdAt,
    canDeleteRoom: canDeleteRoom(room, viewerPlayer)
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

function publicRoomList(): PublicRoomListItem[] {
  const list: PublicRoomListItem[] = [];

  for (const room of rooms.values()) {
    const connected = connectedPlayers(room);
    if (connected.length === 0) {
      continue;
    }

    const selectedGame = getGameById(room.selectedGameId);
    const host = connected.find((player) => player.isHost) ?? connected[0] ?? null;
    list.push({
      code: room.code,
      playerCount: connected.length,
      maxPlayers: room.maxPlayers,
      status: room.status,
      selectedGameId: room.selectedGameId,
      selectedGameTitle: selectedGame?.title ?? null,
      hostName: host?.name ?? null,
      hostAvatar: host ? normalizeAvatar(host.avatar) : null,
      createdAt: room.createdAt,
      canJoin: room.status === "lobby" && connected.length < room.maxPlayers
    });
  }

  return list.sort((a, b) => {
    if (a.canJoin !== b.canJoin) {
      return a.canJoin ? -1 : 1;
    }
    if (a.status !== b.status) {
      return a.status === "lobby" ? -1 : 1;
    }
    return b.createdAt - a.createdAt;
  });
}

function broadcastRoomList() {
  io.emit("rooms:list", publicRoomList());
}

function clearEmptyRoomCleanup(code: string) {
  const timer = emptyRoomCleanupTimers.get(code);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  emptyRoomCleanupTimers.delete(code);
}

function deleteRoom(room: RoomRecord, reason = "방이 정리되었습니다.") {
  clearScheduledTurnTimeout(room);
  clearEmptyRoomCleanup(room.code);
  void recordRoomStatsIfFinished(room);
  rooms.delete(room.code);
  io.to(room.code).emit("room:deleted", { code: room.code, reason });
  io.in(room.code).socketsLeave(room.code);
  broadcastRoomList();
}

function scheduleEmptyRoomCleanup(room: RoomRecord) {
  if (connectedPlayers(room).length > 0) {
    clearEmptyRoomCleanup(room.code);
    return;
  }

  if (emptyRoomCleanupTimers.has(room.code)) {
    return;
  }

  const timer = setTimeout(() => {
    const staleRoom = rooms.get(room.code);
    if (!staleRoom) {
      clearEmptyRoomCleanup(room.code);
      return;
    }
    if (connectedPlayers(staleRoom).length > 0) {
      clearEmptyRoomCleanup(staleRoom.code);
      return;
    }
    deleteRoom(staleRoom);
  }, EMPTY_ROOM_GRACE_MS);
  timer.unref?.();
  emptyRoomCleanupTimers.set(room.code, timer);
}

function findReturningPlayer(room: RoomRecord, playerId: unknown, clientKey: unknown) {
  const savedPlayerId = String(playerId ?? "").trim();
  const savedClientKey = normalizeClientKey(clientKey);
  if (!savedClientKey) {
    return null;
  }
  if (savedPlayerId) {
    const byPlayerId = room.players.find((player) => player.id === savedPlayerId);
    if (byPlayerId?.clientKey && byPlayerId.clientKey === savedClientKey) {
      return byPlayerId;
    }
  }

  return room.players.find((player) => player.clientKey === savedClientKey) ?? null;
}

function attachSocketToPlayer(socket: Socket, room: RoomRecord, player: MutablePlayer, name?: string, avatar?: PlayerAvatar | null) {
  const previousRoomCode = socket.data.roomCode as string | undefined;
  if (previousRoomCode && previousRoomCode !== room.code) {
    const previousPlayerId = socket.data.playerId as string | undefined;
    const previousRoom = rooms.get(previousRoomCode);
    const previousPlayer = previousRoom?.players.find((roomPlayer) => roomPlayer.id === previousPlayerId);
    if (previousRoom && previousPlayer) {
      if (previousRoom.activeSocketIdByPlayerId.get(previousPlayer.id) === socket.id) {
        previousRoom.activeSocketIdByPlayerId.delete(previousPlayer.id);
      }
      previousPlayer.connected = false;
      previousPlayer.disconnectedAt = Date.now();
      assignHost(previousRoom);
      clearInvalidSelection(previousRoom);
      if (!recoverInterruptedBattlefieldSetup(previousRoom, previousPlayer.name)) {
        finishRoomIfPlayersCannotContinue(previousRoom, previousPlayer.name);
      }
      scheduleEmptyRoomCleanup(previousRoom);
      void broadcastRoom(previousRoom);
    }
    socket.leave(previousRoomCode);
  }

  if (name && room.status === "lobby") {
    player.name = name;
  }
  if (avatar) {
    player.avatar = avatar;
  } else {
    player.avatar = normalizeAvatar(player.avatar);
  }
  player.connected = true;
  player.disconnectedAt = undefined;
  const previousSocketId = room.activeSocketIdByPlayerId.get(player.id);
  room.activeSocketIdByPlayerId.set(player.id, socket.id);
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.join(room.code);
  if (previousSocketId && previousSocketId !== socket.id) {
    io.sockets.sockets.get(previousSocketId)?.disconnect(true);
  }
  clearEmptyRoomCleanup(room.code);
  assignHost(room);
  clearInvalidSelection(room);
}

function assignHost(room: RoomRecord) {
  const connectedOwner = room.players.find((player) => {
    if (!player.connected) {
      return false;
    }
    if (player.id === room.ownerPlayerId) {
      return true;
    }
    return Boolean(room.ownerClientKey && player.clientKey && room.ownerClientKey === player.clientKey);
  });

  if (connectedOwner) {
    room.players.forEach((player) => {
      player.isHost = player.id === connectedOwner.id;
    });
    return;
  }

  if (room.players.some((player) => player.isHost && player.connected)) {
    return;
  }

  const nextHost = connectedPlayers(room)[0] ?? room.players.sort((a, b) => a.seat - b.seat)[0];
  room.players.forEach((player) => {
    player.isHost = player.id === nextHost?.id;
  });
}

function clearInvalidSelection(room: RoomRecord) {
  if (room.status !== "lobby") {
    return;
  }

  const selectedGame = getGameById(room.selectedGameId);
  if (!selectedGame) {
    room.selectedGameId = null;
    return;
  }

  if (!canPlayGame(selectedGame, connectedPlayers(room).length)) {
    room.selectedGameId = null;
  }
}

function startGameInRoom(room: RoomRecord, game: NonNullable<ReturnType<typeof getGameById>>) {
  const playerList = connectedPlayers(room);
  room.status = "playing";
  room.gameState = createEmptyRuntime();
  room.gamePrivateState = null;
  clearPostGameNotices(room);
  room.statsRecorded = false;
  room.processedActionIds.clear();
  room.matchRngSeed = randomUUID();
  room.gameState.activePlayerId = playerList[0]?.id ?? null;
  room.gameState.turnNumber = 1;
  room.gameState.startedAt = Date.now();

  const registration = getGameRegistration(game.id);
  room.gamePrivateState = registration
    ? registration.module.createInitialState({
        game,
        players: snapshotPlayers(room).filter((player) => player.connected),
        rngSeed: room.matchRngSeed ?? undefined,
        now: Date.now()
      })
    : null;

  const initialPrivateState = asRecord(room.gamePrivateState);
  if (initialPrivateState && Object.prototype.hasOwnProperty.call(initialPrivateState, "activePlayerId")) {
    room.gameState.activePlayerId =
      typeof initialPrivateState.activePlayerId === "string" ? initialPrivateState.activePlayerId : null;
  }
  if (initialPrivateState && Array.isArray(initialPrivateState.interactivePlayerIds)) {
    room.gameState.interactivePlayerIds = initialPrivateState.interactivePlayerIds.filter(
      (id): id is string => typeof id === "string"
    );
  }

  if (registration) {
    const contextPlayerId = playerList[0]?.id ?? room.gameState.activePlayerId;
    const context = contextPlayerId ? buildGameContext(room, contextPlayerId) : null;
    room.gameState.publicState = context
      ? registration.module.getPublicState(room.gamePrivateState, { ...context, viewerId: contextPlayerId })
      : null;
  }

  resetTurnClock(room);
}

function resetRoomToLobby(room: RoomRecord, options: { preservePostGameNotices?: boolean; clearSelectedGame?: boolean } = {}) {
  void recordRoomStatsIfFinished(room);
  clearScheduledTurnTimeout(room);
  room.status = "lobby";
  room.gameState = createEmptyRuntime();
  room.gamePrivateState = null;
  room.statsRecorded = false;
  room.processedActionIds.clear();
  room.matchRngSeed = null;
  if (!options.preservePostGameNotices) {
    clearPostGameNotices(room);
  }
  if (options.clearSelectedGame) {
    room.selectedGameId = null;
  } else {
    clearInvalidSelection(room);
  }
}

function recoverInterruptedBattlefieldSetup(room: RoomRecord, departedName = "플레이어") {
  if (
    room.status !== "playing" ||
    room.selectedGameId !== "parity-tile-duel" ||
    !["battlefield-reveal", "battlefield-applying"].includes(phaseFrom(room))
  ) {
    return false;
  }

  resetRoomToLobby(room);
  appendSystemLog(room, `${departedName}님이 전장 준비 중 나가서 대결을 취소하고 로비로 돌아왔습니다.`);
  return true;
}

function normalizePostGameChoice(choice: unknown) {
  if (choice === "rematch" || choice === "game-select" || choice === "leave-room") {
    return choice;
  }
  return null;
}

function postGameChoices(room: RoomRecord) {
  if (!room.gameState.postGameChoices) {
    room.gameState.postGameChoices = {};
  }
  return room.gameState.postGameChoices;
}

function pendingRematchPlayerIds(room: RoomRecord) {
  const choices = postGameChoices(room);
  return Object.entries(choices)
    .filter(([, choice]) => choice === "rematch")
    .map(([playerId]) => playerId);
}

function rejectPendingRematches(room: RoomRecord) {
  for (const playerId of pendingRematchPlayerIds(room)) {
    room.postGameNotices[playerId] = "상대가 재대결을 받지 않았습니다.";
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

function appendLogEntry(room: RoomRecord, playerId: string, playerName: string, action: string) {
  const entry: MoveEntry = {
    id: randomUUID(),
    time: Date.now(),
    playerId,
    playerName,
    action: action.trim().slice(0, 120)
  };
  room.gameState.moveLog = [entry, ...room.gameState.moveLog].slice(0, 40);
}

function appendLog(room: RoomRecord, player: PlayerSnapshot, action: string) {
  appendLogEntry(room, player.id, player.name, action);
}

function appendSystemLog(room: RoomRecord, action: string) {
  appendLogEntry(room, "system", "시스템", action);
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

const blokusPieceSizes: Record<string, number> = {
  i1: 1,
  i2: 2,
  i3: 3,
  v3: 3,
  i4: 4,
  l4: 4,
  o4: 4,
  t4: 4,
  z4: 4,
  i5: 5,
  f5: 5,
  l5: 5,
  n5: 5,
  p5: 5,
  t5: 5,
  u5: 5,
  v5: 5,
  w5: 5,
  x5: 5,
  y5: 5,
  z5: 5
};

function blokusColorScore(player: Record<string, unknown>) {
  const placedPieceIds = Array.isArray(player.placedPieceIds)
    ? player.placedPieceIds.filter((pieceId): pieceId is string => typeof pieceId === "string")
    : [];
  const placedCells = placedPieceIds.reduce((total, pieceId) => total + (blokusPieceSizes[pieceId] ?? 0), 0);
  const remaining = 89 - placedCells;
  if (remaining > 0) {
    return -remaining;
  }
  return 15 + (placedPieceIds[placedPieceIds.length - 1] === "i1" ? 5 : 0);
}

function winnerIdsFrom(room: RoomRecord) {
  const privateState = asRecord(room.gamePrivateState);
  const publicState = asRecord(room.gameState.publicState);
  const winnerIds = new Set<string>();

  for (const value of [room.gameState.winnerIds, privateState?.winnerIds, publicState?.winnerIds]) {
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

function finishRoomIfPlayersCannotContinue(room: RoomRecord, departedName = "플레이어") {
  const game = getGameById(room.selectedGameId);
  if (!game || room.status !== "playing" || roomGameIsFinished(room)) {
    return false;
  }

  const survivors = connectedPlayers(room);
  if (survivors.length === 0) {
    return false;
  }

  const startedAsMatch = room.players.length > 1;
  const canContinue =
    startedAsMatch && survivors.length === 1
      ? false
      : canPlayGame(game, survivors.length);

  if (canContinue) {
    return false;
  }

  const winnerIds = survivors.map((player) => player.id);
  const winnerNames = survivors.map((player) => player.name).join(", ");
  const message =
    winnerIds.length === 1
      ? `${winnerNames}님 승리: ${departedName}님이 나가서 게임을 더 진행할 수 없습니다.`
      : `${winnerNames} 공동 승리: ${departedName}님이 나가서 현재 인원으로 게임을 더 진행할 수 없습니다.`;
  const publicState = asRecord(room.gameState.publicState);

  clearScheduledTurnTimeout(room);
  room.gameState.activePlayerId = null;
  room.gameState.phase = "finished";
  room.gameState.message = message;
  room.gameState.winnerId = winnerIds.length === 1 ? winnerIds[0] : null;
  room.gameState.winnerIds = winnerIds;
  room.gameState.turnStartedAt = null;
  room.gameState.turnDeadlineAt = null;
  room.gameState.paused = false;
  room.gameState.pausedAt = null;
  room.gameState.pausedBy = null;
  room.gameState.publicState = {
    ...(publicState ?? {}),
    activePlayerId: null,
    phase: "finished",
    message,
    winnerId: room.gameState.winnerId,
    winnerIds
  };
  appendSystemLog(room, message);
  void recordRoomStatsIfFinished(room);
  return true;
}

function phaseFrom(room: RoomRecord) {
  const privateState = asRecord(room.gamePrivateState);
  const publicState = asRecord(room.gameState.publicState);
  return String(room.gameState.phase ?? privateState?.phase ?? publicState?.phase ?? "");
}

function canApplyStaleBattlefieldAcknowledgement(
  room: RoomRecord,
  playerId: string,
  action: GameAction,
  currentRevision: number
) {
  if (
    room.selectedGameId !== "parity-tile-duel" ||
    action.type !== "tile/acknowledge-battlefield" ||
    !Number.isSafeInteger(action.expectedRevision) ||
    (action.expectedRevision as number) < 0 ||
    (action.expectedRevision as number) >= currentRevision ||
    phaseFrom(room) !== "battlefield-reveal"
  ) {
    return false;
  }

  const privateState = asRecord(room.gamePrivateState);
  const playerIds = Array.isArray(privateState?.playerIds) ? privateState.playerIds : [];
  const acknowledgedPlayerIds = Array.isArray(privateState?.battlefieldAcknowledgedPlayerIds)
    ? privateState.battlefieldAcknowledgedPlayerIds
    : [];
  return playerIds.includes(playerId) && !acknowledgedPlayerIds.includes(playerId);
}

function roomGameIsFinished(room: RoomRecord) {
  if (winnerIdsFrom(room).length > 0) {
    return true;
  }

  return ["complete", "finished"].includes(phaseFrom(room));
}

function clearScheduledTurnTimeout(room: RoomRecord) {
  const timer = turnTimeouts.get(room.code);
  if (timer) {
    clearTimeout(timer);
    turnTimeouts.delete(room.code);
  }
}

function turnTimerMs(room: RoomRecord) {
  const moduleDuration = getGameRegistration(room.selectedGameId)?.module.getTimerDurationMs?.(room.gamePrivateState);
  if (typeof moduleDuration === "number" && Number.isFinite(moduleDuration)) {
    return Math.min(MAX_TURN_TIMER_MS, Math.max(1, moduleDuration));
  }
  return Math.min(MAX_TURN_TIMER_MS, Math.max(MIN_TURN_TIMER_MS, room.gameState.turnTimerMs ?? DEFAULT_TURN_TIMER_MS));
}

function timerCanRun(room: RoomRecord) {
  const registration = getGameRegistration(room.selectedGameId);
  if (registration?.module.timerMode === "phase") {
    return registration.module.getTimerDurationMs?.(room.gamePrivateState) !== null;
  }
  return Boolean(room.gameState.activePlayerId);
}

function scheduleTurnTimeout(room: RoomRecord) {
  clearScheduledTurnTimeout(room);
  if (
    room.status !== "playing" ||
    !gameUsesTurnTimer(room.selectedGameId) ||
    room.gameState.paused ||
    !timerCanRun(room) ||
    !room.gameState.turnDeadlineAt ||
    roomGameIsFinished(room)
  ) {
    return;
  }

  const delay = Math.max(0, room.gameState.turnDeadlineAt - Date.now());
  const timer = setTimeout(() => {
    const currentRoom = rooms.get(room.code);
    if (!currentRoom || currentRoom.gameState.paused || roomGameIsFinished(currentRoom)) {
      return;
    }
    if ((currentRoom.gameState.turnDeadlineAt ?? Number.POSITIVE_INFINITY) > Date.now()) {
      scheduleTurnTimeout(currentRoom);
      return;
    }
    handleTurnTimeout(currentRoom, "자동 타임아웃");
    broadcastRoom(currentRoom);
  }, delay);
  turnTimeouts.set(room.code, timer);
}

function resetTurnClock(room: RoomRecord) {
  clearScheduledTurnTimeout(room);
  if (room.status !== "playing" || !gameUsesTurnTimer(room.selectedGameId) || !timerCanRun(room) || roomGameIsFinished(room)) {
    room.gameState.turnStartedAt = null;
    room.gameState.turnDeadlineAt = null;
    room.gameState.paused = false;
    room.gameState.pausedAt = null;
    room.gameState.pausedBy = null;
    return;
  }

  const now = Date.now();
  room.gameState.turnStartedAt = now;
  room.gameState.turnDeadlineAt = now + turnTimerMs(room);
  room.gameState.paused = false;
  room.gameState.pausedAt = null;
  room.gameState.pausedBy = null;
  scheduleTurnTimeout(room);
}

function syncPrivateActivePlayer(room: RoomRecord) {
  const privateState = asRecord(room.gamePrivateState);
  if (!privateState) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(privateState, "activePlayerId")) {
    privateState.activePlayerId = room.gameState.activePlayerId;
  }

  if (room.selectedGameId === "yacht-dice") {
    privateState.dice = [0, 0, 0, 0, 0];
    privateState.held = [false, false, false, false, false];
    privateState.rollsThisTurn = 0;
    if (room.gameState.activePlayerId && privateState.phase !== "complete") {
      privateState.phase = "rolling";
      room.gameState.phase = "rolling";
    }
  }

  if (room.selectedGameId === "davinci-code-plus" && privateState.phase !== "complete") {
    privateState.currentStreak = 0;
    privateState.drawnTileId = null;
    privateState.phase = Array.isArray(privateState.deck) && privateState.deck.length > 0 ? "draw" : "guessing";
    room.gameState.phase = String(privateState.phase);
  }
}

function applyGameOutcome(room: RoomRecord, outcome: GameActionResult, context: GameContext, viewerId: string | null) {
  const registration = getGameRegistration(room.selectedGameId);
  if (!registration) {
    throw new Error("이 게임은 아직 세부 플레이 모듈이 연결되지 않았습니다.");
  }

  const previousActivePlayerId = room.gameState.activePlayerId;
  const previousPhase = phaseFrom(room);
  room.gamePrivateState = outcome.state;
  if (outcome.activePlayerId !== undefined) {
    room.gameState.activePlayerId = outcome.activePlayerId;
  }
  if (outcome.turnNumber !== undefined) {
    room.gameState.turnNumber = outcome.turnNumber;
  }
  if (outcome.roundNumber !== undefined) {
    room.gameState.roundNumber = outcome.roundNumber;
  }
  if (outcome.phase !== undefined) {
    room.gameState.phase = outcome.phase;
  }
  if (outcome.message !== undefined) {
    room.gameState.message = outcome.message;
  }
  if (outcome.winnerId !== undefined) {
    room.gameState.winnerId = outcome.winnerId;
  }
  if (outcome.winnerIds !== undefined) {
    room.gameState.winnerIds = outcome.winnerIds;
  }
  if (outcome.interactivePlayerIds !== undefined) {
    room.gameState.interactivePlayerIds = [...outcome.interactivePlayerIds];
  }
  room.gameState.revision = (room.gameState.revision ?? 0) + 1;

  room.gameState.publicState = registration.module.getPublicState(room.gamePrivateState, {
    ...context,
    activePlayerId: room.gameState.activePlayerId,
    turnNumber: room.gameState.turnNumber,
    roundNumber: room.gameState.roundNumber,
    viewerId
  });

  return {
    activeChanged: outcome.activePlayerId !== undefined && outcome.activePlayerId !== previousActivePlayerId,
    phaseChanged: outcome.phase !== undefined && outcome.phase !== previousPhase,
    resetTimer: outcome.resetTimer === true
  };
}

function forceAdvanceBlokusTurn(room: RoomRecord) {
  const privateState = asRecord(room.gamePrivateState);
  const players = Array.isArray(privateState?.players) ? privateState.players.map(asRecord).filter(Boolean) : [];
  if (!privateState || players.length === 0) {
    advanceTurn(room);
    syncPrivateActivePlayer(room);
    return;
  }

  const currentIndex = Math.max(
    0,
    players.findIndex((player) => player?.id === privateState.activeColorId)
  );
  const nextIndex = (currentIndex + 1) % players.length;
  const nextColor = players[nextIndex];
  privateState.activeColorId = typeof nextColor?.id === "string" ? nextColor.id : null;
  room.gameState.activePlayerId = typeof nextColor?.ownerId === "string" ? nextColor.ownerId : null;
  room.gameState.turnNumber += 1;
  if (nextIndex === 0) {
    room.gameState.roundNumber += 1;
  }
}

function forceAdvanceRoomTurn(room: RoomRecord, systemAction: GameSystemAction, viewerId: string | null = null) {
  const registration = getGameRegistration(room.selectedGameId);
  const activePlayerId = room.gameState.activePlayerId;
  const executionPlayerId = activePlayerId ?? snapshotPlayers(room)[0]?.id ?? null;
  const context = executionPlayerId ? buildGameContext(room, executionPlayerId) : null;

  if (registration?.module.applySystemAction && context) {
    const outcome = registration.module.applySystemAction(room.gamePrivateState, systemAction, context);
    const changes = applyGameOutcome(room, outcome, context, viewerId ?? activePlayerId);
    if (changes.activeChanged || changes.phaseChanged || changes.resetTimer || roomGameIsFinished(room)) {
      resetTurnClock(room);
    } else {
      scheduleTurnTimeout(room);
    }
    return outcome.log ?? null;
  }

  if (systemAction.type === "system/pass") {
    throw new Error("이 게임은 현재 단계에서 공통 턴 종료를 사용할 수 없습니다. 게임판의 행동 버튼을 사용해주세요.");
  }

  if (room.selectedGameId === "blokus") {
    forceAdvanceBlokusTurn(room);
  } else {
    advanceTurn(room);
    syncPrivateActivePlayer(room);
  }
  resetTurnClock(room);
  return null;
}

function handleTurnTimeout(room: RoomRecord, reason: string) {
  const registration = getGameRegistration(room.selectedGameId);
  const activePlayer = room.players.find((player) => player.id === room.gameState.activePlayerId);
  const isPhaseTimer = registration?.module.timerMode === "phase";
  if ((!activePlayer && !isPhaseTimer) || room.status !== "playing" || room.gameState.paused || roomGameIsFinished(room)) {
    return;
  }

  if (activePlayer) {
    const timeoutCounts = { ...(room.gameState.timeoutCounts ?? {}) };
    timeoutCounts[activePlayer.id] = (timeoutCounts[activePlayer.id] ?? 0) + 1;
    room.gameState.timeoutCounts = timeoutCounts;
  }
  room.gameState.lastTimeoutAt = Date.now();
  appendSystemLog(room, activePlayer ? `${activePlayer.name} 시간 초과 (${reason})` : `단계 시간 종료 (${reason})`);
  try {
    const actionReason = reason === "자동 타임아웃" ? "auto-timeout" : "host-timeout";
    const systemLog = forceAdvanceRoomTurn(room, { type: "system/timeout", reason: actionReason }, activePlayer?.id ?? null);
    if (systemLog) {
      appendSystemLog(room, systemLog);
    }
    void recordRoomStatsIfFinished(room);
  } catch (error) {
    const message = error instanceof Error ? error.message : "타임아웃 처리 중 오류가 발생했습니다.";
    appendSystemLog(room, `타임아웃 처리 실패: ${message}`);
    resetTurnClock(room);
  }
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

  if (["parity-tile-duel", "mosaic-rush"].includes(gameId)) {
    return numberFromPlayerRecord(record.scores, playerId);
  }

  if (gameId === "blind-card-duel") {
    return numberFromPlayerRecord(record.stacks, playerId);
  }

  if (gameId === "hangman-board-game") {
    return numberFromPlayerRecord(record.wins, playerId);
  }

  if (gameId === "abalone-classic") {
    return numberFromPlayerRecord(record.pushedOff, playerId);
  }

  if (gameId === "blokus" && Array.isArray(record.players)) {
    let score = 0;
    let matched = false;
    for (const player of record.players) {
      const color = asRecord(player);
      if (!color) continue;
      if (color.scoreOwnerId === playerId) {
        score += blokusColorScore(color);
        matched = true;
      }
    }
    return matched ? score : null;
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
  const players = [...room.players].sort((a, b) => a.seat - b.seat).map((player) => ({
    playerId: player.id,
    playerKey: statsKeyForPlayer(player),
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
    durationMs: room.gameState.startedAt ? Math.max(0, finishedAt - room.gameState.startedAt - (room.gameState.totalPausedMs ?? 0)) : null,
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
  socket.emit("rooms:list", publicRoomList());

  socket.on("room:create", (payload: { name?: string; clientKey?: string; avatar?: PlayerAvatar }, ack?: (response: Ack<{ room: RoomSnapshot; playerId: string }>) => void) => {
    const name = normalizeName(payload?.name);
    const clientKey = normalizeClientKey(payload?.clientKey);
    const avatar = payloadHasAvatar(payload) ? normalizeAvatar(payload?.avatar) : { ...defaultAvatar };
    if (!name) {
      reply(ack, { ok: false, error: "이름을 입력해야 방을 만들 수 있습니다." });
      return;
    }

    const code = createRoomCode();
    const player: MutablePlayer = {
      id: clientKey ? stablePlayerId(clientKey) : randomUUID(),
      name,
      seat: 1,
      connected: true,
      isHost: true,
      joinedAt: Date.now(),
      avatar,
      clientKey: clientKey || undefined
    };

    const room: RoomRecord = {
      code,
      maxPlayers: ROOM_MAX_PLAYERS,
      players: [player],
      ownerPlayerId: player.id,
      ownerClientKey: player.clientKey,
      selectedGameId: null,
      status: "lobby",
      gameState: createEmptyRuntime(),
      gamePrivateState: null,
      postGameNotices: {},
      statsRecorded: false,
      createdAt: Date.now(),
      processedActionIds: new Set<string>(),
      matchRngSeed: null,
      activeSocketIdByPlayerId: new Map<string, string>()
    };

    rooms.set(code, room);
    attachSocketToPlayer(socket, room, player, undefined, avatar);
    reply(ack, { ok: true, data: { room: snapshotRoom(room, player.id), playerId: player.id } });
    broadcastRoom(room);
    broadcastRoomList();
  });

  socket.on("room:join", (payload: { code?: string; name?: string; playerId?: string; clientKey?: string; avatar?: PlayerAvatar }, ack?: (response: Ack<{ room: RoomSnapshot; playerId: string }>) => void) => {
    const code = String(payload?.code ?? "").trim().toUpperCase();
    const name = normalizeName(payload?.name);
    const clientKey = normalizeClientKey(payload?.clientKey);
    const avatar = payloadHasAvatar(payload) ? normalizeAvatar(payload?.avatar) : null;
    const room = rooms.get(code);

    if (!room) {
      reply(ack, { ok: false, error: "방 코드를 확인해주세요." });
      return;
    }

    if (!name) {
      reply(ack, { ok: false, error: "이름을 입력해야 입장할 수 있습니다." });
      return;
    }

    const returningPlayer = findReturningPlayer(room, payload?.playerId, clientKey);
    if (returningPlayer) {
      if (clientKey && !returningPlayer.clientKey) {
        returningPlayer.clientKey = clientKey;
      }
      attachSocketToPlayer(socket, room, returningPlayer, name, avatar);
      reply(ack, { ok: true, data: { room: snapshotRoom(room, returningPlayer.id), playerId: returningPlayer.id } });
      broadcastRoom(room);
      broadcastRoomList();
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
      id: clientKey ? stablePlayerId(clientKey) : randomUUID(),
      name,
      seat: getNextSeat(room.players),
      connected: true,
      isHost: false,
      joinedAt: Date.now(),
      avatar: avatar ?? { ...defaultAvatar },
      clientKey: clientKey || undefined
    };

    room.players.push(player);
    attachSocketToPlayer(socket, room, player, undefined, avatar);
    reply(ack, { ok: true, data: { room: snapshotRoom(room, player.id), playerId: player.id } });
    broadcastRoom(room);
    broadcastRoomList();
  });

  socket.on("room:resume", (payload: { code?: string; name?: string; playerId?: string; clientKey?: string; avatar?: PlayerAvatar }, ack?: (response: Ack<{ room: RoomSnapshot; playerId: string }>) => void) => {
    const code = String(payload?.code ?? "").trim().toUpperCase();
    const name = normalizeName(payload?.name);
    const clientKey = normalizeClientKey(payload?.clientKey);
    const avatar = payloadHasAvatar(payload) ? normalizeAvatar(payload?.avatar) : null;
    const room = rooms.get(code);
    if (!room) {
      reply(ack, { ok: false, error: "저장된 방을 찾을 수 없습니다." });
      return;
    }

    const player = findReturningPlayer(room, payload?.playerId, clientKey);
    if (!player) {
      reply(ack, { ok: false, error: "이 브라우저에 저장된 플레이어가 이 방에 없습니다." });
      return;
    }

    if (clientKey && !player.clientKey) {
      player.clientKey = clientKey;
    }
    attachSocketToPlayer(socket, room, player, name, avatar);
    reply(ack, { ok: true, data: { room: snapshotRoom(room, player.id), playerId: player.id } });
    broadcastRoom(room);
    broadcastRoomList();
  });

  socket.on("room:leave", (payload: { code?: string }, ack?: (response: Ack<{ code: string; empty: boolean }>) => void) => {
    const code = String(payload?.code ?? socket.data.roomCode ?? "").trim().toUpperCase();
    const playerId = socket.data.playerId as string | undefined;
    const room = rooms.get(code);

    if (!room || !playerId) {
      reply(ack, { ok: true, data: { code, empty: true } });
      return;
    }

    const player = room.players.find((roomPlayer) => roomPlayer.id === playerId);
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
    }

    if (room.activeSocketIdByPlayerId.get(playerId) === socket.id) {
      room.activeSocketIdByPlayerId.delete(playerId);
    }

    socket.leave(code);
    delete socket.data.roomCode;
    delete socket.data.playerId;

    assignHost(room);
    clearInvalidSelection(room);
    if (!recoverInterruptedBattlefieldSetup(room, player?.name)) {
      finishRoomIfPlayersCannotContinue(room, player?.name);
    }
    const empty = connectedPlayers(room).length === 0;
    scheduleEmptyRoomCleanup(room);
    if (!empty) {
      void broadcastRoom(room);
    }
    reply(ack, { ok: true, data: { code, empty } });
    broadcastRoomList();
  });

  socket.on("room:delete", (payload: { code?: string }, ack?: (response: Ack<{ code: string }>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (!canDeleteRoom(result.room, result.player)) {
      reply(ack, { ok: false, error: "방을 만든 사람만 방을 삭제할 수 있습니다." });
      return;
    }

    const code = result.room.code;
    appendSystemLog(result.room, `${result.player.name}님이 방을 삭제했습니다.`);
    deleteRoom(result.room, "방을 만든 사람이 방을 삭제했습니다.");
    delete socket.data.roomCode;
    delete socket.data.playerId;
    reply(ack, { ok: true, data: { code } });
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
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
    broadcastRoom(result.room);
    broadcastRoomList();
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

    startGameInRoom(result.room, game);
    appendLog(result.room, result.player, `${game.title} 게임 시작`);
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
    broadcastRoom(result.room);
    broadcastRoomList();
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

    if (result.room.gameState.paused) {
      reply(ack, { ok: false, error: "게임이 일시정지 중입니다. 재개 후 행동할 수 있습니다." });
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

    const actionId = typeof action.actionId === "string" ? action.actionId.trim() : "";
    if (actionId.length > 128) {
      reply(ack, { ok: false, error: "행동 식별자가 너무 깁니다." });
      return;
    }
    const dedupeKey = actionId && result.player ? `${result.player.id}:${actionId}` : "";
    if (dedupeKey && result.room.processedActionIds.has(dedupeKey)) {
      reply(ack, { ok: true, data: snapshotRoom(result.room, result.player?.id ?? null) });
      return;
    }

    const currentRevision = result.room.gameState.revision ?? 0;
    if (registration.module.concurrencyMode === "strict") {
      const revisionMatches = Number.isSafeInteger(action.expectedRevision) && action.expectedRevision === currentRevision;
      const canMergeBattlefieldAcknowledgement = Boolean(
        result.player && canApplyStaleBattlefieldAcknowledgement(result.room, result.player.id, action, currentRevision)
      );
      if (!revisionMatches && !canMergeBattlefieldAcknowledgement) {
        reply(ack, {
          ok: false,
          error: "게임 상태가 이미 변경되었습니다. 최신 상태에서 다시 시도해주세요.",
          data: snapshotRoom(result.room, result.player.id)
        });
        return;
      }
    }

    try {
      const outcome = registration.module.applyAction(result.room.gamePrivateState, action, context);
      const changes = applyGameOutcome(result.room, outcome, context, result.player.id);
      if (dedupeKey) {
        result.room.processedActionIds.add(dedupeKey);
        while (result.room.processedActionIds.size > MAX_PROCESSED_ACTION_IDS) {
          const oldest = result.room.processedActionIds.values().next().value as string | undefined;
          if (!oldest) break;
          result.room.processedActionIds.delete(oldest);
        }
      }
      if (outcome.log) {
        appendLog(result.room, result.player, outcome.log);
      }
      if (changes.activeChanged || changes.phaseChanged || changes.resetTimer || roomGameIsFinished(result.room)) {
        resetTurnClock(result.room);
      } else {
        scheduleTurnTimeout(result.room);
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
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
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

    if (result.room.gameState.paused) {
      reply(ack, { ok: false, error: "게임이 일시정지 중입니다." });
      return;
    }
    if (roomGameIsFinished(result.room) || !result.room.gameState.activePlayerId) {
      reply(ack, { ok: false, error: "넘길 수 있는 진행 중 턴이 없습니다." });
      return;
    }

    const activePlayer = result.room.players.find((player) => player.id === result.room.gameState.activePlayerId);
    const timerExpired =
      Boolean(result.room.gameState.turnDeadlineAt) && (result.room.gameState.turnDeadlineAt ?? Number.POSITIVE_INFINITY) <= Date.now();
    if (activePlayer && activePlayer.id !== result.player?.id) {
      if (!result.player?.isHost || !timerExpired) {
        reply(ack, { ok: false, error: "본인 턴은 직접 종료할 수 있고, 방장 강제 넘김은 시간 초과 후에만 가능합니다." });
        return;
      }
    }
    if (!activePlayer) {
      reply(ack, { ok: false, error: "현재 차례 플레이어를 찾을 수 없습니다." });
      return;
    }

    try {
      const isOwnTurn = activePlayer.id === result.player?.id;
      const systemAction: GameSystemAction = isOwnTurn
        ? { type: "system/pass", reason: "manual-pass" }
        : { type: "system/timeout", reason: "host-timeout" };
      const systemLog = forceAdvanceRoomTurn(result.room, systemAction, result.player.id);
      appendLog(
        result.room,
        result.player,
        systemLog ?? (isOwnTurn ? "턴 종료" : `${activePlayer.name ?? "현재 플레이어"} 턴 강제 종료`)
      );
      reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
      broadcastRoom(result.room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "턴 종료 처리 중 오류가 발생했습니다.";
      reply(ack, { ok: false, error: message });
    }
  });

  socket.on("room:pause-game", (payload: { code?: string }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (!assertHost(result.player)) {
      reply(ack, { ok: false, error: "방장만 게임을 일시정지할 수 있습니다." });
      return;
    }
    if (result.room.status !== "playing" || roomGameIsFinished(result.room)) {
      reply(ack, { ok: false, error: "진행 중인 게임만 일시정지할 수 있습니다." });
      return;
    }
    if (result.room.gameState.paused) {
      reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
      return;
    }

    clearScheduledTurnTimeout(result.room);
    result.room.gameState.paused = true;
    result.room.gameState.pausedAt = Date.now();
    result.room.gameState.pausedBy = result.player.name;
    appendLog(result.room, result.player, "게임 일시정지");
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
    broadcastRoom(result.room);
  });

  socket.on("room:resume-game", (payload: { code?: string }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (!assertHost(result.player)) {
      reply(ack, { ok: false, error: "방장만 게임을 재개할 수 있습니다." });
      return;
    }
    if (!result.room.gameState.paused) {
      reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
      return;
    }

    const pausedFor = Date.now() - (result.room.gameState.pausedAt ?? Date.now());
    result.room.gameState.totalPausedMs = (result.room.gameState.totalPausedMs ?? 0) + pausedFor;
    if (result.room.gameState.turnDeadlineAt) {
      result.room.gameState.turnDeadlineAt += pausedFor;
    }
    const privateState = asRecord(result.room.gamePrivateState);
    if (getGameRegistration(result.room.selectedGameId)?.module.timerMode === "phase" && typeof privateState?.deadlineAt === "number") {
      privateState.deadlineAt += pausedFor;
    }
    result.room.gameState.paused = false;
    result.room.gameState.pausedAt = null;
    result.room.gameState.pausedBy = null;
    appendLog(result.room, result.player, "게임 재개");
    scheduleTurnTimeout(result.room);
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
    broadcastRoom(result.room);
  });

  socket.on("room:configure-timer", (payload: { code?: string; turnTimerMs?: number }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }

    if (!assertHost(result.player)) {
      reply(ack, { ok: false, error: "방장만 제한 시간을 바꿀 수 있습니다." });
      return;
    }
    if (!gameUsesTurnTimer(result.room.selectedGameId)) {
      reply(ack, { ok: false, error: "선택한 게임은 턴 타이머를 사용하지 않습니다." });
      return;
    }
    if (getGameById(result.room.selectedGameId)?.timer) {
      reply(ack, { ok: false, error: "이 게임의 제한 시간은 규칙에 따라 고정됩니다." });
      return;
    }
    const nextTimerMs = Math.min(MAX_TURN_TIMER_MS, Math.max(MIN_TURN_TIMER_MS, Number(payload?.turnTimerMs) || DEFAULT_TURN_TIMER_MS));
    result.room.gameState.turnTimerMs = nextTimerMs;
    if (result.room.status === "playing" && !roomGameIsFinished(result.room)) {
      if (result.room.gameState.paused) {
        const anchor = result.room.gameState.pausedAt ?? Date.now();
        result.room.gameState.turnStartedAt = anchor;
        result.room.gameState.turnDeadlineAt = anchor + nextTimerMs;
      } else {
        resetTurnClock(result.room);
      }
    }
    appendLog(result.room, result.player, `턴 제한 시간 ${Math.round(nextTimerMs / 1000)}초 설정`);
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
    broadcastRoom(result.room);
  });

  socket.on("room:claim-timeout", (payload: { code?: string }, ack?: (response: Ack<RoomSnapshot>) => void) => {
    const result = requireRoom(socket, payload?.code);
    if (!result.room) {
      reply(ack, { ok: false, error: result.error });
      return;
    }
    if (result.room.status !== "playing") {
      reply(ack, { ok: false, error: "진행 중인 게임이 없습니다." });
      return;
    }
    if (result.room.gameState.paused) {
      reply(ack, { ok: false, error: "일시정지 중에는 타임아웃을 처리하지 않습니다." });
      return;
    }
    if (!result.room.gameState.turnDeadlineAt || result.room.gameState.turnDeadlineAt > Date.now()) {
      reply(ack, { ok: false, error: "아직 제한 시간이 남아 있습니다." });
      return;
    }
    if (result.room.gameState.activePlayerId === result.player.id) {
      reply(ack, { ok: false, error: "현재 차례 본인은 타임아웃을 처리할 수 없습니다. 턴 종료를 사용하세요." });
      return;
    }

    handleTurnTimeout(result.room, `${result.player.name} 확인`);
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
    broadcastRoom(result.room);
  });

  socket.on(
    "room:post-game-action",
    (
      payload: { code?: string; choice?: unknown },
      ack?: (response: Ack<{ code: string; room?: RoomSnapshot; left?: boolean; deleted?: boolean }>) => void
    ) => {
      const result = requireRoom(socket, payload?.code);
      if (!result.room) {
        reply(ack, { ok: false, error: result.error });
        return;
      }

      if (!roomGameIsFinished(result.room)) {
        reply(ack, { ok: false, error: "승부가 난 뒤에 선택할 수 있습니다." });
        return;
      }

      const choice = normalizePostGameChoice(payload?.choice);
      if (!choice) {
        reply(ack, { ok: false, error: "종료 후 선택 값이 올바르지 않습니다." });
        return;
      }

      const choices = postGameChoices(result.room);
      choices[result.player.id] = choice;

      if (choice === "rematch") {
        const connected = connectedPlayers(result.room);
        const allConnectedWantRematch =
          connected.length > 0 && connected.every((player) => choices[player.id] === "rematch");
        if (allConnectedWantRematch) {
          const game = getGameById(result.room.selectedGameId);
          if (!game || !canPlayGame(game, connected.length)) {
            for (const playerId of pendingRematchPlayerIds(result.room)) {
              result.room.postGameNotices[playerId] = "현재 인원으로 재대결을 시작할 수 없습니다.";
            }
            resetRoomToLobby(result.room, { preservePostGameNotices: true });
            reply(ack, { ok: true, data: { code: result.room.code, room: snapshotRoom(result.room, result.player.id) } });
            broadcastRoom(result.room);
            broadcastRoomList();
            return;
          }

          void recordRoomStatsIfFinished(result.room);
          startGameInRoom(result.room, game);
          appendSystemLog(result.room, "모두 재대결에 동의해 새 판을 시작했습니다.");
          reply(ack, { ok: true, data: { code: result.room.code, room: snapshotRoom(result.room, result.player.id) } });
          broadcastRoom(result.room);
          broadcastRoomList();
          return;
        }

        appendLog(result.room, result.player, "재대결 요청");
        reply(ack, { ok: true, data: { code: result.room.code, room: snapshotRoom(result.room, result.player.id) } });
        broadcastRoom(result.room);
        return;
      }

      if (choice === "game-select") {
        rejectPendingRematches(result.room);
        resetRoomToLobby(result.room, { preservePostGameNotices: true, clearSelectedGame: true });
        appendSystemLog(result.room, `${result.player.name}님이 같은 인원으로 게임 선택으로 돌아갔습니다.`);
        reply(ack, { ok: true, data: { code: result.room.code, room: snapshotRoom(result.room, result.player.id) } });
        broadcastRoom(result.room);
        broadcastRoomList();
        return;
      }

      const connectedBeforeLeave = connectedPlayers(result.room);
      const allConnectedLeaving =
        connectedBeforeLeave.length > 0 && connectedBeforeLeave.every((player) => choices[player.id] === "leave-room");
      if (allConnectedLeaving) {
        const code = result.room.code;
        appendSystemLog(result.room, "모든 플레이어가 로비 이동을 선택해 방을 닫았습니다.");
        deleteRoom(result.room, "모든 플레이어가 로비로 이동해 방이 닫혔습니다.");
        delete socket.data.roomCode;
        delete socket.data.playerId;
        reply(ack, { ok: true, data: { code, left: true, deleted: true } });
        return;
      }

      const hasPendingRematch = pendingRematchPlayerIds(result.room).length > 0;
      if (hasPendingRematch) {
        rejectPendingRematches(result.room);
        resetRoomToLobby(result.room, { preservePostGameNotices: true });
        appendSystemLog(result.room, `${result.player.name}님이 로비로 이동해 재대결이 취소되었습니다.`);
      }

      result.player.connected = false;
      result.player.disconnectedAt = Date.now();
      if (result.room.activeSocketIdByPlayerId.get(result.player.id) === socket.id) {
        result.room.activeSocketIdByPlayerId.delete(result.player.id);
      }
      socket.leave(result.room.code);
      delete socket.data.roomCode;
      delete socket.data.playerId;
      assignHost(result.room);
      clearInvalidSelection(result.room);

      const code = result.room.code;
      if (connectedPlayers(result.room).length === 0) {
        deleteRoom(result.room, "모든 플레이어가 로비로 이동해 방이 닫혔습니다.");
        reply(ack, { ok: true, data: { code, left: true, deleted: true } });
        return;
      }

      scheduleEmptyRoomCleanup(result.room);
      void broadcastRoom(result.room);
      broadcastRoomList();
      reply(ack, { ok: true, data: { code, left: true, deleted: false } });
    }
  );

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

    resetRoomToLobby(result.room);
    reply(ack, { ok: true, data: snapshotRoom(result.room, result.player.id) });
    broadcastRoom(result.room);
    broadcastRoomList();
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

    if (room.activeSocketIdByPlayerId.get(playerId) !== socket.id) {
      return;
    }
    room.activeSocketIdByPlayerId.delete(playerId);

    const player = room.players.find((roomPlayer) => roomPlayer.id === playerId);
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
    }

    assignHost(room);
    clearInvalidSelection(room);
    const recoveredBattlefieldSetup = recoverInterruptedBattlefieldSetup(room, player?.name);
    scheduleEmptyRoomCleanup(room);
    if (!recoveredBattlefieldSetup && room.status === "playing" && room.gameState.activePlayerId === playerId && !roomGameIsFinished(room)) {
      appendSystemLog(room, `${player?.name ?? "플레이어"} 연결 끊김. 제한 시간 안에 다시 들어오면 이어서 진행합니다.`);
      scheduleTurnTimeout(room);
    }
    broadcastRoom(room);
    broadcastRoomList();

    const pruneTimer = setTimeout(() => {
      const staleRoom = rooms.get(code);
      if (!staleRoom) {
        return;
      }

      pruneDisconnected(staleRoom);
      if (staleRoom.players.length === 0 || connectedPlayers(staleRoom).length === 0) {
        deleteRoom(staleRoom);
        return;
      }

      broadcastRoom(staleRoom);
      broadcastRoomList();
    }, DISCONNECT_GRACE_MS);
    pruneTimer.unref?.();
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

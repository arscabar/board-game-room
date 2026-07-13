import { io } from "socket.io-client";
import type { Ack, RoomSnapshot } from "../src/shared/types";
import { canDefend, type ParityTileDuelPublicState } from "../src/game-modules/parity-tile-duel";

const code = String(process.argv[2] ?? "").trim().toUpperCase();
const name = String(process.argv[3] ?? "화면 QA 봇");
if (!code) throw new Error("Usage: tsx scripts/qa-ui-seat-bot.ts ROOM_CODE [NAME]");

const socket = io(process.env.QA_SERVER_URL ?? "http://127.0.0.1:3001", {
  forceNew: true,
  reconnection: true,
  transports: ["websocket"]
});

let playerId = "";
let room: RoomSnapshot | null = null;
let actingRevision: number | null = null;

function sendAction(action: { type: string; payload?: unknown }) {
  if (!room || actingRevision === room.gameState.revision) return;
  actingRevision = room.gameState.revision;
  const publicState = room.gameState.publicState as Record<string, unknown> | null;
  socket.emit("game:action", {
    code,
    action: {
      ...action,
      actionId: `ui-bot-${playerId}-${room.gameState.revision}-${action.type}`,
      expectedRevision: room.gameState.revision,
      scopeId: typeof publicState?.scopeId === "string" ? publicState.scopeId : undefined
    }
  }, (response: Ack<RoomSnapshot>) => {
    if (!response?.ok) console.error(response?.error ?? "game action failed");
    if (response?.data) room = response.data;
    setTimeout(() => { actingRevision = null; maybeAct(); }, 120);
  });
}

function maybeAct() {
  if (!room || room.status !== "playing" || actingRevision !== null) return;
  const state = room.gameState.publicState as Record<string, any> | null;
  if (!state) return;

  if (room.selectedGameId === "blind-card-duel" && room.gameState.activePlayerId === playerId) {
    sendAction({ type: "fold" });
    return;
  }

  if (room.selectedGameId !== "parity-tile-duel" || room.gameState.activePlayerId !== playerId) return;
  const parity = state as unknown as ParityTileDuelPublicState;
  if (parity.phase === "await-defense") {
    const defense = parity.currentAttack ? parity.hand.find((tile) => canDefend(parity.currentAttack!.tile, tile)) : null;
    sendAction(defense ? { type: "tile/defend", payload: { tileId: defense.id } } : { type: "tile/pass" });
    return;
  }
  if (parity.phase === "continuation") {
    const [attack, bonus] = parity.hand;
    if (attack) sendAction({ type: "tile/continue", payload: { attackTileId: attack.id, bonusTileId: bonus?.id ?? null } });
    return;
  }
  if (parity.phase === "choose-attack") {
    const attack = parity.hand[0];
    if (attack) sendAction({ type: "tile/attack", payload: { tileId: attack.id } });
  }
}

socket.on("connect", () => {
  socket.emit("room:join", { code, name, clientKey: `qa-ui-${code}-${name}` }, (response: Ack<{ room: RoomSnapshot; playerId: string }>) => {
    if (!response?.ok) {
      console.error(response?.error ?? "join failed");
      process.exitCode = 1;
      socket.disconnect();
      return;
    }
    playerId = response.data!.playerId;
    room = response.data!.room;
    console.log(`joined ${code} as ${name}`);
    maybeAct();
  });
});

socket.on("room:state", (nextRoom: RoomSnapshot) => {
  room = nextRoom;
  maybeAct();
});

socket.on("connect_error", (error) => {
  console.error(error.message);
});

setInterval(() => undefined, 60_000);

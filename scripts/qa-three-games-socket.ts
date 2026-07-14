import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import type { Ack, RoomSnapshot } from "../src/shared/types";
import { solutionForMosaicChallenge } from "../src/game-modules/mosaic-rush";

interface Client {
  socket: Socket;
  id: string;
  clientKey: string;
  room: RoomSnapshot | null;
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error(`Timed out: ${label}`);
}

async function emit<T>(client: Client, event: string, payload: unknown) {
  return new Promise<T>((resolve, reject) => {
    client.socket.timeout(6_000).emit(event, payload, (error: Error | null, response: Ack<T>) => {
      if (error) return reject(error);
      if (!response?.ok) return reject(new Error(response?.error ?? `${event} failed`));
      if (response.data && typeof response.data === "object" && "status" in response.data) client.room = response.data as RoomSnapshot;
      resolve(response.data as T);
    });
  });
}

async function emitResponse<T>(client: Client, event: string, payload: unknown) {
  return new Promise<Ack<T>>((resolve, reject) => {
    client.socket.timeout(6_000).emit(event, payload, (error: Error | null, response: Ack<T>) => {
      if (error) return reject(error);
      resolve(response);
    });
  });
}

async function connect(baseUrl: string, name: string, clientKey = `qa-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`): Promise<Client> {
  const socket = io(baseUrl, { forceNew: true, reconnection: false, transports: ["websocket"] });
  const client: Client = { socket, id: "", clientKey, room: null };
  socket.on("room:state", (room: RoomSnapshot) => { client.room = room; });
  await waitFor(() => socket.connected, `${name} connected`);
  return client;
}

async function startedRoom(baseUrl: string, gameId: string, count: number) {
  const clients: Client[] = [];
  const host = await connect(baseUrl, `${gameId}-1`);
  const created = await emit<{ room: RoomSnapshot; playerId: string }>(host, "room:create", { name: `${gameId}-1`, clientKey: host.clientKey });
  host.id = created.playerId;
  host.room = created.room;
  clients.push(host);
  for (let index = 2; index <= count; index += 1) {
    const client = await connect(baseUrl, `${gameId}-${index}`);
    const joined = await emit<{ room: RoomSnapshot; playerId: string }>(client, "room:join", { code: created.room.code, name: `${gameId}-${index}`, clientKey: client.clientKey });
    client.id = joined.playerId;
    client.room = joined.room;
    clients.push(client);
  }
  await waitFor(() => clients.every((client) => client.room?.players.length === count), `${gameId} joined`);
  await emit<RoomSnapshot>(host, "room:select-game", { code: created.room.code, gameId });
  await emit<RoomSnapshot>(host, "room:start-game", { code: created.room.code });
  await waitFor(() => clients.every((client) => client.room?.status === "playing"), `${gameId} started`);
  return { code: created.room.code, clients };
}

function active(table: { clients: Client[] }) {
  const id = table.clients[0].room?.gameState.activePlayerId;
  assert(id);
  const client = table.clients.find((candidate) => candidate.id === id);
  assert(client);
  return client;
}

function close(table: { clients: Client[] }) {
  table.clients.forEach((client) => client.socket.disconnect());
}

function actionFor(client: Client, action: Record<string, unknown>) {
  assert(client.room);
  const publicState = client.room.gameState.publicState as Record<string, unknown> | null;
  return {
    ...action,
    expectedRevision: client.room.gameState.revision,
    scopeId: typeof publicState?.scopeId === "string" ? publicState.scopeId : undefined
  };
}

async function main() {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsx, "server/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), STATS_FILE: path.join(process.cwd(), ".omx", "state", "qa-socket-stats.json") },
    stdio: "ignore",
    windowsHide: true
  });
  try {
    await waitFor(async () => {
      try { return (await fetch(`${baseUrl}/api/health`)).ok; } catch { return false; }
    }, "server health", 20_000);

    const blind = await startedRoom(baseUrl, "blind-card-duel", 2);
    const blindActor = active(blind);
    const beforeOther = blind.clients.find((client) => client !== blindActor)!;
    const actorView = blindActor.room!.gameState.publicState as any;
    const otherView = beforeOther.room!.gameState.publicState as any;
    assert.equal("rngSeed" in blindActor.room!.gameState, false, "match seed must never enter a room snapshot");
    assert.equal(actorView.players.find((player: any) => player.id === blindActor.id).visibleCardRank, null);
    assert.notEqual(otherView.players.find((player: any) => player.id === blindActor.id).visibleCardRank, null);
    const firstAction = actionFor(blindActor, { type: "blind/open", payload: { to: 2 }, actionId: "dedupe-open" });
    const staleRevision = firstAction.expectedRevision;
    const first = await emit<RoomSnapshot>(blindActor, "game:action", { code: blind.code, action: firstAction });
    const firstTurn = first.gameState.turnNumber;
    const firstLogs = first.gameState.moveLog.length;
    const duplicate = await emit<RoomSnapshot>(blindActor, "game:action", { code: blind.code, action: firstAction });
    assert.equal(duplicate.gameState.turnNumber, firstTurn);
    assert.equal(duplicate.gameState.moveLog.length, firstLogs);
    const stale = await emitResponse<RoomSnapshot>(blindActor, "game:action", {
      code: blind.code,
      action: { type: "blind/fold", actionId: "stale-fold", expectedRevision: staleRevision }
    });
    assert.equal(stale.ok, false, "an action based on an old revision must be rejected");
    const intruder = await connect(baseUrl, "intruder");
    const stolenResume = await emitResponse(intruder, "room:resume", {
      code: blind.code,
      name: "intruder",
      playerId: blindActor.id,
      clientKey: "different-client-key"
    });
    assert.equal(stolenResume.ok, false, "a public playerId plus a different clientKey must not reclaim a seat");
    intruder.socket.disconnect();
    const replacement = await connect(baseUrl, "replacement", blindActor.clientKey);
    const resumed = await emit<{ room: RoomSnapshot; playerId: string }>(replacement, "room:resume", {
      code: blind.code,
      name: blindActor.room!.players.find((player) => player.id === blindActor.id)?.name,
      playerId: blindActor.id,
      clientKey: blindActor.clientKey
    });
    replacement.id = resumed.playerId;
    replacement.room = resumed.room;
    await waitFor(() => !blindActor.socket.connected, "older socket for the same seat disconnected");
    assert.equal(resumed.playerId, blindActor.id, "the same browser identity must reclaim the same seat");
    replacement.socket.disconnect();
    close(blind);

    const interruptedParity = await startedRoom(baseUrl, "parity-tile-duel", 3);
    assert.equal((interruptedParity.clients[0].room!.gameState.publicState as any).phase, "battlefield-reveal");
    interruptedParity.clients[2].socket.disconnect();
    await waitFor(
      () => interruptedParity.clients.slice(0, 2).every((client) => client.room?.status === "lobby"),
      "parity battlefield disconnect returns the room to lobby"
    );
    for (const client of interruptedParity.clients.slice(0, 2)) {
      assert.equal(client.room!.gameState.publicState ?? null, null, "disconnect recovery must clear the interrupted match state");
      assert.equal(client.room!.gameState.turnDeadlineAt, null, "disconnect recovery must leave no match timer running");
    }
    close(interruptedParity);

    const interruptedApplyingParity = await startedRoom(baseUrl, "parity-tile-duel", 3);
    for (const client of interruptedApplyingParity.clients) {
      await emit<RoomSnapshot>(client, "game:action", {
        code: interruptedApplyingParity.code,
        action: actionFor(client, { type: "tile/acknowledge-battlefield", actionId: `applying-disconnect-${client.id}` })
      });
    }
    await waitFor(
      () => interruptedApplyingParity.clients.every((client) => (client.room?.gameState.publicState as any)?.phase === "battlefield-applying"),
      "parity battlefield applying before disconnect"
    );
    interruptedApplyingParity.clients[2].socket.disconnect();
    await waitFor(
      () => interruptedApplyingParity.clients.slice(0, 2).every((client) => client.room?.status === "lobby"),
      "parity battlefield applying disconnect returns the room to lobby"
    );
    for (const client of interruptedApplyingParity.clients.slice(0, 2)) {
      assert.equal(client.room!.gameState.publicState ?? null, null, "applying-phase disconnect recovery must clear match state");
      assert.equal(client.room!.gameState.turnDeadlineAt, null, "applying-phase disconnect recovery must clear the 800ms deadline");
    }
    close(interruptedApplyingParity);

    const parity = await startedRoom(baseUrl, "parity-tile-duel", 3);
    assert.equal((parity.clients[0].room!.gameState.publicState as any).phase, "battlefield-reveal");
    assert.equal(parity.clients[0].room!.gameState.turnDeadlineAt, null, "battlefield explanation must not start the turn timer");
    const firstAcknowledgement = await emit<RoomSnapshot>(parity.clients[0], "game:action", {
      code: parity.code,
      action: actionFor(parity.clients[0], { type: "tile/acknowledge-battlefield", actionId: `battlefield-${parity.clients[0].id}` })
    });
    await waitFor(
      () => parity.clients.every((client) => client.room?.gameState.revision === firstAcknowledgement.gameState.revision),
      "first parity battlefield acknowledgement broadcast"
    );
    assert.equal((parity.clients[1].room!.gameState.publicState as any).phase, "battlefield-reveal");
    assert.equal(parity.clients[1].room!.gameState.turnDeadlineAt, null, "partial battlefield acknowledgement must not start the timer");
    const sharedRevision = parity.clients[1].room!.gameState.revision;
    const simultaneousAcknowledgements = parity.clients.slice(1).map((client) => emit<RoomSnapshot>(client, "game:action", {
      code: parity.code,
      action: {
        type: "tile/acknowledge-battlefield",
        actionId: `battlefield-${client.id}`,
        expectedRevision: sharedRevision
      }
    }));
    await Promise.all(simultaneousAcknowledgements);
    await waitFor(
      () => parity.clients.every((client) => (client.room?.gameState.publicState as any)?.phase === "battlefield-applying"),
      "simultaneous parity battlefield acknowledgements enter applying phase"
    );
    const applyingRuntime = parity.clients[0].room!.gameState;
    const applyingState = applyingRuntime.publicState as any;
    assert.equal(applyingState.phase, "battlefield-applying");
    assert.equal(applyingState.battlefieldAcknowledgedPlayerIds.length, parity.clients.length);
    assert.equal(applyingRuntime.activePlayerId, null, "battlefield application must have no active player");
    assert.deepEqual(applyingRuntime.interactivePlayerIds, [], "battlefield application must reject all player interaction");
    assert(applyingRuntime.turnDeadlineAt, "battlefield application must have a server deadline");
    assert(applyingRuntime.turnStartedAt, "battlefield application must record its server start");
    assert.equal(applyingRuntime.turnDeadlineAt - applyingRuntime.turnStartedAt, 800, "battlefield application deadline must be exactly 800ms");
    const applyingRemainingMs = applyingRuntime.turnDeadlineAt - Date.now();
    assert(applyingRemainingMs > 0 && applyingRemainingMs <= 800, `battlefield application must still be pending, got ${applyingRemainingMs}ms remaining`);
    const applyingAttackTile = applyingState.hand[0];
    const attackDuringApplying = await emitResponse<RoomSnapshot>(parity.clients[0], "game:action", {
      code: parity.code,
      action: actionFor(parity.clients[0], {
        type: "tile/attack",
        payload: { tileId: applyingAttackTile.id },
        actionId: "attack-during-battlefield-application"
      })
    });
    assert.equal(attackDuringApplying.ok, false, "attacks must be rejected during battlefield application");
    await waitFor(
      () => parity.clients.every((client) => (client.room?.gameState.publicState as any)?.phase === "choose-attack"),
      "authoritative battlefield application timeout"
    );
    const attackRuntime = parity.clients[0].room!.gameState;
    assert.equal((attackRuntime.publicState as any).phase, "choose-attack");
    assert(attackRuntime.activePlayerId, "first attacker must become active after battlefield application");
    assert.deepEqual(attackRuntime.interactivePlayerIds, [attackRuntime.activePlayerId]);
    assert(attackRuntime.turnDeadlineAt, "the first attack must start a fresh deadline");
    assert(attackRuntime.turnStartedAt, "the first attack must record its server start");
    assert.equal(attackRuntime.turnDeadlineAt - attackRuntime.turnStartedAt, 40_000, "the first attack deadline must be exactly 40 seconds");
    const attackRemainingMs = attackRuntime.turnDeadlineAt - Date.now();
    assert(attackRemainingMs > 0 && attackRemainingMs <= 40_000, `first attack clock must be running, got ${attackRemainingMs}ms remaining`);
    assert((attackRuntime.turnStartedAt ?? 0) >= (applyingRuntime.turnDeadlineAt ?? 0), "attack clock must start only after battlefield application ends");
    const parityActor = active(parity);
    const parityState = parityActor.room!.gameState.publicState as any;
    const attackTile = parityState.hand[0];
    assert(attackTile?.id);
    const staleParityAttack = await emitResponse<RoomSnapshot>(parityActor, "game:action", {
      code: parity.code,
      action: {
        type: "tile/attack",
        payload: { tileId: attackTile.id },
        actionId: "stale-attack-after-battlefield",
        expectedRevision: sharedRevision
      }
    });
    assert.equal(staleParityAttack.ok, false, "ordinary parity actions must still reject an old revision after the battlefield reveal");
    await emit<RoomSnapshot>(parityActor, "game:action", { code: parity.code, action: actionFor(parityActor, { type: "tile/attack", payload: { tileId: attackTile.id }, actionId: "attack-1" }) });
    await waitFor(() => parity.clients.every((client) => (client.room?.gameState.publicState as any)?.phase === "await-defense"), "parity attack broadcast");
    const responder = active(parity);
    const responderView = responder.room!.gameState.publicState as any;
    assert.equal(responderView.hand.length, responderView.handCounts[responder.id]);
    const spectatorView = parity.clients.find((client) => client !== responder)!.room!.gameState.publicState as any;
    assert.notDeepEqual(spectatorView.hand, responderView.hand, "viewer-specific hands must differ");
    const invalidAttack = await emitResponse<RoomSnapshot>(responder, "game:action", {
      code: parity.code,
      action: actionFor(responder, { type: "tile/attack", payload: { tileId: responderView.hand[0]?.id }, actionId: "invalid-response-attack" })
    });
    assert.equal(invalidAttack.ok, false, "invalid parity actions must fail their acknowledgement");
    close(parity);

    const mosaic = await startedRoom(baseUrl, "mosaic-rush", 2);
    const runtime = mosaic.clients[0].room!.gameState;
    assert.equal(runtime.activePlayerId, null);
    assert.equal(runtime.interactivePlayerIds?.length, 2);
    assert(runtime.turnDeadlineAt && runtime.turnDeadlineAt > Date.now());
    const mosaicPuzzle = mosaic.clients[0].room!.gameState.publicState as any;
    const privatePlacement = solutionForMosaicChallenge(mosaicPuzzle.puzzle.card, mosaicPuzzle.puzzle.symbol)[0];
    await emit<RoomSnapshot>(mosaic.clients[0], "game:action", {
      code: mosaic.code,
      action: actionFor(mosaic.clients[0], { type: "mosaic/place", payload: privatePlacement, actionId: "place-1" })
    });
    await waitFor(() => mosaic.clients.every((client) => Boolean(client.room)), "mosaic broadcast");
    assert.equal(((mosaic.clients[1].room!.gameState.publicState as any).placements as unknown[]).length, 0);
    close(mosaic);

    console.table([
      { game: "인디언 포커", socket: "viewer projection + actionId dedupe + seat auth" },
      { game: "타이거 앤 드래곤", socket: "battlefield concurrency + disconnect recovery + timer gate + viewer privacy" },
      { game: "우봉고", socket: "active=null phase timer + simultaneous privacy" }
    ]);
  } finally {
    child.kill();
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

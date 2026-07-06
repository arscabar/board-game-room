import Matter from "matter-js";
import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const BOARD_RADIUS = 360;
const VIEW_SIZE = 820;
const MAX_VECTOR = 170;
const MAX_SPEED = 22;
const STEP_MS = 1000 / 60;
const MAX_STEPS = 360;

const playerColors = ["#d94f45", "#2364aa", "#d69b2d", "#258a5b"];
const skillPool = ["dash", "anchor", "burst", "guard", "rubber"] as const;

type EggKind = "king" | "normal" | "skill";
type SkillKind = (typeof skillPool)[number];
type TerrainKind = "mud" | "ice" | "bumper" | "pit";
type Phase = "playing" | "complete";

interface Point {
  x: number;
  y: number;
}

interface AlkkagiPlayer {
  id: string;
  name: string;
  seat: number;
  color: string;
}

interface AlkkagiEgg extends Point {
  id: string;
  ownerId: string;
  kind: EggKind;
  skill?: SkillKind;
  alive: boolean;
  used?: boolean;
}

interface Terrain extends Point {
  id: string;
  kind: TerrainKind;
  r: number;
}

interface AlkkagiState {
  players: AlkkagiPlayer[];
  eggs: AlkkagiEgg[];
  terrain: Terrain[];
  phase: Phase;
  activePlayerId: string | null;
  winnerId: string | null;
  winnerIds: string[];
  lastShot: { playerId: string; eggId: string; vector: Point; fallenIds: string[] } | null;
  message: string;
}

interface FlickPayload {
  eggId: string;
  vector: Point;
}

const terrainLayout: Terrain[] = [
  { id: "pit-center", kind: "pit", x: 0, y: 0, r: 38 },
  { id: "mud-left", kind: "mud", x: -145, y: 95, r: 66 },
  { id: "ice-right", kind: "ice", x: 142, y: -108, r: 70 },
  { id: "bumper-top", kind: "bumper", x: 0, y: -215, r: 21 },
  { id: "bumper-left", kind: "bumper", x: -224, y: -54, r: 19 },
  { id: "bumper-right", kind: "bumper", x: 226, y: 74, r: 19 }
];

function assertState(state: unknown): AlkkagiState {
  if (!state || typeof state !== "object") {
    throw new Error("알까기 상태가 올바르지 않습니다.");
  }
  return state as AlkkagiState;
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.x === "number" && Number.isFinite(item.x) && typeof item.y === "number" && Number.isFinite(item.y);
}

function isFlickPayload(value: unknown): value is FlickPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.eggId === "string" && isPoint(item.vector);
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function length(vector: Point) {
  return Math.hypot(vector.x, vector.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalize(vector: Point) {
  const size = length(vector);
  return size > 0 ? { x: vector.x / size, y: vector.y / size } : { x: 1, y: 0 };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: number) {
  let current = seed >>> 0;
  return () => {
    current = (current * 1664525 + 1013904223) >>> 0;
    return current / 2 ** 32;
  };
}

function randomSkills(seed: number, playerIndex: number) {
  const rng = createRng(seed + playerIndex * 9973);
  const pool = [...skillPool];
  const skills: SkillKind[] = [];
  while (skills.length < 3) {
    const index = Math.floor(rng() * pool.length);
    const [skill] = pool.splice(index, 1);
    skills.push(skill);
  }
  return skills;
}

function eggRadius(egg: Pick<AlkkagiEgg, "kind" | "skill">) {
  if (egg.kind === "king") return 29;
  if (egg.skill === "anchor") return 23;
  return egg.kind === "skill" ? 21 : 20;
}

function eggMass(egg: Pick<AlkkagiEgg, "kind" | "skill">) {
  if (egg.kind === "king") return 7.2;
  if (egg.skill === "anchor") return 2.55;
  if (egg.skill === "rubber") return 0.92;
  return 1;
}

function eggRestitution(egg: Pick<AlkkagiEgg, "kind" | "skill">) {
  if (egg.skill === "rubber") return 1.08;
  if (egg.kind === "king") return 0.62;
  if (egg.skill === "anchor") return 0.58;
  return 0.82;
}

function cloneState(state: AlkkagiState): AlkkagiState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    eggs: state.eggs.map((egg) => ({ ...egg })),
    terrain: state.terrain.map((terrain) => ({ ...terrain })),
    winnerIds: [...state.winnerIds],
    lastShot: state.lastShot
      ? {
          playerId: state.lastShot.playerId,
          eggId: state.lastShot.eggId,
          vector: { ...state.lastShot.vector },
          fallenIds: [...state.lastShot.fallenIds]
        }
      : null
  };
}

function connectedActivePlayers(state: AlkkagiState, context: GameContext) {
  const connectedIds = new Set(context.players.filter((player) => player.connected).map((player) => player.id));
  return state.players.filter((player) => connectedIds.has(player.id) && kingAlive(state, player.id));
}

function kingAlive(state: AlkkagiState, playerId: string) {
  return state.eggs.some((egg) => egg.ownerId === playerId && egg.kind === "king" && egg.alive);
}

function nextTurn(state: AlkkagiState, context: GameContext) {
  const order = connectedActivePlayers(state, context);
  if (order.length === 0) {
    return { activePlayerId: null, turnNumber: context.turnNumber + 1, roundNumber: context.roundNumber };
  }

  const currentIndex = order.findIndex((player) => player.id === context.currentPlayerId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % order.length;
  return {
    activePlayerId: order[nextIndex].id,
    turnNumber: context.turnNumber + 1,
    roundNumber: context.roundNumber + (currentIndex !== -1 && nextIndex === 0 ? 1 : 0)
  };
}

function winnerAfterShot(state: AlkkagiState, context: GameContext) {
  const alive = connectedActivePlayers(state, context);
  return alive.length === 1 ? alive[0] : null;
}

function requireActivePlayer(state: AlkkagiState, context: GameContext) {
  if (state.phase !== "playing" || state.winnerId) {
    throw new Error("이미 끝난 알까기입니다.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("현재 차례의 플레이어만 알을 튕길 수 있습니다.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player || !kingAlive(state, player.id)) {
    throw new Error("알까기 플레이어를 찾을 수 없습니다.");
  }
  return player;
}

function initialEggs(players: AlkkagiPlayer[]) {
  const seed = hashString(players.map((player) => `${player.id}:${player.seat}`).join("|"));
  const eggs: AlkkagiEgg[] = [];
  const offsets: Array<{ x: number; y: number; kind: EggKind; skillIndex?: number }> = [
    { x: 0, y: 0, kind: "king" },
    { x: -35, y: 43, kind: "normal" },
    { x: 35, y: 43, kind: "normal" },
    { x: -52, y: -18, kind: "skill", skillIndex: 0 },
    { x: 0, y: -52, kind: "skill", skillIndex: 1 },
    { x: 52, y: -18, kind: "skill", skillIndex: 2 }
  ];

  players.forEach((player, playerIndex) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * playerIndex) / players.length;
    const outward = { x: Math.cos(angle), y: Math.sin(angle) };
    const inward = { x: -outward.x, y: -outward.y };
    const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
    const base = { x: outward.x * 255, y: outward.y * 255 };
    const skills = randomSkills(seed, playerIndex);

    offsets.forEach((offset, index) => {
      const skill = typeof offset.skillIndex === "number" ? skills[offset.skillIndex] : undefined;
      eggs.push({
        id: `${player.id}-${offset.kind}-${index}`,
        ownerId: player.id,
        kind: offset.kind,
        skill,
        alive: true,
        x: round(base.x + tangent.x * offset.x + inward.x * offset.y),
        y: round(base.y + tangent.y * offset.x + inward.y * offset.y)
      });
    });
  });

  return eggs;
}

function createInitialState({ players }: Pick<GameContext, "players">): AlkkagiState {
  const seatedPlayers = players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 4);
  const modulePlayers = seatedPlayers.map((player, index): AlkkagiPlayer => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    color: playerColors[index] ?? "#a855f7"
  }));
  const firstPlayer = modulePlayers[0] ?? null;

  return {
    players: modulePlayers,
    eggs: initialEggs(modulePlayers),
    terrain: terrainLayout.map((terrain) => ({ ...terrain })),
    phase: "playing",
    activePlayerId: firstPlayer?.id ?? null,
    winnerId: null,
    winnerIds: [],
    lastShot: null,
    message: firstPlayer ? `${firstPlayer.name}님 차례입니다.` : "2명 이상 입장하면 시작할 수 있습니다."
  };
}

function markEggUsed(state: AlkkagiState, eggId: string) {
  const egg = state.eggs.find((candidate) => candidate.id === eggId);
  if (egg) egg.used = true;
}

function settleShot(state: AlkkagiState, shotEgg: AlkkagiEgg, vector: Point) {
  const engine = Matter.Engine.create({ enableSleeping: false });
  engine.gravity.x = 0;
  engine.gravity.y = 0;
  const bodies = new Map<string, Matter.Body>();
  const removed = new Set<string>();
  let burstTriggered = false;

  for (const egg of state.eggs.filter((candidate) => candidate.alive)) {
    const body = Matter.Bodies.circle(egg.x, egg.y, eggRadius(egg), {
      label: egg.id,
      frictionAir: egg.kind === "king" ? 0.052 : egg.skill === "anchor" ? 0.042 : 0.029,
      friction: 0.03,
      restitution: eggRestitution(egg)
    });
    Matter.Body.setMass(body, eggMass(egg));
    bodies.set(egg.id, body);
    Matter.Composite.add(engine.world, body);
  }

  for (const terrain of state.terrain.filter((item) => item.kind === "bumper")) {
    Matter.Composite.add(
      engine.world,
      Matter.Bodies.circle(terrain.x, terrain.y, terrain.r, {
        isStatic: true,
        label: `terrain-${terrain.id}`,
        restitution: 1.25
      })
    );
  }

  function bodyEgg(body: Matter.Body) {
    return state.eggs.find((egg) => egg.id === body.label) ?? null;
  }

  function triggerBurst(origin: Matter.Body) {
    if (burstTriggered || shotEgg.skill !== "burst" || shotEgg.used) return;
    burstTriggered = true;
    markEggUsed(state, shotEgg.id);
    for (const [id, body] of bodies) {
      if (id === shotEgg.id || removed.has(id)) continue;
      const gap = distance(origin.position, body.position);
      if (gap > 128) continue;
      const direction = normalize({ x: body.position.x - origin.position.x, y: body.position.y - origin.position.y });
      const strength = 5.8 * (1 - gap / 140);
      Matter.Body.setVelocity(body, {
        x: body.velocity.x + direction.x * strength,
        y: body.velocity.y + direction.y * strength
      });
    }
  }

  Matter.Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const a = bodyEgg(pair.bodyA);
      const b = bodyEgg(pair.bodyB);
      if (a?.id === shotEgg.id || b?.id === shotEgg.id) {
        triggerBurst((a?.id === shotEgg.id ? pair.bodyA : pair.bodyB) as Matter.Body);
      }
    }
  });

  const shotBody = bodies.get(shotEgg.id);
  if (!shotBody) {
    return [] as string[];
  }

  const direction = normalize(vector);
  const vectorLength = Math.min(length(vector), MAX_VECTOR);
  let speed = (vectorLength / MAX_VECTOR) * MAX_SPEED;
  if (shotEgg.kind === "king") speed = Math.min(speed * 0.42, 7.4);
  if (shotEgg.skill === "dash") speed *= 1.24;
  if (shotEgg.skill === "anchor") speed *= 0.88;
  Matter.Body.setVelocity(shotBody, { x: direction.x * speed, y: direction.y * speed });

  function removeBody(id: string) {
    const body = bodies.get(id);
    if (!body || removed.has(id)) return;
    removed.add(id);
    Matter.Composite.remove(engine.world, body);
  }

  let quietFrames = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    Matter.Engine.update(engine, STEP_MS);

    for (const [id, body] of bodies) {
      if (removed.has(id)) continue;
      const egg = state.eggs.find((candidate) => candidate.id === id);
      if (!egg) continue;

      for (const terrain of state.terrain) {
        const gap = distance(body.position, terrain);
        if (terrain.kind === "mud" && gap < terrain.r) {
          Matter.Body.setVelocity(body, { x: body.velocity.x * 0.88, y: body.velocity.y * 0.88 });
        }
        if (terrain.kind === "ice" && gap < terrain.r) {
          const current = length(body.velocity);
          const capped = Math.min(current * 1.015, 23);
          const dir = normalize(body.velocity);
          Matter.Body.setVelocity(body, { x: dir.x * capped, y: dir.y * capped });
        }
        if (terrain.kind === "pit" && gap < terrain.r + eggRadius(egg) * 0.16) {
          removeBody(id);
        }
      }

      const centerDistance = length(body.position);
      const fallLimit = BOARD_RADIUS - eggRadius(egg) * 0.32;
      if (centerDistance > fallLimit) {
        if (egg.skill === "guard" && !egg.used) {
          const dir = normalize(body.position);
          markEggUsed(state, id);
          Matter.Body.setPosition(body, { x: dir.x * (BOARD_RADIUS - eggRadius(egg) - 14), y: dir.y * (BOARD_RADIUS - eggRadius(egg) - 14) });
          Matter.Body.setVelocity(body, { x: -dir.x * 3.4, y: -dir.y * 3.4 });
        } else {
          removeBody(id);
        }
      }
    }

    const moving = [...bodies]
      .filter(([id]) => !removed.has(id))
      .some(([, body]) => length(body.velocity) > 0.08);
    quietFrames = moving ? 0 : quietFrames + 1;
    if (quietFrames > 28) break;
  }

  for (const egg of state.eggs) {
    if (!egg.alive) continue;
    if (removed.has(egg.id)) {
      egg.alive = false;
      continue;
    }
    const body = bodies.get(egg.id);
    if (body) {
      egg.x = round(body.position.x);
      egg.y = round(body.position.y);
    }
  }

  return [...removed];
}

function flickEgg(state: AlkkagiState, action: GameAction, context: GameContext): GameActionResult {
  if (!isFlickPayload(action.payload)) {
    throw new Error("튕길 알과 방향이 필요합니다.");
  }
  const payload = action.payload;
  const player = requireActivePlayer(state, context);
  const next = cloneState(state);
  const shotEgg = next.eggs.find((egg) => egg.id === payload.eggId);
  if (!shotEgg || !shotEgg.alive || shotEgg.ownerId !== player.id) {
    throw new Error("내 살아있는 알만 튕길 수 있습니다.");
  }
  if (length(payload.vector) < 8) {
    throw new Error("조금 더 끌어서 튕겨주세요.");
  }

  const fallenIds = settleShot(next, shotEgg, payload.vector);
  next.lastShot = {
    playerId: player.id,
    eggId: shotEgg.id,
    vector: { x: round(payload.vector.x), y: round(payload.vector.y) },
    fallenIds
  };

  const winner = winnerAfterShot(next, context);
  if (winner) {
    next.phase = "complete";
    next.activePlayerId = null;
    next.winnerId = winner.id;
    next.winnerIds = [winner.id];
    next.message = `${winner.name}님이 마지막 왕알을 지켰습니다.`;
    return {
      state: next,
      log: `${player.name} 알 튕김`,
      activePlayerId: null,
      turnNumber: context.turnNumber + 1,
      phase: "complete",
      message: next.message,
      winnerId: winner.id,
      winnerIds: [winner.id]
    };
  }

  const turn = nextTurn(next, context);
  const nextPlayerName = next.players.find((candidate) => candidate.id === turn.activePlayerId)?.name ?? "다음 플레이어";
  next.activePlayerId = turn.activePlayerId;
  next.message = `${nextPlayerName}님 차례입니다.`;
  return {
    state: next,
    log: `${player.name} 알 튕김`,
    activePlayerId: turn.activePlayerId,
    turnNumber: turn.turnNumber,
    roundNumber: turn.roundNumber,
    phase: "playing",
    message: next.message
  };
}

export const module: GameModule = {
  id: "alkkagi",
  createInitialState,
  getPublicState: (state) => assertState(state),
  applyAction: (state, action, context) => {
    const currentState = assertState(state);
    if (action.type !== "alkkagi/flick") {
      throw new Error("지원하지 않는 알까기 행동입니다.");
    }
    return flickEgg(currentState, action, context);
  }
};

function skillClass(skill?: SkillKind) {
  return skill ? `skill-${skill}` : "";
}

function skillMark(skill?: SkillKind) {
  if (skill === "dash") return <path d="M-7 5 L1 -8 L0 -1 L8 -5 L-1 9 L0 1 Z" />;
  if (skill === "anchor") return <circle cx="0" cy="0" r="7" />;
  if (skill === "burst") return <path d="M0 -9 L2 -2 L9 0 L2 2 L0 9 L-2 2 L-9 0 L-2 -2 Z" />;
  if (skill === "guard") return <path d="M0 -9 Q8 -5 7 3 Q4 8 0 10 Q-4 8 -7 3 Q-8 -5 0 -9 Z" />;
  if (skill === "rubber") return <path d="M-8 0 C-5 -9 5 -9 8 0 C5 9 -5 9 -8 0 Z" />;
  return null;
}

function terrainLabel(kind: TerrainKind) {
  if (kind === "pit") return "중앙 구멍";
  if (kind === "mud") return "끈적 지형";
  if (kind === "ice") return "미끄럼 지형";
  return "범퍼";
}

export function Component({
  currentPlayer,
  activePlayer,
  publicState,
  disabled,
  onAction
}: GameComponentProps<AlkkagiState>) {
  const state = assertState(publicState);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ eggId: string; start: Point; current: Point } | null>(null);
  const canAct = !disabled && currentPlayer?.id === state.activePlayerId && state.phase === "playing";
  const activeEggs = state.eggs.filter((egg) => egg.alive);
  const selectedEgg = drag ? activeEggs.find((egg) => egg.id === drag.eggId) ?? null : null;
  const aim = selectedEgg && drag ? { x: selectedEgg.x - drag.current.x, y: selectedEgg.y - drag.current.y } : null;
  const aimSize = aim ? Math.min(length(aim), selectedEgg?.kind === "king" ? 76 : MAX_VECTOR) : 0;
  const aimDirection = aim ? normalize(aim) : { x: 0, y: 0 };

  function clientPoint(event: PointerEvent<SVGElement>): Point {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * VIEW_SIZE - VIEW_SIZE / 2,
      y: ((event.clientY - rect.top) / rect.height) * VIEW_SIZE - VIEW_SIZE / 2
    };
  }

  function beginDrag(event: PointerEvent<SVGGElement>, egg: AlkkagiEgg) {
    if (!canAct || egg.ownerId !== currentPlayer?.id) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = clientPoint(event);
    setDrag({ eggId: egg.id, start: point, current: point });
  }

  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    setDrag((current) => (current ? { ...current, current: clientPoint(event) } : current));
  }

  function endDrag() {
    if (!drag || !selectedEgg || !aim) {
      setDrag(null);
      return;
    }
    const capped = Math.min(length(aim), selectedEgg.kind === "king" ? 76 : MAX_VECTOR);
    if (capped >= 8) {
      const direction = normalize(aim);
      onAction({
        type: "alkkagi/flick",
        payload: {
          eggId: selectedEgg.id,
          vector: { x: direction.x * capped, y: direction.y * capped }
        }
      });
    }
    setDrag(null);
  }

  return (
    <div className="game-module alk-shell">
      <section className="alk-status" aria-label="알까기 진행 상태">
        <strong>차례</strong>
        <span>{activePlayer?.name ?? "종료"}</span>
      </section>

      <svg
        ref={svgRef}
        className="alk-board"
        viewBox={`${-VIEW_SIZE / 2} ${-VIEW_SIZE / 2} ${VIEW_SIZE} ${VIEW_SIZE}`}
        role="application"
        aria-label="다인전 알까기 원형판"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      >
        <defs>
          <radialGradient id="alk-board-grain" cx="38%" cy="28%" r="70%">
            <stop offset="0%" stopColor="#c98742" />
            <stop offset="58%" stopColor="#80502a" />
            <stop offset="100%" stopColor="#2c180d" />
          </radialGradient>
          <filter id="alk-soft-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#160b04" floodOpacity="0.42" />
          </filter>
        </defs>
        <circle className="alk-table-rim" cx="0" cy="0" r={BOARD_RADIUS + 24} />
        <circle className="alk-table" cx="0" cy="0" r={BOARD_RADIUS} />
        <circle className="alk-table-inner" cx="0" cy="0" r={BOARD_RADIUS - 18} />

        {state.terrain.map((terrain) => (
          <g className={`alk-terrain ${terrain.kind}`} key={terrain.id} aria-label={terrainLabel(terrain.kind)}>
            <circle cx={terrain.x} cy={terrain.y} r={terrain.r} />
            {terrain.kind === "bumper" ? <circle cx={terrain.x} cy={terrain.y} r={terrain.r * 0.45} /> : null}
          </g>
        ))}

        {aim && selectedEgg ? (
          <g className="alk-aim" aria-hidden="true">
            <line
              x1={selectedEgg.x}
              y1={selectedEgg.y}
              x2={selectedEgg.x + aimDirection.x * aimSize}
              y2={selectedEgg.y + aimDirection.y * aimSize}
            />
            <circle cx={selectedEgg.x + aimDirection.x * aimSize} cy={selectedEgg.y + aimDirection.y * aimSize} r={6 + aimSize * 0.045} />
          </g>
        ) : null}

        {activeEggs.map((egg) => {
          const owner = state.players.find((player) => player.id === egg.ownerId);
          const isCurrent = egg.ownerId === currentPlayer?.id && canAct;
          const radius = eggRadius(egg);
          return (
            <g
              key={egg.id}
              className={`alk-egg ${egg.kind} ${skillClass(egg.skill)} ${isCurrent ? "is-current" : ""} ${egg.id === state.lastShot?.eggId ? "last-shot" : ""}`}
              style={{ "--player-color": owner?.color ?? "#d94f45" } as CSSProperties}
              transform={`translate(${egg.x} ${egg.y})`}
              role="button"
              tabIndex={isCurrent ? 0 : -1}
              aria-label={`${owner?.name ?? "플레이어"} ${egg.kind === "king" ? "왕알" : egg.skill ? "스킬 알" : "알"}`}
              onPointerDown={(event) => beginDrag(event, egg)}
            >
              <circle className="alk-egg-shadow" cx="0" cy="4" r={radius} />
              <circle className="alk-egg-body" cx="0" cy="0" r={radius} />
              {egg.kind === "king" ? (
                <g className="alk-king-mark" aria-hidden="true">
                  <path d="M-11 -3 L-6 -13 L0 -5 L6 -13 L11 -3 L8 8 L-8 8 Z" />
                  <circle cx="-6" cy="-13" r="2.3" />
                  <circle cx="6" cy="-13" r="2.3" />
                </g>
              ) : null}
              {egg.kind === "skill" ? <g className="alk-skill-mark" aria-hidden="true">{skillMark(egg.skill)}</g> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

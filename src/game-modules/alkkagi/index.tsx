import Matter from "matter-js";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const BOARD_RADIUS = 392;
const VIEW_SIZE = 900;
const MAX_VECTOR = 170;
const MAX_SPEED = 22;
const STEP_MS = 1000 / 60;
const MAX_STEPS = 360;
const BASE_ROLLING_DRAG = 0.0028;
const LOW_SPEED_DRAG = 0.016;
const ICE_SLIDE_BOOST = 1.004;
const COLLISION_TRANSFER = 0.18;
const SPIN_DRIFT = 0.012;
const SPIN_DECAY = 0.966;
const AIM_PHASE_LIMIT_MS = 10_000;
const DIRECTION_CYCLE_MS = 3_400;
const POWER_CYCLE_MS = 1_800;
const MIN_POWER_RATIO = 0.08;
const DEFAULT_AIM_POWER = 0.58;
const MOTION_FRAME_INTERVAL = 2;
const MAX_MOTION_FRAMES = 96;
const SHOT_REPLAY_MIN_MS = 900;
const SHOT_REPLAY_MAX_MS = 2200;

const playerColors = ["#d94f45", "#2364aa", "#d69b2d", "#258a5b"];
const skillPool = ["dash", "anchor", "burst", "guard", "rubber"] as const;
const defaultArenaId = "classic-ring";

type EggKind = "king" | "normal" | "skill";
type SkillKind = (typeof skillPool)[number];
type TerrainKind = "mud" | "ice" | "bumper" | "pit";
type GimmickKind = "button" | "lever";
type Phase = "playing" | "complete";
type AimPhase = "idle" | "direction" | "power";
type HoldMode = "direction" | "power";

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

interface ArenaGimmick extends Point {
  id: string;
  kind: GimmickKind;
  r: number;
  angle?: number;
}

interface ArenaPreset {
  id: string;
  name: string;
  className: string;
  terrain: Terrain[];
  gimmicks: ArenaGimmick[];
}

interface ShotMotionEggFrame extends Point {
  id: string;
  alive: boolean;
  speed: number;
}

interface ShotMotionFrame {
  time: number;
  eggs: ShotMotionEggFrame[];
  impactIds: string[];
  triggeredGimmickIds: string[];
}

interface LastShotState {
  playerId: string;
  eggId: string;
  vector: Point;
  fallenIds: string[];
  triggeredGimmickIds: string[];
  activatedSkillIds: string[];
  impactIds?: string[];
  motionFrames?: ShotMotionFrame[];
}

interface AlkkagiState {
  players: AlkkagiPlayer[];
  eggs: AlkkagiEgg[];
  arena: {
    id: string;
    name: string;
    className: string;
  };
  terrain: Terrain[];
  gimmicks: ArenaGimmick[];
  phase: Phase;
  activePlayerId: string | null;
  winnerId: string | null;
  winnerIds: string[];
  lastShot: LastShotState | null;
  message: string;
}

interface FlickPayload {
  eggId: string;
  vector: Point;
}

interface AimControlState {
  phase: AimPhase;
  eggId: string | null;
  angle: number;
  power: number;
  deadline: number;
}

const arenaPresets: ArenaPreset[] = [
  {
    id: defaultArenaId,
    name: "고전 원반장",
    className: "arena-classic",
    terrain: [
      { id: "classic-pit", kind: "pit", x: 0, y: 0, r: 38 },
      { id: "classic-mud", kind: "mud", x: -145, y: 95, r: 66 },
      { id: "classic-ice", kind: "ice", x: 142, y: -108, r: 70 },
      { id: "classic-bumper-top", kind: "bumper", x: 0, y: -215, r: 21 },
      { id: "classic-bumper-left", kind: "bumper", x: -224, y: -54, r: 19 },
      { id: "classic-bumper-right", kind: "bumper", x: 226, y: 74, r: 19 }
    ],
    gimmicks: [
      { id: "classic-button", kind: "button", x: 118, y: -196, r: 25 },
      { id: "classic-lever", kind: "lever", x: -168, y: 174, r: 31, angle: -32 }
    ]
  },
  {
    id: "crescent-pond",
    name: "초승달 연못장",
    className: "arena-pond",
    terrain: [
      { id: "pond-pit", kind: "pit", x: -74, y: 62, r: 34 },
      { id: "pond-mud", kind: "mud", x: 126, y: 132, r: 78 },
      { id: "pond-ice", kind: "ice", x: -128, y: -154, r: 62 },
      { id: "pond-bumper-left", kind: "bumper", x: -238, y: 32, r: 20 },
      { id: "pond-bumper-right", kind: "bumper", x: 216, y: -62, r: 21 },
      { id: "pond-bumper-bottom", kind: "bumper", x: 18, y: 228, r: 18 }
    ],
    gimmicks: [
      { id: "pond-button", kind: "button", x: 170, y: 8, r: 25 },
      { id: "pond-lever", kind: "lever", x: -204, y: 124, r: 31, angle: 26 }
    ]
  },
  {
    id: "ridge-hall",
    name: "능선 목판장",
    className: "arena-ridge",
    terrain: [
      { id: "ridge-pit", kind: "pit", x: 96, y: -86, r: 36 },
      { id: "ridge-mud", kind: "mud", x: -92, y: -18, r: 72 },
      { id: "ridge-ice", kind: "ice", x: 82, y: 174, r: 66 },
      { id: "ridge-bumper-top-left", kind: "bumper", x: -194, y: -194, r: 20 },
      { id: "ridge-bumper-top-right", kind: "bumper", x: 224, y: -168, r: 19 },
      { id: "ridge-bumper-bottom-left", kind: "bumper", x: -176, y: 194, r: 21 }
    ],
    gimmicks: [
      { id: "ridge-button", kind: "button", x: -12, y: -226, r: 24 },
      { id: "ridge-lever", kind: "lever", x: 184, y: 96, r: 31, angle: -55 }
    ]
  },
  {
    id: "storm-bowl",
    name: "회오리 사발장",
    className: "arena-storm",
    terrain: [
      { id: "storm-pit", kind: "pit", x: 0, y: -134, r: 32 },
      { id: "storm-mud", kind: "mud", x: 0, y: 124, r: 82 },
      { id: "storm-ice", kind: "ice", x: -176, y: -20, r: 58 },
      { id: "storm-ice-small", kind: "ice", x: 174, y: 32, r: 52 },
      { id: "storm-bumper-upper", kind: "bumper", x: 116, y: -222, r: 18 },
      { id: "storm-bumper-lower", kind: "bumper", x: -118, y: 222, r: 18 }
    ],
    gimmicks: [
      { id: "storm-button", kind: "button", x: -132, y: -126, r: 24 },
      { id: "storm-lever", kind: "lever", x: 146, y: 164, r: 31, angle: 42 }
    ]
  }
];

function assertState(state: unknown): AlkkagiState {
  if (!state || typeof state !== "object") {
    throw new Error("알까기 상태가 올바르지 않습니다.");
  }
  return normalizeState(state as AlkkagiState);
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

function normalizeAngle(angle: number) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function idleAimControl(deadline = 0): AimControlState {
  return {
    phase: "idle",
    eggId: null,
    angle: 0,
    power: MIN_POWER_RATIO,
    deadline
  };
}

function nextAimDeadline() {
  return Date.now() + AIM_PHASE_LIMIT_MS;
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

function cloneTerrain(terrain: Terrain[]) {
  return terrain.map((item) => ({ ...item }));
}

function cloneGimmicks(gimmicks: ArenaGimmick[]) {
  return gimmicks.map((item) => ({ ...item }));
}

function arenaSummary(arena: ArenaPreset) {
  return { id: arena.id, name: arena.name, className: arena.className };
}

function fallbackArena() {
  return arenaPresets.find((arena) => arena.id === defaultArenaId) ?? arenaPresets[0];
}

function arenaById(id: string | null | undefined) {
  return arenaPresets.find((arena) => arena.id === id) ?? fallbackArena();
}

function selectArena(players: AlkkagiPlayer[], entropy = Date.now()) {
  const seed = hashString(players.map((player) => `${player.id}:${player.seat}`).join("|"));
  const index = Math.abs(seed ^ Math.floor(entropy) ^ Math.floor(Math.random() * 65535)) % arenaPresets.length;
  return arenaPresets[index] ?? fallbackArena();
}

function normalizeState(state: AlkkagiState) {
  const arena = arenaById(state.arena?.id);
  if (!state.arena) {
    state.arena = arenaSummary(arena);
    if (!Array.isArray(state.terrain) || state.terrain.length === 0) {
      state.terrain = cloneTerrain(arena.terrain);
    }
  }
  if (!Array.isArray(state.gimmicks)) {
    state.gimmicks = cloneGimmicks(arena.gimmicks);
  }
  return state;
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

function launchSpeed(egg: Pick<AlkkagiEgg, "kind" | "skill">, vectorLength: number) {
  const power = clamp(vectorLength / MAX_VECTOR, 0, 1);
  const mass = eggMass(egg);
  let speed = (power * MAX_SPEED) / Math.sqrt(mass);
  if (egg.kind === "king") speed = Math.min(speed * 0.45, 4.2);
  if (egg.skill === "dash") speed *= 1.18;
  if (egg.skill === "anchor") speed *= 0.94;
  if (egg.skill === "rubber") speed *= 1.06;
  return Math.min(speed, MAX_SPEED * 1.08);
}

function rollingDragForEgg(egg: Pick<AlkkagiEgg, "kind" | "skill">, surface: number) {
  const massRelief = egg.kind === "king" ? 1 : Math.sqrt(Math.min(eggMass(egg), 2.4));
  const roleDrag = egg.kind === "king" ? 3.2 : egg.skill === "anchor" ? 1.2 : egg.skill === "rubber" ? 1.08 : 1;
  const skillRelief = egg.skill === "dash" ? 0.9 : 1;
  return (BASE_ROLLING_DRAG * surface * roleDrag * skillRelief) / massRelief;
}

function surfaceFrictionAt(state: AlkkagiState, body: Matter.Body) {
  let surface = 1;
  let onIce = false;
  for (const terrain of state.terrain) {
    const gap = distance(body.position, terrain);
    if (terrain.kind === "mud" && gap < terrain.r) {
      surface = Math.max(surface, 3.4);
    }
    if (terrain.kind === "ice" && gap < terrain.r) {
      surface = Math.min(surface, 0.32);
      onIce = true;
    }
  }
  return { surface, onIce };
}

function velocityPoint(body: Matter.Body): Point {
  return { x: body.velocity.x, y: body.velocity.y };
}

function dot(a: Point, b: Point) {
  return a.x * b.x + a.y * b.y;
}

function applyVelocity(body: Matter.Body, delta: Point) {
  Matter.Body.setVelocity(body, {
    x: body.velocity.x + delta.x,
    y: body.velocity.y + delta.y
  });
}

function cloneState(state: AlkkagiState): AlkkagiState {
  const normalized = normalizeState(state);
  return {
    ...normalized,
    players: normalized.players.map((player) => ({ ...player })),
    eggs: normalized.eggs.map((egg) => ({ ...egg })),
    arena: { ...normalized.arena },
    terrain: cloneTerrain(normalized.terrain),
    gimmicks: cloneGimmicks(normalized.gimmicks),
    winnerIds: [...normalized.winnerIds],
    lastShot: normalized.lastShot
      ? {
          playerId: normalized.lastShot.playerId,
          eggId: normalized.lastShot.eggId,
          vector: { ...normalized.lastShot.vector },
          fallenIds: [...normalized.lastShot.fallenIds],
          triggeredGimmickIds: [...(normalized.lastShot.triggeredGimmickIds ?? [])],
          activatedSkillIds: [...(normalized.lastShot.activatedSkillIds ?? [])],
          impactIds: [...(normalized.lastShot.impactIds ?? [])],
          motionFrames: (normalized.lastShot.motionFrames ?? []).map((frame) => ({
            time: frame.time,
            eggs: frame.eggs.map((egg) => ({ ...egg })),
            impactIds: [...frame.impactIds],
            triggeredGimmickIds: [...frame.triggeredGimmickIds]
          }))
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
    { x: -58, y: 56, kind: "normal" },
    { x: 58, y: 56, kind: "normal" },
    { x: -82, y: -16, kind: "skill", skillIndex: 0 },
    { x: 0, y: -70, kind: "skill", skillIndex: 1 },
    { x: 82, y: -16, kind: "skill", skillIndex: 2 }
  ];

  players.forEach((player, playerIndex) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * playerIndex) / players.length;
    const outward = { x: Math.cos(angle), y: Math.sin(angle) };
    const inward = { x: -outward.x, y: -outward.y };
    const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
    const base = { x: outward.x * 286, y: outward.y * 286 };
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
  const arena = selectArena(modulePlayers);

  return {
    players: modulePlayers,
    eggs: initialEggs(modulePlayers),
    arena: arenaSummary(arena),
    terrain: cloneTerrain(arena.terrain),
    gimmicks: cloneGimmicks(arena.gimmicks),
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

function leverDirection(gimmick: ArenaGimmick) {
  const angle = ((gimmick.angle ?? 0) * Math.PI) / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function settleShot(state: AlkkagiState, shotEgg: AlkkagiEgg, vector: Point) {
  const engine = Matter.Engine.create({ enableSleeping: false });
  engine.gravity.x = 0;
  engine.gravity.y = 0;
  const bodies = new Map<string, Matter.Body>();
  const removed = new Set<string>();
  const triggeredGimmicks = new Set<string>();
  const activatedSkillIds = new Set<string>();
  const impactIds = new Set<string>();
  const frameImpactIds = new Set<string>();
  const lastKnownPositions = new Map<string, Point>();
  const motionFrames: ShotMotionFrame[] = [];
  let burstTriggered = false;

  for (const egg of state.eggs.filter((candidate) => candidate.alive)) {
    const body = Matter.Bodies.circle(egg.x, egg.y, eggRadius(egg), {
      label: egg.id,
      frictionAir: egg.kind === "king" ? 0.016 : egg.skill === "anchor" ? 0.014 : 0.01,
      friction: 0.03,
      restitution: eggRestitution(egg)
    });
    Matter.Body.setMass(body, eggMass(egg));
    bodies.set(egg.id, body);
    lastKnownPositions.set(egg.id, { x: egg.x, y: egg.y });
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

  function applyCollisionTransfer(pair: Matter.Pair) {
    const eggA = bodyEgg(pair.bodyA);
    const eggB = bodyEgg(pair.bodyB);
    if (!eggA || !eggB) return;

    const normal = normalize({
      x: pair.bodyB.position.x - pair.bodyA.position.x,
      y: pair.bodyB.position.y - pair.bodyA.position.y
    });
    const relative = {
      x: pair.bodyA.velocity.x - pair.bodyB.velocity.x,
      y: pair.bodyA.velocity.y - pair.bodyB.velocity.y
    };
    const closingSpeed = dot(relative, normal);
    if (closingSpeed <= 0.32) return;

    const massA = eggMass(eggA);
    const massB = eggMass(eggB);
    const totalMass = massA + massB;
    const restitution = (eggRestitution(eggA) + eggRestitution(eggB)) / 2;
    const impulse = closingSpeed * COLLISION_TRANSFER * (0.7 + restitution);
    const aShare = massB / totalMass;
    const bShare = massA / totalMass;

    applyVelocity(pair.bodyA, { x: -normal.x * impulse * aShare, y: -normal.y * impulse * aShare });
    applyVelocity(pair.bodyB, { x: normal.x * impulse * bShare, y: normal.y * impulse * bShare });

    const tangent = { x: -normal.y, y: normal.x };
    const glancingSpeed = dot(relative, tangent);
    if (Math.abs(glancingSpeed) > 0.2) {
      Matter.Body.setAngularVelocity(pair.bodyA, clamp(pair.bodyA.angularVelocity - glancingSpeed * 0.006 * bShare, -0.42, 0.42));
      Matter.Body.setAngularVelocity(pair.bodyB, clamp(pair.bodyB.angularVelocity + glancingSpeed * 0.006 * aShare, -0.42, 0.42));
    }
  }

  function triggerBurst(origin: Matter.Body) {
    if (burstTriggered || shotEgg.skill !== "burst" || shotEgg.used) return;
    burstTriggered = true;
    activatedSkillIds.add(shotEgg.id);
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

  function captureMotionFrame(step: number, force = false) {
    if (motionFrames.length >= MAX_MOTION_FRAMES && !force) return;
    const eggs = state.eggs
      .filter((egg) => egg.alive || removed.has(egg.id))
      .map((egg) => {
        const body = bodies.get(egg.id);
        const position = body ? body.position : lastKnownPositions.get(egg.id) ?? egg;
        return {
          id: egg.id,
          x: round(position.x),
          y: round(position.y),
          alive: !removed.has(egg.id),
          speed: round(body && !removed.has(egg.id) ? length(velocityPoint(body)) : 0)
        };
      });

    const frame = {
      time: Math.round(step * STEP_MS),
      eggs,
      impactIds: [...frameImpactIds],
      triggeredGimmickIds: [...triggeredGimmicks]
    };
    if (motionFrames.length >= MAX_MOTION_FRAMES) {
      motionFrames[motionFrames.length - 1] = frame;
    } else {
      motionFrames.push(frame);
    }
    frameImpactIds.clear();
  }

  Matter.Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const a = bodyEgg(pair.bodyA);
      const b = bodyEgg(pair.bodyB);
      applyCollisionTransfer(pair);
      if (a && b) {
        impactIds.add(a.id);
        impactIds.add(b.id);
        frameImpactIds.add(a.id);
        frameImpactIds.add(b.id);
      }
      if (a?.id === shotEgg.id || b?.id === shotEgg.id) {
        triggerBurst((a?.id === shotEgg.id ? pair.bodyA : pair.bodyB) as Matter.Body);
      }
    }
  });

  const shotBody = bodies.get(shotEgg.id);
  if (!shotBody) {
    return { fallenIds: [] as string[], triggeredGimmickIds: [] as string[], activatedSkillIds: [] as string[], impactIds: [] as string[], motionFrames: [] as ShotMotionFrame[] };
  }

  const direction = normalize(vector);
  const vectorLength = Math.min(length(vector), MAX_VECTOR);
  const speed = launchSpeed(shotEgg, vectorLength);
  Matter.Body.setVelocity(shotBody, { x: direction.x * speed, y: direction.y * speed });
  Matter.Body.setAngularVelocity(shotBody, clamp(speed / eggRadius(shotEgg) / 2.2, 0.04, 0.34));
  if (shotEgg.skill && shotEgg.skill !== "burst" && shotEgg.skill !== "guard") {
    activatedSkillIds.add(shotEgg.id);
  }
  captureMotionFrame(0);

  function removeBody(id: string) {
    const body = bodies.get(id);
    if (!body || removed.has(id)) return;
    lastKnownPositions.set(id, { x: body.position.x, y: body.position.y });
    removed.add(id);
    Matter.Composite.remove(engine.world, body);
  }

  function triggerGimmick(gimmick: ArenaGimmick, touchedBody: Matter.Body) {
    if (triggeredGimmicks.has(gimmick.id)) return;
    triggeredGimmicks.add(gimmick.id);

    if (gimmick.kind === "button") {
      for (const [id, body] of bodies) {
        if (removed.has(id)) continue;
        const gap = distance(body.position, gimmick);
        if (gap > 178) continue;
        const direction = normalize({ x: body.position.x - gimmick.x, y: body.position.y - gimmick.y });
        const strength = 7.2 * (1 - gap / 188);
        Matter.Body.setVelocity(body, {
          x: body.velocity.x + direction.x * strength,
          y: body.velocity.y + direction.y * strength
        });
      }
      return;
    }

    const direction = leverDirection(gimmick);
    Matter.Body.setVelocity(touchedBody, {
      x: touchedBody.velocity.x + direction.x * 8.4,
      y: touchedBody.velocity.y + direction.y * 8.4
    });
  }

  let quietFrames = 0;
  const previousPositions = new Map<string, Point>();
  for (const [id, body] of bodies) {
    previousPositions.set(id, { x: body.position.x, y: body.position.y });
  }

  function applyRollingPhysics(id: string, body: Matter.Body, egg: AlkkagiEgg) {
    const previous = previousPositions.get(id) ?? { x: body.position.x, y: body.position.y };
    const travelled = distance(previous, body.position);
    previousPositions.set(id, { x: body.position.x, y: body.position.y });
    const { surface, onIce } = surfaceFrictionAt(state, body);
    const currentSpeed = length(velocityPoint(body));
    if (currentSpeed > 0.001) {
      const drag = rollingDragForEgg(egg, surface);
      const distanceLoss = Math.exp(-drag * travelled);
      const staticLoss = currentSpeed < 1.15 ? Math.max(0, 1 - LOW_SPEED_DRAG * surface) : 1;
      const nextSpeed = currentSpeed * distanceLoss * staticLoss;
      if (nextSpeed < 0.025) {
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
      } else {
        const dir = normalize(velocityPoint(body));
        Matter.Body.setVelocity(body, { x: dir.x * nextSpeed, y: dir.y * nextSpeed });
      }
    }

    const updatedSpeed = length(velocityPoint(body));
    if (onIce && updatedSpeed > 0.18) {
      const dir = normalize(velocityPoint(body));
      const capped = Math.min(updatedSpeed * ICE_SLIDE_BOOST, 23);
      Matter.Body.setVelocity(body, { x: dir.x * capped, y: dir.y * capped });
    }

    const spin = body.angularVelocity;
    if (Math.abs(spin) > 0.0008) {
      const speedAfterSurface = length(velocityPoint(body));
      if (speedAfterSurface > 0.04) {
        const dir = normalize(velocityPoint(body));
        const side = { x: -dir.y, y: dir.x };
        const drift = (spin * SPIN_DRIFT) / Math.sqrt(eggMass(egg));
        applyVelocity(body, { x: side.x * drift, y: side.y * drift });
      }
      Matter.Body.setAngularVelocity(body, spin * Math.pow(SPIN_DECAY, surface));
    }
  }

  let finalStep = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    finalStep = step + 1;
    Matter.Engine.update(engine, STEP_MS);

    for (const [id, body] of bodies) {
      if (removed.has(id)) continue;
      const egg = state.eggs.find((candidate) => candidate.id === id);
      if (!egg) continue;

      applyRollingPhysics(id, body, egg);
      lastKnownPositions.set(id, { x: body.position.x, y: body.position.y });

      for (const terrain of state.terrain) {
        const gap = distance(body.position, terrain);
        if (terrain.kind === "pit" && gap < terrain.r + eggRadius(egg) * 0.34) {
          removeBody(id);
        }
      }

      for (const gimmick of state.gimmicks) {
        const gap = distance(body.position, gimmick);
        if (gap < gimmick.r + eggRadius(egg) * 0.58) {
          triggerGimmick(gimmick, body);
        }
      }

      const centerDistance = length(body.position);
      const fallLimit = BOARD_RADIUS - eggRadius(egg) * 0.9;
      if (centerDistance > fallLimit) {
        if (egg.skill === "guard" && !egg.used) {
          const dir = normalize(body.position);
          markEggUsed(state, id);
          activatedSkillIds.add(id);
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
    if (step % MOTION_FRAME_INTERVAL === 0 || frameImpactIds.size > 0) {
      captureMotionFrame(finalStep);
    }
    if (quietFrames > 28) break;
  }
  captureMotionFrame(finalStep, true);

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

  return {
    fallenIds: [...removed],
    triggeredGimmickIds: [...triggeredGimmicks],
    activatedSkillIds: [...activatedSkillIds],
    impactIds: [...impactIds],
    motionFrames
  };
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

  const shotResult = settleShot(next, shotEgg, payload.vector);
  next.lastShot = {
    playerId: player.id,
    eggId: shotEgg.id,
    vector: { x: round(payload.vector.x), y: round(payload.vector.y) },
    fallenIds: shotResult.fallenIds,
    triggeredGimmickIds: shotResult.triggeredGimmickIds,
    activatedSkillIds: shotResult.activatedSkillIds,
    impactIds: shotResult.impactIds,
    motionFrames: shotResult.motionFrames
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

function timeoutTurn(state: AlkkagiState, context: GameContext): GameActionResult {
  const player = requireActivePlayer(state, context);
  const next = cloneState(state);
  const turn = nextTurn(next, context);
  const nextPlayerName = next.players.find((candidate) => candidate.id === turn.activePlayerId)?.name ?? "다음 플레이어";
  next.activePlayerId = turn.activePlayerId;
  next.message = `${player.name}님 시간 초과. ${nextPlayerName}님 차례입니다.`;
  next.lastShot = null;

  return {
    state: next,
    log: `${player.name} 시간 초과`,
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
    if (action.type === "alkkagi/flick") {
      return flickEgg(currentState, action, context);
    }
    if (action.type === "alkkagi/timeout" || action.type === "system/timeout") {
      return timeoutTurn(currentState, context);
    }
    throw new Error("지원하지 않는 알까기 행동입니다.");
  },
  applySystemAction: (state, action, context) => {
    const currentState = assertState(state);
    if (action.type === "system/timeout") {
      return timeoutTurn(currentState, context);
    }
    throw new Error("지원하지 않는 알까기 시스템 행동입니다.");
  }
};

function skillClass(skill?: SkillKind) {
  return skill ? `skill-${skill}` : "";
}

function skillLabel(skill?: SkillKind) {
  if (skill === "dash") return "질주";
  if (skill === "anchor") return "중량";
  if (skill === "burst") return "폭발";
  if (skill === "guard") return "방어";
  if (skill === "rubber") return "탄성";
  return "특수";
}

function skillMark(skill?: SkillKind) {
  if (skill === "dash") {
    return (
      <>
        <path d="M-10 7 L-2 -9 L-2 -1 L9 -7 L0 10 L0 2 Z" />
        <path className="alk-skill-mark-cut" d="M-14 -5 H-7 M-16 2 H-9" />
      </>
    );
  }
  if (skill === "anchor") {
    return (
      <>
        <circle cx="0" cy="-1" r="5.5" />
        <path d="M0 4 V12 M-9 7 Q-6 13 0 13 Q6 13 9 7" />
      </>
    );
  }
  if (skill === "burst") {
    return <path d="M0 -12 L3 -3 L12 0 L3 3 L0 12 L-3 3 L-12 0 L-3 -3 Z" />;
  }
  if (skill === "guard") {
    return <path d="M0 -12 Q10 -7 9 3 Q5 10 0 13 Q-5 10 -9 3 Q-10 -7 0 -12 Z" />;
  }
  if (skill === "rubber") {
    return (
      <>
        <path d="M-11 0 C-8 -11 8 -11 11 0 C8 11 -8 11 -11 0 Z" />
        <path className="alk-skill-mark-cut" d="M-5 -5 C-1 -8 4 -7 6 -3" />
      </>
    );
  }
  return null;
}

function skillAura(skill?: SkillKind, radius = 21) {
  if (!skill) return null;
  const outer = radius + 7;
  if (skill === "dash") {
    return (
      <>
        <circle className="alk-skill-aura-ring" cx="0" cy="0" r={outer} />
        <path className="alk-speed-streak streak-a" d={`M${-outer - 10} -10 H${-outer + 1}`} />
        <path className="alk-speed-streak streak-b" d={`M${-outer - 14} 0 H${-outer + 3}`} />
        <path className="alk-speed-streak streak-c" d={`M${-outer - 9} 10 H${-outer + 2}`} />
      </>
    );
  }
  if (skill === "anchor") {
    return (
      <>
        <circle className="alk-skill-aura-ring" cx="0" cy="0" r={outer} />
        <path className="alk-anchor-weight" d={`M${-outer * 0.72} ${outer * 0.72} Q0 ${outer + 5} ${outer * 0.72} ${outer * 0.72}`} />
        <path className="alk-anchor-weight" d={`M${-outer * 0.68} ${-outer * 0.68} L${outer * 0.68} ${outer * 0.68}`} />
      </>
    );
  }
  if (skill === "burst") {
    return (
      <>
        <circle className="alk-skill-aura-ring alk-burst-ring" cx="0" cy="0" r={outer} />
        <path className="alk-burst-ray" d={`M0 ${-outer - 6} V${-outer + 4} M0 ${outer - 4} V${outer + 6} M${-outer - 6} 0 H${-outer + 4} M${outer - 4} 0 H${outer + 6}`} />
        <path className="alk-burst-ray diagonal" d={`M${-outer * 0.72} ${-outer * 0.72} L${-outer * 0.52} ${-outer * 0.52} M${outer * 0.72} ${-outer * 0.72} L${outer * 0.52} ${-outer * 0.52} M${-outer * 0.72} ${outer * 0.72} L${-outer * 0.52} ${outer * 0.52} M${outer * 0.72} ${outer * 0.72} L${outer * 0.52} ${outer * 0.52}`} />
      </>
    );
  }
  if (skill === "guard") {
    return (
      <>
        <path className="alk-guard-shield" d={`M0 ${-outer - 3} Q${outer + 7} ${-outer * 0.52} ${outer * 0.78} ${outer * 0.45} Q${outer * 0.35} ${outer + 7} 0 ${outer + 10} Q${-outer * 0.35} ${outer + 7} ${-outer * 0.78} ${outer * 0.45} Q${-outer - 7} ${-outer * 0.52} 0 ${-outer - 3} Z`} />
        <path className="alk-guard-glint" d={`M${-outer * 0.52} ${-outer * 0.2} Q0 ${-outer * 0.62} ${outer * 0.52} ${-outer * 0.2}`} />
      </>
    );
  }
  if (skill === "rubber") {
    return (
      <>
        <ellipse className="alk-rubber-ring outer" cx="0" cy="0" rx={outer + 3} ry={outer - 4} />
        <ellipse className="alk-rubber-ring inner" cx="0" cy="0" rx={outer - 4} ry={outer + 2} />
      </>
    );
  }
  return null;
}

function terrainLabel(kind: TerrainKind) {
  if (kind === "pit") return "중앙 구멍";
  if (kind === "mud") return "끈적 지형";
  if (kind === "ice") return "미끄럼 지형";
  return "범퍼";
}

function gimmickLabel(kind: GimmickKind) {
  return kind === "button" ? "압력 버튼" : "킥 레버";
}

function TerrainInlay({ terrain }: { terrain: Terrain }) {
  const r = terrain.r;
  if (terrain.kind === "pit") {
    return (
      <>
        <circle className="alk-terrain-inlay-base" cx="0" cy="0" r={r * 1.02} />
        <circle className="alk-terrain-inlay-rim" cx="0" cy="0" r={r * 0.86} />
        <circle className="alk-terrain-pit-well" cx="0" cy="0" r={r * 0.58} />
        <circle className="alk-terrain-pit-depth" cx="0" cy="0" r={r * 0.38} />
        <circle className="alk-terrain-pit-glint" cx={-r * 0.18} cy={-r * 0.18} r={r * 0.08} />
      </>
    );
  }

  if (terrain.kind === "mud") {
    return (
      <>
        <ellipse className="alk-terrain-inlay-base" cx="0" cy="0" rx={r * 1.04} ry={r * 0.7} />
        <ellipse className="alk-terrain-inlay-rim" cx="0" cy="0" rx={r * 0.84} ry={r * 0.52} />
        <path className="alk-terrain-mud-line" d={`M${-r * 0.62} ${-r * 0.14} Q${-r * 0.25} ${-r * 0.34} ${r * 0.1} ${-r * 0.12} T${r * 0.62} ${-r * 0.1}`} />
        <path className="alk-terrain-mud-line soft" d={`M${-r * 0.58} ${r * 0.12} Q${-r * 0.12} ${r * 0.34} ${r * 0.48} ${r * 0.08}`} />
      </>
    );
  }

  if (terrain.kind === "ice") {
    return (
      <>
        <path className="alk-terrain-inlay-base ice" d={`M0 ${-r * 0.94} L${r * 0.62} ${-r * 0.62} L${r * 0.92} 0 L${r * 0.62} ${r * 0.62} L0 ${r * 0.94} L${-r * 0.62} ${r * 0.62} L${-r * 0.92} 0 L${-r * 0.62} ${-r * 0.62} Z`} />
        <path className="alk-terrain-inlay-rim ice" d={`M0 ${-r * 0.72} L${r * 0.48} ${-r * 0.48} L${r * 0.7} 0 L${r * 0.48} ${r * 0.48} L0 ${r * 0.72} L${-r * 0.48} ${r * 0.48} L${-r * 0.7} 0 L${-r * 0.48} ${-r * 0.48} Z`} />
        <path className="alk-terrain-ice-cut" d={`M${-r * 0.42} ${-r * 0.08} L${-r * 0.1} ${r * 0.08} L${r * 0.28} ${-r * 0.24}`} />
        <path className="alk-terrain-ice-cut soft" d={`M${-r * 0.12} ${r * 0.38} L${r * 0.18} ${r * 0.1} L${r * 0.5} ${r * 0.22}`} />
      </>
    );
  }

  return (
    <>
      <circle className="alk-terrain-inlay-base bumper" cx="0" cy="0" r={r * 0.9} />
      <circle className="alk-terrain-inlay-rim bumper" cx="0" cy="0" r={r * 0.66} />
      <circle className="alk-terrain-bumper-post" cx="0" cy="0" r={r * 0.42} />
      <ellipse className="alk-terrain-bumper-glint" cx={-r * 0.12} cy={-r * 0.18} rx={r * 0.18} ry={r * 0.09} />
    </>
  );
}

function GimmickInlay({ gimmick }: { gimmick: ArenaGimmick }) {
  const r = gimmick.r;
  if (gimmick.kind === "lever") {
    return (
      <>
        <rect className="alk-gimmick-inlay-base lever" x={-r * 2} y={-r * 0.56} width={r * 4} height={r * 1.12} rx={r * 0.24} />
        <rect className="alk-gimmick-slot" x={-r * 1.52} y={-r * 0.18} width={r * 2.42} height={r * 0.36} rx={r * 0.12} />
        <line className="alk-gimmick-lever-bar" x1={-r * 0.86} y1={0} x2={r * 1.14} y2={-r * 0.28} />
        <circle className="alk-gimmick-hub" cx={-r * 1.1} cy="0" r={r * 0.34} />
        <circle className="alk-gimmick-knob" cx={r * 1.18} cy={-r * 0.3} r={r * 0.24} />
      </>
    );
  }

  return (
    <>
      <circle className="alk-gimmick-inlay-base button" cx="0" cy="0" r={r * 1.08} />
      <circle className="alk-gimmick-button-ring" cx="0" cy="0" r={r * 0.78} />
      <circle className="alk-gimmick-button-core" cx="0" cy="0" r={r * 0.45} />
      <ellipse className="alk-gimmick-button-glint" cx={-r * 0.16} cy={-r * 0.2} rx={r * 0.18} ry={r * 0.09} />
    </>
  );
}

export function Component({
  currentPlayer,
  activePlayer,
  publicState,
  disabled,
  onAction
}: GameComponentProps<AlkkagiState>) {
  const state = assertState(publicState);
  const arena = arenaById(state.arena.id);
  const holdOriginRef = useRef({ angle: 0, power: MIN_POWER_RATIO, start: 0 });
  const turnKeyRef = useRef<string | null>(null);
  const timeoutSentTurnRef = useRef<string | null>(null);
  const [control, setControl] = useState<AimControlState>(() => idleAimControl());
  const [hold, setHold] = useState<HoldMode | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastShot = state.lastShot;
  const motionFrames = lastShot?.motionFrames ?? [];
  const motionKey = lastShot ? `${lastShot.playerId}:${lastShot.eggId}:${lastShot.vector.x}:${lastShot.vector.y}:${lastShot.fallenIds.join("|")}:${motionFrames.length}` : "none";
  const [motionFrameIndex, setMotionFrameIndex] = useState<number | null>(null);
  const currentMotionFrame = motionFrameIndex !== null ? motionFrames[motionFrameIndex] : null;
  const isReplayingShot = motionFrameIndex !== null && motionFrames.length > 1;
  const canOwnTurn = !disabled && currentPlayer?.id === state.activePlayerId && state.phase === "playing";
  const canAct = canOwnTurn && !isReplayingShot;
  const activeEggs = state.eggs.filter((egg) => egg.alive);
  const motionEggMap = new Map<string, ShotMotionEggFrame>((currentMotionFrame?.eggs ?? []).map((egg) => [egg.id, egg]));
  const visibleEggs = currentMotionFrame ? state.eggs.filter((egg) => egg.alive || motionEggMap.has(egg.id)) : activeEggs;
  const selectedEgg = control.eggId ? activeEggs.find((egg) => egg.id === control.eggId) ?? null : null;
  const selectedOwner = selectedEgg ? state.players.find((player) => player.id === selectedEgg.ownerId) : null;
  const aimCap = selectedEgg?.kind === "king" ? 76 : MAX_VECTOR;
  const previewPower = control.phase === "power" ? Math.max(control.power, MIN_POWER_RATIO) : DEFAULT_AIM_POWER;
  const aimSize = selectedEgg && control.phase !== "idle" ? Math.max(8, aimCap * previewPower) : 0;
  const aimDirection = { x: Math.cos(control.angle), y: Math.sin(control.angle) };
  const remainingSeconds = control.deadline > 0 ? Math.max(0, Math.ceil((control.deadline - now) / 1000)) : 0;
  const turnTimeLabel = control.deadline > 0 ? `${remainingSeconds}초` : "10초";
  const powerPercent = Math.round(Math.max(control.power, MIN_POWER_RATIO) * 100);
  const controlLabel = control.phase === "idle" ? "알 선택" : control.phase === "direction" ? "방향 선택" : "힘 선택";
  const currentTurnKey = `${state.activePlayerId ?? "none"}:${motionKey}:${state.message}`;

  useEffect(() => {
    const frames = state.lastShot?.motionFrames ?? [];
    if (frames.length < 2) {
      setMotionFrameIndex(null);
      return;
    }

    let frame = 0;
    let releaseTimer = 0;
    const startedAt = performance.now();
    const finalTime = frames[frames.length - 1]?.time ?? frames.length * STEP_MS;
    const duration = clamp(finalTime * 1.35, SHOT_REPLAY_MIN_MS, SHOT_REPLAY_MAX_MS);
    setMotionFrameIndex(0);

    const tick = (timestamp: number) => {
      const progress = clamp((timestamp - startedAt) / duration, 0, 1);
      const nextFrame = Math.min(frames.length - 1, Math.floor(progress * (frames.length - 1)));
      setMotionFrameIndex(nextFrame);
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        releaseTimer = window.setTimeout(() => setMotionFrameIndex(null), 120);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(releaseTimer);
    };
  }, [motionKey]);

  useEffect(() => {
    if (canOwnTurn) return;
    turnKeyRef.current = null;
    timeoutSentTurnRef.current = null;
    setHold(null);
    setControl(idleAimControl());
  }, [canOwnTurn, state.activePlayerId]);

  useEffect(() => {
    if (!canAct) return;
    if (turnKeyRef.current === currentTurnKey) return;
    const deadline = nextAimDeadline();
    turnKeyRef.current = currentTurnKey;
    timeoutSentTurnRef.current = null;
    setNow(Date.now());
    setHold(null);
    setControl(idleAimControl(deadline));
  }, [canAct, currentTurnKey]);

  useEffect(() => {
    if (!hold) return;

    let frame = 0;
    const tick = (timestamp: number) => {
      const origin = holdOriginRef.current;
      const elapsed = timestamp - origin.start;
      setControl((current) => {
        if (current.phase !== hold) return current;
        if (hold === "direction") {
          return {
            ...current,
            angle: normalizeAngle(origin.angle + (elapsed / DIRECTION_CYCLE_MS) * Math.PI * 2)
          };
        }

        const cycle = (elapsed % POWER_CYCLE_MS) / POWER_CYCLE_MS;
        const wave = cycle <= 0.5 ? cycle * 2 : (1 - cycle) * 2;
        return {
          ...current,
          power: MIN_POWER_RATIO + wave * (1 - MIN_POWER_RATIO)
        };
      });
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [hold]);

  useEffect(() => {
    if (!canAct || control.deadline <= 0) return;

    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [canAct, control.deadline]);

  useEffect(() => {
    if (!canAct || control.deadline <= 0 || now < control.deadline) return;
    if (timeoutSentTurnRef.current === currentTurnKey) return;
    timeoutSentTurnRef.current = currentTurnKey;
    setHold(null);
    setControl(idleAimControl());
    onAction({ type: "alkkagi/timeout" });
  }, [canAct, control.deadline, currentTurnKey, now, onAction]);

  useEffect(() => {
    const selectedAlive = !control.eggId || state.eggs.some((egg) => egg.id === control.eggId && egg.alive);
    if (canAct && control.eggId && !selectedAlive) {
      setHold(null);
      setControl(idleAimControl(control.deadline));
    }
  }, [canAct, control.deadline, control.eggId, state.eggs]);

  function resetControl(deadline = 0) {
    setHold(null);
    setControl(idleAimControl(deadline));
  }

  function chooseEgg(egg: AlkkagiEgg) {
    if (!canAct || egg.ownerId !== currentPlayer?.id) return;
    setHold(null);
    setNow(Date.now());
    setControl({
      phase: "direction",
      eggId: egg.id,
      angle: normalizeAngle(Math.atan2(-egg.y, -egg.x)),
      power: MIN_POWER_RATIO,
      deadline: control.deadline || nextAimDeadline()
    });
  }

  function chooseEggByPointer(event: PointerEvent<SVGGElement>, egg: AlkkagiEgg) {
    event.preventDefault();
    event.stopPropagation();
    chooseEgg(egg);
  }

  function chooseEggByKey(event: KeyboardEvent<SVGGElement>, egg: AlkkagiEgg) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    chooseEgg(egg);
  }

  function startHold(event: PointerEvent<HTMLButtonElement>, mode: HoldMode) {
    event.preventDefault();
    if (control.phase !== mode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    holdOriginRef.current = { angle: control.angle, power: control.power, start: performance.now() };
    setHold(mode);
  }

  function startHoldByKey(event: KeyboardEvent<HTMLButtonElement>, mode: HoldMode) {
    if ((event.key !== " " && event.key !== "Enter") || event.repeat || control.phase !== mode) return;
    event.preventDefault();
    holdOriginRef.current = { angle: control.angle, power: control.power, start: performance.now() };
    setHold(mode);
  }

  function endHoldByKey(event: KeyboardEvent<HTMLButtonElement>, mode: HoldMode) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    finishHold(mode);
  }

  function finishHold(mode: HoldMode) {
    if (control.phase !== mode) return;
    setHold(null);
    if (mode === "direction") {
      setNow(Date.now());
      setControl((current) =>
        current.phase === "direction"
          ? {
              ...current,
              phase: "power",
              power: MIN_POWER_RATIO
            }
          : current
      );
      return;
    }

    fireSelectedEgg();
  }

  function fireSelectedEgg() {
    if (!selectedEgg || control.phase !== "power") {
      resetControl();
      return;
    }

    const cappedPower = Math.max(control.power, MIN_POWER_RATIO);
    const size = Math.max(8, aimCap * cappedPower);
    onAction({
      type: "alkkagi/flick",
      payload: {
        eggId: selectedEgg.id,
        vector: {
          x: Math.cos(control.angle) * size,
          y: Math.sin(control.angle) * size
        }
      }
    });
    resetControl();
  }

  function cancelHold(mode: HoldMode) {
    if (hold === mode) {
      setHold(null);
    }
  }

  return (
    <div className={`game-module alk-shell ${arena.className}`}>
      <section className="alk-status" aria-label="알까기 진행 상태">
        <strong>차례</strong>
        <span>{activePlayer?.name ?? "종료"}</span>
        <em>{arena.name}</em>
      </section>

      <svg
        className="alk-board"
        viewBox={`${-VIEW_SIZE / 2} ${-VIEW_SIZE / 2} ${VIEW_SIZE} ${VIEW_SIZE}`}
        role="application"
        aria-label="다인전 알까기 원형판"
      >
        <defs>
          <pattern
            id="alk-board-texture"
            patternUnits="userSpaceOnUse"
            x={-BOARD_RADIUS}
            y={-BOARD_RADIUS}
            width={BOARD_RADIUS * 2}
            height={BOARD_RADIUS * 2}
          >
            <image
              href="/board-assets/textures/alkkagi-board-wood.webp"
              x={0}
              y={0}
              width={BOARD_RADIUS * 2}
              height={BOARD_RADIUS * 2}
              preserveAspectRatio="xMidYMid slice"
            />
          </pattern>
          <radialGradient id="alk-board-grain" cx="38%" cy="28%" r="70%">
            <stop className="alk-grain-top" offset="0%" stopColor="var(--alk-grain-top)" />
            <stop className="alk-grain-mid" offset="58%" stopColor="var(--alk-grain-mid)" />
            <stop className="alk-grain-end" offset="100%" stopColor="var(--alk-grain-end)" />
          </radialGradient>
          <filter id="alk-soft-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#160b04" floodOpacity="0.42" />
          </filter>
        </defs>
        <circle className="alk-table-rim" cx="0" cy="0" r={BOARD_RADIUS + 24} />
        <circle className="alk-table" cx="0" cy="0" r={BOARD_RADIUS} />
        <circle className="alk-table-inner" cx="0" cy="0" r={BOARD_RADIUS - 18} />
        <circle className="alk-table-playline" cx="0" cy="0" r={BOARD_RADIUS - 60} />
        <circle className="alk-table-dangerline" cx="0" cy="0" r={BOARD_RADIUS - 14} />

        {state.players.map((player, playerIndex) => {
          const angle = -90 + (360 * playerIndex) / Math.max(1, state.players.length);
          return (
            <g
              className="alk-home-zone"
              key={player.id}
              style={{ "--player-color": player.color } as CSSProperties}
              transform={`rotate(${angle})`}
            >
              <path d={`M-112 ${-BOARD_RADIUS + 86} Q0 ${-BOARD_RADIUS + 34} 112 ${-BOARD_RADIUS + 86} L78 ${-BOARD_RADIUS + 138} Q0 ${-BOARD_RADIUS + 112} -78 ${-BOARD_RADIUS + 138} Z`} />
              <circle cx="0" cy={-BOARD_RADIUS + 92} r="5" />
            </g>
          );
        })}

        {state.terrain.map((terrain) => {
          const angle = hashString(terrain.id) % 180;
          return (
            <g className={`alk-terrain ${terrain.kind}`} key={terrain.id} transform={`translate(${terrain.x} ${terrain.y}) rotate(${angle})`} aria-label={terrainLabel(terrain.kind)}>
              <circle className="alk-terrain-hit-area" cx="0" cy="0" r={terrain.r} />
              <TerrainInlay terrain={terrain} />
            </g>
          );
        })}

        {state.gimmicks.map((gimmick) => {
          const triggered = state.lastShot?.triggeredGimmickIds?.includes(gimmick.id);
          const angle = gimmick.angle ?? 0;
          return (
            <g
              className={`alk-gimmick ${gimmick.kind} ${triggered ? "triggered" : ""}`}
              key={gimmick.id}
              transform={`translate(${gimmick.x} ${gimmick.y}) rotate(${angle})`}
              aria-label={gimmickLabel(gimmick.kind)}
            >
              <GimmickInlay gimmick={gimmick} />
            </g>
          );
        })}

        {selectedEgg && control.phase !== "idle" ? (
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

        {visibleEggs.map((egg) => {
          const owner = state.players.find((player) => player.id === egg.ownerId);
          const motionEgg = motionEggMap.get(egg.id);
          const isCurrent = egg.ownerId === currentPlayer?.id && canAct;
          const isSelected = egg.id === selectedEgg?.id;
          const isLastShot = egg.id === state.lastShot?.eggId;
          const isSkillActivated = state.lastShot?.activatedSkillIds?.includes(egg.id) ?? false;
          const isImpacting = currentMotionFrame?.impactIds.includes(egg.id) ?? false;
          const isMoving = (motionEgg?.speed ?? 0) > 0.16;
          const isFalling = motionEgg ? !motionEgg.alive : false;
          const radius = eggRadius(egg);
          const x = motionEgg?.x ?? egg.x;
          const y = motionEgg?.y ?? egg.y;
          return (
            <g
              key={egg.id}
              className={`alk-egg ${egg.kind} ${skillClass(egg.skill)} ${isCurrent ? "is-current" : ""} ${isSelected ? "is-selected" : ""} ${isLastShot ? "last-shot" : ""} ${isSkillActivated ? "skill-activated" : ""} ${isMoving ? "is-moving" : ""} ${isImpacting ? "is-impact" : ""} ${isFalling ? "is-falling" : ""} ${egg.used ? "is-spent" : ""}`}
              style={{ "--player-color": owner?.color ?? "#d94f45" } as CSSProperties}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={isCurrent ? 0 : -1}
              aria-label={`${owner?.name ?? "플레이어"} ${egg.kind === "king" ? "왕알" : egg.skill ? `${skillLabel(egg.skill)} 특수 알` : "알"}`}
              onPointerDown={(event) => chooseEggByPointer(event, egg)}
              onKeyDown={(event) => chooseEggByKey(event, egg)}
            >
              <circle className="alk-egg-shadow" cx="0" cy="4" r={radius} />
              {egg.kind === "skill" ? <g className="alk-skill-aura" aria-hidden="true">{skillAura(egg.skill, radius)}</g> : null}
              <circle className="alk-egg-body" cx="0" cy="0" r={radius} />
              <circle className="alk-egg-bevel" cx="0" cy="0" r={Math.max(4, radius - 4)} />
              <ellipse className="alk-egg-glint" cx={-radius * 0.28} cy={-radius * 0.34} rx={radius * 0.3} ry={radius * 0.16} />
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

      {canAct ? (
        <section className={`alk-control-dock phase-${control.phase}`} aria-label="알까기 조작판">
          <div className="alk-control-steps" aria-hidden="true">
            <span className={control.phase === "idle" ? "active" : "done"}>알</span>
            <span className={control.phase === "direction" ? "active" : control.phase === "power" ? "done" : ""}>방향</span>
            <span className={control.phase === "power" ? "active" : ""}>힘</span>
          </div>

          <div className="alk-control-readout">
            <strong>{controlLabel}</strong>
            <span>{selectedEgg ? `${selectedOwner?.name ?? "내 알"} · ${turnTimeLabel}` : `${turnTimeLabel} 안에 알 선택`}</span>
          </div>

          <div className="alk-control-tools">
            <div className="alk-direction-dial" aria-hidden="true">
              <i style={{ transform: `translate(-50%, -50%) rotate(${control.angle}rad)` }} />
            </div>
            <div className="alk-power-meter" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.max(control.power, MIN_POWER_RATIO)})` }} />
            </div>
          </div>

          <div className="alk-control-buttons">
            <button
              type="button"
              className={`alk-hold-control direction ${control.phase === "direction" ? "is-live" : ""} ${hold === "direction" ? "is-holding" : ""}`}
              disabled={control.phase !== "direction"}
              aria-pressed={hold === "direction"}
              onPointerDown={(event) => startHold(event, "direction")}
              onPointerUp={() => finishHold("direction")}
              onPointerCancel={() => cancelHold("direction")}
              onKeyDown={(event) => startHoldByKey(event, "direction")}
              onKeyUp={(event) => endHoldByKey(event, "direction")}
            >
              <span>방향</span>
              <small>{hold === "direction" ? "회전" : "길게"}</small>
            </button>
            <button
              type="button"
              className={`alk-hold-control power ${control.phase === "power" ? "is-live" : ""} ${hold === "power" ? "is-holding" : ""}`}
              disabled={control.phase !== "power"}
              aria-pressed={hold === "power"}
              onPointerDown={(event) => startHold(event, "power")}
              onPointerUp={() => finishHold("power")}
              onPointerCancel={() => cancelHold("power")}
              onKeyDown={(event) => startHoldByKey(event, "power")}
              onKeyUp={(event) => endHoldByKey(event, "power")}
            >
              <span>힘</span>
              <small>{hold === "power" ? `${powerPercent}%` : "길게"}</small>
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

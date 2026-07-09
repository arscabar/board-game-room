import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useInteractionGate } from "../useInteractionGate";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const DRAWING_MS = 150_000;
const CANVAS_WIDTH = 420;
const CANVAS_HEIGHT = 300;
const MAX_IMAGE_LENGTH = 520_000;

type PaintingPhase = "drawing" | "scanning" | "complete";

interface DrawingAnalysis {
  hue: number;
  saturation: number;
  lightness: number;
  coverage: number;
  balanceX: number;
  balanceY: number;
  stroke: number;
}

interface ScoreBreakdown {
  color: number;
  light: number;
  coverage: number;
  composition: number;
  effort: number;
}

interface PaintingReference {
  id: string;
  title: string;
  subtitle: string;
  palette: string[];
  target: DrawingAnalysis;
}

interface PaintingPlayer {
  id: string;
  name: string;
  seat: number;
}

interface PaintingSubmission {
  playerId: string;
  imageData: string | null;
  submittedAt: number;
  score: number;
  breakdown: ScoreBreakdown;
  analysis: DrawingAnalysis;
}

interface PaintingRanking {
  playerId: string;
  score: number;
  rank: number;
  breakdown: ScoreBreakdown;
}

interface PaintingState {
  phase: PaintingPhase;
  activePlayerId: null;
  referenceId: string;
  startedAt: number;
  deadlineAt: number;
  players: PaintingPlayer[];
  submissions: Record<string, PaintingSubmission>;
  rankings: PaintingRanking[];
  winnerIds: string[];
  message: string;
}

const references: PaintingReference[] = [
  {
    id: "starry-room",
    title: "별빛 소용돌이",
    subtitle: "푸른 밤, 노란 별, 굽이치는 하늘",
    palette: ["#153a69", "#1f6596", "#f5ca4d", "#f8ead0", "#274b2c"],
    target: { hue: 0.58, saturation: 0.64, lightness: 0.48, coverage: 0.5, balanceX: 0.49, balanceY: 0.43, stroke: 0.72 }
  },
  {
    id: "sunflower-vase",
    title: "노란 꽃병",
    subtitle: "황금빛 꽃과 짧은 붓질",
    palette: ["#f3c84e", "#d28a2f", "#6f8a3d", "#f7e1a2", "#5e3a1f"],
    target: { hue: 0.16, saturation: 0.68, lightness: 0.56, coverage: 0.44, balanceX: 0.5, balanceY: 0.49, stroke: 0.66 }
  },
  {
    id: "blue-chair",
    title: "푸른 의자",
    subtitle: "단순한 사물, 강한 윤곽, 따뜻한 바닥",
    palette: ["#2e6f91", "#8c6237", "#efc46f", "#f8edd2", "#233a46"],
    target: { hue: 0.36, saturation: 0.48, lightness: 0.5, coverage: 0.36, balanceX: 0.52, balanceY: 0.57, stroke: 0.5 }
  },
  {
    id: "iris-field",
    title: "보랏빛 붓꽃",
    subtitle: "보라 꽃잎, 초록 잎, 밝은 정원",
    palette: ["#5b3f9c", "#8361c7", "#2f7448", "#d9c45f", "#f5dfb4"],
    target: { hue: 0.72, saturation: 0.58, lightness: 0.5, coverage: 0.48, balanceX: 0.5, balanceY: 0.54, stroke: 0.68 }
  },
  {
    id: "almond-branch",
    title: "꽃핀 가지",
    subtitle: "하늘색 배경과 흰 꽃잎, 굽은 가지",
    palette: ["#6fb5c9", "#f7f1df", "#d8a38d", "#5b3b2a", "#8ed0df"],
    target: { hue: 0.54, saturation: 0.42, lightness: 0.66, coverage: 0.34, balanceX: 0.47, balanceY: 0.42, stroke: 0.48 }
  }
];

const brushColors = ["#17263c", "#f2c84b", "#2f6d93", "#7a4a24", "#e36d3d", "#f8f0dc", "#1f6f4a", "#6e3fa6"];
const brushSizes = [4, 8, 13, 19];

function assertState(state: unknown): PaintingState {
  if (!state || typeof state !== "object") {
    throw new Error("그림 게임 상태가 올바르지 않습니다.");
  }
  return state as PaintingState;
}

function clamp01(value: unknown, fallback = 0) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeAnalysis(value: unknown): DrawingAnalysis {
  const record = value && typeof value === "object" ? (value as Partial<DrawingAnalysis>) : {};
  return {
    hue: clamp01(record.hue),
    saturation: clamp01(record.saturation),
    lightness: clamp01(record.lightness, 0.5),
    coverage: clamp01(record.coverage),
    balanceX: clamp01(record.balanceX, 0.5),
    balanceY: clamp01(record.balanceY, 0.5),
    stroke: clamp01(record.stroke)
  };
}

function hueDistance(a: number, b: number) {
  const direct = Math.abs(a - b);
  return Math.min(direct, 1 - direct);
}

function scoreAnalysis(analysis: DrawingAnalysis, target: DrawingAnalysis) {
  const color = Math.max(0, 1 - (hueDistance(analysis.hue, target.hue) * 2.2 + Math.abs(analysis.saturation - target.saturation) * 0.9));
  const light = Math.max(0, 1 - Math.abs(analysis.lightness - target.lightness) * 1.9);
  const coverage = Math.max(0, 1 - Math.abs(analysis.coverage - target.coverage) * 2.4);
  const composition = Math.max(
    0,
    1 - (Math.abs(analysis.balanceX - target.balanceX) * 1.7 + Math.abs(analysis.balanceY - target.balanceY) * 1.7)
  );
  const effort = Math.max(0, Math.min(1, analysis.stroke * 0.65 + analysis.coverage * 0.55));
  const breakdown = {
    color: Math.round(color * 100),
    light: Math.round(light * 100),
    coverage: Math.round(coverage * 100),
    composition: Math.round(composition * 100),
    effort: Math.round(effort * 100)
  };
  const score = Math.round(color * 34 + light * 14 + coverage * 20 + composition * 22 + effort * 10);
  return { score: Math.max(0, Math.min(100, score)), breakdown };
}

function referenceFor(id: string) {
  return references.find((reference) => reference.id === id) ?? references[0];
}

function chooseReferenceId(players: PaintingPlayer[]) {
  const seed = players.flatMap((player) => [...player.id]).reduce((total, char) => total + char.charCodeAt(0), players.length * 17);
  return references[seed % references.length].id;
}

function playerName(state: PaintingState, playerId: string) {
  return state.players.find((player) => player.id === playerId)?.name ?? "플레이어";
}

function blankSubmission(playerId: string, now: number, target: DrawingAnalysis): PaintingSubmission {
  const analysis = normalizeAnalysis(null);
  const { score, breakdown } = scoreAnalysis(analysis, target);
  return { playerId, imageData: null, submittedAt: now, score, breakdown, analysis };
}

function rankingsFor(state: PaintingState) {
  const rankings = state.players
    .map((player) => state.submissions[player.id])
    .filter((submission): submission is PaintingSubmission => Boolean(submission))
    .sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt)
    .map((submission, index): PaintingRanking => ({
      playerId: submission.playerId,
      score: submission.score,
      rank: index + 1,
      breakdown: submission.breakdown
    }));
  return rankings;
}

function moveToScanning(state: PaintingState, now: number) {
  const next: PaintingState = {
    ...state,
    phase: "scanning",
    submissions: { ...state.submissions },
    winnerIds: [],
    message: "그림을 모두 펼치고 유사도를 스캔합니다."
  };
  const target = referenceFor(next.referenceId).target;
  next.players.forEach((player) => {
    if (!next.submissions[player.id]) {
      next.submissions[player.id] = blankSubmission(player.id, now, target);
    }
  });
  next.rankings = rankingsFor(next);
  return next;
}

function completeState(state: PaintingState) {
  const rankings = state.rankings.length > 0 ? state.rankings : rankingsFor(state);
  const topScore = rankings[0]?.score ?? 0;
  const winnerIds = rankings.filter((ranking) => ranking.score === topScore).map((ranking) => ranking.playerId);
  return {
    ...state,
    phase: "complete",
    rankings,
    winnerIds,
    message:
      winnerIds.length > 1
        ? `${winnerIds.map((id) => playerName(state, id)).join(", ")} 공동 1위입니다.`
        : `${playerName(state, winnerIds[0] ?? "")}님이 가장 비슷하게 그렸습니다.`
  } satisfies PaintingState;
}

function allPlayersSubmitted(state: PaintingState) {
  return state.players.every((player) => Boolean(state.submissions[player.id]));
}

function imageDataFromPayload(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  if (!value.startsWith("data:image/") || value.length > MAX_IMAGE_LENGTH) {
    return null;
  }
  return value;
}

function applySubmit(state: PaintingState, action: GameAction, context: GameContext): GameActionResult {
  if (state.phase !== "drawing") {
    return { state };
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("이 방의 그림 참가자가 아닙니다.");
  }
  if (state.submissions[player.id]) {
    return { state };
  }
  const payload = action.payload && typeof action.payload === "object" ? (action.payload as Record<string, unknown>) : {};
  const reference = referenceFor(state.referenceId);
  const analysis = normalizeAnalysis(payload.analysis);
  const { score, breakdown } = scoreAnalysis(analysis, reference.target);
  const now = Date.now();
  const imageData = imageDataFromPayload(payload.imageData);
  const next: PaintingState = {
    ...state,
    submissions: {
      ...state.submissions,
      [player.id]: {
        playerId: player.id,
        imageData,
        submittedAt: now,
        score,
        breakdown,
        analysis
      }
    },
    message: `${player.name}님이 그림을 제출했습니다.`
  };

  if (allPlayersSubmitted(next) || now >= next.deadlineAt) {
    const scanning = moveToScanning(next, now);
    return {
      state: scanning,
      phase: "scanning",
      activePlayerId: null,
      log: `${player.name} 제출, 스캔 시작`,
      message: scanning.message
    };
  }

  return {
    state: next,
    phase: "drawing",
    activePlayerId: null,
    log: `${player.name} 그림 제출`,
    message: next.message
  };
}

function createInitialState({ players }: Pick<GameContext, "players">): PaintingState {
  const seatedPlayers = players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 4)
    .map((player) => ({ id: player.id, name: player.name, seat: player.seat }));
  const now = Date.now();
  return {
    phase: "drawing",
    activePlayerId: null,
    referenceId: chooseReferenceId(seatedPlayers),
    startedAt: now,
    deadlineAt: now + DRAWING_MS,
    players: seatedPlayers,
    submissions: {},
    rankings: [],
    winnerIds: [],
    message: "원본을 보고 2분 30초 안에 따라 그리세요."
  };
}

function publicStateFor(state: PaintingState, viewerId: string | null): PaintingState {
  if (state.phase !== "drawing") {
    return state;
  }
  const submissions = Object.fromEntries(
    Object.entries(state.submissions).map(([playerId, submission]) => [
      playerId,
      {
        ...submission,
        imageData: playerId === viewerId ? submission.imageData : null
      }
    ])
  );
  return { ...state, submissions };
}

export const module: GameModule = {
  id: "masterpiece-copy",
  createInitialState,
  getPublicState: (state, context) => publicStateFor(assertState(state), context.viewerId),
  applyAction: (state, action, context) => {
    const current = assertState(state);
    if (action.type === "painting/submit") {
      return applySubmit(current, action, context);
    }
    if (action.type === "painting/force-scan") {
      if (current.phase !== "drawing") {
        return { state: current };
      }
      if (!allPlayersSubmitted(current) && Date.now() < current.deadlineAt) {
        throw new Error("아직 그리기 시간이 남아 있습니다.");
      }
      const scanning = moveToScanning(current, Date.now());
      return { state: scanning, phase: "scanning", activePlayerId: null, log: "유사도 스캔 시작", message: scanning.message };
    }
    if (action.type === "painting/complete") {
      if (current.phase === "complete") {
        return { state: current, phase: "complete", winnerIds: current.winnerIds, winnerId: current.winnerIds[0] ?? null };
      }
      if (current.phase !== "scanning") {
        throw new Error("스캔이 끝난 뒤 결과를 확정할 수 있습니다.");
      }
      const complete = completeState(current);
      return {
        state: complete,
        phase: "complete",
        activePlayerId: null,
        winnerId: complete.winnerIds[0] ?? null,
        winnerIds: complete.winnerIds,
        log: "명화 따라그리기 결과 확정",
        message: complete.message
      };
    }
    throw new Error("지원하지 않는 그림 게임 행동입니다.");
  }
};

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === rn) hue = (gn - bn) / delta + (gn < bn ? 6 : 0);
  if (max === gn) hue = (bn - rn) / delta + 2;
  if (max === bn) hue = (rn - gn) / delta + 4;
  return { hue: hue / 6, saturation, lightness };
}

function setupCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#fbefd6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function analyzeCanvas(canvas: HTMLCanvasElement | null, strokeCount: number): DrawingAnalysis {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) {
    return normalizeAnalysis(null);
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  let hue = 0;
  let saturation = 0;
  let lightness = 0;
  let xTotal = 0;
  let yTotal = 0;
  const step = 4;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const index = (y * canvas.width + x) * 4;
      const r = image.data[index];
      const g = image.data[index + 1];
      const b = image.data[index + 2];
      const distanceFromPaper = Math.abs(r - 251) + Math.abs(g - 239) + Math.abs(b - 214);
      if (distanceFromPaper < 48) {
        continue;
      }
      const hsl = rgbToHsl(r, g, b);
      hue += hsl.hue;
      saturation += hsl.saturation;
      lightness += hsl.lightness;
      xTotal += x / canvas.width;
      yTotal += y / canvas.height;
      ink += 1;
    }
  }
  const totalSamples = Math.ceil(canvas.width / step) * Math.ceil(canvas.height / step);
  if (ink === 0) {
    return normalizeAnalysis(null);
  }
  return {
    hue: hue / ink,
    saturation: saturation / ink,
    lightness: lightness / ink,
    coverage: Math.min(1, ink / totalSamples),
    balanceX: xTotal / ink,
    balanceY: yTotal / ink,
    stroke: Math.min(1, strokeCount / 90)
  };
}

function ReferenceArtwork({ reference }: { reference: PaintingReference }) {
  return (
    <svg className={`painting-reference-art ref-${reference.id}`} viewBox="0 0 420 300" role="img" aria-label={`${reference.title} 원본`}>
      <rect width="420" height="300" rx="20" fill="#f7dfac" />
      {reference.id === "starry-room" ? (
        <>
          <rect width="420" height="205" fill="#16365f" />
          <path d="M18 88C78 38 129 126 186 76s109-47 188 9" fill="none" stroke="#5aa4c7" strokeWidth="23" strokeLinecap="round" />
          <path d="M38 140c63-48 111 26 180-13 60-34 90-41 158-2" fill="none" stroke="#f5c94c" strokeWidth="12" strokeLinecap="round" />
          <circle cx="73" cy="62" r="18" fill="#f6cf54" />
          <circle cx="246" cy="46" r="14" fill="#f8dc73" />
          <circle cx="350" cy="77" r="16" fill="#f7d75b" />
          <path d="M0 211h420v89H0z" fill="#244b2d" />
          <path d="M40 244h100l42 56H8zM164 230h74l31 70h-126zM276 238h92l44 62H255z" fill="#111b18" opacity="0.72" />
        </>
      ) : reference.id === "sunflower-vase" ? (
        <>
          <rect width="420" height="300" fill="#efd48a" />
          <ellipse cx="207" cy="224" rx="82" ry="42" fill="#b66d2e" />
          <rect x="165" y="130" width="86" height="106" rx="34" fill="#df9b35" />
          {[88, 129, 180, 235, 285, 330].map((cx, index) => (
            <g key={cx} transform={`rotate(${index * 18} ${cx} 97)`}>
              <circle cx={cx} cy={97 + (index % 2) * 18} r="30" fill="#d9902f" />
              <circle cx={cx} cy={97 + (index % 2) * 18} r="16" fill="#59351e" />
              <path d={`M${cx - 43} ${92 + (index % 2) * 18}q43-58 86 0`} fill="none" stroke="#f4cc4d" strokeWidth="13" strokeLinecap="round" />
            </g>
          ))}
          <path d="M184 155c-20-42-35-62-70-71M213 154c7-58 20-82 72-99M236 157c33-42 54-52 86-44" stroke="#557733" strokeWidth="8" fill="none" />
        </>
      ) : reference.id === "blue-chair" ? (
        <>
          <rect width="420" height="184" fill="#2f708f" />
          <rect y="184" width="420" height="116" fill="#b7834d" />
          <path d="M139 100h144l-24 103H162z" fill="#d49d50" />
          <path d="M153 112h116l-18 76H169z" fill="#275a6d" />
          <path d="M145 202l-33 76M260 202l42 76M178 201l-4 76M234 201l8 76" stroke="#2a1a10" strokeWidth="15" strokeLinecap="round" />
          <path d="M99 245h232" stroke="#2a1a10" strokeWidth="18" strokeLinecap="round" />
        </>
      ) : reference.id === "iris-field" ? (
        <>
          <rect width="420" height="300" fill="#e8c978" />
          <rect y="155" width="420" height="145" fill="#406d3e" />
          <path d="M0 179c52-26 101 6 152-21 58-31 96 10 145-16 43-23 78-10 123 7v151H0z" fill="#31542f" />
          {[55, 91, 132, 183, 229, 278, 323, 365].map((cx, index) => (
            <g key={cx} transform={`rotate(${index % 2 === 0 ? -8 : 10} ${cx} 150)`}>
              <path d={`M${cx} 244C${cx - 22} 205 ${cx - 11} 167 ${cx} 130`} stroke="#2d5c3b" strokeWidth="9" fill="none" />
              <ellipse cx={cx - 15} cy="128" rx="20" ry="38" fill="#5b3f9c" />
              <ellipse cx={cx + 14} cy="129" rx="19" ry="36" fill="#7b59bd" />
              <ellipse cx={cx} cy="113" rx="15" ry="30" fill="#8d6bd0" />
              <path d={`M${cx - 10} 151q10 19 25 0`} stroke="#f0ce5c" strokeWidth="8" strokeLinecap="round" fill="none" />
            </g>
          ))}
          <path d="M26 230c49-32 77-8 120-26s73 6 116-18 75-9 131 12" fill="none" stroke="#b9a24c" strokeWidth="11" strokeLinecap="round" opacity="0.72" />
        </>
      ) : (
        <>
          <rect width="420" height="300" fill="#73b8cb" />
          <path d="M0 238c83-39 142-6 213-28 66-21 128-14 207 12v78H0z" fill="#6db1bf" opacity="0.7" />
          <path d="M29 183C93 145 131 122 194 94c65-29 112-58 189-79" fill="none" stroke="#543720" strokeWidth="16" strokeLinecap="round" />
          <path d="M121 136C101 99 84 68 61 43M196 94c-3-42 8-70 32-101M260 66c30-25 60-42 96-52M300 48c22 24 52 42 88 52" fill="none" stroke="#5d3b23" strokeWidth="10" strokeLinecap="round" />
          {[64, 97, 134, 181, 222, 268, 314, 354, 384].map((cx, index) => (
            <g key={cx} transform={`rotate(${index * 23} ${cx} ${70 + (index % 4) * 37})`}>
              <ellipse cx={cx} cy={70 + (index % 4) * 37} rx="24" ry="11" fill="#f8f0dc" />
              <ellipse cx={cx + 1} cy={70 + (index % 4) * 37} rx="8" ry="6" fill="#d99d87" />
            </g>
          ))}
          <path d="M34 184C92 150 128 127 193 99s112-61 184-81" fill="none" stroke="#8b5a34" strokeWidth="5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function submittedCount(state: PaintingState) {
  return Object.keys(state.submissions).length;
}

function playerById(players: PaintingPlayer[], playerId: string) {
  return players.find((player) => player.id === playerId);
}

export function Component({ currentPlayer, publicState, disabled, onAction }: GameComponentProps<PaintingState>) {
  const state = assertState(publicState);
  const reference = referenceFor(state.referenceId);
  const [now, setNow] = useState(() => Date.now());
  const [brushColor, setBrushColor] = useState(brushColors[0]);
  const [customColor, setCustomColor] = useState(brushColors[0]);
  const [brushSize, setBrushSize] = useState(8);
  const [strokeCount, setStrokeCount] = useState(0);
  const [showRankBoard, setShowRankBoard] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const autoSubmitKeyRef = useRef("");
  const completeKeyRef = useRef("");
  const currentSubmission = currentPlayer ? state.submissions[currentPlayer.id] : null;
  const canDraw = state.phase === "drawing" && Boolean(currentPlayer) && !currentSubmission && !disabled;
  const remainingMs = state.deadlineAt - now;
  const winnerSet = new Set(state.winnerIds);
  const revealScores = state.phase === "complete" && showRankBoard;
  const hasFallingFrames = state.phase === "complete" && state.players.length > Math.max(1, state.winnerIds.length);
  const { isSubmitting, submitAction } = useInteractionGate(onAction, [state.phase, submittedCount(state), state.winnerIds.join("|")], {
    cooldownMs: 450
  });

  useEffect(() => {
    setupCanvas(canvasRef.current);
    setStrokeCount(0);
    historyRef.current = [];
  }, [state.referenceId, currentPlayer?.id]);

  useEffect(() => {
    if (state.phase !== "drawing") return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [state.phase]);

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height
    };
  }

  function pushHistory() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    historyRef.current = [...historyRef.current.slice(-8), ctx.getImageData(0, 0, canvas.width, canvas.height)];
  }

  function drawTo(point: { x: number; y: number }) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const last = lastPointRef.current ?? point;
    if (!canvas || !ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!canDraw) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pushHistory();
    drawingRef.current = true;
    const point = canvasPoint(event);
    lastPointRef.current = point;
    drawTo(point);
    setStrokeCount((count) => count + 1);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!canDraw || !drawingRef.current) return;
    event.preventDefault();
    drawTo(canvasPoint(event));
  }

  function stopDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function undo() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const previous = historyRef.current.pop();
    if (!canvas || !ctx || !previous || !canDraw) return;
    ctx.putImageData(previous, 0, 0);
  }

  function clearCanvas() {
    if (!canDraw) return;
    pushHistory();
    setupCanvas(canvasRef.current);
  }

  function submitCurrent(reason: "manual" | "auto") {
    if (!currentPlayer || currentSubmission || isSubmitting) return false;
    const canvas = canvasRef.current;
    const analysis = analyzeCanvas(canvas, strokeCount);
    const imageData = canvas?.toDataURL("image/jpeg", 0.72) ?? null;
    return submitAction({ type: "painting/submit", payload: { imageData, analysis, reason } });
  }

  useEffect(() => {
    if (state.phase !== "drawing") return;
    const key = `${state.startedAt}-${currentPlayer?.id ?? "viewer"}`;
    if (remainingMs > 0 || autoSubmitKeyRef.current === key) return;
    autoSubmitKeyRef.current = key;
    if (currentPlayer && !currentSubmission) {
      submitCurrent("auto");
    } else {
      submitAction({ type: "painting/force-scan" });
    }
  }, [currentPlayer, currentSubmission, remainingMs, state.phase, state.startedAt, submitAction]);

  useEffect(() => {
    if (state.phase !== "scanning") return;
    const key = `${state.startedAt}-${state.rankings.map((ranking) => ranking.playerId).join("|")}`;
    if (completeKeyRef.current === key) return;
    completeKeyRef.current = key;
    const timer = window.setTimeout(() => {
      submitAction({ type: "painting/complete" });
    }, 5400);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.rankings, state.startedAt, submitAction]);

  useEffect(() => {
    if (state.phase !== "complete") {
      setShowRankBoard(false);
      return;
    }
    setShowRankBoard(false);
    const timer = window.setTimeout(() => setShowRankBoard(true), 3000);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.startedAt, state.winnerIds.join("|")]);

  return (
    <div className={`game-module painting-shell phase-${state.phase}`}>
      <section className="painting-topline" aria-label="명화 따라그리기 상태">
        <div>
          <strong>{reference.title}</strong>
          <span>{reference.subtitle}</span>
        </div>
        <div className="painting-clock" data-urgent={remainingMs <= 15_000 && state.phase === "drawing"}>
          {state.phase === "drawing" ? formatRemaining(remainingMs) : state.phase === "scanning" ? "스캔 중" : "결과"}
        </div>
        <div className="painting-submit-count">
          {submittedCount(state)}/{state.players.length} 제출
        </div>
      </section>

      {state.phase === "drawing" ? (
        <section className="painting-studio" aria-label="그리기 화면">
          <aside className="painting-reference-card">
            <ReferenceArtwork reference={reference} />
            <div className="painting-reference-caption">
              <strong>원본</strong>
              <span>색감, 큰 구도, 채움 정도를 따라가세요.</span>
            </div>
            <div className="painting-palette-strip" aria-hidden="true">
              {reference.palette.map((color) => (
                <i key={color} style={{ background: color }} />
              ))}
            </div>
          </aside>

          <section className="painting-canvas-panel">
            <div className="painting-canvas-frame">
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="painting-canvas"
                aria-label="내 그림 캔버스"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
              />
              {!canDraw ? (
                <div className="painting-canvas-lock">
                  <strong>{currentSubmission ? "제출 완료" : disabled ? "대기" : "관전 중"}</strong>
                  <span>다른 플레이어의 제출을 기다립니다.</span>
                </div>
              ) : null}
            </div>

            <div className="painting-toolrail" aria-label="그리기 도구">
              <div className="painting-colors">
                {brushColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={color === brushColor ? "selected" : ""}
                    style={{ "--paint-color": color } as CSSProperties}
                    aria-label={`${color} 색 선택`}
                    onClick={() => setBrushColor(color)}
                  />
                ))}
                <label className={`painting-custom-color ${brushColor === customColor ? "selected" : ""}`}>
                  <span>직접</span>
                  <input
                    type="color"
                    value={customColor}
                    aria-label="직접 색 고르기"
                    onChange={(event) => {
                      setCustomColor(event.target.value);
                      setBrushColor(event.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="painting-brushes">
                {brushSizes.map((size) => (
                  <button key={size} type="button" className={size === brushSize ? "selected" : ""} onClick={() => setBrushSize(size)}>
                    {size}
                  </button>
                ))}
              </div>
              <button type="button" onClick={undo} disabled={!canDraw}>
                되돌리기
              </button>
              <button type="button" onClick={clearCanvas} disabled={!canDraw}>
                지우기
              </button>
              <button className="painting-submit" type="button" onClick={() => submitCurrent("manual")} disabled={!canDraw || isSubmitting}>
                제출
              </button>
            </div>
          </section>
        </section>
      ) : (
        <section className={`painting-results ${showRankBoard ? "show-ranks" : ""}`} aria-label="그림 결과">
          <div className="painting-gallery-wall">
            <div className="painting-gallery-reference">
              <ReferenceArtwork reference={reference} />
              <span>원본</span>
            </div>
            <div className="painting-judgement-copy" role="status" aria-live="polite">
              <strong>{state.phase === "scanning" ? "작품 스캔 중" : showRankBoard ? "순위 공개" : "판정 완료"}</strong>
              <span>
                {state.phase === "scanning"
                  ? "제출된 그림을 벽에 걸고 유사도를 읽는 중입니다."
                  : showRankBoard
                    ? "점수표가 열렸습니다."
                    : hasFallingFrames
                      ? "가장 가까운 작품만 벽에 남습니다."
                      : "우승 작품을 벽에서 강조합니다."}
              </span>
            </div>
            <div className="painting-scan-grid">
              {state.players.map((player, index) => {
                const submission = state.submissions[player.id];
                const ranking = state.rankings.find((item) => item.playerId === player.id);
                const isWinner = winnerSet.has(player.id);
                return (
                  <article
                    className={`painting-result-card ${isWinner ? "winner" : "non-winner"} ${state.phase === "complete" ? "judged" : ""}`}
                    key={player.id}
                    style={{ "--reveal-index": index, "--fall-index": ranking?.rank ?? index + 1 } as CSSProperties}
                  >
                    <div className="painting-result-paper">
                      {submission?.imageData ? <img src={submission.imageData} alt={`${player.name} 그림`} /> : <span>미제출</span>}
                      <i className="painting-scan-line" aria-hidden="true" />
                    </div>
                    <div className="painting-result-meta">
                      <strong>{player.name}</strong>
                      <b>{revealScores && ranking ? `${ranking.score}%` : state.phase === "scanning" ? "스캔" : isWinner ? "보존" : "낙하"}</b>
                    </div>
                    {revealScores && ranking ? (
                      <div className="painting-score-breakdown">
                        <span>색감 {ranking.breakdown.color}</span>
                        <span>구도 {ranking.breakdown.composition}</span>
                        <span>채움 {ranking.breakdown.coverage}</span>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
            <div className="painting-gallery-floor" aria-hidden="true" />
          </div>

          {showRankBoard ? (
            <div className="painting-rank-board">
              <strong>순위</strong>
              {state.rankings.map((ranking) => {
                const player = playerById(state.players, ranking.playerId);
                return (
                  <div className="painting-rank-row" key={ranking.playerId}>
                    <span>{ranking.rank}</span>
                    <b>{player?.name ?? "플레이어"}</b>
                    <i style={{ inlineSize: `${ranking.score}%` }} />
                    <em>{ranking.score}%</em>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="painting-ranking-wait" role="status" aria-live="polite">
              {state.phase === "scanning"
                ? "그림을 한 장씩 스캔하고 있습니다."
                : hasFallingFrames
                  ? "떨어진 액자가 정리되면 순위가 열립니다."
                  : "판정이 정리되면 순위가 열립니다."}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

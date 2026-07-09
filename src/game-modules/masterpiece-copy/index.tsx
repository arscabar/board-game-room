import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useInteractionGate } from "../useInteractionGate";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const DRAWING_MS = 150_000;
const SCAN_MS = 5_400;
const CANVAS_WIDTH = 672;
const CANVAS_HEIGHT = 480;
const MAX_IMAGE_LENGTH = 520_000;
const CANVAS_PAPER = "#fbefd6";

type PaintingPhase = "drawing" | "scanning" | "complete";
type DrawingTool = "pen" | "eraser" | "fill";

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
  imageUrl: string;
  sourceUrl: string;
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
  scanStartedAt?: number;
  players: PaintingPlayer[];
  submissions: Record<string, PaintingSubmission>;
  rankings: PaintingRanking[];
  winnerIds: string[];
  message: string;
}

const references: PaintingReference[] = [
  {
    id: "starry-night",
    title: "별이 빛나는 밤",
    subtitle: "Vincent van Gogh, The Starry Night",
    imageUrl: "/board-assets/masterpieces/starry-night.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
    palette: ["#153a69", "#1f6596", "#f5ca4d", "#f8ead0", "#274b2c"],
    target: { hue: 0.52, saturation: 0.27, lightness: 0.38, coverage: 0.9, balanceX: 0.5, balanceY: 0.48, stroke: 0.72 }
  },
  {
    id: "sunflowers",
    title: "해바라기",
    subtitle: "Vincent van Gogh, Sunflowers",
    imageUrl: "/board-assets/masterpieces/sunflowers.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_Sunflowers_(1888,_National_Gallery_London).jpg",
    palette: ["#f3c84e", "#d28a2f", "#6f8a3d", "#f7e1a2", "#5e3a1f"],
    target: { hue: 0.13, saturation: 0.57, lightness: 0.51, coverage: 1, balanceX: 0.5, balanceY: 0.5, stroke: 0.66 }
  },
  {
    id: "vangogh-chair",
    title: "반 고흐의 의자",
    subtitle: "Vincent van Gogh, Van Gogh's Chair",
    imageUrl: "/board-assets/masterpieces/vangogh-chair.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Van_Gogh%27s_Chair.jpg",
    palette: ["#2e6f91", "#8c6237", "#efc46f", "#f8edd2", "#233a46"],
    target: { hue: 0.15, saturation: 0.44, lightness: 0.32, coverage: 0.94, balanceX: 0.49, balanceY: 0.51, stroke: 0.5 }
  },
  {
    id: "irises",
    title: "붓꽃",
    subtitle: "Vincent van Gogh, Irises",
    imageUrl: "/board-assets/masterpieces/irises.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Irises-Vincent_van_Gogh.jpg",
    palette: ["#5b3f9c", "#8361c7", "#2f7448", "#d9c45f", "#f5dfb4"],
    target: { hue: 0.37, saturation: 0.27, lightness: 0.44, coverage: 0.96, balanceX: 0.49, balanceY: 0.49, stroke: 0.68 }
  },
  {
    id: "almond-blossom",
    title: "아몬드 꽃",
    subtitle: "Vincent van Gogh, Almond Blossom",
    imageUrl: "/board-assets/masterpieces/almond-blossom.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_Almond_blossom_-_Google_Art_Project.jpg",
    palette: ["#6fb5c9", "#f7f1df", "#d8a38d", "#5b3b2a", "#8ed0df"],
    target: { hue: 0.44, saturation: 0.2, lightness: 0.56, coverage: 0.99, balanceX: 0.5, balanceY: 0.5, stroke: 0.48 }
  }
];

const brushColors = ["#17263c", "#f2c84b", "#2f6d93", "#7a4a24", "#e36d3d", "#f8f0dc", "#1f6f4a", "#6e3fa6"];

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
    scanStartedAt: now,
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
    scanStartedAt: undefined,
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

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return { r: 23, g: 38, b: 60 };
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function colorDelta(data: Uint8ClampedArray, index: number, target: { r: number; g: number; b: number }) {
  return Math.abs(data[index] - target.r) + Math.abs(data[index + 1] - target.g) + Math.abs(data[index + 2] - target.b);
}

function setupCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = CANVAS_PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function floodFill(canvas: HTMLCanvasElement | null, point: { x: number; y: number }, color: string) {
  const ctx = canvas?.getContext("2d", { willReadFrequently: true });
  if (!canvas || !ctx) return false;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const startX = Math.max(0, Math.min(canvas.width - 1, Math.floor(point.x)));
  const startY = Math.max(0, Math.min(canvas.height - 1, Math.floor(point.y)));
  const startIndex = (startY * canvas.width + startX) * 4;
  const target = { r: data[startIndex], g: data[startIndex + 1], b: data[startIndex + 2] };
  const fill = hexToRgb(color);
  if (Math.abs(target.r - fill.r) + Math.abs(target.g - fill.g) + Math.abs(target.b - fill.b) < 8) return false;

  const tolerance = 54;
  const stack = [[startX, startY]];
  const seen = new Uint8Array(canvas.width * canvas.height);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const [x, y] = current;
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
    const pixel = y * canvas.width + x;
    if (seen[pixel]) continue;
    seen[pixel] = 1;
    const index = pixel * 4;
    if (colorDelta(data, index, target) > tolerance) continue;
    data[index] = fill.r;
    data[index + 1] = fill.g;
    data[index + 2] = fill.b;
    data[index + 3] = 255;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ctx.putImageData(image, 0, 0);
  return true;
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
  return <img className="painting-reference-art" src={reference.imageUrl} alt={`${reference.title} 원본 명화`} draggable={false} />;
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
  const baseColors = brushColors.filter((color) => !reference.palette.includes(color));
  const [now, setNow] = useState(() => Date.now());
  const [tool, setTool] = useState<DrawingTool>("pen");
  const [brushColor, setBrushColor] = useState(brushColors[0]);
  const [customColor, setCustomColor] = useState(brushColors[0]);
  const [brushSize, setBrushSize] = useState(8);
  const [eraserSize, setEraserSize] = useState(18);
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
  const scanProgress =
    state.phase === "scanning" ? Math.max(0, Math.min(1, (now - (state.scanStartedAt ?? now)) / SCAN_MS)) : state.phase === "complete" ? 1 : 0;
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
    if (state.phase !== "drawing" && state.phase !== "scanning") return;
    const timer = window.setInterval(() => setNow(Date.now()), state.phase === "scanning" ? 80 : 500);
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
    const erasing = tool === "eraser";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = erasing ? CANVAS_PAPER : brushColor;
    ctx.lineWidth = erasing ? eraserSize : brushSize;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!canDraw) return;
    event.preventDefault();
    pushHistory();
    const point = canvasPoint(event);
    if (tool === "fill") {
      if (floodFill(canvasRef.current, point, brushColor)) {
        setStrokeCount((count) => count + 4);
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
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

  function selectBrushColor(color: string) {
    setBrushColor(color);
    setTool((current) => (current === "eraser" ? "pen" : current));
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
    }, SCAN_MS);
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
              <span>모든 플레이어가 같은 명화를 보고 색감, 큰 구도, 채움 정도를 따라갑니다.</span>
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
                className={`painting-canvas tool-${tool}`}
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
              <div className="painting-tool-modes" role="group" aria-label="도구 선택">
                {[
                  ["pen", "펜"],
                  ["eraser", "지우개"],
                  ["fill", "페인트"]
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={tool === mode ? "selected" : ""}
                    aria-pressed={tool === mode}
                    onClick={() => setTool(mode as DrawingTool)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="painting-color-panel">
                <div className="painting-active-color" style={{ "--paint-color": brushColor } as CSSProperties}>
                  <span>색상</span>
                  <strong>{brushColor.toUpperCase()}</strong>
                </div>
                <div className="painting-color-row">
                  <span>원본 팔레트</span>
                  <div className="painting-colors">
                    {reference.palette.map((color, index) => (
                      <button
                        key={`${color}-${index}`}
                        type="button"
                        className={color === brushColor ? "selected" : ""}
                        style={{ "--paint-color": color } as CSSProperties}
                        aria-label={`${color} 원본 팔레트 색 선택`}
                        aria-pressed={color === brushColor}
                        onClick={() => selectBrushColor(color)}
                      />
                    ))}
                  </div>
                </div>
                <div className="painting-color-row">
                  <span>기본 / 직접</span>
                  <div className="painting-colors">
                    {baseColors.map((color, index) => (
                      <button
                        key={`${color}-${index}`}
                        type="button"
                        className={color === brushColor ? "selected" : ""}
                        style={{ "--paint-color": color } as CSSProperties}
                        aria-label={`${color} 기본 색 선택`}
                        aria-pressed={color === brushColor}
                        onClick={() => selectBrushColor(color)}
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
                          selectBrushColor(event.target.value);
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="painting-size-controls">
                <label>
                  <span>펜 {brushSize}px</span>
                  <input type="range" min="2" max="28" step="1" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
                </label>
                <label>
                  <span>지우개 {eraserSize}px</span>
                  <input
                    type="range"
                    min="8"
                    max="48"
                    step="2"
                    value={eraserSize}
                    onChange={(event) => setEraserSize(Number(event.target.value))}
                  />
                </label>
              </div>

              <div className="painting-tool-actions">
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

              <div className="painting-score-note" aria-label="유사도 판정 방식">
                <strong>유사도 판정</strong>
                <span>
                  캔버스 픽셀에서 색감, 밝기, 채움, 중심 구도, 작업량을 읽어 원본 기준값과 비교합니다. 색감 34 · 밝기 14 · 채움 20 · 구도 22 · 완성도 10.
                </span>
              </div>
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
                const scanningScore = ranking ? Math.min(ranking.score, Math.round(ranking.score * scanProgress)) : 0;
                return (
                  <article
                    className={`painting-result-card ${isWinner ? "winner" : "non-winner"} ${state.phase === "complete" ? "judged" : ""}`}
                    key={player.id}
                    style={{ "--reveal-index": index, "--fall-index": ranking?.rank ?? index + 1, "--scan-progress": scanProgress } as CSSProperties}
                  >
                    <div className="painting-result-paper">
                      {submission?.imageData ? <img src={submission.imageData} alt={`${player.name} 그림`} /> : <span>미제출</span>}
                      <i className="painting-scan-line" aria-hidden="true" />
                      {state.phase === "scanning" && ranking ? <span className="painting-live-percent">{scanningScore}%</span> : null}
                    </div>
                    <div className="painting-result-meta">
                      <strong>{player.name}</strong>
                      <b>{revealScores && ranking ? `${ranking.score}%` : state.phase === "scanning" ? `${scanningScore}%` : isWinner ? "보존" : "낙하"}</b>
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

import {
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  CircleDot,
  Clock3,
  Crown,
  Dice5,
  DoorOpen,
  Gamepad2,
  Gauge,
  History,
  Hexagon,
  Layers3,
  Medal,
  Palette,
  Pause,
  Play,
  Puzzle,
  Radio,
  RefreshCw,
  Route,
  Send,
  ShieldQuestion,
  Shuffle,
  Star,
  Target,
  TimerOff,
  Trash2,
  Trophy,
  UserCheck,
  Users,
  WifiOff,
  type LucideIcon
} from "lucide-react";
import {
  Suspense,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { socket } from "./lib/socket";
import { InteractiveCafeHome } from "./components/interactive-space/InteractiveCafeHome";
import { InteractiveGameLobby } from "./components/interactive-space/InteractiveGameLobby";
import { InteractiveGameWrapper } from "./components/interactive-space/InteractiveGameWrapper";
import { PlayerTokenPawn } from "./components/interactive-space/PlayerTokenDock";
import { games, getGameById } from "./shared/games";
import { canPlayGame, formatAllowedPlayers, gameAvailabilityLabel } from "./shared/eligibility";
import { gameUsesTurnTimer, turnTimerOptions } from "./shared/timers";
import type { Ack, GameDefinition, GameTableKind, PlayerAvatar, PlayerSnapshot, PublicRoomListItem, RoomSnapshot } from "./shared/types";
import { getGameComponent } from "./game-modules/ui-registry";
import type { GameAction } from "./game-modules/types";
import type { LeaderboardEntry, MatchRecord, PlayerStatsResponse, StatsSummary } from "./shared/stats";
import { BoardButton, BoardIconButton } from "./ui/BoardKit";

type JoinResult = {
  room: RoomSnapshot;
  playerId: string;
};

type PostGameActionResult = {
  code: string;
  room?: RoomSnapshot;
  left?: boolean;
  deleted?: boolean;
};

const storageKeys = {
  name: "board-room-name",
  avatar: "board-room-avatar",
  playerId: "board-room-player-id",
  clientKey: "board-room-client-key",
  roomCode: "board-room-last-room-code"
};

function createDefaultName() {
  return `플레이어 ${Math.floor(100 + Math.random() * 900)}`;
}

function createClientKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function readOrCreateClientKey() {
  const saved = localStorage.getItem(storageKeys.clientKey);
  if (saved) {
    return saved;
  }

  const next = createClientKey();
  localStorage.setItem(storageKeys.clientKey, next);
  return next;
}

const defaultAvatar: PlayerAvatar = {
  body: "pawn",
  face: "smile",
  accessory: "none",
  palette: "teal"
};

const avatarBodyOptions = [
  { id: "pawn", label: "말" },
  { id: "round", label: "원형" },
  { id: "bot", label: "기계" },
  { id: "crest", label: "문장" }
] as const;

const avatarFaceOptions = [
  { id: "smile", label: "웃음" },
  { id: "focus", label: "집중" },
  { id: "wink", label: "윙크" },
  { id: "calm", label: "차분" }
] as const;

const avatarAccessoryOptions = [
  { id: "none", label: "없음" },
  { id: "crown", label: "왕관" },
  { id: "glasses", label: "안경" },
  { id: "cap", label: "모자" },
  { id: "spark", label: "별" }
] as const;

const avatarPaletteOptions = [
  { id: "teal", label: "청록", base: "#0c8b6c", light: "#72dec1", dark: "#05352e", accent: "#f1d58f" },
  { id: "amber", label: "황금", base: "#c88b25", light: "#ffe09a", dark: "#4a270b", accent: "#1d7b68" },
  { id: "blue", label: "청색", base: "#2364aa", light: "#9bc3ff", dark: "#0d2442", accent: "#e5c06a" },
  { id: "rose", label: "장미", base: "#b33d55", light: "#ff9cad", dark: "#43141f", accent: "#f0d486" },
  { id: "violet", label: "보라", base: "#7450b8", light: "#c3a8ff", dark: "#28173e", accent: "#e5c06a" },
  { id: "ivory", label: "상아", base: "#efe0b6", light: "#fff7dc", dark: "#6b5430", accent: "#0a7b64" }
] as const;

const avatarPresets: Array<{ label: string; avatar: PlayerAvatar }> = [
  { label: "선봉", avatar: { body: "pawn", face: "focus", accessory: "crown", palette: "amber" } },
  { label: "전략가", avatar: { body: "crest", face: "calm", accessory: "glasses", palette: "blue" } },
  { label: "탐험가", avatar: { body: "round", face: "smile", accessory: "cap", palette: "teal" } },
  { label: "승부사", avatar: { body: "bot", face: "wink", accessory: "spark", palette: "rose" } }
];

function isAvatarBody(value: unknown): value is PlayerAvatar["body"] {
  return avatarBodyOptions.some((option) => option.id === value);
}

function isAvatarFace(value: unknown): value is PlayerAvatar["face"] {
  return avatarFaceOptions.some((option) => option.id === value);
}

function isAvatarAccessory(value: unknown): value is PlayerAvatar["accessory"] {
  return avatarAccessoryOptions.some((option) => option.id === value);
}

function isAvatarPalette(value: unknown): value is PlayerAvatar["palette"] {
  return avatarPaletteOptions.some((option) => option.id === value);
}

function normalizeAvatar(value: unknown): PlayerAvatar {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultAvatar };
  }

  const record = value as Partial<PlayerAvatar>;
  return {
    body: isAvatarBody(record.body) ? record.body : defaultAvatar.body,
    face: isAvatarFace(record.face) ? record.face : defaultAvatar.face,
    accessory: isAvatarAccessory(record.accessory) ? record.accessory : defaultAvatar.accessory,
    palette: isAvatarPalette(record.palette) ? record.palette : defaultAvatar.palette
  };
}

function readSavedAvatar() {
  try {
    const saved = localStorage.getItem(storageKeys.avatar);
    return saved ? normalizeAvatar(JSON.parse(saved)) : { ...avatarPresets[0].avatar };
  } catch {
    return { ...avatarPresets[0].avatar };
  }
}

function randomAvatar(): PlayerAvatar {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
  return {
    body: pick(avatarBodyOptions).id,
    face: pick(avatarFaceOptions).id,
    accessory: pick(avatarAccessoryOptions).id,
    palette: pick(avatarPaletteOptions).id
  };
}

function avatarOptionLabel<T extends { id: string; label: string }>(options: readonly T[], id: string) {
  return options.find((option) => option.id === id)?.label ?? id;
}

function avatarDescription(avatar: PlayerAvatar) {
  return [
    avatarOptionLabel(avatarPaletteOptions, avatar.palette),
    avatarOptionLabel(avatarBodyOptions, avatar.body),
    avatarOptionLabel(avatarFaceOptions, avatar.face)
  ].join(" · ");
}

function emitWithAck<T>(event: string, payload: unknown) {
  return new Promise<Ack<T>>((resolve) => {
    socket.emit(event, payload, (response: Ack<T>) => {
      resolve(response);
    });
  });
}

function resolveApiUrl(path: string) {
  const base =
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_SOCKET_URL ||
    (window.location.protocol === "capacitor:" ? "http://10.0.2.2:3001" : "");
  return base ? `${String(base).replace(/\/$/, "")}${path}` : path;
}

async function fetchJson<T>(path: string) {
  const response = await fetch(resolveApiUrl(path));
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "서버 데이터를 불러올 수 없습니다.");
  }
  return (await response.json()) as T;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function formatPercent(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined) {
    return "-";
  }
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

const seatAccentColors = ["#2364aa", "#d69b2d", "#d94f45", "#258a5b"];

const gameKindIcons: Record<GameDefinition["table"]["kind"], LucideIcon> = {
  duel: Target,
  maze: Route,
  hex: Hexagon,
  hidden: ShieldQuestion,
  stack: Layers3,
  deduction: Brain,
  polyomino: Puzzle,
  dice: Dice5,
  rings: CircleDot,
  word: BookOpen
};

function GameKindIcon({ game, size = 17 }: { game: GameDefinition; size?: number }) {
  const Icon = gameKindIcons[game.visual?.iconKind ?? game.table.kind] ?? Gamepad2;
  return <Icon size={size} aria-hidden="true" />;
}

const rasterGameCoverIds = new Set([
  "abalone-classic",
  "blokus",
  "davinci-code-plus",
  "ghosts",
  "guryongtu",
  "hangman-board-game",
  "qawale",
  "quoridor",
  "yacht-dice",
  "yinsh"
]);

function gameCoverSrc(game: GameDefinition) {
  return `/board-assets/game-covers/${game.id}.${rasterGameCoverIds.has(game.id) ? "png" : "svg"}`;
}

function GameCoverImage({ game, className = "" }: { game: GameDefinition; className?: string }) {
  return <img className={`game-cover-image ${className}`} src={gameCoverSrc(game)} alt={`${game.title} 대표 이미지`} draggable={false} />;
}

function stateRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function runtimePhase(room: RoomSnapshot) {
  const publicState = stateRecord(room.gameState.publicState);
  return String(room.gameState.phase ?? publicState?.phase ?? "");
}

function runtimeMessage(room: RoomSnapshot) {
  const publicState = stateRecord(room.gameState.publicState);
  return String(room.gameState.message ?? publicState?.message ?? "");
}

function runtimeWinnerId(room: RoomSnapshot) {
  return runtimeWinnerIds(room)[0] ?? null;
}

function runtimeWinnerIds(room: RoomSnapshot) {
  const publicState = stateRecord(room.gameState.publicState);
  const winners = new Set<string>();
  const singleWinner = room.gameState.winnerId ?? publicState?.winnerId;
  if (typeof singleWinner === "string" && singleWinner) {
    winners.add(singleWinner);
  }
  if (Array.isArray(room.gameState.winnerIds)) {
    room.gameState.winnerIds.forEach((winnerId) => {
      if (typeof winnerId === "string" && winnerId) {
        winners.add(winnerId);
      }
    });
  }
  if (Array.isArray(publicState?.winnerIds)) {
    publicState.winnerIds.forEach((winnerId) => {
      if (typeof winnerId === "string" && winnerId) {
        winners.add(winnerId);
      }
    });
  }
  return Array.from(winners);
}

type PlayerMomentumTone = "winner" | "streak" | "leader";

interface PlayerMomentumBadge {
  label: string;
  tone: PlayerMomentumTone;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumNumericValues(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const record = stateRecord(value);
  if (!record) {
    return null;
  }
  let total = 0;
  let found = false;
  Object.values(record).forEach((entry) => {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      total += entry;
      found = true;
    }
  });
  return found ? total : null;
}

function playerValueFromRecord(value: unknown, playerId: string) {
  const record = stateRecord(value);
  if (!record) {
    return null;
  }
  return sumNumericValues(record[playerId]);
}

function playerValueFromList(value: unknown, playerId: string, keys: string[]) {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const entry of value) {
    const record = stateRecord(entry);
    if (!record) {
      continue;
    }
    const id = typeof record.id === "string" ? record.id : typeof record.playerId === "string" ? record.playerId : null;
    if (id !== playerId) {
      continue;
    }
    for (const key of keys) {
      const metric = finiteNumber(record[key]);
      if (metric !== null) {
        return metric;
      }
    }
  }
  return null;
}

function readPlayerMetric(sources: Array<Record<string, unknown>>, playerId: string, recordKeys: string[], listKeys: string[]) {
  for (const source of sources) {
    for (const key of recordKeys) {
      const metric = playerValueFromRecord(source[key], playerId);
      if (metric !== null) {
        return metric;
      }
    }
    const listMetric = playerValueFromList(source.players, playerId, listKeys);
    if (listMetric !== null) {
      return listMetric;
    }
  }
  return null;
}

function winnerIdFromRound(value: unknown) {
  const record = stateRecord(value);
  const winnerId = record?.winnerId;
  return typeof winnerId === "string" && winnerId ? winnerId : null;
}

function playerStreakFromRounds(value: unknown, playerId: string) {
  if (!Array.isArray(value)) {
    return null;
  }
  let streak = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const winnerId = winnerIdFromRound(value[index]);
    if (!winnerId) {
      continue;
    }
    if (winnerId !== playerId) {
      break;
    }
    streak += 1;
  }
  return streak > 0 ? streak : null;
}

function readPlayerStreak(sources: Array<Record<string, unknown>>, playerId: string) {
  const direct = readPlayerMetric(sources, playerId, ["streaks", "winStreaks", "consecutiveWins"], ["streak", "winStreak", "consecutiveWins"]);
  if (direct !== null) {
    return direct;
  }
  for (const source of sources) {
    const roundsStreak = playerStreakFromRounds(source.rounds, playerId);
    if (roundsStreak !== null) {
      return roundsStreak;
    }
  }
  return null;
}

function buildPlayerMomentumBadges(room: RoomSnapshot, selectedGame: GameDefinition | null, winnerIds: string[]) {
  const rootState = stateRecord(room.gameState);
  const publicState = stateRecord(room.gameState.publicState);
  const sources = [publicState, rootState].filter((source): source is Record<string, unknown> => Boolean(source));
  const badges = new Map<string, PlayerMomentumBadge>();
  const winnerSet = new Set(winnerIds);

  const winMetrics = room.players.map((player) => ({
    playerId: player.id,
    value: readPlayerMetric(sources, player.id, ["wins", "roundWins", "victories"], ["wins", "roundWins", "victories"]),
    streak: readPlayerStreak(sources, player.id)
  }));
  const hasRoundWins = winMetrics.some((metric) => (metric.value ?? 0) > 0);
  const scoreAsWins = selectedGame?.scoreState === "승수제" || selectedGame?.id === "guryongtu";
  const scoreMetrics = room.players.map((player) => ({
    playerId: player.id,
    value: readPlayerMetric(sources, player.id, ["totals", "scores", "points"], ["total", "score", "points"]),
    streak: scoreAsWins ? readPlayerStreak(sources, player.id) : null
  }));

  const metrics = hasRoundWins ? winMetrics : scoreMetrics;
  const values = metrics.map((metric) => metric.value).filter((value): value is number => value !== null);
  const maxValue = values.length > 0 ? Math.max(...values) : null;
  const useWinLabel = hasRoundWins || scoreAsWins;

  metrics.forEach(({ playerId, value, streak }) => {
    if (value === null || value <= 0 || maxValue === null) {
      return;
    }
    if (useWinLabel) {
      if (value !== maxValue) {
        return;
      }
      const isStreak = (streak ?? 0) >= 2;
      const tone: PlayerMomentumTone = isStreak ? "streak" : "leader";
      badges.set(playerId, {
        label: isStreak ? `${formatScore(streak)}연승` : `${formatScore(value)}승`,
        tone
      });
      return;
    }
    if (value === maxValue) {
      badges.set(playerId, {
        label: `${formatScore(value)}점`,
        tone: "leader"
      });
    }
  });

  winnerSet.forEach((playerId) => {
    badges.set(playerId, { label: "승리", tone: "winner" });
  });

  return badges;
}

const victoryPiecesByKind: Record<GameTableKind, string[]> = {
  duel: ["1", "3", "5", "7", "9", "W", "1", "3", "5", "7", "9", "W"],
  maze: ["H", "V", "GO", "H", "V", "GO", "H", "V", "GO", "H", "V", "GO"],
  hex: ["", "", "", "", "", "", "", "", "", "", "", ""],
  hidden: ["?", "B", "G", "?", "B", "G", "?", "B", "G", "?", "B", "G"],
  stack: ["", "", "", "", "", "", "", "", "", "", "", ""],
  deduction: ["0", "2", "4", "6", "8", "J", "1", "3", "5", "7", "9", "J"],
  polyomino: ["L", "T", "I", "Z", "P", "F", "L", "T", "I", "Z", "P", "F"],
  dice: ["1", "2", "3", "4", "5", "6", "Y", "1", "2", "3", "4", "5"],
  rings: ["", "", "", "", "", "", "", "", "", "", "", ""],
  word: ["A", "B", "C", "D", "E", "W", "I", "N", "A", "B", "C", "D"]
};

function victoryPiecesFor(game: GameDefinition) {
  if (game.id === "alkkagi") {
    return ["K", "S", "B", "I", "P", "W", "K", "S", "B", "I", "P", "W"];
  }
  if (game.id === "kkukkkuki") {
    return ["S", "L", "S", "L", "S", "L", "S", "L", "S", "L", "S", "L"];
  }
  if (game.id === "masterpiece-copy") {
    return ["ART", "%", "W", "V", "ART", "%", "W", "V", "ART", "%", "W", "V"];
  }
  return victoryPiecesByKind[game.table.kind];
}

function VictoryEffectOverlay({
  game,
  winnerNames,
  isDraw
}: {
  game: GameDefinition;
  winnerNames: string[];
  isDraw: boolean;
}) {
  const pieces = victoryPiecesFor(game);
  const winnerLabel = isDraw ? "무승부" : `${winnerNames.length > 0 ? winnerNames.join(", ") : "플레이어"} 승리`;

  return (
    <div
      className={`victory-effect-overlay victory-kind-${game.table.kind} victory-game-${game.id}`}
      style={{ "--victory-accent": game.accent } as CSSProperties}
      aria-hidden="true"
    >
      <div className="victory-effect-rays">
        {Array.from({ length: 10 }, (_, index) => (
          <span key={index} style={{ "--ray-index": index } as CSSProperties} />
        ))}
      </div>
      <div className="victory-piece-field">
        {pieces.map((piece, index) => (
          <span
            key={`${piece}-${index}`}
            className={`victory-piece piece-${index + 1}`}
            style={{ "--piece-index": index } as CSSProperties}
          >
            {piece ? <b>{piece}</b> : null}
          </span>
        ))}
      </div>
      <div className="victory-effect-banner">
        <span>{isDraw ? "경기 종료" : "승리"}</span>
        <strong>{winnerLabel}</strong>
        <small>{game.title}</small>
      </div>
    </div>
  );
}

function playerAccent(player: PlayerSnapshot) {
  return seatAccentColors[(Math.max(1, player.seat) - 1) % seatAccentColors.length];
}

function PlayerAvatarMark({
  avatar,
  className = "",
  label
}: {
  avatar?: PlayerAvatar | null;
  className?: string;
  label?: string;
}) {
  const safeAvatar = normalizeAvatar(avatar);
  return <PlayerTokenPawn avatar={safeAvatar} className={`player-avatar-mark ${className}`} label={label} />;
}

function phaseName(phase: string) {
  const labels: Record<string, string> = {
    selecting: "선택",
    complete: "완료",
    finished: "종료",
    playing: "진행",
    guessing: "추측",
    decide: "연속 추측 선택",
    setup: "준비",
    rolling: "주사위",
    drawing: "그리기",
    scanning: "스캔",
    "round-complete": "라운드 종료",
    "ring-placement": "링 배치",
    move: "이동",
    "remove-row": "줄 제거"
  };
  return labels[phase] ?? "진행";
}

function formatTimer(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function manualTurnEndRestriction(gameId: string | null | undefined, phase: string) {
  if (gameId === "guryongtu" && phase === "selecting") {
    return "구룡투는 각자 비공개 타일을 내야 합니다. 턴 종료 대신 타일을 선택하세요.";
  }
  if (gameId === "quoridor" && phase === "playing") {
    return "쿼리도는 말 이동 또는 벽 배치를 해야 턴이 끝납니다. 시간이 초과되면 차례가 넘어갑니다.";
  }
  if (gameId === "abalone-classic" && phase === "playing") {
    return "아발론은 구슬을 이동해야 턴이 끝납니다. 시간이 초과되면 차례가 넘어갑니다.";
  }
  if (gameId === "ghosts" && phase === "playing") {
    return "고스트는 유령 이동을 해야 턴이 끝납니다. 시간이 초과되면 차례가 넘어갑니다.";
  }
  if (gameId === "qawale" && phase === "playing") {
    return "카왈레는 스택 분배를 해야 턴이 끝납니다. 시간이 초과되면 차례가 넘어갑니다.";
  }
  if (gameId === "omok" && phase === "playing") {
    return "오목은 빈 교차점에 돌을 놓아야 턴이 끝납니다.";
  }
  if (gameId === "alkkagi" && phase === "playing") {
    return "알까기는 알을 튕겨야 턴이 끝납니다.";
  }
  if (gameId === "kkukkkuki" && (phase === "playing" || phase === "choose-line" || phase === "choose-piece")) {
    return "꾹꾹이는 말 배치와 승급/회수 단계를 직접 처리해야 턴이 끝납니다.";
  }
  if (gameId === "davinci-code-plus" && (phase === "draw" || phase === "guessing")) {
    return "타일을 뽑고 추측해야 턴을 넘길 수 있습니다. 시간이 초과되면 자동 오답 페널티가 적용됩니다.";
  }
  if (gameId === "yacht-dice" && phase === "rolling") {
    return "요트 다이스는 점수칸을 기록해야 턴이 끝납니다. 시간이 초과되면 가장 낮은 가능 점수칸이 자동 기록됩니다.";
  }
  if (gameId === "yinsh" && (phase === "ring-placement" || phase === "move" || phase === "remove-row")) {
    return "인쉬는 현재 단계의 링 배치, 이동, 줄 제거를 완료해야 턴이 끝납니다. 시간이 초과되면 방장이 처리할 수 있습니다.";
  }
  if (gameId === "hangman-board-game" && phase === "guessing") {
    return "행맨은 글자나 단어를 추측해야 턴이 진행됩니다. 시간이 초과되면 차례가 넘어갑니다.";
  }
  return "";
}

function App() {
  const [name, setName] = useState(() => localStorage.getItem(storageKeys.name) ?? createDefaultName());
  const [avatar, setAvatar] = useState(() => readSavedAvatar());
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerId, setPlayerId] = useState(() => localStorage.getItem(storageKeys.playerId) ?? "");
  const [clientKey, setClientKey] = useState(() => readOrCreateClientKey());
  const [lastRoomCode, setLastRoomCode] = useState(() => localStorage.getItem(storageKeys.roomCode) ?? "");
  const [connection, setConnection] = useState<"connecting" | "connected" | "offline">("connecting");
  const [roomList, setRoomList] = useState<PublicRoomListItem[]>([]);
  const [roomListLoading, setRoomListLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const resumeStateRef = useRef({
    avatar,
    clientKey: "",
    inFlight: false,
    key: "",
    name: "",
    playerId: "",
    roomCode: ""
  });

  useEffect(() => {
    resumeStateRef.current.name = name;
    resumeStateRef.current.avatar = avatar;
    resumeStateRef.current.playerId = playerId;
    resumeStateRef.current.clientKey = clientKey;
    resumeStateRef.current.roomCode = room?.code ?? lastRoomCode;
    if (!resumeStateRef.current.roomCode) {
      resumeStateRef.current.key = "";
      resumeStateRef.current.inFlight = false;
    }
  }, [avatar, clientKey, lastRoomCode, name, playerId, room?.code]);

  useEffect(() => {
    socket.connect();

    const handleConnect = () => {
      setConnection("connected");
      void refreshRoomList(false);
      void resumeSocketRoom();
    };
    const handleDisconnect = () => setConnection("offline");
    const handleRoomState = (nextRoom: RoomSnapshot) => setRoom(nextRoom);
    const handleRoomList = (nextRooms: PublicRoomListItem[]) => {
      setRoomList(nextRooms);
      setRoomListLoading(false);
    };
    const handleRoomDeleted = (payload: { code?: string; reason?: string }) => {
      const deletedCode = String(payload?.code ?? "").trim().toUpperCase();
      if (!deletedCode) {
        return;
      }
      setRoom((currentRoom) => {
        if (currentRoom?.code !== deletedCode) {
          return currentRoom;
        }
        return null;
      });
      setLastRoomCode((savedCode) => {
        if (savedCode !== deletedCode) {
          return savedCode;
        }
        return "";
      });
      setNotice(payload?.reason ?? "방이 삭제되었습니다.");
      void refreshRoomList(false);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:state", handleRoomState);
    socket.on("rooms:list", handleRoomList);
    socket.on("room:deleted", handleRoomDeleted);
    void refreshRoomList(false);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:state", handleRoomState);
      socket.off("rooms:list", handleRoomList);
      socket.off("room:deleted", handleRoomDeleted);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKeys.name, name);
  }, [name]);

  useEffect(() => {
    localStorage.setItem(storageKeys.avatar, JSON.stringify(avatar));
  }, [avatar]);

  useEffect(() => {
    if (playerId) {
      localStorage.setItem(storageKeys.playerId, playerId);
    }
  }, [playerId]);

  useEffect(() => {
    if (lastRoomCode) {
      localStorage.setItem(storageKeys.roomCode, lastRoomCode);
    } else {
      localStorage.removeItem(storageKeys.roomCode);
    }
  }, [lastRoomCode]);

  useEffect(() => {
    if (!lastRoomCode || room || roomListLoading || connection !== "connected") {
      return;
    }
    if (!roomList.some((openRoom) => openRoom.code === lastRoomCode)) {
      setLastRoomCode("");
    }
  }, [connection, lastRoomCode, room, roomList, roomListLoading]);

  useEffect(() => {
    const postGameNotice = String(room?.gameState.postGameNotice ?? "").trim();
    if (postGameNotice) {
      setNotice(postGameNotice);
    }
  }, [room?.gameState.postGameNotice]);

  const currentPlayer = useMemo(
    () => room?.players.find((player) => player.id === playerId) ?? null,
    [playerId, room]
  );

  const selectedGame = useMemo(() => getGameById(room?.selectedGameId), [room?.selectedGameId]);

  async function refreshRoomList(showError = true) {
    setRoomListLoading(true);
    try {
      setRoomList(await fetchJson<PublicRoomListItem[]>("/api/rooms"));
    } catch (error) {
      if (showError) {
        setNotice(error instanceof Error ? error.message : "방 목록을 불러올 수 없습니다.");
      }
    } finally {
      setRoomListLoading(false);
    }
  }

  async function handleCreateRoom(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    const response = await emitWithAck<JoinResult>("room:create", { name, clientKey, avatar });
    if (!response.ok || !response.data) {
      setNotice(response.error ?? "방을 만들 수 없습니다.");
      return;
    }

    setPlayerId(response.data.playerId);
    setRoom(response.data.room);
    setLastRoomCode(response.data.room.code);
  }

  async function joinRoomByCode(code: string) {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) return;
    setNotice("");
    const response = await emitWithAck<JoinResult>("room:join", { code: normalizedCode, name, playerId, clientKey, avatar });
    if (!response.ok || !response.data) {
      setNotice(response.error ?? "방에 입장할 수 없습니다.");
      return;
    }

    setPlayerId(response.data.playerId);
    setRoom(response.data.room);
    setLastRoomCode(response.data.room.code);
  }

  async function resumeSavedRoom() {
    if (!lastRoomCode) return;
    setNotice("");
    const response = await emitWithAck<JoinResult>("room:resume", {
      code: lastRoomCode,
      name,
      playerId,
      clientKey,
      avatar
    });
    if (!response.ok || !response.data) {
      setLastRoomCode("");
      void refreshRoomList(false);
      setNotice(response.error ?? "저장된 방으로 돌아갈 수 없습니다.");
      return;
    }

    setPlayerId(response.data.playerId);
    setRoom(response.data.room);
    setLastRoomCode(response.data.room.code);
  }

  async function resumeSocketRoom() {
    const saved = resumeStateRef.current;
    const code = saved.roomCode.trim().toUpperCase();
    const savedClientKey = saved.clientKey;
    const savedPlayerId = saved.playerId;
    if (!code || (!savedPlayerId && !savedClientKey)) {
      return;
    }

    const reconnectKey = `${socket.id ?? "socket"}:${code}:${savedPlayerId}:${savedClientKey}`;
    if (saved.inFlight || saved.key === reconnectKey) {
      return;
    }

    saved.inFlight = true;
    const response = await emitWithAck<JoinResult>("room:resume", {
      code,
      name: saved.name,
      playerId: savedPlayerId,
      clientKey: savedClientKey,
      avatar: saved.avatar
    });
    saved.inFlight = false;

    if (!response.ok || !response.data) {
      saved.key = "";
      if (response.error?.includes("찾을 수 없습니다") || response.error?.includes("저장된 플레이어")) {
        setRoom((currentRoom) => (currentRoom?.code === code ? null : currentRoom));
        setLastRoomCode((currentCode) => (currentCode === code ? "" : currentCode));
      }
      setNotice(response.error ?? "방 연결을 복구할 수 없습니다.");
      return;
    }

    saved.key = reconnectKey;
    setPlayerId(response.data.playerId);
    setRoom(response.data.room);
    setLastRoomCode(response.data.room.code);
  }

  async function selectGame(gameId: string) {
    if (!room) return;
    const response = await emitWithAck<RoomSnapshot>("room:select-game", { code: room.code, gameId });
    if (!response.ok || !response.data) {
      setNotice(response.error ?? "게임을 선택할 수 없습니다.");
      return;
    }
    setRoom(response.data);
  }

  async function configureTimer(nextTimerMs: number) {
    if (!room) return;
    const response = await emitWithAck<RoomSnapshot>("room:configure-timer", { code: room.code, turnTimerMs: nextTimerMs });
    if (!response.ok) {
      setNotice(response.error ?? "제한 시간을 바꿀 수 없습니다.");
      return;
    }
    if (response.data) {
      setRoom(response.data);
    }
  }

  async function startGame() {
    if (!room) return;
    const response = await emitWithAck<RoomSnapshot>("room:start-game", { code: room.code });
    if (!response.ok) {
      setNotice(response.error ?? "게임을 시작할 수 없습니다.");
    }
  }

  async function returnLobby() {
    if (!room) return;
    const response = await emitWithAck<RoomSnapshot>("room:return-lobby", { code: room.code });
    if (!response.ok) {
      setNotice(response.error ?? "로비로 돌아갈 수 없습니다.");
    }
  }

  async function leaveLocalRoom() {
    const leavingRoom = room;
    if (leavingRoom) {
      const response = await emitWithAck<{ code: string; empty: boolean }>("room:leave", { code: leavingRoom.code });
      if (!response.ok) {
        setNotice(response.error ?? "방 나가기를 서버에 반영하지 못했습니다.");
      }
    }
    setRoom(null);
    setLastRoomCode("");
    setNotice("방에서 나왔습니다. 다시 플레이하려면 열린 방에 들어가거나 새 방을 만드세요.");
  }

  async function deleteLocalRoom() {
    if (!room) return;
    const confirmed = window.confirm("이 방을 삭제할까요? 들어와 있는 플레이어 모두가 방에서 나가게 됩니다.");
    if (!confirmed) {
      return;
    }
    const deletingCode = room.code;
    const response = await emitWithAck<{ code: string }>("room:delete", { code: deletingCode });
    if (!response.ok) {
      setNotice(response.error ?? "방을 삭제할 수 없습니다.");
      return;
    }
    setRoom(null);
    setLastRoomCode("");
    setNotice("방을 삭제했습니다.");
    void refreshRoomList(false);
  }

  function leaveAfterPostGame(message = "로비로 이동했습니다.") {
    setRoom(null);
    setLastRoomCode("");
    setNotice(message);
    void refreshRoomList(false);
  }

  async function resetLocalIdentity() {
    const leavingRoom = room;
    if (leavingRoom) {
      await emitWithAck<{ code: string; empty: boolean }>("room:leave", { code: leavingRoom.code });
    }
    const nextClientKey = createClientKey();
    const nextAvatar = randomAvatar();
    localStorage.removeItem(storageKeys.playerId);
    localStorage.removeItem(storageKeys.roomCode);
    localStorage.setItem(storageKeys.clientKey, nextClientKey);
    localStorage.setItem(storageKeys.avatar, JSON.stringify(nextAvatar));
    setClientKey(nextClientKey);
    setAvatar(nextAvatar);
    setPlayerId("");
    setLastRoomCode("");
    setRoom(null);
    setNotice("이 브라우저의 저장된 방/플레이어 연결을 지우고 새 손님으로 시작합니다.");
  }

  return (
    <div className={`app-shell ${room ? `has-room ${room.status === "lobby" ? "is-lobby" : "is-playing"}` : "is-home"}`}>
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <img src="/brand/brand-mark.svg" alt="" />
        </div>
        <div>
          <h1>Board Game Room</h1>
        </div>
      </header>

      <main id="main">
        {room ? (
          <RoomView
            room={room}
            currentPlayer={currentPlayer}
            selectedGame={selectedGame}
            notice={notice}
            onSelectGame={selectGame}
            onConfigureTimer={configureTimer}
            onStartGame={startGame}
            onReturnLobby={returnLobby}
            onLeaveLocalRoom={leaveLocalRoom}
            onDeleteLocalRoom={deleteLocalRoom}
            onPostGameLeave={leaveAfterPostGame}
          />
        ) : (
          <HomeView
            name={name}
            notice={notice}
            connection={connection}
            lastRoomCode={lastRoomCode}
            rooms={roomList}
            roomsLoading={roomListLoading}
            onNameChange={setName}
            avatar={avatar}
            onAvatarChange={setAvatar}
            onCreateRoom={handleCreateRoom}
            onJoinListedRoom={joinRoomByCode}
            onRefreshRooms={() => void refreshRoomList()}
            onResumeSavedRoom={resumeSavedRoom}
            onResetLocalIdentity={resetLocalIdentity}
          />
        )}
      </main>
    </div>
  );
}

function HomeView(props: {
  name: string;
  avatar: PlayerAvatar;
  notice: string;
  connection: "connecting" | "connected" | "offline";
  lastRoomCode: string;
  rooms: PublicRoomListItem[];
  roomsLoading: boolean;
  onNameChange: (value: string) => void;
  onAvatarChange: (value: PlayerAvatar) => void;
  onCreateRoom: (event: FormEvent) => void;
  onJoinListedRoom: (code: string) => void;
  onRefreshRooms: () => void;
  onResumeSavedRoom: () => void;
  onResetLocalIdentity: () => void;
}) {
  return <InteractiveCafeHome {...props} />;
}

function LegacyHomeView({
  name,
  avatar,
  notice,
  connection,
  lastRoomCode,
  rooms,
  roomsLoading,
  onNameChange,
  onAvatarChange,
  onCreateRoom,
  onJoinListedRoom,
  onRefreshRooms,
  onResumeSavedRoom,
  onResetLocalIdentity
}: {
  name: string;
  avatar: PlayerAvatar;
  notice: string;
  connection: "connecting" | "connected" | "offline";
  lastRoomCode: string;
  rooms: PublicRoomListItem[];
  roomsLoading: boolean;
  onNameChange: (value: string) => void;
  onAvatarChange: (value: PlayerAvatar) => void;
  onCreateRoom: (event: FormEvent) => void;
  onJoinListedRoom: (code: string) => void;
  onRefreshRooms: () => void;
  onResumeSavedRoom: () => void;
  onResetLocalIdentity: () => void;
}) {
  const disabled = connection !== "connected";
  const hasRooms = rooms.length > 0;
  const savedRoom = lastRoomCode ? rooms.find((openRoom) => openRoom.code === lastRoomCode) ?? null : null;
  const [focusedRoomCode, setFocusedRoomCode] = useState("");
  const [tablePointer, setTablePointer] = useState({ x: 50, y: 50 });
  const focusedRoom = rooms.find((openRoom) => openRoom.code === focusedRoomCode) ?? savedRoom ?? rooms[0] ?? null;
  const tablePieceCount = hasRooms ? Math.min(10, Math.max(5, rooms.length + 3)) : 7;
  const focusedRoomOwner = focusedRoom?.hostName ? `${focusedRoom.hostName}의 방` : "열린 방 없음";
  const focusedRoomCanUse = focusedRoom ? focusedRoom.canJoin || focusedRoom.code === lastRoomCode : false;

  useEffect(() => {
    if (focusedRoomCode && !rooms.some((openRoom) => openRoom.code === focusedRoomCode)) {
      setFocusedRoomCode("");
    }
  }, [focusedRoomCode, rooms]);

  function moveHomeTablePointer(event: ReactPointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setTablePointer({
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
    });
  }

  return (
    <section className="home-console home-lounge home-gallery interactive-home" aria-labelledby="home-title">
      <div className="home-stage">
        <div className="home-room-board">
          <div className="table-micro-pieces" aria-hidden="true">
            {Array.from({ length: tablePieceCount }, (_, index) => (
              <span key={index} style={{ "--piece-index": index } as CSSProperties} />
            ))}
          </div>

          <div
            className={`home-tabletop-preview ${focusedRoom ? "has-room" : "is-empty"}`}
            style={{ "--pointer-x": `${tablePointer.x}%`, "--pointer-y": `${tablePointer.y}%` } as CSSProperties}
            onPointerMove={moveHomeTablePointer}
            aria-live="polite"
          >
            <div className="home-tabletop-rail" aria-hidden="true">
              {Array.from({ length: focusedRoom?.maxPlayers ?? 4 }, (_, index) => (
                <span
                  key={index}
                  className={focusedRoom && index < focusedRoom.playerCount ? "filled" : ""}
                  style={{ "--seat-index": index } as CSSProperties}
                />
              ))}
            </div>
            <div className="home-tabletop-card">
              <span className="eyebrow">LIVE TABLE</span>
              <strong>{focusedRoomOwner}</strong>
              <small>
                {focusedRoom
                  ? `${focusedRoom.playerCount}/${focusedRoom.maxPlayers}명 · ${focusedRoom.selectedGameTitle ?? "게임 선택 전"}`
                  : "방을 만들면 이 테이블에 바로 올라옵니다"}
              </small>
            </div>
            {focusedRoom ? (
              <BoardButton
                className="home-tabletop-join"
                tone={focusedRoomCanUse ? "primary" : "secondary"}
                type="button"
                disabled={disabled || !name.trim() || !focusedRoomCanUse}
                onClick={focusedRoom.code === lastRoomCode ? onResumeSavedRoom : () => onJoinListedRoom(focusedRoom.code)}
              >
                {focusedRoom.code === lastRoomCode ? "복귀" : focusedRoom.canJoin ? "입장" : "대기"}
              </BoardButton>
            ) : null}
          </div>

          <div className="room-browser-heading">
            <div className="room-browser-title">
              <span className="eyebrow">로비</span>
              <h2 id="home-title">방 목록</h2>
              <span>테이블을 고르고 바로 앉기</span>
            </div>
            <div className="room-browser-meta" aria-label="열린 방 수">
              <Users size={15} aria-hidden="true" />
              <strong>{rooms.length}</strong>
              <span>열림</span>
            </div>
          </div>

          {roomsLoading ? (
            <div className="room-list-placeholder" role="status">
              방 목록을 확인하고 있습니다.
            </div>
          ) : hasRooms ? (
            <div className="room-table" aria-label="입장 가능한 방">
              <div className="room-table-head" aria-hidden="true">
                <span>방</span>
                <span>인원</span>
                <span>게임</span>
                <span>상태</span>
                <span />
              </div>
              <div className="room-list">
                {rooms.map((openRoom, index) => {
                  const canResume = lastRoomCode === openRoom.code;
                  const canUseRoom = openRoom.canJoin || canResume;
                  const roomOwnerLabel = openRoom.hostName ? `${openRoom.hostName}의 방` : "이름 없는 방";
                  return (
                    <article
                      className={`room-card ${openRoom.canJoin ? "" : "is-locked"} ${focusedRoom?.code === openRoom.code ? "is-focused" : ""}`}
                      key={openRoom.code}
                      style={{ "--room-index": index } as CSSProperties}
                      onMouseEnter={() => setFocusedRoomCode(openRoom.code)}
                      onFocus={() => setFocusedRoomCode(openRoom.code)}
                      aria-current={focusedRoom?.code === openRoom.code ? "true" : undefined}
                    >
                      <div className="room-card-main">
                        <div className="room-card-title">
                          {openRoom.hostAvatar ? (
                            <PlayerAvatarMark
                              avatar={openRoom.hostAvatar}
                              className="room-host-avatar"
                              label={`${openRoom.hostName ?? "방장"} 아이콘`}
                            />
                          ) : null}
                          <span className="room-owner-chip">
                            {roomOwnerLabel}
                          </span>
                        </div>
                        <div className="room-card-meta">
                          <span>
                            {formatTime(openRoom.createdAt)}
                          </span>
                        </div>
                      </div>
                      <span className="room-count-chip">
                        <span className="room-count-text">{openRoom.playerCount}/{openRoom.maxPlayers}</span>
                        <span className="room-seat-dots" aria-hidden="true">
                          {Array.from({ length: openRoom.maxPlayers }, (_, seatIndex) => (
                            <i key={seatIndex} className={seatIndex < openRoom.playerCount ? "filled" : ""} />
                          ))}
                        </span>
                      </span>
                      <p className="room-card-game">
                        {openRoom.selectedGameTitle ?? "선택 전"}
                      </p>
                      <span className={`room-state-chip ${openRoom.status}`}>
                        {openRoom.status === "playing" ? "게임 중" : openRoom.canJoin ? "입장 가능" : "만석"}
                      </span>
                      <BoardButton
                        tone={openRoom.canJoin || canResume ? "primary" : "secondary"}
                        type="button"
                        disabled={disabled || !name.trim() || !canUseRoom}
                        onClick={canResume ? onResumeSavedRoom : () => onJoinListedRoom(openRoom.code)}
                      >
                        {canResume ? "복귀" : openRoom.canJoin ? "입장" : "대기"}
                      </BoardButton>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="room-list-placeholder compact-empty-room">
              <div className="empty-table-scene" aria-hidden="true">
                <span className="empty-seat top" />
                <span className="empty-seat right" />
                <span className="empty-seat bottom" />
                <span className="empty-seat left" />
                <span className="empty-table-center">0</span>
              </div>
              <div>
                <h3>열린 방이 없습니다</h3>
                <p>방을 만들면 다른 플레이어가 목록에서 바로 들어옵니다.</p>
              </div>
            </div>
          )}
        </div>

        <form className="home-command-bar" aria-label="방 만들기" onSubmit={onCreateRoom}>
          <label className="home-name-field" htmlFor="player-name">
            <span>플레이어</span>
            <input
              id="player-name"
              value={name}
              maxLength={16}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
          <AvatarCustomizer avatar={avatar} onChange={onAvatarChange} />

          <div className="home-command-actions">
            <BoardButton
              className="utility-button"
              type="button"
              onClick={onRefreshRooms}
              disabled={roomsLoading}
              aria-label="방 목록 새로고침"
              title="방 목록 새로고침"
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span className="button-label">갱신</span>
            </BoardButton>
            {savedRoom ? (
              <BoardButton
                className="saved-room-button utility-button"
                type="button"
                onClick={onResumeSavedRoom}
                disabled={disabled}
                aria-label="최근 방 복귀"
                title="최근 방 복귀"
              >
                <DoorOpen size={15} aria-hidden="true" />
                <span className="button-label">복귀</span>
              </BoardButton>
            ) : null}
            <BoardButton
              className="utility-button"
              type="button"
              onClick={onResetLocalIdentity}
              aria-label="새 손님으로 시작"
              title="새 손님으로 시작"
            >
              <Trash2 size={15} aria-hidden="true" />
              <span className="button-label">초기화</span>
            </BoardButton>
            <BoardButton tone="primary" type="submit" disabled={disabled || !name.trim()}>
              <Dice5 size={16} aria-hidden="true" />
              방 만들기
            </BoardButton>
          </div>
        </form>
      </div>

      {notice ? <p className="notice" role="alert">{notice}</p> : null}
    </section>
  );
}

function AvatarCustomizer({ avatar, onChange }: { avatar: PlayerAvatar; onChange: (value: PlayerAvatar) => void }) {
  const [open, setOpen] = useState(false);

  function updateAvatar(next: Partial<PlayerAvatar>) {
    onChange(normalizeAvatar({ ...avatar, ...next }));
  }

  return (
    <div className={`avatar-customizer ${open ? "is-open" : ""}`}>
      <button
        className="avatar-customizer-toggle"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <PlayerAvatarMark avatar={avatar} label={`내 말 아이콘, ${avatarDescription(avatar)}`} />
        <span>
          <strong>내 말</strong>
          <small>{avatarDescription(avatar)}</small>
        </span>
        <Palette size={16} aria-hidden="true" />
      </button>

      {open ? (
        <div className="avatar-customizer-panel">
          <div className="avatar-preset-strip" aria-label="아이콘 프리셋">
            {avatarPresets.map((preset) => {
              const selected =
                preset.avatar.body === avatar.body &&
                preset.avatar.face === avatar.face &&
                preset.avatar.accessory === avatar.accessory &&
                preset.avatar.palette === avatar.palette;
              return (
                <button
                  className={`avatar-preset ${selected ? "selected" : ""}`}
                  key={preset.label}
                  type="button"
                  onClick={() => onChange(preset.avatar)}
                  aria-pressed={selected}
                >
                  <PlayerAvatarMark avatar={preset.avatar} />
                  <span>{preset.label}</span>
                </button>
              );
            })}
            <button className="avatar-preset avatar-random" type="button" onClick={() => onChange(randomAvatar())}>
              <Shuffle size={16} aria-hidden="true" />
              <span>랜덤</span>
            </button>
          </div>

          <AvatarOptionGroup
            label="몸"
            options={avatarBodyOptions}
            value={avatar.body}
            onChange={(body) => updateAvatar({ body })}
          />
          <AvatarOptionGroup
            label="표정"
            options={avatarFaceOptions}
            value={avatar.face}
            onChange={(face) => updateAvatar({ face })}
          />
          <AvatarOptionGroup
            label="장식"
            options={avatarAccessoryOptions}
            value={avatar.accessory}
            onChange={(accessory) => updateAvatar({ accessory })}
          />
          <div className="avatar-option-group avatar-color-group">
            <span>색</span>
            <div>
              {avatarPaletteOptions.map((palette) => (
                <button
                  className={`avatar-color-swatch ${avatar.palette === palette.id ? "selected" : ""}`}
                  key={palette.id}
                  type="button"
                  onClick={() => updateAvatar({ palette: palette.id })}
                  aria-label={palette.label}
                  aria-pressed={avatar.palette === palette.id}
                  style={
                    {
                      "--avatar-base": palette.base,
                      "--avatar-light": palette.light,
                      "--avatar-dark": palette.dark,
                      "--avatar-accent": palette.accent
                    } as CSSProperties
                  }
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AvatarOptionGroup<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="avatar-option-group">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            className={value === option.id ? "selected" : ""}
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
          >
            {option.id === "spark" ? <Star size={13} aria-hidden="true" /> : null}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsDashboard({ playerName, clientKey }: { playerName: string; clientKey: string }) {
  const [gameId, setGameId] = useState("all");
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [recentMatches, setRecentMatches] = useState<MatchRecord[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const query = gameId === "all" ? "" : `&gameId=${encodeURIComponent(gameId)}`;
    const player = playerName.trim();

    async function loadStats() {
      setLoading(true);
      setError("");
      try {
        const [nextSummary, nextLeaderboard, nextRecent, nextPlayerStats] = await Promise.all([
          fetchJson<StatsSummary>("/api/stats/summary"),
          fetchJson<LeaderboardEntry[]>(`/api/stats/leaderboard?limit=8${query}`),
          fetchJson<MatchRecord[]>("/api/stats/recent?limit=6"),
          clientKey
            ? fetchJson<PlayerStatsResponse>(
                `/api/stats/identity/${encodeURIComponent(clientKey)}?name=${encodeURIComponent(player || "플레이어")}&limit=5`
              )
            : player
              ? fetchJson<PlayerStatsResponse>(`/api/stats/player/${encodeURIComponent(player)}?limit=5`)
            : Promise.resolve(null)
        ]);

        if (!active) return;
        setSummary(nextSummary);
        setLeaderboard(nextLeaderboard);
        setRecentMatches(nextRecent);
        setPlayerStats(nextPlayerStats);
      } catch (statsError) {
        if (!active) return;
        setError(statsError instanceof Error ? statsError.message : "통계를 불러올 수 없습니다.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadStats();
    return () => {
      active = false;
    };
  }, [clientKey, gameId, playerName, refreshKey]);

  const selectedGameTitle = gameId === "all" ? "전체 게임" : getGameById(gameId)?.title ?? "선택한 게임";
  const topPlayer = leaderboard[0];

  return (
    <section className="stats-panel home-stats" aria-labelledby="stats-title">
      <div className="panel-header stats-heading">
        <div>
          <span className="eyebrow">누적 기록</span>
          <h2 id="stats-title">
            <BarChart3 size={19} aria-hidden="true" />
            전적과 랭킹
          </h2>
          <p>{selectedGameTitle} 기준</p>
        </div>
        <div className="stats-tools">
          <label className="visually-hidden" htmlFor="stats-game-filter">
            랭킹 게임 선택
          </label>
          <select id="stats-game-filter" value={gameId} onChange={(event) => setGameId(event.target.value)}>
            <option value="all">전체 게임</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.title}
              </option>
            ))}
          </select>
          <button className="icon-button" type="button" onClick={() => setRefreshKey((value) => value + 1)} aria-label="통계 새로고침" title="통계 새로고침">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="stats-metrics" aria-label="통계 요약">
        <div className="metric-chip">
          <History size={17} aria-hidden="true" />
          <span>경기</span>
          <strong>{summary?.totalMatches ?? 0}</strong>
        </div>
        <div className="metric-chip">
          <Users size={17} aria-hidden="true" />
          <span>플레이어</span>
          <strong>{summary?.totalPlayers ?? 0}</strong>
        </div>
        <div className="metric-chip">
          <Trophy size={17} aria-hidden="true" />
          <span>선두</span>
          <strong>{topPlayer?.playerName ?? "-"}</strong>
        </div>
      </div>

      {error ? <p className="notice" role="status">{error}</p> : null}

      <div className="stats-grid">
        <article className="stats-block leaderboard-block">
          <div className="stats-block-title">
            <Medal size={18} aria-hidden="true" />
            <h3>랭킹</h3>
          </div>
          <div className="stat-table-wrap">
            {leaderboard.length > 0 ? (
              <table className="stat-table">
                <thead>
                  <tr>
                  <th>순위</th>
                  <th>플레이어</th>
                  <th>게임</th>
                  <th>
                    <span className="stat-th-label">
                      <Trophy size={13} aria-hidden="true" />
                      승률
                    </span>
                  </th>
                  <th>
                    <span className="stat-th-label">
                      <History size={13} aria-hidden="true" />
                      전적
                    </span>
                  </th>
                  <th>
                    <span className="stat-th-label">
                      <Gauge size={13} aria-hidden="true" />
                      평균
                    </span>
                  </th>
                  <th>
                    <span className="stat-th-label">
                      <Star size={13} aria-hidden="true" />
                      최고
                    </span>
                  </th>
                </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, index) => (
                    <tr key={`${entry.playerKey}-${entry.gameId}`}>
                      <td>{index + 1}</td>
                      <td>
                        <strong>{entry.playerName}</strong>
                      </td>
                      <td>{entry.gameTitle}</td>
                      <td>
                        <span className="rate-pill">{formatPercent(entry.winRate)}</span>
                      </td>
                      <td>
                        {entry.wins}승 {entry.losses}패 {entry.draws ? `${entry.draws}무` : ""}
                      </td>
                      <td>{formatScore(entry.averageScore)}</td>
                      <td>{formatScore(entry.highScore)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="helper-text">{loading ? "통계를 불러오는 중입니다." : "아직 기록된 경기가 없습니다."}</p>
            )}
          </div>
        </article>

        <article className="stats-block player-block">
          <div className="stats-block-title">
            <Trophy size={18} aria-hidden="true" />
            <h3>내 전적</h3>
          </div>
          {playerStats?.entries.length ? (
            <div className="player-stat-list">
              {playerStats.entries.slice(0, 5).map((entry) => {
                const game = getGameById(entry.gameId);
                return (
                  <div className="player-stat-row" key={`${entry.playerKey}-${entry.gameId}`}>
                    <span className="stat-game-icon" aria-hidden="true">
                      {game ? <GameKindIcon game={game} size={15} /> : <Gamepad2 size={15} />}
                    </span>
                    <div>
                      <strong>{entry.gameTitle}</strong>
                      <span>{entry.gamesPlayed}전 · 최근 {formatDateTime(entry.lastPlayedAt)}</span>
                    </div>
                    <span className="rate-pill">{formatPercent(entry.winRate)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="helper-text">{loading ? "전적을 확인하고 있습니다." : "이 이름으로 저장된 전적이 없습니다."}</p>
          )}
        </article>

        <article className="stats-block recent-block">
          <div className="stats-block-title">
            <History size={18} aria-hidden="true" />
            <h3>최근 경기</h3>
          </div>
          {recentMatches.length > 0 ? (
            <div className="recent-match-list">
              {recentMatches.map((match) => {
                const game = getGameById(match.gameId);
                return (
                  <div className="recent-match-row" key={match.id}>
                    <span className="stat-game-icon" aria-hidden="true">
                      {game ? <GameKindIcon game={game} size={15} /> : <Gamepad2 size={15} />}
                    </span>
                    <div>
                      <strong>{match.gameTitle}</strong>
                      <span>{formatDateTime(match.finishedAt)}</span>
                    </div>
                    <div className="match-result">
                      <span>{winnerLabel(match)}</span>
                      <small>{match.players.map((player) => `${player.playerName} ${formatScore(player.score)}`).join(" · ")}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="helper-text">{loading ? "최근 경기를 불러오는 중입니다." : "최근 경기 기록이 없습니다."}</p>
          )}
        </article>
      </div>
    </section>
  );
}

function winnerLabel(match: MatchRecord) {
  if (match.winnerIds.length === 0) {
    return "무승부";
  }
  return match.players
    .filter((player) => match.winnerIds.includes(player.playerId))
    .map((player) => player.playerName)
    .join(", ");
}

function RoomView({
  room,
  currentPlayer,
  selectedGame,
  notice,
  onSelectGame,
  onConfigureTimer,
  onStartGame,
  onReturnLobby,
  onLeaveLocalRoom,
  onDeleteLocalRoom,
  onPostGameLeave
}: {
  room: RoomSnapshot;
  currentPlayer: PlayerSnapshot | null;
  selectedGame: GameDefinition | null;
  notice: string;
  onSelectGame: (gameId: string) => void;
  onConfigureTimer: (nextTimerMs: number) => void;
  onStartGame: () => void;
  onReturnLobby: () => void;
  onLeaveLocalRoom: () => void;
  onDeleteLocalRoom: () => void;
  onPostGameLeave: (message?: string) => void;
}) {
  const playerCount = room.players.filter((player) => player.connected).length;
  const activePlayer = room.players.find((player) => player.id === room.gameState.activePlayerId) ?? null;
  const currentRoomPlayer = currentPlayer ? room.players.find((player) => player.id === currentPlayer.id) ?? currentPlayer : null;
  const isHost = Boolean(currentRoomPlayer?.isHost);
  const canStart = Boolean(selectedGame && canPlayGame(selectedGame, playerCount) && isHost);

  return (
    <section className={`room-section ${room.status === "lobby" ? "is-lobby" : "is-playing"}`} aria-label="게임 방">
      <div className={`room-layout ${room.status === "lobby" ? "interactive-lobby-layout" : ""}`}>
        {room.status !== "lobby" ? (
        <aside className="seat-panel" aria-label="플레이어">
          <div className="panel-header seat-panel-header">
            <div className="seat-panel-title">
              <h2>플레이어</h2>
              <span>{playerCount}/{room.maxPlayers}</span>
            </div>
            <div className="seat-panel-actions">
              <BoardIconButton
                tone={room.canDeleteRoom ? "danger" : "secondary"}
                type="button"
                onClick={room.canDeleteRoom ? onDeleteLocalRoom : onLeaveLocalRoom}
                aria-label={room.canDeleteRoom ? "방 닫기" : "현재 방 나가기"}
                title={room.canDeleteRoom ? "방 닫기" : "현재 방 나가기"}
              >
                {room.canDeleteRoom ? <Trash2 size={18} /> : <DoorOpen size={18} />}
              </BoardIconButton>
            </div>
          </div>
          <div className="seat-list">
            {Array.from({ length: room.maxPlayers }, (_, index) => {
              const seat = index + 1;
              const player = room.players.find((item) => item.seat === seat);
              return <SeatRow key={seat} seat={seat} player={player} currentPlayerId={currentRoomPlayer?.id ?? ""} />;
            })}
          </div>
          {notice ? <p className="notice" role="status">{notice}</p> : null}
        </aside>
        ) : null}

        {room.status === "lobby" ? (
          <LobbyPanel
            room={room}
            isHost={isHost}
            playerCount={playerCount}
            selectedGame={selectedGame}
            canStart={canStart}
            onSelectGame={onSelectGame}
            onConfigureTimer={onConfigureTimer}
            onStartGame={onStartGame}
            onLeaveRoom={onLeaveLocalRoom}
            onDeleteRoom={onDeleteLocalRoom}
          />
        ) : (
          <PlayPanel
            room={room}
            currentPlayer={currentRoomPlayer}
            selectedGame={selectedGame}
            activePlayer={activePlayer}
            isHost={isHost}
            onReturnLobby={onReturnLobby}
            onLeaveLocalRoom={onLeaveLocalRoom}
            onPostGameLeave={onPostGameLeave}
          />
        )}

      </div>
    </section>
  );
}

function SeatRow({
  seat,
  player,
  currentPlayerId
}: {
  seat: number;
  player?: PlayerSnapshot;
  currentPlayerId: string;
}) {
  const isCurrent = player?.id === currentPlayerId;
  const RoleIcon = player?.isHost ? Crown : isCurrent ? UserCheck : player ? Users : null;
  const ConnectionIcon = player ? (player.connected ? CheckCircle2 : WifiOff) : null;
  const roleLabel = player?.isHost ? "방장" : player ? "참가자" : "대기";
  const connectionLabel = player?.connected ? "연결됨" : player ? "재접속 대기" : "";

  return (
    <div className={`seat-row ${player ? "filled" : ""} ${isCurrent ? "current" : ""} ${player && !player.connected ? "offline" : ""}`}>
      <span className="seat-number">{seat}</span>
      {player ? <PlayerAvatarMark avatar={player.avatar} className="seat-avatar" label={`${player.name} 아이콘`} /> : null}
      <div>
        <strong>{player?.name ?? "빈 좌석"}</strong>
        <span>
          {RoleIcon ? <RoleIcon className="seat-role-icon" size={14} aria-hidden="true" /> : null}
          {roleLabel} {isCurrent ? "· 나" : ""}
        </span>
      </div>
      {ConnectionIcon ? <ConnectionIcon className="seat-connection-icon" size={18} aria-label={connectionLabel} /> : null}
    </div>
  );
}

function LobbyPanel(props: {
  room: RoomSnapshot;
  isHost: boolean;
  playerCount: number;
  selectedGame: GameDefinition | null;
  canStart: boolean;
  onSelectGame: (gameId: string) => void;
  onConfigureTimer: (nextTimerMs: number) => void;
  onStartGame: () => void;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
}) {
  return <InteractiveGameLobby {...props} />;
}

function LegacyLobbyPanel({
  room,
  isHost,
  playerCount,
  selectedGame,
  canStart,
  onSelectGame,
  onConfigureTimer,
  onStartGame
}: {
  room: RoomSnapshot;
  isHost: boolean;
  playerCount: number;
  selectedGame: GameDefinition | null;
  canStart: boolean;
  onSelectGame: (gameId: string) => void;
  onConfigureTimer: (nextTimerMs: number) => void;
  onStartGame: () => void;
}) {
  const eligibleGames = games.filter((game) => canPlayGame(game, playerCount));
  const usesTurnTimer = gameUsesTurnTimer(selectedGame?.id);
  const turnTimerMs = room.gameState.turnTimerMs ?? 120_000;
  const defaultPreviewGame = selectedGame ?? eligibleGames[0] ?? games[0] ?? null;
  const [previewGameId, setPreviewGameId] = useState(() => defaultPreviewGame?.id ?? "");
  const [dragGameId, setDragGameId] = useState<string | null>(null);
  const [placedGameId, setPlacedGameId] = useState(() => selectedGame?.id ?? defaultPreviewGame?.id ?? "");
  const [tablePointer, setTablePointer] = useState({ x: 50, y: 48 });
  const [lastPickerGesture, setLastPickerGesture] = useState<"browse" | "tap" | "drag" | "drop">("browse");
  const selectionRequestRef = useRef<string | null>(null);
  const previewGame = getGameById(previewGameId) ?? defaultPreviewGame;
  const placedGame = getGameById(placedGameId) ?? previewGame;
  const previewAvailable = previewGame ? canPlayGame(previewGame, playerCount) : false;
  const placedAvailable = placedGame ? canPlayGame(placedGame, playerCount) : false;
  const previewPieces = placedGame ? victoryPiecesFor(placedGame).slice(0, 12) : [];

  useEffect(() => {
    if (selectedGame?.id) {
      setPreviewGameId(selectedGame.id);
      setPlacedGameId(selectedGame.id);
      return;
    }
    if (defaultPreviewGame?.id && !getGameById(previewGameId)) {
      setPreviewGameId(defaultPreviewGame.id);
      setPlacedGameId(defaultPreviewGame.id);
    }
  }, [defaultPreviewGame?.id, previewGameId, selectedGame?.id]);

  useEffect(() => {
    if (selectionRequestRef.current === selectedGame?.id) {
      selectionRequestRef.current = null;
    }
  }, [selectedGame?.id]);

  async function selectGame(game: GameDefinition) {
    const available = canPlayGame(game, playerCount);
    if (!isHost || !available || room.selectedGameId === game.id || selectionRequestRef.current === game.id) {
      return;
    }
    selectionRequestRef.current = game.id;
    try {
      await onSelectGame(game.id);
    } finally {
      if (selectionRequestRef.current === game.id) {
        selectionRequestRef.current = null;
      }
    }
  }

  function chooseGame(game: GameDefinition) {
    setPreviewGameId(game.id);
    setPlacedGameId(game.id);
    setLastPickerGesture("tap");
    void selectGame(game);
  }

  function previewOnly(game: GameDefinition) {
    setPreviewGameId(game.id);
    if (!selectedGame) {
      setPlacedGameId(game.id);
    }
    setLastPickerGesture("browse");
  }

  function moveGameTablePointer(event: ReactPointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setTablePointer({
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
    });
  }

  function allowTableDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = isHost && placedAvailable ? "copy" : "none";
  }

  function dropGameOnTable(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const nextGameId = event.dataTransfer.getData("text/plain") || dragGameId || placedGame?.id || previewGame?.id || "";
    const nextGame = getGameById(nextGameId);
    if (nextGame) {
      setPreviewGameId(nextGame.id);
      setPlacedGameId(nextGame.id);
      setLastPickerGesture("drop");
      void selectGame(nextGame);
    }
    setDragGameId(null);
  }

  return (
    <section className="work-panel lobby-panel" aria-labelledby="lobby-title">
      <div className="panel-header lobby-panel-header">
        <div>
          <h2 id="lobby-title">게임 선택</h2>
          <p className="lobby-context">{playerCount}명</p>
        </div>
        <div className="lobby-panel-actions">
          {usesTurnTimer ? (
            <label className="timer-select lobby-timer-select">
              <span>
                <Clock3 size={15} aria-hidden="true" />
                턴 제한
              </span>
              <select
                value={turnTimerMs}
                disabled={!isHost}
                onChange={(event) => onConfigureTimer(Number(event.currentTarget.value))}
              >
                {turnTimerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {placedGame ? (
        <div
          className={`game-table-preview gesture-${lastPickerGesture} ${dragGameId ? "is-dragging" : ""} ${selectedGame?.id === placedGame.id ? "is-selected is-unfolded" : "is-previewing"}`}
          style={{
            "--game-accent": placedGame.accent,
            "--pointer-x": `${tablePointer.x}%`,
            "--pointer-y": `${tablePointer.y}%`
          } as CSSProperties}
          onPointerMove={moveGameTablePointer}
          onDragOver={allowTableDrop}
          onDrop={dropGameOnTable}
          aria-live="polite"
        >
          <div className="table-preview-cover">
            <GameCoverImage game={placedGame} />
          </div>
          <div className="table-preview-board" key={`${placedGame.id}-${selectedGame?.id === placedGame.id ? "selected" : "preview"}`}>
            <div className="table-preview-topline">
              <span>
                <GameKindIcon game={placedGame} size={16} />
                {placedGame.title}
              </span>
              <strong>{formatAllowedPlayers(placedGame)}</strong>
            </div>
            <div className={`table-preview-playmat spread-${placedGame.table.kind} spread-${placedGame.id}`}>
              <BoardPreview game={placedGame} activePlayer={null} showHeader={false} />
              <div className="table-piece-rack" aria-hidden="true">
                {previewPieces.map((piece, index) => (
                  <span
                    key={`${placedGame.id}-${piece}-${index}`}
                    data-piece={piece}
                    style={{ "--piece-index": index } as CSSProperties}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="table-drop-cue" aria-hidden="true">
            {selectedGame?.id === placedGame.id ? "펼쳐짐" : isHost && placedAvailable ? "카드를 놓으면 펼쳐짐" : "미리보기"}
          </div>
        </div>
      ) : null}

      <div className="game-selection-actions">
        <div className="game-selection-current" aria-live="polite">
          <span>선택</span>
          <strong>{selectedGame ? selectedGame.title : "선택 없음"}</strong>
        </div>
        <BoardButton tone="primary" type="button" onClick={onStartGame} disabled={!canStart}>
          {selectedGame ? "시작" : "선택 필요"}
        </BoardButton>
      </div>

      <div className="game-card-grid game-box-rack" aria-label="게임 선택 카드">
        {games.map((game) => {
          const available = canPlayGame(game, playerCount);
          const selected = room.selectedGameId === game.id;
          const previewed = previewGame?.id === game.id;
          const dragging = dragGameId === game.id;
          return (
            <button
              className={`game-card-tile ${selected ? "selected" : ""} ${previewed ? "previewed" : ""} ${dragging ? "dragging" : ""} ${!isHost ? "is-view-only" : ""} ${available ? "" : "is-unavailable"}`}
              key={game.id}
              type="button"
              onClick={() => {
                chooseGame(game);
              }}
              onPointerDown={(event) => {
                if (event.pointerType === "mouse" && event.button !== 0) {
                  return;
                }
                setPreviewGameId(game.id);
                setPlacedGameId(game.id);
                setLastPickerGesture("tap");
              }}
              disabled={!available}
              draggable={isHost && available}
              onPointerEnter={() => previewOnly(game)}
              onFocus={() => previewOnly(game)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("text/plain", game.id);
                setPreviewGameId(game.id);
                setPlacedGameId(game.id);
                setDragGameId(game.id);
                setLastPickerGesture("drag");
              }}
              onDragEnd={() => setDragGameId(null)}
              aria-pressed={selected}
              aria-current={selected ? "true" : undefined}
              aria-label={`${game.title}, ${formatAllowedPlayers(game)}, ${gameAvailabilityLabel(game, playerCount)}`}
              style={{ "--game-accent": game.accent } as CSSProperties}
            >
              <span className="game-card-media">
                <GameCoverImage game={game} />
              </span>
              <span className="game-card-copy">
                <strong>{game.title}</strong>
                <small>{formatAllowedPlayers(game)}</small>
              </span>
              {selected || !available ? (
                <span className="game-card-state">
                  {selected ? (
                  <>
                    <CheckCircle2 size={14} aria-hidden="true" />
                    선택
                  </>
                  ) : (
                    gameAvailabilityLabel(game, playerCount)
                  )}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {!isHost ? <p className="helper-text">게임 선택과 시작은 방장이 진행합니다.</p> : null}
    </section>
  );
}

function PlayPanel({
  room,
  currentPlayer,
  selectedGame,
  activePlayer,
  isHost,
  onReturnLobby,
  onLeaveLocalRoom,
  onPostGameLeave
}: {
  room: RoomSnapshot;
  currentPlayer: PlayerSnapshot | null;
  selectedGame: GameDefinition | null;
  activePlayer: PlayerSnapshot | null;
  isHost: boolean;
  onReturnLobby: () => void;
  onLeaveLocalRoom: () => void;
  onPostGameLeave: (message?: string) => void;
}) {
  const [action, setAction] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [postGameRevealStage, setPostGameRevealStage] = useState<"idle" | "effect" | "dialog">("idle");
  const isMyTurn = currentPlayer?.id === activePlayer?.id;
  const GameComponent = getGameComponent(selectedGame?.id);
  const phase = runtimePhase(room);
  const usesTurnTimer = gameUsesTurnTimer(selectedGame?.id);
  const winnerIds = runtimeWinnerIds(room);
  const winnerId = runtimeWinnerId(room);
  const paused = Boolean(room.gameState.paused);
  const winnerNames = winnerIds
    .map((id) => room.players.find((player) => player.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const isFinished = winnerIds.length > 0 || phase === "complete" || phase === "finished";
  const timerAnchor = paused ? room.gameState.pausedAt ?? now : now;
  const remainingMs = room.gameState.turnDeadlineAt ? room.gameState.turnDeadlineAt - timerAnchor : 0;
  const timerExpired = usesTurnTimer && !isFinished && !paused && Boolean(room.gameState.turnDeadlineAt) && remainingMs <= 0;
  const timerUrgent =
    usesTurnTimer && !isFinished && !paused && Boolean(room.gameState.turnDeadlineAt) && remainingMs > 0 && remainingMs <= 10_000;
  const publicStateRecord = stateRecord(room.gameState.publicState);
  const blokusActiveColor = selectedGame?.id === "blokus" ? String(publicStateRecord?.activeColorId ?? "") : "";
  const blokusPlayers = Array.isArray(publicStateRecord?.players) ? publicStateRecord.players : [];
  const blokusCanMove = blokusPlayers.some((player) => {
    const record = stateRecord(player);
    return record?.id === blokusActiveColor && record.canMove !== false;
  });
  const blokusRestriction =
    selectedGame?.id === "blokus" && blokusCanMove
      ? "블로커스는 놓을 수 있는 블록이 남아 있으면 패스할 수 없습니다. 조각을 배치하거나 시간이 초과될 때까지 기다리세요."
      : "";
  const turnEndRestriction = manualTurnEndRestriction(selectedGame?.id, phase) || blokusRestriction;
  const canAdvanceTurn =
    !paused && !isFinished && ((isMyTurn && !turnEndRestriction) || (!isMyTurn && isHost && timerExpired && Boolean(activePlayer)));
  const canClaimTimeout = usesTurnTimer && timerExpired && !isMyTurn && Boolean(activePlayer);
  const latestMove = room.gameState.moveLog.at(-1);
  const hangmanOpenPhase = selectedGame?.id === "hangman-board-game" && (phase === "setup" || phase === "round-complete");
  const setupOpenPhase = selectedGame?.id === "ghosts" && phase === "setup";
  const simultaneousDrawingPhase =
    selectedGame?.id === "masterpiece-copy" && (phase === "drawing" || phase === "scanning" || phase === "complete");
  const moduleDisabled = paused || (!isMyTurn && !hangmanOpenPhase && !setupOpenPhase && !simultaneousDrawingPhase);
  const postGameChoices = stateRecord(room.gameState.postGameChoices);
  const currentPostGameChoice = currentPlayer ? String(postGameChoices?.[currentPlayer.id] ?? "") : "";
  const rematchRequesters = room.players.filter((player) => postGameChoices?.[player.id] === "rematch");
  const resultLabel =
    winnerNames.length > 0
      ? `${winnerNames.join(", ")} 승리`
      : winnerId
        ? `${room.players.find((player) => player.id === winnerId)?.name ?? "플레이어"} 승리`
        : "무승부";
  const playerMomentumBadges = useMemo(
    () => buildPlayerMomentumBadges(room, selectedGame, winnerIds),
    [room, selectedGame, winnerIds.join("|")]
  );
  const postGameRevealKey = isFinished
    ? `${room.code}-${selectedGame?.id ?? "game"}-${phase}-${winnerIds.join("|") || winnerId || "draw"}-${room.gameState.turnNumber}`
    : "";
  const showPostGameEffect = isFinished && postGameRevealStage !== "idle";
  const showPostGameDialog = isFinished && postGameRevealStage === "dialog";

  useEffect(() => {
    if (!usesTurnTimer || isFinished || paused || !room.gameState.turnDeadlineAt) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isFinished, paused, room.gameState.turnDeadlineAt, usesTurnTimer]);

  useEffect(() => {
    if (!isFinished || !postGameRevealKey) {
      setPostGameRevealStage("idle");
      return;
    }

    setPostGameRevealStage("idle");
    const effectTimer = window.setTimeout(() => setPostGameRevealStage("effect"), 620);
    const dialogTimer = window.setTimeout(() => setPostGameRevealStage("dialog"), 1850);
    return () => {
      window.clearTimeout(effectTimer);
      window.clearTimeout(dialogTimer);
    };
  }, [isFinished, postGameRevealKey]);

  async function advanceTurn() {
    const response = await emitWithAck<RoomSnapshot>("room:advance-turn", { code: room.code });
    if (!response.ok) {
      setAction(response.error ?? "턴을 넘길 수 없습니다.");
    }
  }

  async function pauseGame() {
    const response = await emitWithAck<RoomSnapshot>("room:pause-game", { code: room.code });
    if (!response.ok) {
      setAction(response.error ?? "일시정지할 수 없습니다.");
    }
  }

  async function resumeGame() {
    const response = await emitWithAck<RoomSnapshot>("room:resume-game", { code: room.code });
    if (!response.ok) {
      setAction(response.error ?? "재개할 수 없습니다.");
    }
  }

  async function claimTimeout() {
    const response = await emitWithAck<RoomSnapshot>("room:claim-timeout", { code: room.code });
    if (!response.ok) {
      setAction(response.error ?? "타임아웃을 처리할 수 없습니다.");
    }
  }

  async function sendGameAction(gameAction: GameAction) {
    const response = await emitWithAck<RoomSnapshot>("game:action", { code: room.code, action: gameAction });
    if (!response.ok) {
      setAction(response.error ?? "게임 행동을 처리할 수 없습니다.");
    }
  }

  async function choosePostGame(choice: "rematch" | "game-select" | "leave-room") {
    const response = await emitWithAck<PostGameActionResult>("room:post-game-action", { code: room.code, choice });
    if (!response.ok) {
      setAction(response.error ?? "게임 종료 후 선택을 처리할 수 없습니다.");
      return;
    }
    if (response.data?.left) {
      onPostGameLeave(response.data.deleted ? "모두 로비로 이동해 방이 닫혔습니다." : "로비로 이동했습니다.");
    }
  }

  return (
    <section className="work-panel play-panel" aria-labelledby="play-title">
      <p className="visually-hidden" role="status" aria-live="polite">
        {latestMove
          ? `${selectedGame?.title ?? "게임"} 진행: ${latestMove.playerName} ${latestMove.action}`
          : `${selectedGame?.title ?? "게임"} ${phaseName(phase)} ${activePlayer?.name ?? "플레이어 없음"}`}
      </p>
      <div className="panel-header play-panel-header">
        <div>
          <h2 id="play-title">{selectedGame?.title ?? "게임 진행"}</h2>
          <p className="play-compact-status">
            <span>{phaseName(phase)}</span>
            <span>
              {selectedGame?.id === "masterpiece-copy"
                ? phase === "drawing"
                  ? "모두 그리는 중"
                  : phase === "scanning"
                    ? "그림 스캔 중"
                    : "결과 확인"
                : `${activePlayer?.name ?? "없음"} 차례`}
            </span>
          </p>
        </div>
        <div className="play-header-actions">
          {usesTurnTimer ? (
            <div className={`play-timer-chip ${timerExpired ? "expired" : ""} ${timerUrgent ? "urgent" : ""}`} aria-label="턴 타이머">
              {timerExpired ? <TimerOff size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}
              <span>{paused ? "일시정지" : formatTimer(remainingMs)}</span>
            </div>
          ) : null}
          {isHost ? (
            paused ? (
              <BoardButton className="play-mini-action" type="button" onClick={resumeGame} disabled={isFinished} title="재개">
                <Play size={15} aria-hidden="true" />
                <span className="play-action-label">재개</span>
              </BoardButton>
            ) : (
              <BoardButton className="play-mini-action" type="button" onClick={pauseGame} disabled={isFinished} title="일시정지">
                <Pause size={15} aria-hidden="true" />
                <span className="play-action-label">일시정지</span>
              </BoardButton>
            )
          ) : null}
          {canClaimTimeout ? (
            <BoardButton tone="danger" className="timeout-claimable" type="button" onClick={claimTimeout}>
              타임아웃
            </BoardButton>
          ) : null}
          {isHost ? (
            <BoardButton className="play-mini-action" type="button" onClick={onReturnLobby} title="로비">
              <Route size={15} aria-hidden="true" />
              <span className="play-action-label">로비</span>
            </BoardButton>
          ) : null}
          <BoardButton className="play-mini-action" tone="secondary" type="button" onClick={onLeaveLocalRoom} title="나가기">
            <DoorOpen size={15} aria-hidden="true" />
            <span className="play-action-label">나가기</span>
          </BoardButton>
        </div>
      </div>

      <div className="player-turn-strip" aria-label="플레이어 차례와 상태">
        {room.players.map((player) => {
          const active = player.id === activePlayer?.id;
          const current = player.id === currentPlayer?.id;
          const won = winnerIds.includes(player.id);
          const momentumBadge = playerMomentumBadges.get(player.id);
          const StatusIcon = won ? Trophy : active ? Radio : current ? UserCheck : player.connected ? Clock3 : WifiOff;
          const statusLabel = won ? "승자" : active ? "현재 차례" : current ? "나" : player.connected ? "대기" : "오프라인";
          return (
            <div
              key={player.id}
              className={`player-turn-chip ${active ? "active" : ""} ${current ? "current" : ""} ${won ? "winner" : ""} ${
                momentumBadge ? `has-momentum momentum-${momentumBadge.tone}` : ""
              }`}
              style={{ "--seat-accent": playerAccent(player) } as CSSProperties}
            >
              <div className="turn-avatar-stack">
                <PlayerAvatarMark avatar={player.avatar} className="turn-avatar" label={`${player.name} 아이콘`} />
                {momentumBadge ? <span className="turn-avatar-rank-badge">{momentumBadge.label}</span> : null}
              </div>
              <strong>{player.name}</strong>
              <span className="turn-chip-status">
                <StatusIcon size={12} aria-hidden="true" />
                {statusLabel}
              </span>
            </div>
          );
        })}
      </div>

      {GameComponent && selectedGame ? (
        <div className="game-module-shell">
          <InteractiveGameWrapper isMyTurn={isMyTurn}>
            <Suspense fallback={<GameModuleLoading game={selectedGame} />}>
              <GameComponent
                game={selectedGame}
                players={room.players}
                currentPlayer={currentPlayer}
                activePlayer={activePlayer}
                publicState={room.gameState.publicState}
                disabled={moduleDisabled}
                onAction={sendGameAction}
              />
            </Suspense>
          </InteractiveGameWrapper>
        </div>
      ) : (
        <BoardPreview game={selectedGame} activePlayer={activePlayer} />
      )}

      {canAdvanceTurn || action ? (
        <div className="turn-actions compact-turn-actions">
          {canAdvanceTurn ? (
            <BoardButton tone="primary" type="button" onClick={advanceTurn} title={turnEndRestriction || undefined}>
              {isMyTurn ? "턴 종료" : "강제 턴 넘김"}
            </BoardButton>
          ) : null}
          {action ? <span className="play-error-line">{action}</span> : null}
        </div>
      ) : null}

      {showPostGameEffect ? (
        <div className={`post-game-dialog-backdrop reveal-${postGameRevealStage}`} role="presentation">
          {selectedGame ? (
            <VictoryEffectOverlay
              key={`${room.code}-${selectedGame.id}-${phase}-${winnerIds.join("-") || "draw"}`}
              game={selectedGame}
              winnerNames={winnerNames}
              isDraw={winnerIds.length === 0 && !winnerId}
            />
          ) : null}
          {showPostGameDialog ? (
            <section className="post-game-dialog" role="dialog" aria-modal="true" aria-labelledby="post-game-title">
              <div className="post-game-emblem" aria-hidden="true">
                <Trophy size={28} />
              </div>
              <div className="post-game-copy">
                <span>{selectedGame?.title ?? "게임"} 종료</span>
                <h3 id="post-game-title">{winnerNames.length > 0 || winnerId ? "승부가 났습니다." : "무승부입니다."}</h3>
                <strong>{resultLabel}</strong>
                <p>{runtimeMessage(room) || "결과를 확인한 뒤 다음 행동을 선택하세요."}</p>
              </div>

              {rematchRequesters.length > 0 ? (
                <div className="post-game-votes" aria-label="재대결 요청자">
                  <span>재대결 요청</span>
                  <strong>{rematchRequesters.map((player) => player.name).join(", ")}</strong>
                </div>
              ) : null}

              {currentPostGameChoice === "rematch" ? (
                <p className="post-game-waiting">재대결 요청을 보냈습니다. 모두가 동의하면 바로 새 판이 시작됩니다.</p>
              ) : null}

              <div className="post-game-actions">
                <BoardButton
                  type="button"
                  onClick={() => choosePostGame("rematch")}
                  disabled={currentPostGameChoice === "rematch"}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  다시 한 판
                </BoardButton>
                <BoardButton className="post-game-same-room-action" tone="primary" type="button" onClick={() => choosePostGame("game-select")}>
                  <Users size={15} aria-hidden="true" />
                  같은 인원으로 게임 선택
                </BoardButton>
                <BoardButton tone="secondary" type="button" onClick={() => choosePostGame("leave-room")}>
                  <DoorOpen size={15} aria-hidden="true" />
                  로비 이동
                </BoardButton>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function GameModuleLoading({ game }: { game: GameDefinition }) {
  return (
    <div className="game-module-loading" role="status" aria-live="polite">
      <GameKindIcon game={game} size={18} />
      <strong>{game.title} 보드를 준비하는 중입니다.</strong>
      <span>{game.table.uiHint}</span>
    </div>
  );
}

function previewCellsFor(game: GameDefinition) {
  return Array.from({ length: game.table.kind === "polyomino" ? 64 : 25 }, (_, index) => index);
}

function GameMiniThumbnail({ game }: { game: GameDefinition }) {
  return (
    <span className={`game-row-thumb thumb-${game.table.kind} thumb-${game.id}`} aria-hidden="true">
      <BoardPreviewStage game={game} cells={previewCellsFor(game)} />
    </span>
  );
}

function BoardPreview({
  game,
  activePlayer,
  previewLabel = "대기",
  showHeader = true
}: {
  game: GameDefinition | null;
  activePlayer: PlayerSnapshot | null;
  previewLabel?: string;
  showHeader?: boolean;
}) {
  if (!game) {
    return <div className="board-preview empty">게임을 선택해주세요.</div>;
  }

  const cells = previewCellsFor(game);
  return (
    <div className={`board-preview ${game.table.kind} preview-${game.id}`} style={{ "--game-accent": game.accent } as CSSProperties}>
      {showHeader ? (
        <div className="board-header">
          <span>{game.table.primaryMetric}</span>
          <strong>{activePlayer?.name ?? previewLabel}</strong>
          <span>{game.table.secondaryMetric}</span>
        </div>
      ) : null}
      <div className={`board-stage stage-${game.id}`} role="img" aria-label={`${game.title} 미리보기: ${game.table.uiHint}`}>
        <BoardPreviewStage game={game} cells={cells} />
      </div>
    </div>
  );
}

function BoardPreviewStage({ game, cells }: { game: GameDefinition; cells: number[] }) {
  if (game.id === "guryongtu") return <TileDuelBoard />;
  if (game.id === "quoridor") return <QuoridorMiniBoard />;
  if (game.id === "abalone-classic") return <AbaloneMiniBoard />;
  if (game.id === "ghosts") return <GhostsMiniBoard />;
  if (game.id === "qawale") return <QawaleMiniBoard />;
  if (game.id === "omok") return <OmokMiniBoard />;
  if (game.id === "alkkagi") return <AlkkagiMiniBoard />;
  if (game.id === "kkukkkuki") return <KkukkkukiMiniBoard />;
  if (game.id === "davinci-code-plus") return <DavinciMiniRack />;
  if (game.id === "blokus") return <BlokusMiniBoard />;
  if (game.id === "yacht-dice") return <YachtMiniBoard />;
  if (game.id === "yinsh") return <YinshMiniBoard />;
  if (game.id === "hangman-board-game") return <HangmanMiniBoard />;
  if (game.table.kind === "dice") return <DiceBoard />;
  if (game.table.kind === "word") return <WordBoard />;
  if (game.table.kind === "rings") return <RingBoard />;

  return (
    <div className={`mini-grid ${game.table.kind}`}>
      {cells.map((cell) => (
        <span key={cell} className={cell % 7 === 0 ? "accent-cell" : ""} />
      ))}
    </div>
  );
}

function TileDuelBoard() {
  return (
    <div className="tile-duel-board">
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} className={index === 2 || index === 6 ? "used" : index === 4 ? "chosen" : ""}>
          {index + 1}
        </span>
      ))}
    </div>
  );
}

function QuoridorMiniBoard() {
  const pawns = new Map([
    ["1-4", "blue"],
    ["7-4", "red"]
  ]);
  const walls = new Set(["2-3", "4-5", "5-2", "6-6"]);

  return (
    <div className="quoridor-mini-board">
      {Array.from({ length: 81 }, (_, index) => {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const key = `${row}-${col}`;
        return (
          <span key={key} className={walls.has(key) ? "wall-cell" : ""}>
            {pawns.has(key) ? <i className={pawns.get(key)} /> : null}
          </span>
        );
      })}
    </div>
  );
}

function AbaloneMiniBoard() {
  const rows = [5, 6, 7, 6, 5];
  return (
    <div className="abalone-mini-board">
      {rows.map((count, row) => (
        <div key={row} style={{ "--mini-row": count } as CSSProperties}>
          {Array.from({ length: count }, (_, col) => {
            const color = row < 2 ? "black" : row > 2 ? "white" : col === 2 || col === 4 ? "brass" : "";
            return <span key={`${row}-${col}`} className={color} />;
          })}
        </div>
      ))}
    </div>
  );
}

function GhostsMiniBoard() {
  return (
    <div className="ghosts-mini-board">
      {Array.from({ length: 36 }, (_, index) => {
        const row = Math.floor(index / 6);
        const col = index % 6;
        const topToken = row === 0 && col > 0 && col < 5;
        const bottomToken = row === 5 && col > 0 && col < 5;
        const kind = topToken ? "hidden" : bottomToken ? (col % 2 === 0 ? "good" : "bad") : "";
        return <span key={index} className={kind} />;
      })}
    </div>
  );
}

function QawaleMiniBoard() {
  const stacks = [2, 0, 1, 3, 0, 4, 1, 0, 1, 0, 3, 1, 2, 1, 0, 2];
  return (
    <div className="qawale-mini-board">
      {stacks.map((height, index) => (
        <span key={index} className={height > 0 ? "stacked" : ""}>
          {height > 0 ? Array.from({ length: Math.min(height, 4) }, (_, layer) => <i key={layer} />) : null}
        </span>
      ))}
    </div>
  );
}

function OmokMiniBoard() {
  const stones = new Map([
    ["4-4", "black"],
    ["4-5", "white"],
    ["5-5", "black"],
    ["5-6", "white"],
    ["6-6", "black"],
    ["6-7", "white"],
    ["7-7", "black"]
  ]);

  return (
    <div className="omok-mini-board">
      {Array.from({ length: 81 }, (_, index) => {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const stone = stones.get(`${row}-${col}`);
        return <span key={`${row}-${col}`} className={stone ?? ""} />;
      })}
    </div>
  );
}

function AlkkagiMiniBoard() {
  const eggs = [
    { x: 34, y: 22, color: "red", king: true },
    { x: 49, y: 34, color: "red" },
    { x: 62, y: 76, color: "blue", king: true },
    { x: 48, y: 64, color: "blue" },
    { x: 35, y: 58, color: "yellow" },
    { x: 71, y: 43, color: "green" }
  ];

  return (
    <div className="alkkagi-mini-board">
      {eggs.map((egg, index) => (
        <i
          key={index}
          className={`${egg.color} ${egg.king ? "king" : ""}`}
          style={{ "--x": `${egg.x}%`, "--y": `${egg.y}%` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function KkukkkukiMiniBoard() {
  const pieces = new Map([
    ["1-1", "small warm"],
    ["1-3", "large cool"],
    ["2-2", "small warm"],
    ["3-2", "large warm"],
    ["3-4", "small cool"],
    ["4-3", "large cool"]
  ]);

  return (
    <div className="kkuk-mini-board">
      {Array.from({ length: 36 }, (_, index) => {
        const row = Math.floor(index / 6);
        const col = index % 6;
        return (
          <span key={`${row}-${col}`}>
            {pieces.has(`${row}-${col}`) ? <i className={pieces.get(`${row}-${col}`)} /> : null}
          </span>
        );
      })}
    </div>
  );
}

function DavinciMiniRack() {
  return (
    <div className="davinci-mini-rack">
      {["hidden", "white", "black", "hidden", "joker"].map((kind, index) => (
        <span key={`${kind}-${index}`} className={kind}>
          {kind === "hidden" ? "?" : kind === "joker" ? "★" : index + 1}
        </span>
      ))}
    </div>
  );
}

function BlokusMiniBoard() {
  const filled = new Map([
    ["0-0", "blue"],
    ["1-0", "blue"],
    ["1-1", "blue"],
    ["6-0", "yellow"],
    ["6-1", "yellow"],
    ["7-1", "yellow"],
    ["0-6", "red"],
    ["1-6", "red"],
    ["1-7", "red"],
    ["6-6", "green"],
    ["7-6", "green"],
    ["7-7", "green"]
  ]);
  return (
    <div className="blokus-mini-board">
      {Array.from({ length: 64 }, (_, index) => {
        const row = Math.floor(index / 8);
        const col = index % 8;
        const key = `${row}-${col}`;
        return <span key={key} className={filled.get(key) ?? ""} />;
      })}
    </div>
  );
}

function YachtMiniBoard() {
  const dice = [6, 4, 4, 2, 1];
  const rows = [
    { label: "1", value: "3" },
    { label: "풀", value: "25" },
    { label: "요트", value: "-" }
  ];
  const pipsByValue: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };

  return (
    <div className="yacht-mini-board">
      <div className="yacht-mini-dice">
        {dice.map((value, index) => (
          <span
            key={`${value}-${index}`}
            className={`yacht-mini-die ${index === 1 || index === 2 ? "held" : ""}`}
            aria-label={`${value} 눈`}
          >
            {Array.from({ length: 9 }, (_, pipIndex) => (
              <i className={pipsByValue[value]?.includes(pipIndex) ? "on" : ""} key={pipIndex} aria-hidden="true" />
            ))}
          </span>
        ))}
      </div>
      <div className="yacht-mini-score">
        {rows.map((row) => (
          <span key={row.label}>
            <strong>{row.label}</strong>
            <i>{row.value}</i>
          </span>
        ))}
      </div>
    </div>
  );
}

function YinshMiniBoard() {
  const rings = new Set([2, 8, 14, 20]);
  const black = new Set([6, 12, 18]);
  const white = new Set([10, 16, 22]);

  return (
    <div className="yinsh-mini-board">
      {Array.from({ length: 25 }, (_, index) => (
        <span key={index} className={rings.has(index) ? "ring" : black.has(index) ? "black-marker" : white.has(index) ? "white-marker" : ""} />
      ))}
    </div>
  );
}

function HangmanMiniBoard() {
  return (
    <div className="hangman-mini-board">
      <div className="hangman-mini-word" aria-label="비밀 단어 타일">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className={index === 3 ? "blank" : "filled"} aria-hidden="true" />
        ))}
      </div>
      <div className="hangman-mini-alpha" aria-label="글자 타일">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className={index < 3 ? "used" : ""} aria-hidden="true" />
        ))}
      </div>
      <div className="hangman-mini-track">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className={index < 2 ? "lit" : ""} />
        ))}
      </div>
    </div>
  );
}

function DiceBoard() {
  return (
    <div className="dice-board">
      {[1, 2, 3, 4, 5].map((die) => (
        <span key={die} className="die-face">
          <Dice5 size={26} />
        </span>
      ))}
    </div>
  );
}

function WordBoard() {
  return (
    <div className="word-board" aria-label="단어 타일 미리보기">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index % 2 === 0 ? "filled" : "hidden"} aria-hidden="true" />
      ))}
    </div>
  );
}

function RingBoard() {
  return (
    <div className="ring-board">
      {Array.from({ length: 18 }, (_, index) => (
        <span key={index} className={index % 5 === 0 ? "ring" : index % 2 === 0 ? "black-marker" : "white-marker"} />
      ))}
    </div>
  );
}

export default App;

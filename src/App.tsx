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
  Puzzle,
  Radio,
  RefreshCw,
  Route,
  Send,
  ShieldQuestion,
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
import { Suspense, type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "./lib/socket";
import { games, getGameById } from "./shared/games";
import { canPlayGame, formatAllowedPlayers, gameAvailabilityLabel } from "./shared/eligibility";
import { gameUsesTurnTimer, turnTimerOptions } from "./shared/timers";
import type { Ack, GameDefinition, PlayerSnapshot, PublicRoomListItem, RoomSnapshot } from "./shared/types";
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

function gameCoverSrc(game: GameDefinition) {
  return `/board-assets/game-covers/${game.id}.svg`;
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

function playerAccent(player: PlayerSnapshot) {
  return seatAccentColors[(Math.max(1, player.seat) - 1) % seatAccentColors.length];
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
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerId, setPlayerId] = useState(() => localStorage.getItem(storageKeys.playerId) ?? "");
  const [clientKey, setClientKey] = useState(() => readOrCreateClientKey());
  const [lastRoomCode, setLastRoomCode] = useState(() => localStorage.getItem(storageKeys.roomCode) ?? "");
  const [connection, setConnection] = useState<"connecting" | "connected" | "offline">("connecting");
  const [roomList, setRoomList] = useState<PublicRoomListItem[]>([]);
  const [roomListLoading, setRoomListLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const resumeStateRef = useRef({
    clientKey: "",
    inFlight: false,
    key: "",
    name: "",
    playerId: "",
    roomCode: ""
  });

  useEffect(() => {
    resumeStateRef.current.name = name;
    resumeStateRef.current.playerId = playerId;
    resumeStateRef.current.clientKey = clientKey;
    resumeStateRef.current.roomCode = room?.code ?? lastRoomCode;
    if (!resumeStateRef.current.roomCode) {
      resumeStateRef.current.key = "";
      resumeStateRef.current.inFlight = false;
    }
  }, [clientKey, lastRoomCode, name, playerId, room?.code]);

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
    const response = await emitWithAck<JoinResult>("room:create", { name, clientKey });
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
    const response = await emitWithAck<JoinResult>("room:join", { code: normalizedCode, name, playerId, clientKey });
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
      clientKey
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
      clientKey: savedClientKey
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
    if (!response.ok) {
      setNotice(response.error ?? "게임을 선택할 수 없습니다.");
    }
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
    localStorage.removeItem(storageKeys.playerId);
    localStorage.removeItem(storageKeys.roomCode);
    localStorage.setItem(storageKeys.clientKey, nextClientKey);
    setClientKey(nextClientKey);
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
          {!room && <p>웹에서 즐기는 보드게임</p>}
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

function HomeView({
  name,
  notice,
  connection,
  lastRoomCode,
  rooms,
  roomsLoading,
  onNameChange,
  onCreateRoom,
  onJoinListedRoom,
  onRefreshRooms,
  onResumeSavedRoom,
  onResetLocalIdentity
}: {
  name: string;
  notice: string;
  connection: "connecting" | "connected" | "offline";
  lastRoomCode: string;
  rooms: PublicRoomListItem[];
  roomsLoading: boolean;
  onNameChange: (value: string) => void;
  onCreateRoom: (event: FormEvent) => void;
  onJoinListedRoom: (code: string) => void;
  onRefreshRooms: () => void;
  onResumeSavedRoom: () => void;
  onResetLocalIdentity: () => void;
}) {
  const disabled = connection !== "connected";
  const hasRooms = rooms.length > 0;
  const savedRoom = lastRoomCode ? rooms.find((openRoom) => openRoom.code === lastRoomCode) ?? null : null;

  return (
    <section className="home-console home-lounge home-gallery" aria-labelledby="home-title">
      <div className="home-stage">
        <div className="home-room-board">
          <div className="room-browser-heading">
            <div className="room-browser-title">
              <span className="eyebrow">로비</span>
              <h2 id="home-title">방 목록</h2>
              <span>입장 후 게임 선택</span>
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
                {rooms.map((openRoom) => {
                  const canResume = lastRoomCode === openRoom.code;
                  const canUseRoom = openRoom.canJoin || canResume;
                  const roomOwnerLabel = openRoom.hostName ? `${openRoom.hostName}의 방` : "이름 없는 방";
                  return (
                    <article className={`room-card ${openRoom.canJoin ? "" : "is-locked"}`} key={openRoom.code}>
                      <div className="room-card-main">
                        <div className="room-card-title">
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
                        {openRoom.playerCount}/{openRoom.maxPlayers}
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
              <BoardButton className="saved-room-button utility-button" type="button" onClick={onResumeSavedRoom} disabled={disabled}>
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
  const isHost = Boolean(currentPlayer?.isHost);
  const canStart = Boolean(selectedGame && canPlayGame(selectedGame, playerCount) && isHost);

  return (
    <section className={`room-section ${room.status === "lobby" ? "is-lobby" : "is-playing"}`} aria-label="게임 방">
      <div className="room-layout">
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
              return <SeatRow key={seat} seat={seat} player={player} currentPlayerId={currentPlayer?.id ?? ""} />;
            })}
          </div>
          {notice ? <p className="notice" role="status">{notice}</p> : null}
        </aside>

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
          />
        ) : (
          <PlayPanel
            room={room}
            currentPlayer={currentPlayer}
            selectedGame={selectedGame}
            activePlayer={activePlayer}
            isHost={isHost}
            onReturnLobby={onReturnLobby}
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

function LobbyPanel({
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

  function selectGame(game: GameDefinition) {
    const available = canPlayGame(game, playerCount);
    if (isHost && available) {
      onSelectGame(game.id);
    }
  }

  return (
    <section className="work-panel lobby-panel" aria-labelledby="lobby-title">
      <div className="panel-header lobby-panel-header">
        <div>
          <h2 id="lobby-title">게임 선택</h2>
          <p>{playerCount}명 · 선택 가능 {eligibleGames.length}개</p>
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

      <div className="game-card-grid" aria-label="게임 선택 카드">
        {games.map((game) => {
          const available = canPlayGame(game, playerCount);
          const selected = room.selectedGameId === game.id;
          return (
            <button
              className={`game-card-tile ${selected ? "selected" : ""} ${available ? "" : "is-unavailable"}`}
              key={game.id}
              type="button"
              onClick={() => selectGame(game)}
              disabled={!isHost || !available}
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
              <span className="game-card-state">
                {selected ? (
                  <>
                    <CheckCircle2 size={14} aria-hidden="true" />
                    선택됨
                  </>
                ) : available ? (
                  "선택 가능"
                ) : (
                  gameAvailabilityLabel(game, playerCount)
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="game-selection-actions">
        <BoardButton tone="primary" type="button" onClick={onStartGame} disabled={!canStart}>
          {selectedGame ? "게임 시작" : "게임을 선택하세요"}
        </BoardButton>
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
  onPostGameLeave
}: {
  room: RoomSnapshot;
  currentPlayer: PlayerSnapshot | null;
  selectedGame: GameDefinition | null;
  activePlayer: PlayerSnapshot | null;
  isHost: boolean;
  onReturnLobby: () => void;
  onPostGameLeave: (message?: string) => void;
}) {
  const [action, setAction] = useState("");
  const [now, setNow] = useState(() => Date.now());
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
  const moduleDisabled = paused || (!isMyTurn && !hangmanOpenPhase && !setupOpenPhase);
  const postGameChoices = stateRecord(room.gameState.postGameChoices);
  const currentPostGameChoice = currentPlayer ? String(postGameChoices?.[currentPlayer.id] ?? "") : "";
  const rematchRequesters = room.players.filter((player) => postGameChoices?.[player.id] === "rematch");
  const resultLabel =
    winnerNames.length > 0
      ? `${winnerNames.join(", ")} 승리`
      : winnerId
        ? `${room.players.find((player) => player.id === winnerId)?.name ?? "플레이어"} 승리`
        : "무승부";

  useEffect(() => {
    if (!usesTurnTimer || isFinished || paused || !room.gameState.turnDeadlineAt) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isFinished, paused, room.gameState.turnDeadlineAt, usesTurnTimer]);

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
          <p>
            {room.gameState.roundNumber}라운드 · {room.gameState.turnNumber}턴 · {phaseName(phase)} · 현재 차례 {activePlayer?.name ?? "없음"}
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
              <BoardButton type="button" onClick={resumeGame} disabled={isFinished}>
                재개
              </BoardButton>
            ) : (
              <BoardButton type="button" onClick={pauseGame} disabled={isFinished}>
                일시정지
              </BoardButton>
            )
          ) : null}
          {canClaimTimeout ? (
            <BoardButton tone="danger" className="timeout-claimable" type="button" onClick={claimTimeout}>
              타임아웃
            </BoardButton>
          ) : null}
          {isHost ? (
            <BoardButton type="button" onClick={onReturnLobby}>
              로비
            </BoardButton>
          ) : null}
        </div>
      </div>

      <div className="player-turn-strip" aria-label="플레이어 차례와 상태">
        {room.players.map((player) => {
          const active = player.id === activePlayer?.id;
          const current = player.id === currentPlayer?.id;
          const won = winnerIds.includes(player.id);
          const StatusIcon = won ? Trophy : active ? Radio : current ? UserCheck : player.connected ? Clock3 : WifiOff;
          const statusLabel = won ? "승자" : active ? "현재 차례" : current ? "나" : player.connected ? "대기" : "오프라인";
          return (
            <div
              key={player.id}
              className={`player-turn-chip ${active ? "active" : ""} ${current ? "current" : ""} ${won ? "winner" : ""}`}
              style={{ "--seat-accent": playerAccent(player) } as CSSProperties}
            >
              <span className="player-turn-swatch" aria-hidden="true" />
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
        </div>
      ) : (
        <BoardPreview game={selectedGame} activePlayer={activePlayer} />
      )}

      <div className="turn-actions compact-turn-actions">
        <BoardButton tone="primary" type="button" onClick={advanceTurn} disabled={!canAdvanceTurn} title={turnEndRestriction || undefined}>
          {isMyTurn ? "턴 종료" : "강제 턴 넘김"}
        </BoardButton>
        {action ? <span className="play-error-line">{action}</span> : null}
      </div>

      {isFinished ? (
        <div className="post-game-dialog-backdrop" role="presentation">
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
                tone="primary"
                type="button"
                onClick={() => choosePostGame("rematch")}
                disabled={currentPostGameChoice === "rematch"}
              >
                재대결
              </BoardButton>
              <BoardButton type="button" onClick={() => choosePostGame("game-select")}>
                게임 선택
              </BoardButton>
              <BoardButton tone="secondary" type="button" onClick={() => choosePostGame("leave-room")}>
                로비 이동
              </BoardButton>
            </div>
          </section>
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
  previewLabel = "대기"
}: {
  game: GameDefinition | null;
  activePlayer: PlayerSnapshot | null;
  previewLabel?: string;
}) {
  if (!game) {
    return <div className="board-preview empty">게임을 선택해주세요.</div>;
  }

  const cells = previewCellsFor(game);
  return (
    <div className={`board-preview ${game.table.kind} preview-${game.id}`} style={{ "--game-accent": game.accent } as CSSProperties}>
      <div className="board-header">
        <span>{game.table.primaryMetric}</span>
        <strong>{activePlayer?.name ?? previewLabel}</strong>
        <span>{game.table.secondaryMetric}</span>
      </div>
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
      <span className="arena-mark pond" />
      <span className="arena-mark ridge" />
      <span className="arena-mark storm" />
      <span className="terrain pit" />
      <span className="terrain mud" />
      <span className="terrain ice" />
      <span className="device button" />
      <span className="device lever" />
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

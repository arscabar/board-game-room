import {
  BarChart3,
  CheckCircle2,
  Copy,
  Dice5,
  DoorOpen,
  Gamepad2,
  History,
  LogIn,
  Medal,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Trophy,
  Users
} from "lucide-react";
import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";
import { socket } from "./lib/socket";
import { games, getGameById } from "./shared/games";
import { canPlayGame, formatAllowedPlayers, gameAvailabilityLabel } from "./shared/eligibility";
import type { Ack, GameDefinition, PlayerSnapshot, RoomSnapshot } from "./shared/types";
import { getGameRegistration } from "./game-modules/registry";
import type { GameAction } from "./game-modules/types";
import type { LeaderboardEntry, MatchRecord, PlayerStatsResponse, StatsSummary } from "./shared/stats";

type JoinResult = {
  room: RoomSnapshot;
  playerId: string;
};

const storageKeys = {
  name: "board-room-name",
  playerId: "board-room-player-id"
};

function createDefaultName() {
  return `플레이어 ${Math.floor(100 + Math.random() * 900)}`;
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
    throw new Error(body?.error ?? "통계를 불러올 수 없습니다.");
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

function App() {
  const [name, setName] = useState(() => localStorage.getItem(storageKeys.name) ?? createDefaultName());
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerId, setPlayerId] = useState(() => localStorage.getItem(storageKeys.playerId) ?? "");
  const [connection, setConnection] = useState<"connecting" | "connected" | "offline">("connecting");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    socket.connect();

    const handleConnect = () => setConnection("connected");
    const handleDisconnect = () => setConnection("offline");
    const handleRoomState = (nextRoom: RoomSnapshot) => setRoom(nextRoom);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:state", handleRoomState);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:state", handleRoomState);
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

  const currentPlayer = useMemo(
    () => room?.players.find((player) => player.id === playerId) ?? null,
    [playerId, room]
  );

  const selectedGame = useMemo(() => getGameById(room?.selectedGameId), [room?.selectedGameId]);

  async function handleCreateRoom(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    const response = await emitWithAck<JoinResult>("room:create", { name });
    if (!response.ok || !response.data) {
      setNotice(response.error ?? "방을 만들 수 없습니다.");
      return;
    }

    setPlayerId(response.data.playerId);
    setRoom(response.data.room);
  }

  async function handleJoinRoom(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    const response = await emitWithAck<JoinResult>("room:join", { code: roomCode, name });
    if (!response.ok || !response.data) {
      setNotice(response.error ?? "방에 입장할 수 없습니다.");
      return;
    }

    setPlayerId(response.data.playerId);
    setRoom(response.data.room);
  }

  async function selectGame(gameId: string) {
    if (!room) return;
    const response = await emitWithAck<RoomSnapshot>("room:select-game", { code: room.code, gameId });
    if (!response.ok) {
      setNotice(response.error ?? "게임을 선택할 수 없습니다.");
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

  function leaveLocalRoom() {
    setRoom(null);
    setPlayerId("");
    localStorage.removeItem(storageKeys.playerId);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <Gamepad2 size={22} />
        </div>
        <div>
          <h1>Board Game Room</h1>
          <p>문서화된 보드게임을 실시간 방에서 선택하고 진행합니다.</p>
        </div>
        <ConnectionBadge connection={connection} />
      </header>

      <main id="main">
        {room ? (
          <RoomView
            room={room}
            currentPlayer={currentPlayer}
            selectedGame={selectedGame}
            notice={notice}
            onCopyNotice={setNotice}
            onSelectGame={selectGame}
            onStartGame={startGame}
            onReturnLobby={returnLobby}
            onLeaveLocalRoom={leaveLocalRoom}
          />
        ) : (
          <HomeView
            name={name}
            roomCode={roomCode}
            notice={notice}
            connection={connection}
            onNameChange={setName}
            onRoomCodeChange={setRoomCode}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
          />
        )}
      </main>
    </div>
  );
}

function ConnectionBadge({ connection }: { connection: "connecting" | "connected" | "offline" }) {
  const label = connection === "connected" ? "서버 연결됨" : connection === "connecting" ? "연결 중" : "오프라인";
  return (
    <div className={`connection-badge ${connection}`} aria-live="polite">
      <Radio size={16} />
      <span>{label}</span>
    </div>
  );
}

function HomeView({
  name,
  roomCode,
  notice,
  connection,
  onNameChange,
  onRoomCodeChange,
  onCreateRoom,
  onJoinRoom
}: {
  name: string;
  roomCode: string;
  notice: string;
  connection: "connecting" | "connected" | "offline";
  onNameChange: (value: string) => void;
  onRoomCodeChange: (value: string) => void;
  onCreateRoom: (event: FormEvent) => void;
  onJoinRoom: (event: FormEvent) => void;
}) {
  const disabled = connection !== "connected";

  return (
    <section className="home-grid" aria-labelledby="home-title">
      <div className="intro-panel">
        <span className="eyebrow">실시간 보드게임 테이블</span>
        <h2 id="home-title">이름을 정하고 방으로 들어가세요.</h2>
        <p>
          한 방은 최대 4명까지 들어올 수 있고, 방 안에서는 현재 인원수에 맞는 게임만 선택됩니다.
        </p>
        <div className="catalog-strip" aria-label="등록된 게임">
          {games.slice(0, 10).map((game) => (
            <span key={game.id}>{game.title}</span>
          ))}
        </div>
      </div>

      <div className="entry-stack">
        <form className="entry-panel" onSubmit={onCreateRoom}>
          <label htmlFor="player-name">플레이어 이름</label>
          <input
            id="player-name"
            value={name}
            maxLength={16}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <button className="primary-button" type="submit" disabled={disabled || !name.trim()}>
            <Plus size={18} />
            방 만들기
          </button>
        </form>

        <form className="entry-panel" onSubmit={onJoinRoom}>
          <label htmlFor="room-code">방 코드</label>
          <input
            id="room-code"
            value={roomCode}
            maxLength={5}
            onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())}
          />
          <button className="secondary-button" type="submit" disabled={disabled || !name.trim() || !roomCode.trim()}>
            <LogIn size={18} />
            입장
          </button>
        </form>
        {notice ? <p className="notice" role="alert">{notice}</p> : null}
      </div>

      <StatsDashboard playerName={name} />
    </section>
  );
}

function StatsDashboard({ playerName }: { playerName: string }) {
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
          player
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
  }, [gameId, playerName, refreshKey]);

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
                    <th>승률</th>
                    <th>전적</th>
                    <th>평균</th>
                    <th>최고</th>
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
              {playerStats.entries.slice(0, 5).map((entry) => (
                <div className="player-stat-row" key={`${entry.playerKey}-${entry.gameId}`}>
                  <div>
                    <strong>{entry.gameTitle}</strong>
                    <span>{entry.gamesPlayed}전 · 최근 {formatDateTime(entry.lastPlayedAt)}</span>
                  </div>
                  <span className="rate-pill">{formatPercent(entry.winRate)}</span>
                </div>
              ))}
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
              {recentMatches.map((match) => (
                <div className="recent-match-row" key={match.id}>
                  <div>
                    <strong>{match.gameTitle}</strong>
                    <span>{formatDateTime(match.finishedAt)}</span>
                  </div>
                  <div className="match-result">
                    <span>{winnerLabel(match)}</span>
                    <small>{match.players.map((player) => `${player.playerName} ${formatScore(player.score)}`).join(" · ")}</small>
                  </div>
                </div>
              ))}
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
  onCopyNotice,
  onSelectGame,
  onStartGame,
  onReturnLobby,
  onLeaveLocalRoom
}: {
  room: RoomSnapshot;
  currentPlayer: PlayerSnapshot | null;
  selectedGame: GameDefinition | null;
  notice: string;
  onCopyNotice: (value: string) => void;
  onSelectGame: (gameId: string) => void;
  onStartGame: () => void;
  onReturnLobby: () => void;
  onLeaveLocalRoom: () => void;
}) {
  const playerCount = room.players.filter((player) => player.connected).length;
  const activePlayer = room.players.find((player) => player.id === room.gameState.activePlayerId) ?? null;
  const isHost = Boolean(currentPlayer?.isHost);
  const canStart = Boolean(selectedGame && canPlayGame(selectedGame, playerCount) && isHost);

  async function copyRoomCode() {
    await navigator.clipboard.writeText(room.code);
    onCopyNotice("방 코드가 복사되었습니다.");
  }

  return (
    <section className="room-section" aria-label="게임 방">
      <div className="room-command">
        <div>
          <span className="eyebrow">방 코드</span>
          <div className="room-code">{room.code}</div>
        </div>
        <div className="command-actions">
          <button className="icon-button" type="button" onClick={copyRoomCode} aria-label="방 코드 복사" title="방 코드 복사">
            <Copy size={18} />
          </button>
          <button className="icon-button" type="button" onClick={onLeaveLocalRoom} aria-label="현재 방 나가기" title="현재 방 나가기">
            <DoorOpen size={18} />
          </button>
        </div>
      </div>

      <div className="room-layout">
        <aside className="seat-panel" aria-label="플레이어">
          <div className="panel-header">
            <h2>플레이어</h2>
            <span>{playerCount}/{room.maxPlayers}</span>
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
          />
        )}

        <GameDetailPanel game={selectedGame} playerCount={playerCount} />
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
  return (
    <div className={`seat-row ${player ? "filled" : ""}`}>
      <span className="seat-number">{seat}</span>
      <div>
        <strong>{player?.name ?? "빈 좌석"}</strong>
        <span>
          {player?.isHost ? "방장" : player ? "참가자" : "대기"} {player?.id === currentPlayerId ? "· 나" : ""}
        </span>
      </div>
      {player?.connected ? <CheckCircle2 size={18} aria-label="연결됨" /> : null}
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
  onStartGame
}: {
  room: RoomSnapshot;
  isHost: boolean;
  playerCount: number;
  selectedGame: GameDefinition | null;
  canStart: boolean;
  onSelectGame: (gameId: string) => void;
  onStartGame: () => void;
}) {
  const eligibleGames = games.filter((game) => canPlayGame(game, playerCount));

  return (
    <section className="work-panel" aria-labelledby="lobby-title">
      <div className="panel-header">
        <div>
          <h2 id="lobby-title">게임 선택</h2>
          <p>{playerCount}명으로 가능한 게임 {eligibleGames.length}개</p>
        </div>
        <button className="primary-button" type="button" onClick={onStartGame} disabled={!canStart}>
          <Play size={18} />
          시작
        </button>
      </div>

      <div className="game-list">
        {games.map((game) => {
          const available = canPlayGame(game, playerCount);
          const selected = room.selectedGameId === game.id;
          return (
            <button
              className={`game-row ${selected ? "selected" : ""}`}
              key={game.id}
              type="button"
              onClick={() => onSelectGame(game.id)}
              disabled={!available || !isHost}
              style={{ "--game-accent": game.accent } as CSSProperties}
            >
              <span className="game-swatch" aria-hidden="true" />
              <span>
                <strong>{game.title}</strong>
                <small>{game.genre}</small>
              </span>
              <span className={available ? "status-pill ok" : "status-pill muted"}>
                {gameAvailabilityLabel(game, playerCount)}
              </span>
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
  onReturnLobby
}: {
  room: RoomSnapshot;
  currentPlayer: PlayerSnapshot | null;
  selectedGame: GameDefinition | null;
  activePlayer: PlayerSnapshot | null;
  isHost: boolean;
  onReturnLobby: () => void;
}) {
  const [action, setAction] = useState("");
  const isMyTurn = currentPlayer?.id === activePlayer?.id;
  const registration = getGameRegistration(selectedGame?.id);

  async function recordAction(event: FormEvent) {
    event.preventDefault();
    if (!action.trim()) return;
    await emitWithAck<RoomSnapshot>("room:record-action", { code: room.code, action });
    setAction("");
  }

  async function advanceTurn() {
    await emitWithAck<RoomSnapshot>("room:advance-turn", { code: room.code });
  }

  async function sendGameAction(gameAction: GameAction) {
    const response = await emitWithAck<RoomSnapshot>("game:action", { code: room.code, action: gameAction });
    if (!response.ok) {
      setAction(response.error ?? "게임 행동을 처리할 수 없습니다.");
    }
  }

  return (
    <section className="work-panel" aria-labelledby="play-title">
      <div className="panel-header">
        <div>
          <h2 id="play-title">{selectedGame?.title ?? "게임 진행"}</h2>
          <p>
            {room.gameState.roundNumber}라운드 · {room.gameState.turnNumber}턴 · 현재 차례 {activePlayer?.name ?? "없음"}
          </p>
        </div>
        {isHost ? (
          <button className="secondary-button" type="button" onClick={onReturnLobby}>
            <RotateCcw size={18} />
            로비
          </button>
        ) : null}
      </div>

      {registration && selectedGame ? (
        <div className="game-module-shell">
          <registration.Component
            game={selectedGame}
            players={room.players}
            currentPlayer={currentPlayer}
            activePlayer={activePlayer}
            publicState={room.gameState.publicState}
            disabled={!isMyTurn && !isHost && !room.gameState.phase?.includes("setup")}
            onAction={sendGameAction}
          />
        </div>
      ) : (
        <BoardPreview game={selectedGame} activePlayer={activePlayer} />
      )}

      <form className="action-form" onSubmit={recordAction}>
        <label htmlFor="action-log">행동 기록</label>
        <div>
          <input
            id="action-log"
            value={action}
            maxLength={120}
            onChange={(event) => setAction(event.target.value)}
          />
          <button className="icon-button strong" type="submit" aria-label="행동 기록 추가" title="행동 기록 추가">
            <Send size={18} />
          </button>
        </div>
      </form>

      <div className="turn-actions">
        <button className="primary-button" type="button" onClick={advanceTurn} disabled={!isMyTurn && !isHost}>
          <CheckCircle2 size={18} />
          턴 종료
        </button>
        <span>{isMyTurn ? "내 차례입니다." : "현재 차례를 기다리는 중입니다."}</span>
      </div>

      <div className="move-log" aria-label="진행 기록">
        {room.gameState.moveLog.length === 0 ? (
          <p className="helper-text">아직 기록된 행동이 없습니다.</p>
        ) : (
          room.gameState.moveLog.map((entry) => (
            <div className="log-row" key={entry.id}>
              <time>{formatTime(entry.time)}</time>
              <strong>{entry.playerName}</strong>
              <span>{entry.action}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function BoardPreview({
  game,
  activePlayer
}: {
  game: GameDefinition | null;
  activePlayer: PlayerSnapshot | null;
}) {
  if (!game) {
    return <div className="board-preview empty">게임을 선택해주세요.</div>;
  }

  const cells = Array.from({ length: game.table.kind === "polyomino" ? 64 : 25 }, (_, index) => index);
  return (
    <div className={`board-preview ${game.table.kind}`} style={{ "--game-accent": game.accent } as CSSProperties}>
      <div className="board-header">
        <span>{game.table.primaryMetric}</span>
        <strong>{activePlayer?.name ?? "대기"}</strong>
        <span>{game.table.secondaryMetric}</span>
      </div>
      <div className="board-stage" aria-label={game.table.uiHint}>
        {game.table.kind === "dice" ? (
          <DiceBoard />
        ) : game.table.kind === "word" ? (
          <WordBoard />
        ) : game.table.kind === "rings" ? (
          <RingBoard />
        ) : (
          <div className={`mini-grid ${game.table.kind}`}>
            {cells.map((cell) => (
              <span key={cell} className={cell % 7 === 0 ? "accent-cell" : ""} />
            ))}
          </div>
        )}
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
    <div className="word-board">
      {["G", "?", "M", "?", "?"].map((letter, index) => (
        <span key={`${letter}-${index}`}>{letter}</span>
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

function GameDetailPanel({ game, playerCount }: { game: GameDefinition | null; playerCount: number }) {
  if (!game) {
    return (
      <aside className="detail-panel" aria-label="게임 정보">
        <div className="panel-header">
          <h2>게임 정보</h2>
        </div>
        <p className="helper-text">현재 인원에 맞는 게임을 선택하면 세팅과 턴 진행 규칙이 표시됩니다.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-panel" aria-label="게임 정보">
      <div className="panel-header">
        <div>
          <h2>{game.title}</h2>
          <p>{game.original}</p>
        </div>
        <span className={canPlayGame(game, playerCount) ? "status-pill ok" : "status-pill muted"}>
          {formatAllowedPlayers(game)}
        </span>
      </div>
      <p className="summary">{game.summary}</p>
      <InfoList title="세팅" items={game.setup} />
      <InfoList title="턴 진행" items={game.turnFlow} />
      <InfoList title="구현 판정" items={game.implementation} />
      <div className="win-condition">
        <strong>승리조건</strong>
        <span>{game.winCondition}</span>
      </div>
    </aside>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="info-list">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export default App;

import { Clock3, DoorOpen, Play, Trash2, UsersRound } from "lucide-react";
import { LazyMotion, MotionConfig } from "motion/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { games } from "../../shared/games";
import { canPlayGame, formatAllowedPlayers, gameAvailabilityLabel } from "../../shared/eligibility";
import { gameUsesTurnTimer, turnTimerOptions } from "../../shared/timers";
import type { GameDefinition, RoomSnapshot } from "../../shared/types";
import { CentralTableStage, type CentralTableState } from "./CentralTableStage";
import { GameShelfViewport } from "./GameShelfViewport";
import type { GameBoxState, GamePlacementSource } from "./GameBoxObject";
import "./interactive-game-lobby.css";

const loadMotionFeatures = () => import("../../motion-features").then((module) => module.default);

export type InteractiveGameLobbyProps = {
  room: RoomSnapshot;
  isHost: boolean;
  playerCount: number;
  selectedGame: GameDefinition | null;
  canStart: boolean;
  onSelectGame: (gameId: string) => void | Promise<void>;
  onConfigureTimer: (nextTimerMs: number) => void;
  onStartGame: () => void;
  onLeaveRoom?: () => void;
  onDeleteRoom?: () => void;
};

type PointerDragState = {
  gameId: string;
  pointerId: number;
  phase: "grabbed" | "dragging";
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  overTable: boolean;
};

function findGame(gameId: string | null | undefined) {
  return gameId ? games.find((game) => game.id === gameId) ?? null : null;
}

function canUsePointerDrag(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType === "touch") {
    return false;
  }

  if (typeof window === "undefined") {
    return true;
  }

  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function InteractiveGameLobby({
  room,
  isHost,
  playerCount,
  selectedGame,
  canStart,
  onSelectGame,
  onConfigureTimer,
  onStartGame,
  onLeaveRoom,
  onDeleteRoom
}: InteractiveGameLobbyProps) {
  const tableRef = useRef<HTMLElement | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const [focusedGameId, setFocusedGameId] = useState<string | null>(null);
  const [placedGameId, setPlacedGameId] = useState<string | null>(() => selectedGame?.id ?? room.selectedGameId);
  const [tablePhase, setTablePhase] = useState<CentralTableState>(() => (selectedGame ?? findGame(room.selectedGameId) ? "selected" : "empty"));
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [suppressedClickGameId, setSuppressedClickGameId] = useState<string | null>(null);

  const serverSelectedGame = selectedGame ?? findGame(room.selectedGameId);
  const selectedGameId = serverSelectedGame?.id ?? null;
  const focusedGame = findGame(focusedGameId);
  const placedGame = findGame(placedGameId) ?? serverSelectedGame;
  const draggedGame = findGame(pointerDrag?.gameId);
  const tableGame = draggedGame ?? focusedGame ?? placedGame;
  const turnTimerMs = room.gameState.turnTimerMs ?? turnTimerOptions[1]?.value ?? turnTimerOptions[0].value;
  const usesTurnTimer = gameUsesTurnTimer(serverSelectedGame?.id);
  const fixedTimerLabel = serverSelectedGame?.timer?.fixedLabel;
  const selectedMeta = serverSelectedGame ? `${serverSelectedGame.title} · ${formatAllowedPlayers(serverSelectedGame)}` : "게임 선택";
  const startStatus = !serverSelectedGame
    ? "게임을 선택하면 테이블에 펼쳐집니다."
    : pendingGameId
      ? "게임 선택을 테이블에 적용하고 있습니다."
      : !isHost
        ? "방장이 게임과 제한 시간을 확인한 뒤 시작합니다."
        : canStart
          ? `${playerCount}명 준비 완료 · 바로 시작할 수 있습니다.`
          : `${gameAvailabilityLabel(serverSelectedGame, playerCount)} · 참가자를 기다리고 있습니다.`;

  const sortedGames = useMemo(
    () =>
      games
        .map((game, index) => ({
          game,
          index,
          available: canPlayGame(game, playerCount)
        }))
        .sort((left, right) => {
          if (left.available !== right.available) {
            return left.available ? -1 : 1;
          }
          if (left.game.priority !== right.game.priority) {
            return left.game.priority === "높음" ? -1 : 1;
          }
          return left.index - right.index;
        })
        .map(({ game }) => game),
    [playerCount]
  );
  const availableGameCount = useMemo(() => games.filter((game) => canPlayGame(game, playerCount)).length, [playerCount]);

  const tableState: CentralTableState = pointerDrag?.overTable
    ? "focused"
    : focusedGame
      ? "focused"
      : tablePhase;

  useEffect(() => {
    if (!selectedGameId) {
      if (!pendingGameId) {
        setPlacedGameId(null);
        setTablePhase("empty");
      }
      return;
    }

    setPlacedGameId(selectedGameId);
    if (pendingGameId === selectedGameId) {
      setPendingGameId(null);
      return;
    }

    if (tablePhase !== "opening" && tablePhase !== "unfolded") {
      setTablePhase("selected");
    }
  }, [pendingGameId, selectedGameId, tablePhase]);

  useEffect(() => {
    if (!pendingGameId) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPendingGameId((current) => (current === pendingGameId ? null : current));
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [pendingGameId]);

  useEffect(() => {
    if (tablePhase === "opening") {
      const timeoutId = window.setTimeout(() => setTablePhase("unfolded"), 280);
      return () => window.clearTimeout(timeoutId);
    }

    if (tablePhase === "unfolded" && selectedGameId && placedGameId === selectedGameId) {
      const timeoutId = window.setTimeout(() => setTablePhase("selected"), 360);
      return () => window.clearTimeout(timeoutId);
    }

    return undefined;
  }, [placedGameId, selectedGameId, tablePhase]);

  function isPointOverTable(x: number, y: number) {
    const rect = tableRef.current?.getBoundingClientRect();
    return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  function previewGame(game: GameDefinition) {
    if (pointerDrag) {
      return;
    }
    setFocusedGameId(game.id);
  }

  function clearPreviewGame(game: GameDefinition) {
    setFocusedGameId((current) => (current === game.id ? null : current));
  }

  function placeGame(game: GameDefinition, source: GamePlacementSource) {
    if (source === "tap" && suppressedClickGameId === game.id) {
      return;
    }

    if (!canPlayGame(game, playerCount) || !isHost) {
      return;
    }

    setFocusedGameId(null);
    setPlacedGameId(game.id);
    setTablePhase("opening");

    if (selectedGameId === game.id) {
      setPendingGameId(null);
      return;
    }

    setPendingGameId(game.id);
    void Promise.resolve(onSelectGame(game.id)).catch(() => {
      setPendingGameId((current) => (current === game.id ? null : current));
      setPlacedGameId(selectedGameId);
      setTablePhase(selectedGameId ? "selected" : "empty");
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) {
    if (!canUsePointerDrag(event) || !isHost || !canPlayGame(game, playerCount)) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const nextDrag: PointerDragState = {
      gameId: game.id,
      pointerId: event.pointerId,
      phase: "grabbed",
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      overTable: false
    };
    pointerDragRef.current = nextDrag;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) {
    const current = pointerDragRef.current;
    if (!current || current.gameId !== game.id || current.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
    const moved = current.moved || distance > 8;
    const nextDrag: PointerDragState = {
      ...current,
      phase: moved ? "dragging" : "grabbed",
      x: event.clientX,
      y: event.clientY,
      moved,
      overTable: moved && isPointOverTable(event.clientX, event.clientY)
    };
    pointerDragRef.current = nextDrag;
    if (moved) {
      setPointerDrag(nextDrag);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) {
    const current = pointerDragRef.current;
    if (!current || current.gameId !== game.id || current.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    pointerDragRef.current = null;
    setPointerDrag(null);
    if (current.moved) {
      setSuppressedClickGameId(game.id);
      window.setTimeout(() => {
        setSuppressedClickGameId((value) => (value === game.id ? null : value));
      }, 0);
    }

    if (current.moved && current.overTable) {
      placeGame(game, "drag");
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = pointerDragRef.current;
    if (current && event.currentTarget.hasPointerCapture(current.pointerId)) {
      event.currentTarget.releasePointerCapture(current.pointerId);
    }
    pointerDragRef.current = null;
    setPointerDrag(null);
  }

  function getBoxState(game: GameDefinition): GameBoxState {
    const available = canPlayGame(game, playerCount);

    if (pointerDrag?.gameId === game.id) {
      return pointerDrag.overTable ? "over-table" : "grabbed";
    }

    if (placedGameId === game.id && tablePhase === "opening") {
      return "opening";
    }

    if (placedGameId === game.id && tablePhase === "unfolded") {
      return "unfolded";
    }

    if (selectedGameId === game.id) {
      return "selected";
    }

    if (focusedGameId === game.id) {
      return "focused";
    }

    if (!available) {
      return "locked";
    }

    return "shelf";
  }

  function getDragPosition(game: GameDefinition) {
    if (pointerDrag?.gameId !== game.id) {
      return null;
    }
    return { x: pointerDrag.x, y: pointerDrag.y };
  }

  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <section
          className="interactive-game-lobby is-game-lobby"
          data-state={tableState}
          data-host={isHost ? "true" : "false"}
          aria-labelledby="interactive-game-lobby-title"
        >
      <header className="game-lobby-header">
        <div className="game-lobby-title-block">
          <span className="game-lobby-eyebrow">ROOM {room.code} / GAME LIBRARY</span>
          <div className="game-lobby-title-line">
            <span className="game-lobby-count">
              <UsersRound size={15} aria-hidden="true" />
              {playerCount}/{room.maxPlayers}
            </span>
            <h2 id="interactive-game-lobby-title">게임 선택</h2>
          </div>
        </div>
        <p className="game-lobby-status" aria-live="polite">
          {serverSelectedGame ? selectedMeta : `전체 ${games.length}개 · ${playerCount}명으로 ${availableGameCount}개 시작 가능`}
        </p>
        <div className="game-lobby-header-actions" aria-label="방 조작">
          <div className="game-lobby-player-tokens" aria-label="참가자">
            {room.players.map((player) => (
              <span key={player.id} data-host={player.isHost ? "true" : "false"} title={player.name}>
                {player.name.slice(0, 1)}
              </span>
            ))}
          </div>
          {onLeaveRoom || onDeleteRoom ? (
            <button
              className="game-lobby-exit-button"
              type="button"
              onClick={room.canDeleteRoom && onDeleteRoom ? onDeleteRoom : onLeaveRoom}
              aria-label={room.canDeleteRoom ? "테이블 닫기" : "테이블 나가기"}
            >
              {room.canDeleteRoom ? <Trash2 size={16} aria-hidden="true" /> : <DoorOpen size={16} aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </header>

      <div className="game-lobby-layout">
        <div className="game-lobby-side">
          <GameShelfViewport
            games={sortedGames}
            playerCount={playerCount}
            isHost={isHost}
            selectedGameId={selectedGameId}
            getBoxState={getBoxState}
            isGameAvailable={(game) => canPlayGame(game, playerCount)}
            getDragPosition={getDragPosition}
            onPreview={previewGame}
            onPreviewEnd={clearPreviewGame}
            onPlace={placeGame}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          />
        </div>

        <aside
          className={`game-lobby-selection-rail ${serverSelectedGame ? "has-selected-game" : "is-empty"}`}
          data-has-selection={serverSelectedGame ? "true" : "false"}
          aria-label={serverSelectedGame ? `선택한 게임: ${serverSelectedGame.title}` : "선택한 게임"}
        >
          <CentralTableStage
            game={tableGame}
            state={tableState}
            players={room.players}
            maxSeats={room.maxPlayers}
            tableRef={(node) => {
              tableRef.current = node;
            }}
          />

          {serverSelectedGame ? (
            <div className="game-lobby-action-bar">
              {fixedTimerLabel ? (
                <div className="game-lobby-timer-control is-fixed" aria-label={`고정 제한 시간: ${fixedTimerLabel}`}>
                  <span>
                    <Clock3 size={15} aria-hidden="true" />
                    고정 제한 시간
                  </span>
                  <strong>{fixedTimerLabel}</strong>
                </div>
              ) : usesTurnTimer ? (
                <label className="game-lobby-timer-control">
                  <span>
                    <Clock3 size={15} aria-hidden="true" />
                    턴 제한
                  </span>
                  <select aria-label="턴 제한" value={turnTimerMs} disabled={!isHost} onChange={(event) => onConfigureTimer(Number(event.currentTarget.value))}>
                    {turnTimerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <button className="game-lobby-start-button" type="button" disabled={!isHost || !canStart} onClick={onStartGame}>
                <Play size={16} aria-hidden="true" />
                <span>{isHost ? (canStart ? "시작" : "대기") : "방장 대기"}</span>
              </button>
              <p className="game-lobby-start-status" data-ready={canStart ? "true" : "false"} aria-live="polite">
                {startStatus}
              </p>
            </div>
          ) : null}
        </aside>
      </div>
      {serverSelectedGame && typeof document !== "undefined" ? createPortal(
        <div className="game-lobby-mobile-start-dock" role="region" aria-label={`선택한 게임 시작: ${serverSelectedGame.title}`}>
          <div className="game-lobby-mobile-start-copy">
            <span>선택됨</span>
            <strong>{serverSelectedGame.title}</strong>
            <small>{startStatus}</small>
          </div>
          {fixedTimerLabel ? (
            <div className="game-lobby-mobile-timer" aria-label={`고정 제한 시간: ${fixedTimerLabel}`}>
              <Clock3 size={14} aria-hidden="true" />
              <strong>{fixedTimerLabel}</strong>
            </div>
          ) : usesTurnTimer ? (
            <label className="game-lobby-mobile-timer">
              <Clock3 size={14} aria-hidden="true" />
              <select aria-label="턴 제한" value={turnTimerMs} disabled={!isHost} onChange={(event) => onConfigureTimer(Number(event.currentTarget.value))}>
                {turnTimerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="game-lobby-mobile-start-button" type="button" disabled={!isHost || !canStart} onClick={onStartGame}>
            <Play size={16} aria-hidden="true" />
            <span>{isHost ? (canStart ? "시작" : "대기") : "방장 대기"}</span>
          </button>
        </div>,
        document.body
      ) : null}
        </section>
      </MotionConfig>
    </LazyMotion>
  );
}

export default InteractiveGameLobby;

import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  Hand,
  LockKeyhole,
  Play,
  Timer,
  UsersRound
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { games } from "../../shared/games";
import { gameCoverSrc } from "../../shared/gameCover";
import { canPlayGame, formatAllowedPlayers, gameAvailabilityLabel } from "../../shared/eligibility";
import { gameUsesTurnTimer, turnTimerOptions } from "../../shared/timers";
import type { GameDefinition, GameTableKind, RoomSnapshot } from "../../shared/types";
import "./game-picker-scene.css";

type GameBoxState = "shelf" | "locked" | "hovered" | "lifted" | "dragging" | "over-table" | "dropped" | "selected";
type TableState = "empty" | "previewing" | "ready-to-drop" | "box-dropped" | "opening" | "unfolded" | "game-selected";
type PlacementSource = "tap" | "drag" | "keyboard";
type StartState = "start-hidden" | "start-disabled-count" | "start-disabled-nonhost" | "start-ready" | "start-pressed" | "starting";

type PointerDragState = {
  gameId: string;
  pointerId: number;
  phase: "lifted" | "dragging";
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  overTable: boolean;
};

export type GamePickerSceneProps = {
  room: RoomSnapshot;
  isHost: boolean;
  playerCount: number;
  selectedGame: GameDefinition | null;
  canStart: boolean;
  onSelectGame: (gameId: string) => void | Promise<void>;
  onConfigureTimer: (nextTimerMs: number) => void;
  onStartGame: () => void;
};

const gameKindLabels: Record<GameTableKind, string> = {
  duel: "대결",
  maze: "경로",
  hex: "육각",
  hidden: "비공개",
  stack: "스택",
  deduction: "추리",
  polyomino: "영역",
  dice: "주사위",
  rings: "링",
  word: "단어"
};

function findGame(gameId: string | null | undefined) {
  return gameId ? games.find((game) => game.id === gameId) ?? null : null;
}

function isOpeningSequence(state: TableState | null) {
  return state === "box-dropped" || state === "opening" || state === "unfolded";
}

export function GamePickerScene({
  room,
  isHost,
  playerCount,
  selectedGame,
  canStart,
  onSelectGame,
  onConfigureTimer,
  onStartGame
}: GamePickerSceneProps) {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [previewGameId, setPreviewGameId] = useState<string | null>(null);
  const [droppedGameId, setDroppedGameId] = useState<string | null>(() => selectedGame?.id ?? null);
  const [tablePhase, setTablePhase] = useState<TableState | null>(() => (selectedGame ? "game-selected" : null));
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [suppressClickGameId, setSuppressClickGameId] = useState<string | null>(null);
  const [lastPlacement, setLastPlacement] = useState<PlacementSource | "preview">("preview");
  const [startInteraction, setStartInteraction] = useState<"start-pressed" | "starting" | null>(null);

  const selectedGameId = selectedGame?.id ?? null;
  const sortedGames = useMemo(
    () =>
      games
        .map((game, index) => ({ game, index, available: canPlayGame(game, playerCount) }))
        .sort((left, right) => {
          if (left.available !== right.available) {
            return left.available ? -1 : 1;
          }
          return left.index - right.index;
        })
        .map(({ game }) => game),
    [playerCount]
  );

  const previewGame = findGame(previewGameId);
  const droppedGame = findGame(droppedGameId);
  const draggedGame = findGame(pointerDrag?.gameId);
  const canPreviewOverride = !isOpeningSequence(tablePhase);
  const tableGame = draggedGame ?? (canPreviewOverride ? previewGame : null) ?? droppedGame ?? selectedGame;
  const placedGame = droppedGame ?? selectedGame;
  const tableState = getTableState({
    pointerDrag,
    tablePhase,
    previewGame: canPreviewOverride ? previewGame : null,
    placedGame
  });
  const turnTimerMs = room.gameState.turnTimerMs ?? turnTimerOptions[1]?.value ?? turnTimerOptions[0].value;
  const timerGame = placedGame;
  const usesTurnTimer = gameUsesTurnTimer(timerGame?.id);
  const boardIsOpen = tableState === "unfolded" || tableState === "game-selected";
  const startState = getStartState({
    selectedGame,
    tableState,
    isHost,
    canStart,
    startInteraction
  });

  const isPointOverTable = useCallback((x: number, y: number) => {
    const rect = tableRef.current?.getBoundingClientRect();
    return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }, []);

  useEffect(() => {
    if (pendingGameId && pendingGameId !== selectedGameId) {
      return;
    }

    if (!selectedGameId) {
      if (!pendingGameId) {
        setDroppedGameId(null);
        setTablePhase(null);
      }
      return;
    }

    if (pendingGameId === selectedGameId) {
      setPendingGameId(null);
      return;
    }

    if (droppedGameId === selectedGameId && isOpeningSequence(tablePhase)) {
      return;
    }

    setDroppedGameId(selectedGameId);
    setPreviewGameId(null);
    setTablePhase("game-selected");
  }, [droppedGameId, pendingGameId, selectedGameId, tablePhase]);

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
    if (tablePhase === "box-dropped") {
      const timeoutId = window.setTimeout(() => setTablePhase("opening"), 160);
      return () => window.clearTimeout(timeoutId);
    }

    if (tablePhase === "opening") {
      const timeoutId = window.setTimeout(() => setTablePhase("unfolded"), 360);
      return () => window.clearTimeout(timeoutId);
    }

    if (tablePhase === "unfolded" && selectedGameId && droppedGameId === selectedGameId) {
      const timeoutId = window.setTimeout(() => setTablePhase("game-selected"), 260);
      return () => window.clearTimeout(timeoutId);
    }

    return undefined;
  }, [droppedGameId, selectedGameId, tablePhase]);

  useEffect(() => {
    if (!startInteraction) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setStartInteraction(null), startInteraction === "starting" ? 700 : 220);
    return () => window.clearTimeout(timeoutId);
  }, [startInteraction]);

  function placeGame(game: GameDefinition, source: PlacementSource) {
    const available = canPlayGame(game, playerCount);
    setPreviewGameId(null);
    setLastPlacement(source);

    if (!available || !isHost) {
      return;
    }

    setDroppedGameId(game.id);
    setTablePhase("box-dropped");

    if (room.selectedGameId === game.id) {
      setPendingGameId(null);
      return;
    }

    setPendingGameId(game.id);
    void Promise.resolve(onSelectGame(game.id)).catch(() => {
      setPendingGameId((current) => (current === game.id ? null : current));
    });
  }

  function previewGameBox(game: GameDefinition) {
    setPreviewGameId(game.id);
    setLastPlacement("preview");
  }

  function canUseShelfPreview() {
    return typeof window === "undefined" || window.matchMedia("(min-width: 641px)").matches;
  }

  function clearPreviewGameBox(game: GameDefinition) {
    setPreviewGameId((current) => (current === game.id ? null : current));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) {
    if (!canUseShelfPreview()) {
      return;
    }

    previewGameBox(game);

    if (!isHost || !canPlayGame(game, playerCount)) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setPointerDrag({
      gameId: game.id,
      pointerId: event.pointerId,
      phase: "lifted",
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      overTable: false
    });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) {
    setPointerDrag((current) => {
      if (!current || current.gameId !== game.id || current.pointerId !== event.pointerId) {
        return current;
      }

      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      const moved = current.moved || distance > 7;
      return {
        ...current,
        phase: moved ? "dragging" : "lifted",
        x: event.clientX,
        y: event.clientY,
        moved,
        overTable: moved && isPointOverTable(event.clientX, event.clientY)
      };
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) {
    const current = pointerDrag;
    if (!current || current.gameId !== game.id || current.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setPointerDrag(null);
    if (current.moved) {
      setSuppressClickGameId(game.id);
      window.setTimeout(() => {
        setSuppressClickGameId((suppressedId) => (suppressedId === game.id ? null : suppressedId));
      }, 0);
    }

    if (current.moved && current.overTable) {
      placeGame(game, "drag");
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    if (pointerDrag && event.currentTarget.hasPointerCapture(pointerDrag.pointerId)) {
      event.currentTarget.releasePointerCapture(pointerDrag.pointerId);
    }
    setPointerDrag(null);
  }

  function handleGameClick(event: ReactMouseEvent<HTMLButtonElement>, game: GameDefinition) {
    if (suppressClickGameId === game.id) {
      event.preventDefault();
      return;
    }
    placeGame(game, "tap");
  }

  function handleGameKeyDown(event: KeyboardEvent<HTMLButtonElement>, game: GameDefinition) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    placeGame(game, "keyboard");
  }

  function handleStart() {
    if (startState !== "start-ready") {
      return;
    }

    setStartInteraction("starting");
    onStartGame();
  }

  return (
    <section
      className="ir-game-picker ir-game-picker-scene"
      data-state={tableState}
      data-gesture={lastPlacement}
      style={{ "--ir-accent": tableGame?.accent ?? "#d5af66" } as CSSProperties}
      aria-labelledby="ir-game-picker-title"
    >
      <header className="ir-scene-header">
        <div className="ir-scene-kicker">
          <span className="ir-player-count">
            <UsersRound size={15} aria-hidden="true" />
            {playerCount}/{room.maxPlayers}
          </span>
        </div>
        <div className="ir-scene-title-row">
          <h2 id="ir-game-picker-title">게임 선택</h2>
          <span className="ir-host-status">{isHost ? "방장 조작" : "방장 대기"}</span>
        </div>
      </header>

      <div className="ir-game-picker-layout">
        <section
          ref={tableRef}
          className="ir-central-table"
          data-state={tableState}
          aria-label={tableGame ? `${tableGame.title} 중앙 테이블` : "중앙 게임 테이블"}
          aria-live="polite"
        >
          <div className="ir-table-felt">
            {tableGame ? (
              <div className="ir-table-content" data-board-open={boardIsOpen ? "true" : "false"}>
                <div className="ir-table-box-stage" data-state={tableState}>
                  <GameCoverImage game={tableGame} className="ir-table-cover" />
                  <span className="ir-table-box-shadow" aria-hidden="true" />
                </div>

                <div className="ir-unfolded-board-preview" data-state={boardIsOpen ? "preview-unfolded" : "preview-unfolding"}>
                  <div className="ir-board-preview-topline">
                    <span className="ir-board-preview-kind">{gameKindLabels[tableGame.table.kind]}</span>
                    <strong>{tableGame.title}</strong>
                    <span>{formatAllowedPlayers(tableGame)}</span>
                  </div>
                  <LightweightBoardPreview game={tableGame} />
                  <div className="ir-board-preview-metrics" aria-hidden="true">
                    <span>{tableGame.table.primaryMetric}</span>
                    <span>{tableGame.table.secondaryMetric}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="ir-empty-table-slot" aria-hidden="true">
                <span />
                <i />
              </div>
            )}

            <div className="ir-table-drop-ring" aria-hidden="true" />
          </div>
        </section>

        <aside className="ir-side-actions" aria-label="게임 준비">
          {usesTurnTimer && timerGame ? (
            <label className="ir-timer-control">
              <span>
                <Clock3 size={15} aria-hidden="true" />
                턴 제한
              </span>
              <span className="ir-select-wrap">
                <select value={turnTimerMs} disabled={!isHost} onChange={(event) => onConfigureTimer(Number(event.currentTarget.value))}>
                  {turnTimerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </span>
            </label>
          ) : (
            <div className="ir-timer-control" data-state="off" aria-hidden="true">
              <span>
                <Timer size={15} />
                턴 제한 없음
              </span>
            </div>
          )}

          {startState !== "start-hidden" ? (
          <div className="ir-start-action" data-state={startState}>
            {isHost ? (
              <button
                className="ir-start-button"
                type="button"
                disabled={startState === "start-disabled-count" || startState === "starting"}
                onPointerDown={() => {
                  if (startState === "start-ready") {
                    setStartInteraction("start-pressed");
                  }
                }}
                onPointerLeave={() => {
                  setStartInteraction((current) => (current === "start-pressed" ? null : current));
                }}
                onClick={handleStart}
              >
                {startState === "starting" ? <Hand size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
                <span>{startState === "starting" ? "시작 중" : startState === "start-ready" ? "시작" : "인원 대기"}</span>
              </button>
            ) : (
              <span className="ir-start-waiting">
                <LockKeyhole size={16} aria-hidden="true" />
                방장 대기
              </span>
            )}
          </div>
          ) : null}
        </aside>
      </div>

      <section className="ir-game-shelf" aria-labelledby="ir-game-shelf-title">
        <div className="ir-shelf-heading">
          <h3 id="ir-game-shelf-title">게임 상자</h3>
          <span>{gameAvailabilityLabel(sortedGames[0] ?? games[0], playerCount)}</span>
        </div>

        <div className="ir-game-shelf-grid" role="list" onPointerLeave={() => setPreviewGameId(null)}>
          {sortedGames.map((game) => {
            const available = canPlayGame(game, playerCount);
            const selected = selectedGameId === game.id;
            const boxState = getGameBoxState({
              game,
              available,
              selected,
              previewGameId,
              droppedGameId,
              pointerDrag
            });
            const activeDrag = pointerDrag?.gameId === game.id ? pointerDrag : null;

            return (
              <button
                key={game.id}
                className="ir-game-box"
                data-state={boxState}
                type="button"
                aria-pressed={selected}
                aria-disabled={!available || !isHost}
                aria-label={`${game.title}, ${formatAllowedPlayers(game)}, ${available ? (isHost ? "테이블에 놓기 가능" : "방장만 선택 가능") : gameAvailabilityLabel(game, playerCount)}`}
                style={
                  {
                    "--ir-accent": game.accent,
                    "--ir-drag-x": activeDrag ? `${activeDrag.x}px` : undefined,
                    "--ir-drag-y": activeDrag ? `${activeDrag.y}px` : undefined
                  } as CSSProperties
                }
                onPointerEnter={() => {
                  if (canUseShelfPreview()) {
                    previewGameBox(game);
                  }
                }}
                onPointerLeave={() => {
                  if (canUseShelfPreview()) {
                    clearPreviewGameBox(game);
                  }
                }}
                onFocus={() => {
                  if (canUseShelfPreview()) {
                    previewGameBox(game);
                  }
                }}
                onBlur={() => {
                  if (canUseShelfPreview()) {
                    clearPreviewGameBox(game);
                  }
                }}
                onPointerDown={(event) => handlePointerDown(event, game)}
                onPointerMove={(event) => handlePointerMove(event, game)}
                onPointerUp={(event) => handlePointerUp(event, game)}
                onPointerCancel={handlePointerCancel}
                onClick={(event) => handleGameClick(event, game)}
                onKeyDown={(event) => handleGameKeyDown(event, game)}
              >
                <span className="ir-game-box-lid">
                  <GameCoverImage game={game} />
                </span>
                <span className="ir-game-box-spine" aria-hidden="true" />
                <span className="ir-game-box-copy">
                  <strong>{game.title}</strong>
                  <small>{formatAllowedPlayers(game)}</small>
                </span>
                <span className="ir-game-box-state">
                  {selected ? (
                    <CheckCircle2 size={15} aria-hidden="true" />
                  ) : available ? (
                    <Hand size={15} aria-hidden="true" />
                  ) : (
                    <LockKeyhole size={15} aria-hidden="true" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function getTableState({
  pointerDrag,
  tablePhase,
  previewGame,
  placedGame
}: {
  pointerDrag: PointerDragState | null;
  tablePhase: TableState | null;
  previewGame: GameDefinition | null;
  placedGame: GameDefinition | null;
}): TableState {
  if (pointerDrag?.overTable) {
    return "ready-to-drop";
  }

  if (previewGame) {
    return "previewing";
  }

  if (tablePhase) {
    return tablePhase;
  }

  if (placedGame) {
    return "game-selected";
  }

  return "empty";
}

function getStartState({
  selectedGame,
  tableState,
  isHost,
  canStart,
  startInteraction
}: {
  selectedGame: GameDefinition | null;
  tableState: TableState;
  isHost: boolean;
  canStart: boolean;
  startInteraction: "start-pressed" | "starting" | null;
}): StartState {
  const boardReady = tableState === "unfolded" || tableState === "game-selected";
  if (!selectedGame || !boardReady) {
    return "start-hidden";
  }

  if (!isHost) {
    return "start-disabled-nonhost";
  }

  if (!canStart) {
    return "start-disabled-count";
  }

  return startInteraction ?? "start-ready";
}

function getGameBoxState({
  game,
  available,
  selected,
  previewGameId,
  droppedGameId,
  pointerDrag
}: {
  game: GameDefinition;
  available: boolean;
  selected: boolean;
  previewGameId: string | null;
  droppedGameId: string | null;
  pointerDrag: PointerDragState | null;
}): GameBoxState {
  if (selected) {
    return "selected";
  }

  if (!available) {
    return "locked";
  }

  if (pointerDrag?.gameId === game.id) {
    if (pointerDrag.overTable) {
      return "over-table";
    }
    return pointerDrag.phase;
  }

  if (droppedGameId === game.id) {
    return "dropped";
  }

  if (previewGameId === game.id) {
    return "hovered";
  }

  return "shelf";
}

function GameCoverImage({ game, className = "" }: { game: GameDefinition; className?: string }) {
  const [failed, setFailed] = useState(false);
  const label = `${game.title} 박스 커버`;

  useEffect(() => {
    setFailed(false);
  }, [game.id]);

  if (failed) {
    return (
      <span className={`ir-game-cover-fallback ${className}`} role="img" aria-label={label}>
        <span>{game.title.slice(0, 2)}</span>
        <i>{gameKindLabels[game.table.kind]}</i>
      </span>
    );
  }

  return (
    <img
      className={`ir-game-cover-image ${className}`}
      src={gameCoverSrc(game)}
      alt={label}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

function LightweightBoardPreview({ game }: { game: GameDefinition }) {
  if (game.id === "guryongtu") return <GuryongtuPreview />;
  if (game.id === "quoridor") return <QuoridorPreview />;
  if (game.id === "abalone-classic") return <AbalonePreview />;
  if (game.id === "ghosts") return <GhostsPreview />;
  if (game.id === "qawale") return <QawalePreview />;
  if (game.id === "omok") return <OmokPreview />;
  if (game.id === "alkkagi") return <AlkkagiPreview />;
  if (game.id === "kkukkkuki") return <KkukkkukiPreview />;
  if (game.id === "davinci-code-plus") return <DavinciPreview />;
  if (game.id === "blokus") return <BlokusPreview />;
  if (game.id === "yacht-dice") return <YachtPreview />;
  if (game.id === "yinsh") return <YinshPreview />;
  if (game.id === "hangman-board-game") return <HangmanPreview />;

  return <GenericBoardPreview game={game} />;
}

function GuryongtuPreview() {
  return (
    <div className="ir-mini-board ir-mini-board-guryongtu" role="img" aria-label="구룡투 숨긴 타일과 중앙 공개 슬롯">
      <div className="ir-mini-tile-rack" aria-hidden="true">
        {[1, 3, 5, 7, 9].map((value) => (
          <span key={`top-${value}`}>{value}</span>
        ))}
      </div>
      <div className="ir-mini-duel-slot" aria-hidden="true">
        <span>8</span>
        <i />
        <span>1</span>
      </div>
      <div className="ir-mini-tile-rack" aria-hidden="true">
        {[2, 4, 6, 8, 9].map((value) => (
          <span key={`bottom-${value}`}>{value}</span>
        ))}
      </div>
    </div>
  );
}

function QuoridorPreview() {
  const pawns = new Map([
    ["0-4", "blue"],
    ["8-4", "red"],
    ["4-0", "green"],
    ["4-8", "gold"]
  ]);
  const walls = new Set(["2-3", "3-5", "5-2", "6-6", "4-4"]);

  return (
    <div className="ir-mini-board ir-mini-board-grid ir-mini-board-quoridor" role="img" aria-label="쿼리도 9x9 보드와 벽 슬롯">
      {Array.from({ length: 81 }, (_, index) => {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const key = `${row}-${col}`;
        return (
          <span key={key} data-wall={walls.has(key) ? "true" : "false"}>
            {pawns.has(key) ? <i data-tone={pawns.get(key)} /> : null}
          </span>
        );
      })}
    </div>
  );
}

function AbalonePreview() {
  const rows = [5, 6, 7, 6, 5];
  return (
    <div className="ir-mini-board ir-mini-board-abalone" role="img" aria-label="아발론 육각 보드와 흑백 구슬">
      {rows.map((count, row) => (
        <div className="ir-mini-hex-row" key={row} style={{ "--ir-row-count": count } as CSSProperties}>
          {Array.from({ length: count }, (_, col) => {
            const tone = row < 2 ? "black" : row > 2 ? "white" : col === 2 || col === 4 ? "brass" : "empty";
            return <span key={`${row}-${col}`} data-tone={tone} />;
          })}
        </div>
      ))}
    </div>
  );
}

function GhostsPreview() {
  return (
    <div className="ir-mini-board ir-mini-board-grid ir-mini-board-ghosts" role="img" aria-label="고스트 6x6 보드와 숨겨진 유령">
      {Array.from({ length: 36 }, (_, index) => {
        const row = Math.floor(index / 6);
        const col = index % 6;
        const tone = row === 0 && col > 0 && col < 5 ? "hidden" : row === 5 && col > 0 && col < 5 ? (col % 2 ? "good" : "bad") : "empty";
        return <span key={index} data-tone={tone} />;
      })}
    </div>
  );
}

function QawalePreview() {
  const stacks = [2, 0, 1, 3, 0, 4, 1, 0, 1, 0, 3, 1, 2, 1, 0, 2];
  return (
    <div className="ir-mini-board ir-mini-board-grid ir-mini-board-qawale" role="img" aria-label="카왈레 4x4 스택 높이">
      {stacks.map((height, index) => (
        <span key={index} data-height={height}>
          {height > 0 ? Array.from({ length: Math.min(height, 4) }, (_, layer) => <i key={layer} />) : null}
        </span>
      ))}
    </div>
  );
}

function OmokPreview() {
  const stones = new Map([
    ["2-2", "black"],
    ["2-3", "white"],
    ["3-3", "black"],
    ["3-4", "white"],
    ["4-4", "black"],
    ["4-5", "white"],
    ["5-5", "black"]
  ]);

  return (
    <div className="ir-mini-board ir-mini-board-grid ir-mini-board-omok" role="img" aria-label="오목 목재 격자와 흑백 돌">
      {Array.from({ length: 81 }, (_, index) => {
        const row = Math.floor(index / 9);
        const col = index % 9;
        return <span key={`${row}-${col}`} data-tone={stones.get(`${row}-${col}`) ?? "empty"} />;
      })}
    </div>
  );
}

function AlkkagiPreview() {
  const eggs = [
    { x: 32, y: 25, tone: "red", king: true },
    { x: 47, y: 35, tone: "red", king: false },
    { x: 66, y: 73, tone: "blue", king: true },
    { x: 49, y: 64, tone: "blue", king: false },
    { x: 34, y: 60, tone: "gold", king: false },
    { x: 72, y: 43, tone: "green", king: false }
  ];

  return (
    <div className="ir-mini-board ir-mini-board-alkkagi" role="img" aria-label="알까기 원형 판과 알 배치">
      {eggs.map((egg, index) => (
        <span
          key={`${egg.tone}-${index}`}
          data-tone={egg.tone}
          data-king={egg.king ? "true" : "false"}
          style={{ "--ir-x": `${egg.x}%`, "--ir-y": `${egg.y}%` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function KkukkkukiPreview() {
  const pieces = new Map([
    ["1-1", "small-warm"],
    ["1-3", "large-cool"],
    ["2-2", "small-warm"],
    ["3-2", "large-warm"],
    ["3-4", "small-cool"],
    ["4-3", "large-cool"]
  ]);

  return (
    <div className="ir-mini-board ir-mini-board-grid ir-mini-board-kkukkkuki" role="img" aria-label="꾹꾹이 쿠션판과 작은 말 큰 말">
      {Array.from({ length: 36 }, (_, index) => {
        const row = Math.floor(index / 6);
        const col = index % 6;
        return (
          <span key={`${row}-${col}`}>
            {pieces.has(`${row}-${col}`) ? <i data-piece={pieces.get(`${row}-${col}`)} /> : null}
          </span>
        );
      })}
    </div>
  );
}

function DavinciPreview() {
  return (
    <div className="ir-mini-board ir-mini-board-davinci" role="img" aria-label="다빈치 코드 비공개 타일 랙">
      {["?", "2", "5", "?", "J", "8"].map((value, index) => (
        <span key={`${value}-${index}`} data-hidden={value === "?" ? "true" : "false"}>
          {value}
        </span>
      ))}
    </div>
  );
}

function BlokusPreview() {
  const filled = new Map([
    ["0-0", "blue"],
    ["1-0", "blue"],
    ["1-1", "blue"],
    ["6-0", "gold"],
    ["6-1", "gold"],
    ["7-1", "gold"],
    ["0-6", "red"],
    ["1-6", "red"],
    ["1-7", "red"],
    ["6-6", "green"],
    ["7-6", "green"],
    ["7-7", "green"]
  ]);

  return (
    <div className="ir-mini-board ir-mini-board-grid ir-mini-board-blokus" role="img" aria-label="블로커스 20x20 축소 격자와 색상 조각">
      {Array.from({ length: 64 }, (_, index) => {
        const row = Math.floor(index / 8);
        const col = index % 8;
        return <span key={`${row}-${col}`} data-tone={filled.get(`${row}-${col}`) ?? "empty"} />;
      })}
    </div>
  );
}

function YachtPreview() {
  const dice = [6, 4, 4, 2, 1];
  const rows = [
    ["1", "3"],
    ["풀", "25"],
    ["요트", "-"]
  ];

  return (
    <div className="ir-mini-board ir-mini-board-yacht" role="img" aria-label="요트 다이스 주사위 트레이와 점수판">
      <div className="ir-mini-dice-tray">
        {dice.map((value, index) => (
          <span key={`${value}-${index}`} className="ir-mini-die" data-held={index === 1 || index === 2 ? "true" : "false"}>
            {Array.from({ length: 9 }, (_, pipIndex) => (
              <i key={pipIndex} data-on={pipIndexes(value).includes(pipIndex) ? "true" : "false"} />
            ))}
          </span>
        ))}
      </div>
      <div className="ir-mini-score-pad">
        {rows.map(([label, value]) => (
          <span key={label}>
            <strong>{label}</strong>
            <i>{value}</i>
          </span>
        ))}
      </div>
    </div>
  );
}

function YinshPreview() {
  const rings = new Set([2, 8, 14, 20]);
  const black = new Set([6, 12, 18]);
  const white = new Set([10, 16, 22]);

  return (
    <div className="ir-mini-board ir-mini-board-grid ir-mini-board-yinsh" role="img" aria-label="인쉬 링과 마커 네트워크">
      {Array.from({ length: 25 }, (_, index) => (
        <span key={index} data-tone={rings.has(index) ? "ring" : black.has(index) ? "black" : white.has(index) ? "white" : "empty"} />
      ))}
    </div>
  );
}

function HangmanPreview() {
  return (
    <div className="ir-mini-board ir-mini-board-hangman" role="img" aria-label="행맨 단어 슬롯과 추측 키패드">
      <div className="ir-mini-word-slots">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} data-filled={index === 3 ? "false" : "true"} />
        ))}
      </div>
      <div className="ir-mini-letter-grid">
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index} data-used={index < 5 ? "true" : "false"} />
        ))}
      </div>
      <div className="ir-mini-guess-track">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} data-lit={index < 2 ? "true" : "false"} />
        ))}
      </div>
    </div>
  );
}

function GenericBoardPreview({ game }: { game: GameDefinition }) {
  const cellCount = game.table.kind === "polyomino" ? 64 : 36;
  return (
    <div className="ir-mini-board ir-mini-board-grid ir-mini-board-generic" data-kind={game.table.kind} role="img" aria-label={game.table.uiHint}>
      {Array.from({ length: cellCount }, (_, index) => (
        <span key={index} data-tone={index % 7 === 0 ? "accent" : "empty"} />
      ))}
    </div>
  );
}

function pipIndexes(value: number) {
  const pipsByValue: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };
  return pipsByValue[value] ?? [];
}

export default GamePickerScene;

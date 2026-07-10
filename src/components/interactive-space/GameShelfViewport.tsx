import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { GameDefinition } from "../../shared/types";
import { GameBoxObject, type GameBoxState, type GamePlacementSource } from "./GameBoxObject";

type DragPosition = {
  x: number;
  y: number;
};

type GameShelfViewportProps = {
  games: GameDefinition[];
  playerCount: number;
  isHost: boolean;
  selectedGameId: string | null;
  collapsed: boolean;
  canCollapse: boolean;
  getBoxState: (game: GameDefinition) => GameBoxState;
  isGameAvailable: (game: GameDefinition) => boolean;
  getDragPosition: (game: GameDefinition) => DragPosition | null;
  onToggleCollapsed: () => void;
  onPreview: (game: GameDefinition) => void;
  onPreviewEnd: (game: GameDefinition) => void;
  onPlace: (game: GameDefinition, source: GamePlacementSource) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>, game: GameDefinition) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

const playerCountTabs = [1, 2, 3, 4];

export function GameShelfViewport({
  games,
  playerCount,
  isHost,
  selectedGameId,
  collapsed,
  canCollapse,
  getBoxState,
  isGameAvailable,
  getDragPosition,
  onToggleCollapsed,
  onPreview,
  onPreviewEnd,
  onPlace,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: GameShelfViewportProps) {
  const [activePlayerCount, setActivePlayerCount] = useState(() => Math.min(4, Math.max(1, playerCount || 1)));
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setActivePlayerCount(Math.min(4, Math.max(1, playerCount || 1)));
  }, [playerCount]);

  const tabItems = useMemo(
    () =>
      playerCountTabs.map((count) => ({
        count,
        games: games.filter((game) => game.allowedPlayerCounts.includes(count))
      })),
    [games]
  );
  const activeGames = useMemo(
    () => games.filter((game) => game.allowedPlayerCounts.includes(activePlayerCount)),
    [activePlayerCount, games]
  );
  const activeTabId = `game-shelf-tab-${activePlayerCount}`;

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % playerCountTabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + playerCountTabs.length) % playerCountTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = playerCountTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextCount = playerCountTabs[nextIndex];
    setActivePlayerCount(nextCount);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section className="game-shelf-viewport" data-collapsed={collapsed ? "true" : "false"} aria-labelledby="game-shelf-title">
      <div className="game-shelf-plaque">
        <div>
          <h3 id="game-shelf-title">게임 고르기</h3>
          <span>{activePlayerCount}명 · {activeGames.length}개</span>
        </div>
        {canCollapse ? (
          <button className="game-shelf-toggle" type="button" aria-expanded={!collapsed} onClick={onToggleCollapsed}>
            {collapsed ? "열기" : "접기"}
          </button>
        ) : null}
      </div>

      <div className="game-shelf-player-tabs" role="tablist" aria-label="인원수별 게임 목록">
        {tabItems.map((tab, index) => {
          const selected = activePlayerCount === tab.count;
          return (
            <button
              key={tab.count}
              id={`game-shelf-tab-${tab.count}`}
              className="game-shelf-player-tab"
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="game-shelf-panel"
              aria-label={`${tab.count}명, 게임 ${tab.games.length}개`}
              tabIndex={selected ? 0 : -1}
              data-selected={selected ? "true" : "false"}
              data-current={playerCount === tab.count ? "true" : "false"}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              onClick={() => setActivePlayerCount(tab.count)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span>{tab.count}명</span>
              <small>{tab.games.length}</small>
            </button>
          );
        })}
      </div>

      <div
        id="game-shelf-panel"
        className="game-shelf-panel"
        role="tabpanel"
        aria-labelledby={activeTabId}
        tabIndex={0}
      >
        <div className="game-shelf-grid" role="list">
          {activeGames.map((game) => {
            const available = isGameAvailable(game);
            return (
              <div className="game-shelf-slot" key={game.id} role="listitem">
                <GameBoxObject
                  game={game}
                  state={getBoxState(game)}
                  available={available}
                  selected={selectedGameId === game.id}
                  isHost={isHost}
                  playerCount={playerCount}
                  dragPosition={getDragPosition(game)}
                  onPreview={onPreview}
                  onPreviewEnd={onPreviewEnd}
                  onPlace={onPlace}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default GameShelfViewport;

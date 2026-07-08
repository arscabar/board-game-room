import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { gameAvailabilityLabel } from "../../shared/eligibility";
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
  const firstGame = activeGames[0] ?? null;
  const shelfHint =
    activePlayerCount === playerCount
      ? firstGame
        ? gameAvailabilityLabel(firstGame, playerCount)
        : "게임 선택"
      : `${activePlayerCount}명 게임 목록`;

  return (
    <section className="game-shelf-viewport" data-collapsed={collapsed ? "true" : "false"} aria-labelledby="game-shelf-title">
      <div className="game-shelf-plaque">
        <div>
          <h3 id="game-shelf-title">게임 상자</h3>
          <span>{shelfHint}</span>
        </div>
        {canCollapse ? (
          <button className="game-shelf-toggle" type="button" aria-expanded={!collapsed} onClick={onToggleCollapsed}>
            {collapsed ? "열기" : "접기"}
          </button>
        ) : null}
      </div>

      <div className="game-shelf-player-tabs" role="tablist" aria-label="인원수별 게임 목록">
        {tabItems.map((tab) => {
          const selected = activePlayerCount === tab.count;
          return (
            <button
              key={tab.count}
              className="game-shelf-player-tab"
              type="button"
              role="tab"
              aria-selected={selected}
              data-selected={selected ? "true" : "false"}
              data-current={playerCount === tab.count ? "true" : "false"}
              onClick={() => setActivePlayerCount(tab.count)}
            >
              <span>{tab.count}명</span>
              <small>{tab.games.length}</small>
            </button>
          );
        })}
      </div>

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
    </section>
  );
}

export default GameShelfViewport;

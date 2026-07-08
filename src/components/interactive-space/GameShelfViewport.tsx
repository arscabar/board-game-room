import type { PointerEvent as ReactPointerEvent } from "react";
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
  const firstGame = games[0] ?? null;

  return (
    <section className="game-shelf-viewport" data-collapsed={collapsed ? "true" : "false"} aria-labelledby="game-shelf-title">
      <div className="game-shelf-plaque">
        <div>
          <h3 id="game-shelf-title">게임 상자</h3>
          <span>{firstGame ? gameAvailabilityLabel(firstGame, playerCount) : "게임 선택"}</span>
        </div>
        {canCollapse ? (
          <button className="game-shelf-toggle" type="button" aria-expanded={!collapsed} onClick={onToggleCollapsed}>
            {collapsed ? "열기" : "접기"}
          </button>
        ) : null}
      </div>

      <div className="game-shelf-grid" role="list">
        {games.map((game) => {
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

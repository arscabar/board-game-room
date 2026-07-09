import type { CSSProperties } from "react";
import type { GameDefinition, PlayerSnapshot } from "../../shared/types";
import { GameSelectionScene } from "./GameSelectionScene";
import { SeatTokensAroundTable } from "./SeatTokensAroundTable";

export type CentralTableState = "empty" | "focused" | "opening" | "unfolded" | "selected";

type CentralTableStageProps = {
  game: GameDefinition | null;
  state: CentralTableState;
  players?: PlayerSnapshot[];
  maxSeats?: number;
  tableRef?: (node: HTMLElement | null) => void;
};

export function CentralTableStage({ game, state, players = [], maxSeats = 4, tableRef }: CentralTableStageProps) {
  return (
    <section
      className="central-table-stage"
      data-state={state}
      ref={tableRef}
      aria-label={game ? `${game.title} 중앙 테이블` : "중앙 테이블"}
      aria-live="polite"
      style={{ "--game-accent": game?.accent ?? "#d0a047" } as CSSProperties}
    >
      <div className="central-table-frame">
        <div className="central-table-felt">
          <span className="table-drop-ring" aria-hidden="true" />
          <SeatTokensAroundTable players={players} maxSeats={maxSeats} />

          {game ? (
            <div className="table-game-spread">
              <div className="unfolded-board-preview selection-scene-surface" data-state={state === "focused" ? "closed" : "open"}>
                <GameSelectionScene game={game} />
              </div>
            </div>
          ) : (
            <div className="empty-table-slot">
              <span className="empty-table-ring" aria-hidden="true" />
              <span className="empty-table-box">게임 상자</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default CentralTableStage;

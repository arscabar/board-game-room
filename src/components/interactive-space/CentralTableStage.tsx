import type { CSSProperties } from "react";
import * as m from "motion/react-m";
import { formatAllowedPlayers } from "../../shared/eligibility";
import type { GameDefinition } from "../../shared/types";
import { GameCover } from "./GameBoxObject";

export type CentralTableState = "empty" | "focused" | "opening" | "unfolded" | "selected";

type CentralTableStageProps = {
  game: GameDefinition | null;
  state: CentralTableState;
  tableRef?: (node: HTMLElement | null) => void;
};

export function CentralTableStage({ game, state, tableRef }: CentralTableStageProps) {
  return (
    <section
      className="central-table-stage"
      data-state={state}
      ref={tableRef}
      aria-label={game ? `${game.title} 중앙 테이블` : "중앙 테이블"}
      aria-live="polite"
      data-game={game?.id ?? "empty"}
      style={{ "--game-accent": game?.accent ?? "#d0a047" } as CSSProperties}
    >
      <div className="central-table-frame">
        <div className="central-table-felt">
          <span className="table-drop-ring" aria-hidden="true" />

          {game ? (
            <div className="table-selection-object" data-state={state}>
              <m.div
                className="tabletop-game-box"
                aria-hidden="true"
                layoutId={`game-box-${game.id}`}
                transition={{ layout: { type: "spring", stiffness: 430, damping: 34, mass: 0.72 } }}
              >
                <GameCover game={game} className="table-cover-art" />
                <span className="tabletop-game-box-spine" />
              </m.div>
              <div className="tabletop-token-cluster" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <span key={index} data-token={index + 1} />
                ))}
              </div>
              <div className="table-selection-label">
                <strong>{game.title}</strong>
                <span>{formatAllowedPlayers(game)}</span>
              </div>
            </div>
          ) : (
            <div className="empty-table-slot">
              <span className="empty-table-line" aria-hidden="true" />
              <span className="empty-table-box">게임을 선택하세요</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default CentralTableStage;

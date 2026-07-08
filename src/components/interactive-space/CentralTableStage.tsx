import type { CSSProperties } from "react";
import type { GameDefinition, PlayerSnapshot } from "../../shared/types";
import { GameCover } from "./GameBoxObject";
import { SeatTokensAroundTable } from "./SeatTokensAroundTable";

export type CentralTableState = "empty" | "focused" | "opening" | "unfolded" | "selected";

type CentralTableStageProps = {
  game: GameDefinition | null;
  state: CentralTableState;
  players?: PlayerSnapshot[];
  maxSeats?: number;
  tableRef?: (node: HTMLElement | null) => void;
};

const pipsByValue: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

function diceFace(value: number, index: number, held = false) {
  return (
    <span className="mini-die" data-held={held ? "true" : "false"} key={`${value}-${index}`}>
      {Array.from({ length: 9 }, (_, pipIndex) => (
        <i key={pipIndex} data-on={pipsByValue[value]?.includes(pipIndex) ? "true" : "false"} />
      ))}
    </span>
  );
}

function MiniBoardPreview({ game }: { game: GameDefinition }) {
  if (game.id === "yacht-dice") {
    return <div className="mini-board-dice">{[6, 4, 4, 2, 1].map((value, index) => diceFace(value, index, index === 1 || index === 2))}</div>;
  }

  if (game.id === "abalone-classic") {
    const rows = [5, 6, 7, 6, 5];
    return (
      <div className="mini-board-hex">
        {rows.map((count, row) => (
          <div key={row} style={{ "--mini-row-count": count } as CSSProperties}>
            {Array.from({ length: count }, (_, col) => {
              const tone = row < 2 ? "dark" : row > 2 ? "light" : col === 2 || col === 4 ? "light" : "";
              return <span key={`${row}-${col}`} data-tone={tone} />;
            })}
          </div>
        ))}
      </div>
    );
  }

  if (game.id === "hangman-board-game") {
    return (
      <div className="mini-board-word">
        <div className="mini-word-slots">
          {Array.from({ length: 6 }, (_, index) => <span key={index} data-filled={index === 4 ? "false" : "true"} />)}
        </div>
        <div className="mini-letter-rack">
          {Array.from({ length: 6 }, (_, index) => <span key={index} data-used={index < 3 ? "true" : "false"} />)}
        </div>
      </div>
    );
  }

  if (game.id === "alkkagi") {
    const stones = [
      { x: 28, y: 34, tone: "red" },
      { x: 40, y: 45, tone: "red" },
      { x: 72, y: 64, tone: "blue" },
      { x: 58, y: 52, tone: "blue" },
      { x: 48, y: 71, tone: "green" }
    ];
    return (
      <div className="mini-board-alkkagi">
        {stones.map((stone, index) => (
          <span key={index} data-tone={stone.tone} style={{ "--mini-x": `${stone.x}%`, "--mini-y": `${stone.y}%` } as CSSProperties} />
        ))}
      </div>
    );
  }

  if (game.id === "davinci-code-plus") {
    return (
      <div className="mini-board-davinci">
        {["?", "2", "5", "?", "8", "★"].map((label, index) => (
          <span key={`${label}-${index}`} data-hidden={label === "?" ? "true" : "false"}>
            {label}
          </span>
        ))}
      </div>
    );
  }

  const kind = game.table.kind;
  const cellCount = kind === "polyomino" || kind === "maze" || kind === "rings" ? 49 : kind === "hidden" || kind === "deduction" ? 36 : kind === "stack" ? 16 : 25;
  const tonesByGame: Record<string, string[]> = {
    blokus: ["blue", "blue", "", "", "gold", "", "red", "", "", "green"],
    quoridor: ["", "", "wall", "", "", "", "piece", "", "", "wall"],
    qawale: ["stack", "", "stack", "stack", "", "stack"],
    yinsh: ["ring", "", "stone", "", "ring", "stone"],
    ghosts: ["hidden", "", "hidden", "", "hidden", "piece"],
    guryongtu: ["tile", "", "tile", "", "tile"]
  };
  const tones = tonesByGame[game.id] ?? ["piece", "", "", "piece", "", "ring"];

  return (
    <div className="mini-board-grid" data-kind={kind}>
      {Array.from({ length: cellCount }, (_, index) => (
        <span key={index} data-tone={tones[index % tones.length]} />
      ))}
    </div>
  );
}

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
              <div className="table-box-shell" data-state={state}>
                <span className="table-box-lid">
                  <GameCover game={game} className="table-cover-art" />
                </span>
                <span className="table-box-base" aria-hidden="true" />
              </div>

              <div className="unfolded-board-preview" data-state={state === "focused" ? "closed" : "open"}>
                <div className="mini-board-plaque">
                  <strong>{game.title}</strong>
                  <span>{game.allowedPlayerCounts.join(", ")}명</span>
                </div>
                <div className="mini-board-preview">
                  <MiniBoardPreview game={game} />
                </div>
                <div className="mini-board-metrics">
                  <span>{game.table.primaryMetric}</span>
                  <span>{game.table.secondaryMetric}</span>
                </div>
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

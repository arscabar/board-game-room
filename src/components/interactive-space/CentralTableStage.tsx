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

function diceFace(value: number, index: number, held = false, className = "", style?: CSSProperties) {
  return (
    <span className={`mini-die ${className}`.trim()} data-held={held ? "true" : "false"} key={`${value}-${index}`} style={style}>
      {Array.from({ length: 9 }, (_, pipIndex) => (
        <i key={pipIndex} data-on={pipsByValue[value]?.includes(pipIndex) ? "true" : "false"} />
      ))}
    </span>
  );
}

const revealPiecesByGame: Record<string, string[]> = {
  "abalone-classic": ["marble-black", "marble-black", "push", "marble-white", "marble-white"],
  alkkagi: ["disc-red", "disc-blue", "impact", "disc-yellow", "disc-green"],
  blokus: ["poly-blue", "poly-red", "poly-green", "poly-yellow", "corner"],
  "davinci-code-plus": ["tile-hidden", "tile-3", "tile-hidden", "tile-star"],
  ghosts: ["ghost-hidden", "ghost-good", "ghost-bad", "gate"],
  guryongtu: ["token-black", "token-white", "token-red", "flip"],
  "hangman-board-game": ["gallows", "letter", "letter-hidden", "chalk"],
  kkukkkuki: ["kitten", "paw", "cat", "boop"],
  "masterpiece-copy": ["canvas", "card", "brush", "laser", "frame"],
  omok: ["stone-black", "stone-white", "line", "stone-black", "stone-white"],
  qawale: ["stone-cream", "stone-brown", "stack", "stone-cream"],
  quoridor: ["pawn", "wall", "path", "wall", "pawn"],
  "yacht-dice": ["die-6", "die-4", "die-4", "die-2", "die-1"],
  yinsh: ["ring", "marker-black", "marker-white", "ring"]
};

const revealPiecesByKind: Record<string, string[]> = {
  deduction: ["tile-hidden", "tile-3", "tile-hidden"],
  duel: ["stone-black", "stone-white", "line"],
  hidden: ["ghost-hidden", "ghost-good", "ghost-bad"],
  maze: ["pawn", "wall", "path", "wall"],
  physics: ["disc-red", "impact", "disc-blue"],
  polyomino: ["poly-blue", "poly-red", "poly-yellow"],
  rings: ["ring", "marker-black", "marker-white"],
  stack: ["stone-cream", "stack", "stone-brown"],
  word: ["gallows", "letter", "chalk"]
};

function TableRevealEffect({ game }: { game: GameDefinition }) {
  const pieces = revealPiecesByGame[game.id] ?? revealPiecesByKind[game.table.kind] ?? ["token-black", "token-white", "flip"];

  return (
    <div className={`table-reveal-effect effect-${game.id}`} data-kind={game.table.kind} aria-hidden="true">
      <span className="table-reveal-pulse" />
      <div className="table-reveal-pieces">
        {pieces.map((piece, index) =>
          piece.startsWith("die-") ? (
            diceFace(Number(piece.replace("die-", "")), index, index === 1 || index === 2, "table-reveal-piece", { "--piece-index": index } as CSSProperties)
          ) : (
            <span key={`${piece}-${index}`} className="table-reveal-piece" data-piece={piece} style={{ "--piece-index": index } as CSSProperties} />
          )
        )}
      </div>
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

              <div className="unfolded-board-preview table-reveal-surface" data-state={state === "focused" ? "closed" : "open"} aria-label={`${game.title} 선택 이펙트`}>
                <TableRevealEffect game={game} />
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

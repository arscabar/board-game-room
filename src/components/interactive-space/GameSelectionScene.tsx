import type { CSSProperties, ReactNode } from "react";
import type { GameDefinition } from "../../shared/types";

const pips: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
};

function Die({ value, index }: { value: number; index: number }) {
  return (
    <span className="selection-die" style={{ "--scene-index": index } as CSSProperties}>
      {Array.from({ length: 9 }, (_, pip) => <i key={pip} data-on={pips[value].includes(pip) ? "true" : "false"} />)}
    </span>
  );
}

function Grid({ size, children, className = "" }: { size: number; children?: ReactNode; className?: string }) {
  return (
    <div className={`selection-grid ${className}`} style={{ "--scene-grid": size } as CSSProperties}>
      {Array.from({ length: size * size }, (_, index) => <span key={index} />)}
      {children}
    </div>
  );
}

function YachtScene() {
  return <div className="scene-layout scene-yacht"><div className="scene-dice-tray">{[6, 4, 4, 2, 1].map((value, index) => <Die key={index} value={value} index={index} />)}</div><div className="scene-score-sheet">{["1", "2", "3", "4", "5", "6", "초이스", "요트"].map((row, index) => <span key={row}><b>{row}</b><i>{index === 7 ? "50" : index * 3}</i></span>)}</div></div>;
}

function BlokusScene() {
  return <Grid size={10} className="scene-blokus"><i className="poly poly-blue" /><i className="poly poly-red" /><i className="poly poly-yellow" /><i className="poly poly-green" /></Grid>;
}

function QuoridorScene() {
  return <Grid size={9} className="scene-quoridor"><i className="pawn pawn-top" /><i className="pawn pawn-bottom" /><i className="wall wall-one" /><i className="wall wall-two" /><i className="move-cell" /></Grid>;
}

function HangmanScene() {
  return <div className="scene-hangman"><div className="hangman-drawing"><i className="gallows" /><i className="head" /><i className="body" /></div><div className="word-slots">{"BOARD".split("").map((letter, index) => <span key={letter} data-hidden={index === 2 ? "true" : "false"}>{index === 2 ? "" : letter}</span>)}</div><div className="letter-tiles">{"ABCDEFGH".split("").map((letter) => <i key={letter}>{letter}</i>)}</div></div>;
}

function DavinciScene() {
  return <div className="scene-davinci"><div className="tile-rack">{["?", "?", "?", "?", "?", "?"].map((value, index) => <span key={index} data-tone={index % 2 ? "white" : "black"} data-flip={index === 3 ? "true" : "false"}>{value}</span>)}</div><i className="rack-base" /></div>;
}

function GuryongtuScene() {
  return <div className="scene-guryongtu"><div className="token-stack stack-a">{["black", "red", "white"].map((tone) => <i key={tone} data-tone={tone} />)}</div><div className="duel-line"><span data-tone="black" /><b>VS</b><span data-tone="red" /></div><div className="token-stack stack-b">{["white", "black", "red"].map((tone) => <i key={tone} data-tone={tone} />)}</div></div>;
}

function QawaleScene() {
  const heights = [2, 0, 1, 3, 0, 4, 1, 0, 1, 0, 3, 1, 2, 1, 0, 2];
  return <div className="scene-qawale">{heights.map((height, cell) => <span key={cell}>{Array.from({ length: height }, (_, layer) => <i key={layer} style={{ "--stack-level": layer } as CSSProperties} />)}</span>)}</div>;
}

function AbaloneScene() {
  const rows = [5, 6, 7, 8, 9, 8, 7, 6, 5];
  return <div className="scene-abalone">{rows.map((count, row) => <div key={row}>{Array.from({ length: count }, (_, col) => <i key={col} data-tone={row < 3 ? "black" : row > 5 ? "white" : row === 4 && col > 2 && col < 6 ? "push" : "empty"} />)}</div>)}</div>;
}

function GhostsScene() {
  return <Grid size={6} className="scene-ghosts"><i className="ghost ghost-one" /><i className="ghost ghost-two" /><i className="ghost ghost-caught" /><i className="ghost-gate" /></Grid>;
}

function OmokScene() {
  return <Grid size={9} className="scene-omok">{Array.from({ length: 9 }, (_, index) => <i key={index} data-tone={index % 2 ? "white" : "black"} style={{ "--stone-index": index } as CSSProperties} />)}</Grid>;
}

function KkukkkukiScene() {
  return <Grid size={6} className="scene-kkukkkuki"><i className="cat cat-warm kitten" /><i className="cat cat-cool adult" /><i className="cat cat-warm adult" /><i className="cat cat-cool kitten" /></Grid>;
}

function AlkkagiScene() {
  return <div className="scene-alkkagi">{["red king", "red", "blue king", "blue", "gold", "green"].map((tone, index) => <i key={index} className={tone} style={{ "--disc-index": index } as CSSProperties} />)}<span className="impact-mark" /></div>;
}

function YinshScene() {
  return <div className="scene-yinsh">{Array.from({ length: 31 }, (_, index) => <span key={index} data-tone={[4, 10, 20, 26].includes(index) ? "ring" : [8, 14, 15, 16, 22].includes(index) ? (index % 2 ? "white" : "black") : "empty"} />)}<i className="yinsh-run" /></div>;
}

function MasterpieceScene() {
  return <div className="scene-masterpiece"><div className="canvas-art"><i className="paint-sun" /><i className="paint-hill" /><i className="paint-river" /><span className="scan-line" /></div><i className="paint-brush" /></div>;
}

function sceneFor(gameId: string) {
  switch (gameId) {
    case "yacht-dice": return <YachtScene />;
    case "blokus": return <BlokusScene />;
    case "quoridor": return <QuoridorScene />;
    case "hangman-board-game": return <HangmanScene />;
    case "davinci-code-plus": return <DavinciScene />;
    case "guryongtu": return <GuryongtuScene />;
    case "qawale": return <QawaleScene />;
    case "abalone-classic": return <AbaloneScene />;
    case "ghosts": return <GhostsScene />;
    case "omok": return <OmokScene />;
    case "kkukkkuki": return <KkukkkukiScene />;
    case "alkkagi": return <AlkkagiScene />;
    case "yinsh": return <YinshScene />;
    case "masterpiece-copy": return <MasterpieceScene />;
    default: return <Grid size={8} className="scene-generic" />;
  }
}

export function GameSelectionScene({ game }: { game: GameDefinition }) {
  return <div className="game-selection-scene" data-game={game.id} data-kind={game.table.kind} role="img" aria-label={`${game.title} 게임판`}>{sceneFor(game.id)}</div>;
}

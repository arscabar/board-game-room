import type { CSSProperties } from "react";
import type { PlayerSnapshot } from "../../shared/types";

type SeatTokensAroundTableProps = {
  players: PlayerSnapshot[];
  maxSeats: number;
};

const paletteColors: Record<string, { base: string; light: string }> = {
  amber: { base: "#c88b25", light: "#ffe09a" },
  blue: { base: "#2364aa", light: "#9bc3ff" },
  ivory: { base: "#efe0b6", light: "#fff7dc" },
  rose: { base: "#b33d55", light: "#ff9cad" },
  teal: { base: "#0c8b6c", light: "#72dec1" },
  violet: { base: "#7450b8", light: "#c3a8ff" }
};

function seatStyle(player: PlayerSnapshot | undefined, seat: number) {
  const palette = player ? paletteColors[player.avatar.palette] ?? paletteColors.teal : paletteColors.ivory;
  return {
    "--seat-index": seat,
    "--seat-base": palette.base,
    "--seat-light": palette.light
  } as CSSProperties;
}

export function SeatTokensAroundTable({ players, maxSeats }: SeatTokensAroundTableProps) {
  const seats = Array.from({ length: maxSeats }, (_, index) => {
    const seat = index + 1;
    return {
      seat,
      player: players.find((item) => item.seat === seat)
    };
  });

  return (
    <div className="seat-tokens-around-table" aria-label="좌석">
      {seats.map(({ seat, player }) => (
        <div
          key={seat}
          className="seat-token"
          data-seat={seat}
          data-filled={player ? "true" : "false"}
          data-host={player?.isHost ? "true" : "false"}
          data-offline={player && !player.connected ? "true" : "false"}
          style={seatStyle(player, seat)}
          title={player ? player.name : "빈 좌석"}
        >
          <span className="seat-token-piece" aria-hidden="true">
            <i />
          </span>
          <span className="seat-token-name">{player?.name ?? "빈 좌석"}</span>
        </div>
      ))}
    </div>
  );
}

export default SeatTokensAroundTable;

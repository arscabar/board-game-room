import { CircleDot, MoveRight, Scissors } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import type { GameComponentProps, GameModule } from "../types";
import { useInteractionGate } from "../useInteractionGate";

type YinshColor = "white" | "black";
type YinshPhase = "ring-placement" | "move" | "remove-row" | "finished";

type AxialPoint = {
  q: number;
  r: number;
  key: string;
};

type YinshPlayerState = {
  id: string;
  name: string;
  color: YinshColor;
};

type PendingRow = {
  color: YinshColor;
  cells: string[];
};

type RowResolution = {
  nextColor: YinshColor;
  roundIncrement: number;
};

type YinshState = {
  phase: YinshPhase;
  players: Record<YinshColor, YinshPlayerState>;
  rings: Record<string, YinshColor>;
  markers: Record<string, YinshColor>;
  markersRemaining: number;
  ringsPlaced: Record<YinshColor, number>;
  ringsRemoved: Record<YinshColor, number>;
  pendingRows: PendingRow[];
  rowResolution: RowResolution | null;
  message: string;
  winnerId: string | null;
  winnerIds: string[];
};

type YinshPublicState = YinshState & {
  points: AxialPoint[];
};

const RINGS_PER_PLAYER = 5;
const RINGS_TO_WIN = 3;
const MARKER_POOL_SIZE = 51;
const GRID_RADIUS = 5;
const COLORS: YinshColor[] = ["white", "black"];
const COLOR_LABELS: Record<YinshColor, string> = {
  white: "백",
  black: "흑"
};

const DIRECTIONS: Array<Pick<AxialPoint, "q" | "r">> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

const LINE_DIRECTIONS: Array<Pick<AxialPoint, "q" | "r">> = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: 1, r: -1 }
];

function pointKey(q: number, r: number) {
  return `${q},${r}`;
}

function parsePointKey(key: string): AxialPoint | null {
  const [qText, rText] = key.split(",");
  const q = Number(qText);
  const r = Number(rText);
  if (!Number.isInteger(q) || !Number.isInteger(r)) {
    return null;
  }
  return { q, r, key };
}

function axialDistance(q: number, r: number) {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

// Coherent 85-point YINSH board approximation: a radius-5 axial hex grid has 91
// points, and removing the six extreme corners leaves 85 playable intersections.
const OMITTED_CORNERS = new Set([
  pointKey(5, 0),
  pointKey(5, -5),
  pointKey(0, -5),
  pointKey(-5, 0),
  pointKey(-5, 5),
  pointKey(0, 5)
]);

const POINTS: AxialPoint[] = Array.from({ length: GRID_RADIUS * 2 + 1 }, (_, qIndex) => qIndex - GRID_RADIUS)
  .flatMap((q) =>
    Array.from({ length: GRID_RADIUS * 2 + 1 }, (_, rIndex) => rIndex - GRID_RADIUS).map((r) => ({
      q,
      r,
      key: pointKey(q, r)
    }))
  )
  .filter((point) => axialDistance(point.q, point.r) <= GRID_RADIUS && !OMITTED_CORNERS.has(point.key))
  .sort((a, b) => a.r - b.r || a.q - b.q);

const POINT_SET = new Set(POINTS.map((point) => point.key));

function isValidPoint(key: string) {
  return POINT_SET.has(key);
}

function otherColor(color: YinshColor): YinshColor {
  return color === "white" ? "black" : "white";
}

function getColorForPlayer(state: Pick<YinshState, "players">, playerId: string | null | undefined) {
  if (!playerId) {
    return null;
  }
  return COLORS.find((color) => state.players[color].id === playerId) ?? null;
}

function getPlayerForColor(state: Pick<YinshState, "players">, color: YinshColor) {
  return state.players[color];
}

function isPointEmpty(state: Pick<YinshState, "rings" | "markers">, key: string) {
  return isValidPoint(key) && !state.rings[key] && !state.markers[key];
}

function getMarkersRemaining(state: Pick<YinshState, "markers"> & Partial<Pick<YinshState, "markersRemaining">>) {
  return typeof state.markersRemaining === "number" && Number.isFinite(state.markersRemaining)
    ? Math.max(0, state.markersRemaining)
    : Math.max(0, MARKER_POOL_SIZE - Object.keys(state.markers).length);
}

function cloneState(state: YinshState): YinshState {
  return {
    phase: state.phase,
    players: {
      white: { ...state.players.white },
      black: { ...state.players.black }
    },
    rings: { ...state.rings },
    markers: { ...state.markers },
    markersRemaining: getMarkersRemaining(state),
    ringsPlaced: { ...state.ringsPlaced },
    ringsRemoved: { ...state.ringsRemoved },
    pendingRows: state.pendingRows.map((row) => ({ color: row.color, cells: [...row.cells] })),
    rowResolution: state.rowResolution ? { ...state.rowResolution } : null,
    message: state.message,
    winnerId: state.winnerId,
    winnerIds: [...(state.winnerIds ?? (state.winnerId ? [state.winnerId] : []))]
  };
}

function assertYinshState(state: unknown): YinshState {
  if (!state || typeof state !== "object" || !("rings" in state) || !("markers" in state)) {
    throw new Error("인쉬 상태가 올바르지 않습니다.");
  }
  return state as YinshState;
}

function readKeyPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const key = (payload as Record<string, unknown>).key;
  return typeof key === "string" ? key : null;
}

function readMovePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.from === "string" && typeof record.to === "string"
    ? { from: record.from, to: record.to }
    : null;
}

function readRemovePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.rowIndex === "number" &&
    Number.isInteger(record.rowIndex) &&
    typeof record.ringKey === "string"
    ? { rowIndex: record.rowIndex, ringKey: record.ringKey }
    : null;
}

function requireActiveColor(state: YinshState, currentPlayerId: string, activePlayerId: string | null) {
  if (state.phase === "finished") {
    throw new Error("이미 종료된 게임입니다.");
  }
  if (currentPlayerId !== activePlayerId) {
    throw new Error("현재 차례의 플레이어만 행동할 수 있습니다.");
  }

  const color = getColorForPlayer(state, currentPlayerId);
  if (!color) {
    throw new Error("인쉬 플레이어를 찾을 수 없습니다.");
  }

  const nextRow = state.pendingRows[0];
  if (state.phase === "remove-row" && nextRow && nextRow.color !== color) {
    throw new Error(`${COLOR_LABELS[nextRow.color]} 플레이어가 먼저 줄을 제거해야 합니다.`);
  }

  return color;
}

function getAdvance(color: YinshColor): RowResolution {
  const nextColor = otherColor(color);
  return {
    nextColor,
    roundIncrement: color === "black" && nextColor === "white" ? 1 : 0
  };
}

function getStraightPath(fromKey: string, toKey: string) {
  const from = parsePointKey(fromKey);
  if (!from || !isValidPoint(fromKey) || !isValidPoint(toKey) || fromKey === toKey) {
    return null;
  }

  for (const direction of DIRECTIONS) {
    const path: string[] = [];
    let q = from.q + direction.q;
    let r = from.r + direction.r;
    while (isValidPoint(pointKey(q, r))) {
      const key = pointKey(q, r);
      path.push(key);
      if (key === toKey) {
        return path;
      }
      q += direction.q;
      r += direction.r;
    }
  }

  return null;
}

function getMoveMarkersToFlip(state: Pick<YinshState, "rings" | "markers">, fromKey: string, toKey: string) {
  const path = getStraightPath(fromKey, toKey);
  if (!path) {
    return { ok: false as const, error: "링은 직선으로만 이동할 수 있습니다." };
  }

  const markersToFlip: string[] = [];
  let hasCrossedMarker = false;

  for (let index = 0; index < path.length; index += 1) {
    const key = path[index];
    const isDestination = index === path.length - 1;
    if (state.rings[key]) {
      return { ok: false as const, error: "다른 링을 지나갈 수 없습니다." };
    }

    if (isDestination) {
      if (state.markers[key]) {
        return { ok: false as const, error: "마커 위에서 멈출 수 없습니다." };
      }
      return { ok: true as const, markersToFlip };
    }

    if (state.markers[key]) {
      hasCrossedMarker = true;
      markersToFlip.push(key);
      continue;
    }

    if (hasCrossedMarker) {
      return { ok: false as const, error: "마커를 넘은 뒤에는 첫 빈 점에서 멈춰야 합니다." };
    }
  }

  return { ok: false as const, error: "이동할 수 없는 위치입니다." };
}

function getLegalDestinations(state: Pick<YinshState, "rings" | "markers">, fromKey: string) {
  const from = parsePointKey(fromKey);
  if (!from || !state.rings[fromKey]) {
    return [];
  }

  const destinations: string[] = [];
  for (const direction of DIRECTIONS) {
    let q = from.q + direction.q;
    let r = from.r + direction.r;
    let hasCrossedMarker = false;

    while (isValidPoint(pointKey(q, r))) {
      const key = pointKey(q, r);
      if (state.rings[key]) {
        break;
      }
      if (state.markers[key]) {
        hasCrossedMarker = true;
        q += direction.q;
        r += direction.r;
        continue;
      }
      destinations.push(key);
      if (hasCrossedMarker) {
        break;
      }
      q += direction.q;
      r += direction.r;
    }
  }

  return destinations;
}

function flipColor(color: YinshColor): YinshColor {
  return color === "white" ? "black" : "white";
}

function findRows(markers: Record<string, YinshColor>, color: YinshColor) {
  const rows: PendingRow[] = [];

  for (const point of POINTS) {
    for (const direction of LINE_DIRECTIONS) {
      const previousKey = pointKey(point.q - direction.q, point.r - direction.r);
      if (markers[previousKey] === color) {
        continue;
      }

      const run: string[] = [];
      let q = point.q;
      let r = point.r;
      while (isValidPoint(pointKey(q, r)) && markers[pointKey(q, r)] === color) {
        run.push(pointKey(q, r));
        q += direction.q;
        r += direction.r;
      }

      if (run.length >= 5) {
        for (let start = 0; start <= run.length - 5; start += 1) {
          rows.push({ color, cells: run.slice(start, start + 5) });
        }
      }
    }
  }

  return rows;
}

function findRowsForRemoval(markers: Record<string, YinshColor>, preferredColor: YinshColor) {
  return [...findRows(markers, preferredColor), ...findRows(markers, otherColor(preferredColor))];
}

function finishByMarkerExhaustion(state: YinshState) {
  const highScore = Math.max(...COLORS.map((color) => state.ringsRemoved[color]));
  const winnerColors = COLORS.filter((color) => state.ringsRemoved[color] === highScore);
  const winnerIds = winnerColors.length === 1 ? winnerColors.map((color) => getPlayerForColor(state, color).id) : [];
  state.phase = "finished";
  state.pendingRows = [];
  state.rowResolution = null;
  state.winnerIds = winnerIds;
  state.winnerId = winnerIds.length === 1 ? winnerIds[0] : null;
  state.message =
    winnerIds.length === 1
      ? `${getPlayerForColor(state, winnerColors[0]).name}님이 마커 51개 소진 시점에 더 많은 링을 제거해 승리했습니다.`
      : "마커 51개가 모두 소진되었습니다. 제거한 링 수가 같아 무승부입니다.";
  return winnerIds;
}

function applyNextActiveAfterRows(
  state: YinshState,
  turnNumber: number,
  roundNumber: number,
  fallbackColor: YinshColor
) {
  const resolution = state.rowResolution ?? getAdvance(fallbackColor);
  if (getMarkersRemaining(state) <= 0) {
    finishByMarkerExhaustion(state);
    return {
      activePlayerId: null,
      turnNumber: turnNumber + 1,
      roundNumber: roundNumber + resolution.roundIncrement,
      phase: state.phase,
      message: state.message,
      winnerId: state.winnerId
    };
  }

  const nextPlayer = getPlayerForColor(state, resolution.nextColor);
  state.phase = "move";
  state.pendingRows = [];
  state.rowResolution = null;
  state.message = `${COLOR_LABELS[resolution.nextColor]} 차례입니다. 링을 선택해 이동하세요.`;
  return {
    activePlayerId: nextPlayer.id,
    turnNumber: turnNumber + 1,
    roundNumber: roundNumber + resolution.roundIncrement,
    phase: state.phase,
    message: state.message
  };
}

function positionForPoint(point: AxialPoint) {
  return {
    x: (point.q + point.r / 2) * 42,
    y: point.r * 36
  };
}

const POINT_POSITIONS = new Map(POINTS.map((point) => [point.key, positionForPoint(point)]));

const GRID_EDGES = POINTS.flatMap((point) =>
  LINE_DIRECTIONS.map((direction) => {
    const toKey = pointKey(point.q + direction.q, point.r + direction.r);
    return isValidPoint(toKey) ? { from: point.key, to: toKey } : null;
  }).filter((edge): edge is { from: string; to: string } => Boolean(edge))
);

export const module: GameModule = {
  id: "yinsh",
  createInitialState: ({ players }) => {
    const seatedPlayers = players
      .filter((player) => player.connected)
      .sort((a, b) => a.seat - b.seat)
      .slice(0, 2);
    const white = seatedPlayers[0] ?? { id: "white", name: "백", seat: 1 };
    const black = seatedPlayers[1] ?? { id: "black", name: "흑", seat: 2 };

    return {
      phase: "ring-placement",
      players: {
        white: { id: white.id, name: white.name, color: "white" },
        black: { id: black.id, name: black.name, color: "black" }
      },
      rings: {},
      markers: {},
      markersRemaining: MARKER_POOL_SIZE,
      ringsPlaced: { white: 0, black: 0 },
      ringsRemoved: { white: 0, black: 0 },
      pendingRows: [],
      rowResolution: null,
      message: "백부터 링을 5개씩 번갈아 배치합니다.",
      winnerId: null,
      winnerIds: []
    } satisfies YinshState;
  },
  getPublicState: (state) => {
    const yinshState = assertYinshState(state);
    return {
      ...yinshState,
      players: {
        white: { ...yinshState.players.white },
        black: { ...yinshState.players.black }
      },
      rings: { ...yinshState.rings },
      markers: { ...yinshState.markers },
      markersRemaining: getMarkersRemaining(yinshState),
      ringsPlaced: { ...yinshState.ringsPlaced },
      ringsRemoved: { ...yinshState.ringsRemoved },
      pendingRows: yinshState.pendingRows.map((row) => ({ color: row.color, cells: [...row.cells] })),
      rowResolution: yinshState.rowResolution ? { ...yinshState.rowResolution } : null,
      winnerIds: [...(yinshState.winnerIds ?? (yinshState.winnerId ? [yinshState.winnerId] : []))],
      points: POINTS
    } satisfies YinshPublicState;
  },
  applyAction: (state, action, context) => {
    const currentState = assertYinshState(state);
    const nextState = cloneState(currentState);
    const color = requireActiveColor(nextState, context.currentPlayerId, context.activePlayerId);

    if (action.type === "place-ring") {
      if (nextState.phase !== "ring-placement") {
        throw new Error("링 배치 단계가 아닙니다.");
      }
      const key = readKeyPayload(action.payload);
      if (!key || !isValidPoint(key)) {
        throw new Error("링을 놓을 수 없는 교차점입니다.");
      }
      if (!isPointEmpty(nextState, key)) {
        throw new Error("빈 교차점에만 링을 놓을 수 있습니다.");
      }
      if (nextState.ringsPlaced[color] >= RINGS_PER_PLAYER) {
        throw new Error("이미 링 5개를 모두 놓았습니다.");
      }

      nextState.rings[key] = color;
      nextState.ringsPlaced[color] += 1;

      const placementComplete = COLORS.every((item) => nextState.ringsPlaced[item] === RINGS_PER_PLAYER);
      const nextColor = placementComplete ? "white" : otherColor(color);
      const nextPlayer = getPlayerForColor(nextState, nextColor);
      nextState.phase = placementComplete ? "move" : "ring-placement";
      nextState.message = placementComplete
        ? "모든 링이 배치되었습니다. 백부터 링을 이동합니다."
        : `${COLOR_LABELS[nextColor]} 링 배치 차례입니다.`;

      return {
        state: nextState,
        log: `${getPlayerForColor(nextState, color).name} 링 배치`,
        activePlayerId: nextPlayer.id,
        turnNumber: context.turnNumber + 1,
        roundNumber: context.roundNumber + (color === "black" ? 1 : 0),
        phase: nextState.phase,
        message: nextState.message
      };
    }

    if (action.type === "move-ring") {
      if (nextState.phase !== "move") {
        throw new Error("현재는 링을 이동할 수 없습니다.");
      }
      if (getMarkersRemaining(nextState) <= 0) {
        finishByMarkerExhaustion(nextState);
        return {
          state: nextState,
          log: "마커 51개 소진으로 인쉬 종료",
          activePlayerId: null,
          phase: nextState.phase,
          message: nextState.message,
          winnerId: nextState.winnerId
        };
      }
      const payload = readMovePayload(action.payload);
      if (!payload) {
        throw new Error("링 이동 정보가 올바르지 않습니다.");
      }
      if (nextState.rings[payload.from] !== color) {
        throw new Error("자기 링만 이동할 수 있습니다.");
      }
      if (!isPointEmpty(nextState, payload.to)) {
        throw new Error("빈 교차점으로만 이동할 수 있습니다.");
      }

      const move = getMoveMarkersToFlip(nextState, payload.from, payload.to);
      if (!move.ok) {
        throw new Error(move.error);
      }

      delete nextState.rings[payload.from];
      nextState.markers[payload.from] = color;
      nextState.markersRemaining = getMarkersRemaining(nextState) - 1;
      for (const markerKey of move.markersToFlip) {
        nextState.markers[markerKey] = flipColor(nextState.markers[markerKey]);
      }
      nextState.rings[payload.to] = color;

      const advance = getAdvance(color);
      const rows = findRowsForRemoval(nextState.markers, color);
      if (rows.length > 0) {
        const rowOwner = rows[0].color;
        const rowPlayer = getPlayerForColor(nextState, rowOwner);
        nextState.phase = "remove-row";
        nextState.pendingRows = rows;
        nextState.rowResolution = advance;
        nextState.message = `${COLOR_LABELS[rowOwner]} 5목이 만들어졌습니다. 줄과 자기 링 하나를 제거하세요.`;
        return {
          state: nextState,
          log: `${getPlayerForColor(nextState, color).name} 링 이동, ${move.markersToFlip.length}개 뒤집기`,
          activePlayerId: rowPlayer.id,
          phase: nextState.phase,
          message: nextState.message
        };
      }

      if (nextState.markersRemaining <= 0) {
        const winnerIds = finishByMarkerExhaustion(nextState);
        return {
          state: nextState,
          log: `${getPlayerForColor(nextState, color).name} 링 이동, 마커 51개 소진으로 종료`,
          activePlayerId: null,
          turnNumber: context.turnNumber + 1,
          roundNumber: context.roundNumber + advance.roundIncrement,
          phase: nextState.phase,
          message: nextState.message,
          winnerId: winnerIds.length === 1 ? winnerIds[0] : null
        };
      }

      const nextPlayer = getPlayerForColor(nextState, advance.nextColor);
      nextState.message = `${getPlayerForColor(nextState, color).name}님이 링을 이동했습니다. ${COLOR_LABELS[advance.nextColor]} 차례입니다.`;
      return {
        state: nextState,
        log: `${getPlayerForColor(nextState, color).name} 링 이동, ${move.markersToFlip.length}개 뒤집기`,
        activePlayerId: nextPlayer.id,
        turnNumber: context.turnNumber + 1,
        roundNumber: context.roundNumber + advance.roundIncrement,
        phase: nextState.phase,
        message: nextState.message
      };
    }

    if (action.type === "remove-row") {
      if (nextState.phase !== "remove-row") {
        throw new Error("제거할 줄이 없습니다.");
      }
      const payload = readRemovePayload(action.payload);
      if (!payload) {
        throw new Error("줄 제거 정보가 올바르지 않습니다.");
      }
      const row = nextState.pendingRows[payload.rowIndex];
      if (!row || row.color !== color) {
        throw new Error("현재 제거할 수 있는 자기 줄을 선택해야 합니다.");
      }
      if (nextState.rings[payload.ringKey] !== color) {
        throw new Error("자기 링 하나를 함께 제거해야 합니다.");
      }
      if (row.cells.some((key) => nextState.markers[key] !== color)) {
        throw new Error("선택한 줄은 더 이상 유효하지 않습니다.");
      }

      for (const key of row.cells) {
        delete nextState.markers[key];
      }
      delete nextState.rings[payload.ringKey];
      nextState.ringsRemoved[color] += 1;

      if (nextState.ringsRemoved[color] >= RINGS_TO_WIN) {
        const winner = getPlayerForColor(nextState, color);
        nextState.phase = "finished";
        nextState.pendingRows = [];
        nextState.rowResolution = null;
        nextState.winnerId = winner.id;
        nextState.winnerIds = [winner.id];
        nextState.message = `${winner.name}님이 링 3개를 제거해 승리했습니다.`;
        return {
          state: nextState,
          log: `${winner.name} 줄 제거 및 링 제거, 승리`,
          activePlayerId: null,
          phase: nextState.phase,
          message: nextState.message,
          winnerId: winner.id
        };
      }

      const rows = findRowsForRemoval(nextState.markers, color);
      if (rows.length > 0) {
        const rowOwner = rows[0].color;
        const rowPlayer = getPlayerForColor(nextState, rowOwner);
        nextState.pendingRows = rows;
        nextState.message = `${COLOR_LABELS[rowOwner]} 줄이 남아 있습니다. 줄과 링 하나를 제거하세요.`;
        return {
          state: nextState,
          log: `${getPlayerForColor(nextState, color).name} 줄 제거 및 링 제거`,
          activePlayerId: rowPlayer.id,
          phase: nextState.phase,
          message: nextState.message
        };
      }

      const turn = applyNextActiveAfterRows(nextState, context.turnNumber, context.roundNumber, color);
      return {
        state: nextState,
        log: `${getPlayerForColor(nextState, color).name} 줄 제거 및 링 제거`,
        ...turn
      };
    }

    throw new Error("지원하지 않는 인쉬 행동입니다.");
  }
};

function isYinshPublicState(state: unknown): state is YinshPublicState {
  return Boolean(state && typeof state === "object" && Array.isArray((state as YinshPublicState).points));
}

export function Component({
  publicState,
  currentPlayer,
  activePlayer,
  disabled,
  onAction
}: GameComponentProps<YinshPublicState>) {
  const [selectedRingKey, setSelectedRingKey] = useState<string | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const state = isYinshPublicState(publicState) ? publicState : null;
  const currentColor = state ? getColorForPlayer(state, currentPlayer?.id) : null;
  const activeColor = state ? getColorForPlayer(state, activePlayer?.id) : null;
  const legalDestinations = useMemo(() => {
    if (!state || state.phase !== "move" || !selectedRingKey || state.rings[selectedRingKey] !== currentColor) {
      return new Set<string>();
    }
    return new Set(getLegalDestinations(state, selectedRingKey));
  }, [currentColor, selectedRingKey, state]);
  const activeRowIndices = useMemo(() => {
    if (!state || !currentColor) {
      return [];
    }
    return state.pendingRows
      .map((row, index) => ({ row, index }))
      .filter((item) => item.row.color === currentColor)
      .map((item) => item.index);
  }, [currentColor, state]);
  const effectiveRowIndex = activeRowIndices.includes(selectedRowIndex) ? selectedRowIndex : activeRowIndices[0] ?? -1;
  const rowCells = useMemo(() => {
    if (!state || effectiveRowIndex < 0) {
      return new Set<string>();
    }
    return new Set(state.pendingRows[effectiveRowIndex]?.cells ?? []);
  }, [effectiveRowIndex, state]);
  const canInteract =
    Boolean(state) &&
    !disabled &&
    state?.phase !== "finished" &&
    Boolean(currentColor) &&
    currentColor === activeColor;
  const { isSubmitting, submitAction } = useInteractionGate(
    onAction,
    [state?.phase, activePlayer?.id, state?.message, state?.ringsRemoved.white, state?.ringsRemoved.black],
    { cooldownMs: 650 }
  );
  const phaseHint = !state
    ? ""
    : state.phase === "ring-placement"
      ? "빈 교차점에 자기 링을 놓습니다. 양쪽 모두 5개를 놓으면 이동 단계로 넘어갑니다."
      : state.phase === "move"
        ? selectedRingKey
          ? `선택한 링에서 이동 가능한 점 ${legalDestinations.size}곳이 초록색으로 표시됩니다.`
          : "자기 링 하나를 먼저 선택하세요. 이동 경로의 마커는 자동으로 뒤집힙니다."
        : state.phase === "remove-row"
          ? "노란색으로 표시된 5목 줄을 고르고, 함께 제거할 자기 링 하나를 선택하세요."
          : "게임이 끝났습니다.";
  const selectedRingLabel = selectedRingKey ?? "없음";

  if (!state) {
    return (
      <div className="yinsh-module">
        <div className="yinsh-empty">인쉬 상태를 불러오는 중입니다.</div>
      </div>
    );
  }

  function handlePointClick(key: string) {
    if (!canInteract || isSubmitting || !currentColor || !state) {
      return;
    }

    if (state.phase === "ring-placement") {
      submitAction({ type: "place-ring", payload: { key } });
      return;
    }

    if (state.phase === "move") {
      if (state.rings[key] === currentColor) {
        setSelectedRingKey(key);
        return;
      }
      if (selectedRingKey && legalDestinations.has(key)) {
        submitAction({ type: "move-ring", payload: { from: selectedRingKey, to: key } });
      }
      return;
    }

    if (state.phase === "remove-row" && state.rings[key] === currentColor) {
      setSelectedRingKey(key);
    }
  }

  const selectedRingIsRemovable = Boolean(selectedRingKey && currentColor && state.rings[selectedRingKey] === currentColor);
  const markerCount = Object.keys(state.markers).length;
  const markersRemaining = getMarkersRemaining(state);
  const viewBox = "-260 -220 520 440";

  return (
    <div className={`yinsh-module ${isSubmitting ? "is-submitting" : ""}`}>
      <div className="yinsh-status">
        <div>
          <strong>{state.phase === "finished" ? "게임 종료" : `${activePlayer?.name ?? "대기"} 차례`}</strong>
          <div>{state.message}</div>
        </div>
        <span>
          남은 마커 {markersRemaining}/{MARKER_POOL_SIZE} · 보드 {markerCount}개 · 제거 링 백 {state.ringsRemoved.white}/3, 흑{" "}
          {state.ringsRemoved.black}/3
        </span>
      </div>

      <div className="yinsh-layout">
        <div className="yinsh-board-wrap">
          <svg className="yinsh-board" viewBox={viewBox} role="img" aria-label="인쉬 85점 보드">
            <defs>
              <radialGradient id="yinsh-white-marker" cx="34%" cy="28%" r="70%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="68%" stopColor="#f8fafc" />
                <stop offset="100%" stopColor="#d6dde4" />
              </radialGradient>
              <radialGradient id="yinsh-black-marker" cx="34%" cy="28%" r="70%">
                <stop offset="0%" stopColor="#526071" />
                <stop offset="48%" stopColor="#172033" />
                <stop offset="100%" stopColor="#05070a" />
              </radialGradient>
            </defs>
            {GRID_EDGES.map((edge) => {
              const from = POINT_POSITIONS.get(edge.from);
              const to = POINT_POSITIONS.get(edge.to);
              if (!from || !to) {
                return null;
              }
              return <line key={`${edge.from}-${edge.to}`} className="yinsh-edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
            })}

            {state.points.map((point) => {
              const position = POINT_POSITIONS.get(point.key) ?? { x: 0, y: 0 };
              const ringColor = state.rings[point.key];
              const markerColor = state.markers[point.key];
              const isPlacementLegal = state.phase === "ring-placement" && canInteract && isPointEmpty(state, point.key);
              const isLegal = legalDestinations.has(point.key) || isPlacementLegal;
              const isRow = rowCells.has(point.key);
              const isSelected = selectedRingKey === point.key;
              return (
                <g
                  key={point.key}
                  role="button"
                  tabIndex={canInteract && !isSubmitting ? 0 : -1}
                  onClick={() => handlePointClick(point.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handlePointClick(point.key);
                    }
                  }}
                  aria-label={`${point.q}, ${point.r}`}
                >
                  <circle
                    className={["yinsh-point", isLegal ? "legal" : "", isRow ? "row" : ""].filter(Boolean).join(" ")}
                    cx={position.x}
                    cy={position.y}
                    r={4.2}
                  />
                  {markerColor ? (
                    <circle className={`yinsh-marker ${markerColor}`} cx={position.x} cy={position.y} r={9.2} />
                  ) : null}
                  {ringColor ? (
                    <>
                      <circle className="yinsh-ring-outline" cx={position.x} cy={position.y} r={16} />
                      <circle
                        className={["yinsh-ring", ringColor, isSelected ? "selected" : ""].filter(Boolean).join(" ")}
                        cx={position.x}
                        cy={position.y}
                        r={16}
                      />
                    </>
                  ) : null}
                  <circle className={`yinsh-hit ${canInteract ? "" : "disabled"}`} cx={position.x} cy={position.y} r={18} />
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="yinsh-side" aria-label="인쉬 조작">
          <section className="yinsh-panel">
            <strong>진행</strong>
            <p className="yinsh-phase-guide">{phaseHint}</p>
            <div className="yinsh-mini-metrics" aria-label="인쉬 선택 상태">
              <span>선택 링 <strong>{selectedRingLabel}</strong></span>
              <span>이동 후보 <strong>{legalDestinations.size}</strong></span>
              <span>제거 줄 <strong>{activeRowIndices.length}</strong></span>
            </div>
            {state.phase === "ring-placement" ? (
              <span>
                <CircleDot size={15} /> 빈 점을 눌러 링을 배치합니다.
              </span>
            ) : null}
            {state.phase === "move" ? (
              <span>
                <MoveRight size={15} /> 자기 링을 선택한 뒤 표시된 빈 점으로 이동합니다.
              </span>
            ) : null}
            {state.phase === "remove-row" ? (
              <>
                <span>
                  <Scissors size={15} /> 제거할 줄과 자기 링 하나를 고릅니다.
                </span>
                <div className="yinsh-row-list">
                  {state.pendingRows.map((row, index) => (
                    <button
                      key={`${row.color}-${row.cells.join("-")}-${index}`}
                      className={effectiveRowIndex === index ? "selected" : ""}
                      type="button"
                      disabled={row.color !== currentColor || isSubmitting}
                      onClick={() => setSelectedRowIndex(index)}
                    >
                      {COLOR_LABELS[row.color]} 줄 {index + 1}
                    </button>
                  ))}
                </div>
                <button
                  className="yinsh-action-button"
                  type="button"
                  disabled={!canInteract || isSubmitting || effectiveRowIndex < 0 || !selectedRingIsRemovable}
                  onClick={() =>
                    submitAction({
                      type: "remove-row",
                      payload: { rowIndex: effectiveRowIndex, ringKey: selectedRingKey }
                    })
                  }
                >
                  <Scissors size={16} />
                  줄과 링 제거
                </button>
              </>
            ) : null}
          </section>

          <section className="yinsh-panel" aria-label="플레이어 상태">
            <strong>플레이어</strong>
            {COLORS.map((color) => {
              const player = state.players[color];
              return (
                <div
                  key={color}
                  className={`yinsh-player-row ${activeColor === color ? "active" : ""}`}
                  style={{ "--disc-color": color === "white" ? "#f8fafc" : "#111827" } as CSSProperties}
                >
                  <span className="disc" aria-hidden="true" />
                  <strong>{player.name}</strong>
                  <span>
                    링 {state.ringsPlaced[color] - state.ringsRemoved[color]}/{RINGS_PER_PLAYER}
                  </span>
                </div>
              );
            })}
          </section>
        </aside>
      </div>
    </div>
  );
}

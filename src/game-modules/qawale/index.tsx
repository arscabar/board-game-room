import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GameAction, GameActionResult, GameComponentProps, GameContext, GameModule } from "../types";

const BOARD_SIZE = 4;
const STARTING_RESERVE = 8;
const NEUTRAL = "neutral";

type Stone = string;

interface Coord {
  row: number;
  col: number;
}

interface QawalePlayer {
  id: string;
  name: string;
  seat: number;
  color: string;
}

interface QawaleState {
  players: QawalePlayer[];
  board: Stone[][][];
  reserves: Record<string, number>;
  phase: "playing" | "complete";
  winnerId: string | null;
  message: string;
  activePlayerId?: string | null;
}

type QawalePublicState = QawaleState;

interface DistributePayload {
  source: Coord;
  path: Coord[];
}

const playerColors = ["#8f2e36", "#d39b32"];

function key(row: number, col: number) {
  return `${row},${col}`;
}

function isCoord(value: unknown): value is Coord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.row) && Number.isInteger(item.col);
}

function isDistributePayload(value: unknown): value is DistributePayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isCoord(item.source) && Array.isArray(item.path) && item.path.every(isCoord);
}

function inBoard(row: number, col: number) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function adjacent(a: Coord, b: Coord) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

function neighbors(coord: Coord) {
  return [
    { row: coord.row - 1, col: coord.col },
    { row: coord.row + 1, col: coord.col },
    { row: coord.row, col: coord.col - 1 },
    { row: coord.row, col: coord.col + 1 }
  ].filter((next) => inBoard(next.row, next.col));
}

function sameCoord(a: Coord, b: Coord) {
  return a.row === b.row && a.col === b.col;
}

function cloneBoard(board: Stone[][][]) {
  return board.map((row) => row.map((stack) => [...stack]));
}

function cloneState(state: QawaleState): QawaleState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    board: cloneBoard(state.board),
    reserves: { ...state.reserves }
  };
}

function topStone(state: QawaleState, row: number, col: number) {
  const stack = state.board[row][col];
  return stack[stack.length - 1] ?? null;
}

function playerName(state: QawaleState, playerId: string) {
  return state.players.find((player) => player.id === playerId)?.name ?? "플레이어";
}

function validatePath(source: Coord, path: Coord[], carryLength: number) {
  if (path.length !== carryLength) {
    throw new Error(`경로는 ${carryLength}칸이어야 합니다.`);
  }

  for (let index = 0; index < path.length; index += 1) {
    const current = index === 0 ? source : path[index - 1];
    const target = path[index];
    if (!inBoard(target.row, target.col) || !adjacent(current, target)) {
      throw new Error("배치 경로는 상하좌우 인접 칸으로 한 칸씩 이어져야 합니다.");
    }

    if (index > 0) {
      const previous = index === 1 ? source : path[index - 2];
      if (sameCoord(target, previous)) {
        throw new Error("방금 지나온 칸으로 바로 되돌아갈 수 없습니다.");
      }
    }
  }
}

function lineWinner(state: QawaleState) {
  const lines: Coord[][] = [];

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    lines.push(
      Array.from({ length: BOARD_SIZE }, (_, col) => ({ row: index, col })),
      Array.from({ length: BOARD_SIZE }, (_, row) => ({ row, col: index }))
    );
  }

  lines.push(
    Array.from({ length: BOARD_SIZE }, (_, index) => ({ row: index, col: index })),
    Array.from({ length: BOARD_SIZE }, (_, index) => ({ row: index, col: BOARD_SIZE - 1 - index }))
  );

  for (const line of lines) {
    const owner = topStone(state, line[0].row, line[0].col);
    if (owner && owner !== NEUTRAL && line.every((coord) => topStone(state, coord.row, coord.col) === owner)) {
      return owner;
    }
  }

  return null;
}

function connectedModulePlayers(state: QawaleState, context: GameContext) {
  return state.players.filter((player) =>
    context.players.some((candidate) => candidate.id === player.id && candidate.connected)
  );
}

function advanceTurn(state: QawaleState, context: GameContext) {
  const order = connectedModulePlayers(state, context);
  if (order.length === 0) {
    return { activePlayerId: null, turnNumber: context.turnNumber + 1, roundNumber: context.roundNumber };
  }

  const currentIndex = order.findIndex((player) => player.id === context.activePlayerId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % order.length;
  return {
    activePlayerId: order[nextIndex].id,
    turnNumber: context.turnNumber + 1,
    roundNumber: context.roundNumber + (currentIndex !== -1 && nextIndex === 0 ? 1 : 0)
  };
}

function requireActivePlayer(state: QawaleState, context: GameContext) {
  if (state.phase === "complete" || state.winnerId) {
    throw new Error("이미 종료된 게임입니다.");
  }
  if (context.currentPlayerId !== context.activePlayerId) {
    throw new Error("현재 차례의 플레이어만 행동할 수 있습니다.");
  }
  const player = state.players.find((candidate) => candidate.id === context.currentPlayerId);
  if (!player) {
    throw new Error("카왈레 플레이어를 찾을 수 없습니다.");
  }
  return player;
}

function createInitialBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => [] as Stone[])
  );
  for (const corner of [
    { row: 0, col: 0 },
    { row: 0, col: BOARD_SIZE - 1 },
    { row: BOARD_SIZE - 1, col: 0 },
    { row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 }
  ]) {
    board[corner.row][corner.col] = [NEUTRAL, NEUTRAL];
  }
  return board;
}

function createInitialState(context: Pick<GameContext, "players">): QawaleState {
  const seatedPlayers = context.players
    .filter((player) => player.connected)
    .sort((a, b) => a.seat - b.seat)
    .slice(0, 2);
  const reserves: Record<string, number> = {};

  for (const player of seatedPlayers) {
    reserves[player.id] = STARTING_RESERVE;
  }

  const players = seatedPlayers.map((player, index) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      color: playerColors[index]
    }));
  const firstPlayer = players.length > 0 ? players[Math.floor(Math.random() * players.length)] : null;

  return {
    players,
    board: createInitialBoard(),
    reserves,
    phase: "playing",
    winnerId: null,
    message: firstPlayer
      ? `${firstPlayer.name}님이 무작위 선공입니다. 색 돌이 있는 홈을 고르고 순서대로 놓으세요.`
      : "색 돌이 있는 홈을 고르고 순서대로 놓으세요.",
    activePlayerId: firstPlayer?.id ?? null
  };
}

function distribute(state: QawaleState, action: GameAction, context: GameContext): GameActionResult {
  if (!isDistributePayload(action.payload)) {
    throw new Error("선택한 홈과 배치 경로가 필요합니다.");
  }

  const player = requireActivePlayer(state, context);
  const { source, path } = action.payload;
  if (!inBoard(source.row, source.col)) {
    throw new Error("선택한 홈이 보드 밖입니다.");
  }
  const sourceStack = state.board[source.row][source.col];
  if (sourceStack.length === 0) {
    throw new Error("색 돌이 있는 홈만 고를 수 있습니다.");
  }
  if ((state.reserves[player.id] ?? 0) <= 0) {
    throw new Error("남은 자기 돌이 없습니다.");
  }

  const carry = [...sourceStack, player.id];
  validatePath(source, path, carry.length);

  const next = cloneState(state);
  next.board[source.row][source.col] = [];
  next.reserves[player.id] -= 1;
  for (let index = 0; index < carry.length; index += 1) {
    const destination = path[index];
    next.board[destination.row][destination.col].push(carry[index]);
  }

  const winnerId = lineWinner(next);
  if (winnerId) {
    next.phase = "complete";
    next.winnerId = winnerId;
    next.message = `${playerName(next, winnerId)}님이 보이는 4목을 만들었습니다.`;
    return {
      state: next,
      log: `${playerName(next, winnerId)} 보이는 4목 승리`,
      activePlayerId: null,
      phase: "complete",
      winnerId,
      message: next.message
    };
  }

  const outOfStones = next.players.every((candidate) => (next.reserves[candidate.id] ?? 0) <= 0);
  if (outOfStones) {
    next.phase = "complete";
    next.message = "모든 돌을 사용했지만 4목이 없어 무승부입니다.";
    return {
      state: next,
      log: "카왈레 무승부 종료",
      activePlayerId: null,
      phase: "complete",
      winnerId: null,
      message: next.message
    };
  }

  next.message = "차례가 넘어갔습니다.";
  return {
    state: next,
    log: "카왈레 진행",
    message: next.message,
    ...advanceTurn(next, context)
  };
}

export const module: GameModule = {
  id: "qawale",
  createInitialState,
  getPublicState: (state) => state as QawalePublicState,
  applyAction: (state, action, context) => {
    if (action.type === "distribute") {
      return distribute(state as QawaleState, action, context);
    }
    throw new Error("지원하지 않는 카왈레 행동입니다.");
  }
};

function stoneColor(state: QawalePublicState, stone: Stone | null) {
  if (!stone) return "transparent";
  if (stone === NEUTRAL) return "#eef0e8";
  return state.players.find((player) => player.id === stone)?.color ?? "#52625d";
}

function canAppendPath(source: Coord | null, path: Coord[], target: Coord) {
  if (!source) return false;
  const current = path.length === 0 ? source : path[path.length - 1];
  if (!inBoard(target.row, target.col) || !adjacent(current, target)) return false;
  if (path.length > 0) {
    const previous = path.length === 1 ? source : path[path.length - 2];
    if (sameCoord(target, previous)) {
      return false;
    }
  }
  return true;
}

interface QawaleThreeBoardProps {
  publicState: QawalePublicState;
  source: Coord | null;
  path: Coord[];
  pathComplete: boolean | null;
  pathStepsByCell: Map<string, number[]>;
  nextTargets: Set<string>;
  canAct: boolean;
  carryStones: Stone[];
  onCellSelect: (row: number, col: number) => void;
}

type CellHitMesh = THREE.Mesh & { userData: { row: number; col: number } };

const cellSpacing = 1.75;
const boardOffset = ((BOARD_SIZE - 1) * cellSpacing) / 2;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stoneLayerRadius(index: number) {
  return Math.max(0.28, 0.58 - index * 0.06);
}

function stoneLayerY(index: number) {
  return 0.17 + index * 0.17;
}

function cellPosition(row: number, col: number) {
  return new THREE.Vector3(col * cellSpacing - boardOffset, 0, row * cellSpacing - boardOffset);
}

function disposeSceneObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

function QawaleThreeBoard({
  publicState,
  source,
  path,
  pathComplete,
  pathStepsByCell,
  nextTargets,
  canAct,
  carryStones,
  onCellSelect
}: QawaleThreeBoardProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const boardGroupRef = useRef<THREE.Group | null>(null);
  const clickableRef = useRef<CellHitMesh[]>([]);
  const frameRef = useRef<number | null>(null);
  const latestSelectRef = useRef(onCellSelect);
  const controlsRef = useRef({ yaw: -0.58, pitch: 0.72, distance: 15.2 });
  const pointerRef = useRef({
    active: false,
    id: -1,
    x: 0,
    y: 0,
    moved: false,
    lastTapAt: 0
  });
  const pinchRef = useRef(new Map<number, { x: number; y: number }>());

  latestSelectRef.current = onCellSelect;

  const updateCamera = () => {
    const camera = cameraRef.current;
    if (!camera) return;
    const { yaw, pitch, distance } = controlsRef.current;
    const horizontal = Math.sin(pitch) * distance;
    camera.position.set(Math.sin(yaw) * horizontal, Math.cos(pitch) * distance, Math.cos(yaw) * horizontal);
    camera.lookAt(0, 0.08, 0);
    camera.updateProjectionMatrix();
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    cameraRef.current = camera;
    updateCamera();

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const ambientLight = new THREE.HemisphereLight(0xfff3d7, 0x16110d, 2.4);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffdf9a, 3.6);
    keyLight.position.set(-3.8, 6.2, 4.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x8bc7ad, 1.2, 9);
    fillLight.position.set(3.2, 2.6, -4.2);
    scene.add(fillLight);

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const pickCell = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickableRef.current, false)[0]?.object as CellHitMesh | undefined;
      if (hit) {
        latestSelectRef.current(hit.userData.row, hit.userData.col);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchRef.current.size > 1) {
        pointerRef.current.active = false;
        return;
      }
      pointerRef.current = {
        active: true,
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        lastTapAt: Date.now()
      };
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pinchRef.current.has(event.pointerId)) {
        pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (pinchRef.current.size === 2) {
        const points = [...pinchRef.current.values()];
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        const previous = (pinchRef.current as unknown as { lastDistance?: number }).lastDistance ?? distance;
        controlsRef.current.distance = clamp(controlsRef.current.distance - (distance - previous) * 0.018, 9.8, 19.5);
        (pinchRef.current as unknown as { lastDistance?: number }).lastDistance = distance;
        updateCamera();
        return;
      }

      const pointerState = pointerRef.current;
      if (!pointerState.active || pointerState.id !== event.pointerId) return;
      const dx = event.clientX - pointerState.x;
      const dy = event.clientY - pointerState.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        pointerState.moved = true;
      }
      pointerState.x = event.clientX;
      pointerState.y = event.clientY;
      controlsRef.current.yaw -= dx * 0.007;
      controlsRef.current.pitch = clamp(controlsRef.current.pitch - dy * 0.005, 0.34, 1.22);
      updateCamera();
    };

    const onPointerUp = (event: PointerEvent) => {
      pinchRef.current.delete(event.pointerId);
      (pinchRef.current as unknown as { lastDistance?: number }).lastDistance = undefined;
      const pointerState = pointerRef.current;
      if (pointerState.id === event.pointerId && pointerState.active && !pointerState.moved) {
        pickCell(event.clientX, event.clientY);
      }
      pointerRef.current.active = false;
      try {
        renderer.domElement.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture can already be released by the browser.
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      controlsRef.current.distance = clamp(controlsRef.current.distance + event.deltaY * 0.006, 9.8, 19.5);
      updateCamera();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      if (boardGroupRef.current) {
        scene.remove(boardGroupRef.current);
        disposeSceneObject(boardGroupRef.current);
      }
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (boardGroupRef.current) {
      scene.remove(boardGroupRef.current);
      disposeSceneObject(boardGroupRef.current);
    }

    const group = new THREE.Group();
    group.scale.setScalar(0.84);
    boardGroupRef.current = group;
    clickableRef.current = [];

    const boardMaterial = new THREE.MeshStandardMaterial({
      color: 0x171512,
      roughness: 0.84,
      metalness: 0.08
    });
    const base = new THREE.Mesh(new THREE.BoxGeometry(8.1, 0.34, 8.1), boardMaterial);
    base.position.y = -0.24;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const bevelMaterial = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.72, metalness: 0.18 });
    const bevel = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.3, 8.5), bevelMaterial);
    bevel.position.y = -0.42;
    bevel.castShadow = true;
    bevel.receiveShadow = true;
    group.add(bevel);

    const wellMaterial = new THREE.MeshStandardMaterial({
      color: 0x020202,
      roughness: 0.9,
      metalness: 0.05
    });
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x5f5142,
      roughness: 0.6,
      metalness: 0.18
    });
    const sourceMaterial = new THREE.MeshBasicMaterial({ color: 0xd7a545, transparent: true, opacity: 0.7 });
    const selectedMaterial = new THREE.MeshBasicMaterial({ color: 0xf2cf72, transparent: true, opacity: 0.9 });
    const pathMaterial = new THREE.MeshBasicMaterial({ color: 0x9fc9b8, transparent: true, opacity: 0.72 });
    const nextMaterial = new THREE.MeshBasicMaterial({ color: 0x66d19e, transparent: true, opacity: 0.78 });
    const separatorMaterial = new THREE.MeshBasicMaterial({ color: 0x100905, transparent: true, opacity: 0.54 });
    const hitMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.001,
      depthWrite: false
    });

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const position = cellPosition(row, col);
        const cellKey = key(row, col);
        const stack = publicState.board[row][col];
        const top = stack[stack.length - 1] ?? null;
        const selected = source?.row === row && source.col === col;
        const sourceCandidate = canAct && !source && stack.length > 0;
        const inPath = pathStepsByCell.has(cellKey);
        const next = nextTargets.has(cellKey);

        const well = new THREE.Mesh(new THREE.CylinderGeometry(0.63, 0.54, 0.14, 48), wellMaterial);
        well.position.set(position.x, -0.01, position.z);
        well.receiveShadow = true;
        group.add(well);

        const activeRimMaterial = selected ? selectedMaterial : next ? nextMaterial : sourceCandidate ? sourceMaterial : rimMaterial;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, selected ? 0.05 : next ? 0.04 : 0.028, 12, 64), activeRimMaterial);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(position.x, 0.075, position.z);
        group.add(rim);

        if (inPath) {
          const pathRing = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.026, 10, 64), pathMaterial);
          pathRing.rotation.x = Math.PI / 2;
          pathRing.position.set(position.x, 0.11, position.z);
          group.add(pathRing);
        }

        if (next) {
          const previewStone = carryStones[path.length] ?? null;
          const previewRadius = stoneLayerRadius(stack.length);
          const previewColor = new THREE.Color(stoneColor(publicState, previewStone));
          const previewMaterial = new THREE.MeshPhysicalMaterial({
            color: previewColor,
            roughness: 0.46,
            clearcoat: 0.4,
            clearcoatRoughness: 0.38,
            transparent: true,
            opacity: 0.5
          });
          const previewBase = new THREE.Mesh(
            new THREE.CylinderGeometry(previewRadius * 0.92, previewRadius, 0.14, 56),
            previewMaterial
          );
          previewBase.position.set(position.x, stoneLayerY(stack.length), position.z);
          previewBase.castShadow = true;
          group.add(previewBase);
          const previewRim = new THREE.Mesh(
            new THREE.TorusGeometry(previewRadius * 0.96, 0.018, 8, 56),
            new THREE.MeshBasicMaterial({ color: previewColor, transparent: true, opacity: 0.7 })
          );
          previewRim.rotation.x = Math.PI / 2;
          previewRim.position.set(position.x, stoneLayerY(stack.length) + 0.08, position.z);
          group.add(previewRim);
        }

        const stackLift = selected ? 0.13 : 0;
        stack.forEach((stone, stoneIndex) => {
          const radius = stoneLayerRadius(stoneIndex);
          const layerY = stoneLayerY(stoneIndex) + stackLift;
          const layerColor = new THREE.Color(stoneColor(publicState, stone));
          const layerMaterial = new THREE.MeshPhysicalMaterial({
            color: layerColor,
            roughness: stone === NEUTRAL ? 0.36 : 0.48,
            metalness: 0.02,
            clearcoat: 0.34,
            clearcoatRoughness: 0.44
          });
          const layerBase = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius, 0.145, 64), layerMaterial);
          layerBase.position.set(position.x, layerY, position.z);
          layerBase.rotation.y = stoneIndex * 0.18;
          layerBase.castShadow = true;
          layerBase.receiveShadow = true;
          group.add(layerBase);

          const layerDome = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.98, 48, 14), layerMaterial);
          layerDome.scale.y = 0.115;
          layerDome.position.set(position.x, layerY + 0.078, position.z);
          layerDome.castShadow = true;
          layerDome.receiveShadow = true;
          group.add(layerDome);

          const layerEdge = new THREE.Mesh(
            new THREE.TorusGeometry(radius * 0.98, 0.018, 8, 64),
            new THREE.MeshStandardMaterial({
              color: layerColor,
              roughness: 0.6,
              metalness: 0.08
            })
          );
          layerEdge.rotation.x = Math.PI / 2;
          layerEdge.position.set(position.x, layerY + 0.08, position.z);
          group.add(layerEdge);

          if (stoneIndex > 0) {
            const separator = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.035, 0.011, 8, 56), separatorMaterial);
            separator.rotation.x = Math.PI / 2;
            separator.position.set(position.x, layerY - 0.078, position.z);
            group.add(separator);
          }
        });

        if (stack.length > 0) {
          const topColor = new THREE.Color(stoneColor(publicState, top));
          const ownerRing = new THREE.Mesh(
            new THREE.TorusGeometry(stoneLayerRadius(stack.length - 1) * 0.84, 0.02, 10, 56),
            new THREE.MeshBasicMaterial({ color: topColor, transparent: true, opacity: 0.9 })
          );
          ownerRing.rotation.x = Math.PI / 2;
          ownerRing.position.set(position.x, stoneLayerY(stack.length - 1) + stackLift + 0.105, position.z);
          group.add(ownerRing);
        }

        const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 24), hitMaterial) as unknown as CellHitMesh;
        hit.position.set(position.x, 0.42, position.z);
        hit.userData = { row, col };
        group.add(hit);
        clickableRef.current.push(hit);
      }
    }

    scene.add(group);
  }, [publicState, source, path, pathComplete, pathStepsByCell, nextTargets, canAct, carryStones]);

  function resetCamera() {
    controlsRef.current = { yaw: -0.58, pitch: 0.72, distance: 15.2 };
    updateCamera();
  }

  function zoom(delta: number) {
    controlsRef.current.distance = clamp(controlsRef.current.distance + delta, 9.8, 19.5);
    updateCamera();
  }

  return (
    <div className="qaw-3d-stage">
      <div className="qaw-3d-canvas" ref={mountRef} role="application" aria-label="회전 가능한 3D 카왈레 보드" />
      <div className="qaw-camera-controls" aria-label="3D 보드 시점 조절">
        <button type="button" onClick={resetCamera}>
          시점 초기화
        </button>
        <button type="button" onClick={() => zoom(-0.8)} aria-label="확대">
          +
        </button>
        <button type="button" onClick={() => zoom(0.8)} aria-label="축소">
          -
        </button>
      </div>
    </div>
  );
}

export function Component(props: GameComponentProps) {
  const { currentPlayer, activePlayer, disabled, onAction } = props;
  const publicState = props.publicState as QawalePublicState;
  const [source, setSource] = useState<Coord | null>(null);
  const [path, setPath] = useState<Coord[]>([]);
  const activeModulePlayer = publicState.players.find((player) => player.id === activePlayer?.id) ?? null;
  const currentModulePlayer = publicState.players.find((player) => player.id === currentPlayer?.id) ?? null;
  const canAct =
    !disabled &&
    publicState.phase === "playing" &&
    !publicState.winnerId &&
    currentPlayer?.id === activePlayer?.id &&
    Boolean(currentModulePlayer);
  const carryLength = source ? publicState.board[source.row][source.col].length + 1 : 0;
  const carryStones = source && currentModulePlayer ? [...publicState.board[source.row][source.col], currentModulePlayer.id] : [];
  const pathComplete = source && path.length === carryLength;
  const pathStepsByCell = useMemo(() => {
    const steps = new Map<string, number[]>();
    path.forEach((coord, index) => {
      const cellKey = key(coord.row, coord.col);
      steps.set(cellKey, [...(steps.get(cellKey) ?? []), index + 1]);
    });
    return steps;
  }, [path]);
  const nextTargets = useMemo(() => {
    if (!source || pathComplete) return new Set<string>();
    return new Set(
      neighbors(path.length === 0 ? source : path[path.length - 1])
        .filter((candidate) => canAppendPath(source, path, candidate))
        .map((candidate) => key(candidate.row, candidate.col))
    );
  }, [source, path, pathComplete]);

  function selectCell(row: number, col: number) {
    if (!canAct) return;
    const coord = { row, col };

    if (!source) {
      if (publicState.board[row][col].length === 0) return;
      setSource(coord);
      setPath([]);
      return;
    }

    if (pathComplete) return;
    if (canAppendPath(source, path, coord)) {
      setPath([...path, coord]);
    }
  }

  function resetPath() {
    setSource(null);
    setPath([]);
  }

  function submitMove() {
    if (!canAct || !source || !pathComplete) return;
    onAction({ type: "distribute", payload: { source, path } });
    resetPath();
  }

  return (
    <div className="qaw-shell">
      <div className="qaw-status">
        <div>
          <strong>{publicState.phase === "complete" ? (publicState.winnerId ? "승자" : "무승부") : "차례"}</strong>
          <span>
            {publicState.winnerId
              ? playerName(publicState, publicState.winnerId)
              : publicState.phase === "complete"
                ? "승자 없음"
                : activeModulePlayer?.name ?? "대기"}
          </span>
        </div>
        <p>{publicState.message}</p>
      </div>

      <div className="qaw-layout">
        <div className="qaw-board-stack">
          <QawaleThreeBoard
            publicState={publicState}
            source={source}
            path={path}
            pathComplete={pathComplete}
            pathStepsByCell={pathStepsByCell}
            nextTargets={nextTargets}
            canAct={canAct}
            carryStones={carryStones}
            onCellSelect={selectCell}
          />

          {canAct ? (
            <div className="qaw-board-actions" aria-label="카왈레 행동">
              <button disabled={!source} onClick={resetPath} type="button">
                취소
              </button>
              <button disabled={!pathComplete} onClick={submitMove} type="button">
                놓기
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

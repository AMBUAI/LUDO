import { getBoardGraph } from './boardGraph.ts';
import { BoardVariant, PlayerColor, PlayerCount } from './types.ts';

export interface Point2D {
  x: number;
  y: number;
}

export interface CellRenderShape {
  nodeId: string;
  x: number;
  y: number;
  size: number;
  angleDeg: number;
  trackIndex?: number;
  isSafe: boolean;
  isStar?: boolean;
  isStart?: boolean;
  startColor?: PlayerColor;
  homeColor?: PlayerColor;
  entryArrowAngleDeg?: number;
}

export interface YardRenderShape {
  seat: number;
  color: PlayerColor;
  kind: 'square' | 'circle';
  cx: number;
  cy: number;
  width: number;
  height: number;
  slotPositions: Point2D[];
}

export interface FinishWedgeShape {
  seat?: number;
  color?: PlayerColor;
  points: Point2D[];
  finishCenter: Point2D;
}

export interface BoardGeometry {
  playerCount: PlayerCount;
  variant: BoardVariant;
  viewBoxSize: number;
  tokenRadius: number;
  cells: CellRenderShape[];
  yards: YardRenderShape[];
  unusedCorners?: { x: number; y: number; width: number; height: number }[];
  centerPolygon: Point2D[];
  finishWedges: FinishWedgeShape[];
  nodePositions: Record<string, Point2D>;
}

const CROSS_TRACK_COORDS: [number, number][] = [
  // Red arm (bottom-left) going UP on c=6
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  // Left arm going LEFT on r=8, UP on c=0, RIGHT on r=6
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  // Top arm going UP on c=6, RIGHT on r=0, DOWN on c=8
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  // Right arm going RIGHT on r=6, DOWN on c=14, LEFT on r=8
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  // Bottom arm going DOWN on c=8, LEFT on r=14, UP on c=6
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6],
];

const CROSS_ARM_HOME_COORDS: Record<number, [number, number][]> = {
  0: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], // Bottom (Red)
  1: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],     // Left (Green)
  2: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],     // Top (Yellow)
  3: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], // Right (Blue)
};

const CROSS_ARM_FINISH_CENTERS: Record<number, Point2D> = {
  0: { x: 7.5, y: 8.25 },
  1: { x: 6.75, y: 7.5 },
  2: { x: 7.5, y: 6.75 },
  3: { x: 8.25, y: 7.5 },
};

const CROSS_ARM_YARD_ORIGIN: Record<number, { row: number; col: number }> = {
  0: { row: 9, col: 0 }, // Bottom-Left
  1: { row: 0, col: 0 }, // Top-Left
  2: { row: 0, col: 9 }, // Top-Right
  3: { row: 9, col: 9 }, // Bottom-Right
};

const CROSS_ARM_ARROW_ANGLE: Record<number, number> = {
  0: -90,  // Up
  1: 0,    // Right
  2: 90,   // Down
  3: 180,  // Left
};

const geometryCache = new Map<PlayerCount, BoardGeometry>();

export function getBoardGeometry(playerCount: PlayerCount): BoardGeometry {
  const cached = geometryCache.get(playerCount);
  if (cached) return cached;
  const built = buildBoardGeometry(playerCount);
  geometryCache.set(playerCount, built);
  return built;
}

function buildBoardGeometry(playerCount: PlayerCount): BoardGeometry {
  const graph = getBoardGraph(playerCount);
  if (graph.variant === 'cross') {
    return buildCrossGeometry(playerCount);
  }
  return buildRadialGeometry(playerCount);
}

function buildCrossGeometry(playerCount: PlayerCount): BoardGeometry {
  const graph = getBoardGraph(playerCount);
  const viewBoxSize = 1000;
  const padding = 20;
  const boardSize = viewBoxSize - padding * 2;
  const cell = boardSize / 15; // 64px

  const gridCenter = (row: number, col: number): Point2D => ({
    x: padding + (col + 0.5) * cell,
    y: padding + (row + 0.5) * cell,
  });

  const gridCorner = (row: number, col: number): Point2D => ({
    x: padding + col * cell,
    y: padding + row * cell,
  });

  const nodePositions: Record<string, Point2D> = {};
  const cells: CellRenderShape[] = [];

  // Map start track index -> active seat color if any
  const activeStartByTrack: Record<number, { seat: number; color: PlayerColor; arm: number }> = {};
  for (const seat of graph.activeSeats) {
    const arm = graph.seatToArm[seat];
    activeStartByTrack[arm * 13] = {
      seat,
      color: graph.seatToColor[seat],
      arm,
    };
  }

  for (let t = 0; t < 52; t++) {
    const nodeId = `track:${t}`;
    const node = graph.nodes[nodeId];
    const [r, c] = CROSS_TRACK_COORDS[t];
    const pos = gridCenter(r, c);
    nodePositions[nodeId] = pos;

    const activeStart = activeStartByTrack[t];
    cells.push({
      nodeId,
      x: pos.x,
      y: pos.y,
      size: cell,
      angleDeg: 0,
      trackIndex: t,
      isSafe: node.isSafe,
      isStar: node.isStar,
      isStart: Boolean(activeStart),
      startColor: activeStart?.color,
      entryArrowAngleDeg: activeStart ? CROSS_ARM_ARROW_ANGLE[activeStart.arm] : undefined,
    });
  }

  // Home lanes (render all 4 arms' 5 cells so the cross structure is complete; color only active seats)
  const armToSeat: Record<number, number> = {};
  for (const seat of graph.activeSeats) {
    armToSeat[graph.seatToArm[seat]] = seat;
  }

  for (let arm = 0; arm < 4; arm++) {
    const seat = armToSeat[arm];
    const coords = CROSS_ARM_HOME_COORDS[arm];
    coords.forEach(([r, c], h) => {
      const pos = gridCenter(r, c);
      const nodeId = seat !== undefined ? `home:${seat}:${h}` : `neutral:home:${arm}:${h}`;
      if (seat !== undefined) {
        nodePositions[nodeId] = pos;
      }
      cells.push({
        nodeId,
        x: pos.x,
        y: pos.y,
        size: cell,
        angleDeg: 0,
        isSafe: true,
        homeColor: seat !== undefined ? graph.seatToColor[seat] : undefined,
      });
    });
  }

  // Yards (render ONLY active player zones; unused corners become clean neutral frame)
  const yards: YardRenderShape[] = [];
  const unusedCorners: { x: number; y: number; width: number; height: number }[] = [];

  for (let arm = 0; arm < 4; arm++) {
    const origin = CROSS_ARM_YARD_ORIGIN[arm];
    const topLeft = gridCorner(origin.row, origin.col);
    const width = 6 * cell;
    const height = 6 * cell;
    const seat = armToSeat[arm];

    if (seat === undefined) {
      unusedCorners.push({ x: topLeft.x, y: topLeft.y, width, height });
      continue;
    }

    const cx = topLeft.x + width / 2;
    const cy = topLeft.y + height / 2;
    const slotOffset = 1.15 * cell;
    const slotPositions: Point2D[] = [
      { x: cx - slotOffset, y: cy - slotOffset },
      { x: cx + slotOffset, y: cy - slotOffset },
      { x: cx - slotOffset, y: cy + slotOffset },
      { x: cx + slotOffset, y: cy + slotOffset },
    ];

    slotPositions.forEach((p, idx) => {
      nodePositions[`yard:${seat}:${idx}`] = p;
    });

    yards.push({
      seat,
      color: graph.seatToColor[seat],
      kind: 'square',
      cx,
      cy,
      width,
      height,
      slotPositions,
    });
  }

  // Center 3x3 finish triangles
  const cTL = gridCorner(6, 6);
  const cTR = gridCorner(6, 9);
  const cBR = gridCorner(9, 9);
  const cBL = gridCorner(9, 6);
  const cMid = { x: viewBoxSize / 2, y: viewBoxSize / 2 };

  const armTriangles: Record<number, Point2D[]> = {
    0: [cBL, cBR, cMid], // Bottom
    1: [cTL, cBL, cMid], // Left
    2: [cTL, cTR, cMid], // Top
    3: [cTR, cBR, cMid], // Right
  };

  const finishWedges: FinishWedgeShape[] = [];
  for (let arm = 0; arm < 4; arm++) {
    const seat = armToSeat[arm];
    const rawCenter = CROSS_ARM_FINISH_CENTERS[arm];
    const finishCenter = {
      x: padding + rawCenter.x * cell,
      y: padding + rawCenter.y * cell,
    };
    if (seat !== undefined) {
      nodePositions[`finish:${seat}`] = finishCenter;
    }
    finishWedges.push({
      seat,
      color: seat !== undefined ? graph.seatToColor[seat] : undefined,
      points: armTriangles[arm],
      finishCenter,
    });
  }

  return {
    playerCount,
    variant: 'cross',
    viewBoxSize,
    tokenRadius: cell * 0.36,
    cells,
    yards,
    unusedCorners,
    centerPolygon: [cTL, cTR, cBR, cBL],
    finishWedges,
    nodePositions,
  };
}

function buildRadialGeometry(playerCount: PlayerCount): BoardGeometry {
  const graph = getBoardGraph(playerCount);
  const viewBoxSize = 1000;
  const cx = 500;
  const cy = 500;
  const sectorCount = playerCount; // 5 or 6
  const stepDeg = 360 / sectorCount;

  // Carefully calculated non-overlapping radial parameters
  const w = sectorCount === 5 ? 54 : 50; // cell size
  const r0 = sectorCount === 5 ? 2.85 * w : 3.15 * w;
  const yardRadius = sectorCount === 5 ? 6.25 * w : 6.45 * w;
  const yardDiameter = sectorCount === 5 ? 174 : 148;
  const centerHexRadius = sectorCount === 5 ? 2.15 * w : 2.35 * w;

  const nodePositions: Record<string, Point2D> = {};
  const cells: CellRenderShape[] = [];
  const yards: YardRenderShape[] = [];
  const centerPolygon: Point2D[] = [];
  const finishWedges: FinishWedgeShape[] = [];

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Place Arm 0 straight down (90 deg) so Seat 0 (human/host) starts cleanly at bottom
  for (let k = 0; k < sectorCount; k++) {
    const armDeg = 90 + k * stepDeg;
    const armRad = toRad(armDeg);
    const ux = Math.cos(armRad);
    const uy = Math.sin(armRad);
    // Clockwise perpendicular unit vector in screen coordinates (x right, y down)
    const px = -uy;
    const py = ux;

    const pointAt = (r: number, offset: number): Point2D => ({
      x: cx + r * ux + offset * px,
      y: cy + r * uy + offset * py,
    });

    const seat = k;
    const color = graph.seatToColor[seat];

    // 11 main track cells for sector k:
    // j = 0..3: outgoing on -w (r0..r0+3w)
    // j = 4: outer corner -w (r0+4w)
    // j = 5: tip middle 0 (r0+4w) -> home gate!
    // j = 6: outer corner +w (r0+4w)
    // j = 7: start square +w (r0+3w)
    // j = 8..10: incoming on +w (r0+2w..r0)
    const sectorSpecs: { r: number; offset: number }[] = [
      { r: r0 + 0 * w, offset: -w },
      { r: r0 + 1 * w, offset: -w },
      { r: r0 + 2 * w, offset: -w },
      { r: r0 + 3 * w, offset: -w },
      { r: r0 + 4 * w, offset: -w },
      { r: r0 + 4 * w, offset: 0 },
      { r: r0 + 4 * w, offset: w },
      { r: r0 + 3 * w, offset: w },
      { r: r0 + 2 * w, offset: w },
      { r: r0 + 1 * w, offset: w },
      { r: r0 + 0 * w, offset: w },
    ];

    sectorSpecs.forEach((spec, j) => {
      const t = k * 11 + j;
      const nodeId = `track:${t}`;
      const node = graph.nodes[nodeId];
      const pos = pointAt(spec.r, spec.offset);
      nodePositions[nodeId] = pos;

      cells.push({
        nodeId,
        x: pos.x,
        y: pos.y,
        size: w * 0.94,
        angleDeg: armDeg - 90,
        trackIndex: t,
        isSafe: node.isSafe,
        isStar: node.isStar,
        isStart: node.isStart,
        startColor: node.isStart ? color : undefined,
        entryArrowAngleDeg: node.isStart ? armDeg + 180 : undefined,
      });
    });

    // 5 Home lane cells going inward toward center along offset=0
    for (let h = 0; h < 5; h++) {
      const nodeId = `home:${seat}:${h}`;
      const r = r0 + (3 - h) * w; // 3w, 2w, 1w, 0w, -1w relative to r0
      const pos = pointAt(r, 0);
      nodePositions[nodeId] = pos;
      cells.push({
        nodeId,
        x: pos.x,
        y: pos.y,
        size: w * 0.94,
        angleDeg: armDeg - 90,
        isSafe: true,
        homeColor: color,
      });
    }

    // Player Yard placed cleanly in the wedge between Arm k (+w side) and Arm k+1
    const wedgeDeg = armDeg + stepDeg / 2;
    const wedgeRad = toRad(wedgeDeg);
    const yx = cx + yardRadius * Math.cos(wedgeRad);
    const yy = cy + yardRadius * Math.sin(wedgeRad);
    const slotDist = yardDiameter * 0.2;
    const slotPositions: Point2D[] = [
      { x: yx - slotDist, y: yy - slotDist },
      { x: yx + slotDist, y: yy - slotDist },
      { x: yx - slotDist, y: yy + slotDist },
      { x: yx + slotDist, y: yy + slotDist },
    ];
    slotPositions.forEach((p, idx) => {
      nodePositions[`yard:${seat}:${idx}`] = p;
    });

    yards.push({
      seat,
      color,
      kind: 'circle',
      cx: yx,
      cy: yy,
      width: yardDiameter,
      height: yardDiameter,
      slotPositions,
    });

    // Central Finish Polygon Vertex & Wedge
    const v1Rad = toRad(armDeg - stepDeg / 2);
    const v2Rad = toRad(armDeg + stepDeg / 2);
    const p1: Point2D = {
      x: cx + centerHexRadius * Math.cos(v1Rad),
      y: cy + centerHexRadius * Math.sin(v1Rad),
    };
    const p2: Point2D = {
      x: cx + centerHexRadius * Math.cos(v2Rad),
      y: cy + centerHexRadius * Math.sin(v2Rad),
    };
    centerPolygon.push(p1);

    const finishCenter: Point2D = {
      x: cx + centerHexRadius * 0.54 * ux,
      y: cy + centerHexRadius * 0.54 * uy,
    };
    nodePositions[`finish:${seat}`] = finishCenter;
    finishWedges.push({
      seat,
      color,
      points: [p1, p2, { x: cx, y: cy }],
      finishCenter,
    });
  }

  return {
    playerCount,
    variant: graph.variant,
    viewBoxSize,
    tokenRadius: w * 0.35,
    cells,
    yards,
    centerPolygon,
    finishWedges,
    nodePositions,
  };
}

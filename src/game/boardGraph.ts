import {
  type BoardGraph,
  type BoardNode,
  type BoardVariant,
  type PlayerColor,
  type PlayerCount,
  SEAT_COLORS_BY_COUNT,
} from './types.ts';

const HOME_LANE_LENGTH = 5;

const CROSS_ARM_BY_COUNT: Record<2 | 3 | 4, number[]> = {
  2: [0, 2],
  3: [0, 1, 2],
  4: [0, 1, 2, 3],
};

const graphCache = new Map<PlayerCount, BoardGraph>();

export function getBoardGraph(playerCount: PlayerCount): BoardGraph {
  const cached = graphCache.get(playerCount);
  if (cached) return cached;
  const built = buildBoardGraph(playerCount);
  graphCache.set(playerCount, built);
  return built;
}

function buildBoardGraph(playerCount: PlayerCount): BoardGraph {
  const colors = SEAT_COLORS_BY_COUNT[playerCount];
  const activeSeats = colors.map((_, i) => i);
  const seatToColor: Record<number, PlayerColor> = {};
  const seatToArm: Record<number, number> = {};

  activeSeats.forEach((seat) => {
    seatToColor[seat] = colors[seat];
  });

  let variant: BoardVariant;
  let trackLength: number;
  let stepsToFinish: number;
  let startTrackBySeat: Record<number, number> = {};
  let homeGateTrackBySeat: Record<number, number> = {};
  let starTrackIndices: number[] = [];
  let startTrackToSeat: Record<number, number> = {};

  if (playerCount <= 4) {
    variant = 'cross';
    trackLength = 52;
    stepsToFinish = 56; // 50 track steps + 5 home lane + 1 finish
    const armIndices = CROSS_ARM_BY_COUNT[playerCount as 2 | 3 | 4];
    activeSeats.forEach((seat) => {
      const arm = armIndices[seat];
      seatToArm[seat] = arm;
      const startTrack = arm * 13;
      const gateTrack = (startTrack + 50) % 52;
      startTrackBySeat[seat] = startTrack;
      homeGateTrackBySeat[seat] = gateTrack;
      startTrackToSeat[startTrack] = seat;
    });
    // Symmetric safe squares across all 4 arms: 4 start positions + 4 star positions
    starTrackIndices = [8, 21, 34, 47];
  } else {
    const sectorCount = playerCount; // 5 for pentagon, 6 for hexagon
    variant = playerCount === 5 ? 'pentagon' : 'hexagon';
    const cellsPerSector = 11;
    trackLength = sectorCount * cellsPerSector; // 55 for 5p, 66 for 6p
    // From start (11*k + 7) clockwise to home gate (11*k + 5) is trackLength - 2 steps,
    // plus 5 home lane cells + 1 finish cell = trackLength + 4 total steps
    stepsToFinish = trackLength + 4; // 59 for 5p, 70 for 6p

    activeSeats.forEach((seat) => {
      seatToArm[seat] = seat;
      const startTrack = seat * cellsPerSector + 7;
      const gateTrack = seat * cellsPerSector + 5;
      startTrackBySeat[seat] = startTrack;
      homeGateTrackBySeat[seat] = gateTrack;
      startTrackToSeat[startTrack] = seat;
    });

    starTrackIndices = activeSeats.map((seat) => seat * cellsPerSector + 2);
  }

  // All 4 classic start positions on the cross board remain safe squares for consistent balance
  const allStartTrackIndices =
    variant === 'cross'
      ? [0, 13, 26, 39]
      : activeSeats.map((seat) => startTrackBySeat[seat]);

  const safeTrackSet = new Set<number>([...allStartTrackIndices, ...starTrackIndices]);
  const starTrackSet = new Set<number>(starTrackIndices);

  const nodes: Record<string, BoardNode> = {};
  const trackOrder: string[] = [];
  const safeNodeIds: string[] = [];
  const startNodeBySeat: Record<number, string> = {};
  const yardNodesBySeat: Record<number, string[]> = {};
  const finishNodeBySeat: Record<number, string> = {};

  // 1. Main circuit nodes
  for (let t = 0; t < trackLength; t++) {
    const id = `track:${t}`;
    trackOrder.push(id);
    const isSafe = safeTrackSet.has(t);
    const isStart = startTrackToSeat[t] !== undefined;
    const isStar = starTrackSet.has(t);
    if (isSafe) safeNodeIds.push(id);

    const nextBySeat: Record<number, string | null> = {};
    for (const seat of activeSeats) {
      if (homeGateTrackBySeat[seat] === t) {
        nextBySeat[seat] = `home:${seat}:0`;
      } else {
        nextBySeat[seat] = `track:${(t + 1) % trackLength}`;
      }
    }

    nodes[id] = {
      id,
      kind: 'track',
      isSafe,
      isStart,
      isStar,
      startSeat: startTrackToSeat[t],
      trackIndex: t,
      nextBySeat,
    };
  }

  // 2. Player yards, home lanes, and finish nodes
  for (const seat of activeSeats) {
    const startId = `track:${startTrackBySeat[seat]}`;
    startNodeBySeat[seat] = startId;

    const yards: string[] = [];
    for (let i = 0; i < 4; i++) {
      const yardId = `yard:${seat}:${i}`;
      yards.push(yardId);
      nodes[yardId] = {
        id: yardId,
        kind: 'yard',
        ownerSeat: seat,
        isSafe: true,
        nextBySeat: { [seat]: startId },
      };
    }
    yardNodesBySeat[seat] = yards;

    for (let h = 0; h < HOME_LANE_LENGTH; h++) {
      const homeId = `home:${seat}:${h}`;
      const nextId = h < HOME_LANE_LENGTH - 1 ? `home:${seat}:${h + 1}` : `finish:${seat}`;
      nodes[homeId] = {
        id: homeId,
        kind: 'home',
        ownerSeat: seat,
        isSafe: true,
        homeIndex: h,
        nextBySeat: { [seat]: nextId },
      };
    }

    const finishId = `finish:${seat}`;
    finishNodeBySeat[seat] = finishId;
    nodes[finishId] = {
      id: finishId,
      kind: 'finish',
      ownerSeat: seat,
      isSafe: true,
      nextBySeat: { [seat]: null },
    };
  }

  return {
    playerCount,
    variant,
    trackLength,
    homeLaneLength: HOME_LANE_LENGTH,
    stepsToFinish,
    activeSeats,
    seatToArm,
    seatToColor,
    nodes,
    startNodeBySeat,
    homeGateTrackBySeat,
    yardNodesBySeat,
    finishNodeBySeat,
    safeNodeIds,
    trackOrder,
  };
}

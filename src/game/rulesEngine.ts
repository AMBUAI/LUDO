import { getBoardGraph } from './boardGraph.ts';
import {
  type BoardNode,
  COLOR_THEMES,
  type LegalMove,
  type MatchEvent,
  type MatchState,
  type Participant,
  type PlayerCount,
  type TokenState,
} from './types.ts';

export function createInitialMatchState(params: {
  id: string;
  mode: 'bot' | 'online';
  participants: Participant[];
}): MatchState {
  const playerCount = params.participants.length as PlayerCount;
  const graph = getBoardGraph(playerCount);

  const tokens: Record<string, TokenState> = {};
  for (const participant of params.participants) {
    const seat = participant.seat;
    const yardIds = graph.yardNodesBySeat[seat];
    for (let i = 0; i < 4; i++) {
      const idx = i as 0 | 1 | 2 | 3;
      const id = `t:${seat}:${idx}`;
      tokens[id] = {
        id,
        seat,
        index: idx,
        nodeId: yardIds[idx],
        progress: -1,
      };
    }
  }

  const firstSeat = params.participants[0]?.seat ?? 0;

  return {
    id: params.id,
    mode: params.mode,
    playerCount,
    participants: params.participants.map((p) => ({ ...p })),
    tokens,
    currentTurnSeat: firstSeat,
    turnPhase: 'waiting_roll',
    diceValue: null,
    consecutiveSixes: 0,
    legalMoves: [],
    winnerSeat: null,
    lastEvent: {
      type: 'start',
      seat: firstSeat,
      color: graph.seatToColor[firstSeat],
      message: `${params.participants[0]?.name ?? 'Red'} rolls first`,
    },
    seq: 1,
  };
}

export function getLegalMoves(
  state: MatchState,
  seat: number,
  diceValue: number
): LegalMove[] {
  if (diceValue < 1 || diceValue > 6) return [];
  const graph = getBoardGraph(state.playerCount);
  const moves: LegalMove[] = [];

  for (let i = 0; i < 4; i++) {
    const token = state.tokens[`t:${seat}:${i}`];
    if (!token) continue;

    // Already finished
    if (token.progress >= graph.stepsToFinish) continue;

    // Inside yard: requires rolling a 6 to enter start square
    if (token.progress === -1) {
      if (diceValue !== 6) continue;
      const startNodeId = graph.startNodeBySeat[seat];
      const capturedTokenIds = findCapturableTokensAt(state, seat, startNodeId);
      moves.push({
        tokenId: token.id,
        fromNodeId: token.nodeId,
        toNodeId: startNodeId,
        pathNodeIds: [startNodeId],
        newProgress: 0,
        isRelease: true,
        isFinish: false,
        capturedTokenIds,
      });
      continue;
    }

    // On track or home lane: exact steps along graph edges
    let currId: string | null = token.nodeId;
    const pathNodeIds: string[] = [];
    let valid = true;

    for (let step = 0; step < diceValue; step++) {
      const node: BoardNode | undefined = currId ? graph.nodes[currId] : undefined;
      const nextId: string | null = node ? (node.nextBySeat[seat] ?? null) : null;
      if (!nextId) {
        valid = false;
        break;
      }
      pathNodeIds.push(nextId);
      currId = nextId;
    }

    if (!valid || !currId) continue;

    const newProgress = token.progress + diceValue;
    const isFinish = currId === graph.finishNodeBySeat[seat];
    const capturedTokenIds = findCapturableTokensAt(state, seat, currId);

    moves.push({
      tokenId: token.id,
      fromNodeId: token.nodeId,
      toNodeId: currId,
      pathNodeIds,
      newProgress,
      isRelease: false,
      isFinish,
      capturedTokenIds,
    });
  }

  return moves;
}

function findCapturableTokensAt(
  state: MatchState,
  movingSeat: number,
  targetNodeId: string
): string[] {
  const graph = getBoardGraph(state.playerCount);
  const node = graph.nodes[targetNodeId];
  if (!node || node.isSafe || node.kind !== 'track') {
    return [];
  }

  const captured: string[] = [];
  for (const token of Object.values(state.tokens)) {
    if (token.seat === movingSeat) continue;
    if (token.nodeId === targetNodeId) {
      captured.push(token.id);
    }
  }
  return captured;
}

export function getNextActiveSeat(
  participants: Participant[],
  currentSeat: number
): number {
  const sorted = [...participants].sort((a, b) => a.seat - b.seat);
  const idx = sorted.findIndex((p) => p.seat === currentSeat);
  if (idx === -1) return sorted[0]?.seat ?? 0;

  for (let offset = 1; offset <= sorted.length; offset++) {
    const candidate = sorted[(idx + offset) % sorted.length];
    if (!candidate.forfeited) {
      return candidate.seat;
    }
  }
  return currentSeat;
}

export function applyDiceRoll(
  state: MatchState,
  seat: number,
  diceValue: number
): {
  nextState: MatchState;
  autoAdvanceTurn: boolean;
  event: MatchEvent;
} {
  if (state.turnPhase !== 'waiting_roll' || state.currentTurnSeat !== seat) {
    throw new Error('Invalid turn state for dice roll');
  }

  const participant = state.participants.find((p) => p.seat === seat);
  const color = participant?.color ?? 'red';
  const label = participant?.name ?? COLOR_THEMES[color].label;

  const nextSixes = diceValue === 6 ? state.consecutiveSixes + 1 : 0;

  // Classic rule: 3 consecutive 6s forfeits the third roll and passes turn
  if (nextSixes >= 3) {
    const event: MatchEvent = {
      type: 'triple_six',
      seat,
      color,
      dice: 6,
      message: `${label} rolled three 6s — turn passed`,
    };
    return {
      nextState: {
        ...state,
        diceValue: 6,
        consecutiveSixes: 0,
        legalMoves: [],
        turnPhase: 'waiting_move', // briefly held before turn advances
        lastEvent: event,
        seq: state.seq + 1,
      },
      autoAdvanceTurn: true,
      event,
    };
  }

  const legalMoves = getLegalMoves(state, seat, diceValue);

  if (legalMoves.length === 0) {
    const event: MatchEvent = {
      type: 'no_move',
      seat,
      color,
      dice: diceValue,
      message: `${label} rolled ${diceValue} — no legal moves`,
    };
    return {
      nextState: {
        ...state,
        diceValue,
        consecutiveSixes: 0,
        legalMoves: [],
        turnPhase: 'waiting_move', // briefly displayed before auto-advance
        lastEvent: event,
        seq: state.seq + 1,
      },
      autoAdvanceTurn: true,
      event,
    };
  }

  const event: MatchEvent = {
    type: 'move',
    seat,
    color,
    dice: diceValue,
    message: `${label} rolled ${diceValue}`,
  };

  return {
    nextState: {
      ...state,
      diceValue,
      consecutiveSixes: nextSixes,
      legalMoves,
      turnPhase: 'waiting_move',
      lastEvent: event,
      seq: state.seq + 1,
    },
    autoAdvanceTurn: false,
    event,
  };
}

export function advanceTurnAfterBlockedRoll(state: MatchState): MatchState {
  if (state.turnPhase === 'finished') return state;
  const nextSeat = getNextActiveSeat(state.participants, state.currentTurnSeat);
  const nextPlayer = state.participants.find((p) => p.seat === nextSeat);
  return {
    ...state,
    currentTurnSeat: nextSeat,
    turnPhase: 'waiting_roll',
    diceValue: null,
    consecutiveSixes: 0,
    legalMoves: [],
    lastEvent: {
      type: 'move',
      seat: nextSeat,
      color: nextPlayer?.color ?? 'red',
      message: `${nextPlayer?.name ?? 'Next player'}'s turn`,
    },
    seq: state.seq + 1,
  };
}

export function applyMove(
  state: MatchState,
  seat: number,
  tokenId: string
): {
  nextState: MatchState;
  event: MatchEvent;
} {
  if (state.turnPhase !== 'waiting_move' || state.currentTurnSeat !== seat) {
    throw new Error('Invalid turn state for move');
  }

  const chosen = state.legalMoves.find((m) => m.tokenId === tokenId);
  if (!chosen) {
    throw new Error('Illegal token move');
  }

  const graph = getBoardGraph(state.playerCount);
  const updatedTokens: Record<string, TokenState> = { ...state.tokens };
  const movingToken = updatedTokens[tokenId];

  updatedTokens[tokenId] = {
    ...movingToken,
    nodeId: chosen.toNodeId,
    progress: chosen.newProgress,
  };

  // Resolve captures (guaranteed once per captured token)
  for (const capId of chosen.capturedTokenIds) {
    const capToken = updatedTokens[capId];
    if (!capToken) continue;
    const yardId = graph.yardNodesBySeat[capToken.seat][capToken.index];
    updatedTokens[capId] = {
      ...capToken,
      nodeId: yardId,
      progress: -1,
    };
  }

  // Check winning condition: all 4 tokens of moving seat are at finish
  const seatTokens = [0, 1, 2, 3].map((idx) => updatedTokens[`t:${seat}:${idx}`]);
  const hasWon = seatTokens.every((t) => t.progress === graph.stepsToFinish);

  const participant = state.participants.find((p) => p.seat === seat);
  const color = participant?.color ?? 'red';
  const label = participant?.name ?? COLOR_THEMES[color].label;

  let event: MatchEvent;
  if (hasWon) {
    event = {
      type: 'win',
      seat,
      color,
      dice: state.diceValue ?? undefined,
      tokenId,
      pathNodeIds: chosen.pathNodeIds,
      capturedTokenIds: chosen.capturedTokenIds,
      message: `${label} wins the match!`,
    };
    return {
      nextState: {
        ...state,
        tokens: updatedTokens,
        turnPhase: 'finished',
        legalMoves: [],
        winnerSeat: seat,
        lastEvent: event,
        seq: state.seq + 1,
      },
      event,
    };
  }

  if (chosen.capturedTokenIds.length > 0) {
    event = {
      type: 'capture',
      seat,
      color,
      dice: state.diceValue ?? undefined,
      tokenId,
      pathNodeIds: chosen.pathNodeIds,
      capturedTokenIds: chosen.capturedTokenIds,
      message: `${label} captured ${chosen.capturedTokenIds.length} token${
        chosen.capturedTokenIds.length > 1 ? 's' : ''
      }!`,
    };
  } else if (chosen.isFinish) {
    event = {
      type: 'home',
      seat,
      color,
      dice: state.diceValue ?? undefined,
      tokenId,
      pathNodeIds: chosen.pathNodeIds,
      message: `${label} reached home!`,
    };
  } else if (chosen.isRelease) {
    event = {
      type: 'release',
      seat,
      color,
      dice: state.diceValue ?? undefined,
      tokenId,
      pathNodeIds: chosen.pathNodeIds,
      message: `${label} deployed a token`,
    };
  } else {
    event = {
      type: 'move',
      seat,
      color,
      dice: state.diceValue ?? undefined,
      tokenId,
      pathNodeIds: chosen.pathNodeIds,
      message: `${label} moved ${state.diceValue} spaces`,
    };
  }

  // Rolling a 6 grants an additional roll
  const keepsTurn = state.diceValue === 6;
  const nextSeat = keepsTurn ? seat : getNextActiveSeat(state.participants, seat);

  return {
    nextState: {
      ...state,
      tokens: updatedTokens,
      currentTurnSeat: nextSeat,
      turnPhase: 'waiting_roll',
      diceValue: null,
      consecutiveSixes: keepsTurn ? state.consecutiveSixes : 0,
      legalMoves: [],
      lastEvent: event,
      seq: state.seq + 1,
    },
    event,
  };
}

export function forfeitSeat(state: MatchState, seat: number): MatchState {
  if (state.turnPhase === 'finished') return state;
  const graph = getBoardGraph(state.playerCount);

  const participants = state.participants.map((p) =>
    p.seat === seat ? { ...p, forfeited: true, connected: false } : p
  );

  // Return forfeited player's active board tokens cleanly to their yard
  const updatedTokens = { ...state.tokens };
  for (let i = 0; i < 4; i++) {
    const id = `t:${seat}:${i}`;
    const t = updatedTokens[id];
    if (t && t.progress < graph.stepsToFinish) {
      updatedTokens[id] = {
        ...t,
        nodeId: graph.yardNodesBySeat[seat][t.index],
        progress: -1,
      };
    }
  }

  const remaining = participants.filter((p) => !p.forfeited);
  const droppedPlayer = state.participants.find((p) => p.seat === seat);
  const color = droppedPlayer?.color ?? 'red';
  const label = droppedPlayer?.name ?? COLOR_THEMES[color].label;

  if (remaining.length === 1) {
    const survivor = remaining[0];
    return {
      ...state,
      participants,
      tokens: updatedTokens,
      turnPhase: 'finished',
      legalMoves: [],
      winnerSeat: survivor.seat,
      lastEvent: {
        type: 'win',
        seat: survivor.seat,
        color: survivor.color,
        message: `${label} forfeited — ${survivor.name} wins!`,
      },
      seq: state.seq + 1,
    };
  }

  const wasTurn = state.currentTurnSeat === seat;
  const nextSeat = wasTurn
    ? getNextActiveSeat(participants, seat)
    : state.currentTurnSeat;

  return {
    ...state,
    participants,
    tokens: updatedTokens,
    currentTurnSeat: nextSeat,
    turnPhase: wasTurn ? 'waiting_roll' : state.turnPhase,
    diceValue: wasTurn ? null : state.diceValue,
    consecutiveSixes: wasTurn ? 0 : state.consecutiveSixes,
    legalMoves: wasTurn ? [] : state.legalMoves,
    lastEvent: {
      type: 'forfeit',
      seat,
      color,
      message: `${label} disconnected and forfeited`,
    },
    seq: state.seq + 1,
  };
}

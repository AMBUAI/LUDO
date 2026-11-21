import { getBoardGraph } from './boardGraph.ts';
import { BotPersonality, LegalMove, MatchState } from './types.ts';

/**
 * Evaluates legal moves exclusively from the public current MatchState.
 * Never inspects future dice values or modifies dice randomness.
 */
export function chooseBotMove(
  state: MatchState,
  seat: number,
  personality: BotPersonality
): LegalMove | null {
  const moves = state.legalMoves;
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];

  const graph = getBoardGraph(state.playerCount);

  let bestMove = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    const score = scoreMoveForPersonality(state, graph.trackLength, graph.stepsToFinish, seat, move, personality);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

function scoreMoveForPersonality(
  state: MatchState,
  trackLength: number,
  stepsToFinish: number,
  seat: number,
  move: LegalMove,
  personality: BotPersonality
): number {
  const graph = getBoardGraph(state.playerCount);
  const token = state.tokens[move.tokenId];
  const fromNode = graph.nodes[move.fromNodeId];
  const toNode = graph.nodes[move.toNodeId];

  const originDanger =
    fromNode && fromNode.kind === 'track' && !fromNode.isSafe
      ? countIncomingThreats(state, trackLength, seat, fromNode.trackIndex!)
      : 0;

  const destDanger =
    toNode && toNode.kind === 'track' && !toNode.isSafe
      ? countIncomingThreats(state, trackLength, seat, toNode.trackIndex!)
      : 0;

  const capturedProgressValue = move.capturedTokenIds.reduce((sum, capId) => {
    const cap = state.tokens[capId];
    return sum + (cap ? Math.max(10, cap.progress) : 10);
  }, 0);

  const enteringHomeLane =
    fromNode?.kind === 'track' && toNode?.kind === 'home';

  const activeOnBoard = [0, 1, 2, 3].filter((i) => {
    const t = state.tokens[`t:${seat}:${i}`];
    return t && t.progress >= 0 && t.progress < stepsToFinish;
  }).length;

  const progressRatio = move.newProgress / stepsToFinish;
  const huntingScore =
    toNode?.kind === 'track'
      ? countAheadTargets(state, trackLength, seat, toNode.trackIndex!)
      : 0;

  let score = 0;

  switch (personality) {
    case 'aggressive': {
      // Prioritizes captures, hunting vulnerable tokens, and forward pressure
      if (move.capturedTokenIds.length > 0) {
        score += 180 + capturedProgressValue * 1.4;
      }
      if (move.isFinish) score += 95;
      if (enteringHomeLane) score += 75;
      if (move.isRelease) score += activeOnBoard < 2 ? 70 : 42;
      score += huntingScore * 28;
      score += progressRatio * 30;
      score += originDanger * 12;
      score -= destDanger * 14;
      if (toNode?.isSafe) score += 16;
      break;
    }

    case 'strategic': {
      // Evaluates safety delta, escaping danger, safe squares, and balanced progression
      if (move.isFinish) score += 130;
      if (enteringHomeLane) score += 115;
      if (move.capturedTokenIds.length > 0) {
        score += 95 + capturedProgressValue * 0.8;
      }
      if (toNode?.isSafe) score += 62;
      if (fromNode?.isSafe && !toNode?.isSafe && destDanger > 0) {
        score -= 36;
      }
      score += originDanger * (22 + Math.max(0, token.progress) * 0.6);
      score -= destDanger * (28 + move.newProgress * 0.7);
      if (move.isRelease) {
        score += activeOnBoard === 0 ? 110 : activeOnBoard === 1 ? 58 : 26;
      }
      score += progressRatio * 42;
      break;
    }

    case 'progress': {
      // Prioritizes advancing lead tokens toward home lane & finishing efficiently
      if (move.isFinish) score += 170;
      if (enteringHomeLane) score += 130;
      if (toNode?.kind === 'home') score += 85;
      score += progressRatio * 95;
      if (move.isRelease) {
        score += activeOnBoard === 0 ? 120 : activeOnBoard < 2 ? 52 : 18;
      }
      if (move.capturedTokenIds.length > 0) score += 65;
      if (toNode?.isSafe) score += 28;
      score -= destDanger * 22;
      score += originDanger * 14;
      break;
    }
  }

  // Tiny deterministic tie-breaker by token index so bots never jitter
  score += (3 - token.index) * 0.01;
  return score;
}

function countIncomingThreats(
  state: MatchState,
  trackLength: number,
  mySeat: number,
  trackIdx: number
): number {
  let threats = 0;
  for (const token of Object.values(state.tokens)) {
    if (token.seat === mySeat || token.progress < 0) continue;
    const graph = getBoardGraph(state.playerCount);
    const node = graph.nodes[token.nodeId];
    if (!node || node.kind !== 'track' || node.trackIndex === undefined) continue;

    const dist = (trackIdx - node.trackIndex + trackLength) % trackLength;
    if (dist >= 1 && dist <= 6) {
      threats += 1;
    }
  }
  return threats;
}

function countAheadTargets(
  state: MatchState,
  trackLength: number,
  mySeat: number,
  trackIdx: number
): number {
  let targets = 0;
  const graph = getBoardGraph(state.playerCount);
  for (const token of Object.values(state.tokens)) {
    if (token.seat === mySeat || token.progress < 0) continue;
    const node = graph.nodes[token.nodeId];
    if (!node || node.kind !== 'track' || node.trackIndex === undefined || node.isSafe) continue;

    const dist = (node.trackIndex - trackIdx + trackLength) % trackLength;
    if (dist >= 1 && dist <= 6) {
      targets += 1;
    }
  }
  return targets;
}

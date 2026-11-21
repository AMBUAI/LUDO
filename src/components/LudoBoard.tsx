import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getBoardGeometry, Point2D } from '../game/boardGeometry';
import {
  COLOR_THEMES,
  LegalMove,
  MatchState,
  PlayerCount,
  TokenState,
} from '../game/types';
import { soundEngine } from '../utils/sound';

interface LudoBoardProps {
  playerCount: PlayerCount;
  match?: MatchState | null;
  interactiveSeat?: number | null;
  onSelectToken?: (tokenId: string) => void;
  previewOnly?: boolean;
}

function pointsToSvg(points: Point2D[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function getClusterOffset(indexInGroup: number, groupSize: number, radius: number): Point2D {
  if (groupSize <= 1) return { x: 0, y: 0 };
  if (groupSize === 2) {
    const dx = radius * 0.48;
    return { x: indexInGroup === 0 ? -dx : dx, y: 0 };
  }
  if (groupSize === 3) {
    const r = radius * 0.52;
    const angles = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];
    const a = angles[indexInGroup % 3];
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  const d = radius * 0.45;
  const offsets: Point2D[] = [
    { x: -d, y: -d },
    { x: d, y: -d },
    { x: -d, y: d },
    { x: d, y: d },
  ];
  return offsets[indexInGroup % 4];
}

export const LudoBoard: React.FC<LudoBoardProps> = ({
  playerCount,
  match,
  interactiveSeat,
  onSelectToken,
  previewOnly = false,
}) => {
  const geometry = useMemo(() => getBoardGeometry(playerCount), [playerCount]);

  // Visual step-by-step hop animation override for the most recently moved token
  const [animOverride, setAnimOverride] = useState<{
    tokenId: string;
    nodeId: string;
  } | null>(null);
  const lastAnimatedSeqRef = useRef<number>(0);
  const lastMatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!match || previewOnly) {
      setAnimOverride(null);
      return;
    }
    if (lastMatchIdRef.current !== match.id) {
      lastMatchIdRef.current = match.id;
      lastAnimatedSeqRef.current = 0;
    }
    if (match.seq <= lastAnimatedSeqRef.current) return;
    lastAnimatedSeqRef.current = match.seq;

    const ev = match.lastEvent;
    if (!ev || !ev.tokenId || !ev.pathNodeIds || ev.pathNodeIds.length <= 1) {
      setAnimOverride(null);
      return;
    }

    const tokenId = ev.tokenId;
    const path = ev.pathNodeIds;
    let stepIdx = 0;
    setAnimOverride({ tokenId, nodeId: path[0] });
    soundEngine.playHop();

    const interval = window.setInterval(() => {
      stepIdx += 1;
      if (stepIdx >= path.length - 1) {
        window.clearInterval(interval);
        setAnimOverride(null);
        return;
      }
      setAnimOverride({ tokenId, nodeId: path[stepIdx] });
      soundEngine.playHop();
    }, 85);

    return () => {
      window.clearInterval(interval);
    };
  }, [match, previewOnly]);

  const legalMoveMap = useMemo(() => {
    const map = new Map<string, LegalMove>();
    if (!match || previewOnly) return map;
    if (
      interactiveSeat !== null &&
      interactiveSeat !== undefined &&
      match.currentTurnSeat === interactiveSeat &&
      match.turnPhase === 'waiting_move'
    ) {
      for (const m of match.legalMoves) {
        map.set(m.tokenId, m);
      }
    }
    return map;
  }, [match, interactiveSeat, previewOnly]);

  const tokensList = useMemo(() => {
    if (match) {
      return Object.values(match.tokens);
    }
    // Preview mode: show 4 resting tokens inside each active yard
    const previewTokens: TokenState[] = [];
    geometry.yards.forEach((y) => {
      for (let i = 0; i < 4; i++) {
        const idx = i as 0 | 1 | 2 | 3;
        previewTokens.push({
          id: `t:${y.seat}:${idx}`,
          seat: y.seat,
          index: idx,
          nodeId: `yard:${y.seat}:${idx}`,
          progress: -1,
        });
      }
    });
    return previewTokens;
  }, [match, geometry.yards]);

  // Group tokens by effective nodeId for clean stacking offsets
  const tokenRenderEntries = useMemo(() => {
    const groups = new Map<string, TokenState[]>();
    for (const token of tokensList) {
      const effectiveNode =
        animOverride && animOverride.tokenId === token.id
          ? animOverride.nodeId
          : token.nodeId;
      const list = groups.get(effectiveNode) || [];
      list.push(token);
      groups.set(effectiveNode, list);
    }

    const entries: {
      token: TokenState;
      x: number;
      y: number;
      scale: number;
      isLegal: boolean;
      isAnimating: boolean;
    }[] = [];

    for (const [nodeId, group] of groups.entries()) {
      const basePos = geometry.nodePositions[nodeId];
      if (!basePos) continue;
      const isMulti = group.length > 1;
      const scale = isMulti ? (group.length === 2 ? 0.84 : 0.74) : 1;

      group.forEach((token, idx) => {
        const offset = getClusterOffset(idx, group.length, geometry.tokenRadius * 1.15);
        entries.push({
          token,
          x: basePos.x + offset.x,
          y: basePos.y + offset.y,
          scale,
          isLegal: legalMoveMap.has(token.id),
          isAnimating: animOverride?.tokenId === token.id,
        });
      });
    }

    // Draw non-legal tokens first, then animating/legal tokens on top for clear tap priority
    entries.sort((a, b) => {
      if (a.isLegal !== b.isLegal) return a.isLegal ? 1 : -1;
      if (a.isAnimating !== b.isAnimating) return a.isAnimating ? 1 : -1;
      return a.token.seat - b.token.seat;
    });

    return entries;
  }, [tokensList, animOverride, geometry.nodePositions, geometry.tokenRadius, legalMoveMap]);

  const boardShapeBg =
    geometry.variant === 'cross' ? (
      <rect
        x={12}
        y={12}
        width={976}
        height={976}
        rx={32}
        fill="#FAF6EC"
        stroke="#334155"
        strokeWidth={8}
      />
    ) : (
      <circle
        cx={500}
        cy={500}
        r={484}
        fill="#FAF6EC"
        stroke="#334155"
        strokeWidth={8}
      />
    );

  return (
    <svg
      viewBox={`0 0 ${geometry.viewBoxSize} ${geometry.viewBoxSize}`}
      className="h-full w-full select-none drop-shadow-2xl"
      role="img"
      aria-label={`${playerCount}-player Ludo board`}
    >
      <defs>
        <filter id="token-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#0F172A" floodOpacity="0.38" />
        </filter>
      </defs>

      {boardShapeBg}

      {/* Unused corners on 2p / 3p cross boards */}
      {geometry.unusedCorners?.map((c, idx) => (
        <rect
          key={`unused-${idx}`}
          x={c.x}
          y={c.y}
          width={c.width}
          height={c.height}
          rx={14}
          fill="#E7E2D8"
          stroke="#CBD5E1"
          strokeWidth={2.5}
        />
      ))}

      {/* Track & Home Lane Cells */}
      {geometry.cells.map((cell) => {
        let fill = '#FFFFFF';
        let stroke = '#94A3B8';

        if (cell.homeColor) {
          fill = COLOR_THEMES[cell.homeColor].primary;
          stroke = '#FFFFFF';
        } else if (cell.startColor) {
          fill = COLOR_THEMES[cell.startColor].primary;
          stroke = '#FFFFFF';
        } else if (cell.isStar) {
          fill = '#F1F5F9';
        }

        const half = cell.size / 2;
        return (
          <g
            key={cell.nodeId}
            transform={`translate(${cell.x}, ${cell.y}) rotate(${cell.angleDeg})`}
          >
            <rect
              x={-half}
              y={-half}
              width={cell.size}
              height={cell.size}
              rx={geometry.variant === 'cross' ? 4 : 8}
              fill={fill}
              stroke={stroke}
              strokeWidth={2}
            />
            {cell.isStar && !cell.startColor && (
              <path
                d="M0,-14 L4,-4.5 L14,-4.5 L6,2 L9,12 L0,6 L-9,12 L-6,2 L-14,-4.5 L-4,-4.5 Z"
                fill="none"
                stroke="#64748B"
                strokeWidth={2.6}
                strokeLinejoin="round"
                transform={`scale(${cell.size / 54})`}
              />
            )}
            {cell.isStart && cell.entryArrowAngleDeg !== undefined && (
              <g
                transform={`rotate(${cell.entryArrowAngleDeg - cell.angleDeg}) scale(${
                  cell.size / 56
                })`}
              >
                <path
                  d="M-8,-6 L6,0 L-8,6 L-4,0 Z"
                  fill="#FFFFFF"
                  opacity={0.95}
                />
              </g>
            )}
          </g>
        );
      })}

      {/* Central Finish Polygon & Colored Wedges */}
      <polygon
        points={pointsToSvg(geometry.centerPolygon)}
        fill="#E2E8F0"
        stroke="#475569"
        strokeWidth={3}
      />
      {geometry.finishWedges.map((wedge, idx) => (
        <polygon
          key={`wedge-${idx}`}
          points={pointsToSvg(wedge.points)}
          fill={wedge.color ? COLOR_THEMES[wedge.color].primary : '#CBD5E1'}
          stroke="#FFFFFF"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      ))}
      <circle cx={500} cy={500} r={18} fill="#FFFBEB" stroke="#D97706" strokeWidth={3} />
      <path
        d="M492,504 L494,494 L500,499 L506,494 L508,504 Z"
        fill="#D97706"
      />

      {/* Active Player Yards */}
      {geometry.yards.map((yard) => {
        const theme = COLOR_THEMES[yard.color];
        const isCurrentTurn = match?.currentTurnSeat === yard.seat && !previewOnly;
        const participant = match?.participants.find((p) => p.seat === yard.seat);
        const isForfeited = participant?.forfeited;

        return (
          <g key={`yard-${yard.seat}`} opacity={isForfeited ? 0.45 : 1}>
            {yard.kind === 'square' ? (
              <>
                <rect
                  x={yard.cx - yard.width / 2}
                  y={yard.cy - yard.height / 2}
                  width={yard.width}
                  height={yard.height}
                  rx={18}
                  fill={theme.primary}
                  stroke={isCurrentTurn ? '#FBBF24' : '#1E293B'}
                  strokeWidth={isCurrentTurn ? 7 : 3}
                />
                <rect
                  x={yard.cx - yard.width * 0.34}
                  y={yard.cy - yard.height * 0.34}
                  width={yard.width * 0.68}
                  height={yard.height * 0.68}
                  rx={20}
                  fill="#FAF6EC"
                  stroke={theme.dark}
                  strokeWidth={2.5}
                />
              </>
            ) : (
              <>
                <circle
                  cx={yard.cx}
                  cy={yard.cy}
                  r={yard.width / 2}
                  fill={theme.primary}
                  stroke={isCurrentTurn ? '#FBBF24' : '#1E293B'}
                  strokeWidth={isCurrentTurn ? 7 : 3}
                />
                <circle
                  cx={yard.cx}
                  cy={yard.cy}
                  r={yard.width * 0.35}
                  fill="#FAF6EC"
                  stroke={theme.dark}
                  strokeWidth={2.5}
                />
              </>
            )}

            {/* 4 Token Sockets */}
            {yard.slotPositions.map((slot, sIdx) => (
              <circle
                key={`slot-${yard.seat}-${sIdx}`}
                cx={slot.x}
                cy={slot.y}
                r={geometry.tokenRadius * 1.05}
                fill={theme.light}
                stroke={theme.primary}
                strokeWidth={2.5}
              />
            ))}
          </g>
        );
      })}

      {/* Tokens Layer */}
      {tokenRenderEntries.map(({ token, x, y, scale, isLegal }) => {
        const participant = match?.participants.find((p) => p.seat === token.seat);
        const color =
          participant?.color ??
          geometry.yards.find((yr) => yr.seat === token.seat)?.color ??
          'red';
        const theme = COLOR_THEMES[color];
        const r = geometry.tokenRadius * scale;

        return (
          <g
            key={token.id}
            style={{
              transform: `translate(${x}px, ${y}px)`,
              transition: 'transform 85ms cubic-bezier(0.22, 1, 0.36, 1)',
              cursor: isLegal ? 'pointer' : 'default',
            }}
            onClick={
              isLegal && onSelectToken
                ? (e) => {
                    e.stopPropagation();
                    onSelectToken(token.id);
                  }
                : undefined
            }
          >
            {/* Pulsing legal choice ring */}
            {isLegal && (
              <circle
                cx={0}
                cy={0}
                r={r * 1.5}
                fill="none"
                stroke="#FBBF24"
                strokeWidth={4.5}
                className="animate-token-ring"
              />
            )}

            {/* Token body */}
            <g filter="url(#token-shadow)">
              <circle
                cx={0}
                cy={0}
                r={r}
                fill={theme.primary}
                stroke="#FFFFFF"
                strokeWidth={3}
              />
              <circle
                cx={0}
                cy={-r * 0.08}
                r={r * 0.62}
                fill={theme.dark}
                stroke={theme.ring}
                strokeWidth={1.8}
              />
              <circle cx={-r * 0.18} cy={-r * 0.24} r={r * 0.18} fill="#FFFFFF" opacity={0.45} />
            </g>

            {/* Expanded invisible mobile touch target (>=44px equivalent) */}
            {isLegal && (
              <circle
                cx={0}
                cy={0}
                r={Math.max(r * 1.9, 34)}
                fill="transparent"
                aria-label={`Move ${theme.label} token ${token.index + 1}`}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
};

import React from 'react';
import { COLOR_THEMES, PlayerColor } from '../game/types';

interface DiceButtonProps {
  value: number | null;
  color: PlayerColor;
  canRoll: boolean;
  isRolling: boolean;
  onRoll: () => void;
  label?: string;
}

const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 24],
    [72, 24],
    [28, 50],
    [72, 50],
    [28, 76],
    [72, 76],
  ],
};

export const DiceButton: React.FC<DiceButtonProps> = ({
  value,
  color,
  canRoll,
  isRolling,
  onRoll,
  label,
}) => {
  const theme = COLOR_THEMES[color];
  const displayVal = value ?? 6;
  const pips = PIP_POSITIONS[displayVal] || PIP_POSITIONS[1];

  return (
    <button
      type="button"
      onClick={onRoll}
      disabled={!canRoll || isRolling}
      aria-label={canRoll ? 'Roll dice' : `Dice shows ${displayVal}`}
      className={`group relative flex min-h-[68px] min-w-[68px] items-center justify-center rounded-2xl p-1.5 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
        canRoll && !isRolling
          ? 'cursor-pointer active:scale-95'
          : 'cursor-default opacity-85'
      }`}
      style={{
        backgroundColor: canRoll ? theme.primary : '#1E293B',
        boxShadow: canRoll
          ? `0 0 0 3px ${theme.ring}, 0 10px 25px -5px rgba(0,0,0,0.6)`
          : '0 4px 12px rgba(0,0,0,0.4)',
      }}
    >
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-xl bg-white shadow-inner sm:h-16 sm:w-16 ${
          isRolling ? 'animate-dice-roll' : ''
        }`}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full">
          {pips.map(([cx, cy], idx) => (
            <circle
              key={idx}
              cx={cx}
              cy={cy}
              r={displayVal === 1 ? 13 : 9.5}
              fill={displayVal === 6 || displayVal === 1 ? theme.primary : '#0F172A'}
            />
          ))}
        </svg>
      </div>
      {label && (
        <span className="sr-only">{label}</span>
      )}
    </button>
  );
};

import React from 'react';
import { Home, RotateCcw, Trophy } from 'lucide-react';
import { COLOR_THEMES, Participant } from '../game/types';

interface ResultsModalProps {
  winner: Participant;
  isLocalHumanWinner?: boolean;
  mode: 'bot' | 'online';
  onPlayAgain: () => void;
  onDashboard: () => void;
}

export const ResultsModal: React.FC<ResultsModalProps> = ({
  winner,
  isLocalHumanWinner,
  mode,
  onPlayAgain,
  onDashboard,
}) => {
  const theme = COLOR_THEMES[winner.color];

  const headline =
    mode === 'bot'
      ? isLocalHumanWinner
        ? 'Victory!'
        : `${winner.name} Wins`
      : `${winner.name} Wins!`;

  const subline =
    mode === 'bot'
      ? isLocalHumanWinner
        ? 'All four of your tokens reached home first.'
        : `${winner.name} completed all four tokens before you.`
      : `${theme.label} moved all four tokens into their final home.`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-result-title"
    >
      <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center shadow-2xl">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg"
          style={{ backgroundColor: theme.primary, color: theme.textOnPrimary }}
        >
          <Trophy className="h-8 w-8" />
        </div>

        <h2
          id="match-result-title"
          className="mt-4 font-display text-2xl font-extrabold tracking-tight text-white"
        >
          {headline}
        </h2>
        <p className="mt-1.5 text-sm text-slate-300">{subline}</p>

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-base font-bold text-slate-950 shadow-lg transition hover:bg-amber-300 active:scale-[0.98]"
          >
            <RotateCcw className="h-5 w-5" />
            PLAY AGAIN
          </button>

          <button
            type="button"
            onClick={onDashboard}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-5 py-3 text-base font-semibold text-slate-100 transition hover:bg-slate-700 active:scale-[0.98]"
          >
            <Home className="h-5 w-5" />
            DASHBOARD
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { Bot, Users } from 'lucide-react';
import { FullscreenButton } from './FullscreenButton';

interface DashboardViewProps {
  onSelectOnline: () => void;
  onSelectVsBot: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onSelectOnline,
  onSelectVsBot,
}) => {
  return (
    <div className="flex h-[100dvh] w-full flex-col items-center justify-between overflow-y-auto bg-slate-950 px-5 py-8 text-slate-50">
      <div className="flex w-full max-w-md justify-end">
        <FullscreenButton />
      </div>

      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="h-24 w-24 overflow-hidden rounded-3xl border-2 border-amber-400/50 bg-[#FAF6EC] p-1.5 shadow-2xl">
          <img
            src="/pwa-192x192.png"
            alt="Classic Ludo icon"
            className="h-full w-full rounded-2xl object-contain"
          />
        </div>

        <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight text-white">
          Classic Ludo
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          2–6 players · Real-time online &amp; intelligent bots
        </p>

        <div className="mt-8 flex w-full flex-col gap-3.5">
          <button
            type="button"
            onClick={onSelectOnline}
            className="flex min-h-[58px] w-full items-center justify-center gap-3 rounded-2xl bg-amber-400 px-6 py-4 font-display text-lg font-bold text-slate-950 shadow-lg shadow-amber-400/15 transition hover:bg-amber-300 active:scale-[0.98]"
          >
            <Users className="h-5 w-5" />
            ONLINE MULTIPLAYER
          </button>

          <button
            type="button"
            onClick={onSelectVsBot}
            className="flex min-h-[58px] w-full items-center justify-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-6 py-4 font-display text-lg font-bold text-white shadow-md transition hover:bg-slate-800 active:scale-[0.98]"
          >
            <Bot className="h-5 w-5 text-emerald-400" />
            VS BOT
          </button>
        </div>
      </div>

      <footer className="pb-[env(safe-area-inset-bottom)] text-center text-xs tracking-wide text-slate-400">
        Developed by <span className="font-display font-bold text-amber-400">PRAKALP STUDIOS</span>
      </footer>
    </div>
  );
};

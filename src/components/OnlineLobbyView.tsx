import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  LogIn,
  Play,
  Share2,
  UserPlus,
  Users,
} from 'lucide-react';
import { RoomSnapshot } from '../game/protocol';
import { COLOR_THEMES, PlayerCount, SEAT_COLORS_BY_COUNT } from '../game/types';
import { LudoBoard } from './LudoBoard';

interface OnlineLobbyViewProps {
  snapshot: RoomSnapshot | null;
  mySeat: number | null;
  error: string | null;
  closedReason: string | null;
  pendingAction: boolean;
  onCreateRoom: (capacity: PlayerCount, playerName?: string) => void;
  onJoinRoom: (roomCode: string, playerName?: string) => void;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
  onBackToDashboard: () => void;
  onClearError: () => void;
  onClearClosedReason: () => void;
}

const CAPACITIES: PlayerCount[] = [2, 3, 4, 5, 6];

export const OnlineLobbyView: React.FC<OnlineLobbyViewProps> = ({
  snapshot,
  mySeat,
  error,
  closedReason,
  pendingAction,
  onCreateRoom,
  onJoinRoom,
  onStartMatch,
  onLeaveRoom,
  onBackToDashboard,
  onClearError,
  onClearClosedReason,
}) => {
  const [subMode, setSubMode] = useState<'choose' | 'host' | 'join'>('choose');
  const [selectedCapacity, setSelectedCapacity] = useState<PlayerCount>(4);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopyOrShare = async (code: string, shareNative: boolean) => {
    const shareText = `Join my Classic Ludo match! Room code: ${code}`;
    if (shareNative && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Classic Ludo Room',
          text: shareText,
          url: window.location.origin,
        });
        return;
      } catch {
        // Fallback to clipboard if share dismissed/unsupported
      }
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  // Active Lobby Room Screen (after hosting or joining)
  if (snapshot && snapshot.phase === 'lobby') {
    const isHost = mySeat === snapshot.hostSeat;
    const connectedCount = snapshot.seats.filter((s) => s.connected).length;
    const seatsRemaining = snapshot.capacity - snapshot.seats.length;
    const canStart = isHost && connectedCount === snapshot.capacity;
    const expectedColors = SEAT_COLORS_BY_COUNT[snapshot.capacity];

    return (
      <div className="flex h-[100dvh] w-full flex-col bg-slate-950 text-slate-50">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 px-4">
          <button
            type="button"
            onClick={onLeaveRoom}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Leave Room
          </button>
          <span className="font-display text-sm font-bold text-slate-200">
            {snapshot.capacity}-Player Room
          </span>
          <div className="w-16" />
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto flex max-w-md flex-col gap-4">
            {/* Room Code Card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center">
              <div className="text-xs font-medium text-slate-400">Room Code</div>
              <div className="mt-1 font-mono-code text-3xl font-bold tracking-[0.22em] text-amber-400">
                {snapshot.roomCode}
              </div>

              <div className="mt-3 flex items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleCopyOrShare(snapshot.roomCode, false)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-95"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy Code
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleCopyOrShare(snapshot.roomCode, true)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-300 active:scale-95"
                >
                  <Share2 className="h-4 w-4" />
                  Share
                </button>
              </div>
            </div>

            {snapshot.notice && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-center text-xs font-medium text-amber-300">
                {snapshot.notice}
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-center text-xs font-medium text-rose-300">
                {error}
              </div>
            )}

            {/* Seats Roster */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>
                  Players Joined ({snapshot.seats.length}/{snapshot.capacity})
                </span>
                <span className="text-slate-400">
                  {seatsRemaining === 0
                    ? 'Room full — ready'
                    : `${seatsRemaining} seat${seatsRemaining > 1 ? 's' : ''} remaining`}
                </span>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {expectedColors.map((color, seatIdx) => {
                  const joined = snapshot.seats.find((s) => s.seat === seatIdx);
                  const theme = COLOR_THEMES[color];
                  const isMe = mySeat === seatIdx;

                  return (
                    <div
                      key={seatIdx}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${
                        joined
                          ? 'border-slate-700 bg-slate-800/80 text-white'
                          : 'border-dashed border-slate-800 bg-slate-950/50 text-slate-500'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-4 w-4 rounded-full border border-white/70"
                          style={{ backgroundColor: theme.primary }}
                        />
                        <span className="font-semibold">
                          {joined ? joined.name : `${theme.label} · Open Seat`}
                        </span>
                        {isMe && (
                          <span className="text-xs font-semibold text-amber-400">
                            (You)
                          </span>
                        )}
                      </div>

                      <span className="text-xs font-medium text-slate-400">
                        {joined
                          ? joined.isHost
                            ? 'Host'
                            : joined.connected
                            ? 'Ready'
                            : 'Reconnecting...'
                          : 'Waiting'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Host Start Action or Guest Wait Status */}
            {isHost ? (
              <button
                type="button"
                disabled={!canStart || pendingAction}
                onClick={onStartMatch}
                className={`flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 font-display text-base font-bold transition ${
                  canStart
                    ? 'bg-emerald-500 text-slate-950 shadow-lg hover:bg-emerald-400 active:scale-[0.98]'
                    : 'cursor-not-allowed border border-slate-800 bg-slate-900 text-slate-500'
                }`}
              >
                <Play className="h-5 w-5" />
                {canStart
                  ? 'Start Match'
                  : `Waiting for ${seatsRemaining} more player${seatsRemaining > 1 ? 's' : ''}`}
              </button>
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3.5 text-center text-sm font-medium text-slate-300">
                Waiting for host to start the match...
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-slate-950 text-slate-50">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 px-4">
        <button
          type="button"
          onClick={() => {
            onClearError();
            onClearClosedReason();
            if (subMode === 'choose') {
              onBackToDashboard();
            } else {
              setSubMode('choose');
            }
          }}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <span className="font-display text-base font-bold text-white">
          Online Multiplayer
        </span>
        <div className="w-16" />
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-md flex-col gap-5">
          {closedReason && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center text-sm font-medium text-amber-200">
              {closedReason}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-center text-sm font-medium text-rose-300">
              {error}
            </div>
          )}

          {/* Choose HOST or JOIN */}
          {subMode === 'choose' && (
            <div className="mt-4 flex flex-col gap-4">
              <button
                type="button"
                onClick={() => {
                  onClearError();
                  onClearClosedReason();
                  setSubMode('host');
                }}
                className="flex min-h-[68px] w-full items-center justify-between rounded-2xl bg-amber-400 px-6 py-4 text-left text-slate-950 shadow-lg transition hover:bg-amber-300 active:scale-[0.98]"
              >
                <div>
                  <div className="font-display text-lg font-extrabold">HOST</div>
                  <div className="text-xs font-medium text-slate-800">
                    Choose 2–6 players and create a room code
                  </div>
                </div>
                <UserPlus className="h-6 w-6 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => {
                  onClearError();
                  onClearClosedReason();
                  setSubMode('join');
                }}
                className="flex min-h-[68px] w-full items-center justify-between rounded-2xl border border-slate-700 bg-slate-900 px-6 py-4 text-left text-white shadow-md transition hover:bg-slate-800 active:scale-[0.98]"
              >
                <div>
                  <div className="font-display text-lg font-extrabold">JOIN</div>
                  <div className="text-xs font-medium text-slate-400">
                    Enter a 6-character code from the host
                  </div>
                </div>
                <LogIn className="h-6 w-6 shrink-0 text-amber-400" />
              </button>
            </div>
          )}

          {/* HOST Setup */}
          {subMode === 'host' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400">
                  Select Number of Human Players
                </label>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {CAPACITIES.map((count) => {
                    const active = selectedCapacity === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setSelectedCapacity(count)}
                        className={`flex min-h-[48px] items-center justify-center rounded-xl font-display text-lg font-bold transition ${
                          active
                            ? 'bg-amber-400 text-slate-950 shadow-md'
                            : 'border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        {count}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Board Layout Preview */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                  <span>{selectedCapacity}-Player Board Preview</span>
                  <span>
                    {selectedCapacity <= 4
                      ? 'Classic Cross'
                      : selectedCapacity === 5
                      ? '5-Arm Pentagon'
                      : '6-Arm Hexagon'}
                  </span>
                </div>
                <div className="mx-auto aspect-square w-full max-w-[240px]">
                  <LudoBoard playerCount={selectedCapacity} previewOnly />
                </div>
              </div>

              <button
                type="button"
                disabled={pendingAction}
                onClick={() => onCreateRoom(selectedCapacity)}
                className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-6 py-3.5 font-display text-base font-bold text-slate-950 shadow-lg transition hover:bg-amber-300 active:scale-[0.98] disabled:opacity-60"
              >
                <Users className="h-5 w-5" />
                {pendingAction ? 'Creating Room...' : `Create ${selectedCapacity}-Player Room`}
              </button>
            </div>
          )}

          {/* JOIN Room */}
          {subMode === 'join' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (roomCodeInput.length === 6) {
                  onJoinRoom(roomCodeInput);
                }
              }}
              className="flex flex-col gap-4"
            >
              <div>
                <label
                  htmlFor="room-code-input"
                  className="block text-xs font-semibold text-slate-400"
                >
                  Enter 6-Character Room Code
                </label>
                <input
                  id="room-code-input"
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  maxLength={6}
                  value={roomCodeInput}
                  onChange={(e) => {
                    onClearError();
                    const clean = e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 6);
                    setRoomCodeInput(clean);
                  }}
                  placeholder="A1B2C3"
                  className="mt-2 h-14 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 text-center font-mono-code text-2xl font-bold tracking-[0.28em] text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={roomCodeInput.length !== 6 || pendingAction}
                className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-6 py-3.5 font-display text-base font-bold text-slate-950 shadow-lg transition hover:bg-amber-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogIn className="h-5 w-5" />
                {pendingAction ? 'Joining Room...' : 'Join Room'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

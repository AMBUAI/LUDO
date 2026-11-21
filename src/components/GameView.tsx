import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { chooseBotMove } from '../game/botEngine';
import { getBoardGraph } from '../game/boardGraph';
import {
  advanceTurnAfterBlockedRoll,
  applyDiceRoll,
  applyMove,
  createInitialMatchState,
} from '../game/rulesEngine';
import {
  COLOR_THEMES,
  MatchState,
  Participant,
} from '../game/types';
import { soundEngine } from '../utils/sound';
import { DiceButton } from './DiceButton';
import { FullscreenButton } from './FullscreenButton';
import { LudoBoard } from './LudoBoard';
import { ResultsModal } from './ResultsModal';

interface GameViewProps {
  mode: 'bot' | 'online';
  onlineMatch?: MatchState | null;
  mySeat?: number | null;
  roomCode?: string | null;
  connectionNotice?: string | null;
  connectionState?: 'disconnected' | 'connecting' | 'connected';
  onOnlineRoll?: () => void;
  onOnlineMove?: (tokenId: string) => void;
  onOnlinePlayAgain?: () => void;
  onExitToDashboard: () => void;
}

function secureDiceRoll(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    const limit = Math.floor(0xffffffff / 6) * 6;
    let r = 0;
    do {
      crypto.getRandomValues(arr);
      r = arr[0];
    } while (r >= limit);
    return (r % 6) + 1;
  }
  return Math.floor(Math.random() * 6) + 1;
}

function createBotMatch(): MatchState {
  const participants: Participant[] = [
    {
      seat: 0,
      color: 'red',
      name: 'You',
      isBot: false,
      connected: true,
      forfeited: false,
      isHost: true,
    },
    {
      seat: 1,
      color: 'green',
      name: 'Blaze (Bot)',
      isBot: true,
      botPersonality: 'aggressive',
      connected: true,
      forfeited: false,
      isHost: false,
    },
    {
      seat: 2,
      color: 'yellow',
      name: 'Sage (Bot)',
      isBot: true,
      botPersonality: 'strategic',
      connected: true,
      forfeited: false,
      isHost: false,
    },
    {
      seat: 3,
      color: 'blue',
      name: 'Dash (Bot)',
      isBot: true,
      botPersonality: 'progress',
      connected: true,
      forfeited: false,
      isHost: false,
    },
  ];
  return createInitialMatchState({
    id: `bot-${Date.now()}`,
    mode: 'bot',
    participants,
  });
}

export const GameView: React.FC<GameViewProps> = ({
  mode,
  onlineMatch,
  mySeat,
  roomCode,
  connectionNotice,
  connectionState = 'connected',
  onOnlineRoll,
  onOnlineMove,
  onOnlinePlayAgain,
  onExitToDashboard,
}) => {
  const [localMatch, setLocalMatch] = useState<MatchState>(() => createBotMatch());
  const [muted, setMuted] = useState<boolean>(() => soundEngine.isMuted());
  const [isRollingAnim, setIsRollingAnim] = useState(false);

  const actionLockRef = useRef(false);
  const humanRollTimerRef = useRef<number | null>(null);
  const lastSoundSeqRef = useRef(0);
  const lastSoundMatchIdRef = useRef<string | null>(null);

  const match = mode === 'bot' ? localMatch : onlineMatch;
  const controlledSeat = mode === 'bot' ? 0 : (mySeat ?? null);

  const clearHumanRollTimer = useCallback(() => {
    if (humanRollTimerRef.current !== null) {
      window.clearTimeout(humanRollTimerRef.current);
      humanRollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearHumanRollTimer();
    };
  }, [clearHumanRollTimer]);

  // Trigger audio feedback cleanly on state transitions
  useEffect(() => {
    if (!match) return;
    if (lastSoundMatchIdRef.current !== match.id) {
      lastSoundMatchIdRef.current = match.id;
      lastSoundSeqRef.current = 0;
    }
    if (match.seq <= lastSoundSeqRef.current) return;
    lastSoundSeqRef.current = match.seq;
    actionLockRef.current = false;
    setIsRollingAnim(false);

    const ev = match.lastEvent;
    if (!ev) return;
    if (ev.type === 'win') {
      soundEngine.playWin();
    } else if (ev.type === 'capture') {
      soundEngine.playCapture();
    } else if (ev.type === 'home') {
      soundEngine.playHome();
    }
  }, [match]);

  // VS BOT: Advance turn cleanly after any blocked roll or triple-6 (human or bot)
  useEffect(() => {
    if (mode !== 'bot') return;
    if (localMatch.turnPhase !== 'waiting_move' || localMatch.legalMoves.length > 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setLocalMatch((curr) => {
        if (curr.turnPhase !== 'waiting_move' || curr.legalMoves.length > 0) {
          return curr;
        }
        return advanceTurnAfterBlockedRoll(curr);
      });
    }, 850);

    return () => {
      window.clearTimeout(timer);
    };
  }, [mode, localMatch.id, localMatch.seq, localMatch.turnPhase, localMatch.legalMoves.length]);

  // VS BOT: Automated bot roll & move loop
  useEffect(() => {
    if (mode !== 'bot' || localMatch.turnPhase === 'finished') return;

    const currentPlayer = localMatch.participants.find(
      (p) => p.seat === localMatch.currentTurnSeat
    );
    if (!currentPlayer?.isBot) return;

    if (localMatch.turnPhase === 'waiting_roll') {
      let tRollResult: number | null = null;
      const tStartAnim = window.setTimeout(() => {
        setIsRollingAnim(true);
        soundEngine.playDiceRoll();
        tRollResult = window.setTimeout(() => {
          setIsRollingAnim(false);
          const dice = secureDiceRoll();
          setLocalMatch((prev) => {
            if (
              prev.turnPhase !== 'waiting_roll' ||
              prev.currentTurnSeat !== currentPlayer.seat
            ) {
              return prev;
            }
            return applyDiceRoll(prev, currentPlayer.seat, dice).nextState;
          });
        }, 300);
      }, 420);

      return () => {
        window.clearTimeout(tStartAnim);
        if (tRollResult !== null) window.clearTimeout(tRollResult);
      };
    }

    if (localMatch.turnPhase === 'waiting_move' && localMatch.legalMoves.length > 0) {
      const tMove = window.setTimeout(() => {
        setLocalMatch((prev) => {
          if (
            prev.turnPhase !== 'waiting_move' ||
            prev.currentTurnSeat !== currentPlayer.seat ||
            prev.legalMoves.length === 0
          ) {
            return prev;
          }
          const chosen = chooseBotMove(
            prev,
            currentPlayer.seat,
            currentPlayer.botPersonality || 'strategic'
          );
          if (!chosen) return prev;
          return applyMove(prev, currentPlayer.seat, chosen.tokenId).nextState;
        });
      }, 520);

      return () => {
        window.clearTimeout(tMove);
      };
    }
  }, [
    mode,
    localMatch.id,
    localMatch.seq,
    localMatch.currentTurnSeat,
    localMatch.turnPhase,
    localMatch.legalMoves.length,
  ]);

  const handleRoll = useCallback(() => {
    if (!match || actionLockRef.current || isRollingAnim) return;
    if (controlledSeat === null || match.currentTurnSeat !== controlledSeat) return;
    if (match.turnPhase !== 'waiting_roll') return;

    actionLockRef.current = true;
    setIsRollingAnim(true);
    soundEngine.playDiceRoll();

    if (mode === 'online') {
      window.setTimeout(() => {
        onOnlineRoll?.();
      }, 240);
      window.setTimeout(() => {
        actionLockRef.current = false;
        setIsRollingAnim(false);
      }, 1600);
      return;
    }

    clearHumanRollTimer();
    humanRollTimerRef.current = window.setTimeout(() => {
      humanRollTimerRef.current = null;
      setIsRollingAnim(false);
      actionLockRef.current = false;
      const dice = secureDiceRoll();
      setLocalMatch((prev) => {
        if (prev.turnPhase !== 'waiting_roll' || prev.currentTurnSeat !== 0) return prev;
        return applyDiceRoll(prev, 0, dice).nextState;
      });
    }, 280);
  }, [match, isRollingAnim, controlledSeat, mode, onOnlineRoll, clearHumanRollTimer]);

  const handleSelectToken = useCallback(
    (tokenId: string) => {
      if (!match || actionLockRef.current) return;
      if (controlledSeat === null || match.currentTurnSeat !== controlledSeat) return;
      if (match.turnPhase !== 'waiting_move') return;

      actionLockRef.current = true;
      if (mode === 'online') {
        onOnlineMove?.(tokenId);
        window.setTimeout(() => {
          actionLockRef.current = false;
        }, 800);
        return;
      }

      setLocalMatch((prev) => {
        try {
          return applyMove(prev, 0, tokenId).nextState;
        } catch {
          return prev;
        } finally {
          actionLockRef.current = false;
        }
      });
    },
    [match, controlledSeat, mode, onOnlineMove]
  );

  // Auto-execute when human player has exactly 1 legal move
  useEffect(() => {
    if (!match || controlledSeat === null) return;
    if (
      match.currentTurnSeat === controlledSeat &&
      match.turnPhase === 'waiting_move' &&
      match.legalMoves.length === 1
    ) {
      const onlyTokenId = match.legalMoves[0].tokenId;
      const timer = window.setTimeout(() => {
        handleSelectToken(onlyTokenId);
      }, 340);
      return () => window.clearTimeout(timer);
    }
  }, [match, controlledSeat, handleSelectToken]);

  const handlePlayAgain = useCallback(() => {
    clearHumanRollTimer();
    actionLockRef.current = false;
    setIsRollingAnim(false);
    if (mode === 'online') {
      onOnlinePlayAgain?.();
    } else {
      lastSoundSeqRef.current = 0;
      setLocalMatch(createBotMatch());
    }
  }, [clearHumanRollTimer, mode, onOnlinePlayAgain]);

  const toggleMute = () => {
    const next = !muted;
    soundEngine.setMuted(next);
    setMuted(next);
  };

  const progressMap = useMemo(() => {
    if (!match) return {};
    const graph = getBoardGraph(match.playerCount);
    const result: Record<number, number> = {};
    for (const p of match.participants) {
      let finishedCount = 0;
      for (let i = 0; i < 4; i++) {
        const t = match.tokens[`t:${p.seat}:${i}`];
        if (t && t.progress >= graph.stepsToFinish) finishedCount++;
      }
      result[p.seat] = finishedCount;
    }
    return result;
  }, [match]);

  if (!match) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-950 text-slate-300">
        Loading match...
      </div>
    );
  }

  const currentParticipant =
    match.participants.find((p) => p.seat === match.currentTurnSeat) ||
    match.participants[0];
  const currentTheme = COLOR_THEMES[currentParticipant.color];

  const isMyTurn =
    controlledSeat !== null &&
    match.currentTurnSeat === controlledSeat &&
    match.turnPhase !== 'finished';

  const canRoll = isMyTurn && match.turnPhase === 'waiting_roll';
  const canPickToken = isMyTurn && match.turnPhase === 'waiting_move';

  const winnerParticipant =
    match.winnerSeat !== null
      ? match.participants.find((p) => p.seat === match.winnerSeat) ?? null
      : null;

  const statusText = canRoll
    ? 'Tap dice to roll'
    : canPickToken
    ? match.legalMoves.length === 1
      ? `Rolled ${match.diceValue} — moving...`
      : `Rolled ${match.diceValue} — tap a highlighted token`
    : match.lastEvent?.message || `${currentParticipant.name}'s turn`;

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-950 text-slate-50 landscape:flex-row">
      {/* Compact Top Bar (Portrait) */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-900/80 px-3 landscape:hidden">
        <button
          type="button"
          onClick={onExitToDashboard}
          className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Exit</span>
        </button>

        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <span>{mode === 'bot' ? 'VS Bot' : `Room ${roomCode ?? ''}`}</span>
          {mode === 'online' && connectionState !== 'connected' && (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <WifiOff className="h-3.5 w-3.5" />
              Reconnecting
            </span>
          )}
        </div>

        <div className="flex items-center">
          <FullscreenButton compact />
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-300 transition hover:bg-slate-800 active:scale-95"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Portrait Player Seats Strip */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-2.5 py-1.5 landscape:hidden">
        {match.participants.map((p) => {
          const theme = COLOR_THEMES[p.color];
          const isTurn = p.seat === match.currentTurnSeat && match.turnPhase !== 'finished';
          const isMe = p.seat === controlledSeat;
          return (
            <div
              key={p.seat}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border px-2 py-1 text-xs transition ${
                isTurn
                  ? 'border-amber-400 bg-slate-800/95 shadow-sm'
                  : 'border-slate-800 bg-slate-900/70 opacity-80'
              } ${p.forfeited ? 'opacity-40' : ''}`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-white/60"
                style={{ backgroundColor: theme.primary }}
              />
              <span className="truncate font-semibold text-slate-100">
                {p.name}
                {isMe && mode === 'online' ? ' (You)' : ''}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-[11px] font-bold text-slate-400">
                {progressMap[p.seat] ?? 0}/4
              </span>
            </div>
          );
        })}
      </div>

      {/* Main Board Canvas Area */}
      <main className="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:p-3">
        {connectionNotice && (
          <div className="pointer-events-none absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-amber-500/40 bg-slate-900/95 px-3 py-1 text-xs font-medium text-amber-300 shadow-lg">
            {connectionNotice}
          </div>
        )}

        <div className="aspect-square h-full max-h-full w-auto max-w-full flex items-center justify-center">
          <div className="aspect-square w-full max-h-full max-w-[min(94vw,calc(100dvh-195px))] landscape:max-w-[min(62vw,92dvh)]">
            <LudoBoard
              playerCount={match.playerCount}
              match={match}
              interactiveSeat={controlledSeat}
              onSelectToken={handleSelectToken}
            />
          </div>
        </div>
      </main>

      {/* Portrait Bottom Thumb Control Dock */}
      <footer className="shrink-0 border-t border-slate-800/80 bg-slate-900/95 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] landscape:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-white/70"
                style={{ backgroundColor: currentTheme.primary }}
              />
              <span className="truncate font-display text-sm font-bold text-white">
                {isMyTurn ? 'Your Turn' : `${currentParticipant.name}'s Turn`}
              </span>
              {match.diceValue !== null && (
                <span className="tabular-nums text-xs font-bold text-amber-400">
                  · Rolled {match.diceValue}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-300">{statusText}</p>
          </div>

          <DiceButton
            value={match.diceValue}
            color={currentParticipant.color}
            canRoll={canRoll}
            isRolling={isRollingAnim}
            onRoll={handleRoll}
          />
        </div>
      </footer>

      {/* Landscape Side Control Panel */}
      <aside className="hidden w-72 shrink-0 flex-col justify-between border-l border-slate-800 bg-slate-900/95 p-3 landscape:flex lg:w-80">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onExitToDashboard}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Exit
          </button>

          <span className="text-xs font-semibold text-slate-300">
            {mode === 'bot' ? 'VS Bot' : `Room ${roomCode ?? ''}`}
          </span>

          <div className="flex items-center">
            <FullscreenButton compact />
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute sound' : 'Mute sound'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="my-2 flex flex-1 flex-col justify-center gap-1.5 overflow-y-auto">
          {match.participants.map((p) => {
            const theme = COLOR_THEMES[p.color];
            const isTurn = p.seat === match.currentTurnSeat && match.turnPhase !== 'finished';
            const isMe = p.seat === controlledSeat;
            return (
              <div
                key={p.seat}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                  isTurn
                    ? 'border-amber-400 bg-slate-800'
                    : 'border-slate-800 bg-slate-950/60 opacity-80'
                } ${p.forfeited ? 'opacity-40' : ''}`}
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/60"
                  style={{ backgroundColor: theme.primary }}
                />
                <span className="truncate font-semibold text-slate-100">
                  {p.name}
                  {isMe && mode === 'online' ? ' (You)' : ''}
                </span>
                {!p.connected && !p.isBot && !p.forfeited && (
                  <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                )}
                <span className="ml-auto tabular-nums font-bold text-slate-400">
                  {progressMap[p.seat] ?? 0}/4
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm font-bold text-white">
              {isMyTurn ? 'Your Turn' : currentParticipant.name}
            </div>
            <p className="mt-0.5 text-xs text-slate-300">{statusText}</p>
          </div>
          <DiceButton
            value={match.diceValue}
            color={currentParticipant.color}
            canRoll={canRoll}
            isRolling={isRollingAnim}
            onRoll={handleRoll}
          />
        </div>
      </aside>

      {/* Single-Match Results Screen */}
      {match.turnPhase === 'finished' && winnerParticipant && (
        <ResultsModal
          winner={winnerParticipant}
          isLocalHumanWinner={mode === 'bot' ? winnerParticipant.seat === 0 : winnerParticipant.seat === controlledSeat}
          mode={mode}
          onPlayAgain={handlePlayAgain}
          onDashboard={onExitToDashboard}
        />
      )}
    </div>
  );
};

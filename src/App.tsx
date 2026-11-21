import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { DashboardView } from './components/DashboardView';
import { GameView } from './components/GameView';
import { OnlineLobbyView } from './components/OnlineLobbyView';
import { useMultiplayerSocket } from './hooks/useMultiplayerSocket';
import { useOnlineStatus } from './hooks/useOnlineStatus';

type ScreenMode = 'dashboard' | 'online' | 'vs_bot';

export default function App() {
  const [screen, setScreen] = useState<ScreenMode>('dashboard');
  const isOnline = useOnlineStatus();
  const mp = useMultiplayerSocket();

  // Auto-reconnect into an active room if returning after mobile reload/background
  useEffect(() => {
    if (mp.hasStoredRoom && !mp.snapshot) {
      mp.connect();
      setScreen('online');
    }
  }, [mp.hasStoredRoom, mp.snapshot, mp.connect]);

  // If online match is active or finished, show GameView
  const inActiveOnlineMatch =
    screen === 'online' &&
    mp.snapshot &&
    (mp.snapshot.phase === 'playing' || mp.snapshot.phase === 'finished') &&
    mp.snapshot.match;

  const handleExitToDashboard = () => {
    if (screen === 'online') {
      mp.leaveRoom();
    }
    setScreen('dashboard');
  };

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-slate-950">
      {!isOnline && (
        <div className="fixed top-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-500/40 bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-amber-300 shadow-lg">
          <WifiOff className="h-3.5 w-3.5" />
          <span>Offline · VS Bot remains playable</span>
        </div>
      )}

      {screen === 'dashboard' && (
        <DashboardView
          onSelectOnline={() => setScreen('online')}
          onSelectVsBot={() => setScreen('vs_bot')}
        />
      )}

      {screen === 'vs_bot' && (
        <GameView
          mode="bot"
          onExitToDashboard={handleExitToDashboard}
        />
      )}

      {screen === 'online' && !inActiveOnlineMatch && (
        <OnlineLobbyView
          snapshot={mp.snapshot}
          mySeat={mp.mySeat}
          error={mp.error}
          closedReason={mp.closedReason}
          pendingAction={mp.pendingAction}
          onCreateRoom={mp.createRoom}
          onJoinRoom={mp.joinRoom}
          onStartMatch={mp.startMatch}
          onLeaveRoom={mp.leaveRoom}
          onBackToDashboard={handleExitToDashboard}
          onClearError={mp.clearError}
          onClearClosedReason={mp.clearClosedReason}
        />
      )}

      {inActiveOnlineMatch && mp.snapshot && (
        <GameView
          mode="online"
          onlineMatch={mp.snapshot.match}
          mySeat={mp.mySeat}
          roomCode={mp.snapshot.roomCode}
          connectionNotice={mp.snapshot.notice}
          connectionState={mp.connectionState}
          onOnlineRoll={mp.rollDice}
          onOnlineMove={mp.moveToken}
          onOnlinePlayAgain={mp.restartMatch}
          onExitToDashboard={handleExitToDashboard}
        />
      )}
    </div>
  );
}

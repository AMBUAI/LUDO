import { useCallback, useEffect, useRef, useState } from 'react';
import { ClientMessage, RoomSnapshot, ServerMessage } from '../game/protocol';
import { PlayerCount } from '../game/types';

const CLIENT_ID_KEY = 'ludo_client_id';
const ROOM_CODE_KEY = 'ludo_active_room';

function getOrCreateClientId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function makeActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useMultiplayerSocket() {
  const clientIdRef = useRef<string>(getOrCreateClientId());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const lastSeqRef = useRef<number>(0);
  const activeRoomRef = useRef<string | null>(
    typeof window !== 'undefined' ? sessionStorage.getItem(ROOM_CODE_KEY) : null
  );

  const [connectionState, setConnectionState] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<boolean>(false);

  const clearTimers = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  };

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    const existing = wsRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN ||
        existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setConnectionState('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState('connected');
      setError(null);

      // Reconnect automatically if returning to an active room after backgrounding/reload
      if (activeRoomRef.current) {
        ws.send(
          JSON.stringify({
            type: 'room:reconnect',
            clientId: clientIdRef.current,
            roomCode: activeRoomRef.current,
          } satisfies ClientMessage)
        );
      }

      if (pingTimerRef.current !== null) window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' } satisfies ClientMessage));
        }
      }, 15_000);
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'pong') return;

      if (msg.type === 'error') {
        setPendingAction(false);
        setError(msg.message);
        if (
          msg.code === 'ROOM_EXPIRED' ||
          msg.code === 'ROOM_NOT_FOUND'
        ) {
          activeRoomRef.current = null;
          sessionStorage.removeItem(ROOM_CODE_KEY);
        }
        return;
      }

      if (msg.type === 'room:joined') {
        setPendingAction(false);
        setError(null);
        setClosedReason(null);
        setMySeat(msg.seat);
        activeRoomRef.current = msg.roomCode;
        sessionStorage.setItem(ROOM_CODE_KEY, msg.roomCode);
        lastSeqRef.current = msg.snapshot.seq;
        setSnapshot(msg.snapshot);
        return;
      }

      if (msg.type === 'room:state') {
        setPendingAction(false);
        // Guard against out-of-order stale messages
        if (msg.snapshot.seq < lastSeqRef.current) return;
        lastSeqRef.current = msg.snapshot.seq;
        setSnapshot(msg.snapshot);
        return;
      }

      if (msg.type === 'room:closed') {
        setPendingAction(false);
        activeRoomRef.current = null;
        sessionStorage.removeItem(ROOM_CODE_KEY);
        setSnapshot(null);
        setMySeat(null);
        setClosedReason(msg.reason);
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      setConnectionState('disconnected');
      if (pingTimerRef.current !== null) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      // Attempt reconnection if currently inside a room
      if (activeRoomRef.current) {
        reconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, 1200);
      }
    };
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && activeRoomRef.current) {
        connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimers();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendMessage = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connect();
        const waitOpen = window.setInterval(() => {
          const current = wsRef.current;
          if (current && current.readyState === WebSocket.OPEN) {
            window.clearInterval(waitOpen);
            current.send(JSON.stringify(msg));
          }
        }, 100);
        window.setTimeout(() => window.clearInterval(waitOpen), 4000);
        return;
      }
      ws.send(JSON.stringify(msg));
    },
    [connect]
  );

  const createRoom = useCallback(
    (capacity: PlayerCount, playerName?: string) => {
      setError(null);
      setClosedReason(null);
      setPendingAction(true);
      connect();
      sendMessage({
        type: 'room:create',
        actionId: makeActionId(),
        clientId: clientIdRef.current,
        capacity,
        playerName,
      });
    },
    [connect, sendMessage]
  );

  const joinRoom = useCallback(
    (roomCode: string, playerName?: string) => {
      setError(null);
      setClosedReason(null);
      setPendingAction(true);
      connect();
      sendMessage({
        type: 'room:join',
        actionId: makeActionId(),
        clientId: clientIdRef.current,
        roomCode: roomCode.trim().toUpperCase(),
        playerName,
      });
    },
    [connect, sendMessage]
  );

  const startMatch = useCallback(() => {
    if (!snapshot) return;
    setError(null);
    setPendingAction(true);
    sendMessage({
      type: 'room:start',
      actionId: makeActionId(),
      clientId: clientIdRef.current,
      roomCode: snapshot.roomCode,
    });
  }, [sendMessage, snapshot]);

  const rollDice = useCallback(() => {
    if (!snapshot) return;
    sendMessage({
      type: 'match:roll',
      actionId: makeActionId(),
      clientId: clientIdRef.current,
      roomCode: snapshot.roomCode,
    });
  }, [sendMessage, snapshot]);

  const moveToken = useCallback(
    (tokenId: string) => {
      if (!snapshot) return;
      sendMessage({
        type: 'match:move',
        actionId: makeActionId(),
        clientId: clientIdRef.current,
        roomCode: snapshot.roomCode,
        tokenId,
      });
    },
    [sendMessage, snapshot]
  );

  const restartMatch = useCallback(() => {
    if (!snapshot) return;
    sendMessage({
      type: 'match:restart',
      actionId: makeActionId(),
      clientId: clientIdRef.current,
      roomCode: snapshot.roomCode,
    });
  }, [sendMessage, snapshot]);

  const leaveRoom = useCallback(() => {
    const code = snapshot?.roomCode || activeRoomRef.current;
    if (code && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'room:leave',
          actionId: makeActionId(),
          clientId: clientIdRef.current,
          roomCode: code,
        } satisfies ClientMessage)
      );
    }
    activeRoomRef.current = null;
    sessionStorage.removeItem(ROOM_CODE_KEY);
    lastSeqRef.current = 0;
    setSnapshot(null);
    setMySeat(null);
    setError(null);
    setClosedReason(null);
    setPendingAction(false);
  }, [snapshot]);

  const clearError = useCallback(() => setError(null), []);
  const clearClosedReason = useCallback(() => setClosedReason(null), []);

  return {
    clientId: clientIdRef.current,
    connectionState,
    snapshot,
    mySeat,
    error,
    closedReason,
    pendingAction,
    hasStoredRoom: Boolean(activeRoomRef.current),
    connect,
    createRoom,
    joinRoom,
    startMatch,
    rollDice,
    moveToken,
    restartMatch,
    leaveRoom,
    clearError,
    clearClosedReason,
  };
}

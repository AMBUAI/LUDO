import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type ClientMessage,
  type LobbySeat,
  type RoomPhase,
  type RoomSnapshot,
  type ServerMessage,
} from './src/game/protocol.ts';
import {
  advanceTurnAfterBlockedRoll,
  applyDiceRoll,
  applyMove,
  createInitialMatchState,
  forfeitSeat,
} from './src/game/rulesEngine.ts';
import {
  COLOR_THEMES,
  type MatchState,
  type Participant,
  type PlayerCount,
  SEAT_COLORS_BY_COUNT,
} from './src/game/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_IDLE_MS = 15 * 60 * 1000; // 15 min abandoned room expiry
const RECONNECT_GRACE_MS = 45 * 1000; // 45s reconnection window during active match
const LOBBY_HOST_GRACE_MS = 20 * 1000; // 20s grace if host drops momentarily in lobby

interface RoomSeatRecord {
  seat: number;
  clientId: string;
  name: string;
  connected: boolean;
  forfeited: boolean;
  graceTimer: NodeJS.Timeout | null;
}

interface RoomRecord {
  roomCode: string;
  capacity: PlayerCount;
  phase: RoomPhase;
  hostSeat: number;
  seats: Map<number, RoomSeatRecord>;
  sockets: Map<string, WebSocket>; // clientId -> active socket
  match: MatchState | null;
  notice: string | null;
  seq: number;
  createdAt: number;
  lastActivityAt: number;
  processedActionIds: string[];
  blockedRollTimer: NodeJS.Timeout | null;
}

const rooms = new Map<string, RoomRecord>();
const socketMeta = new Map<WebSocket, { clientId?: string; roomCode?: string; isAlive: boolean }>();

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function normalizeRoomCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function sanitizeName(raw: string | undefined, fallback: string): string {
  const cleaned = String(raw || '').trim().slice(0, 18);
  return cleaned || fallback;
}

function sendToSocket(ws: WebSocket | undefined, msg: ServerMessage) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function buildSnapshot(room: RoomRecord): RoomSnapshot {
  const colors = SEAT_COLORS_BY_COUNT[room.capacity];
  const seats: LobbySeat[] = [];

  for (let s = 0; s < room.capacity; s++) {
    const rec = room.seats.get(s);
    const color = colors[s];
    if (rec) {
      seats.push({
        seat: s,
        color,
        name: rec.name,
        connected: rec.connected,
        isHost: s === room.hostSeat,
        forfeited: rec.forfeited,
      });
    }
  }

  return {
    roomCode: room.roomCode,
    capacity: room.capacity,
    phase: room.phase,
    hostSeat: room.hostSeat,
    seats,
    match: room.match,
    notice: room.notice,
    serverTime: Date.now(),
    seq: room.seq,
  };
}

function broadcastRoomState(room: RoomRecord) {
  room.seq += 1;
  const snapshot = buildSnapshot(room);
  for (const ws of room.sockets.values()) {
    sendToSocket(ws, { type: 'room:state', snapshot });
  }
}

function closeRoom(room: RoomRecord, reason: string) {
  if (room.blockedRollTimer) {
    clearTimeout(room.blockedRollTimer);
    room.blockedRollTimer = null;
  }
  for (const seatRec of room.seats.values()) {
    if (seatRec.graceTimer) {
      clearTimeout(seatRec.graceTimer);
      seatRec.graceTimer = null;
    }
  }
  room.phase = 'closed';
  for (const ws of room.sockets.values()) {
    sendToSocket(ws, {
      type: 'room:closed',
      roomCode: room.roomCode,
      reason,
    });
  }
  rooms.delete(room.roomCode);
}

function recordActionIfNew(room: RoomRecord, actionId: string): boolean {
  if (!actionId) return true;
  if (room.processedActionIds.includes(actionId)) {
    return false;
  }
  room.processedActionIds.push(actionId);
  if (room.processedActionIds.length > 100) {
    room.processedActionIds.shift();
  }
  return true;
}

function findSeatByClientId(room: RoomRecord, clientId: string): RoomSeatRecord | undefined {
  for (const rec of room.seats.values()) {
    if (rec.clientId === clientId) return rec;
  }
  return undefined;
}

function syncParticipantsIntoMatch(room: RoomRecord) {
  if (!room.match) return;
  const colors = SEAT_COLORS_BY_COUNT[room.capacity];
  room.match = {
    ...room.match,
    participants: room.match.participants.map((p) => {
      const rec = room.seats.get(p.seat);
      return {
        ...p,
        color: colors[p.seat],
        connected: rec ? rec.connected : false,
        forfeited: rec ? rec.forfeited : true,
        isHost: p.seat === room.hostSeat,
      };
    }),
  };
}

function startAuthoritativeMatch(room: RoomRecord) {
  if (room.blockedRollTimer) {
    clearTimeout(room.blockedRollTimer);
    room.blockedRollTimer = null;
  }
  const colors = SEAT_COLORS_BY_COUNT[room.capacity];
  const participants: Participant[] = [];

  for (let s = 0; s < room.capacity; s++) {
    const rec = room.seats.get(s);
    if (!rec) continue;
    rec.forfeited = false;
    participants.push({
      seat: s,
      color: colors[s],
      name: rec.name,
      isBot: false,
      connected: rec.connected,
      forfeited: false,
      isHost: s === room.hostSeat,
    });
  }

  room.phase = 'playing';
  room.notice = null;
  room.match = createInitialMatchState({
    id: `${room.roomCode}-${Date.now()}`,
    mode: 'online',
    participants,
  });
  room.lastActivityAt = Date.now();
}

function handleClientDisconnect(ws: WebSocket) {
  const meta = socketMeta.get(ws);
  socketMeta.delete(ws);
  if (!meta?.clientId || !meta?.roomCode) return;

  const room = rooms.get(meta.roomCode);
  if (!room) return;

  // Ignore if this clientId already replaced its socket with a newer connection
  if (room.sockets.get(meta.clientId) !== ws) return;
  room.sockets.delete(meta.clientId);

  const seatRec = findSeatByClientId(room, meta.clientId);
  if (!seatRec) return;

  seatRec.connected = false;
  const colorName = COLOR_THEMES[SEAT_COLORS_BY_COUNT[room.capacity][seatRec.seat]].label;

  if (room.phase === 'lobby') {
    if (seatRec.seat === room.hostSeat) {
      room.notice = `Host (${colorName}) disconnected — waiting briefly to reconnect...`;
      syncParticipantsIntoMatch(room);
      broadcastRoomState(room);

      if (seatRec.graceTimer) clearTimeout(seatRec.graceTimer);
      seatRec.graceTimer = setTimeout(() => {
        if (!seatRec.connected && rooms.has(room.roomCode) && room.phase === 'lobby') {
          closeRoom(room, 'Host left the room before the match started.');
        }
      }, LOBBY_HOST_GRACE_MS);
    } else {
      room.seats.delete(seatRec.seat);
      room.notice = `${seatRec.name} left the lobby.`;
      broadcastRoomState(room);
    }
    return;
  }

  // During active match or finished match: preserve seat during 45s reconnection grace period
  if (room.phase === 'playing' || room.phase === 'finished') {
    room.notice = `${seatRec.name} disconnected. Waiting up to 45s to reconnect...`;
    syncParticipantsIntoMatch(room);
    broadcastRoomState(room);

    if (seatRec.graceTimer) clearTimeout(seatRec.graceTimer);
    seatRec.graceTimer = setTimeout(() => {
      if (seatRec.connected || !rooms.has(room.roomCode)) return;

      if (room.phase === 'playing' && room.match) {
        seatRec.forfeited = true;

        // Transfer host if host timed out
        if (seatRec.seat === room.hostSeat) {
          const nextHost = Array.from(room.seats.values()).find(
            (r) => !r.forfeited && r.connected
          );
          if (nextHost) room.hostSeat = nextHost.seat;
        }

        room.match = forfeitSeat(room.match, seatRec.seat);
        syncParticipantsIntoMatch(room);

        if (room.match.turnPhase === 'finished') {
          room.phase = 'finished';
        }
        room.notice = `${seatRec.name} did not reconnect and forfeited.`;
        broadcastRoomState(room);
      } else {
        // Finished match: remove disconnected player cleanly, transfer host if needed
        if (seatRec.seat === room.hostSeat) {
          const nextHost = Array.from(room.seats.values()).find((r) => r.connected);
          if (nextHost) room.hostSeat = nextHost.seat;
        }
        if (room.sockets.size === 0) {
          closeRoom(room, 'All players left.');
        } else {
          broadcastRoomState(room);
        }
      }
    }, RECONNECT_GRACE_MS);
  }
}

function handleMessage(ws: WebSocket, raw: string) {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }

  if (msg.type === 'ping') {
    sendToSocket(ws, { type: 'pong' });
    return;
  }

  switch (msg.type) {
    case 'room:create': {
      const cap = msg.capacity;
      if (![2, 3, 4, 5, 6].includes(cap)) {
        sendToSocket(ws, {
          type: 'error',
          code: 'INVALID_ACTION',
          message: 'Player capacity must be between 2 and 6.',
        });
        return;
      }

      const roomCode = generateRoomCode();
      const colors = SEAT_COLORS_BY_COUNT[cap];
      const hostName = sanitizeName(msg.playerName, COLOR_THEMES[colors[0]].label);

      const room: RoomRecord = {
        roomCode,
        capacity: cap,
        phase: 'lobby',
        hostSeat: 0,
        seats: new Map(),
        sockets: new Map(),
        match: null,
        notice: null,
        seq: 0,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        processedActionIds: [],
        blockedRollTimer: null,
      };

      room.seats.set(0, {
        seat: 0,
        clientId: msg.clientId,
        name: hostName,
        connected: true,
        forfeited: false,
        graceTimer: null,
      });
      room.sockets.set(msg.clientId, ws);
      rooms.set(roomCode, room);

      socketMeta.set(ws, { clientId: msg.clientId, roomCode, isAlive: true });
      room.seq += 1;

      sendToSocket(ws, {
        type: 'room:joined',
        roomCode,
        seat: 0,
        snapshot: buildSnapshot(room),
      });
      break;
    }

    case 'room:join': {
      const code = normalizeRoomCode(msg.roomCode);
      if (code.length !== 6) {
        sendToSocket(ws, {
          type: 'error',
          code: 'INVALID_CODE',
          message: 'Enter a valid 6-character alphanumeric room code.',
        });
        return;
      }

      const room = rooms.get(code);
      if (!room || room.phase === 'closed') {
        sendToSocket(ws, {
          type: 'error',
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found or has expired.',
        });
        return;
      }

      room.lastActivityAt = Date.now();

      // Reconnecting existing participant
      const existing = findSeatByClientId(room, msg.clientId);
      if (existing) {
        if (existing.forfeited) {
          sendToSocket(ws, {
            type: 'error',
            code: 'ALREADY_STARTED',
            message: 'Your seat was forfeited after disconnecting.',
          });
          return;
        }
        if (existing.graceTimer) {
          clearTimeout(existing.graceTimer);
          existing.graceTimer = null;
        }
        existing.connected = true;
        room.sockets.set(msg.clientId, ws);
        socketMeta.set(ws, { clientId: msg.clientId, roomCode: code, isAlive: true });
        room.notice = `${existing.name} reconnected.`;
        syncParticipantsIntoMatch(room);
        sendToSocket(ws, {
          type: 'room:joined',
          roomCode: code,
          seat: existing.seat,
          snapshot: buildSnapshot(room),
        });
        broadcastRoomState(room);
        return;
      }

      if (room.phase !== 'lobby') {
        sendToSocket(ws, {
          type: 'error',
          code: 'ALREADY_STARTED',
          message: 'This match has already started.',
        });
        return;
      }

      // Find lowest open seat
      let openSeat = -1;
      for (let s = 0; s < room.capacity; s++) {
        if (!room.seats.has(s)) {
          openSeat = s;
          break;
        }
      }

      if (openSeat === -1) {
        sendToSocket(ws, {
          type: 'error',
          code: 'ROOM_FULL',
          message: `Room ${code} is already full (${room.capacity}/${room.capacity} players).`,
        });
        return;
      }

      const colors = SEAT_COLORS_BY_COUNT[room.capacity];
      const playerName = sanitizeName(msg.playerName, COLOR_THEMES[colors[openSeat]].label);

      room.seats.set(openSeat, {
        seat: openSeat,
        clientId: msg.clientId,
        name: playerName,
        connected: true,
        forfeited: false,
        graceTimer: null,
      });
      room.sockets.set(msg.clientId, ws);
      socketMeta.set(ws, { clientId: msg.clientId, roomCode: code, isAlive: true });
      room.notice = `${playerName} joined the room.`;

      sendToSocket(ws, {
        type: 'room:joined',
        roomCode: code,
        seat: openSeat,
        snapshot: buildSnapshot(room),
      });
      broadcastRoomState(room);
      break;
    }

    case 'room:reconnect': {
      const code = normalizeRoomCode(msg.roomCode);
      const room = rooms.get(code);
      if (!room || room.phase === 'closed') {
        sendToSocket(ws, {
          type: 'error',
          code: 'ROOM_EXPIRED',
          message: 'Room expired or closed.',
        });
        return;
      }

      const existing = findSeatByClientId(room, msg.clientId);
      if (!existing || existing.forfeited) {
        sendToSocket(ws, {
          type: 'error',
          code: 'ROOM_NOT_FOUND',
          message: 'Previous seat is no longer active.',
        });
        return;
      }

      if (existing.graceTimer) {
        clearTimeout(existing.graceTimer);
        existing.graceTimer = null;
      }
      existing.connected = true;
      room.sockets.set(msg.clientId, ws);
      socketMeta.set(ws, { clientId: msg.clientId, roomCode: code, isAlive: true });
      room.lastActivityAt = Date.now();
      room.notice = `${existing.name} reconnected.`;
      syncParticipantsIntoMatch(room);

      sendToSocket(ws, {
        type: 'room:joined',
        roomCode: code,
        seat: existing.seat,
        snapshot: buildSnapshot(room),
      });
      broadcastRoomState(room);
      break;
    }

    case 'room:start': {
      const code = normalizeRoomCode(msg.roomCode);
      const room = rooms.get(code);
      if (!room) return;
      if (!recordActionIfNew(room, msg.actionId)) return;

      const seatRec = findSeatByClientId(room, msg.clientId);
      if (!seatRec || seatRec.seat !== room.hostSeat) {
        sendToSocket(ws, {
          type: 'error',
          code: 'NOT_HOST',
          message: 'Only the host can start the match.',
        });
        return;
      }

      if (room.phase !== 'lobby') return;

      const connectedCount = Array.from(room.seats.values()).filter((s) => s.connected).length;
      if (connectedCount < room.capacity) {
        sendToSocket(ws, {
          type: 'error',
          code: 'NOT_ENOUGH_PLAYERS',
          message: `Waiting for all ${room.capacity} players (${connectedCount}/${room.capacity} joined).`,
        });
        return;
      }

      startAuthoritativeMatch(room);
      broadcastRoomState(room);
      break;
    }

    case 'room:leave': {
      const code = normalizeRoomCode(msg.roomCode);
      const room = rooms.get(code);
      if (!room) return;
      if (!recordActionIfNew(room, msg.actionId)) return;

      const seatRec = findSeatByClientId(room, msg.clientId);
      if (!seatRec) return;

      if (seatRec.graceTimer) {
        clearTimeout(seatRec.graceTimer);
        seatRec.graceTimer = null;
      }
      room.sockets.delete(msg.clientId);
      socketMeta.delete(ws);

      if (room.phase === 'lobby') {
        if (seatRec.seat === room.hostSeat) {
          closeRoom(room, 'Host left the room before starting.');
        } else {
          room.seats.delete(seatRec.seat);
          room.notice = `${seatRec.name} left the lobby.`;
          broadcastRoomState(room);
        }
      } else if (room.phase === 'playing' && room.match) {
        seatRec.connected = false;
        seatRec.forfeited = true;

        if (seatRec.seat === room.hostSeat) {
          const nextHost = Array.from(room.seats.values()).find(
            (r) => !r.forfeited && r.connected
          );
          if (nextHost) room.hostSeat = nextHost.seat;
        }

        room.match = forfeitSeat(room.match, seatRec.seat);
        syncParticipantsIntoMatch(room);
        if (room.match.turnPhase === 'finished') {
          room.phase = 'finished';
        }
        room.notice = `${seatRec.name} left the match.`;
        broadcastRoomState(room);
      } else {
        room.seats.delete(seatRec.seat);
        if (room.sockets.size === 0) {
          closeRoom(room, 'Room closed.');
        } else {
          if (seatRec.seat === room.hostSeat) {
            const nextHost = Array.from(room.seats.values()).find((r) => r.connected);
            if (nextHost) room.hostSeat = nextHost.seat;
          }
          broadcastRoomState(room);
        }
      }
      break;
    }

    case 'match:roll': {
      const code = normalizeRoomCode(msg.roomCode);
      const room = rooms.get(code);
      if (!room || room.phase !== 'playing' || !room.match) return;
      if (!recordActionIfNew(room, msg.actionId)) return;

      const seatRec = findSeatByClientId(room, msg.clientId);
      if (!seatRec || seatRec.forfeited) return;

      if (room.match.currentTurnSeat !== seatRec.seat || room.match.turnPhase !== 'waiting_roll') {
        sendToSocket(ws, {
          type: 'error',
          code: 'NOT_YOUR_TURN',
          message: 'Wait for your turn to roll.',
        });
        return;
      }

      room.lastActivityAt = Date.now();
      room.notice = null;

      // Authoritative cryptographic dice roll 1..6
      const diceValue = crypto.randomInt(1, 7);
      const result = applyDiceRoll(room.match, seatRec.seat, diceValue);
      room.match = result.nextState;
      broadcastRoomState(room);

      if (result.autoAdvanceTurn) {
        if (room.blockedRollTimer) clearTimeout(room.blockedRollTimer);
        room.blockedRollTimer = setTimeout(() => {
          room.blockedRollTimer = null;
          if (!rooms.has(room.roomCode) || !room.match || room.phase !== 'playing') return;
          room.match = advanceTurnAfterBlockedRoll(room.match);
          broadcastRoomState(room);
        }, 900);
      }
      break;
    }

    case 'match:move': {
      const code = normalizeRoomCode(msg.roomCode);
      const room = rooms.get(code);
      if (!room || room.phase !== 'playing' || !room.match) return;
      if (!recordActionIfNew(room, msg.actionId)) return;

      const seatRec = findSeatByClientId(room, msg.clientId);
      if (!seatRec || seatRec.forfeited) return;

      if (room.match.currentTurnSeat !== seatRec.seat || room.match.turnPhase !== 'waiting_move') {
        sendToSocket(ws, {
          type: 'error',
          code: 'NOT_YOUR_TURN',
          message: 'Wait for your turn to move.',
        });
        return;
      }

      try {
        const result = applyMove(room.match, seatRec.seat, msg.tokenId);
        room.match = result.nextState;
        room.lastActivityAt = Date.now();
        room.notice = null;
        if (room.match.turnPhase === 'finished') {
          room.phase = 'finished';
        }
        broadcastRoomState(room);
      } catch {
        sendToSocket(ws, {
          type: 'error',
          code: 'INVALID_ACTION',
          message: 'Selected token move is not legal.',
        });
      }
      break;
    }

    case 'match:restart': {
      const code = normalizeRoomCode(msg.roomCode);
      const room = rooms.get(code);
      if (!room || room.phase !== 'finished') return;
      if (!recordActionIfNew(room, msg.actionId)) return;

      const seatRec = findSeatByClientId(room, msg.clientId);
      if (!seatRec) return;

      // Reset fresh match for all currently connected seats
      const activeSeats = Array.from(room.seats.values()).filter((s) => s.connected);
      if (activeSeats.length < 2) {
        sendToSocket(ws, {
          type: 'error',
          code: 'NOT_ENOUGH_PLAYERS',
          message: 'Need at least 2 connected players to play again.',
        });
        return;
      }

      // Re-index active connected seats cleanly if any had forfeited
      startAuthoritativeMatch(room);
      room.notice = 'New match started!';
      broadcastRoomState(room);
      break;
    }
  }
}

async function createServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    const room = rooms.get(code);
    if (!room || room.phase === 'closed') {
      res.status(404).json({ ok: false, message: 'Room not found or expired.' });
      return;
    }
    res.json({
      ok: true,
      roomCode: room.roomCode,
      capacity: room.capacity,
      joinedCount: room.seats.size,
      phase: room.phase,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    socketMeta.set(ws, { isAlive: true });

    ws.on('pong', () => {
      const meta = socketMeta.get(ws);
      if (meta) meta.isAlive = true;
    });

    ws.on('message', (data) => {
      handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      handleClientDisconnect(ws);
    });

    ws.on('error', () => {
      handleClientDisconnect(ws);
    });
  });

  // WebSocket heartbeat every 15s
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      const meta = socketMeta.get(ws);
      if (!meta) continue;
      if (!meta.isAlive) {
        ws.terminate();
        continue;
      }
      meta.isAlive = false;
      ws.ping();
    }
  }, 15_000);

  // Room expiration & abandoned cleanup every 30s
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const anyConnected = Array.from(room.seats.values()).some((s) => s.connected);
      const idleMs = now - room.lastActivityAt;
      if ((!anyConnected && idleMs > 2 * 60 * 1000) || idleMs > ROOM_TTL_IDLE_MS) {
        closeRoom(room, 'Room expired due to inactivity.');
      }
    }
  }, 30_000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(cleanupInterval);
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Classic Ludo server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

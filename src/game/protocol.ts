import type { MatchState, PlayerColor, PlayerCount } from './types.ts';

export type RoomPhase = 'lobby' | 'playing' | 'finished' | 'closed';

export interface LobbySeat {
  seat: number;
  color: PlayerColor;
  name: string;
  connected: boolean;
  isHost: boolean;
  forfeited: boolean;
}

export interface RoomSnapshot {
  roomCode: string;
  capacity: PlayerCount;
  phase: RoomPhase;
  hostSeat: number;
  seats: LobbySeat[];
  match: MatchState | null;
  notice?: string | null;
  serverTime: number;
  seq: number;
}

export type ClientMessage =
  | {
      type: 'room:create';
      actionId: string;
      clientId: string;
      capacity: PlayerCount;
      playerName?: string;
    }
  | {
      type: 'room:join';
      actionId: string;
      clientId: string;
      roomCode: string;
      playerName?: string;
    }
  | {
      type: 'room:reconnect';
      clientId: string;
      roomCode: string;
    }
  | {
      type: 'room:start';
      actionId: string;
      clientId: string;
      roomCode: string;
    }
  | {
      type: 'room:leave';
      actionId: string;
      clientId: string;
      roomCode: string;
    }
  | {
      type: 'match:roll';
      actionId: string;
      clientId: string;
      roomCode: string;
    }
  | {
      type: 'match:move';
      actionId: string;
      clientId: string;
      roomCode: string;
      tokenId: string;
    }
  | {
      type: 'match:restart';
      actionId: string;
      clientId: string;
      roomCode: string;
    }
  | {
      type: 'ping';
    };

export type ServerMessage =
  | {
      type: 'room:joined';
      roomCode: string;
      seat: number;
      snapshot: RoomSnapshot;
    }
  | {
      type: 'room:state';
      snapshot: RoomSnapshot;
    }
  | {
      type: 'room:closed';
      roomCode: string;
      reason: string;
    }
  | {
      type: 'error';
      code:
        | 'INVALID_CODE'
        | 'ROOM_NOT_FOUND'
        | 'ROOM_EXPIRED'
        | 'ROOM_FULL'
        | 'ALREADY_STARTED'
        | 'NOT_HOST'
        | 'NOT_ENOUGH_PLAYERS'
        | 'INVALID_ACTION'
        | 'NOT_YOUR_TURN';
      message: string;
    }
  | {
      type: 'pong';
    };

export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue' | 'orange' | 'purple';

export type PlayerCount = 2 | 3 | 4 | 5 | 6;

export type BotPersonality = 'aggressive' | 'strategic' | 'progress';

export type BoardVariant = 'cross' | 'pentagon' | 'hexagon';

export interface ColorTheme {
  id: PlayerColor;
  label: string;
  primary: string;
  dark: string;
  light: string;
  surface: string;
  ring: string;
  textOnPrimary: string;
}

export const COLOR_THEMES: Record<PlayerColor, ColorTheme> = {
  red: {
    id: 'red',
    label: 'Red',
    primary: '#E11D48',
    dark: '#9F1239',
    light: '#FFE4E6',
    surface: '#BE123C',
    ring: '#FDA4AF',
    textOnPrimary: '#FFFFFF',
  },
  green: {
    id: 'green',
    label: 'Green',
    primary: '#16A34A',
    dark: '#166534',
    light: '#DCFCE7',
    surface: '#15803D',
    ring: '#86EFAC',
    textOnPrimary: '#FFFFFF',
  },
  yellow: {
    id: 'yellow',
    label: 'Yellow',
    primary: '#EAB308',
    dark: '#A16207',
    light: '#FEF9C3',
    surface: '#CA8A04',
    ring: '#FDE047',
    textOnPrimary: '#1E293B',
  },
  blue: {
    id: 'blue',
    label: 'Blue',
    primary: '#2563EB',
    dark: '#1E40AF',
    light: '#DBEAFE',
    surface: '#1D4ED8',
    ring: '#93C5FD',
    textOnPrimary: '#FFFFFF',
  },
  orange: {
    id: 'orange',
    label: 'Orange',
    primary: '#EA580C',
    dark: '#9A3412',
    light: '#FFEDD5',
    surface: '#C2410C',
    ring: '#FDBA74',
    textOnPrimary: '#FFFFFF',
  },
  purple: {
    id: 'purple',
    label: 'Purple',
    primary: '#9333EA',
    dark: '#6B21A8',
    light: '#F3E8FF',
    surface: '#7E22CE',
    ring: '#D8B4FE',
    textOnPrimary: '#FFFFFF',
  },
};

export const SEAT_COLORS_BY_COUNT: Record<PlayerCount, PlayerColor[]> = {
  2: ['red', 'yellow'],
  3: ['red', 'green', 'yellow'],
  4: ['red', 'green', 'yellow', 'blue'],
  5: ['red', 'green', 'yellow', 'blue', 'orange'],
  6: ['red', 'green', 'yellow', 'blue', 'orange', 'purple'],
};

export interface BoardNode {
  id: string;
  kind: 'yard' | 'track' | 'home' | 'finish';
  ownerSeat?: number;
  isSafe: boolean;
  isStart?: boolean;
  isStar?: boolean;
  startSeat?: number;
  trackIndex?: number;
  homeIndex?: number;
  nextBySeat: Record<number, string | null>;
}

export interface BoardGraph {
  playerCount: PlayerCount;
  variant: BoardVariant;
  trackLength: number;
  homeLaneLength: number;
  stepsToFinish: number;
  activeSeats: number[];
  seatToArm: Record<number, number>;
  seatToColor: Record<number, PlayerColor>;
  nodes: Record<string, BoardNode>;
  startNodeBySeat: Record<number, string>;
  homeGateTrackBySeat: Record<number, number>;
  yardNodesBySeat: Record<number, string[]>;
  finishNodeBySeat: Record<number, string>;
  safeNodeIds: string[];
  trackOrder: string[];
}

export interface Participant {
  seat: number;
  color: PlayerColor;
  name: string;
  isBot: boolean;
  botPersonality?: BotPersonality;
  connected: boolean;
  forfeited: boolean;
  isHost: boolean;
  disconnectedAt?: number | null;
}

export interface TokenState {
  id: string;
  seat: number;
  index: 0 | 1 | 2 | 3;
  nodeId: string;
  progress: number; // -1 = yard, 0 = start square, stepsToFinish = finish
}

export interface LegalMove {
  tokenId: string;
  fromNodeId: string;
  toNodeId: string;
  pathNodeIds: string[];
  newProgress: number;
  isRelease: boolean;
  isFinish: boolean;
  capturedTokenIds: string[];
}

export type MatchEventType =
  | 'start'
  | 'release'
  | 'move'
  | 'capture'
  | 'home'
  | 'win'
  | 'no_move'
  | 'triple_six'
  | 'forfeit';

export interface MatchEvent {
  type: MatchEventType;
  seat: number;
  color: PlayerColor;
  dice?: number;
  tokenId?: string;
  pathNodeIds?: string[];
  capturedTokenIds?: string[];
  message: string;
}

export type TurnPhase = 'waiting_roll' | 'waiting_move' | 'finished';

export interface MatchState {
  id: string;
  mode: 'bot' | 'online';
  playerCount: PlayerCount;
  participants: Participant[];
  tokens: Record<string, TokenState>;
  currentTurnSeat: number;
  turnPhase: TurnPhase;
  diceValue: number | null;
  consecutiveSixes: number;
  legalMoves: LegalMove[];
  winnerSeat: number | null;
  lastEvent: MatchEvent | null;
  seq: number;
}

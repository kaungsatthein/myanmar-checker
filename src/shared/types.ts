export const BOARD_SIZE = 8;

export type Color = "RED" | "BLACK";
export type GameResult = Color | "DRAW";
export type Role = Color | "SPECTATOR";
export type AIDifficulty = "easy" | "medium" | "hard";

export type Coord = {
  r: number;
  c: number;
};

export type Player = {
  socketId: string;
  name: string;
  color: Color;
  isAI?: boolean;
  aiDifficulty?: AIDifficulty;
};

export type Piece = {
  id: string;
  color: Color;
  row: number;
  col: number;
  isKing: boolean;
};

export type Move = {
  pieceId: string;
  from: Coord;
  to: Coord;
  captures: Coord[];
  path: Coord[];
};

export type GameState = {
  board: (string | null)[][];
  pieces: Record<string, Piece>;
  turn: Color;
  turnDeadlineAt?: number;
  forcedPieceId?: string;
  winner?: GameResult;
  drawMoveCounter?: number;
  roomId: string;
  players: {
    RED?: Player;
    BLACK?: Player;
  };
};

export type JoinRoomPayload = {
  roomId: string;
  playerName: string;
  enableAI?: boolean;
  aiDifficulty?: AIDifficulty;
};

export type JoinRoomResult = {
  roomId: string;
  role: Role;
  isHost: boolean;
};

export type MoveTryPayload = {
  roomId: string;
  from: Coord;
  to: Coord;
  path?: Coord[];
};

export type MoveRejectPayload = {
  reason: string;
};

export type MoveAcceptPayload = {
  roomId: string;
  move: Move;
  by: Color;
};

export type RestartVotePayload = {
  roomId: string;
  votes: Color[];
};

export type GameTimeoutPayload = {
  roomId: string;
  loser: Color;
  winner: Color;
};

export type GameResignedPayload = {
  roomId: string;
  loser: Color;
  winner: Color;
};

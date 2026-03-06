import {
  BOARD_SIZE,
  Color,
  Coord,
  GameState,
  Move,
  MoveTryPayload,
  Piece
} from "./types";

const KING_DIRECTIONS: readonly [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function getForwardDirections(color: Color): readonly [number, number][] {
  return color === "RED"
    ? [
        [1, -1],
        [1, 1]
      ]
    : [
        [-1, -1],
        [-1, 1]
      ];
}

export function otherColor(color: Color): Color {
  return color === "RED" ? "BLACK" : "RED";
}

function makeEmptyBoard(): (string | null)[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array<string | null>(BOARD_SIZE).fill(null));
}

function shouldPromote(piece: Piece): boolean {
  return (piece.color === "RED" && piece.row === BOARD_SIZE - 1) || (piece.color === "BLACK" && piece.row === 0);
}

function getRawMovesForPiece(
  state: GameState,
  piece: Piece
): {
  captures: Move[];
  quiet: Move[];
} {
  const captures: Move[] = [];
  const quiet: Move[] = [];

  if (piece.isKing) {
    for (const [dr, dc] of KING_DIRECTIONS) {
      let r = piece.row + dr;
      let c = piece.col + dc;

      // Quiet king moves can travel any distance until blocked.
      while (inBounds(r, c) && !state.board[r][c]) {
        quiet.push({
          pieceId: piece.id,
          from: { r: piece.row, c: piece.col },
          to: { r, c },
          captures: [],
          path: [{ r, c }]
        });

        r += dr;
        c += dc;
      }
    }

    for (const [dr, dc] of KING_DIRECTIONS) {
      let r = piece.row + dr;
      let c = piece.col + dc;
      let seenOpponent: Coord | null = null;

      while (inBounds(r, c)) {
        const occupantId = state.board[r][c];

        if (!occupantId) {
          if (seenOpponent) {
            captures.push({
              pieceId: piece.id,
              from: { r: piece.row, c: piece.col },
              to: { r, c },
              captures: [seenOpponent],
              path: [{ r, c }]
            });
          }

          r += dr;
          c += dc;
          continue;
        }

        const occupant = state.pieces[occupantId];
        if (!occupant) {
          break;
        }

        if (occupant.color === piece.color) {
          break;
        }

        if (seenOpponent) {
          break;
        }

        seenOpponent = { r, c };
        r += dr;
        c += dc;
      }
    }

    return { captures, quiet };
  }

  for (const [dr, dc] of getForwardDirections(piece.color)) {
    const moveR = piece.row + dr;
    const moveC = piece.col + dc;

    if (inBounds(moveR, moveC) && !state.board[moveR][moveC]) {
      quiet.push({
        pieceId: piece.id,
        from: { r: piece.row, c: piece.col },
        to: { r: moveR, c: moveC },
        captures: [],
        path: [{ r: moveR, c: moveC }]
      });
    }

    const jumpR = piece.row + dr * 2;
    const jumpC = piece.col + dc * 2;
    const midR = piece.row + dr;
    const midC = piece.col + dc;

    if (!inBounds(jumpR, jumpC) || !inBounds(midR, midC)) {
      continue;
    }

    const middleId = state.board[midR][midC];
    if (!middleId || state.board[jumpR][jumpC]) {
      continue;
    }

    const middlePiece = state.pieces[middleId];
    if (!middlePiece || middlePiece.color === piece.color) {
      continue;
    }

    captures.push({
      pieceId: piece.id,
      from: { r: piece.row, c: piece.col },
      to: { r: jumpR, c: jumpC },
      captures: [{ r: midR, c: midC }],
      path: [{ r: jumpR, c: jumpC }]
    });
  }

  return { captures, quiet };
}

export function createInitialGameState(roomId: string): GameState {
  const board = makeEmptyBoard();
  const pieces: Record<string, Piece> = {};

  let counter = 1;
  const addPiece = (color: Color, row: number, col: number): void => {
    const id = `${color}-${counter++}`;
    pieces[id] = {
      id,
      color,
      row,
      col,
      isKing: false
    };
    board[row][col] = id;
  };

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if ((row + col) % 2 === 1) {
        addPiece("RED", row, col);
      }
    }
  }

  for (let row = BOARD_SIZE - 3; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if ((row + col) % 2 === 1) {
        addPiece("BLACK", row, col);
      }
    }
  }

  return {
    board,
    pieces,
    roomId,
    turn: "RED",
    players: {}
  };
}

export function getAllLegalMoves(state: GameState, color: Color): Move[] {
  if (state.winner) {
    return [];
  }

  if (state.forcedPieceId) {
    const forced = state.pieces[state.forcedPieceId];
    if (!forced || forced.color !== color) {
      return [];
    }

    return getRawMovesForPiece(state, forced).captures;
  }

  const allCaptures: Move[] = [];
  const allQuiet: Move[] = [];

  for (const piece of Object.values(state.pieces)) {
    if (piece.color !== color) {
      continue;
    }

    const raw = getRawMovesForPiece(state, piece);
    allCaptures.push(...raw.captures);
    allQuiet.push(...raw.quiet);
  }

  return allCaptures.length > 0 ? allCaptures : allQuiet;
}

export function getLegalMovesForPiece(state: GameState, pieceId: string): Move[] {
  const piece = state.pieces[pieceId];
  if (!piece) {
    return [];
  }

  if (state.forcedPieceId && state.forcedPieceId !== pieceId) {
    return [];
  }

  const legalForColor = getAllLegalMoves(state, piece.color);
  return legalForColor.filter((move) => move.pieceId === pieceId);
}

export function applyMove(state: GameState, move: Move): GameState {
  const board = state.board.map((row) => [...row]);
  const pieces: Record<string, Piece> = {};

  for (const [id, piece] of Object.entries(state.pieces)) {
    pieces[id] = { ...piece };
  }

  const piece = pieces[move.pieceId];
  if (!piece) {
    return state;
  }

  board[move.from.r][move.from.c] = null;

  for (const capture of move.captures) {
    const capturedId = board[capture.r][capture.c];
    if (!capturedId) {
      continue;
    }

    board[capture.r][capture.c] = null;
    delete pieces[capturedId];
  }

  piece.row = move.to.r;
  piece.col = move.to.c;

  if (!piece.isKing && shouldPromote(piece)) {
    piece.isKing = true;
  }

  pieces[piece.id] = piece;
  board[move.to.r][move.to.c] = piece.id;

  return {
    ...state,
    board,
    pieces,
    players: {
      ...state.players
    }
  };
}

export function evaluateWinner(state: GameState): Color | undefined {
  let redCount = 0;
  let blackCount = 0;

  for (const piece of Object.values(state.pieces)) {
    if (piece.color === "RED") {
      redCount += 1;
    } else {
      blackCount += 1;
    }
  }

  if (redCount === 0) {
    return "BLACK";
  }

  if (blackCount === 0) {
    return "RED";
  }

  if (getAllLegalMoves(state, state.turn).length === 0) {
    return otherColor(state.turn);
  }

  return undefined;
}

export function tryApplyMove(
  state: GameState,
  actorColor: Color,
  payload: MoveTryPayload
):
  | {
      ok: true;
      state: GameState;
      move: Move;
    }
  | {
      ok: false;
      reason: string;
    } {
  if (state.winner) {
    return { ok: false, reason: "Game has already ended." };
  }

  if (state.turn !== actorColor) {
    return { ok: false, reason: "It is not your turn." };
  }

  if (!inBounds(payload.from.r, payload.from.c) || !inBounds(payload.to.r, payload.to.c)) {
    return { ok: false, reason: "Move is out of board bounds." };
  }

  const pieceId = state.board[payload.from.r][payload.from.c];
  if (!pieceId) {
    return { ok: false, reason: "No piece on the selected square." };
  }

  const piece = state.pieces[pieceId];
  if (!piece || piece.color !== actorColor) {
    return { ok: false, reason: "You can only move your own piece." };
  }

  if (state.forcedPieceId && state.forcedPieceId !== pieceId) {
    return { ok: false, reason: "You must continue the capture with the same piece." };
  }

  const legalMoves = getLegalMovesForPiece(state, pieceId);
  const selected = legalMoves.find((move) => move.to.r === payload.to.r && move.to.c === payload.to.c);

  if (!selected) {
    return { ok: false, reason: "Illegal move." };
  }

  let nextState = applyMove(state, selected);

  if (selected.captures.length > 0) {
    const movedPiece = nextState.pieces[pieceId];

    if (!movedPiece) {
      return { ok: false, reason: "Move failed due to invalid capture state." };
    }

    const followUpCaptures = getRawMovesForPiece(nextState, movedPiece).captures;

    if (followUpCaptures.length > 0) {
      nextState = {
        ...nextState,
        turn: actorColor,
        forcedPieceId: movedPiece.id,
        winner: undefined
      };
    } else {
      nextState = {
        ...nextState,
        turn: otherColor(actorColor),
        forcedPieceId: undefined,
        winner: undefined
      };
    }
  } else {
    nextState = {
      ...nextState,
      turn: otherColor(actorColor),
      forcedPieceId: undefined,
      winner: undefined
    };
  }

  const winner = evaluateWinner(nextState);
  if (winner) {
    nextState = {
      ...nextState,
      winner,
      forcedPieceId: undefined
    };
  }

  return {
    ok: true,
    state: nextState,
    move: selected
  };
}

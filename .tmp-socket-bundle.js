"use strict";

// socket-server/index.ts
var import_http = require("http");
var import_socket = require("socket.io");

// src/shared/types.ts
var BOARD_SIZE = 8;

// src/shared/engine.ts
var KING_DIRECTIONS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];
function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}
function getForwardDirections(color) {
  return color === "RED" ? [
    [1, -1],
    [1, 1]
  ] : [
    [-1, -1],
    [-1, 1]
  ];
}
function otherColor(color) {
  return color === "RED" ? "BLACK" : "RED";
}
function makeEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}
function shouldPromote(piece) {
  return piece.color === "RED" && piece.row === BOARD_SIZE - 1 || piece.color === "BLACK" && piece.row === 0;
}
function getRawMovesForPiece(state, piece) {
  const captures = [];
  const quiet = [];
  if (piece.isKing) {
    for (const [dr, dc] of KING_DIRECTIONS) {
      let r = piece.row + dr;
      let c = piece.col + dc;
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
      let seenOpponent = null;
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
function createInitialGameState(roomId) {
  const board = makeEmptyBoard();
  const pieces = {};
  let counter = 1;
  const addPiece = (color, row, col) => {
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
function getAllLegalMoves(state, color) {
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
  const allCaptures = [];
  const allQuiet = [];
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
function getLegalMovesForPiece(state, pieceId) {
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
function applyMove(state, move) {
  const board = state.board.map((row) => [...row]);
  const pieces = {};
  for (const [id, piece2] of Object.entries(state.pieces)) {
    pieces[id] = { ...piece2 };
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
function evaluateWinner(state) {
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
  return void 0;
}
function tryApplyMove(state, actorColor, payload) {
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
        winner: void 0
      };
    } else {
      nextState = {
        ...nextState,
        turn: otherColor(actorColor),
        forcedPieceId: void 0,
        winner: void 0
      };
    }
  } else {
    nextState = {
      ...nextState,
      turn: otherColor(actorColor),
      forcedPieceId: void 0,
      winner: void 0
    };
  }
  const winner = evaluateWinner(nextState);
  if (winner) {
    nextState = {
      ...nextState,
      winner,
      forcedPieceId: void 0
    };
  }
  return {
    ok: true,
    state: nextState,
    move: selected
  };
}

// src/server/socket.ts
var rooms = /* @__PURE__ */ new Map();
var sessions = /* @__PURE__ */ new Map();
function createRoom(roomId, hostSocketId) {
  const room = {
    id: roomId,
    state: createInitialGameState(roomId),
    sockets: /* @__PURE__ */ new Set(),
    hostSocketId,
    restartVotes: /* @__PURE__ */ new Set(),
    aiColor: void 0,
    aiDifficulty: "medium",
    aiMoveTimer: void 0
  };
  rooms.set(roomId, room);
  return room;
}
function broadcastState(io2, room) {
  io2.to(room.id).emit("game:state", room.state);
}
function clearAiMoveTimer(room) {
  if (!room.aiMoveTimer) {
    return;
  }
  clearTimeout(room.aiMoveTimer);
  room.aiMoveTimer = void 0;
}
function normalizeAIDifficulty(value) {
  if (value === "easy" || value === "medium" || value === "hard") {
    return value;
  }
  return "medium";
}
function pickRandomMove(moves) {
  if (moves.length === 0) {
    return void 0;
  }
  return moves[Math.floor(Math.random() * moves.length)];
}
function getPieceValue(piece) {
  return piece.isKing ? 190 : 100;
}
function getPositionBonus(piece) {
  if (piece.isKing) {
    return 0;
  }
  return piece.color === "RED" ? piece.row * 4 : (7 - piece.row) * 4;
}
function evaluateStateForAI(state, aiColor) {
  if (state.winner) {
    return state.winner === aiColor ? 1e6 : -1e6;
  }
  let score = 0;
  for (const piece of Object.values(state.pieces)) {
    const pieceScore = getPieceValue(piece) + getPositionBonus(piece);
    score += piece.color === aiColor ? pieceScore : -pieceScore;
  }
  const aiMobility = getAllLegalMoves(state, aiColor).length;
  const enemyMobility = getAllLegalMoves(state, otherColor(aiColor)).length;
  score += (aiMobility - enemyMobility) * 3;
  if (state.forcedPieceId) {
    const forcedPiece = state.pieces[state.forcedPieceId];
    if (forcedPiece) {
      score += forcedPiece.color === aiColor ? 18 : -18;
    }
  }
  return score;
}
function applyCandidateMove(state, actorColor, move) {
  const result = tryApplyMove(state, actorColor, {
    roomId: state.roomId,
    from: move.from,
    to: move.to,
    path: move.path
  });
  return result.ok ? result.state : void 0;
}
function moveLeavesPieceExposed(nextState, aiColor, move) {
  const movedPiece = nextState.pieces[move.pieceId];
  if (!movedPiece) {
    return false;
  }
  const enemyMoves = getAllLegalMoves(nextState, otherColor(aiColor));
  return enemyMoves.some(
    (enemyMove) => enemyMove.captures.some((capture) => capture.r === movedPiece.row && capture.c === movedPiece.col)
  );
}
function getQuickMoveScore(state, actorColor, move) {
  const piece = state.pieces[move.pieceId];
  const isPromotion = piece && !piece.isKing && (actorColor === "RED" && move.to.r === 7 || actorColor === "BLACK" && move.to.r === 0);
  const travelDistance = Math.abs(move.to.r - move.from.r);
  return move.captures.length * 120 + (isPromotion ? 95 : 0) + travelDistance;
}
function scoreMoveHeuristic(state, aiColor, move) {
  const nextState = applyCandidateMove(state, aiColor, move);
  if (!nextState) {
    return Number.NEGATIVE_INFINITY;
  }
  const before = state.pieces[move.pieceId];
  const after = nextState.pieces[move.pieceId];
  const becameKing = Boolean(before && after && !before.isKing && after.isKing);
  const centerDistance = Math.abs(move.to.r - 3.5) + Math.abs(move.to.c - 3.5);
  const exposedPenalty = moveLeavesPieceExposed(nextState, aiColor, move) ? 110 : 0;
  let score = evaluateStateForAI(nextState, aiColor);
  score += move.captures.length * 130;
  score += becameKing ? 210 : 0;
  score -= centerDistance * 4;
  score -= exposedPenalty;
  return score;
}
function pickMediumMove(state, aiColor, legalMoves) {
  const scored = legalMoves.map((move) => ({
    move,
    score: scoreMoveHeuristic(state, aiColor, move)
  })).sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    return void 0;
  }
  const topSlice = scored.slice(0, Math.min(3, scored.length));
  return topSlice[Math.floor(Math.random() * topSlice.length)]?.move;
}
function minimax(state, currentColor, aiColor, depth, alpha, beta) {
  if (depth === 0 || state.winner) {
    return evaluateStateForAI(state, aiColor);
  }
  const legalMoves = getAllLegalMoves(state, currentColor);
  if (legalMoves.length === 0) {
    return currentColor === aiColor ? -9e5 : 9e5;
  }
  const orderedMoves = [...legalMoves].sort((a, b) => {
    const aScore = getQuickMoveScore(state, currentColor, a);
    const bScore = getQuickMoveScore(state, currentColor, b);
    return currentColor === aiColor ? bScore - aScore : aScore - bScore;
  });
  const candidates = orderedMoves.slice(0, 14);
  if (currentColor === aiColor) {
    let best2 = Number.NEGATIVE_INFINITY;
    for (const move of candidates) {
      const nextState = applyCandidateMove(state, currentColor, move);
      if (!nextState) {
        continue;
      }
      const score = minimax(nextState, nextState.turn, aiColor, depth - 1, alpha, beta);
      best2 = Math.max(best2, score);
      alpha = Math.max(alpha, best2);
      if (beta <= alpha) {
        break;
      }
    }
    return best2;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const move of candidates) {
    const nextState = applyCandidateMove(state, currentColor, move);
    if (!nextState) {
      continue;
    }
    const score = minimax(nextState, nextState.turn, aiColor, depth - 1, alpha, beta);
    best = Math.min(best, score);
    beta = Math.min(beta, best);
    if (beta <= alpha) {
      break;
    }
  }
  return best;
}
function pickHardMove(state, aiColor, legalMoves) {
  if (legalMoves.length === 0) {
    return void 0;
  }
  const pieceCount = Object.keys(state.pieces).length;
  const depth = pieceCount <= 10 ? 6 : pieceCount <= 16 ? 5 : 4;
  const orderedMoves = [...legalMoves].sort((a, b) => getQuickMoveScore(state, aiColor, b) - getQuickMoveScore(state, aiColor, a));
  const candidates = orderedMoves.slice(0, 16);
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestMoves = [];
  for (const move of candidates) {
    const nextState = applyCandidateMove(state, aiColor, move);
    if (!nextState) {
      continue;
    }
    const score = minimax(nextState, nextState.turn, aiColor, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }
  if (bestMoves.length === 0) {
    return pickMediumMove(state, aiColor, legalMoves);
  }
  return pickRandomMove(bestMoves);
}
function selectAIMove(room, legalMoves, aiColor) {
  switch (room.aiDifficulty) {
    case "easy":
      return pickRandomMove(legalMoves);
    case "hard":
      return pickHardMove(room.state, aiColor, legalMoves);
    case "medium":
    default:
      return pickMediumMove(room.state, aiColor, legalMoves);
  }
}
function scheduleAiMove(io2, room) {
  const aiColor = room.aiColor;
  if (!aiColor || room.aiMoveTimer || room.state.winner || room.state.turn !== aiColor) {
    return;
  }
  const delayMs = room.aiDifficulty === "easy" ? 260 : room.aiDifficulty === "medium" ? 340 : 430;
  room.aiMoveTimer = setTimeout(() => {
    room.aiMoveTimer = void 0;
    const currentRoom = rooms.get(room.id);
    const aiColor2 = currentRoom?.aiColor;
    if (!currentRoom || !aiColor2 || currentRoom.state.winner || currentRoom.state.turn !== aiColor2) {
      return;
    }
    const legalMoves = getAllLegalMoves(currentRoom.state, aiColor2);
    if (legalMoves.length === 0) {
      currentRoom.state = {
        ...currentRoom.state,
        winner: otherColor(aiColor2),
        forcedPieceId: void 0
      };
      broadcastState(io2, currentRoom);
      return;
    }
    const selected = selectAIMove(currentRoom, legalMoves, aiColor2);
    if (!selected) {
      return;
    }
    const result = tryApplyMove(currentRoom.state, aiColor2, {
      roomId: currentRoom.id,
      from: selected.from,
      to: selected.to,
      path: selected.path
    });
    if (!result.ok) {
      return;
    }
    currentRoom.state = result.state;
    currentRoom.restartVotes.clear();
    io2.to(currentRoom.id).emit("move:accept", {
      roomId: currentRoom.id,
      move: result.move,
      by: aiColor2
    });
    broadcastState(io2, currentRoom);
    scheduleAiMove(io2, currentRoom);
  }, delayMs);
}
function clearAI(room) {
  if (!room.aiColor) {
    return;
  }
  clearAiMoveTimer(room);
  const aiPlayer = room.state.players[room.aiColor];
  if (aiPlayer?.isAI) {
    delete room.state.players[room.aiColor];
  }
  room.aiColor = void 0;
  room.aiDifficulty = "medium";
}
function leaveRoom(io2, socket) {
  const session = sessions.get(socket.id);
  if (!session) {
    return;
  }
  const room = rooms.get(session.roomId);
  sessions.delete(socket.id);
  if (!room) {
    return;
  }
  room.sockets.delete(socket.id);
  socket.leave(room.id);
  const isPlayerRole = session.role === "RED" || session.role === "BLACK";
  if (isPlayerRole) {
    const playerColor = session.role;
    delete room.state.players[playerColor];
    if (room.aiColor) {
      clearAI(room);
      resetBoardWithCurrentPlayers(room);
    }
  }
  room.restartVotes.clear();
  if (room.hostSocketId === socket.id) {
    const nextHost = room.sockets.values().next().value;
    room.hostSocketId = nextHost ?? "";
  }
  if (room.sockets.size === 0) {
    clearAiMoveTimer(room);
    rooms.delete(room.id);
    return;
  }
  broadcastState(io2, room);
}
function assignRole(room, socketId, playerName) {
  if (!room.state.players.RED) {
    room.state.players.RED = { socketId, name: playerName, color: "RED" };
    return "RED";
  }
  if (!room.state.players.BLACK) {
    room.state.players.BLACK = { socketId, name: playerName, color: "BLACK" };
    return "BLACK";
  }
  return "SPECTATOR";
}
function resetBoardWithCurrentPlayers(room) {
  const players = {
    ...room.state.players
  };
  room.state = createInitialGameState(room.id);
  room.state.players = players;
}
function maybeEnableAIForRoom(room, role, enableAI, requestedDifficulty) {
  if (!enableAI || room.aiColor || role !== "RED" && role !== "BLACK") {
    return;
  }
  const aiColor = otherColor(role);
  if (room.state.players[aiColor]) {
    return;
  }
  room.aiColor = aiColor;
  room.aiDifficulty = normalizeAIDifficulty(requestedDifficulty);
  room.state.players[aiColor] = {
    socketId: `AI:${aiColor}`,
    name: "AI Bot",
    color: aiColor,
    isAI: true,
    aiDifficulty: room.aiDifficulty
  };
  resetBoardWithCurrentPlayers(room);
  room.restartVotes.clear();
}
function registerSocketHandlers(io2) {
  io2.on("connection", (socket) => {
    socket.on("room:join", (payload) => {
      if (!payload?.roomId?.trim()) {
        socket.emit("move:reject", { reason: "Room ID is required." });
        return;
      }
      if (sessions.has(socket.id)) {
        leaveRoom(io2, socket);
      }
      const roomId = payload.roomId.trim();
      const playerName = payload.playerName?.trim() || "Guest";
      const room = rooms.get(roomId) ?? createRoom(roomId, socket.id);
      room.sockets.add(socket.id);
      if (!room.hostSocketId) {
        room.hostSocketId = socket.id;
      }
      socket.join(roomId);
      const role = assignRole(room, socket.id, playerName);
      sessions.set(socket.id, { roomId, role });
      maybeEnableAIForRoom(room, role, payload.enableAI, payload.aiDifficulty);
      const result = {
        roomId,
        role,
        isHost: room.hostSocketId === socket.id
      };
      socket.emit("room:joined", result);
      broadcastState(io2, room);
      scheduleAiMove(io2, room);
    });
    socket.on("move:try", (payload) => {
      const session = sessions.get(socket.id);
      if (!session) {
        socket.emit("move:reject", { reason: "You are not in a room." });
        return;
      }
      if (session.roomId !== payload.roomId) {
        socket.emit("move:reject", { reason: "Invalid room context." });
        return;
      }
      if (session.role !== "RED" && session.role !== "BLACK") {
        socket.emit("move:reject", { reason: "Spectators cannot move pieces." });
        return;
      }
      const room = rooms.get(session.roomId);
      if (!room) {
        socket.emit("move:reject", { reason: "Room no longer exists." });
        return;
      }
      const result = tryApplyMove(room.state, session.role, payload);
      if (!result.ok) {
        socket.emit("move:reject", { reason: result.reason });
        return;
      }
      room.state = result.state;
      room.restartVotes.clear();
      io2.to(room.id).emit("move:accept", {
        roomId: room.id,
        move: result.move,
        by: session.role
      });
      broadcastState(io2, room);
      scheduleAiMove(io2, room);
    });
    socket.on("game:restart:request", (payload) => {
      const session = sessions.get(socket.id);
      if (!session || session.roomId !== payload?.roomId) {
        socket.emit("move:reject", { reason: "You are not in this room." });
        return;
      }
      const room = rooms.get(session.roomId);
      if (!room) {
        socket.emit("move:reject", { reason: "Room no longer exists." });
        return;
      }
      const isHost = room.hostSocketId === socket.id;
      if (isHost) {
        resetBoardWithCurrentPlayers(room);
        room.restartVotes.clear();
        io2.to(room.id).emit("game:restart:accepted", { by: "HOST" });
        broadcastState(io2, room);
        scheduleAiMove(io2, room);
        return;
      }
      if (room.aiColor && (session.role === "RED" || session.role === "BLACK")) {
        resetBoardWithCurrentPlayers(room);
        room.restartVotes.clear();
        io2.to(room.id).emit("game:restart:accepted", { by: "AI_MATCH" });
        broadcastState(io2, room);
        scheduleAiMove(io2, room);
        return;
      }
      if (session.role !== "RED" && session.role !== "BLACK") {
        socket.emit("move:reject", { reason: "Only players can vote to restart." });
        return;
      }
      if (!room.state.players.RED || !room.state.players.BLACK) {
        socket.emit("move:reject", { reason: "Both player seats must be filled to vote restart." });
        return;
      }
      room.restartVotes.add(session.role);
      if (room.restartVotes.size < 2) {
        const votePayload = {
          roomId: room.id,
          votes: Array.from(room.restartVotes)
        };
        io2.to(room.id).emit("game:restart:vote", votePayload);
        return;
      }
      resetBoardWithCurrentPlayers(room);
      room.restartVotes.clear();
      io2.to(room.id).emit("game:restart:accepted", { by: "BOTH_PLAYERS" });
      broadcastState(io2, room);
      scheduleAiMove(io2, room);
    });
    socket.on("room:leave", () => {
      leaveRoom(io2, socket);
    });
    socket.on("disconnect", () => {
      leaveRoom(io2, socket);
    });
  });
}

// socket-server/index.ts
function getCorsOrigin() {
  const raw = process.env.CORS_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "*";
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0 || values.includes("*")) {
    return "*";
  }
  return values;
}
var port = Number(process.env.SOCKET_PORT || process.env.PORT || 4001);
var host = process.env.HOSTNAME || "0.0.0.0";
var httpServer = (0, import_http.createServer)((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not Found");
});
var io = new import_socket.Server(httpServer, {
  cors: {
    origin: getCorsOrigin(),
    methods: ["GET", "POST"]
  }
});
registerSocketHandlers(io);
httpServer.listen(port, host, () => {
  console.log(`Socket server running on http://${host}:${port}`);
});

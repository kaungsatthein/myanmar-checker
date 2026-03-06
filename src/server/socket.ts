import { Server as SocketIOServer, Socket } from "socket.io";

import { createInitialGameState, getAllLegalMoves, otherColor, tryApplyMove } from "../shared/engine";
import {
  AIDifficulty,
  Color,
  GameResignedPayload,
  GameState,
  GameTimeoutPayload,
  JoinRoomPayload,
  JoinRoomResult,
  Move,
  MoveTryPayload,
  Piece,
  RestartVotePayload,
  Role
} from "../shared/types";

type Room = {
  id: string;
  state: GameState;
  sockets: Set<string>;
  hostSocketId: string;
  restartVotes: Set<Color>;
  aiColor?: Color;
  aiDifficulty: AIDifficulty;
  aiMoveTimer?: ReturnType<typeof setTimeout>;
  turnTimer?: ReturnType<typeof setTimeout>;
};

type Session = {
  roomId: string;
  role: Role;
};

const rooms = new Map<string, Room>();
const sessions = new Map<string, Session>();
const TURN_DURATION_MS = 30_000;

function createRoom(roomId: string, hostSocketId: string): Room {
  const room: Room = {
    id: roomId,
    state: createInitialGameState(roomId),
    sockets: new Set<string>(),
    hostSocketId,
    restartVotes: new Set<Color>(),
    aiColor: undefined,
    aiDifficulty: "medium",
    aiMoveTimer: undefined,
    turnTimer: undefined
  };

  rooms.set(roomId, room);
  return room;
}

function broadcastState(io: SocketIOServer, room: Room): void {
  io.to(room.id).emit("game:state", room.state);
}

function clearAiMoveTimer(room: Room): void {
  if (!room.aiMoveTimer) {
    return;
  }

  clearTimeout(room.aiMoveTimer);
  room.aiMoveTimer = undefined;
}

function clearTurnTimer(room: Room): void {
  if (!room.turnTimer) {
    return;
  }

  clearTimeout(room.turnTimer);
  room.turnTimer = undefined;
}

function hasActivePlayers(room: Room): boolean {
  return Boolean(room.state.players.RED && room.state.players.BLACK);
}

function stopTurnTimer(room: Room): void {
  clearTurnTimer(room);

  if (!room.state.turnDeadlineAt) {
    return;
  }

  room.state = {
    ...room.state,
    turnDeadlineAt: undefined
  };
}

function onTurnTimedOut(io: SocketIOServer, roomId: string, expectedDeadline: number): void {
  const room = rooms.get(roomId);
  if (!room || room.state.winner || room.state.turnDeadlineAt !== expectedDeadline) {
    return;
  }

  const loser = room.state.turn;
  const winner = otherColor(loser);
  room.state = {
    ...room.state,
    winner,
    forcedPieceId: undefined,
    turnDeadlineAt: undefined
  };
  room.restartVotes.clear();
  clearAiMoveTimer(room);
  clearTurnTimer(room);

  const payload: GameTimeoutPayload = {
    roomId: room.id,
    loser,
    winner
  };
  io.to(room.id).emit("game:timeout", payload);
  broadcastState(io, room);
}

function refreshTurnTimer(io: SocketIOServer, room: Room): void {
  if (!hasActivePlayers(room) || room.state.winner) {
    stopTurnTimer(room);
    return;
  }

  clearTurnTimer(room);
  const deadline = Date.now() + TURN_DURATION_MS;
  room.state = {
    ...room.state,
    turnDeadlineAt: deadline
  };
  room.turnTimer = setTimeout(() => onTurnTimedOut(io, room.id, deadline), TURN_DURATION_MS + 20);
}

function normalizeAIDifficulty(value: unknown): AIDifficulty {
  if (value === "easy" || value === "medium" || value === "hard") {
    return value;
  }

  return "medium";
}

function pickRandomMove(moves: Move[]): Move | undefined {
  if (moves.length === 0) {
    return undefined;
  }

  return moves[Math.floor(Math.random() * moves.length)];
}

function getPieceValue(piece: Piece): number {
  return piece.isKing ? 190 : 100;
}

function getPositionBonus(piece: Piece): number {
  if (piece.isKing) {
    return 0;
  }

  return piece.color === "RED" ? piece.row * 4 : (7 - piece.row) * 4;
}

function evaluateStateForAI(state: GameState, aiColor: Color): number {
  if (state.winner) {
    return state.winner === aiColor ? 1_000_000 : -1_000_000;
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

function applyCandidateMove(state: GameState, actorColor: Color, move: Move): GameState | undefined {
  const result = tryApplyMove(state, actorColor, {
    roomId: state.roomId,
    from: move.from,
    to: move.to,
    path: move.path
  });

  return result.ok ? result.state : undefined;
}

function moveLeavesPieceExposed(nextState: GameState, aiColor: Color, move: Move): boolean {
  const movedPiece = nextState.pieces[move.pieceId];
  if (!movedPiece) {
    return false;
  }

  const enemyMoves = getAllLegalMoves(nextState, otherColor(aiColor));
  return enemyMoves.some((enemyMove) =>
    enemyMove.captures.some((capture) => capture.r === movedPiece.row && capture.c === movedPiece.col)
  );
}

function getQuickMoveScore(state: GameState, actorColor: Color, move: Move): number {
  const piece = state.pieces[move.pieceId];
  const isPromotion =
    piece && !piece.isKing && ((actorColor === "RED" && move.to.r === 7) || (actorColor === "BLACK" && move.to.r === 0));
  const travelDistance = Math.abs(move.to.r - move.from.r);
  return move.captures.length * 120 + (isPromotion ? 95 : 0) + travelDistance;
}

function scoreMoveHeuristic(state: GameState, aiColor: Color, move: Move): number {
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

function pickMediumMove(state: GameState, aiColor: Color, legalMoves: Move[]): Move | undefined {
  const scored = legalMoves
    .map((move) => ({
      move,
      score: scoreMoveHeuristic(state, aiColor, move)
    }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return undefined;
  }

  const topSlice = scored.slice(0, Math.min(3, scored.length));
  return topSlice[Math.floor(Math.random() * topSlice.length)]?.move;
}

function minimax(
  state: GameState,
  currentColor: Color,
  aiColor: Color,
  depth: number,
  alpha: number,
  beta: number
): number {
  if (depth === 0 || state.winner) {
    return evaluateStateForAI(state, aiColor);
  }

  const legalMoves = getAllLegalMoves(state, currentColor);
  if (legalMoves.length === 0) {
    return currentColor === aiColor ? -900_000 : 900_000;
  }

  const orderedMoves = [...legalMoves].sort((a, b) => {
    const aScore = getQuickMoveScore(state, currentColor, a);
    const bScore = getQuickMoveScore(state, currentColor, b);
    return currentColor === aiColor ? bScore - aScore : aScore - bScore;
  });
  const candidates = orderedMoves.slice(0, 14);

  if (currentColor === aiColor) {
    let best = Number.NEGATIVE_INFINITY;
    for (const move of candidates) {
      const nextState = applyCandidateMove(state, currentColor, move);
      if (!nextState) {
        continue;
      }

      const score = minimax(nextState, nextState.turn, aiColor, depth - 1, alpha, beta);
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);

      if (beta <= alpha) {
        break;
      }
    }
    return best;
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

function pickHardMove(state: GameState, aiColor: Color, legalMoves: Move[]): Move | undefined {
  if (legalMoves.length === 0) {
    return undefined;
  }

  const pieceCount = Object.keys(state.pieces).length;
  const depth = pieceCount <= 10 ? 6 : pieceCount <= 16 ? 5 : 4;
  const orderedMoves = [...legalMoves].sort((a, b) => getQuickMoveScore(state, aiColor, b) - getQuickMoveScore(state, aiColor, a));
  const candidates = orderedMoves.slice(0, 16);

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestMoves: Move[] = [];

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

function selectAIMove(room: Room, legalMoves: Move[], aiColor: Color): Move | undefined {
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

function scheduleAiMove(io: SocketIOServer, room: Room): void {
  const aiColor = room.aiColor;
  if (!aiColor || room.aiMoveTimer || room.state.winner || room.state.turn !== aiColor) {
    return;
  }

  const delayMs = room.aiDifficulty === "easy" ? 260 : room.aiDifficulty === "medium" ? 340 : 430;
  room.aiMoveTimer = setTimeout(() => {
    room.aiMoveTimer = undefined;

    const currentRoom = rooms.get(room.id);
    const aiColor = currentRoom?.aiColor;
    if (!currentRoom || !aiColor || currentRoom.state.winner || currentRoom.state.turn !== aiColor) {
      return;
    }

    const legalMoves = getAllLegalMoves(currentRoom.state, aiColor);
    if (legalMoves.length === 0) {
      currentRoom.state = {
        ...currentRoom.state,
        winner: otherColor(aiColor),
        forcedPieceId: undefined,
        turnDeadlineAt: undefined
      };
      refreshTurnTimer(io, currentRoom);
      broadcastState(io, currentRoom);
      return;
    }

    const selected = selectAIMove(currentRoom, legalMoves, aiColor);
    if (!selected) {
      return;
    }
    const result = tryApplyMove(currentRoom.state, aiColor, {
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
    refreshTurnTimer(io, currentRoom);

    io.to(currentRoom.id).emit("move:accept", {
      roomId: currentRoom.id,
      move: result.move,
      by: aiColor
    });
    broadcastState(io, currentRoom);

    // Continue automatically for forced multi-captures.
    scheduleAiMove(io, currentRoom);
  }, delayMs);
}

function clearAI(room: Room): void {
  if (!room.aiColor) {
    return;
  }

  clearAiMoveTimer(room);

  const aiPlayer = room.state.players[room.aiColor];
  if (aiPlayer?.isAI) {
    delete room.state.players[room.aiColor];
  }

  room.aiColor = undefined;
  room.aiDifficulty = "medium";
}

function leaveRoom(io: SocketIOServer, socket: Socket): void {
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
    const playerColor = session.role as Color;
    delete room.state.players[playerColor];

    // If this was an AI match, remove the AI seat and reset.
    if (room.aiColor) {
      clearAI(room);
      resetBoardWithCurrentPlayers(room);
    }
  }

  room.restartVotes.clear();

  if (room.hostSocketId === socket.id) {
    const nextHost = room.sockets.values().next().value as string | undefined;
    room.hostSocketId = nextHost ?? "";
  }

  if (room.sockets.size === 0) {
    clearAiMoveTimer(room);
    clearTurnTimer(room);
    rooms.delete(room.id);
    return;
  }

  refreshTurnTimer(io, room);
  broadcastState(io, room);
}

function assignRole(room: Room, socketId: string, playerName: string): Role {
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

function resetBoardWithCurrentPlayers(room: Room): void {
  const players = {
    ...room.state.players
  };

  room.state = createInitialGameState(room.id);
  room.state.players = players;
}

function maybeEnableAIForRoom(room: Room, role: Role, enableAI?: boolean, requestedDifficulty?: unknown): void {
  if (!enableAI || room.aiColor || (role !== "RED" && role !== "BLACK")) {
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

export function registerSocketHandlers(io: SocketIOServer): void {
  io.on("connection", (socket) => {
    socket.on("room:join", (payload: JoinRoomPayload) => {
      if (!payload?.roomId?.trim()) {
        socket.emit("move:reject", { reason: "Room ID is required." });
        return;
      }

      if (sessions.has(socket.id)) {
        leaveRoom(io, socket);
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
      if (role !== "SPECTATOR") {
        refreshTurnTimer(io, room);
      }

      const result: JoinRoomResult = {
        roomId,
        role,
        isHost: room.hostSocketId === socket.id
      };

      socket.emit("room:joined", result);
      broadcastState(io, room);
      scheduleAiMove(io, room);
    });

    socket.on("move:try", (payload: MoveTryPayload) => {
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
      refreshTurnTimer(io, room);

      io.to(room.id).emit("move:accept", {
        roomId: room.id,
        move: result.move,
        by: session.role
      });
      broadcastState(io, room);
      scheduleAiMove(io, room);
    });

    socket.on("game:restart:request", (payload: { roomId: string }) => {
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
        refreshTurnTimer(io, room);
        io.to(room.id).emit("game:restart:accepted", { by: "HOST" });
        broadcastState(io, room);
        scheduleAiMove(io, room);
        return;
      }

      if (room.aiColor && (session.role === "RED" || session.role === "BLACK")) {
        resetBoardWithCurrentPlayers(room);
        room.restartVotes.clear();
        refreshTurnTimer(io, room);
        io.to(room.id).emit("game:restart:accepted", { by: "AI_MATCH" });
        broadcastState(io, room);
        scheduleAiMove(io, room);
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
        const votePayload: RestartVotePayload = {
          roomId: room.id,
          votes: Array.from(room.restartVotes)
        };

        io.to(room.id).emit("game:restart:vote", votePayload);
        return;
      }

      resetBoardWithCurrentPlayers(room);
      room.restartVotes.clear();
      refreshTurnTimer(io, room);
      io.to(room.id).emit("game:restart:accepted", { by: "BOTH_PLAYERS" });
      broadcastState(io, room);
      scheduleAiMove(io, room);
    });

    socket.on("game:resign", (payload: { roomId: string }) => {
      const session = sessions.get(socket.id);
      if (!session || session.roomId !== payload?.roomId) {
        socket.emit("move:reject", { reason: "You are not in this room." });
        return;
      }

      if (session.role !== "RED" && session.role !== "BLACK") {
        socket.emit("move:reject", { reason: "Only players can resign." });
        return;
      }

      const room = rooms.get(session.roomId);
      if (!room) {
        socket.emit("move:reject", { reason: "Room no longer exists." });
        return;
      }

      if (room.state.winner) {
        socket.emit("move:reject", { reason: "Game has already ended." });
        return;
      }

      const loser = session.role;
      const winner = otherColor(loser);
      room.state = {
        ...room.state,
        winner,
        forcedPieceId: undefined,
        turnDeadlineAt: undefined
      };
      room.restartVotes.clear();
      clearAiMoveTimer(room);
      stopTurnTimer(room);

      const resignedPayload: GameResignedPayload = {
        roomId: room.id,
        loser,
        winner
      };
      io.to(room.id).emit("game:resigned", resignedPayload);
      broadcastState(io, room);
    });

    socket.on("room:leave", () => {
      leaveRoom(io, socket);
    });

    socket.on("disconnect", () => {
      leaveRoom(io, socket);
    });
  });
}

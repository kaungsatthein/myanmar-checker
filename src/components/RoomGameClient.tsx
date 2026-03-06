"use client";

import { useEffect, useMemo, useState } from "react";

import { Board } from "./Board";
import { getSocket } from "../lib/socket";
import {
  createInitialGameState,
  getLegalMovesForPiece,
} from "../shared/engine";
import {
  AIDifficulty,
  Color,
  GameResignedPayload,
  GameTimeoutPayload,
  GameState,
  JoinRoomResult,
  Move,
  MoveAcceptPayload,
  MoveRejectPayload,
  Player,
  RestartVotePayload,
  Role,
} from "../shared/types";

type RoomGameClientProps = {
  roomId: string;
  playerName: string;
  enableAI: boolean;
  aiDifficulty: AIDifficulty;
};

type MoveEntry = {
  id: string;
  by: Color;
  move: Move;
};

const STARTING_PIECES_PER_SIDE = 12;

function getConnectionLabel(connected: boolean): string {
  return connected ? "Connected" : "Disconnected";
}

function getTurnLabel(state: GameState | null, role: Role): string {
  if (!state) {
    return "Waiting for game state";
  }

  if (state.winner) {
    if (role === state.winner) {
      return "You won";
    }

    return `Winner: ${state.winner}`;
  }

  if (state.forcedPieceId) {
    return `${state.turn} turn (must continue capture)`;
  }

  return `${state.turn} turn`;
}

function countPieces(state: GameState | null, color: Color): number {
  if (!state) {
    return 0;
  }

  return Object.values(state.pieces).filter((piece) => piece.color === color)
    .length;
}

function formatPlayerName(player?: Player): string {
  if (!player) {
    return "Waiting for player";
  }

  return player.isAI ? `${player.name} (AI)` : player.name;
}

function formatAIDifficultyLabel(level?: AIDifficulty): string {
  if (!level) {
    return "Medium";
  }

  return level.charAt(0).toUpperCase() + level.slice(1);
}

function formatCoord(coord: { r: number; c: number }): string {
  const file = String.fromCharCode(65 + coord.c);
  const rank = 8 - coord.r;
  return `${file}${rank}`;
}

function formatMoveText(entry: MoveEntry): string {
  const action = entry.move.captures.length > 0 ? "captures" : "moves";
  return `${entry.by} ${action} ${formatCoord(entry.move.from)} -> ${formatCoord(entry.move.to)}`;
}

function formatTimeLeft(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getInGameStatusLabel(state: GameState): string {
  if (state.forcedPieceId) {
    return `${state.turn} turn (must continue capture)`;
  }

  return `${state.turn} turn`;
}

export function RoomGameClient({
  roomId,
  playerName,
  enableAI,
  aiDifficulty,
}: RoomGameClientProps) {
  const [state, setState] = useState<GameState>(createInitialGameState(roomId));
  const [hasServerState, setHasServerState] = useState(false);
  const [role, setRole] = useState<Role>("SPECTATOR");
  const [isHost, setIsHost] = useState(false);
  const [selectedPieceId, setSelectedPieceId] = useState<string | undefined>(
    undefined,
  );
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("Joining room...");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [lastMove, setLastMove] = useState<Move | undefined>(undefined);
  const [moveHistory, setMoveHistory] = useState<MoveEntry[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [showWinnerDialog, setShowWinnerDialog] = useState(false);
  const [winnerDialogText, setWinnerDialogText] = useState("");
  const [winnerDialogKey, setWinnerDialogKey] = useState<string | undefined>(
    undefined,
  );

  const isPlayer = role === "RED" || role === "BLACK";
  const isMyTurn = isPlayer && state.turn === role && !state.winner;

  const legalMoves: Move[] = useMemo(() => {
    if (!selectedPieceId) {
      return [];
    }

    return getLegalMovesForPiece(state, selectedPieceId);
  }, [selectedPieceId, state]);

  useEffect(() => {
    setState(createInitialGameState(roomId));
    setHasServerState(false);
    setLastMove(undefined);
    setMoveHistory([]);
    setShowWinnerDialog(false);
    setWinnerDialogText("");
    setWinnerDialogKey(undefined);
  }, [roomId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handleConnect = () => {
      setConnected(true);
      setErrorMessage("");
      setStatusMessage("Connected. Waiting for seat assignment...");
    };

    const handleDisconnect = () => {
      setConnected(false);
      setStatusMessage("Disconnected from server.");
    };

    const handleConnectError = () => {
      setConnected(false);
      setStatusMessage("Could not reach multiplayer server.");
      setErrorMessage(
        "Socket server unavailable. Set NEXT_PUBLIC_SOCKET_URL to your deployed socket backend and redeploy Vercel.",
      );
    };

    const handleJoined = (payload: JoinRoomResult) => {
      setRole(payload.role);
      setIsHost(payload.isHost);

      if (payload.role === "SPECTATOR") {
        setStatusMessage(
          "Joined as spectator. Both player seats are occupied.",
        );
      } else {
        setStatusMessage(`Joined as ${payload.role}.`);
      }
    };

    const handleState = (incoming: GameState) => {
      setState(incoming);
      setHasServerState(true);
      setErrorMessage("");
      if (!incoming.winner) {
        setStatusMessage(getInGameStatusLabel(incoming));
      }
    };

    const handleReject = (payload: MoveRejectPayload) => {
      setErrorMessage(payload.reason);
    };

    const handleRestartVote = (payload: RestartVotePayload) => {
      const votes = payload.votes.join(" + ");
      setStatusMessage(`Restart vote pending: ${votes}`);
    };

    const handleRestartAccepted = (payload: {
      by: "HOST" | "BOTH_PLAYERS" | "AI_MATCH";
    }) => {
      const text =
        payload.by === "HOST"
          ? "Game restarted by host."
          : payload.by === "AI_MATCH"
            ? "Game restarted for AI match."
            : "Game restarted by both players.";
      setStatusMessage(text);
      setSelectedPieceId(undefined);
      setLastMove(undefined);
      setMoveHistory([]);
      setShowWinnerDialog(false);
      setWinnerDialogText("");
      setWinnerDialogKey(undefined);
    };

    const handleMoveAccepted = (payload: MoveAcceptPayload) => {
      setLastMove(payload.move);
      setMoveHistory((previous) => {
        const next: MoveEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          by: payload.by,
          move: payload.move,
        };

        return [...previous.slice(-19), next];
      });
      setErrorMessage("");
      setSelectedPieceId(undefined);
      setStatusMessage(
        `${payload.by} moved: ${formatCoord(payload.move.from)} -> ${formatCoord(payload.move.to)}`,
      );
    };

    const handleTimeout = (payload: GameTimeoutPayload) => {
      setStatusMessage(
        `${payload.loser} ran out of time. ${payload.winner} wins.`,
      );
    };

    const handleResigned = (payload: GameResignedPayload) => {
      setStatusMessage(`${payload.loser} resigned. ${payload.winner} wins.`);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("room:joined", handleJoined);
    socket.on("game:state", handleState);
    socket.on("move:reject", handleReject);
    socket.on("move:accept", handleMoveAccepted);
    socket.on("game:restart:vote", handleRestartVote);
    socket.on("game:restart:accepted", handleRestartAccepted);
    socket.on("game:timeout", handleTimeout);
    socket.on("game:resigned", handleResigned);

    if (!socket.connected) {
      socket.connect();
    }

    socket.emit("room:join", {
      roomId,
      playerName,
      enableAI,
      aiDifficulty,
    });

    return () => {
      socket.emit("room:leave");
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("room:joined", handleJoined);
      socket.off("game:state", handleState);
      socket.off("move:reject", handleReject);
      socket.off("move:accept", handleMoveAccepted);
      socket.off("game:restart:vote", handleRestartVote);
      socket.off("game:restart:accepted", handleRestartAccepted);
      socket.off("game:timeout", handleTimeout);
      socket.off("game:resigned", handleResigned);
    };
  }, [aiDifficulty, enableAI, playerName, roomId]);

  useEffect(() => {
    if (state.forcedPieceId && isMyTurn) {
      setSelectedPieceId(state.forcedPieceId);
      return;
    }

    if (!selectedPieceId) {
      return;
    }

    if (!state.pieces[selectedPieceId]) {
      setSelectedPieceId(undefined);
      return;
    }

    const nextMoves = getLegalMovesForPiece(state, selectedPieceId);
    if (nextMoves.length === 0) {
      setSelectedPieceId(undefined);
    }
  }, [isMyTurn, selectedPieceId, state]);

  useEffect(() => {
    if (!state.winner) {
      setWinnerDialogKey(undefined);
      return;
    }

    if (role === state.winner) {
      setStatusMessage("You won this match.");
      setShowWinnerDialog(false);
      setWinnerDialogText("");
      return;
    }

    setStatusMessage(`${state.winner} won this match.`);
    const key = `${roomId}-${state.winner}`;
    if (winnerDialogKey === key) {
      return;
    }

    setWinnerDialogKey(key);
    setWinnerDialogText(`Congratulations ${state.winner}!`);
    setShowWinnerDialog(true);
  }, [role, roomId, state.winner, winnerDialogKey]);

  const redLeft = countPieces(state, "RED");
  const blackLeft = countPieces(state, "BLACK");

  const redCaptured = Math.max(0, STARTING_PIECES_PER_SIDE - blackLeft);
  const blackCaptured = Math.max(0, STARTING_PIECES_PER_SIDE - redLeft);
  const hasAIPlayer = Boolean(
    state.players.RED?.isAI || state.players.BLACK?.isAI,
  );
  const aiLabel = state.players.RED?.isAI
    ? state.players.RED.aiDifficulty
    : state.players.BLACK?.isAI
      ? state.players.BLACK.aiDifficulty
      : undefined;
  const turnTimeLeftMs = state.turnDeadlineAt
    ? Math.max(0, state.turnDeadlineAt - nowMs)
    : 0;
  const timerCritical = turnTimeLeftMs > 0 && turnTimeLeftMs <= 10_000;
  const timeLabel = state.turnDeadlineAt
    ? formatTimeLeft(turnTimeLeftMs)
    : "--:--";
  const loseStatus = !isPlayer
    ? "N/A"
    : state.winner
      ? state.winner === role
        ? "No"
        : "Yes"
      : "Yes";

  const onPieceSelect = (pieceId: string) => {
    if (!isMyTurn || !hasServerState) {
      return;
    }

    const piece = state.pieces[pieceId];
    if (!piece || piece.color !== role) {
      return;
    }

    const moves = getLegalMovesForPiece(state, pieceId);
    if (moves.length === 0) {
      setErrorMessage("That piece has no legal move.");
      return;
    }

    setErrorMessage("");
    setSelectedPieceId(pieceId);
  };

  const onMoveSelect = (move: Move) => {
    if (!isMyTurn || !hasServerState) {
      return;
    }

    const socket = getSocket();
    socket.emit("move:try", {
      roomId,
      from: move.from,
      to: move.to,
      path: move.path,
    });
  };

  const onRestartClick = () => {
    if (!hasServerState) {
      setErrorMessage("Cannot restart until connected to multiplayer server.");
      return;
    }

    const socket = getSocket();
    socket.emit("game:restart:request", { roomId });
  };

  const onResignClick = () => {
    if (!isPlayer || state.winner) {
      return;
    }

    const confirmed = window.confirm("Resign this match and lose immediately?");
    if (!confirmed) {
      return;
    }

    const socket = getSocket();
    socket.emit("game:resign", { roomId });
  };

  const restartEnabled = isHost || isPlayer;
  const resignEnabled = isPlayer && !state.winner && hasServerState;

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="header-title">
          <h1>Myanmar Checker</h1>
          <p>
            Room <strong>{roomId}</strong>
          </p>
        </div>

        <div className="chip-row">
          <div className="stat-chip">
            <span className="chip-label">You</span>
            <span className="chip-value">{role}</span>
          </div>
          <div className="stat-chip">
            <span className="chip-label">Connection</span>
            <span className={connected ? "chip-value ok" : "chip-value warn"}>
              {getConnectionLabel(connected)}
            </span>
          </div>
          <div className="stat-chip">
            <span className="chip-label">Turn</span>
            <span className="chip-value">{getTurnLabel(state, role)}</span>
          </div>
          <div className="stat-chip">
            <span className="chip-label">Host</span>
            <span className="chip-value">{isHost ? "Yes" : "No"}</span>
          </div>
          <div className="stat-chip">
            <span className="chip-label">Mode</span>
            <span className="chip-value">
              {hasAIPlayer
                ? `Multiplayer + AI (${formatAIDifficultyLabel(aiLabel)})`
                : "Multiplayer"}
            </span>
          </div>
          <div className="stat-chip">
            <span className="chip-label">Turn Time</span>
            <span className={timerCritical ? "chip-value warn" : "chip-value"}>
              {timeLabel}
            </span>
          </div>
          <div className="stat-chip">
            <span className="chip-label">Can Lose</span>
            <span className="chip-value">{loseStatus}</span>
          </div>
        </div>
      </header>

      <section className="score-strip">
        <article className="score-card score-red">
          <h2>Red</h2>
          <p>{formatPlayerName(state?.players.RED)}</p>
          <p>Captured {redCaptured}</p>
        </article>
        <article className="score-card score-black">
          <h2>Black</h2>
          <p>{formatPlayerName(state?.players.BLACK)}</p>
          <p>Captured {blackCaptured}</p>
        </article>
        <div className="action-stack">
          <button
            type="button"
            className="restart-btn"
            onClick={onRestartClick}
            disabled={!restartEnabled}
          >
            Restart
          </button>
          <button
            type="button"
            className="resign-btn"
            onClick={onResignClick}
            disabled={!resignEnabled}
          >
            Lose Match
          </button>
        </div>
      </section>

      <p className="status-line">{statusMessage}</p>
      {errorMessage ? <p className="error-line">{errorMessage}</p> : null}

      <Board
        state={state}
        myRole={role}
        canInteract={isMyTurn && hasServerState}
        selectedPieceId={selectedPieceId}
        lastMove={lastMove}
        legalMoves={legalMoves}
        onPieceSelect={onPieceSelect}
        onMoveSelect={onMoveSelect}
      />

      <section className="move-log">
        <h3>Move Transactions</h3>
        {moveHistory.length === 0 ? (
          <p className="move-log-empty">No moves yet.</p>
        ) : (
          <ol>
            {[...moveHistory].reverse().map((entry) => (
              <li key={entry.id}>{formatMoveText(entry)}</li>
            ))}
          </ol>
        )}
      </section>

      {showWinnerDialog ? (
        <div className="winner-dialog-backdrop" role="presentation">
          <div
            className="winner-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Match result"
          >
            <h3>Match Result</h3>
            <p>{winnerDialogText}</p>
            <button
              type="button"
              className="primary-btn"
              onClick={() => setShowWinnerDialog(false)}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

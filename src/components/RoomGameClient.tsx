"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Board } from "./Board";
import { getSocket } from "../lib/socket";
import {
  createInitialGameState,
  getLegalMovesForPiece,
  otherColor,
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

const STARTING_PIECES_PER_SIDE = 12;

function getConnectionLabel(connected: boolean): string {
  return connected ? "Connected" : "Disconnected";
}

function mapColorForViewer(color: Color, viewerRole: Role): Color {
  if (viewerRole !== "RED" && viewerRole !== "BLACK") {
    return color;
  }

  return color === viewerRole ? "BLACK" : "RED";
}

function mapRoleForViewer(role: Role): Role {
  if (role !== "RED" && role !== "BLACK") {
    return role;
  }

  return "BLACK";
}

function getTurnLabel(state: GameState | null, viewerRole: Role): string {
  if (!state) {
    return "Waiting for game state";
  }

  if (state.winner) {
    return "Match ended";
  }

  if (state.forcedPieceId) {
    return `${mapColorForViewer(state.turn, viewerRole)} turn (must continue capture)`;
  }

  return `${mapColorForViewer(state.turn, viewerRole)} turn`;
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

function formatTimeLeft(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getInGameStatusLabel(state: GameState, viewerRole: Role): string {
  if (state.forcedPieceId) {
    return `${mapColorForViewer(state.turn, viewerRole)} turn (must continue capture)`;
  }

  return `${mapColorForViewer(state.turn, viewerRole)} turn`;
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
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [showWinnerDialog, setShowWinnerDialog] = useState(false);
  const [winnerDialogText, setWinnerDialogText] = useState("");
  const [showResignDialog, setShowResignDialog] = useState(false);
  const [hasSeenPlayableState, setHasSeenPlayableState] = useState(false);
  const roleRef = useRef<Role>("SPECTATOR");
  const previousWinnerRef = useRef<Color | undefined>(undefined);

  const playerColor = role === "RED" || role === "BLACK" ? role : null;
  const isPlayer = playerColor !== null;
  const isMyTurn =
    playerColor !== null && state.turn === playerColor && !state.winner;

  const legalMoves: Move[] = useMemo(() => {
    if (!selectedPieceId) {
      return [];
    }

    return getLegalMovesForPiece(state, selectedPieceId);
  }, [selectedPieceId, state]);

  useEffect(() => {
    setState(createInitialGameState(roomId));
    setHasServerState(false);
    setRole("SPECTATOR");
    roleRef.current = "SPECTATOR";
    setLastMove(undefined);
    setShowWinnerDialog(false);
    setWinnerDialogText("");
    setShowResignDialog(false);
    setHasSeenPlayableState(false);
    previousWinnerRef.current = undefined;
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
      roleRef.current = payload.role;
      setRole(payload.role);
      setIsHost(payload.isHost);

      if (payload.role === "SPECTATOR") {
        setStatusMessage(
          "Joined as spectator. Both player seats are occupied.",
        );
      } else {
        setStatusMessage(`Joined as ${mapRoleForViewer(payload.role)}.`);
      }
    };

    const handleState = (incoming: GameState) => {
      setState(incoming);
      setHasServerState(true);
      setErrorMessage("");

      if (incoming.players.RED && incoming.players.BLACK && !incoming.winner) {
        setHasSeenPlayableState(true);
      }

      if (!incoming.winner) {
        setStatusMessage(getInGameStatusLabel(incoming, roleRef.current));
      }
    };

    const handleReject = (payload: MoveRejectPayload) => {
      setErrorMessage(payload.reason);
    };

    const handleRestartVote = (payload: RestartVotePayload) => {
      const votes = payload.votes
        .map((vote) => mapColorForViewer(vote, roleRef.current))
        .join(" + ");
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
      setShowWinnerDialog(false);
      setWinnerDialogText("");
      setShowResignDialog(false);
      previousWinnerRef.current = undefined;
    };

    const handleMoveAccepted = (payload: MoveAcceptPayload) => {
      setLastMove(payload.move);
      setErrorMessage("");
      setSelectedPieceId(undefined);
      setStatusMessage(
        `${mapColorForViewer(payload.by, roleRef.current)} moved: ${formatCoord(payload.move.from)} -> ${formatCoord(payload.move.to)}`,
      );
    };

    const handleTimeout = (payload: GameTimeoutPayload) => {
      setShowResignDialog(false);
      setStatusMessage(
        `${mapColorForViewer(payload.loser, roleRef.current)} ran out of time. ${mapColorForViewer(payload.winner, roleRef.current)} wins.`,
      );
    };

    const handleResigned = (payload: GameResignedPayload) => {
      setShowResignDialog(false);
      setStatusMessage(
        `${mapColorForViewer(payload.loser, roleRef.current)} resigned. ${mapColorForViewer(payload.winner, roleRef.current)} wins.`,
      );
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
      previousWinnerRef.current = undefined;
      return;
    }

    if (previousWinnerRef.current === state.winner) {
      return;
    }
    previousWinnerRef.current = state.winner;

    if (!hasSeenPlayableState) {
      return;
    }

    if (role === state.winner) {
      setStatusMessage("You won this match.");
      setWinnerDialogText("Congratulations! You won this match.");
    } else if (isPlayer) {
      const winnerLabel = mapColorForViewer(state.winner, role);
      setStatusMessage(`${winnerLabel} won this match.`);
      setWinnerDialogText(`${winnerLabel} wins this match.`);
    } else {
      const winnerLabel = mapColorForViewer(state.winner, role);
      setStatusMessage(`${winnerLabel} won this match.`);
      setWinnerDialogText(`Match finished. ${winnerLabel} wins.`);
    }

    setShowResignDialog(false);
    setShowWinnerDialog(true);
  }, [hasSeenPlayableState, isPlayer, role, state.winner]);

  const redLeft = countPieces(state, "RED");
  const blackLeft = countPieces(state, "BLACK");

  const redCaptured = Math.max(0, STARTING_PIECES_PER_SIDE - blackLeft);
  const blackCaptured = Math.max(0, STARTING_PIECES_PER_SIDE - redLeft);
  const blackSideActualColor: Color = playerColor ?? "BLACK";
  const redSideActualColor: Color = playerColor
    ? otherColor(playerColor)
    : "RED";
  const capturedByActualColor: Record<Color, number> = {
    RED: redCaptured,
    BLACK: blackCaptured,
  };
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
      ? state.winner === playerColor
        ? "No"
        : "Yes"
      : "Yes";

  const onPieceSelect = (pieceId: string) => {
    if (!isMyTurn || !hasServerState) {
      return;
    }

    const piece = state.pieces[pieceId];
    if (!piece || !playerColor || piece.color !== playerColor) {
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

    setShowResignDialog(true);
  };

  const onCancelResign = () => {
    setShowResignDialog(false);
  };

  const onConfirmResign = () => {
    if (!isPlayer || state.winner) {
      setShowResignDialog(false);
      return;
    }

    const socket = getSocket();
    socket.emit("game:resign", { roomId });
    setShowResignDialog(false);
  };

  const restartEnabled = isHost || isPlayer;
  const resignEnabled = isPlayer && !state.winner && hasServerState;
  const forcedPiece = state.forcedPieceId
    ? state.pieces[state.forcedPieceId]
    : undefined;
  const forcedMoveHint = forcedPiece
    ? `You must continue with ${mapColorForViewer(forcedPiece.color, role)} at ${formatCoord({ r: forcedPiece.row, c: forcedPiece.col })}.`
    : "Select one of your pieces and move to a highlighted legal square.";

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="header-title">
          <h1>Myanmar Checker</h1>
          {/* <p>
            Room <strong>{roomId}</strong>
          </p> */}
        </div>
      </header>

      {/* <p className="status-line">{statusMessage}</p> */}

      <section className="game-main">
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

        <aside className="stat-sidebar" aria-label="Room status">
          <div className="chip-column">
            <div className="stat-chip">
              <span className="chip-label">You</span>
              <span className="chip-value">{mapRoleForViewer(role)}</span>
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
              <span
                className={timerCritical ? "chip-value warn" : "chip-value"}
              >
                {timeLabel}
              </span>
            </div>
            <div className="stat-chip">
              <span className="chip-label">Can Lose</span>
              <span className="chip-value">{loseStatus}</span>
            </div>
          </div>

          <section className="score-strip">
            <article className="score-card score-black">
              <h2>Black</h2>
              <p>{formatPlayerName(state?.players[blackSideActualColor])}</p>
              <p>Captured {capturedByActualColor[blackSideActualColor]}</p>
            </article>
            <article className="score-card score-red">
              <h2>Red</h2>
              <p>{formatPlayerName(state?.players[redSideActualColor])}</p>
              <p>Captured {capturedByActualColor[redSideActualColor]}</p>
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
        </aside>
      </section>

      {errorMessage ? (
        <div className="winner-dialog-backdrop" role="presentation">
          <div
            className="winner-dialog error-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label="Move error"
          >
            <h3>Invalid Move</h3>
            <p>{errorMessage}</p>
            <p className="error-hint">{forcedMoveHint}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => setErrorMessage("")}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

      {showResignDialog ? (
        <div className="winner-dialog-backdrop" role="presentation">
          <div
            className="winner-dialog confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm resign"
          >
            <h3>Lose This Match?</h3>
            <p>Resign this match and lose immediately?</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={onCancelResign}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn confirm-danger-btn"
                onClick={onConfirmResign}
              >
                Confirm Lose
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

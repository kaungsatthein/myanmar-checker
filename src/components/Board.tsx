"use client";

import { Color, GameState, Move, Role } from "../shared/types";

type BoardProps = {
  state: GameState;
  myRole: Role;
  canInteract: boolean;
  selectedPieceId?: string;
  lastMove?: Move;
  legalMoves: Move[];
  onPieceSelect: (pieceId: string) => void;
  onMoveSelect: (move: Move) => void;
};

function squareKey(row: number, col: number): string {
  return `${row}-${col}`;
}

function mapColorForViewer(color: Color, role: Role): Color {
  if (role !== "RED" && role !== "BLACK") {
    return color;
  }

  return color === role ? "BLACK" : "RED";
}

export function Board({
  state,
  myRole,
  canInteract,
  selectedPieceId,
  lastMove,
  legalMoves,
  onPieceSelect,
  onMoveSelect
}: BoardProps) {
  const boardSize = state.board.length;
  const shouldFlipBoard = myRole === "RED";
  const rowOrder = Array.from({ length: boardSize }, (_, index) =>
    shouldFlipBoard ? boardSize - 1 - index : index
  );
  const colOrder = Array.from({ length: boardSize }, (_, index) =>
    shouldFlipBoard ? boardSize - 1 - index : index
  );

  const moveTargets = new Map<string, Move>();
  for (const move of legalMoves) {
    moveTargets.set(squareKey(move.to.r, move.to.c), move);
  }

  const activePlayerColor = myRole === "RED" || myRole === "BLACK" ? myRole : null;

  return (
    <div className="board-wrap">
      <div className="board" role="grid" aria-label="Myanmar checkers board">
        {rowOrder.map((rowIndex, visualRowIndex) =>
          colOrder.map((colIndex, visualColIndex) => {
            const cellKey = squareKey(rowIndex, colIndex);
            const pieceId = state.board[rowIndex][colIndex];
            const piece = pieceId ? state.pieces[pieceId] : undefined;
            const displayColor = piece ? mapColorForViewer(piece.color, myRole) : undefined;
            const isDark = (rowIndex + colIndex) % 2 === 1;
            const targetMove = moveTargets.get(cellKey);
            const hasCapture = Boolean(targetMove && targetMove.captures.length > 0);
            const isSelected = selectedPieceId === pieceId;
            const isForced = state.forcedPieceId === pieceId;
            const isLastFrom = Boolean(lastMove && lastMove.from.r === rowIndex && lastMove.from.c === colIndex);
            const isLastTo = Boolean(lastMove && lastMove.to.r === rowIndex && lastMove.to.c === colIndex);

            const onClick = () => {
              if (!canInteract) {
                return;
              }

              if (targetMove) {
                onMoveSelect(targetMove);
                return;
              }

              if (!piece || !activePlayerColor || piece.color !== activePlayerColor) {
                return;
              }

              onPieceSelect(piece.id);
            };

            return (
              <button
                key={cellKey}
                type="button"
                className={[
                  "square",
                  isDark ? "square-dark" : "square-light",
                  targetMove ? "square-legal" : "",
                  hasCapture ? "square-capture" : "",
                  isSelected ? "square-selected" : "",
                  isForced ? "square-forced" : "",
                  isLastFrom ? "square-last-from" : "",
                  isLastTo ? "square-last-to" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={onClick}
                disabled={!canInteract && !targetMove}
                aria-label={`row ${visualRowIndex + 1}, column ${visualColIndex + 1}`}
              >
                {piece ? (
                  <span
                    className={[
                      "piece",
                      displayColor === "RED" ? "piece-red" : "piece-black",
                      piece.isKing ? "piece-king-piece" : "",
                      isLastTo ? "piece-last-moved" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-label={piece.isKing ? `${displayColor} king` : displayColor}
                  >
                    {piece.isKing ? (
                      <span className="piece-crown" aria-hidden="true">
                        <svg viewBox="0 0 64 64" focusable="false">
                          <path d="M8 46h48l-4 10H12L8 46zm4-4 7-22 13 12 13-12 7 22H12z" />
                          <circle cx="19" cy="18" r="4" />
                          <circle cx="32" cy="11" r="4.5" />
                          <circle cx="45" cy="18" r="4" />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

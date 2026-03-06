# Myanmar Dama (Checkers) Multiplayer

Real-time Myanmar Dama built with Next.js + TypeScript + Socket.IO.

## Overview

This project provides:

- 8x8 Myanmar checkers board
- Real-time multiplayer rooms (`roomId`)
- Server-authoritative game logic and move validation
- Optional AI opponent with 3 difficulties
- Turn timer, timeout loss, and resign flow

## Tech Stack

- Next.js 15 (App Router)
- React 19
- TypeScript
- Socket.IO (`socket.io`, `socket.io-client`)
- Node runtime with `tsx`

## Core Gameplay Rules

- Two sides: `RED` and `BLACK`
- Normal piece:
  - moves diagonally forward by 1
  - captures by jumping over opponent to empty landing square
- Mandatory capture:
  - if any capture exists, non-capture move is illegal
- Multi-capture:
  - if capture continues from same piece, player must continue
- King (Myanmar style in this project):
  - moves diagonally forward/backward any distance
  - long-range capture with exactly one opponent on path and empty landing after
- Winner:
  - opponent has no pieces, no legal moves, resigns, or runs out of turn time

## Current Features

- Room join/create via `/`
- Game screen at `/room/[roomId]`
- Spectator mode when both player slots are occupied
- AI match mode (`easy`, `medium`, `hard`)
- Move transaction log in UI
- Last-move highlight and checker move animation
- Turn countdown (30s)
- Restart system:
  - host can force restart
  - or both players vote
  - AI match player can restart directly
- Resign button (`Lose Match`)
- Winner dialog for losing players

## Project Structure

- `app/` - Next.js routes
- `src/components/` - game UI (`RoomGameClient`, `Board`)
- `src/shared/` - shared types + pure game engine
- `src/server/socket.ts` - authoritative socket room/game handlers
- `socket-server/index.ts` - standalone socket server entry
- `server.ts` - combined Next + socket server entry (alternative run mode)

## Local Development

Install dependencies:

```bash
npm install
```

Run web + socket together:

```bash
npm run dev
```

This starts:

- Web: `http://localhost:5178`
- Socket: `http://localhost:4001`

Run only web:

```bash
npm run dev:web
```

Run only socket:

```bash
npm run dev:socket
```

## Scripts

- `npm run dev` - web + socket concurrently
- `npm run dev:web` - Next dev server on `5178`
- `npm run dev:socket` - socket server on `4001`
- `npm run build` - production build
- `npm run start` - production Next+socket combined server
- `npm run start:socket` - production socket-only server
- `npm run typecheck` - TypeScript check
- `npm run lint` - Next lint

## Environment Variables

### Web (Next.js)

- `NEXT_PUBLIC_SOCKET_URL` (required in production)
  - Example: `https://<your-socket-backend>.onrender.com`

If missing, client falls back to `window.location.origin`.

### Socket server

- `PORT` or `SOCKET_PORT` - listening port
- `HOST` - bind host (default `0.0.0.0`)
- `CORS_ORIGIN` - comma-separated allowed origins, or `*`
- `NEXT_PUBLIC_APP_URL` - optional fallback for CORS origin

## Socket Event Contract

### Client -> Server

- `room:join`
  - `{ roomId, playerName, enableAI?, aiDifficulty? }`
- `move:try`
  - `{ roomId, from, to, path? }`
- `game:restart:request`
  - `{ roomId }`
- `game:resign`
  - `{ roomId }`
- `room:leave`

### Server -> Client

- `room:joined`
  - `{ roomId, role, isHost }`
- `game:state`
  - full `GameState` (authoritative state)
- `move:accept`
  - `{ roomId, move, by }`
- `move:reject`
  - `{ reason }`
- `game:restart:vote`
  - `{ roomId, votes }`
- `game:restart:accepted`
  - `{ by: "HOST" | "BOTH_PLAYERS" | "AI_MATCH" }`
- `game:timeout`
  - `{ roomId, loser, winner }`
- `game:resigned`
  - `{ roomId, loser, winner }`

## Shared Engine (Pure Functions)

`src/shared/engine.ts` exposes pure rule functions:

- `createInitialGameState(roomId)`
- `getAllLegalMoves(state, color)`
- `getLegalMovesForPiece(state, pieceId)`
- `applyMove(state, move)`
- `tryApplyMove(state, actorColor, payload)`
- `evaluateWinner(state)`

The socket server is the only authoritative writer of game state.

## Production Deployment (Recommended)

### 1. Deploy web to Vercel

```bash
npx vercel --prod
```

### 2. Deploy socket backend (Render / Railway / any Node host)

Run socket server with:

```bash
npm run start:socket
```

Ensure health endpoint is reachable:

- `GET /health` -> `200 {"ok": true}`

### 3. Connect web to socket backend

Set in Vercel project env:

- `NEXT_PUBLIC_SOCKET_URL=https://<socket-backend-domain>`

Redeploy Vercel afterward.

## Notes

- Rooms are in-memory on the socket server (no DB persistence).
- Restarting socket service clears active rooms/matches.
- For production scaling across instances, add shared state/adapter (for example Redis + Socket.IO adapter).

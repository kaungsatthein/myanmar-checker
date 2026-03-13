"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AIDifficulty } from "../src/shared/types";

function makeRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function HomePage() {
  const router = useRouter();
  const [roomId, setRoomId] = useState<string>(makeRoomId());
  const [playerName, setPlayerName] = useState<string>("");
  const [playWithAI, setPlayWithAI] = useState<boolean>(false);
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>("medium");
  const [copyLabel, setCopyLabel] = useState<"Copy" | "Copied">("Copy");

  useEffect(() => {
    if (copyLabel === "Copy") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyLabel("Copy");
    }, 1600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyLabel]);

  const onCopyRoomId = async () => {
    const normalizedRoomId = roomId.trim().toUpperCase();
    if (!normalizedRoomId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(normalizedRoomId);
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Copy");
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedRoomId = roomId.trim().toUpperCase();
    if (!normalizedRoomId) {
      return;
    }

    const normalizedName = playerName.trim() || "Guest";
    const search = new URLSearchParams({
      name: normalizedName,
    });

    if (playWithAI) {
      search.set("ai", "1");
      search.set("aiLevel", aiDifficulty);
    }

    router.push(`/room/${normalizedRoomId}?${search.toString()}`);
  };

  return (
    <main className="landing-shell">
      <section className="landing-card">
        <p className="eyebrow">Real-time multiplayer</p>
        <h1>Myanmar Checker</h1>
        <p className="subline">
          Create or join a room and play with server-authoritative move
          validation.
        </p>

        <form className="join-form" onSubmit={onSubmit}>
          <label htmlFor="playerName">Player name</label>
          <input
            id="playerName"
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            placeholder="Enter your name"
            maxLength={24}
          />

          <label htmlFor="roomId">Room ID</label>
          <div className="room-row">
            <input
              id="roomId"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              placeholder="Room ID"
              maxLength={12}
            />
            <button
              type="button"
              className="ghost-btn room-action-btn"
              onClick={onCopyRoomId}
            >
              {copyLabel}
            </button>
            <button
              type="button"
              className="ghost-btn room-action-btn"
              onClick={() => setRoomId(makeRoomId())}
            >
              Random
            </button>
          </div>

          <label className="join-toggle" htmlFor="playWithAI">
            <input
              id="playWithAI"
              type="checkbox"
              checked={playWithAI}
              onChange={(event) => setPlayWithAI(event.target.checked)}
            />
            <span>Play vs AI (auto-fills missing opponent)</span>
          </label>

          {playWithAI ? (
            <>
              <label htmlFor="aiLevel">AI difficulty</label>
              <select
                id="aiLevel"
                value={aiDifficulty}
                onChange={(event) =>
                  setAiDifficulty(event.target.value as AIDifficulty)
                }
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </>
          ) : null}

          <button type="submit" className="primary-btn">
            Join Room
          </button>
        </form>
      </section>
    </main>
  );
}

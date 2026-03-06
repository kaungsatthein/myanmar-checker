import { RoomGameClient } from "../../../src/components/RoomGameClient";
import type { AIDifficulty } from "../../../src/shared/types";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
  searchParams: Promise<{
    name?: string;
    ai?: string;
    aiLevel?: string;
  }>;
};

function parseAIDifficulty(value?: string): AIDifficulty {
  if (value === "easy" || value === "medium" || value === "hard") {
    return value;
  }

  return "medium";
}

export default async function RoomPage({ params, searchParams }: RoomPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const roomId = resolvedParams.roomId;
  const playerName = typeof resolvedSearchParams.name === "string" ? resolvedSearchParams.name : "Guest";
  const enableAI = ["1", "true", "yes", "on"].includes((resolvedSearchParams.ai ?? "").toLowerCase());
  const aiDifficulty = parseAIDifficulty(resolvedSearchParams.aiLevel?.toLowerCase());

  return <RoomGameClient roomId={roomId} playerName={playerName} enableAI={enableAI} aiDifficulty={aiDifficulty} />;
}

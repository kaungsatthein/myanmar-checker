import type { Metadata } from "next";

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

export async function generateMetadata({
  params,
}: RoomPageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const roomId = resolvedParams.roomId.toUpperCase();

  return {
    title: `Room ${roomId}`,
    description: `Join Myanmar Checkers room ${roomId} and play a real-time multiplayer match.`,
    alternates: {
      canonical: `/room/${roomId}`,
    },
    openGraph: {
      title: `Myanmar Checkers Room ${roomId}`,
      description: `Join room ${roomId} and start a real-time Myanmar Checkers match.`,
      url: `/room/${roomId}`,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `Myanmar Checkers Room ${roomId}`,
      description: `Join room ${roomId} and start a real-time Myanmar Checkers match.`,
    },
  };
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

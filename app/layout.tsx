import type { Metadata } from "next";
import { Cinzel, Manrope } from "next/font/google";

import "./globals.css";

const display = Cinzel({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700"],
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL
  ? new URL(process.env.NEXT_PUBLIC_APP_URL)
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    : new URL("https://myanmar-checker-two.vercel.app");

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "Myanmar Checkers Multiplayer",
    template: "%s | Myanmar Checkers Multiplayer",
  },
  description:
    "Play Myanmar Checkers online in real time with friends or challenge the AI. Server-authoritative gameplay built with Next.js and Socket.IO.",
  keywords: [
    "Myanmar checkers",
    "Myanmar dama",
    "online checkers",
    "multiplayer checkers",
    "Socket.IO game",
    "Next.js game",
  ],
  applicationName: "Myanmar Checkers Multiplayer",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Myanmar Checkers Multiplayer",
    title: "Myanmar Checkers Multiplayer",
    description:
      "Play Myanmar Checkers online in real time with friends or challenge the AI.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Myanmar Checkers Multiplayer",
    description:
      "Play Myanmar Checkers online in real time with friends or challenge the AI.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}

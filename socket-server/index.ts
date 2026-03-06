import { createServer } from "http";

import { Server as SocketIOServer } from "socket.io";

import { registerSocketHandlers } from "../src/server/socket";

function getCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "*";
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (values.length === 0 || values.includes("*")) {
    return "*";
  }

  return values;
}

const port = Number(process.env.SOCKET_PORT || process.env.PORT || 4001);
const host = process.env.HOST || "0.0.0.0";

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not Found");
});

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: getCorsOrigin(),
    methods: ["GET", "POST"]
  }
});

registerSocketHandlers(io);

httpServer.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Socket server running on http://${host}:${port}`);
});

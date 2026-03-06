import { createServer } from "http";

import next from "next";
import { Server as SocketIOServer } from "socket.io";

import { registerSocketHandlers } from "./src/server/socket";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 5178);

async function bootstrap(): Promise<void> {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const httpServer = createServer((req, res) => {
    void handle(req, res);
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*"
    }
  });

  registerSocketHandlers(io);

  httpServer.listen(port, hostname, () => {
    // eslint-disable-next-line no-console
    console.log(`> Ready on http://${hostname}:${port}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});

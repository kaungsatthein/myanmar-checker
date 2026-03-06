import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const socketUrl =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (typeof window !== "undefined" ? window.location.origin : undefined);

    socket = io(socketUrl, {
      autoConnect: false,
      transports: ["websocket", "polling"]
    });
  }

  return socket;
}

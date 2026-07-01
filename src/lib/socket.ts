import { io } from "socket.io-client";

function resolveSocketUrl() {
  if (import.meta.env.VITE_SOCKET_URL) {
    return import.meta.env.VITE_SOCKET_URL;
  }

  if (window.location.protocol === "capacitor:") {
    return "http://10.0.2.2:3001";
  }

  if (window.location.port === "5173") {
    return "http://localhost:3001";
  }

  return window.location.origin;
}

export const socket = io(resolveSocketUrl(), {
  autoConnect: false,
  transports: ["websocket", "polling"]
});

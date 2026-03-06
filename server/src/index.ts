import { createServer } from "http";
import { Server } from "socket.io";
import type { TypedServer, TypedSocket } from "./types.js";
import { handleConnection } from "./roomManager.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["http://localhost:3000"];

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io: TypedServer = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket: TypedSocket) => {
  handleConnection(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(`Erfindung server listening on port ${PORT}`);
  console.log(`CORS origins: ${CORS_ORIGINS.join(", ")}`);
});

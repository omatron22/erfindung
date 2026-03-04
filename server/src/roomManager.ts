import crypto from "crypto";
import type { TypedServer, TypedSocket, Room, PlayerSlot } from "./types.js";
import type { LobbyPlayer, LobbyConfig } from "@/shared/types/messages";
import type { BuildingStyle } from "@/shared/types/config";
import { BUILDING_STYLES, TURN_TIMER_OPTIONS, VP_OPTIONS, BOT_PERSONALITIES } from "@/shared/types/config";
import type { BotPersonality } from "@/shared/types/config";
import { PLAYER_COLORS } from "@/shared/types/game";
import { handleStartGame, handleGameAction, scheduleBotActions, broadcastState } from "./gameSession.js";
import { filterStateForPlayer } from "./stateFilter.js";

const DEFAULT_LOBBY_CONFIG: LobbyConfig = {
  fairDice: false,
  friendlyRobber: false,
  gameMode: "classic",
  vpToWin: 10,
  turnTimer: 0,
};

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>(); // socketId → roomCode

// Letters excluding I/O to avoid confusion
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function generateRoomCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function generateToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function getRoomForSocket(socketId: string): Room | undefined {
  const code = socketToRoom.get(socketId);
  return code ? rooms.get(code) : undefined;
}

export function getPlayerSlot(room: Room, socketId: string): PlayerSlot | undefined {
  return room.players.find((p) => p.socketId === socketId);
}

function getHostIndex(room: Room): number {
  const idx = room.players.findIndex((p) => p.socketId === room.hostSocketId);
  return idx >= 0 ? idx : 0;
}

function firstUnusedColor(room: Room): string {
  const used = new Set(room.players.map((p) => p.color));
  return PLAYER_COLORS.find((c) => !used.has(c)) ?? "red";
}

function toLobbyPlayers(room: Room): LobbyPlayer[] {
  return room.players.map((p) => ({
    index: p.index,
    name: p.name,
    isBot: p.isBot,
    isReady: p.isBot || p.socketId !== null,
    color: p.color,
    buildingStyle: p.buildingStyle,
  }));
}

function broadcastLobbyState(io: TypedServer, room: Room) {
  io.to(room.code).emit("room:lobby-state", {
    players: toLobbyPlayers(room),
    config: room.lobbyConfig,
    hostIndex: getHostIndex(room),
  });
}

export function handleConnection(io: TypedServer, socket: TypedSocket) {
  socket.on("room:join", ({ roomCode, playerName, reconnectToken }) => {
    handleJoin(io, socket, roomCode, playerName, reconnectToken);
  });

  socket.on("room:leave", () => {
    handleLeave(io, socket);
  });

  socket.on("room:add-bot", ({ difficulty, personality }) => {
    handleAddBot(io, socket, difficulty, personality);
  });

  socket.on("room:remove-bot", ({ playerIndex }) => {
    handleRemoveBot(io, socket, playerIndex);
  });

  socket.on("room:start-game", () => {
    handleStartGame(io, socket);
  });

  socket.on("room:update-config", ({ config }) => {
    handleUpdateConfig(io, socket, config);
  });

  socket.on("room:update-player", ({ color, buildingStyle, name }) => {
    handleUpdatePlayer(io, socket, color, buildingStyle, name);
  });

  socket.on("room:update-bot", ({ playerIndex, name, color, personality }) => {
    handleUpdateBot(io, socket, playerIndex, name, color, personality);
  });

  socket.on("room:leave-game", () => {
    handleLeaveGame(io, socket);
  });

  socket.on("game:action", ({ action }) => {
    handleGameAction(io, socket, action);
  });

  socket.on("chat:message", ({ text }) => {
    handleChat(io, socket, text);
  });

  socket.on("disconnect", () => {
    handleDisconnect(io, socket);
  });
}

function handleJoin(
  io: TypedServer,
  socket: TypedSocket,
  roomCode: string,
  playerName: string,
  reconnectToken?: string
) {
  // Creating a new room
  if (!roomCode) {
    const code = generateRoomCode();
    const token = generateToken();
    const room: Room = {
      code,
      hostSocketId: socket.id,
      players: [
        {
          index: 0,
          name: playerName || "Player 1",
          isBot: false,
          socketId: socket.id,
          reconnectToken: token,
          disconnectedAt: null,
          color: PLAYER_COLORS[0],
        },
      ],
      gameState: null,
      gameConfig: null,
      lobbyConfig: { ...DEFAULT_LOBBY_CONFIG },
      botTimers: [],
      turnTimer: null,
      turnDeadline: null,
      createdAt: Date.now(),
    };
    rooms.set(code, room);
    socketToRoom.set(socket.id, code);
    socket.join(code);
    socket.emit("room:joined", { roomCode: code, playerIndex: 0, reconnectToken: token });
    broadcastLobbyState(io, room);
    return;
  }

  // Joining existing room
  const room = rooms.get(roomCode);
  if (!room) {
    socket.emit("game:error", { message: "Room not found" });
    return;
  }

  // Reconnection attempt
  if (reconnectToken) {
    const slot = room.players.find((p) => p.reconnectToken === reconnectToken);
    if (slot && !slot.isBot) {
      slot.socketId = socket.id;
      slot.disconnectedAt = null;
      socketToRoom.set(socket.id, roomCode);
      socket.join(roomCode);
      socket.emit("room:joined", {
        roomCode,
        playerIndex: slot.index,
        reconnectToken: slot.reconnectToken!,
      });
      broadcastLobbyState(io, room);
      // If game is in progress, send current state
      if (room.gameState) {
        const clientState = filterStateForPlayer(room.gameState, slot.index);
        socket.emit("game:state", { state: clientState });
      }
      return;
    }
  }

  // Game already started — can't join mid-game
  if (room.gameState) {
    socket.emit("game:error", { message: "Game already in progress" });
    return;
  }

  if (room.players.length >= 6) {
    socket.emit("game:error", { message: "Room is full" });
    return;
  }

  const token = generateToken();
  const newIndex = room.players.length;
  const slot: PlayerSlot = {
    index: newIndex,
    name: playerName || `Player ${newIndex + 1}`,
    isBot: false,
    socketId: socket.id,
    reconnectToken: token,
    disconnectedAt: null,
    color: firstUnusedColor(room),
  };
  room.players.push(slot);
  socketToRoom.set(socket.id, roomCode);
  socket.join(roomCode);
  socket.emit("room:joined", { roomCode, playerIndex: newIndex, reconnectToken: token });
  io.to(roomCode).emit("room:player-joined", { playerName: slot.name, playerIndex: newIndex });
  broadcastLobbyState(io, room);
}

function handleAddBot(io: TypedServer, socket: TypedSocket, difficulty: string, personality?: string) {
  const room = getRoomForSocket(socket.id);
  if (!room || room.hostSocketId !== socket.id) return;
  if (room.gameState) return; // can't add bots mid-game
  if (room.players.length >= 6) return;

  const botNames = ["Alice", "Bob", "Carol", "Dave", "Eve"];
  const usedNames = new Set(room.players.map((p) => p.name));
  const name = botNames.find((n) => !usedNames.has(n)) ?? `Bot ${room.players.length}`;

  // Validate personality
  const validPersonality = personality && (BOT_PERSONALITIES as readonly string[]).includes(personality)
    ? personality as BotPersonality : undefined;

  const newIndex = room.players.length;
  room.players.push({
    index: newIndex,
    name,
    isBot: true,
    socketId: null,
    reconnectToken: null,
    disconnectedAt: null,
    color: firstUnusedColor(room),
    personality: validPersonality,
  });
  broadcastLobbyState(io, room);
}

function handleLeave(io: TypedServer, socket: TypedSocket) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;

  const slot = room.players.find((p) => p.socketId === socket.id);
  if (slot) removePlayerBySlot(io, room, slot);
  socket.leave(room.code);
  socketToRoom.delete(socket.id);
}

function handleDisconnect(io: TypedServer, socket: TypedSocket) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;

  const slot = room.players.find((p) => p.socketId === socket.id);
  if (!slot) return;

  // Keep the slot, start grace period (works for both lobby and in-game)
  slot.socketId = null;
  slot.disconnectedAt = Date.now();
  socketToRoom.delete(socket.id);

  const gracePeriod = room.gameState ? 5 * 60 * 1000 : 30 * 1000; // 5 min in-game, 30s in lobby

  setTimeout(() => {
    if (slot.disconnectedAt !== null) {
      if (room.gameState) {
        // In-game: replace with bot
        slot.isBot = true;
        slot.reconnectToken = null;

        // Reassign host if needed
        if (slot.socketId && room.hostSocketId === slot.socketId) {
          const newHost = room.players.find((p) => !p.isBot && p.socketId);
          if (newHost) room.hostSocketId = newHost.socketId!;
        }

        // Check if all humans are gone
        if (checkAllHumansGone(io, room)) return;

        broadcastLobbyState(io, room);
        scheduleBotActions(io, room);
      } else {
        // In lobby: remove entirely
        removePlayerBySlot(io, room, slot);
      }
    }
  }, gracePeriod);
}

function removePlayerBySlot(io: TypedServer, room: Room, slot: PlayerSlot) {
  const idx = room.players.indexOf(slot);
  if (idx === -1) return;

  room.players.splice(idx, 1);
  // Re-index
  room.players.forEach((p, i) => (p.index = i));

  if (room.players.length === 0) {
    room.botTimers.forEach(clearTimeout);
    if (room.turnTimer) clearTimeout(room.turnTimer);
    rooms.delete(room.code);
    return;
  }

  // If host left, assign new host
  if (slot.socketId && room.hostSocketId === slot.socketId) {
    const newHost = room.players.find((p) => !p.isBot && p.socketId);
    if (newHost) room.hostSocketId = newHost.socketId!;
  }

  broadcastLobbyState(io, room);
}

function handleRemoveBot(io: TypedServer, socket: TypedSocket, playerIndex: number) {
  const room = getRoomForSocket(socket.id);
  if (!room || room.hostSocketId !== socket.id) return;
  if (room.gameState) return; // can't remove bots mid-game
  const slot = room.players[playerIndex];
  if (!slot || !slot.isBot) return;

  room.players.splice(playerIndex, 1);
  room.players.forEach((p, i) => (p.index = i));
  broadcastLobbyState(io, room);
}

function handleUpdateConfig(io: TypedServer, socket: TypedSocket, config: Partial<LobbyConfig>) {
  const room = getRoomForSocket(socket.id);
  if (!room || room.hostSocketId !== socket.id) return;
  if (room.gameState) return;

  // Validate values
  if (config.vpToWin !== undefined && !(VP_OPTIONS as readonly number[]).includes(config.vpToWin)) return;
  if (config.turnTimer !== undefined && !(TURN_TIMER_OPTIONS as readonly number[]).includes(config.turnTimer)) return;
  if (config.gameMode !== undefined && !["classic", "speed"].includes(config.gameMode)) return;

  room.lobbyConfig = { ...room.lobbyConfig, ...config };
  broadcastLobbyState(io, room);
}

function handleUpdatePlayer(
  io: TypedServer,
  socket: TypedSocket,
  color?: string,
  buildingStyle?: string,
  name?: string,
) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;
  if (room.gameState) return;

  const slot = room.players.find((p) => p.socketId === socket.id);
  if (!slot) return;

  if (name !== undefined) {
    const trimmed = name.trim().slice(0, 20);
    if (trimmed) slot.name = trimmed;
  }

  if (color !== undefined) {
    if (!(PLAYER_COLORS as readonly string[]).includes(color)) return;
    // Swap with whoever has this color
    const other = room.players.find((p) => p !== slot && p.color === color);
    if (other) {
      other.color = slot.color;
    }
    slot.color = color;
  }

  if (buildingStyle !== undefined) {
    if (!(BUILDING_STYLES as readonly string[]).includes(buildingStyle)) return;
    slot.buildingStyle = buildingStyle as import("@/shared/types/config").BuildingStyle;
  }

  broadcastLobbyState(io, room);
}

function handleUpdateBot(
  io: TypedServer,
  socket: TypedSocket,
  playerIndex: number,
  name?: string,
  color?: string,
  personality?: string,
) {
  const room = getRoomForSocket(socket.id);
  if (!room || room.hostSocketId !== socket.id) return;
  if (room.gameState) return;

  const slot = room.players[playerIndex];
  if (!slot || !slot.isBot) return;

  if (name !== undefined) {
    const trimmed = name.trim().slice(0, 20);
    if (trimmed) slot.name = trimmed;
  }

  if (color !== undefined) {
    if (!(PLAYER_COLORS as readonly string[]).includes(color)) return;
    const other = room.players.find((p) => p !== slot && p.color === color);
    if (other) other.color = slot.color;
    slot.color = color;
  }

  if (personality !== undefined) {
    if ((BOT_PERSONALITIES as readonly string[]).includes(personality)) {
      slot.personality = personality as BotPersonality;
    }
  }

  broadcastLobbyState(io, room);
}

function handleLeaveGame(io: TypedServer, socket: TypedSocket) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;

  const slot = room.players.find((p) => p.socketId === socket.id);
  if (!slot) return;

  // If not in-game, delegate to normal leave
  if (!room.gameState) {
    handleLeave(io, socket);
    return;
  }

  // In-game: convert to bot
  slot.isBot = true;
  slot.socketId = null;
  slot.reconnectToken = null;
  socket.leave(room.code);
  socketToRoom.delete(socket.id);

  // Reassign host if needed
  if (room.hostSocketId === socket.id) {
    const newHost = room.players.find((p) => !p.isBot && p.socketId);
    if (newHost) room.hostSocketId = newHost.socketId!;
  }

  // Check if all humans are gone
  if (checkAllHumansGone(io, room)) return;

  broadcastLobbyState(io, room);

  // If it's now a bot's turn, schedule bot actions
  scheduleBotActions(io, room);
}

function checkAllHumansGone(io: TypedServer, room: Room): boolean {
  const anyHuman = room.players.some((p) => !p.isBot);
  if (!anyHuman) {
    // End session
    room.botTimers.forEach(clearTimeout);
    if (room.turnTimer) clearTimeout(room.turnTimer);
    io.to(room.code).emit("room:session-ended", { reason: "All players have left" });
    rooms.delete(room.code);
    return true;
  }
  return false;
}

function handleChat(io: TypedServer, socket: TypedSocket, text: string) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;
  const slot = getPlayerSlot(room, socket.id);
  if (!slot) return;

  io.to(room.code).emit("chat:message", {
    playerIndex: slot.index,
    playerName: slot.name,
    text,
    timestamp: Date.now(),
  });
}

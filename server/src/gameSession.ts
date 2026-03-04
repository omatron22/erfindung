import type { TypedServer, TypedSocket, Room } from "./types.js";
import type { GameAction } from "@/shared/types/actions";
import type { GameConfig } from "@/shared/types/config";
import { createGame, applyAction } from "@/server/engine/gameEngine";
import { decideBotAction } from "@/server/bots/botController";
import { filterStateForPlayer } from "./stateFilter.js";
import { getRoom, getRoomForSocket, getPlayerSlot } from "./roomManager.js";
import { startTurnTimer, clearTurnTimer } from "./turnTimer.js";

const BOT_MOVE_DELAY_MS = 800;

export function handleStartGame(io: TypedServer, socket: TypedSocket) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;
  if (room.hostSocketId !== socket.id) {
    socket.emit("game:error", { message: "Only the host can start the game" });
    return;
  }
  if (room.players.length < 2) {
    socket.emit("game:error", { message: "Need at least 2 players" });
    return;
  }
  if (room.gameState) {
    socket.emit("game:error", { message: "Game already started" });
    return;
  }

  const playerNames = room.players.map((p) => p.name);
  const config: GameConfig = {
    players: room.players.map((p) => ({
      name: p.name,
      color: p.color,
      isBot: p.isBot,
      buildingStyle: p.buildingStyle,
      ...(p.isBot && p.personality ? { personality: p.personality } : {}),
    })),
    fairDice: room.lobbyConfig.fairDice,
    friendlyRobber: room.lobbyConfig.friendlyRobber,
    gameMode: room.lobbyConfig.gameMode,
    vpToWin: room.lobbyConfig.vpToWin,
    turnTimer: room.lobbyConfig.turnTimer,
    expansionBoard: room.lobbyConfig.expansionBoard,
  };

  room.gameConfig = config;
  room.gameState = createGame(`game-${room.code}-${Date.now()}`, playerNames, config);

  broadcastState(io, room);
  scheduleBotActions(io, room);
}

export function handleGameAction(
  io: TypedServer,
  socket: TypedSocket,
  action: GameAction
) {
  const room = getRoomForSocket(socket.id);
  if (!room || !room.gameState) return;

  const slot = getPlayerSlot(room, socket.id);
  if (!slot) return;

  // Validate that the action's playerIndex matches the socket's player
  if (action.playerIndex !== slot.index) {
    socket.emit("game:error", { message: "Not your action" });
    return;
  }

  const result = applyAction(room.gameState, action);
  if (!result.valid || !result.newState) {
    socket.emit("game:error", { message: result.error || "Invalid action" });
    return;
  }

  room.gameState = result.newState;

  // Broadcast events then state
  if (result.events && result.events.length > 0) {
    io.to(room.code).emit("game:events", { events: result.events });
  }

  broadcastState(io, room);

  // Clear and restart turn timer
  clearTurnTimer(room);
  if (room.gameConfig?.turnTimer && room.gameState.phase !== "finished") {
    startTurnTimer(io, room, room.gameConfig.turnTimer);
  }

  // Schedule bot actions if it's a bot's turn
  scheduleBotActions(io, room);
}

export function broadcastState(io: TypedServer, room: Room) {
  if (!room.gameState) return;

  // Send filtered state to each connected player
  for (const slot of room.players) {
    if (slot.socketId && !slot.isBot) {
      const clientState = filterStateForPlayer(room.gameState, slot.index);
      // Attach turn deadline for timer display
      (clientState as any).turnDeadline = room.turnDeadline ?? null;
      io.to(slot.socketId).emit("game:state", { state: clientState });
    }
  }
}

export function scheduleBotActions(io: TypedServer, room: Room) {
  // Clear any existing bot timers
  room.botTimers.forEach(clearTimeout);
  room.botTimers = [];

  if (!room.gameState || room.gameState.phase === "finished") return;

  // Check if any bot needs to act (discard phase — multiple bots may need to)
  if (room.gameState.turnPhase === "discard") {
    const botDiscards = room.gameState.discardingPlayers.filter((idx) =>
      room.players[idx]?.isBot
    );
    for (const botIdx of botDiscards) {
      const timer = setTimeout(() => {
        executeBotAction(io, room, botIdx);
      }, BOT_MOVE_DELAY_MS);
      room.botTimers.push(timer);
    }
    return;
  }

  // Check if current player is a bot
  const currentIdx = room.gameState.currentPlayerIndex;
  const currentSlot = room.players[currentIdx];
  if (!currentSlot?.isBot) return;

  const timer = setTimeout(() => {
    executeBotAction(io, room, currentIdx);
  }, BOT_MOVE_DELAY_MS);
  room.botTimers.push(timer);
}

function executeBotAction(io: TypedServer, room: Room, botIndex: number) {
  if (!room.gameState || room.gameState.phase === "finished") return;

  const action = decideBotAction(room.gameState, botIndex);
  if (!action) return;

  const result = applyAction(room.gameState, action);
  if (!result.valid || !result.newState) return;

  room.gameState = result.newState;

  if (result.events && result.events.length > 0) {
    io.to(room.code).emit("game:events", { events: result.events });
  }

  broadcastState(io, room);

  // Continue bot loop
  scheduleBotActions(io, room);
}

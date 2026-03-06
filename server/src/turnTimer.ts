import type { TypedServer, Room } from "./types.js";
import type { Resource } from "@/shared/types/game";
import { applyAction } from "@/server/engine/gameEngine";
import { decideBotAction } from "@/server/bots/botController";
import { broadcastState, scheduleBotActions } from "./gameSession.js";

export function startTurnTimer(io: TypedServer, room: Room, seconds: number) {
  clearTurnTimer(room);

  room.turnDeadline = Date.now() + seconds * 1000;

  room.turnTimer = setTimeout(() => {
    handleTimeout(io, room);
  }, seconds * 1000);
}

export function clearTurnTimer(room: Room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnDeadline = null;
}

function handleTimeout(io: TypedServer, room: Room) {
  if (!room.gameState || room.gameState.phase === "finished") return;

  const state = room.gameState;
  const playerIndex = state.currentPlayerIndex;

  // Discard phase: auto-discard for all remaining players
  if (state.turnPhase === "discard") {
    autoDiscard(io, room);
    return;
  }

  // Setup phases: use bot AI for smart placement
  if (state.phase === "setup-forward" || state.phase === "setup-reverse") {
    autoSetupAction(io, room, playerIndex);
    return;
  }

  // Main game phases
  switch (state.turnPhase) {
    case "roll":
      autoRollDice(io, room, playerIndex);
      break;
    case "robber-place":
      autoPlaceRobber(io, room, playerIndex);
      break;
    case "robber-steal":
      autoSteal(io, room, playerIndex);
      break;
    case "road-building-1":
    case "road-building-2":
      autoRoadBuilding(io, room, playerIndex);
      break;
    case "year-of-plenty":
      autoYearOfPlenty(io, room, playerIndex);
      break;
    case "monopoly":
      autoMonopoly(io, room, playerIndex);
      break;
    case "sheep-nuke-pick":
      autoSheepNukePick(io, room, playerIndex);
      break;
    case "trade-or-build":
      autoEndTurn(io, room, playerIndex);
      break;
    default:
      // Fallback: try end-turn
      autoEndTurn(io, room, playerIndex);
      break;
  }
}

function applyAndBroadcast(io: TypedServer, room: Room, action: any): boolean {
  const result = applyAction(room.gameState!, action);
  if (result.valid && result.newState) {
    room.gameState = result.newState;
    if (result.events?.length) {
      io.to(room.code).emit("game:events", { events: result.events });
    }
    broadcastState(io, room);
    // Restart timer for next phase/player
    clearTurnTimer(room);
    if (room.gameConfig?.turnTimer && room.gameState.phase !== "finished") {
      startTurnTimer(io, room, room.gameConfig.turnTimer);
    }
    scheduleBotActions(io, room);
    return true;
  }
  return false;
}

function autoDiscard(io: TypedServer, room: Room) {
  const state = room.gameState!;
  for (const idx of [...state.discardingPlayers]) {
    const player = state.players[idx];
    const total = Object.values(player.resources).reduce(
      (s: number, n) => s + n,
      0
    );
    const toDiscard = Math.floor(total / 2);
    const resources: Partial<Record<Resource, number>> = {};

    const available: Resource[] = [];
    for (const [res, count] of Object.entries(player.resources)) {
      for (let i = 0; i < count; i++) available.push(res as Resource);
    }
    // Shuffle and pick
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }
    for (let i = 0; i < toDiscard && i < available.length; i++) {
      const r = available[i];
      resources[r] = (resources[r] || 0) + 1;
    }

    const result = applyAction(room.gameState!, {
      type: "discard-resources",
      playerIndex: idx,
      resources,
    });
    if (result.valid && result.newState) {
      room.gameState = result.newState;
    }
  }

  broadcastState(io, room);
  clearTurnTimer(room);
  if (room.gameConfig?.turnTimer && room.gameState!.phase !== "finished") {
    startTurnTimer(io, room, room.gameConfig.turnTimer);
  }
  scheduleBotActions(io, room);
}

function autoRollDice(io: TypedServer, room: Room, playerIndex: number) {
  applyAndBroadcast(io, room, { type: "roll-dice", playerIndex });
}

function autoSetupAction(io: TypedServer, room: Room, playerIndex: number) {
  // Use the bot AI for smart placement
  const action = decideBotAction(room.gameState!, playerIndex);
  if (action) {
    applyAndBroadcast(io, room, action);
  }
}

function autoPlaceRobber(io: TypedServer, room: Room, playerIndex: number) {
  // Use bot AI for strategic robber placement
  const action = decideBotAction(room.gameState!, playerIndex);
  if (action && action.type === "move-robber") {
    applyAndBroadcast(io, room, action);
  } else {
    // Fallback: pick first valid hex that's not the current robber hex
    const state = room.gameState!;
    for (const hex of Object.keys(state.board.hexes)) {
      if (hex === state.board.robberHex) continue;
      if (state.board.hexes[hex].type === "desert") continue;
      const result = applyAction(state, { type: "move-robber", playerIndex, hex });
      if (result.valid) {
        applyAndBroadcast(io, room, { type: "move-robber", playerIndex, hex });
        return;
      }
    }
  }
}

function autoSteal(io: TypedServer, room: Room, playerIndex: number) {
  // Use bot AI for strategic steal target
  const action = decideBotAction(room.gameState!, playerIndex);
  if (action && action.type === "steal-resource") {
    applyAndBroadcast(io, room, action);
    return;
  }
  // Fallback: try each player until one works
  const state = room.gameState!;
  for (let i = 0; i < state.players.length; i++) {
    if (i === playerIndex) continue;
    const result = applyAction(state, { type: "steal-resource", playerIndex, targetPlayer: i });
    if (result.valid) {
      applyAndBroadcast(io, room, { type: "steal-resource", playerIndex, targetPlayer: i });
      return;
    }
  }
}

function autoRoadBuilding(io: TypedServer, room: Room, playerIndex: number) {
  // Use bot AI for road placement
  const action = decideBotAction(room.gameState!, playerIndex);
  if (action) {
    applyAndBroadcast(io, room, action);
  } else {
    // If no valid road, end turn
    autoEndTurn(io, room, playerIndex);
  }
}

function autoYearOfPlenty(io: TypedServer, room: Room, playerIndex: number) {
  // Pick the two most needed resources based on what the player has least of
  const player = room.gameState!.players[playerIndex];
  const resources: Resource[] = ["brick", "lumber", "wool", "grain", "ore"];
  resources.sort((a, b) => player.resources[a] - player.resources[b]);
  applyAndBroadcast(io, room, {
    type: "play-year-of-plenty",
    playerIndex,
    resource1: resources[0],
    resource2: resources[1],
  });
}

function autoMonopoly(io: TypedServer, room: Room, playerIndex: number) {
  // Pick the resource that opponents have the most of
  const state = room.gameState!;
  const resources: Resource[] = ["brick", "lumber", "wool", "grain", "ore"];
  let bestRes = resources[0];
  let bestCount = 0;
  for (const r of resources) {
    let total = 0;
    for (const p of state.players) {
      if (p.index !== playerIndex) total += p.resources[r];
    }
    if (total > bestCount) { bestCount = total; bestRes = r; }
  }
  applyAndBroadcast(io, room, { type: "play-monopoly", playerIndex, resource: bestRes });
}

function autoSheepNukePick(io: TypedServer, room: Room, playerIndex: number) {
  // Use bot AI for best number pick
  const action = decideBotAction(room.gameState!, playerIndex);
  if (action && action.type === "sheep-nuke-pick") {
    applyAndBroadcast(io, room, action);
  } else {
    // Fallback: pick number 6 (common)
    applyAndBroadcast(io, room, { type: "sheep-nuke-pick", playerIndex, number: 6 });
  }
}

function autoEndTurn(io: TypedServer, room: Room, playerIndex: number) {
  // Cancel any pending trades first
  for (const trade of [...room.gameState!.pendingTrades]) {
    const cancelResult = applyAction(room.gameState!, {
      type: "cancel-trade",
      playerIndex: trade.fromPlayer,
      tradeId: trade.id,
    });
    if (cancelResult.valid && cancelResult.newState) {
      room.gameState = cancelResult.newState;
    }
  }

  applyAndBroadcast(io, room, { type: "end-turn", playerIndex });
}

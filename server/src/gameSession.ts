import type { TypedServer, TypedSocket, Room } from "./types.js";
import type { GameAction } from "@/shared/types/actions";
import type { GameConfig } from "@/shared/types/config";
import { createGame, applyAction } from "@/server/engine/gameEngine";
import { decideBotAction, decideBotTradeResponse, generateBotCounterOffer } from "@/server/bots/botController";
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
    doublesRollAgain: room.lobbyConfig.doublesRollAgain,
    sheepNuke: room.lobbyConfig.sheepNuke,
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

  if (action.playerIndex !== slot.index) {
    socket.emit("game:error", { message: "Not your action" });
    return;
  }

  // Handle accept-counter-offer: initiator accepts a bot/human counter-offer
  if (action.type === "accept-counter-offer") {
    handleAcceptCounterOffer(io, room, slot.index, (action as any).fromPlayer, (action as any).tradeId);
    return;
  }

  const result = applyAction(room.gameState, action);
  if (!result.valid || !result.newState) {
    socket.emit("game:error", { message: result.error || "Invalid action" });
    return;
  }

  room.gameState = result.newState;

  // Clear trade responses for specific trade when cancelled or confirmed
  if (action.type === "cancel-trade" && room.tradeResponses) {
    delete room.tradeResponses[(action as any).tradeId];
    if (Object.keys(room.tradeResponses).length === 0) {
      room.tradeResponses = null;
    }
  }

  // Clear all trade responses on confirm (all trades get cleared)
  if (action.type === "confirm-trade") {
    room.tradeResponses = null;
  }

  // Update trade responses when a human rejects a specific trade
  if (action.type === "reject-trade" && room.tradeResponses) {
    const tradeId = (action as any).tradeId;
    const tradeResps = room.tradeResponses[tradeId];
    if (tradeResps) {
      tradeResps[slot.index] = { playerIndex: slot.index, status: "rejected", counterOffer: null };
      // Check if all responders for this trade have answered
      const allResponded = Object.values(tradeResps).every((r) => r.status !== "pending");
      const anyAccepted = Object.values(tradeResps).some((r) => r.status === "accepted");
      const anyCounters = Object.values(tradeResps).some((r) => r.counterOffer != null);
      // Also check if the trade has engine-level acceptors
      const trade = room.gameState.pendingTrades.find((t) => t.id === tradeId);
      const hasEngineAcceptors = trade && trade.acceptedBy.length > 0;
      if (allResponded && !anyAccepted && !anyCounters && !hasEngineAcceptors && trade) {
        const cancelResult = applyAction(room.gameState, {
          type: "cancel-trade",
          playerIndex: trade.fromPlayer,
          tradeId: trade.id,
        });
        if (cancelResult.valid && cancelResult.newState) {
          room.gameState = cancelResult.newState;
          delete room.tradeResponses[tradeId];
          if (Object.keys(room.tradeResponses).length === 0) {
            room.tradeResponses = null;
          }
        }
      }
    }
  }

  // When accept-trade: update trade response status
  if (action.type === "accept-trade" && room.tradeResponses) {
    const tradeId = (action as any).tradeId;
    if (room.tradeResponses[tradeId]) {
      room.tradeResponses[tradeId][slot.index] = { playerIndex: slot.index, status: "accepted", counterOffer: null };
    }
  }

  // Initialize trade responses when a new trade is offered
  if (action.type === "offer-trade") {
    // Find the newly added trade (last one)
    const newTrade = room.gameState.pendingTrades[room.gameState.pendingTrades.length - 1];
    if (newTrade) {
      if (!room.tradeResponses) room.tradeResponses = {};
      room.tradeResponses[newTrade.id] = {};
      for (const p of room.players) {
        if (p.index === newTrade.fromPlayer) continue;
        if (newTrade.toPlayer !== null && newTrade.toPlayer !== p.index) continue;
        room.tradeResponses[newTrade.id][p.index] = { playerIndex: p.index, status: "pending", counterOffer: null };
      }
    }
  }

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

  // Manage trade timeout for human-to-human trades
  manageTradeTimer(io, room);

  // Schedule bot actions if it's a bot's turn
  scheduleBotActions(io, room);
}

export function broadcastState(io: TypedServer, room: Room) {
  if (!room.gameState) return;

  for (const slot of room.players) {
    if (slot.socketId && !slot.isBot) {
      const clientState = filterStateForPlayer(room.gameState, slot.index);
      (clientState as any).turnDeadline = room.turnDeadline ?? null;
      (clientState as any).tradeResponses = room.tradeResponses ?? null;
      io.to(slot.socketId).emit("game:state", { state: clientState });
    }
  }
}

export function scheduleBotActions(io: TypedServer, room: Room) {
  room.botTimers.forEach(clearTimeout);
  room.botTimers = [];

  if (!room.gameState || room.gameState.phase === "finished") return;

  // If there are pending trades, have bots respond to each
  if (room.gameState.pendingTrades.length > 0) {
    let anyBotNeedsToRespond = false;

    for (const trade of room.gameState.pendingTrades) {
      const respondingBots = room.players.filter(
        (p) => p.isBot && p.index !== trade.fromPlayer &&
          (trade.toPlayer === null || trade.toPlayer === p.index)
      );

      // Initialize trade responses for this trade if not already set
      if (!room.tradeResponses) room.tradeResponses = {};
      if (!room.tradeResponses[trade.id]) {
        room.tradeResponses[trade.id] = {};
        for (const p of room.players) {
          if (p.index === trade.fromPlayer) continue;
          if (trade.toPlayer !== null && trade.toPlayer !== p.index) continue;
          room.tradeResponses[trade.id][p.index] = { playerIndex: p.index, status: "pending", counterOffer: null };
        }
        broadcastState(io, room);
      }

      // Check if bots already responded to this trade
      const botsAlreadyResponded = respondingBots.every(
        (bot) => room.tradeResponses?.[trade.id]?.[bot.index]?.status !== "pending"
      );

      if (respondingBots.length > 0 && !botsAlreadyResponded) {
        anyBotNeedsToRespond = true;
        const tradeId = trade.id;
        const timer = setTimeout(() => {
          if (!room.gameState) return;
          const currentTrade = room.gameState.pendingTrades.find((t) => t.id === tradeId);
          if (!currentTrade) return;

          const acceptors: number[] = [];
          for (const bot of respondingBots) {
            const decision = decideBotTradeResponse(room.gameState, bot.index);
            if (decision === "accept") {
              acceptors.push(bot.index);
              // Also apply to engine state
              const acceptResult = applyAction(room.gameState, {
                type: "accept-trade",
                playerIndex: bot.index,
                tradeId: tradeId,
              });
              if (acceptResult.valid && acceptResult.newState) {
                room.gameState = acceptResult.newState;
              }
              if (room.tradeResponses?.[tradeId]) {
                room.tradeResponses[tradeId][bot.index] = { playerIndex: bot.index, status: "accepted", counterOffer: null };
              }
            } else {
              const counter = generateBotCounterOffer(room.gameState, bot.index);
              if (room.tradeResponses?.[tradeId]) {
                room.tradeResponses[tradeId][bot.index] = { playerIndex: bot.index, status: "rejected", counterOffer: counter };
              }
            }
          }

          const hasHumanTargets = room.players.some(
            (p) => !p.isBot && p.index !== currentTrade.fromPlayer &&
              (currentTrade.toPlayer === null || currentTrade.toPlayer === p.index)
          );

          const hasCounters = room.tradeResponses?.[tradeId]
            ? Object.values(room.tradeResponses[tradeId]).some((r) => r.counterOffer != null)
            : false;

          if (acceptors.length === 0 && !hasCounters && !hasHumanTargets) {
            const result = applyAction(room.gameState, {
              type: "cancel-trade",
              playerIndex: currentTrade.fromPlayer,
              tradeId: currentTrade.id,
            });
            if (result.valid && result.newState) {
              room.gameState = result.newState;
              if (room.tradeResponses) {
                delete room.tradeResponses[tradeId];
                if (Object.keys(room.tradeResponses).length === 0) room.tradeResponses = null;
              }
              broadcastState(io, room);
              scheduleBotActions(io, room);
              return;
            }
          } else {
            broadcastState(io, room);
          }
        }, BOT_MOVE_DELAY_MS);
        room.botTimers.push(timer);
      }
    }

    if (anyBotNeedsToRespond) return;

    // Auto-confirm for bot-initiated trades that have acceptors
    for (const trade of [...room.gameState.pendingTrades]) {
      const initiatorSlot = room.players[trade.fromPlayer];
      if (!initiatorSlot?.isBot) continue;
      if (trade.acceptedBy.length === 0) continue;

      // Bot auto-confirms with the first acceptor
      const timer = setTimeout(() => {
        if (!room.gameState) return;
        const t = room.gameState.pendingTrades.find((pt) => pt.id === trade.id);
        if (!t || t.acceptedBy.length === 0) return;
        const confirmResult = applyAction(room.gameState, {
          type: "confirm-trade",
          playerIndex: t.fromPlayer,
          tradeId: t.id,
          withPlayer: t.acceptedBy[0],
        });
        if (confirmResult.valid && confirmResult.newState) {
          room.gameState = confirmResult.newState;
          room.tradeResponses = null;
          if (confirmResult.events?.length) {
            io.to(room.code).emit("game:events", { events: confirmResult.events });
          }
          broadcastState(io, room);
          scheduleBotActions(io, room);
        }
      }, BOT_MOVE_DELAY_MS);
      room.botTimers.push(timer);
      return;
    }

    // If all trades have been responded to by bots, wait for humans or initiator
    return;
  }

  // Check if any bot needs to act (discard phase)
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
  scheduleBotActions(io, room);
}

const TRADE_TIMEOUT_MS = 30_000;

function manageTradeTimer(io: TypedServer, room: Room) {
  if (room.tradeTimer) {
    clearTimeout(room.tradeTimer);
    room.tradeTimer = null;
  }

  if (!room.gameState || room.gameState.pendingTrades.length === 0) return;

  // Check if there are human targets who need to respond to any trade
  const hasHumanTargets = room.gameState.pendingTrades.some((trade) =>
    room.players.some(
      (p) => !p.isBot && p.socketId && p.index !== trade.fromPlayer &&
        (trade.toPlayer === null || trade.toPlayer === p.index)
    )
  );

  if (!hasHumanTargets) return;

  room.tradeTimer = setTimeout(() => {
    if (!room.gameState) return;
    // Cancel all pending trades on timeout
    for (const trade of [...room.gameState.pendingTrades]) {
      const cancelResult = applyAction(room.gameState, {
        type: "cancel-trade",
        playerIndex: trade.fromPlayer,
        tradeId: trade.id,
      });
      if (cancelResult.valid && cancelResult.newState) {
        room.gameState = cancelResult.newState;
      }
    }
    room.tradeResponses = null;
    broadcastState(io, room);
    scheduleBotActions(io, room);
  }, TRADE_TIMEOUT_MS);
}

/**
 * Trade initiator accepts a counter-offer from a bot or human.
 * cancel original trade → offer counter → auto-accept via confirm.
 */
function handleAcceptCounterOffer(io: TypedServer, room: Room, initiatorIndex: number, counterFromPlayer: number, tradeId?: string) {
  if (!room.gameState) return;

  // Find which trade has the counter-offer
  let targetTradeId = tradeId;
  if (!targetTradeId) {
    // Legacy: find the first trade from this initiator
    const trade = room.gameState.pendingTrades.find((t) => t.fromPlayer === initiatorIndex);
    if (!trade) return;
    targetTradeId = trade.id;
  }

  const trade = room.gameState.pendingTrades.find((t) => t.id === targetTradeId);
  if (!trade || trade.fromPlayer !== initiatorIndex) return;

  const counter = room.tradeResponses?.[targetTradeId]?.[counterFromPlayer]?.counterOffer;
  if (!counter) return;

  // Cancel all pending trades first
  for (const t of [...room.gameState.pendingTrades]) {
    const cancelResult = applyAction(room.gameState, {
      type: "cancel-trade",
      playerIndex: t.fromPlayer,
      tradeId: t.id,
    });
    if (cancelResult.valid && cancelResult.newState) {
      room.gameState = cancelResult.newState;
    }
  }

  // Create new trade with counter terms
  const offerResult = applyAction(room.gameState, {
    type: "offer-trade",
    playerIndex: initiatorIndex,
    offering: counter.requesting,
    requesting: counter.offering,
    toPlayer: counterFromPlayer,
  });
  if (!offerResult.valid || !offerResult.newState || offerResult.newState.pendingTrades.length === 0) {
    room.tradeResponses = null;
    broadcastState(io, room);
    scheduleBotActions(io, room);
    return;
  }
  room.gameState = offerResult.newState;
  const newTrade = room.gameState.pendingTrades[room.gameState.pendingTrades.length - 1];

  // Auto-accept from the counter-offering player
  const acceptResult = applyAction(room.gameState, {
    type: "accept-trade",
    playerIndex: counterFromPlayer,
    tradeId: newTrade.id,
  });
  if (acceptResult.valid && acceptResult.newState) {
    room.gameState = acceptResult.newState;
  }

  // Auto-confirm (since counter-offers are pre-agreed)
  const confirmResult = applyAction(room.gameState, {
    type: "confirm-trade",
    playerIndex: initiatorIndex,
    tradeId: newTrade.id,
    withPlayer: counterFromPlayer,
  });
  if (confirmResult.valid && confirmResult.newState) {
    room.gameState = confirmResult.newState;
    if (confirmResult.events?.length) {
      io.to(room.code).emit("game:events", { events: confirmResult.events });
    }
  }

  room.tradeResponses = null;
  if (room.tradeTimer) { clearTimeout(room.tradeTimer); room.tradeTimer = null; }
  broadcastState(io, room);
  scheduleBotActions(io, room);
}

/**
 * A human player submits a counter-offer to a pending trade.
 */
export function handleCounterOffer(
  io: TypedServer,
  room: Room,
  playerIndex: number,
  offering: Partial<Record<import("@/shared/types/game").Resource, number>>,
  requesting: Partial<Record<import("@/shared/types/game").Resource, number>>,
  tradeId?: string
) {
  if (!room.gameState || room.gameState.pendingTrades.length === 0) return;

  // Find target trade
  let trade;
  if (tradeId) {
    trade = room.gameState.pendingTrades.find((t) => t.id === tradeId);
  } else {
    trade = room.gameState.pendingTrades.find((t) =>
      t.fromPlayer !== playerIndex && (t.toPlayer === null || t.toPlayer === playerIndex)
    );
  }
  if (!trade) return;
  if (playerIndex === trade.fromPlayer) return;
  if (trade.toPlayer !== null && trade.toPlayer !== playerIndex) return;

  const player = room.gameState.players[playerIndex];
  for (const [res, amount] of Object.entries(offering)) {
    if ((amount || 0) > player.resources[res as import("@/shared/types/game").Resource]) return;
  }

  if (!room.tradeResponses) room.tradeResponses = {};
  if (!room.tradeResponses[trade.id]) room.tradeResponses[trade.id] = {};
  room.tradeResponses[trade.id][playerIndex] = {
    playerIndex,
    status: "rejected",
    counterOffer: { offering, requesting },
  };

  broadcastState(io, room);
}

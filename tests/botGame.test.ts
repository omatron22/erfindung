import { describe, it, expect } from "vitest";
import { createGame, applyAction } from "@/server/engine/gameEngine";
import { decideBotAction } from "@/server/bots/botController";
import type { GameState } from "@/shared/types/game";

/**
 * Run a complete bot-only game.
 * Handles invalid bot actions gracefully (skips to end-turn as fallback).
 * Handles bot-initiated trades (offer-trade actions).
 */
function runBotGame(initialState: GameState, maxTurns = 1500): {
  state: GameState;
  turns: number;
  finished: boolean;
  tradeCount: number;
} {
  let state = initialState;
  let turns = 0;
  let consecutiveFailures = 0;
  let tradeCount = 0;

  while (state.phase !== "finished" && turns < maxTurns) {
    turns++;

    let botIndex: number;
    if (state.turnPhase === "discard" && state.discardingPlayers.length > 0) {
      botIndex = state.discardingPlayers[0];
    } else {
      botIndex = state.currentPlayerIndex;
    }

    const action = decideBotAction(state, botIndex);
    if (!action) {
      // Bot can't decide — if it's trade-or-build, end turn
      if (state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid) {
          state = fallback.newState!;
          consecutiveFailures = 0;
          continue;
        }
      }
      consecutiveFailures++;
      if (consecutiveFailures > 20) break;
      continue;
    }

    // Handle bot-initiated player trades
    if (action.type === "offer-trade") {
      tradeCount++;
      const offerResult = applyAction(state, action);
      if (offerResult.valid && offerResult.newState && offerResult.newState.pendingTrades.length > 0) {
        const trade = offerResult.newState.pendingTrades[offerResult.newState.pendingTrades.length - 1];
        // Auto: first other bot tries to accept
        let accepted = false;
        for (let i = 0; i < state.players.length; i++) {
          if (i === botIndex) continue;
          const acceptResult = applyAction(offerResult.newState, {
            type: "accept-trade",
            playerIndex: i,
            tradeId: trade.id,
          });
          if (acceptResult.valid && acceptResult.newState) {
            const confirmResult = applyAction(acceptResult.newState, {
              type: "confirm-trade",
              playerIndex: botIndex,
              tradeId: trade.id,
              withPlayer: i,
            });
            if (confirmResult.valid && confirmResult.newState) {
              state = confirmResult.newState;
              accepted = true;
              break;
            }
          }
        }
        if (!accepted) {
          const cancelResult = applyAction(offerResult.newState, {
            type: "cancel-trade",
            playerIndex: botIndex,
            tradeId: trade.id,
          });
          state = cancelResult.valid && cancelResult.newState ? cancelResult.newState : offerResult.newState;
        }
        consecutiveFailures = 0;
        continue;
      }
      // Trade offer failed — try end turn
      if (state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid) { state = fallback.newState!; consecutiveFailures = 0; continue; }
      }
      consecutiveFailures++;
      if (consecutiveFailures > 20) break;
      continue;
    }

    const result = applyAction(state, action);
    if (!result.valid) {
      // Bot made invalid move — try end turn as fallback
      if (action.type !== "end-turn" && state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid) {
          state = fallback.newState!;
          consecutiveFailures = 0;
          continue;
        }
      }
      consecutiveFailures++;
      if (consecutiveFailures > 20) break;
      continue;
    }

    state = result.newState!;
    consecutiveFailures = 0;
  }

  return { state, turns, finished: state.phase === "finished", tradeCount };
}

describe("Bot Game Simulation", () => {
  it("completes a 4-player bot game", () => {
    const initial = createGame("bot-test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    const { state, turns, finished } = runBotGame(initial);
    expect(finished).toBe(true);
    expect(state.winner).not.toBeNull();
    console.log(`4p game: ${turns} turns, winner: ${state.players[state.winner!].name} with ${state.players[state.winner!].victoryPoints + state.players[state.winner!].hiddenVictoryPoints} VP`);
  });

  it("completes a 3-player bot game", () => {
    const initial = createGame("bot-test", ["Bot1", "Bot2", "Bot3"]);
    const { state, turns, finished } = runBotGame(initial);
    expect(finished).toBe(true);
    console.log(`3p game: ${turns} turns`);
  });

  it("completes a 2-player bot game", () => {
    const initial = createGame("bot-test", ["Bot1", "Bot2"]);
    const { state, turns, finished } = runBotGame(initial);
    expect(finished).toBe(true);
    console.log(`2p game: ${turns} turns`);
  });

  it("completes 10 consecutive 4-player games", () => {
    let totalTurns = 0;
    for (let i = 0; i < 10; i++) {
      const initial = createGame(`bot-test-${i}`, ["Bot1", "Bot2", "Bot3", "Bot4"]);
      const { state, turns, finished } = runBotGame(initial);
      expect(finished).toBe(true);
      totalTurns += turns;
    }
    console.log(`10 games average: ${Math.round(totalTurns / 10)} turns`);
  });

  it("bots initiate trades during games", () => {
    let totalTrades = 0;
    for (let i = 0; i < 3; i++) {
      const initial = createGame(`trade-test-${i}`, ["Bot1", "Bot2", "Bot3", "Bot4"]);
      const { tradeCount } = runBotGame(initial);
      totalTrades += tradeCount;
    }
    expect(totalTrades).toBeGreaterThan(0);
    console.log(`Trade games: ${totalTrades} total trades across 3 games`);
  });
});

import { describe, it, expect } from "vitest";
import { createGame, applyAction } from "@/server/engine/gameEngine";
import { computeStrategicContext } from "@/server/bots/strategy/context";
import { decideBotAction } from "@/server/bots/botController";
import { getWeights } from "@/server/bots/personality";
import type { GameState } from "@/shared/types/game";
import type { GameConfig } from "@/shared/types/config";
import type { BotPersonality } from "@/shared/types/config";
import { BOT_PERSONALITIES } from "@/shared/types/config";

function playThroughSetup(initial: GameState): GameState {
  let state = initial;
  let safety = 0;
  while ((state.phase === "setup-forward" || state.phase === "setup-reverse") && safety < 200) {
    safety++;
    const action = decideBotAction(state, state.currentPlayerIndex);
    if (!action) break;
    const result = applyAction(state, action);
    if (!result.valid || !result.newState) break;
    state = result.newState;
  }
  return state;
}

function createGameWithPersonality(id: string, names: string[], personality: BotPersonality): GameState {
  const config: GameConfig = {
    players: names.map((name, i) => ({
      name,
      color: ["red", "blue", "white", "orange", "green", "brown"][i],
      isBot: true,
      personality,
    })),
    fairDice: false,
    friendlyRobber: false,
    doublesRollAgain: false,
    sheepNuke: false,
    gameMode: "classic",
    vpToWin: 10,
    turnTimer: 0,
    expansionBoard: false,
  };
  return createGame(id, names, config);
}

/**
 * Run a bot game handling bot-initiated trades (offer-trade actions).
 */
function runBotGameWithTrades(state: GameState, maxTurns = 1500): { state: GameState; turns: number; tradeCount: number } {
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
      if (state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid) { state = fallback.newState!; consecutiveFailures = 0; continue; }
      }
      consecutiveFailures++;
      if (consecutiveFailures > 20) break;
      continue;
    }

    // Handle bot-initiated trades: auto-accept with first other bot
    if (action.type === "offer-trade") {
      tradeCount++;
      const offerResult = applyAction(state, action);
      if (offerResult.valid && offerResult.newState && offerResult.newState.pendingTrades.length > 0) {
        const trade = offerResult.newState.pendingTrades[offerResult.newState.pendingTrades.length - 1];
        // Try to find an acceptor
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
          if (cancelResult.valid && cancelResult.newState) {
            state = cancelResult.newState;
          } else {
            state = offerResult.newState;
          }
        }
        consecutiveFailures = 0;
        continue;
      }
      consecutiveFailures++;
      if (consecutiveFailures > 20) break;
      continue;
    }

    const result = applyAction(state, action);
    if (!result.valid) {
      if (action.type !== "end-turn" && state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid) { state = fallback.newState!; consecutiveFailures = 0; continue; }
      }
      consecutiveFailures++;
      if (consecutiveFailures > 20) break;
      continue;
    }

    state = result.newState!;
    consecutiveFailures = 0;
  }

  return { state, turns, tradeCount };
}

describe("Bot Strategic Context", () => {
  it("computes production rates correctly", () => {
    const state = createGame("test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    const setup = playThroughSetup(state);

    const context = computeStrategicContext(setup, 0);

    // Should have non-zero production from setup settlements
    const totalProduction = Object.values(context.productionRates).reduce((s, v) => s + v, 0);
    expect(totalProduction).toBeGreaterThan(0);
  });

  it("selects a valid strategy", () => {
    const state = createGame("test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    const setup = playThroughSetup(state);

    const context = computeStrategicContext(setup, 0);
    expect(["expansion", "cities", "development"]).toContain(context.strategy);
  });

  it("tracks road and army distances", () => {
    const state = createGame("test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    const setup = playThroughSetup(state);

    const context = computeStrategicContext(setup, 0);

    expect(context.distanceToLongestRoad).toBeGreaterThanOrEqual(0);
    expect(context.distanceToLargestArmy).toBeGreaterThanOrEqual(0);
  });

  it("computes threat assessments for opponents", () => {
    const state = createGame("test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    const setup = playThroughSetup(state);

    const context = computeStrategicContext(setup, 0);

    // Should have 3 opponent threats (for 4 player game)
    expect(context.playerThreats.length).toBe(3);

    for (const threat of context.playerThreats) {
      expect(threat.threatScore).toBeGreaterThanOrEqual(0);
      expect(threat.playerIndex).not.toBe(0);
    }
  });

  it("identifies missing resources", () => {
    const state = createGame("test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    const setup = playThroughSetup(state);

    const context = computeStrategicContext(setup, 0);

    for (const res of context.missingResources) {
      expect(context.productionRates[res]).toBe(0);
    }
  });
});

describe("Personality System", () => {
  it("personality weights apply correctly to context", () => {
    const state = createGameWithPersonality("pers-test", ["Bot1", "Bot2", "Bot3", "Bot4"], "aggressive");
    const setup = playThroughSetup(state);

    const context = computeStrategicContext(setup, 0);
    expect(context.personality).toBe("aggressive");
    expect(context.weights.robberAggression).toBe(1.8);
    expect(context.weights.knightEagerness).toBe(1.5);
  });

  it("different personalities produce different weights", () => {
    const balanced = getWeights("balanced");
    const aggressive = getWeights("aggressive");
    const builder = getWeights("builder");
    const trader = getWeights("trader");
    const devcard = getWeights("devcard");

    expect(aggressive.robberAggression).toBeGreaterThan(balanced.robberAggression);
    expect(builder.cityScore).toBeGreaterThan(balanced.cityScore);
    expect(trader.playerTradeChance).toBeGreaterThan(balanced.playerTradeChance);
    expect(devcard.devCardScore).toBeGreaterThan(balanced.devCardScore);
  });

  it("build goal computation works correctly", () => {
    const state = createGame("goal-test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    const setup = playThroughSetup(state);

    const context = computeStrategicContext(setup, 0);

    // After setup, bot should have a build goal
    if (context.buildGoal) {
      expect(["city", "settlement", "road", "developmentCard"]).toContain(context.buildGoal.type);
      expect(context.buildGoal.estimatedTurns).toBeGreaterThanOrEqual(0);
    }
  });

  it("endgame mode activates at correct VP threshold", () => {
    const state = createGame("endgame-test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    const setup = playThroughSetup(state);

    const context = computeStrategicContext(setup, 0);
    // At start, players have 2 VP — endgame threshold for balanced is 0.8 * 10 = 8
    expect(context.isEndgame).toBe(false);
    expect(context.ownVP).toBeGreaterThanOrEqual(2);
  });

  it("setup turn order affects context", () => {
    const state = createGame("setup-test", ["Bot1", "Bot2", "Bot3", "Bot4"]);

    const ctx0 = computeStrategicContext(state, 0);
    const ctx1 = computeStrategicContext(state, 1);

    // turnOrderPosition is now relative to startingPlayerIndex (draft position)
    const expected0 = (0 - state.startingPlayerIndex + 4) % 4;
    const expected1 = (1 - state.startingPlayerIndex + 4) % 4;

    expect(ctx0.turnOrderPosition).toBe(expected0);
    expect(ctx1.turnOrderPosition).toBe(expected1);
    expect(ctx0.playerCount).toBe(4);
  });
});

describe("Enhanced Bot Game Simulation", () => {
  it("enhanced bots complete a 4-player game", () => {
    let state = createGame("enhanced-test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    const { state: finalState, turns } = runBotGameWithTrades(state);

    expect(finalState.phase).toBe("finished");
    expect(finalState.winner).not.toBeNull();
    console.log(`Enhanced 4p game: ${turns} turns, winner: ${finalState.players[finalState.winner!].name}`);
  });

  it("enhanced bots complete 5 consecutive games without infinite loops", () => {
    for (let g = 0; g < 5; g++) {
      let state = createGame(`game-${g}`, ["Bot1", "Bot2", "Bot3", "Bot4"]);
      const { state: finalState } = runBotGameWithTrades(state);
      expect(finalState.phase).toBe("finished");
    }
  });
});

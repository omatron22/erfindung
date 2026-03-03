import { describe, it, expect } from "vitest";
import { createGame, applyAction } from "@/server/engine/gameEngine";
import { computeStrategicContext } from "@/server/bots/strategy/context";
import { decideBotAction } from "@/server/bots/botController";
import type { GameState } from "@/shared/types/game";

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

describe("Enhanced Bot Game Simulation", () => {
  it("enhanced bots complete a 4-player game", () => {
    let state = createGame("enhanced-test", ["Bot1", "Bot2", "Bot3", "Bot4"]);
    let turns = 0;
    let consecutiveFailures = 0;

    while (state.phase !== "finished" && turns < 1500) {
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

    expect(state.phase).toBe("finished");
    expect(state.winner).not.toBeNull();
    console.log(`Enhanced 4p game: ${turns} turns, winner: ${state.players[state.winner!].name}`);
  });

  it("enhanced bots complete 5 consecutive games without infinite loops", () => {
    for (let g = 0; g < 5; g++) {
      let state = createGame(`game-${g}`, ["Bot1", "Bot2", "Bot3", "Bot4"]);
      let turns = 0;
      let consecutiveFailures = 0;

      while (state.phase !== "finished" && turns < 1500) {
        turns++;
        const botIndex = state.turnPhase === "discard" && state.discardingPlayers.length > 0
          ? state.discardingPlayers[0]
          : state.currentPlayerIndex;

        const action = decideBotAction(state, botIndex);
        if (!action) {
          if (state.turnPhase === "trade-or-build") {
            const fb = applyAction(state, { type: "end-turn", playerIndex: botIndex });
            if (fb.valid) { state = fb.newState!; consecutiveFailures = 0; continue; }
          }
          consecutiveFailures++;
          if (consecutiveFailures > 20) break;
          continue;
        }

        const result = applyAction(state, action);
        if (!result.valid) {
          if (action.type !== "end-turn" && state.turnPhase === "trade-or-build") {
            const fb = applyAction(state, { type: "end-turn", playerIndex: botIndex });
            if (fb.valid) { state = fb.newState!; consecutiveFailures = 0; continue; }
          }
          consecutiveFailures++;
          if (consecutiveFailures > 20) break;
          continue;
        }

        state = result.newState!;
        consecutiveFailures = 0;
      }

      expect(state.phase).toBe("finished");
    }
  });
});

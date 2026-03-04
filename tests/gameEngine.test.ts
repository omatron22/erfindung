import { describe, it, expect, beforeEach } from "vitest";
import { createGame, applyAction } from "@/server/engine/gameEngine";
import { adjacentVertices, edgesAtVertex, hexVertices, parseHexKey } from "@/shared/utils/hexMath";
import type { GameState } from "@/shared/types/game";

function getFirstValidSetupVertex(state: GameState): string {
  for (const [vk, building] of Object.entries(state.board.vertices)) {
    if (building !== null) continue;
    const adj = adjacentVertices(vk);
    const tooClose = adj.some(
      (av: string) => state.board.vertices[av] !== null && state.board.vertices[av] !== undefined
    );
    if (!tooClose) return vk;
  }
  throw new Error("No valid vertex found");
}

function getFirstValidEdge(state: GameState, vertex: string): string {
  const edges = edgesAtVertex(vertex);
  for (const ek of edges) {
    if (state.board.edges[ek] === null) return ek;
  }
  throw new Error("No valid edge found");
}

function playThroughSetup(state: GameState): GameState {
  let current = state;
  const numPlayers = current.players.length;

  for (let i = 0; i < numPlayers; i++) {
    const vertex = getFirstValidSetupVertex(current);
    let result = applyAction(current, {
      type: "place-settlement",
      playerIndex: current.currentPlayerIndex,
      vertex,
    });
    expect(result.valid).toBe(true);
    current = result.newState!;

    const edge = getFirstValidEdge(current, vertex);
    result = applyAction(current, {
      type: "place-road",
      playerIndex: current.currentPlayerIndex,
      edge,
    });
    expect(result.valid).toBe(true);
    current = result.newState!;
  }

  for (let i = 0; i < numPlayers; i++) {
    const vertex = getFirstValidSetupVertex(current);
    let result = applyAction(current, {
      type: "place-settlement",
      playerIndex: current.currentPlayerIndex,
      vertex,
    });
    expect(result.valid).toBe(true);
    current = result.newState!;

    const edge = getFirstValidEdge(current, vertex);
    result = applyAction(current, {
      type: "place-road",
      playerIndex: current.currentPlayerIndex,
      edge,
    });
    expect(result.valid).toBe(true);
    current = result.newState!;
  }

  return current;
}

function handleSevenIfNeeded(state: GameState, playerIndex: number): GameState {
  if (state.turnPhase === "discard") {
    for (const pi of [...state.discardingPlayers]) {
      const player = state.players[pi];
      const total = Object.values(player.resources).reduce((s, n) => s + n, 0);
      const discardCount = Math.floor(total / 2);
      const resources: Record<string, number> = {};
      let remaining = discardCount;
      for (const [res, amount] of Object.entries(player.resources)) {
        const take = Math.min(remaining, amount);
        if (take > 0) resources[res] = take;
        remaining -= take;
        if (remaining <= 0) break;
      }
      const result = applyAction(state, {
        type: "discard-resources",
        playerIndex: pi,
        resources,
      });
      if (result.valid) state = result.newState!;
    }
  }

  if (state.turnPhase === "robber-place") {
    const newHex = Object.keys(state.board.hexes).find(
      (k) => k !== state.board.robberHex
    )!;
    const result = applyAction(state, {
      type: "move-robber",
      playerIndex,
      hex: newHex,
    });
    if (result.valid) state = result.newState!;
  }

  if (state.turnPhase === "robber-steal") {
    const hexCoord = parseHexKey(state.board.robberHex);
    const vertices = hexVertices(hexCoord);
    for (const vk of vertices) {
      const building = state.board.vertices[vk];
      if (building && building.playerIndex !== playerIndex) {
        const result = applyAction(state, {
          type: "steal-resource",
          playerIndex,
          targetPlayer: building.playerIndex,
        });
        if (result.valid) {
          state = result.newState!;
          break;
        }
      }
    }
  }

  return state;
}

describe("Game Creation", () => {
  it("creates a game with correct initial state", () => {
    const state = createGame("test", ["Alice", "Bob", "Carol", "Dave"]);
    expect(state.players).toHaveLength(4);
    expect(state.phase).toBe("setup-forward");
    expect(state.currentPlayerIndex).toBe(state.startingPlayerIndex);
    expect(state.players[0].name).toBe("Alice");
    expect(state.developmentCardDeck).toHaveLength(25);
  });

  it("creates players with empty resources", () => {
    const state = createGame("test", ["A", "B"]);
    for (const p of state.players) {
      expect(p.resources).toEqual({ brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 });
      expect(p.victoryPoints).toBe(0);
    }
  });
});

describe("Setup Phase", () => {
  let state: GameState;

  beforeEach(() => {
    state = createGame("test", ["Alice", "Bob", "Carol", "Dave"]);
  });

  it("allows first player to place a settlement", () => {
    const firstPlayer = state.currentPlayerIndex;
    const vertex = getFirstValidSetupVertex(state);
    const result = applyAction(state, {
      type: "place-settlement",
      playerIndex: firstPlayer,
      vertex,
    });
    expect(result.valid).toBe(true);
    expect(result.newState!.board.vertices[vertex]).toEqual({
      type: "settlement",
      playerIndex: firstPlayer,
    });
    expect(result.newState!.players[firstPlayer].victoryPoints).toBe(1);
  });

  it("rejects settlement from wrong player", () => {
    const firstPlayer = state.currentPlayerIndex;
    const wrongPlayer = (firstPlayer + 1) % state.players.length;
    const vertex = getFirstValidSetupVertex(state);
    const result = applyAction(state, {
      type: "place-settlement",
      playerIndex: wrongPlayer,
      vertex,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects road before settlement in setup", () => {
    const firstPlayer = state.currentPlayerIndex;
    const result = applyAction(state, {
      type: "place-road",
      playerIndex: firstPlayer,
      edge: Object.keys(state.board.edges)[0],
    });
    expect(result.valid).toBe(false);
  });

  it("completes setup and enters main phase", () => {
    const afterSetup = playThroughSetup(state);
    expect(afterSetup.phase).toBe("main");
    expect(afterSetup.turnPhase).toBe("roll");
    expect(afterSetup.currentPlayerIndex).toBe(afterSetup.startingPlayerIndex);
    for (const p of afterSetup.players) {
      expect(p.settlements).toHaveLength(2);
      expect(p.roads).toHaveLength(2);
      expect(p.victoryPoints).toBe(2);
    }
  });

  it("gives initial resources during reverse setup", () => {
    const afterSetup = playThroughSetup(state);
    const totalResources = afterSetup.players.reduce(
      (sum, p) => sum + Object.values(p.resources).reduce((s, n) => s + n, 0),
      0
    );
    expect(totalResources).toBeGreaterThan(0);
  });
});

describe("Main Phase - Dice Rolling", () => {
  let state: GameState;

  beforeEach(() => {
    const initial = createGame("test", ["Alice", "Bob", "Carol", "Dave"]);
    state = playThroughSetup(initial);
  });

  it("allows current player to roll dice", () => {
    const cp = state.currentPlayerIndex;
    const result = applyAction(state, { type: "roll-dice", playerIndex: cp });
    expect(result.valid).toBe(true);
    expect(result.newState!.lastDiceRoll).not.toBeNull();
    expect(result.newState!.lastDiceRoll!.total).toBeGreaterThanOrEqual(2);
    expect(result.newState!.lastDiceRoll!.total).toBeLessThanOrEqual(12);
  });

  it("rejects dice roll from wrong player", () => {
    const cp = state.currentPlayerIndex;
    const wrong = (cp + 1) % state.players.length;
    const result = applyAction(state, { type: "roll-dice", playerIndex: wrong });
    expect(result.valid).toBe(false);
  });

  it("rejects double dice roll", () => {
    const cp = state.currentPlayerIndex;
    const result1 = applyAction(state, { type: "roll-dice", playerIndex: cp });
    expect(result1.valid).toBe(true);
    if (result1.newState!.turnPhase === "trade-or-build") {
      const result2 = applyAction(result1.newState!, { type: "roll-dice", playerIndex: cp });
      expect(result2.valid).toBe(false);
    }
  });
});

describe("Main Phase - End Turn", () => {
  let state: GameState;

  beforeEach(() => {
    const initial = createGame("test", ["Alice", "Bob", "Carol", "Dave"]);
    state = playThroughSetup(initial);
  });

  it("advances to next player on end turn", () => {
    const cp = state.currentPlayerIndex;
    let result = applyAction(state, { type: "roll-dice", playerIndex: cp });
    expect(result.valid).toBe(true);
    let current = handleSevenIfNeeded(result.newState!, cp);

    result = applyAction(current, { type: "end-turn", playerIndex: cp });
    expect(result.valid).toBe(true);
    expect(result.newState!.currentPlayerIndex).toBe((cp + 1) % state.players.length);
    expect(result.newState!.turnPhase).toBe("roll");
  });
});

describe("Trading", () => {
  let state: GameState;
  let cp: number;

  beforeEach(() => {
    const initial = createGame("test", ["Alice", "Bob", "Carol", "Dave"]);
    state = playThroughSetup(initial);
    cp = state.currentPlayerIndex;
    let result = applyAction(state, { type: "roll-dice", playerIndex: cp });
    state = result.newState!;
    state = handleSevenIfNeeded(state, cp);
  });

  it("allows bank trade with 4:1 ratio", () => {
    state.players[cp].resources.brick = 4;
    const result = applyAction(state, {
      type: "bank-trade",
      playerIndex: cp,
      giving: "brick",
      givingCount: 4,
      receiving: "ore",
    });
    expect(result.valid).toBe(true);
    expect(result.newState!.players[cp].resources.brick).toBe(0);
    expect(result.newState!.players[cp].resources.ore).toBe(state.players[cp].resources.ore + 1);
  });

  it("rejects bank trade with insufficient resources", () => {
    state.players[cp].resources.brick = 3;
    const result = applyAction(state, {
      type: "bank-trade",
      playerIndex: cp,
      giving: "brick",
      givingCount: 4,
      receiving: "ore",
    });
    expect(result.valid).toBe(false);
  });

  it("allows multi-ratio bank trade (8:2 at 4:1)", () => {
    state.players[cp].resources.brick = 8;
    const result = applyAction(state, {
      type: "bank-trade",
      playerIndex: cp,
      giving: "brick",
      givingCount: 8,
      receiving: "ore",
    });
    expect(result.valid).toBe(true);
    expect(result.newState!.players[cp].resources.brick).toBe(0);
    expect(result.newState!.players[cp].resources.ore).toBe(state.players[cp].resources.ore + 2);
  });

  it("allows multi-ratio bank trade with port (4:2 at 2:1)", () => {
    state.players[cp].resources.brick = 4;
    state.players[cp].portsAccess = ["brick"];
    const result = applyAction(state, {
      type: "bank-trade",
      playerIndex: cp,
      giving: "brick",
      givingCount: 4,
      receiving: "ore",
    });
    expect(result.valid).toBe(true);
    expect(result.newState!.players[cp].resources.brick).toBe(0);
    expect(result.newState!.players[cp].resources.ore).toBe(state.players[cp].resources.ore + 2);
  });

  it("rejects non-multiple bank trade amount", () => {
    state.players[cp].resources.brick = 5;
    const result = applyAction(state, {
      type: "bank-trade",
      playerIndex: cp,
      giving: "brick",
      givingCount: 5,
      receiving: "ore",
    });
    expect(result.valid).toBe(false);
  });
});

describe("Development Cards", () => {
  let state: GameState;
  let cp: number;

  beforeEach(() => {
    const initial = createGame("test", ["Alice", "Bob", "Carol", "Dave"]);
    state = playThroughSetup(initial);
    cp = state.currentPlayerIndex;
    let result = applyAction(state, { type: "roll-dice", playerIndex: cp });
    state = result.newState!;
    state = handleSevenIfNeeded(state, cp);
  });

  it("allows buying a development card with resources", () => {
    state.players[cp].resources.ore = 1;
    state.players[cp].resources.grain = 1;
    state.players[cp].resources.wool = 1;
    const result = applyAction(state, {
      type: "buy-development-card",
      playerIndex: cp,
    });
    expect(result.valid).toBe(true);
    expect(result.newState!.players[cp].newDevelopmentCards).toHaveLength(1);
    expect(result.newState!.developmentCardDeck.length).toBe(state.developmentCardDeck.length - 1);
  });

  it("knight moves to robber-place phase", () => {
    state.players[cp].developmentCards = ["knight"];
    const result = applyAction(state, {
      type: "play-knight",
      playerIndex: cp,
    });
    expect(result.valid).toBe(true);
    expect(result.newState!.turnPhase).toBe("robber-place");
    expect(result.newState!.players[cp].knightsPlayed).toBe(1);
  });

  it("monopoly takes all of chosen resource", () => {
    const others = state.players.filter((_, i) => i !== cp);
    state.players[cp].developmentCards = ["monopoly"];
    others[0].resources.grain = 3;
    others[1].resources.grain = 2;
    others[2].resources.grain = 1;
    const startGrain = state.players[cp].resources.grain;
    const result = applyAction(state, {
      type: "play-monopoly",
      playerIndex: cp,
      resource: "grain",
    });
    expect(result.valid).toBe(true);
    expect(result.newState!.players[cp].resources.grain).toBe(startGrain + 6);
    for (const other of others) {
      expect(result.newState!.players[other.index].resources.grain).toBe(0);
    }
  });

  it("year of plenty gives 2 resources", () => {
    state.players[cp].developmentCards = ["yearOfPlenty"];
    const startOre = state.players[cp].resources.ore;
    const startGrain = state.players[cp].resources.grain;
    const result = applyAction(state, {
      type: "play-year-of-plenty",
      playerIndex: cp,
      resource1: "ore",
      resource2: "grain",
    });
    expect(result.valid).toBe(true);
    expect(result.newState!.players[cp].resources.ore).toBe(startOre + 1);
    expect(result.newState!.players[cp].resources.grain).toBe(startGrain + 1);
  });

  it("rejects playing two dev cards in one turn", () => {
    state.players[cp].developmentCards = ["knight", "monopoly"];
    let result = applyAction(state, { type: "play-knight", playerIndex: cp });
    expect(result.valid).toBe(true);

    const newHex = Object.keys(result.newState!.board.hexes).find(
      (k) => k !== result.newState!.board.robberHex
    )!;
    result = applyAction(result.newState!, {
      type: "move-robber",
      playerIndex: cp,
      hex: newHex,
    });
    let current = result.newState!;
    if (current.turnPhase === "robber-steal") return; // skip rest

    result = applyAction(current, {
      type: "play-monopoly",
      playerIndex: cp,
      resource: "brick",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Already played");
  });
});

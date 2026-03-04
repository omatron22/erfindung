import type { GameState, Resource } from "@/shared/types/game";
import type { GameAction } from "@/shared/types/actions";
import { pickSetupVertex, pickSetupRoad, pickBuildVertex } from "./strategy/placement";
import { pickBuildRoad } from "./strategy/roads";
import { pickBankTrade, pickPlayerTrade, shouldRejectLeaderTrade } from "./strategy/trading";
import { pickRobberHex, pickStealTarget, pickDiscardResources } from "./strategy/robber";
import { pickDevCardToPlay } from "./strategy/devCards";
import { computeStrategicContext, type BotStrategicContext } from "./strategy/context";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";
import {
  edgesAtVertex,
  edgeEndpoints,
  adjacentVertices,
} from "@/shared/utils/hexMath";

/**
 * Given the current game state and a bot player index,
 * decide what action the bot should take.
 * Returns null if it's not this bot's turn or no action needed.
 */
export function decideBotAction(state: GameState, botIndex: number): GameAction | null {
  // Handle discard phase (any bot might need to discard, not just current player)
  if (state.turnPhase === "discard" && state.discardingPlayers.includes(botIndex)) {
    return makeDiscardAction(state, botIndex);
  }

  // All other actions require it to be our turn
  if (state.currentPlayerIndex !== botIndex) return null;

  // Setup phases — compute context for turn-order awareness
  if (state.phase === "setup-forward" || state.phase === "setup-reverse") {
    let context: BotStrategicContext | undefined;
    try {
      context = computeStrategicContext(state, botIndex);
    } catch {
      // Fallback to basic setup if context computation fails
    }
    return makeSetupAction(state, botIndex, context);
  }

  // Main game
  if (state.phase !== "main") return null;

  // Compute strategic context for main-phase decisions
  const context = computeStrategicContext(state, botIndex);

  switch (state.turnPhase) {
    case "roll":
      return makeRollOrPlayDevCard(state, botIndex, context);
    case "robber-place":
      return makeRobberPlaceAction(state, botIndex, context);
    case "robber-steal":
      return makeStealAction(state, botIndex, context);
    case "trade-or-build":
      return makeMainPhaseAction(state, botIndex, context);
    case "road-building-1":
    case "road-building-2":
      return makeRoadBuildingAction(state, botIndex, context);
    case "monopoly":
    case "year-of-plenty":
      return null; // These are handled by dev card play
    default:
      return null;
  }
}

function makeSetupAction(state: GameState, botIndex: number, context?: BotStrategicContext): GameAction | null {
  const isSettlementTurn = state.setupPlacementsMade % 2 === 0;

  if (isSettlementTurn) {
    const vertex = pickSetupVertex(state, botIndex, context);
    if (!vertex) return null;
    return { type: "place-settlement", playerIndex: botIndex, vertex };
  } else {
    const lastSettlement = state.players[botIndex].settlements[
      state.players[botIndex].settlements.length - 1
    ];
    const edge = pickSetupRoad(state, botIndex, lastSettlement, context);
    if (!edge) return null;
    return { type: "place-road", playerIndex: botIndex, edge };
  }
}

function makeRollOrPlayDevCard(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const player = state.players[botIndex];
  if (!player.hasPlayedDevCardThisTurn && player.developmentCards.includes("knight")) {
    // Army-aware knight play probability before rolling, scaled by personality
    let playProb = 0.3 * context.weights.knightEagerness;
    if (context.distanceToLargestArmy <= 1) playProb = Math.min(1, 0.8 * context.weights.knightEagerness);
    else if (context.distanceToLargestArmy <= 2) playProb = Math.min(1, 0.6 * context.weights.knightEagerness);

    if (Math.random() < playProb) {
      return { type: "play-knight", playerIndex: botIndex };
    }
  }

  return { type: "roll-dice", playerIndex: botIndex };
}

function makeRobberPlaceAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const hex = pickRobberHex(state, botIndex, context);
  return { type: "move-robber", playerIndex: botIndex, hex };
}

function makeStealAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction | null {
  const target = pickStealTarget(state, botIndex, context);
  if (target === null) return null;
  return { type: "steal-resource", playerIndex: botIndex, targetPlayer: target };
}

function makeDiscardAction(state: GameState, botIndex: number): GameAction {
  // Compute context for strategy-aware discard
  let context: BotStrategicContext | undefined;
  try {
    context = computeStrategicContext(state, botIndex);
  } catch {
    // Fallback to basic discard if context computation fails
  }
  const resources = pickDiscardResources(state, botIndex, context);
  return { type: "discard-resources", playerIndex: botIndex, resources };
}

interface BuildOption {
  name: string;
  score: number;
  execute: () => GameAction | null;
}

function makeMainPhaseAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const player = state.players[botIndex];
  const w = context.weights;

  // 1. Consider playing a dev card
  if (!player.hasPlayedDevCardThisTurn) {
    const devCard = pickDevCardToPlay(state, botIndex, context);
    if (devCard) {
      switch (devCard.card) {
        case "knight":
          return { type: "play-knight", playerIndex: botIndex };
        case "roadBuilding":
          return { type: "play-road-building", playerIndex: botIndex };
        case "yearOfPlenty":
          return {
            type: "play-year-of-plenty",
            playerIndex: botIndex,
            resource1: (devCard.params?.resource1 as Resource) || "ore",
            resource2: (devCard.params?.resource2 as Resource) || "grain",
          };
        case "monopoly":
          return {
            type: "play-monopoly",
            playerIndex: botIndex,
            resource: (devCard.params?.resource as Resource) || "ore",
          };
      }
    }
  }

  // 2. Adaptive build priorities — score each option with personality weights
  const options: BuildOption[] = [];

  // City (highest priority — direct VP)
  if (canAfford(player, BUILDING_COSTS.city) && player.settlements.length > 0) {
    let score = 100 * w.cityScore;
    if (context.strategy === "cities") score += 20;
    if (context.isEndgame) score += 30;
    options.push({
      name: "city",
      score,
      execute: () => {
        const vertex = player.settlements[0];
        return { type: "build-city", playerIndex: botIndex, vertex };
      },
    });
  }

  // Settlement (second priority — direct VP)
  let hasReachableVertex = false;
  if (canAfford(player, BUILDING_COSTS.settlement)) {
    const vertex = pickBuildVertex(state, botIndex);
    if (vertex) {
      hasReachableVertex = true;
      let score = 80 * w.settlementScore;
      if (context.strategy === "expansion") score += 15;
      if (context.isEndgame) score += 20;
      options.push({
        name: "settlement",
        score,
        execute: () => ({ type: "build-settlement", playerIndex: botIndex, vertex }),
      });
    }
  }

  // Dev card
  if (canAfford(player, BUILDING_COSTS.developmentCard) && state.developmentCardDeck.length > 0) {
    let score = 25 * w.devCardScore;
    if (context.distanceToLargestArmy <= 2) score += 60;
    if (context.distanceToLargestArmy <= 1) score += 80;
    if (context.strategy === "development") score += 30;
    if (context.isEndgame && context.distanceToLargestArmy <= 2) score += 25;
    options.push({
      name: "devCard",
      score,
      execute: () => ({ type: "buy-development-card", playerIndex: botIndex }),
    });
  }

  // Road
  if (canAfford(player, BUILDING_COSTS.road) && player.roads.length < 15) {
    const edge = pickBuildRoad(state, botIndex, context);
    if (edge) {
      let score = 15 * w.roadScore;
      if (context.distanceToLongestRoad <= 2) score += 50;
      if (context.strategy === "expansion") score += 10;
      if (context.isEndgame && context.distanceToLongestRoad <= 2) score += 15;
      // Boost road score when no reachable vertex — need roads to expand
      if (!hasReachableVertex) score += 40;
      options.push({
        name: "road",
        score,
        execute: () => ({ type: "build-road", playerIndex: botIndex, edge }),
      });
    }
  }

  // Multi-turn planning guard: penalize options that spend resources the build goal needs
  if (context.buildGoal && w.resourceHoarding > 1) {
    for (const option of options) {
      const costKey = option.name === "devCard" ? "developmentCard" : option.name;
      const cost = BUILDING_COSTS[costKey as keyof typeof BUILDING_COSTS];
      if (!cost) continue;

      let conflictsWithGoal = false;
      for (const [res, amount] of Object.entries(cost)) {
        const goalNeed = context.buildGoal.missingResources[res as Resource] ?? 0;
        if (goalNeed > 0 && player.resources[res as Resource] < (amount || 0) + goalNeed) {
          conflictsWithGoal = true;
          break;
        }
      }

      // Only penalize non-goal builds
      if (conflictsWithGoal && costKey !== context.buildGoal.type) {
        option.score *= (1 / w.resourceHoarding);
      }
    }
  }

  // Sort by score descending and try each
  options.sort((a, b) => b.score - a.score);
  for (const option of options) {
    const action = option.execute();
    if (action) return action;
  }

  // 3. Consider bot-initiated player trade
  const playerTrade = pickPlayerTrade(state, botIndex, context);
  if (playerTrade) {
    return {
      type: "offer-trade",
      playerIndex: botIndex,
      offering: playerTrade.offering,
      requesting: playerTrade.requesting,
      toPlayer: null, // open offer
    };
  }

  // 4. Consider bank trading
  const bankTrade = pickBankTrade(state, botIndex, context);
  if (bankTrade) {
    return {
      type: "bank-trade",
      playerIndex: botIndex,
      giving: bankTrade.giving,
      givingCount: bankTrade.givingCount,
      receiving: bankTrade.receiving,
    };
  }

  // 5. Nothing useful to do, end turn
  return { type: "end-turn", playerIndex: botIndex };
}

function makeRoadBuildingAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const edge = pickBuildRoad(state, botIndex, context);
  if (edge) {
    return { type: "build-road", playerIndex: botIndex, edge };
  }
  // Fallback: try any valid edge
  for (const [ek, road] of Object.entries(state.board.edges)) {
    if (road !== null) continue;
    const [v1, v2] = edgeEndpoints(ek);
    for (const v of [v1, v2]) {
      const building = state.board.vertices[v];
      if (building && building.playerIndex === botIndex) {
        return { type: "build-road", playerIndex: botIndex, edge: ek };
      }
      if (building && building.playerIndex !== botIndex) continue;
      const adjEdges = edgesAtVertex(v);
      for (const ae of adjEdges) {
        if (ae !== ek && state.board.edges[ae]?.playerIndex === botIndex) {
          return { type: "build-road", playerIndex: botIndex, edge: ek };
        }
      }
    }
  }

  return { type: "end-turn", playerIndex: botIndex };
}

function canAfford(
  player: { resources: Record<Resource, number> },
  cost: Partial<Record<Resource, number>>
): boolean {
  for (const [res, amount] of Object.entries(cost)) {
    if ((amount || 0) > player.resources[res as Resource]) return false;
  }
  return true;
}

/**
 * Generate a counter-offer from a bot.
 * Uses personality-driven counter-offer chance.
 * Strategic: offers surplus resources, requests needed ones.
 */
export function generateBotCounterOffer(
  state: GameState,
  botIndex: number
): { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null {
  const trade = state.pendingTrade;
  if (!trade) return null;

  // Personality-driven counter-offer chance
  let counterChance = 0.3;
  try {
    const context = computeStrategicContext(state, botIndex);
    counterChance = context.weights.counterOfferChance;

    if (Math.random() > counterChance) return null;

    const bot = state.players[botIndex];

    // Strategic counter: offer surplus, request needed
    if (context.buildGoal) {
      const neededResources: Resource[] = [];
      for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
        if ((amount || 0) > 0) neededResources.push(res as Resource);
      }

      const surplusResources: Resource[] = ALL_RESOURCES.filter((r) => {
        const goalNeed = context.buildGoal?.missingResources[r] ?? 0;
        return bot.resources[r] > goalNeed + 1;
      });

      if (neededResources.length > 0 && surplusResources.length > 0) {
        const giveRes = surplusResources[Math.floor(Math.random() * surplusResources.length)];
        const wantRes = neededResources[Math.floor(Math.random() * neededResources.length)];
        return { offering: { [giveRes]: 1 }, requesting: { [wantRes]: 1 } };
      }
    }

    // Fallback to random 1-for-1
    const requestedKeys = Object.entries(trade.offering)
      .filter(([, amt]) => (amt || 0) > 0)
      .map(([r]) => r as Resource);
    const offeredKeys = Object.entries(trade.requesting)
      .filter(([, amt]) => (amt || 0) > 0)
      .map(([r]) => r as Resource);

    if (requestedKeys.length === 0 || offeredKeys.length === 0) return null;

    const canGive = offeredKeys.filter((r) => bot.resources[r] > 0);
    if (canGive.length === 0) return null;

    const giveRes = canGive[Math.floor(Math.random() * canGive.length)];
    const wantRes = requestedKeys[Math.floor(Math.random() * requestedKeys.length)];
    return { offering: { [giveRes]: 1 }, requesting: { [wantRes]: 1 } };
  } catch {
    // Fallback: basic counter
    if (Math.random() > counterChance) return null;

    const bot = state.players[botIndex];
    const requestedKeys = Object.entries(trade.offering)
      .filter(([, amt]) => (amt || 0) > 0)
      .map(([r]) => r as Resource);
    const offeredKeys = Object.entries(trade.requesting)
      .filter(([, amt]) => (amt || 0) > 0)
      .map(([r]) => r as Resource);

    if (requestedKeys.length === 0 || offeredKeys.length === 0) return null;

    const canGive = offeredKeys.filter((r) => bot.resources[r] > 0);
    if (canGive.length === 0) return null;

    const giveRes = canGive[Math.floor(Math.random() * canGive.length)];
    const wantRes = requestedKeys[Math.floor(Math.random() * requestedKeys.length)];
    return { offering: { [giveRes]: 1 }, requesting: { [wantRes]: 1 } };
  }
}

// Per-turn trade memory to reject repeated identical trades
const tradeMemory = new Map<string, { tradeHash: string; turn: number }>();

function getTradeHash(offering: Partial<Record<Resource, number>>, requesting: Partial<Record<Resource, number>>): string {
  const o = ALL_RESOURCES.map((r) => offering[r] ?? 0).join(",");
  const r = ALL_RESOURCES.map((res) => requesting[res] ?? 0).join(",");
  return `${o}|${r}`;
}

/**
 * Decide whether a bot should accept or reject a pending trade offer.
 * Enhanced: uses build goal and personality weights for threshold.
 */
export function decideBotTradeResponse(state: GameState, botIndex: number): "accept" | "reject" {
  const trade = state.pendingTrade;
  if (!trade) return "reject";
  if (trade.fromPlayer === botIndex) return "reject";
  if (trade.toPlayer !== null && trade.toPlayer !== botIndex) return "reject";

  // Reject repeated identical trades within the same turn
  const memKey = `${botIndex}`;
  const tradeHash = getTradeHash(trade.offering, trade.requesting);
  const mem = tradeMemory.get(memKey);
  if (mem && mem.tradeHash === tradeHash && mem.turn === state.turnNumber) {
    return "reject";
  }

  const bot = state.players[botIndex];

  // Check if bot can afford to give the requested resources
  for (const [res, amount] of Object.entries(trade.requesting)) {
    if ((amount || 0) > bot.resources[res as Resource]) return "reject";
  }

  // Compute context for enhanced evaluation
  let context: BotStrategicContext | undefined;
  try {
    context = computeStrategicContext(state, botIndex);
  } catch {
    // Fallback to basic evaluation
  }

  // Reject trades that help the VP leader
  if (context) {
    if (shouldRejectLeaderTrade(state, trade.fromPlayer, context)) {
      return "reject";
    }

    // Endgame: refuse all trades with anyone within 2 VP of winning
    if (context.isEndgame) {
      const fromThreat = context.playerThreats.find((t) => t.playerIndex === trade.fromPlayer);
      if (fromThreat && fromThreat.visibleVP >= context.vpToWin - 2) {
        return "reject";
      }
    }
  }

  // Score gain vs loss using build goal for accurate need assessment
  let gainScore = 0;
  let lossScore = 0;

  if (context?.buildGoal) {
    // Use build goal for precise need evaluation — strongly favor goal resources
    for (const [res, amount] of Object.entries(trade.offering)) {
      const goalNeed = context.buildGoal.missingResources[res as Resource] ?? 0;
      gainScore += goalNeed > 0 ? (amount || 0) * 5 : (amount || 0) * 0.1;
    }
    for (const [res, amount] of Object.entries(trade.requesting)) {
      const goalNeed = context.buildGoal.missingResources[res as Resource] ?? 0;
      lossScore += goalNeed > 0 ? (amount || 0) * 5 : (amount || 0) * 0.1;
    }
  } else {
    // Fallback to generic resource need scoring
    const buildPriorities: Array<{ name: string; cost: Partial<Record<Resource, number>> }> = [
      { name: "settlement", cost: BUILDING_COSTS.settlement },
      { name: "city", cost: BUILDING_COSTS.city },
      { name: "road", cost: BUILDING_COSTS.road },
      { name: "developmentCard", cost: BUILDING_COSTS.developmentCard },
    ];

    function resourceNeed(res: Resource): number {
      let need = 0;
      for (const { cost } of buildPriorities) {
        const required = cost[res] || 0;
        if (required > 0) {
          const deficit = required - bot.resources[res];
          if (deficit > 0) need += deficit;
        }
      }
      return need;
    }

    for (const [res, amount] of Object.entries(trade.offering)) {
      gainScore += resourceNeed(res as Resource) * (amount || 0);
    }
    for (const [res, amount] of Object.entries(trade.requesting)) {
      lossScore += resourceNeed(res as Resource) * (amount || 0);
    }
  }

  const threshold = context?.weights.tradeAcceptThreshold ?? 0;
  const netBenefit = gainScore - lossScore;

  if (netBenefit > threshold) {
    // Record this trade in memory so we reject repeats
    tradeMemory.set(memKey, { tradeHash, turn: state.turnNumber });
    return "accept";
  }
  if (netBenefit === threshold && Math.random() < 0.3) {
    tradeMemory.set(memKey, { tradeHash, turn: state.turnNumber });
    return "accept";
  }
  return "reject";
}

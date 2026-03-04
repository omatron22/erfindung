import type { GameState, Resource } from "@/shared/types/game";
import type { GameAction } from "@/shared/types/actions";
import { pickSetupVertex, pickSetupRoad, pickBuildVertex, computeVertexProduction } from "./strategy/placement";
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
  hexVertices,
  hexEdges,
  parseHexKey,
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
    case "sheep-nuke-pick":
      return makeSheepNukePickAction(state, botIndex, context);
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

  // 2. Opportunistic build scoring — each action scored by immediate value
  const options: BuildOption[] = [];

  // City — pick the highest-production settlement to upgrade
  if (canAfford(player, BUILDING_COSTS.city) && player.settlements.length > 0) {
    let bestCityVertex = player.settlements[0];
    let bestCityEV = 0;
    for (const v of player.settlements) {
      const prod = computeVertexProduction(state, v);
      if (prod.totalEV > bestCityEV) {
        bestCityEV = prod.totalEV;
        bestCityVertex = v;
      }
    }
    let score = bestCityEV * 90 * w.cityScore;
    if (context.isEndgame) score += 30;
    options.push({
      name: "city",
      score,
      execute: () => ({ type: "build-city", playerIndex: botIndex, vertex: bestCityVertex }),
    });
  }

  // Settlement — scored by vertex production EV + spatial urgency
  let hasReachableVertex = false;
  if (canAfford(player, BUILDING_COSTS.settlement)) {
    const vertex = pickBuildVertex(state, botIndex);
    if (vertex) {
      hasReachableVertex = true;
      const prod = computeVertexProduction(state, vertex);
      let score = prod.totalEV * 100 * w.settlementScore;
      score += context.spatialUrgency * 30;
      if (context.isEndgame) score += 20;
      options.push({
        name: "settlement",
        score,
        execute: () => ({ type: "build-settlement", playerIndex: botIndex, vertex }),
      });
    }
  }

  // Dev card — base value + army threat awareness
  if (canAfford(player, BUILDING_COSTS.developmentCard) && state.developmentCardDeck.length > 0) {
    let score = 15 * w.devCardScore;
    if (context.distanceToLargestArmy <= 2 && player.knightsPlayed >= 2) score += 30;
    if (context.distanceToLargestArmy <= 1 && player.knightsPlayed >= 2) score += 50;
    if (context.largestArmyThreatened) score += 20;
    if (context.isEndgame && context.distanceToLargestArmy <= 2) score += 25;
    options.push({
      name: "devCard",
      score,
      execute: () => ({ type: "buy-development-card", playerIndex: botIndex }),
    });
  }

  // Road — low base, boosted by longest road chase and expansion need
  if (canAfford(player, BUILDING_COSTS.road) && player.roads.length < 15) {
    const edge = pickBuildRoad(state, botIndex, context);
    if (edge) {
      let score = 10 * w.roadScore;
      if (context.distanceToLongestRoad <= 2 && player.longestRoadLength >= 3) score += 25;
      if (context.distanceToLongestRoad <= 1 && player.longestRoadLength >= 3) score += 40;
      if (context.longestRoadThreatened) score += 20;
      if (context.isEndgame && context.distanceToLongestRoad <= 2) score += 15;
      if (!hasReachableVertex) score += 40;
      options.push({
        name: "road",
        score,
        execute: () => ({ type: "build-road", playerIndex: botIndex, edge }),
      });
    }
  }

  // Sheep nuke — consider when enabled and bot has enough wool
  if (state.config?.sheepNuke && player.resources.wool >= 10) {
    // Pre-compute expected damage to decide if nuke is worth it
    let bestNukeScore = -Infinity;
    for (const num of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
      let oppDmg = 0, selfDmg = 0;
      for (const [hk, hex] of Object.entries(state.board.hexes)) {
        if (hex.number !== num) continue;
        const parsedHex = parseHexKey(hk);
        for (const vk of hexVertices(parsedHex)) {
          const b = state.board.vertices[vk];
          if (!b) continue;
          const val = b.type === "city" ? 2 : 1;
          if (b.playerIndex === botIndex) selfDmg += val;
          else oppDmg += val;
        }
      }
      const s = oppDmg - selfDmg * 1.5;
      if (s > bestNukeScore) bestNukeScore = s;
    }
    // Only nuke if expected net damage is significant (at least 1 building worth)
    // and the bot has surplus wool (spending 10 wool is a big cost)
    if (bestNukeScore >= 1) {
      // Aggressive personalities are more trigger-happy with nukes
      const aggressionMult = w.robberAggression ?? 1.0;
      let score = bestNukeScore * 20 * aggressionMult;
      // Devalue if bot is behind (save resources for building)
      if (context.ownVP < context.vpToWin - 3) score *= 0.6;
      // Boost in endgame when disruption matters more
      if (context.isEndgame) score += 15;
      options.push({
        name: "sheepNuke",
        score,
        execute: () => ({ type: "sheep-nuke", playerIndex: botIndex }),
      });
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
    const hash = getTradeHash(playerTrade.offering, playerTrade.requesting);
    const mem = proposedTradeMemory.get(botIndex);
    const tooRecent = mem && mem.hash === hash && state.turnNumber - mem.turn < 3;
    if (!tooRecent) {
      proposedTradeMemory.set(botIndex, { hash, turn: state.turnNumber });
      return {
        type: "offer-trade",
        playerIndex: botIndex,
        offering: playerTrade.offering,
        requesting: playerTrade.requesting,
        toPlayer: null, // open offer
      };
    }
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

function makeSheepNukePickAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  // Pick the number that maximizes opponent damage minus self-damage
  const candidates = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
  let bestNumber = candidates[0];
  let bestScore = -Infinity;

  for (const num of candidates) {
    let opponentDamage = 0;
    let selfDamage = 0;

    for (const [hk, hex] of Object.entries(state.board.hexes)) {
      if (hex.number !== num) continue;
      const parsedHex = parseHexKey(hk);
      for (const vk of hexVertices(parsedHex)) {
        const building = state.board.vertices[vk];
        if (!building) continue;
        const vp = building.type === "city" ? 2 : 1;
        if (building.playerIndex === botIndex) selfDamage += vp;
        else opponentDamage += vp;
      }
      for (const ek of hexEdges(parsedHex)) {
        const road = state.board.edges[ek];
        if (!road) continue;
        if (road.playerIndex === botIndex) selfDamage += 0.3;
        else opponentDamage += 0.3;
      }
    }

    const score = opponentDamage - selfDamage * 1.5;
    if (score > bestScore) {
      bestScore = score;
      bestNumber = num;
    }
  }

  return { type: "sheep-nuke-pick", playerIndex: botIndex, number: bestNumber };
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

/** Check if two resource maps are equivalent (same resources, same amounts) */
function resourceMapsEqual(
  a: Partial<Record<Resource, number>>,
  b: Partial<Record<Resource, number>>,
): boolean {
  for (const r of ALL_RESOURCES) {
    if ((a[r] ?? 0) !== (b[r] ?? 0)) return false;
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

  // Suppress counters that are identical to the original trade (= just accepting)
  function isIdenticalToOriginal(counter: { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> }): boolean {
    return resourceMapsEqual(counter.offering, trade!.requesting) && resourceMapsEqual(counter.requesting, trade!.offering);
  }

  // Personality-driven counter-offer chance
  let counterChance = 0.3;
  try {
    const context = computeStrategicContext(state, botIndex);
    counterChance = context.weights.counterOfferChance;

    // VP gate: don't counter-offer to players who are winning
    if (shouldRejectLeaderTrade(state, trade.fromPlayer, context)) return null;
    if (context.isEndgame) {
      const fromThreat = context.playerThreats.find((t) => t.playerIndex === trade.fromPlayer);
      if (fromThreat && fromThreat.visibleVP >= context.vpToWin - 2) return null;
    }

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
        const counter = { offering: { [giveRes]: 1 }, requesting: { [wantRes]: 1 } };
        if (isIdenticalToOriginal(counter)) return null;
        return counter;
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
    const counter = { offering: { [giveRes]: 1 }, requesting: { [wantRes]: 1 } };
    if (isIdenticalToOriginal(counter)) return null;
    return counter;
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
    const counter = { offering: { [giveRes]: 1 }, requesting: { [wantRes]: 1 } };
    if (isIdenticalToOriginal(counter)) return null;
    return counter;
  }
}

// Per-turn trade memory to reject repeated identical trades (for responses)
const tradeMemory = new Map<string, { tradeHash: string; turn: number }>();

// Per-bot trade proposal memory — prevents bots from proposing the same trade repeatedly
const proposedTradeMemory = new Map<number, { hash: string; turn: number }>();

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

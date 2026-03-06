import type { GameState, Resource } from "@/shared/types/game";
import type { GameAction } from "@/shared/types/actions";
import { pickSetupVertex, pickSetupRoad, pickBuildVertex, computeVertexProduction } from "./strategy/placement";
import { pickBuildRoad, planRoadPath } from "./strategy/roads";
import { pickBankTrade, pickPlayerTrade } from "./strategy/trading";
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

  // 0. Always take a free nuke — no cost, always worth it
  if (state.freeNukeAvailable && state.config?.sheepNuke) {
    return { type: "sheep-nuke", playerIndex: botIndex };
  }

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

  // Settlement — highest strategic priority (1 VP + new production)
  let hasReachableVertex = false;
  if (canAfford(player, BUILDING_COSTS.settlement)) {
    const vertex = pickBuildVertex(state, botIndex);
    if (vertex) {
      hasReachableVertex = true;
      const prod = computeVertexProduction(state, vertex);
      let score = prod.totalEV * 120 * w.settlementScore;
      score += 25; // base VP bonus — settlements are always valuable
      score += context.spatialUrgency * 30;
      if (context.isEndgame) score += 30;
      // Bonus for resource diversity the player is currently missing
      const currentResources = new Set<Resource>();
      for (const s of player.settlements) {
        const sp = computeVertexProduction(state, s);
        for (const r of sp.resourceSet) currentResources.add(r);
      }
      for (const s of player.cities) {
        const sp = computeVertexProduction(state, s);
        for (const r of sp.resourceSet) currentResources.add(r);
      }
      let newResCount = 0;
      for (const r of prod.resourceSet) {
        if (!currentResources.has(r)) newResCount++;
      }
      score += newResCount * 12; // diversification bonus
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

      // Longest road pursuit
      if (context.distanceToLongestRoad <= 2 && player.longestRoadLength >= 3) score += 25;
      if (context.distanceToLongestRoad <= 1 && player.longestRoadLength >= 3) score += 40;
      if (context.longestRoadThreatened) score += 20;
      if (context.isEndgame && context.distanceToLongestRoad <= 2) score += 15;

      // Expansion: only boost if no settlement spot is reachable
      if (!hasReachableVertex) {
        const roadPlan = planRoadPath(state, botIndex, context);
        if (roadPlan && roadPlan.targetScore > 10) {
          score += 20 + roadPlan.targetScore * 0.2;
        } else {
          score += 5; // very mild — save resources for settlement
        }
      }

      // PENALTY: if we're close to affording a settlement, don't waste brick/lumber on roads
      // Settlement costs: brick, lumber, wool, grain. Road costs: brick, lumber.
      // If we already have wool+grain (or close), save the brick+lumber for a settlement.
      if (hasReachableVertex) {
        // Already can build a settlement — road should almost never win
        score -= 20;
      } else {
        const { brick, lumber, wool, grain } = player.resources;
        const settlementResourcesReady = (wool >= 1 ? 1 : 0) + (grain >= 1 ? 1 : 0);
        if (settlementResourcesReady >= 2 && brick >= 1 && lumber >= 1) {
          // We have all 4 resources for a settlement but no reachable vertex.
          // Only build a road if it's one road away from a good spot.
          const roadPlan = planRoadPath(state, botIndex, context);
          if (!roadPlan || roadPlan.path.length > 1) {
            score -= 15; // save resources — we're not one road away
          }
        } else if (settlementResourcesReady >= 1 && (brick >= 2 || lumber >= 2)) {
          // Close to settlement — mild penalty on road building
          score -= 8;
        }
      }

      options.push({
        name: "road",
        score,
        execute: () => ({ type: "build-road", playerIndex: botIndex, edge }),
      });
    }
  }

  // Sheep nuke — desperation move only. The nuke always risks self-damage,
  // so bots only consider it when they're losing badly and have nothing to lose.
  if (state.config?.sheepNuke && player.resources.wool >= 10) {
    const leader = context.playerThreats[0];
    const leaderVP = leader?.visibleVP ?? 0;
    const vpBehind = leaderVP - context.ownVP;
    const leaderCloseToWin = leaderVP >= context.vpToWin - 2;
    const botFarBehind = vpBehind >= 3;

    // Only consider nuking if desperate: far behind OR leader is about to win
    if (botFarBehind || leaderCloseToWin) {
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
      // Only nuke if net damage is positive (hits opponents more than self)
      if (bestNukeScore >= 1) {
        // Low base score — this is a hail mary, not a normal build option
        let score = 5 + bestNukeScore * 8;
        // The more desperate, the more appealing
        if (leaderCloseToWin) score += 20;
        if (vpBehind >= 5) score += 15;
        options.push({
          name: "sheepNuke",
          score,
          execute: () => ({ type: "sheep-nuke", playerIndex: botIndex }),
        });
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
 *
 * Counter-offers vary based on:
 * - What the proposer originally wanted (try to give them something they asked for)
 * - What the bot actually needs and has surplus of
 * - Offer more when bot has large surplus to make counters attractive
 * - Some randomness to avoid being predictable
 */
export function generateBotCounterOffer(
  state: GameState,
  botIndex: number
): { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null {
  const trade = state.pendingTrades.find((t) => t.fromPlayer !== botIndex && (t.toPlayer === null || t.toPlayer === botIndex));
  if (!trade) return null;

  // Check counter-offer memory: return cached result if same trade was already countered this turn
  // BUT also verify the bot can still afford the counter (resources may have changed after a trade executed)
  const coTradeHash = getTradeHash(trade.offering, trade.requesting);
  const coMemKey = `${botIndex}-${coTradeHash}`;
  const coMem = counterOfferMemory.get(coMemKey);
  if (coMem && coMem.turn === state.turnNumber) {
    // Validate the cached counter is still affordable
    if (coMem.result) {
      const bot = state.players[botIndex];
      const canStillAfford = Object.entries(coMem.result.offering).every(
        ([r, amt]) => (amt || 0) <= bot.resources[r as Resource]
      );
      const stillNeeds = Object.entries(coMem.result.requesting).some(
        ([r, amt]) => (amt || 0) > 0 && bot.resources[r as Resource] < 3
      );
      if (!canStillAfford || !stillNeeds) {
        // Resources changed (trade was executed) — clear cache, skip counter
        counterOfferMemory.delete(coMemKey);
        return null;
      }
    }
    return coMem.result;
  }

  // Suppress counters that are identical to the original trade (= just accepting)
  function isIdenticalToOriginal(counter: { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> }): boolean {
    return resourceMapsEqual(counter.offering, trade!.requesting) && resourceMapsEqual(counter.requesting, trade!.offering);
  }

  // Generate the counter-offer (may involve randomness), then cache it.
  // Counter-offers MUST relate to the original trade — they should be modifications
  // of the original deal (adjusted quantities, swapped resources), not random trades.
  function generate(): { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null {
    let counterChance = 0.3;
    try {
      const context = computeStrategicContext(state, botIndex);
      counterChance = context.weights.counterOfferChance;

      // VP gate: don't counter-offer to someone about to win
      const fromVP = state.players[trade!.fromPlayer].victoryPoints;
      if (fromVP >= context.vpToWin - 1) return null;

      if (Math.random() > counterChance) return null;

      const bot = state.players[botIndex];
      const proposer = state.players[trade!.fromPlayer];

      // What the proposer originally asked for (what they want from us)
      const proposerWants = ALL_RESOURCES.filter((r) => (trade!.requesting[r] ?? 0) > 0);
      // What the proposer originally offered (what they'd give us)
      const proposerOffering = ALL_RESOURCES.filter((r) => (trade!.offering[r] ?? 0) > 0);

      // Build a scored list of what the bot can offer and what it wants
      const canOffer: { res: Resource; surplus: number }[] = [];
      const wants: { res: Resource; urgency: number }[] = [];

      for (const r of ALL_RESOURCES) {
        const have = bot.resources[r];
        const goalNeed = context.buildGoal?.missingResources[r] ?? 0;
        const spareAfterGoal = have - goalNeed;

        if (spareAfterGoal >= 2) {
          canOffer.push({ res: r, surplus: spareAfterGoal });
        } else if (spareAfterGoal >= 1 && have >= 3) {
          canOffer.push({ res: r, surplus: 1 });
        }

        if (goalNeed > 0 && have < goalNeed) {
          wants.push({ res: r, urgency: goalNeed - have });
        }
      }

      // Fallback wants: resources with 0 count
      if (wants.length === 0) {
        for (const r of ALL_RESOURCES) {
          if (bot.resources[r] === 0) wants.push({ res: r, urgency: 1 });
        }
      }

      if (canOffer.length === 0 || wants.length === 0) return null;

      // Filter wants to only request resources the proposer likely has.
      // The proposer offered these resources, so they probably have them.
      // Also include resources they have 2+ of (visible in hand count).
      const proposerLikelyHas = new Set<Resource>(proposerOffering);
      for (const r of ALL_RESOURCES) {
        if (proposer.resources[r] >= 2) proposerLikelyHas.add(r);
      }

      // --- Strategy 1: Adjust quantities on the original trade ---
      // The bot gives what the proposer wants, and asks for what the proposer offered,
      // but adjusts the amounts to be more favorable to the bot.
      const canGiveProposerWants = canOffer.filter((c) => proposerWants.includes(c.res));
      const wantFromProposer = wants.filter((w) => proposerOffering.includes(w.res));

      if (canGiveProposerWants.length > 0 && wantFromProposer.length > 0) {
        const give = canGiveProposerWants[Math.floor(Math.random() * canGiveProposerWants.length)];
        const want = wantFromProposer[Math.floor(Math.random() * wantFromProposer.length)];

        // Ask for more or offer less than the original
        const origGiveAmt = trade!.requesting[give.res] ?? 1;
        const origWantAmt = trade!.offering[want.res] ?? 1;

        // Reduce what we give (but at least 1), or increase what we ask for
        let giveAmount = Math.max(1, origGiveAmt - 1);
        let wantAmount = origWantAmt;
        // If we have large surplus, match original give amount (be generous)
        if (give.surplus >= 4) giveAmount = origGiveAmt;
        // Sometimes ask for a bit more
        if (Math.random() < 0.3 && proposer.resources[want.res] >= origWantAmt + 1) {
          wantAmount = origWantAmt + 1;
        }

        const counter = { offering: { [give.res]: giveAmount }, requesting: { [want.res]: wantAmount } };
        if (!isIdenticalToOriginal(counter)) return counter;
        // If identical, fall through to try other strategies
      }

      // --- Strategy 2: Give what they want, but ask for a different resource ---
      // Swap what we're requesting for something else we need, but still give
      // something the proposer wanted.
      if (canGiveProposerWants.length > 0) {
        // Filter wants to resources the proposer likely has
        const feasibleWants = wants.filter((w) => proposerLikelyHas.has(w.res));
        // Prefer resources from the original trade, then feasible alternatives
        const alternativeWants = feasibleWants.filter((w) => !proposerOffering.includes(w.res));
        const wantPool = alternativeWants.length > 0 ? alternativeWants : feasibleWants;

        if (wantPool.length > 0) {
          const give = canGiveProposerWants[Math.floor(Math.random() * canGiveProposerWants.length)];
          const want = wantPool[Math.floor(Math.random() * wantPool.length)];
          if (give.res !== want.res) {
            const counter = { offering: { [give.res]: 1 }, requesting: { [want.res]: 1 } };
            if (!isIdenticalToOriginal(counter)) return counter;
          }
        }
      }

      // --- Strategy 3: Offer a different resource, but give them something related ---
      // We can't give exactly what they want, so offer a substitute resource,
      // but still ask for something from the original trade.
      if (wantFromProposer.length > 0) {
        // Find resources we can offer that are "related" — same category or at least
        // something the proposer might want (they don't have much of it)
        const alternativeOffers = canOffer.filter(
          (c) => !proposerWants.includes(c.res) && proposer.resources[c.res] <= 1
        );
        if (alternativeOffers.length > 0) {
          // Sort by surplus descending to offer the most attractive deal
          alternativeOffers.sort((a, b) => b.surplus - a.surplus);
          const give = alternativeOffers[0];
          const want = wantFromProposer[Math.floor(Math.random() * wantFromProposer.length)];
          if (give.res !== want.res) {
            const counter = { offering: { [give.res]: 1 }, requesting: { [want.res]: 1 } };
            if (!isIdenticalToOriginal(counter)) return counter;
          }
        }
      }

      // --- Strategy 4 (last resort): Offer surplus for a resource the proposer was offering ---
      // Still anchored to the original trade — we ask for something they offered,
      // and give something we have surplus of.
      if (proposerOffering.length > 0) {
        const relevantWants = wants.filter((w) => proposerOffering.includes(w.res));
        const relevantOffers = canOffer.filter((c) => !proposerOffering.includes(c.res));
        if (relevantWants.length > 0 && relevantOffers.length > 0) {
          relevantOffers.sort((a, b) => b.surplus - a.surplus);
          const give = relevantOffers[0];
          const want = relevantWants[Math.floor(Math.random() * relevantWants.length)];
          if (give.res !== want.res) {
            const counter = { offering: { [give.res]: 1 }, requesting: { [want.res]: 1 } };
            if (!isIdenticalToOriginal(counter)) return counter;
          }
        }
      }

      // No viable counter-offer that relates to the original trade — give up
      return null;
    } catch {
      // Fallback: try to make a counter related to the original trade
      if (Math.random() > counterChance) return null;

      const bot = state.players[botIndex];
      const proposerOffering = ALL_RESOURCES.filter((r) => (trade!.offering[r] ?? 0) > 0);
      const proposerWants = ALL_RESOURCES.filter((r) => (trade!.requesting[r] ?? 0) > 0);

      // Offer something the proposer wanted (that we have surplus of)
      const surplusOfWanted = proposerWants.filter((r) => bot.resources[r] > 1);
      // Request something the proposer was offering (that we're short on)
      const wantFromOffered = proposerOffering.filter((r) => bot.resources[r] <= 1);

      if (surplusOfWanted.length > 0 && wantFromOffered.length > 0) {
        const giveRes = surplusOfWanted[Math.floor(Math.random() * surplusOfWanted.length)];
        const wantRes = wantFromOffered[Math.floor(Math.random() * wantFromOffered.length)];
        if (giveRes !== wantRes) {
          const counter = { offering: { [giveRes]: 1 }, requesting: { [wantRes]: 1 } };
          if (!isIdenticalToOriginal(counter)) return counter;
        }
      }

      return null;
    }
  }

  const result = generate();
  counterOfferMemory.set(coMemKey, { turn: state.turnNumber, result });
  return result;
}

// Trade memory — bots remember their decision on identical trades for several turns
const tradeMemory = new Map<string, { tradeHash: string; turn: number; decision: "accept" | "reject" }>();

// Per-bot trade proposal memory — prevents bots from proposing the same trade repeatedly
const proposedTradeMemory = new Map<number, { hash: string; turn: number }>();

// Counter-offer memory — bots give the same counter-offer for the same trade within a turn
const counterOfferMemory = new Map<string, {
  turn: number;
  result: { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null;
}>();

function getTradeHash(offering: Partial<Record<Resource, number>>, requesting: Partial<Record<Resource, number>>): string {
  const o = ALL_RESOURCES.map((r) => offering[r] ?? 0).join(",");
  const r = ALL_RESOURCES.map((res) => requesting[res] ?? 0).join(",");
  return `${o}|${r}`;
}

/**
 * Decide whether a bot should accept or reject a pending trade offer.
 *
 * Uses a scoring system that weighs:
 * - How much the bot needs what it's getting
 * - How much the bot can spare what it's giving
 * - The generosity of the offer (giving 3 cards for 1 is very attractive)
 * - Personality (trader bots accept more freely)
 */
export function decideBotTradeResponse(state: GameState, botIndex: number): "accept" | "reject" {
  const trade = state.pendingTrades.find((t) => t.fromPlayer !== botIndex && (t.toPlayer === null || t.toPlayer === botIndex));
  if (!trade) return "reject";
  if (trade.fromPlayer === botIndex) return "reject";
  if (trade.toPlayer !== null && trade.toPlayer !== botIndex) return "reject";

  const bot = state.players[botIndex];

  // Check if bot can afford to give the requested resources FIRST (before memory)
  for (const [res, amount] of Object.entries(trade.requesting)) {
    if ((amount || 0) > bot.resources[res as Resource]) {
      return "reject";
    }
  }

  // Bots remember their decision on identical trades for several turns
  const memKey = `${botIndex}`;
  const tradeHash = getTradeHash(trade.offering, trade.requesting);
  const mem = tradeMemory.get(memKey);
  if (mem && mem.tradeHash === tradeHash && state.turnNumber - mem.turn < 5) {
    return mem.decision;
  }

  // Compute context for enhanced evaluation
  let context: BotStrategicContext | undefined;
  try {
    context = computeStrategicContext(state, botIndex);
  } catch {
    // Fallback to basic evaluation
  }

  // Hard reject: never trade with someone about to win
  if (context) {
    const fromVP = state.players[trade.fromPlayer].victoryPoints;
    const vpToWin = context.vpToWin;
    if (fromVP >= vpToWin - 1) {
      tradeMemory.set(memKey, { tradeHash, turn: state.turnNumber, decision: "reject" });
      return "reject";
    }
  }

  // --- Score-based evaluation ---
  // Positive score = good trade, negative = bad trade
  let score = 0;

  // Count total cards exchanged
  let totalGiving = 0;
  let totalGaining = 0;
  for (const amount of Object.values(trade.requesting)) totalGiving += (amount || 0);
  for (const amount of Object.values(trade.offering)) totalGaining += (amount || 0);

  // Generosity bonus: if they're offering more cards than requesting, that's attractive
  // e.g., they offer 3 cards for 1 → generosity = 2
  const generosity = totalGaining - totalGiving;
  score += generosity * 2;

  // Evaluate each resource we're gaining
  for (const [res, amount] of Object.entries(trade.offering)) {
    const amt = amount || 0;
    if (amt === 0) continue;
    const r = res as Resource;

    if (context?.buildGoal) {
      const missing = context.buildGoal.missingResources[r] ?? 0;
      if (missing > 0) {
        // We need this for our build goal — very valuable
        score += Math.min(amt, missing) * 3;
        // Extra cards beyond goal need are still nice
        if (amt > missing) score += (amt - missing) * 1;
      } else {
        // Don't need it for build goal, but still a card
        score += amt * 0.5;
      }
    } else {
      // No build goal context: any resource we have 0 of is useful
      if (bot.resources[r] === 0) score += amt * 2;
      else score += amt * 0.5;
    }
  }

  // Evaluate each resource we're giving away
  for (const [res, amount] of Object.entries(trade.requesting)) {
    const amt = amount || 0;
    if (amt === 0) continue;
    const r = res as Resource;

    if (context?.buildGoal) {
      const missing = context.buildGoal.missingResources[r] ?? 0;
      const have = bot.resources[r];

      if (missing > 0 && have - amt < missing) {
        // Giving away something we need for our goal and won't have enough — painful
        score -= amt * 3;
      } else if (have - amt >= 2) {
        // We'll still have plenty left — barely hurts
        score -= amt * 0.3;
      } else if (have - amt >= 1) {
        // We'll have 1 left — moderate cost
        score -= amt * 1;
      } else {
        // Giving away our last one
        score -= amt * 1.5;
      }
    } else {
      // No context: penalize based on how many we'll have left
      const have = bot.resources[r];
      if (have - amt <= 0) score -= amt * 2;
      else if (have - amt === 1) score -= amt * 1;
      else score -= amt * 0.5;
    }
  }

  // VP penalty: slight reluctance to trade with leaders (but not a hard block)
  if (context) {
    const fromVP = state.players[trade.fromPlayer].victoryPoints;
    const botVP = context.ownVP;
    if (fromVP >= botVP + 2) score -= 2;
    else if (fromVP >= botVP + 1) score -= 0.5;
  }

  // Personality adjustment: trader personality has threshold -2 (accepts easier),
  // aggressive has +1 (harder to please)
  const threshold = context?.weights.tradeAcceptThreshold ?? 0;
  const decision = score > threshold ? "accept" : "reject";

  tradeMemory.set(memKey, { tradeHash, turn: state.turnNumber, decision });
  return decision;
}

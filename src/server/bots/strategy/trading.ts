import type { GameState, Resource } from "@/shared/types/game";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";
import type { BotStrategicContext } from "./context";

interface BankTrade {
  giving: Resource;
  givingCount: number;
  receiving: Resource;
}

export interface PlayerTradeOffer {
  offering: Partial<Record<Resource, number>>;
  requesting: Partial<Record<Resource, number>>;
  /** Max the bot is willing to offer for this resource (based on urgency) */
  maxOffer: number;
  /** How many surplus cards the bot has of the offered resource */
  surplusCount: number;
}

/**
 * Decide whether the bot should initiate a player trade.
 * Bots will offer more cards when they have surplus to make trades more attractive.
 */
export function pickPlayerTrade(
  state: GameState,
  playerIndex: number,
  context: BotStrategicContext,
): PlayerTradeOffer | null {
  if (Math.random() >= context.weights.playerTradeChance) return null;

  const player = state.players[playerIndex];

  // Don't trade with anyone within 2 VP of winning in endgame
  if (context.isEndgame) {
    const anyoneClose = context.playerThreats.some((t) => t.visibleVP >= context.vpToWin - 2);
    if (anyoneClose) return null;
  }

  // Determine what we need
  let needed: Resource[] = [];
  if (context.buildGoal) {
    for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
      if ((amount || 0) > 0) needed.push(res as Resource);
    }
  }
  // Also consider generally scarce resources if no build goal needs
  if (needed.length === 0) {
    needed = ALL_RESOURCES.filter((r) => player.resources[r] === 0 && context.productionRates[r] === 0);
  }
  if (needed.length === 0) return null;

  // Only hoard for goal when within 1 resource of completion
  const totalMissing = context.buildGoal
    ? Object.values(context.buildGoal.missingResources).reduce((sum, n) => sum + (n || 0), 0)
    : Infinity;

  // Find surplus: resources we have 2+ of that we don't urgently need
  const surplusList: { res: Resource; count: number }[] = [];
  for (const res of ALL_RESOURCES) {
    if (needed.includes(res)) continue;
    if (player.resources[res] < 2) continue;
    // Only protect resources when very close to completing build goal
    if (totalMissing <= 1) {
      const goalNeed = getGoalNeed(context, res);
      if (goalNeed > 0 && player.resources[res] <= goalNeed + 1) continue;
    }
    surplusList.push({ res, count: player.resources[res] });
  }
  if (surplusList.length === 0) return null;

  // Pick the most surplus resource
  surplusList.sort((a, b) => b.count - a.count);
  const offerRes = surplusList[0].res;
  const offerCount = surplusList[0].count;

  // Pick a needed resource that at least one opponent actually has
  const requestRes = needed.find((r) =>
    state.players.some((p, i) => i !== playerIndex && p.resources[r] > 0)
  );
  if (!requestRes) return null;

  // Determine max willingness to offer based on urgency.
  // Think like a real player: if you need 1 resource to win and have 10 cards
  // of something else, you'd offer all of them. But for a casual need, 1:1 is fine.
  const totalHand = Object.values(player.resources).reduce((s, n) => s + n, 0);
  const botVP = context.ownVP;
  const vpToWin = context.vpToWin;
  const vpAway = vpToWin - botVP;

  let maxOffer = 1;

  // 1 VP from winning — give almost everything to close it out
  if (vpAway <= 1 && totalMissing === 1) {
    maxOffer = offerCount; // dump the whole surplus
  }
  // 2 VP away and only need 1 resource — very aggressive
  else if (vpAway <= 2 && totalMissing === 1) {
    maxOffer = Math.min(offerCount, Math.max(4, Math.floor(offerCount * 0.7)));
  }
  // Close to completing build goal
  else if (totalMissing === 1) {
    maxOffer = Math.min(offerCount, 4);
  }
  else if (totalMissing <= 2) {
    maxOffer = Math.min(offerCount, 3);
  }

  // Racing for a contested spot — willing to pay a lot more
  if (context.spatialUrgency >= 0.8) maxOffer = Math.max(maxOffer, Math.min(offerCount, 4));
  else if (context.spatialUrgency >= 0.6) maxOffer = Math.max(maxOffer, Math.min(offerCount, 3));

  // Resource we can't produce at all — more willing to overpay
  if (context.missingResources.includes(requestRes)) maxOffer = Math.max(maxOffer, Math.min(offerCount, 3));

  // Large hand and resource is plentiful — can afford to be generous
  if (totalHand >= 8 && offerCount >= 4) maxOffer = Math.max(maxOffer, 3);

  // Cap: always keep at least 1 card of the resource we're offering
  maxOffer = Math.min(maxOffer, offerCount - 1);
  if (maxOffer < 1) maxOffer = 1;

  // Always start at 1:1 — escalation happens in botController based on rejections
  return {
    offering: { [offerRes]: 1 },
    requesting: { [requestRes]: 1 },
    maxOffer,
    surplusCount: offerCount,
  };
}

/**
 * Decide whether the bot should make a bank trade.
 * Ranks all possible bank trades and picks the best one by need urgency.
 */
export function pickBankTrade(state: GameState, playerIndex: number, context?: BotStrategicContext): BankTrade | null {
  const player = state.players[playerIndex];

  const needs = getResourceNeeds(state, playerIndex, context);
  if (needs.length === 0) return null;

  // Only protect resources when very close to completing build goal
  const totalMissing = context?.buildGoal
    ? Object.values(context.buildGoal.missingResources).reduce((sum, n) => sum + (n || 0), 0)
    : Infinity;

  // Collect all valid trades and score them
  const candidates: { trade: BankTrade; score: number }[] = [];

  for (let ni = 0; ni < needs.length; ni++) {
    const needed = needs[ni];
    // Score: earlier in needs list = higher priority
    const needScore = needs.length - ni;

    for (const giving of ALL_RESOURCES) {
      if (giving === needed) continue;

      const ratio = getTradeRatio(state, playerIndex, giving);
      if (player.resources[giving] < ratio) continue;

      // Don't trade away resources we also need (unless large surplus)
      const giveNeed = needs.find((n) => n === giving);
      if (giveNeed && player.resources[giving] <= ratio + 1) continue;

      // Goal-oriented protection: only when within 1 resource of completing
      if (context?.buildGoal && totalMissing <= 1) {
        const goalNeed = getGoalNeed(context, giving);
        if (goalNeed > 0 && player.resources[giving] <= ratio + goalNeed) continue;
      }

      // Score: prefer better ratios and higher need priority
      // Lower ratio = more efficient = better
      const ratioBonus = (5 - ratio); // 4:1=1, 3:1=2, 2:1=3
      const surplusBonus = Math.min(player.resources[giving] - ratio, 3); // extra cards after trade
      const score = needScore * 3 + ratioBonus * 2 + surplusBonus;

      const givingCount = ratio;
      candidates.push({ trade: { giving, givingCount, receiving: needed }, score });

      // Also consider double trade if large surplus
      if (player.resources[giving] >= ratio * 2 && !giveNeed) {
        candidates.push({
          trade: { giving, givingCount: ratio * 2, receiving: needed },
          score: score + 1, // slight bonus for getting more
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick the best trade
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].trade;
}

/**
 * Get the trade ratio for a resource based on port access.
 */
function getTradeRatio(state: GameState, playerIndex: number, resource: Resource): number {
  const player = state.players[playerIndex];
  if (player.portsAccess.includes(resource)) return 2;
  if (player.portsAccess.includes("any")) return 3;
  return 4;
}

/**
 * Determine what resources the bot needs most.
 */
function getResourceNeeds(state: GameState, playerIndex: number, context?: BotStrategicContext): Resource[] {
  const player = state.players[playerIndex];
  const needs: Resource[] = [];

  // Prioritize build goal resources
  if (context?.buildGoal) {
    for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
      if ((amount || 0) > 0 && !needs.includes(res as Resource)) {
        needs.push(res as Resource);
      }
    }
    if (needs.length > 0) return needs;
  }

  const goals = getBuildGoals(state, playerIndex, context);

  for (const goal of goals) {
    const cost = BUILDING_COSTS[goal as keyof typeof BUILDING_COSTS];
    if (!cost) continue;

    for (const [res, amount] of Object.entries(cost)) {
      const have = player.resources[res as Resource];
      if (have < (amount || 0)) {
        if (!needs.includes(res as Resource)) {
          needs.push(res as Resource);
        }
      }
    }
  }

  return needs;
}

/**
 * Determine what the bot should try to build, in priority order.
 */
function getBuildGoals(state: GameState, playerIndex: number, context?: BotStrategicContext): string[] {
  const player = state.players[playerIndex];
  const goals: string[] = [];

  if (context) {
    // Use strategy to prioritize
    if (context.strategy === "cities") {
      if (player.settlements.length > 0) goals.push("city");
      if (state.developmentCardDeck.length > 0) goals.push("developmentCard");
      if (player.settlements.length < 5) goals.push("settlement");
      if (player.roads.length < 15) goals.push("road");
    } else if (context.strategy === "development") {
      if (state.developmentCardDeck.length > 0) goals.push("developmentCard");
      if (player.settlements.length > 0) goals.push("city");
      if (player.settlements.length < 5) goals.push("settlement");
      if (player.roads.length < 15) goals.push("road");
    } else {
      // expansion
      if (player.settlements.length < 5) goals.push("settlement");
      if (player.roads.length < 15) goals.push("road");
      if (player.settlements.length > 0) goals.push("city");
      if (state.developmentCardDeck.length > 0) goals.push("developmentCard");
    }
  } else {
    if (player.settlements.length > 0 && player.cities.length < 4) goals.push("city");
    if (player.settlements.length < 5) goals.push("settlement");
    if (player.roads.length < 15) goals.push("road");
    if (state.developmentCardDeck.length > 0) goals.push("developmentCard");
  }

  return goals;
}

/**
 * Should bot reject a trade that helps the proposer?
 * Reject if proposer has 2+ more VP than the bot.
 */
export function shouldRejectLeaderTrade(
  state: GameState,
  fromPlayer: number,
  context: BotStrategicContext
): boolean {
  const fromVP = state.players[fromPlayer].victoryPoints;
  const botVP = state.players[context.playerIndex].victoryPoints;
  if (fromVP >= botVP + 2) return true;
  return false;
}

/**
 * How much of a resource does the current build goal need?
 */
function getGoalNeed(context: BotStrategicContext, resource: Resource): number {
  if (!context.buildGoal) return 0;
  return context.buildGoal.missingResources[resource] ?? 0;
}

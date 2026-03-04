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
}

/**
 * Decide whether the bot should initiate a player trade.
 * Uses build goal to determine what to request and what surplus to offer.
 */
export function pickPlayerTrade(
  state: GameState,
  playerIndex: number,
  context: BotStrategicContext,
): PlayerTradeOffer | null {
  // Check personality trade chance
  if (Math.random() >= context.weights.playerTradeChance) return null;

  // Don't trade if no build goal
  if (!context.buildGoal) return null;

  const player = state.players[playerIndex];

  // Find what we need from our build goal
  const needed: Resource[] = [];
  for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
    if ((amount || 0) > 0) needed.push(res as Resource);
  }
  if (needed.length === 0) return null;

  // Find what we have surplus of (more than our goal needs + 1 buffer)
  const surplus: Resource[] = [];
  for (const res of ALL_RESOURCES) {
    if (needed.includes(res)) continue;
    const goalNeed = getGoalNeed(context, res);
    if (player.resources[res] > goalNeed + 1) {
      surplus.push(res);
    }
  }
  if (surplus.length === 0) return null;

  // Don't trade with anyone within 2 VP of winning
  if (context.isEndgame) {
    const anyoneClose = context.playerThreats.some((t) => t.visibleVP >= context.vpToWin - 2);
    if (anyoneClose) return null;
  }

  // Pick the most needed resource and the most surplus resource
  const requestRes = needed[0];
  const offerRes = surplus.reduce((best, res) => {
    const bestGoalNeed = getGoalNeed(context, best);
    const resGoalNeed = getGoalNeed(context, res);
    return (player.resources[res] - resGoalNeed) > (player.resources[best] - bestGoalNeed) ? res : best;
  });

  return {
    offering: { [offerRes]: 1 },
    requesting: { [requestRes]: 1 },
  };
}

/**
 * Decide whether the bot should make a bank trade.
 * Goal-oriented: protects resources needed for build goal.
 */
export function pickBankTrade(state: GameState, playerIndex: number, context?: BotStrategicContext): BankTrade | null {
  const player = state.players[playerIndex];

  const needs = getResourceNeeds(state, playerIndex, context);
  if (needs.length === 0) return null;

  const hoarding = context?.weights.resourceHoarding ?? 1.0;

  for (const needed of needs) {
    for (const giving of ALL_RESOURCES) {
      if (giving === needed) continue;

      const ratio = getTradeRatio(state, playerIndex, giving);
      if (player.resources[giving] < ratio) continue;

      // Don't trade away resources we also need (unless large surplus)
      const giveNeed = needs.find((n) => n === giving);
      if (giveNeed && player.resources[giving] <= ratio + 1) continue;

      // Goal-oriented protection: don't trade away goal resources if hoarding
      if (context?.buildGoal && hoarding > 1) {
        const goalNeed = getGoalNeed(context, giving);
        if (goalNeed > 0 && player.resources[giving] <= ratio + goalNeed) continue;
      }

      // Standard 1x trade
      if (player.resources[giving] >= ratio) {
        // Try multi-ratio if large surplus (get 2 of the needed resource)
        if (player.resources[giving] >= ratio * 2 && !giveNeed) {
          return { giving, givingCount: ratio * 2, receiving: needed };
        }
        return { giving, givingCount: ratio, receiving: needed };
      }
    }
  }

  return null;
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
 * Enhanced: strategy-aware prioritization.
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
 * Enhanced: strategy-aware.
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
  const botVP = state.players[context.turnOrderPosition].victoryPoints;
  // Reject if proposer is 2+ VP ahead of us
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

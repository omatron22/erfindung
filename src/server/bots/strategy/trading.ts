import type { GameState, Resource } from "@/shared/types/game";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";
import type { BotStrategicContext } from "./context";

interface BankTrade {
  giving: Resource;
  givingCount: number;
  receiving: Resource;
}

/**
 * Decide whether the bot should make a bank trade.
 * Enhanced: strategy-aware, multi-ratio support.
 */
export function pickBankTrade(state: GameState, playerIndex: number, context?: BotStrategicContext): BankTrade | null {
  const player = state.players[playerIndex];

  const needs = getResourceNeeds(state, playerIndex, context);
  if (needs.length === 0) return null;

  for (const needed of needs) {
    for (const giving of ALL_RESOURCES) {
      if (giving === needed) continue;

      const ratio = getTradeRatio(state, playerIndex, giving);
      if (player.resources[giving] < ratio) continue;

      // Don't trade away resources we also need (unless large surplus)
      const giveNeed = needs.find((n) => n === giving);
      if (giveNeed && player.resources[giving] <= ratio + 1) continue;

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

  const goals = getBuildGoals(state, playerIndex, context);

  for (const goal of goals) {
    const cost = BUILDING_COSTS[goal];
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
 * Should bot reject a trade that helps the VP leader?
 */
export function shouldRejectLeaderTrade(
  state: GameState,
  fromPlayer: number,
  context: BotStrategicContext
): boolean {
  if (context.playerThreats.length === 0) return false;
  const leader = context.playerThreats[0];
  if (leader.playerIndex !== fromPlayer) return false;
  // Reject if leader is within 2 VP of winning
  return leader.visibleVP >= context.vpToWin - 2;
}

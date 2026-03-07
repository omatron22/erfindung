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
  maxOffer: number;
  surplusCount: number;
}

/**
 * Decide whether the bot should initiate a player trade.
 *
 * Plan-aware: trades toward the settlement plan or city plan.
 * Considers port access, production rates, and plan urgency.
 */
export function pickPlayerTrade(
  state: GameState,
  playerIndex: number,
  context: BotStrategicContext,
): PlayerTradeOffer | null {
  if (Math.random() >= context.weights.playerTradeChance) return null;

  const player = state.players[playerIndex];

  // Don't trade with anyone within 2 VP of winning in endgame
  // EXCEPTION: If WE are close to winning, we should still trade to complete our build
  if (context.isEndgame) {
    const vpNeeded = context.vpToWin - context.ownVP;
    const weAreCloseToWinning = vpNeeded <= 2;
    // Use estimatedVP: someone at 7 visible VP with 2 dev cards is likely at ~8 estimated VP
    const anyoneClose = context.playerThreats.some((t) => t.estimatedVP >= context.vpToWin - 2);
    if (anyoneClose && !weAreCloseToWinning) return null;
  }

  // Determine what we need — from plan first, then build goal
  let needed: Resource[] = [];

  // Priority 1: Settlement plan needs
  if (context.settlementPlan && context.settlementPlan.totalMissing > 0) {
    for (const [res, amount] of Object.entries(context.settlementPlan.missingResources)) {
      if ((amount || 0) > 0) needed.push(res as Resource);
    }
  }
  // Priority 2: City plan needs
  if (needed.length === 0 && context.cityPlan && context.cityPlan.totalMissing > 0) {
    for (const [res, amount] of Object.entries(context.cityPlan.missingResources)) {
      if ((amount || 0) > 0) needed.push(res as Resource);
    }
  }
  // Priority 3: Build goal needs
  if (needed.length === 0 && context.buildGoal) {
    for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
      if ((amount || 0) > 0) needed.push(res as Resource);
    }
  }
  // Priority 4: Resources we don't produce at all
  if (needed.length === 0) {
    needed = ALL_RESOURCES.filter((r) => player.resources[r] === 0 && context.productionRates[r] === 0);
  }
  if (needed.length === 0) return null;

  // Compute plan needs for protection
  const planNeeds: Partial<Record<Resource, number>> = {};
  if (context.settlementPlan) {
    for (const [r, amt] of Object.entries(context.settlementPlan.missingResources)) {
      planNeeds[r as Resource] = Math.max(planNeeds[r as Resource] ?? 0, amt as number);
    }
  }
  if (context.cityPlan) {
    for (const [r, amt] of Object.entries(context.cityPlan.missingResources)) {
      planNeeds[r as Resource] = Math.max(planNeeds[r as Resource] ?? 0, amt as number);
    }
  }

  const totalHand = Object.values(player.resources).reduce((s, n) => s + n, 0);

  // Compute spendable surplus per resource
  const surplusList: { res: Resource; spendable: number; count: number; value: number }[] = [];
  for (const res of ALL_RESOURCES) {
    if (needed.includes(res)) continue;
    const have = player.resources[res];
    if (have < 2) continue;

    // Reserve resources needed for plan
    const reserved = planNeeds[res] ?? 0;
    const spendable = Math.max(0, have - Math.max(reserved, 1));
    if (spendable <= 0) continue;

    // Value: how expensive is this resource to us?
    const prodRate = context.productionRates[res];
    const tradeRatio = context.tradeRatios[res];
    let value = 1;
    if (prodRate === 0) value = 3;
    else if (prodRate <= 0.05) value = 2;
    // Resources with good port access are cheaper to give away
    if (tradeRatio <= 2) value = Math.max(1, value - 1);

    surplusList.push({ res, spendable, count: have, value });
  }
  if (surplusList.length === 0) return null;

  // Pick the best resource to offer: cheapest value, most spendable
  surplusList.sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return b.spendable - a.spendable;
  });
  const best = surplusList[0];
  const offerRes = best.res;
  const spendable = best.spendable;

  // Pick a needed resource that at least one opponent has
  const requestRes = needed.find((r) =>
    state.players.some((p, i) => i !== playerIndex && p.resources[r] > 0)
  );
  if (!requestRes) return null;

  // Determine max willingness to offer (scales with urgency)
  const vpAway = context.vpToWin - context.ownVP;
  const totalMissing = context.settlementPlan?.totalMissing ?? context.buildGoal
    ? Object.values(context.buildGoal?.missingResources ?? {}).reduce((sum, n) => sum + (n || 0), 0)
    : Infinity;

  let maxOffer = 1;

  // 1 VP from winning + 1 resource away — give everything
  if (vpAway <= 1 && totalMissing === 1) {
    maxOffer = spendable;
  }
  // 2 VP away, 1 resource short — very aggressive
  else if (vpAway <= 2 && totalMissing === 1) {
    maxOffer = Math.max(4, Math.ceil(spendable * 0.8));
  }
  // Close to completing a build
  else if (totalMissing === 1) {
    maxOffer = Math.min(spendable, 4);
  }
  else if (totalMissing <= 2) {
    maxOffer = Math.min(spendable, 3);
  }

  // Racing opponents for a spot
  if (context.settlementPlan?.contested) {
    maxOffer = Math.max(maxOffer, Math.min(spendable, 4));
  } else if (context.spatialUrgency >= 0.8) {
    maxOffer = Math.max(maxOffer, Math.min(spendable, 4));
  } else if (context.spatialUrgency >= 0.6) {
    maxOffer = Math.max(maxOffer, Math.min(spendable, 3));
  }

  // Can't produce the resource we need — willing to overpay
  if (context.missingResources.includes(requestRes)) maxOffer = Math.max(maxOffer, Math.min(spendable, 3));

  // Robber risk: 7+ cards means we might lose half
  if (totalHand >= 7) {
    const extraCards = totalHand - 6;
    maxOffer = Math.max(maxOffer, Math.min(spendable, 1 + Math.floor(extraCards * 0.5)));
  }

  // Cheap resource (high production + good port) — can afford to be generous
  if (best.value === 1 && spendable >= 3) maxOffer = Math.max(maxOffer, Math.min(spendable, 3));

  // Opponent benefit cap: don't feed the leader
  if (maxOffer > 1) {
    // Use estimatedVP for leader detection — visible VP is misleading
    const maxOpponentVP = Math.max(...context.playerThreats.map((t) => t.estimatedVP));
    const vpLead = maxOpponentVP - context.ownVP;

    if (vpLead >= 3) {
      maxOffer = 1;
    } else if (vpLead >= 2) {
      maxOffer = Math.min(maxOffer, 2);
    }

    const trulyUrgent = (vpAway <= 2 && totalMissing <= 1) || context.spatialUrgency >= 0.7 || context.settlementPlan?.contested;
    if (!trulyUrgent && maxOffer > 2) {
      maxOffer = 2;
    }
  }

  maxOffer = Math.min(maxOffer, spendable);
  if (maxOffer < 1) maxOffer = 1;

  return {
    offering: { [offerRes]: 1 },
    requesting: { [requestRes]: 1 },
    maxOffer,
    surplusCount: spendable,
  };
}

/**
 * Decide whether the bot should make a bank trade.
 * Plan-aware: trades toward plan resources, uses port knowledge.
 */
export function pickBankTrade(state: GameState, playerIndex: number, context?: BotStrategicContext): BankTrade | null {
  const player = state.players[playerIndex];

  const needs = getResourceNeeds(state, playerIndex, context);
  if (needs.length === 0) return null;

  // Compute what resources are protected by the plan
  const planProtected = new Set<Resource>();
  if (context?.settlementPlan) {
    for (const [r, amt] of Object.entries(context.settlementPlan.missingResources)) {
      if ((amt || 0) > 0) planProtected.add(r as Resource);
    }
  }

  const candidates: { trade: BankTrade; score: number }[] = [];

  for (let ni = 0; ni < needs.length; ni++) {
    const needed = needs[ni];
    const needScore = needs.length - ni;

    for (const giving of ALL_RESOURCES) {
      if (giving === needed) continue;

      const ratio = getTradeRatio(state, playerIndex, giving);
      if (player.resources[giving] < ratio) continue;

      // Don't trade away resources we need for the plan
      if (planProtected.has(giving) && player.resources[giving] <= ratio + 1) continue;

      // Don't trade away resources we also need
      const giveNeed = needs.find((n) => n === giving);
      if (giveNeed && player.resources[giving] <= ratio + 1) continue;

      const ratioBonus = (5 - ratio); // 2:1=3, 3:1=2, 4:1=1
      const surplusBonus = Math.min(player.resources[giving] - ratio, 3);
      const score = needScore * 3 + ratioBonus * 2 + surplusBonus;

      candidates.push({ trade: { giving, givingCount: ratio, receiving: needed }, score });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].trade;
}

function getTradeRatio(state: GameState, playerIndex: number, resource: Resource): number {
  const player = state.players[playerIndex];
  if (player.portsAccess.includes(resource)) return 2;
  if (player.portsAccess.includes("any")) return 3;
  return 4;
}

/**
 * Get resources the bot needs most, prioritized by plan.
 */
function getResourceNeeds(state: GameState, playerIndex: number, context?: BotStrategicContext): Resource[] {
  const player = state.players[playerIndex];
  const needs: Resource[] = [];

  // Priority 1: Settlement plan resources
  if (context?.settlementPlan && context.settlementPlan.totalMissing > 0) {
    for (const [res, amount] of Object.entries(context.settlementPlan.missingResources)) {
      if ((amount || 0) > 0 && !needs.includes(res as Resource)) {
        needs.push(res as Resource);
      }
    }
    if (needs.length > 0) return needs;
  }

  // Priority 2: City plan resources
  if (context?.cityPlan && context.cityPlan.totalMissing > 0) {
    for (const [res, amount] of Object.entries(context.cityPlan.missingResources)) {
      if ((amount || 0) > 0 && !needs.includes(res as Resource)) {
        needs.push(res as Resource);
      }
    }
    if (needs.length > 0) return needs;
  }

  // Priority 3: Build goal resources
  if (context?.buildGoal) {
    for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
      if ((amount || 0) > 0 && !needs.includes(res as Resource)) {
        needs.push(res as Resource);
      }
    }
    if (needs.length > 0) return needs;
  }

  // Fallback: general build goals
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

function getBuildGoals(state: GameState, playerIndex: number, context?: BotStrategicContext): string[] {
  const player = state.players[playerIndex];
  const goals: string[] = [];

  if (context) {
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


import type { GameState, Resource, DevelopmentCardType } from "@/shared/types/game";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";
import type { BotStrategicContext } from "./context";

/**
 * Decide if and which development card to play.
 * Returns the action type to play, or null.
 */
export function pickDevCardToPlay(
  state: GameState,
  playerIndex: number,
  context?: BotStrategicContext
): { card: DevelopmentCardType; params?: Record<string, unknown> } | null {
  const player = state.players[playerIndex];
  if (player.hasPlayedDevCardThisTurn) return null;
  if (player.developmentCards.length === 0) return null;

  const cards = player.developmentCards;

  // --- Knight with army awareness ---
  if (cards.includes("knight")) {
    let playProbability = 0.4; // base probability

    if (context) {
      if (context.distanceToLargestArmy === 0) playProbability = 0.5; // maintain lead
      else if (context.distanceToLargestArmy <= 1) playProbability = 1.0;
      else if (context.distanceToLargestArmy <= 2) playProbability = 0.85;
      else if (context.distanceToLargestArmy <= 3) playProbability = 0.65;
    }

    if (Math.random() < playProbability) {
      return { card: "knight" };
    }
  }

  // Play road building if we have roads to place
  if (cards.includes("roadBuilding")) {
    const canBuildRoads = player.roads.length < 14;
    if (canBuildRoads) {
      // Higher priority if close to longest road
      if (context && context.distanceToLongestRoad <= 2) {
        return { card: "roadBuilding" };
      }
      // Still play it with lower priority
      if (!context || context.strategy === "expansion") {
        return { card: "roadBuilding" };
      }
    }
  }

  // Play year of plenty to complete a build
  if (cards.includes("yearOfPlenty")) {
    const needed = getMostNeededResources(state, playerIndex, 2, context);
    if (needed.length > 0) {
      return {
        card: "yearOfPlenty",
        params: {
          resource1: needed[0],
          resource2: needed.length > 1 ? needed[1] : needed[0],
        },
      };
    }
  }

  // Play monopoly if an opponent likely has a lot of something we need
  if (cards.includes("monopoly")) {
    const target = pickMonopolyResource(state, playerIndex);
    if (target) {
      return { card: "monopoly", params: { resource: target } };
    }
  }

  // If we still have an unplayed knight, play it
  if (cards.includes("knight")) {
    return { card: "knight" };
  }

  return null;
}

/**
 * Get the resources we need most, up to `count`.
 * Enhanced: if close to largest army, prioritize dev card resources.
 */
function getMostNeededResources(
  state: GameState,
  playerIndex: number,
  count: number,
  context?: BotStrategicContext
): Resource[] {
  const player = state.players[playerIndex];
  const needed: Resource[] = [];

  // If close to army and need dev card, prioritize those resources
  if (context && context.distanceToLargestArmy <= 2 && context.strategy === "development") {
    const devCost = BUILDING_COSTS.developmentCard;
    for (const [res, amount] of Object.entries(devCost)) {
      if (player.resources[res as Resource] < (amount || 0)) {
        if (!needed.includes(res as Resource)) {
          needed.push(res as Resource);
          if (needed.length >= count) return needed;
        }
      }
    }
  }

  const goals: Array<{ name: string; cost: Partial<Record<Resource, number>> }> = [
    { name: "city", cost: BUILDING_COSTS.city },
    { name: "settlement", cost: BUILDING_COSTS.settlement },
    { name: "developmentCard", cost: BUILDING_COSTS.developmentCard },
    { name: "road", cost: BUILDING_COSTS.road },
  ];

  for (const goal of goals) {
    for (const [res, amount] of Object.entries(goal.cost)) {
      if (player.resources[res as Resource] < (amount || 0)) {
        if (!needed.includes(res as Resource)) {
          needed.push(res as Resource);
          if (needed.length >= count) return needed;
        }
      }
    }
  }

  if (needed.length === 0) {
    needed.push("ore", "grain");
  }

  return needed.slice(0, count);
}

/**
 * Pick the best resource for monopoly.
 */
function pickMonopolyResource(state: GameState, playerIndex: number): Resource | null {
  let bestResource: Resource | null = null;
  let bestEstimate = 2;

  for (const res of ALL_RESOURCES) {
    let totalOpponentCards = 0;
    for (const p of state.players) {
      if (p.index === playerIndex) continue;
      totalOpponentCards += p.resources[res];
    }

    if (totalOpponentCards > bestEstimate) {
      bestEstimate = totalOpponentCards;
      bestResource = res;
    }
  }

  return bestResource;
}

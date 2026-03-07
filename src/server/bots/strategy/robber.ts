import type { GameState, Resource } from "@/shared/types/game";
import type { HexKey } from "@/shared/types/coordinates";
import {
  hexVertices,
  parseHexKey,
  hexKey,
} from "@/shared/utils/hexMath";
import { NUMBER_DOTS, TERRAIN_RESOURCE, ALL_RESOURCES, BUILDING_COSTS } from "@/shared/constants";
import type { BotStrategicContext } from "./context";

/**
 * Pick the best hex to place the robber.
 * Uses strategic weights for aggression and self-protection.
 * Endgame: always targets the leader, ignores self-damage.
 */
export function pickRobberHex(state: GameState, playerIndex: number, context?: BotStrategicContext): HexKey {
  let bestHex: HexKey | null = null;
  let bestScore = -Infinity;

  const robberAggression = context?.weights.robberAggression ?? 1.0;
  const robberSelfProtect = context?.weights.robberSelfProtect ?? 1.0;

  // Build a threat lookup for fast access
  const threatByPlayer: Record<number, number> = {};
  if (context) {
    for (const t of context.playerThreats) {
      threatByPlayer[t.playerIndex] = t.threatScore;
    }
  }

  // In endgame, find the leader to target specifically
  const leader = context?.isEndgame && context.playerThreats.length > 0
    ? context.playerThreats[0] : null;

  // Pre-compute friendly robber exclusion: skip hexes where all buildings belong to players with ≤2 VP
  const friendlyRobber = !!state.config?.friendlyRobber;

  for (const [hk, hex] of Object.entries(state.board.hexes)) {
    if (hk === state.board.robberHex) continue;
    if (hex.terrain === "desert") continue;

    // Friendly robber: skip hexes that only affect low-VP players
    if (friendlyRobber) {
      const verts = hexVertices(hex.coord);
      const allLowVP = verts.every((vk) => {
        const b = state.board.vertices[vk];
        if (!b || b.playerIndex === playerIndex) return true;
        return state.players[b.playerIndex].victoryPoints <= 2;
      });
      if (allLowVP) continue;
    }

    const dots = hex.number ? (NUMBER_DOTS[hex.number] || 0) : 0;
    let score = 0;

    const vertices = hexVertices(hex.coord);
    let affectsOpponent = false;
    let affectsSelf = false;

    for (const vk of vertices) {
      const building = state.board.vertices[vk];
      if (!building) continue;

      if (building.playerIndex === playerIndex) {
        affectsSelf = true;
      } else {
        affectsOpponent = true;
        const buildingMult = building.type === "city" ? 2 : 1;

        if (context) {
          const threat = threatByPlayer[building.playerIndex] ?? 0;
          score += threat * dots * buildingMult * 0.5 * robberAggression;

          // Endgame: extra bonus for targeting the leader
          if (leader && building.playerIndex === leader.playerIndex) {
            score += dots * buildingMult * 2;
          }

          // Opponent modeling: prefer hexes producing resources the opponent NEEDS
          const resource = TERRAIN_RESOURCE[hex.terrain];
          if (resource) {
            const opponent = state.players[building.playerIndex];

            // Block resources opponents are hoarding (likely saving for a build)
            if (opponent.resources[resource] >= 3) {
              score += opponent.resources[resource] * 0.5;
            }

            // Theory: "Block ore and wheat to prevent cities/dev cards"
            // Ore+grain are the most impactful resources to block
            if (resource === "ore") score += dots * buildingMult * 0.8;
            else if (resource === "grain") score += dots * buildingMult * 0.6;

            // Infer what opponent is likely building and block those resources
            const oppBuildNeeds = inferOpponentNeeds(state, building.playerIndex);
            if (oppBuildNeeds.has(resource)) {
              score += dots * buildingMult * 1.5; // big bonus for blocking a key resource
            }
          }
        } else {
          const opponent = state.players[building.playerIndex];
          score += opponent.victoryPoints * 2;
          if (building.type === "city") score += 3;
          else score += 1;
          score += dots;
        }
      }
    }

    if (!affectsOpponent) continue;

    if (affectsSelf) {
      // Endgame: ignore self-damage
      if (context?.isEndgame) {
        score -= 3; // minimal penalty
      } else {
        score -= 15 * robberSelfProtect;
      }
    }

    if (!context) score += dots;

    if (score > bestScore) {
      bestScore = score;
      bestHex = hk;
    }
  }

  // Fallback
  if (!bestHex) {
    for (const hk of Object.keys(state.board.hexes)) {
      if (hk !== state.board.robberHex) {
        bestHex = hk;
        break;
      }
    }
  }

  return bestHex!;
}

/**
 * Pick which player to steal from at the robber hex.
 * Aggressive/endgame personalities always steal from the leader.
 */
export function pickStealTarget(state: GameState, playerIndex: number, context?: BotStrategicContext): number | null {
  const hexCoord = parseHexKey(state.board.robberHex);
  const vertices = hexVertices(hexCoord);
  const candidates: { player: number; score: number }[] = [];

  // Determine what resources the bot needs — plan-aware priority
  const neededResources = new Set<Resource>();
  if (context?.settlementPlan) {
    for (const [res, amount] of Object.entries(context.settlementPlan.missingResources)) {
      if ((amount || 0) > 0) neededResources.add(res as Resource);
    }
  }
  if (context?.cityPlan) {
    for (const [res, amount] of Object.entries(context.cityPlan.missingResources)) {
      if ((amount || 0) > 0) neededResources.add(res as Resource);
    }
  }
  if (context?.buildGoal) {
    for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
      if ((amount || 0) > 0) neededResources.add(res as Resource);
    }
  }

  // Figure out what resource the robber hex produces (for need-based evaluation)
  const robberHex = state.board.hexes[state.board.robberHex];
  const robberHexResource = robberHex ? TERRAIN_RESOURCE[robberHex.terrain] : null;

  for (const vk of vertices) {
    const building = state.board.vertices[vk];
    if (!building || building.playerIndex === playerIndex) continue;

    const target = state.players[building.playerIndex];
    const resourceCount = Object.values(target.resources).reduce((s, n) => s + n, 0);
    if (resourceCount === 0) continue;

    const existing = candidates.find((c) => c.player === building.playerIndex);
    if (existing) continue;

    let score: number;
    if (context) {
      const threat = context.playerThreats.find((t) => t.playerIndex === building.playerIndex);
      const threatScore = threat?.threatScore ?? target.victoryPoints;
      const botVP = context.ownVP;
      const vpDiff = target.victoryPoints - botVP;

      // Base: threat still matters but is balanced with card count
      score = threatScore * 2 + resourceCount * 2;

      // Penalize stealing from players with very few cards (low chance of getting
      // something useful). Exception: if they sit on a hex producing what we need.
      if (resourceCount === 1) {
        const targetMightHaveNeeded = robberHexResource && neededResources.has(robberHexResource);
        if (!targetMightHaveNeeded) {
          score -= 8; // heavy penalty — likely wasted steal
        } else {
          score -= 2; // mild penalty — worth the gamble
        }
      } else if (resourceCount === 2) {
        score -= 2; // slight penalty for low card count
      }

      // When VP scores are close (within 1 VP), prefer targets with more cards
      if (Math.abs(vpDiff) <= 1) {
        score += resourceCount * 1.5;
      }

      // Endgame: always prioritize the leader regardless of card count
      if (context.isEndgame || context.weights.robberAggression >= 1.5) {
        if (threat && threat === context.playerThreats[0]) {
          score += 20;
        }
      }
    } else {
      score = target.victoryPoints * 3 + resourceCount;
    }

    candidates.push({ player: building.playerIndex, score });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);

  // Add randomness when top candidates are within 10% of each other
  if (candidates.length >= 2) {
    const topScore = candidates[0].score;
    const threshold = Math.abs(topScore) * 0.1;
    const closeCandidates = candidates.filter((c) => topScore - c.score <= threshold);
    if (closeCandidates.length > 1) {
      const pick = Math.floor(Math.random() * closeCandidates.length);
      return closeCandidates[pick].player;
    }
  }

  return candidates[0].player;
}

/**
 * Pick which resources to discard when a 7 is rolled.
 * Uses build goal to protect goal resources.
 * Protects plan resources when discarding.
 */
export function pickDiscardResources(
  state: GameState,
  playerIndex: number,
  context?: BotStrategicContext
): Partial<Record<Resource, number>> {
  const player = state.players[playerIndex];
  const total = Object.values(player.resources).reduce((s, n) => s + n, 0);
  const discardCount = Math.floor(total / 2);

  // Dynamic resource values: resources we produce easily are cheaper to discard,
  // resources we rarely produce are precious and should be kept.
  const resourceValue: Record<Resource, number> = {
    ore: 3, grain: 3, wool: 2, brick: 2, lumber: 2,
  };

  if (context) {
    // Production-weighted values: resources we produce a lot are expendable
    for (const res of ALL_RESOURCES) {
      if (context.productionRates[res] === 0) {
        resourceValue[res] += 3; // can't replace — very precious
      } else if (context.productionRates[res] <= 0.05) {
        resourceValue[res] += 2; // rare production
      } else if (context.productionRates[res] >= 0.2) {
        resourceValue[res] -= 1; // easy to replace — cheaper to discard
      }
    }

    // Strategy-based adjustments
    if (context.strategy === "expansion") {
      resourceValue.brick += 1;
      resourceValue.lumber += 1;
    } else if (context.strategy === "cities") {
      resourceValue.ore += 2;
      resourceValue.grain += 1;
    } else if (context.strategy === "development") {
      resourceValue.wool += 1;
      resourceValue.ore += 2;
    }

    // Sheep nuke awareness
    if (state.config?.sheepNuke && player.resources.wool >= 8) {
      resourceValue.wool = Math.max(resourceValue.wool, 3);
    }

    // Plan protection: strongly protect resources needed for settlement/city plan
    const hoarding = context.weights.resourceHoarding;
    if (context.settlementPlan) {
      for (const [res, amount] of Object.entries(context.settlementPlan.missingResources)) {
        if ((amount || 0) > 0) {
          resourceValue[res as Resource] += 3 * hoarding;
        }
      }
    }
    if (context.cityPlan) {
      for (const [res, amount] of Object.entries(context.cityPlan.missingResources)) {
        if ((amount || 0) > 0) {
          resourceValue[res as Resource] += 2 * hoarding;
        }
      }
    }
    // Fallback to build goal
    if (context.buildGoal && !context.settlementPlan) {
      for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
        if ((amount || 0) > 0) {
          resourceValue[res as Resource] += 3 * hoarding;
        }
      }
    }
  }

  const cards: { resource: Resource; value: number }[] = [];
  for (const [res, count] of Object.entries(player.resources)) {
    for (let i = 0; i < count; i++) {
      cards.push({ resource: res as Resource, value: resourceValue[res as Resource] });
    }
  }
  cards.sort((a, b) => a.value - b.value);

  const discard: Partial<Record<Resource, number>> = {};
  for (let i = 0; i < discardCount && i < cards.length; i++) {
    const res = cards[i].resource;
    discard[res] = (discard[res] || 0) + 1;
  }

  return discard;
}

/**
 * Infer what an opponent is likely trying to build based on their resources and board state.
 * Returns a set of resources they probably need.
 */
function inferOpponentNeeds(state: GameState, opponentIndex: number): Set<Resource> {
  const opp = state.players[opponentIndex];
  const needs = new Set<Resource>();
  const hand = opp.resources;

  // Check what builds they're closest to and infer missing resources
  const builds: Array<{ cost: Partial<Record<Resource, number>>; priority: number }> = [];

  // City: 3 ore + 2 grain
  if (opp.settlements.length > 0 && opp.cities.length < 4) {
    builds.push({ cost: BUILDING_COSTS.city, priority: 3 });
  }
  // Settlement: brick + lumber + grain + wool
  if (opp.settlements.length + opp.cities.length < 5) {
    builds.push({ cost: BUILDING_COSTS.settlement, priority: 2 });
  }
  // Dev card: ore + grain + wool
  if (state.developmentCardDeck.length > 0) {
    builds.push({ cost: BUILDING_COSTS.developmentCard, priority: 1 });
  }

  for (const build of builds) {
    let totalMissing = 0;
    const missing: Resource[] = [];
    for (const [res, amount] of Object.entries(build.cost)) {
      const need = (amount || 0) - hand[res as Resource];
      if (need > 0) {
        totalMissing += need;
        missing.push(res as Resource);
      }
    }
    // If they're close to completing this build (1-2 resources away), these are key resources
    if (totalMissing <= 2 && totalMissing > 0) {
      for (const r of missing) needs.add(r);
    }
  }

  return needs;
}

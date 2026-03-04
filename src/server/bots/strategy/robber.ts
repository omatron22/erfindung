import type { GameState, Resource } from "@/shared/types/game";
import type { HexKey } from "@/shared/types/coordinates";
import {
  hexVertices,
  parseHexKey,
  hexKey,
} from "@/shared/utils/hexMath";
import { NUMBER_DOTS, TERRAIN_RESOURCE } from "@/shared/constants";
import type { BotStrategicContext } from "./context";

/**
 * Pick the best hex to place the robber.
 * Uses personality weights for aggression and self-protection.
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

          // Opponent modeling: prefer hexes producing resources the opponent has lots of
          const resource = TERRAIN_RESOURCE[hex.terrain];
          if (resource) {
            const opponent = state.players[building.playerIndex];
            if (opponent.resources[resource] >= 3) {
              score += opponent.resources[resource] * 0.5;
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
      score = (threat?.threatScore ?? target.victoryPoints) * 3 + resourceCount;

      // Endgame or aggressive: heavily prioritize the leader
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
  return candidates[0].player;
}

/**
 * Pick which resources to discard when a 7 is rolled.
 * Uses build goal to protect goal resources.
 * Hoarding personality keeps goal resources longer.
 */
export function pickDiscardResources(
  state: GameState,
  playerIndex: number,
  context?: BotStrategicContext
): Partial<Record<Resource, number>> {
  const player = state.players[playerIndex];
  const total = Object.values(player.resources).reduce((s, n) => s + n, 0);
  const discardCount = Math.floor(total / 2);

  // Strategy-aware resource values
  const resourceValue: Record<Resource, number> = {
    ore: 4, grain: 3, wool: 2, brick: 2, lumber: 2,
  };

  if (context) {
    // Boost value of resources matching strategy
    if (context.strategy === "expansion") {
      resourceValue.brick = 4;
      resourceValue.lumber = 4;
    } else if (context.strategy === "cities") {
      resourceValue.ore = 5;
      resourceValue.grain = 4;
    } else if (context.strategy === "development") {
      resourceValue.wool = 4;
      resourceValue.ore = 5;
      resourceValue.grain = 3;
    }

    // Sheep nuke awareness: protect wool stockpile if nuke is enabled and we're accumulating
    if (state.config?.sheepNuke && player.resources.wool >= 6) {
      resourceValue.wool = Math.max(resourceValue.wool, 5);
    }

    // Build goal protection: boost value of resources needed for goal
    if (context.buildGoal) {
      const hoarding = context.weights.resourceHoarding;
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

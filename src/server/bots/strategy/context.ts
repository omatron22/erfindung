import type { GameState, Resource } from "@/shared/types/game";
import type { HexKey } from "@/shared/types/coordinates";
import { hexVertices, hexKey } from "@/shared/utils/hexMath";
import { calculateLongestRoad } from "@/server/engine/longestRoad";
import { NUMBER_DOTS, TERRAIN_RESOURCE, ALL_RESOURCES, MIN_KNIGHTS_FOR_LARGEST_ARMY, MIN_ROADS_FOR_LONGEST_ROAD } from "@/shared/constants";

export type BotStrategy = "expansion" | "cities" | "development";

export interface PlayerThreat {
  playerIndex: number;
  threatScore: number;
  visibleVP: number;
  devCardCount: number;
  roadLength: number;
  knightsPlayed: number;
}

export interface BotStrategicContext {
  /** Expected resources per turn (dots/36 × building multiplier) per resource */
  productionRates: Record<Resource, number>;
  /** Own road length */
  ownRoadLength: number;
  /** Distance to claiming/retaining longest road */
  distanceToLongestRoad: number;
  /** Own knights played */
  ownKnightsPlayed: number;
  /** Distance to claiming/retaining largest army */
  distanceToLargestArmy: number;
  /** Per-opponent threat assessment */
  playerThreats: PlayerThreat[];
  /** Chosen high-level strategy */
  strategy: BotStrategy;
  /** Game progress: max VP / vpToWin */
  gameProgress: number;
  /** VP to win */
  vpToWin: number;
  /** Resources the bot doesn't produce at all */
  missingResources: Resource[];
}

/**
 * Compute the strategic context for a bot player.
 * This is the foundation for all enhanced decision-making.
 */
export function computeStrategicContext(state: GameState, playerIndex: number): BotStrategicContext {
  const player = state.players[playerIndex];
  const vpToWin = state.config?.vpToWin ?? 10;

  // --- Production rates ---
  const productionRates: Record<Resource, number> = { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };

  for (const [hk, hex] of Object.entries(state.board.hexes)) {
    if (!hex.number || hex.hasRobber) continue;
    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (!resource) continue;

    const dots = NUMBER_DOTS[hex.number] || 0;
    const probability = dots / 36;
    const verts = hexVertices(hex.coord);

    for (const vk of verts) {
      const building = state.board.vertices[vk];
      if (!building || building.playerIndex !== playerIndex) continue;
      const multiplier = building.type === "city" ? 2 : 1;
      productionRates[resource] += probability * multiplier;
    }
  }

  // --- Road length ---
  const ownRoadLength = calculateLongestRoad(state, playerIndex);
  const longestRoadHolder = state.longestRoadHolder;
  const longestRoadLength = longestRoadHolder !== null
    ? calculateLongestRoad(state, longestRoadHolder)
    : 0;

  let distanceToLongestRoad: number;
  if (longestRoadHolder === playerIndex) {
    // We have it — distance is 0 but track how far ahead we are
    distanceToLongestRoad = 0;
  } else if (longestRoadHolder !== null) {
    distanceToLongestRoad = longestRoadLength - ownRoadLength + 1;
  } else {
    distanceToLongestRoad = Math.max(0, MIN_ROADS_FOR_LONGEST_ROAD - ownRoadLength);
  }

  // --- Army ---
  const ownKnightsPlayed = player.knightsPlayed;
  const armyHolder = state.largestArmyHolder;
  const armyHolderKnights = armyHolder !== null ? state.players[armyHolder].knightsPlayed : 0;

  let distanceToLargestArmy: number;
  if (armyHolder === playerIndex) {
    distanceToLargestArmy = 0;
  } else if (armyHolder !== null) {
    distanceToLargestArmy = armyHolderKnights - ownKnightsPlayed + 1;
  } else {
    distanceToLargestArmy = Math.max(0, MIN_KNIGHTS_FOR_LARGEST_ARMY - ownKnightsPlayed);
  }

  // --- Threat assessment ---
  const playerThreats: PlayerThreat[] = [];
  for (let i = 0; i < state.players.length; i++) {
    if (i === playerIndex) continue;
    const p = state.players[i];
    const roadLen = calculateLongestRoad(state, i);
    const devCardCount = p.developmentCards.length + p.newDevelopmentCards.length;

    let threatScore = p.victoryPoints + devCardCount * 0.2;

    // Milestone proximity bonuses
    if (longestRoadHolder === null && roadLen >= MIN_ROADS_FOR_LONGEST_ROAD - 1) {
      threatScore += 1.5;
    } else if (longestRoadHolder !== i && roadLen >= longestRoadLength - 1) {
      threatScore += 1.5;
    }
    if (armyHolder === null && p.knightsPlayed >= MIN_KNIGHTS_FOR_LARGEST_ARMY - 1) {
      threatScore += 1.5;
    } else if (armyHolder !== i && p.knightsPlayed >= armyHolderKnights - 1) {
      threatScore += 1.5;
    }

    playerThreats.push({
      playerIndex: i,
      threatScore,
      visibleVP: p.victoryPoints,
      devCardCount,
      roadLength: roadLen,
      knightsPlayed: p.knightsPlayed,
    });
  }

  playerThreats.sort((a, b) => b.threatScore - a.threatScore);

  // --- Strategy selection ---
  const brickLumber = productionRates.brick + productionRates.lumber;
  const oreGrain = productionRates.ore + productionRates.grain;
  const woolOreGrain = productionRates.wool + productionRates.ore + productionRates.grain;

  let strategy: BotStrategy;
  if (oreGrain > brickLumber * 1.3) {
    strategy = "cities";
  } else if (woolOreGrain > brickLumber * 1.2 && distanceToLargestArmy <= 3) {
    strategy = "development";
  } else {
    strategy = "expansion";
  }

  // --- Game progress ---
  const maxVP = Math.max(...state.players.map((p) => p.victoryPoints));
  const gameProgress = maxVP / vpToWin;

  // --- Missing resources ---
  const missingResources = ALL_RESOURCES.filter((r) => productionRates[r] === 0);

  return {
    productionRates,
    ownRoadLength,
    distanceToLongestRoad,
    ownKnightsPlayed,
    distanceToLargestArmy,
    playerThreats,
    strategy,
    gameProgress,
    vpToWin,
    missingResources,
  };
}

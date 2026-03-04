import type { GameState, Resource } from "@/shared/types/game";
import type { HexKey } from "@/shared/types/coordinates";
import type { BotPersonality } from "@/shared/types/config";
import { hexVertices, hexKey } from "@/shared/utils/hexMath";
import { calculateLongestRoad } from "@/server/engine/longestRoad";
import { NUMBER_DOTS, TERRAIN_RESOURCE, ALL_RESOURCES, BUILDING_COSTS, MIN_KNIGHTS_FOR_LARGEST_ARMY, MIN_ROADS_FOR_LONGEST_ROAD } from "@/shared/constants";
import { getWeights, type PersonalityWeights } from "../personality";

export type BotStrategy = "expansion" | "cities" | "development";

export interface PlayerThreat {
  playerIndex: number;
  threatScore: number;
  visibleVP: number;
  devCardCount: number;
  roadLength: number;
  knightsPlayed: number;
}

export interface BuildGoal {
  type: "city" | "settlement" | "road" | "developmentCard";
  missingResources: Partial<Record<Resource, number>>;
  estimatedTurns: number;
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
  /** Bot personality */
  personality: BotPersonality;
  /** Personality weights */
  weights: PersonalityWeights;
  /** Current primary build target */
  buildGoal: BuildGoal | null;
  /** Whether bot is in endgame mode */
  isEndgame: boolean;
  /** Bot's total VP (visible + hidden) */
  ownVP: number;
  /** Turn order position (0-based) */
  turnOrderPosition: number;
  /** Total player count */
  playerCount: number;
}

/**
 * Compute the strategic context for a bot player.
 * This is the foundation for all enhanced decision-making.
 */
export function computeStrategicContext(state: GameState, playerIndex: number): BotStrategicContext {
  const player = state.players[playerIndex];
  const vpToWin = state.config?.vpToWin ?? 10;
  const personality: BotPersonality = state.config?.players[playerIndex]?.personality ?? "balanced";
  const weights = getWeights(personality);

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

  // --- Own VP (visible + hidden) ---
  const ownVP = player.victoryPoints + player.hiddenVictoryPoints;

  // --- Endgame detection ---
  const isEndgame = ownVP >= vpToWin * weights.endgameThreshold;

  // --- Build goal ---
  const buildGoal = computeBuildGoal(state, playerIndex, productionRates, weights);

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
    personality,
    weights,
    buildGoal,
    isEndgame,
    ownVP,
    turnOrderPosition: playerIndex,
    playerCount: state.players.length,
  };
}

/**
 * Compute the best build goal for the bot.
 * Considers what's closest to completion, weighted by personality.
 */
function computeBuildGoal(
  state: GameState,
  playerIndex: number,
  productionRates: Record<Resource, number>,
  weights: PersonalityWeights,
): BuildGoal | null {
  const player = state.players[playerIndex];

  const candidates: Array<BuildGoal & { score: number }> = [];

  const buildTypes: Array<{ type: BuildGoal["type"]; costKey: string; weight: number; canBuild: boolean }> = [
    { type: "city", costKey: "city", weight: weights.cityScore * 1.5, canBuild: player.settlements.length > 0 && player.cities.length < 4 },
    { type: "settlement", costKey: "settlement", weight: weights.settlementScore * 1.5, canBuild: player.settlements.length + player.cities.length < 5 },
    { type: "road", costKey: "road", weight: weights.roadScore, canBuild: player.roads.length < 15 },
    { type: "developmentCard", costKey: "developmentCard", weight: weights.devCardScore, canBuild: state.developmentCardDeck.length > 0 },
  ];

  for (const bt of buildTypes) {
    if (!bt.canBuild) continue;
    const cost = BUILDING_COSTS[bt.costKey as keyof typeof BUILDING_COSTS];
    if (!cost) continue;

    const missing: Partial<Record<Resource, number>> = {};
    let totalMissing = 0;

    for (const [res, amount] of Object.entries(cost)) {
      const need = (amount || 0) - player.resources[res as Resource];
      if (need > 0) {
        missing[res as Resource] = need;
        totalMissing += need;
      }
    }

    // Estimate turns to acquire missing resources from production
    let estimatedTurns = 0;
    if (totalMissing > 0) {
      for (const [res, need] of Object.entries(missing)) {
        const rate = productionRates[res as Resource];
        if (rate > 0) {
          estimatedTurns = Math.max(estimatedTurns, (need as number) / rate);
        } else {
          estimatedTurns = Math.max(estimatedTurns, 20); // high penalty for unproduced resources
        }
      }
    }

    // Score: lower estimated turns + higher weight = better
    const score = bt.weight * (1 / (1 + estimatedTurns));

    candidates.push({ type: bt.type, missingResources: missing, estimatedTurns, score });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return { type: best.type, missingResources: best.missingResources, estimatedTurns: best.estimatedTurns };
}

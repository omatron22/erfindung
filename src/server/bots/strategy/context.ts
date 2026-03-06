import type { GameState, Resource } from "@/shared/types/game";
import type { HexKey, VertexKey } from "@/shared/types/coordinates";
import type { BotPersonality } from "@/shared/types/config";
import {
  hexVertices,
  hexKey,
  adjacentVertices,
  edgeEndpoints,
  edgesAtVertex,
} from "@/shared/utils/hexMath";
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
  /** Total production rate (expected resources/turn) */
  totalProduction: number;
  /** Per-resource production rates */
  productionRates: Record<Resource, number>;
  /** Whether this player produces both ore and grain */
  hasCityResources: boolean;
  /** Whether this player has any port access */
  hasPortAccess: boolean;
}

export interface BuildGoal {
  type: "city" | "settlement" | "road" | "developmentCard";
  missingResources: Partial<Record<Resource, number>>;
  estimatedTurns: number;
}

export interface BotStrategicContext {
  /** Actual player index */
  playerIndex: number;
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
  /** Current primary build target (first of buildGoals) */
  buildGoal: BuildGoal | null;
  /** Ranked list of all viable build goals */
  buildGoals: BuildGoal[];
  /** Whether bot is in endgame mode */
  isEndgame: boolean;
  /** Bot's total VP (visible + hidden) */
  ownVP: number;
  /** Turn order position (0 = picks first in setup draft) */
  turnOrderPosition: number;
  /** Total player count */
  playerCount: number;
  /** How threatened expansion paths are (0-1) */
  spatialUrgency: number;
  /** Opponent within 1 road of overtaking longest road */
  longestRoadThreatened: boolean;
  /** Opponent within 1 knight of overtaking largest army */
  largestArmyThreatened: boolean;
}

/**
 * Compute the strategic context for a bot player.
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

    // --- Production quality: compute opponent's production rates ---
    const opponentProduction: Record<Resource, number> = { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };
    for (const [hk, hex] of Object.entries(state.board.hexes)) {
      if (!hex.number || hex.hasRobber) continue;
      const resource = TERRAIN_RESOURCE[hex.terrain];
      if (!resource) continue;
      const dots = NUMBER_DOTS[hex.number] || 0;
      const probability = dots / 36;
      const verts = hexVertices(hex.coord);
      for (const vk of verts) {
        const building = state.board.vertices[vk];
        if (!building || building.playerIndex !== i) continue;
        const multiplier = building.type === "city" ? 2 : 1;
        opponentProduction[resource] += probability * multiplier;
      }
    }

    const totalProduction = Object.values(opponentProduction).reduce((s, v) => s + v, 0);
    const hasCityResources = opponentProduction.ore > 0 && opponentProduction.grain > 0;
    const hasPortAccess = p.portsAccess.length > 0;

    // Production quality bonus: scale by how much better than average (0.8 res/turn baseline)
    const productionBonus = Math.max(0, (totalProduction - 0.8) * 1.5);
    threatScore += productionBonus;

    // Resource complementarity: ore+grain combo is threatening (city potential)
    if (hasCityResources) {
      // Stronger bonus if both rates are meaningful
      const cityCombo = Math.min(opponentProduction.ore, opponentProduction.grain);
      threatScore += cityCombo * 2;
    }

    // Port access bonus: ports make resource conversion efficient
    if (hasPortAccess) {
      // Specific resource ports are more threatening
      const specificPorts = p.portsAccess.filter((pt) => pt !== "any").length;
      threatScore += specificPorts * 0.5 + (p.portsAccess.includes("any") ? 0.3 : 0);
    }

    playerThreats.push({
      playerIndex: i,
      threatScore,
      visibleVP: p.victoryPoints,
      devCardCount,
      roadLength: roadLen,
      knightsPlayed: p.knightsPlayed,
      totalProduction,
      productionRates: opponentProduction,
      hasCityResources,
      hasPortAccess,
    });
  }

  playerThreats.sort((a, b) => b.threatScore - a.threatScore);

  // --- Longest road / largest army threats ---
  let longestRoadThreatened = false;
  let largestArmyThreatened = false;

  if (longestRoadHolder === playerIndex) {
    longestRoadThreatened = playerThreats.some((t) => t.roadLength >= ownRoadLength - 1);
  }
  if (armyHolder === playerIndex) {
    largestArmyThreatened = playerThreats.some((t) => t.knightsPlayed >= ownKnightsPlayed - 1);
  }

  // --- Spatial urgency ---
  const spatialUrgency = computeSpatialUrgency(state, playerIndex);

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

  // --- Build goals (ranked by proximity, no personality weighting) ---
  const buildGoals = computeBuildGoals(state, playerIndex, productionRates);
  const buildGoal = buildGoals.length > 0 ? buildGoals[0] : null;

  // --- Turn order position (actual draft position, not player index) ---
  const numPlayers = state.players.length;
  const turnOrderPosition = (playerIndex - state.startingPlayerIndex + numPlayers) % numPlayers;

  return {
    playerIndex,
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
    buildGoals,
    isEndgame,
    ownVP,
    turnOrderPosition,
    playerCount: numPlayers,
    spatialUrgency,
    longestRoadThreatened,
    largestArmyThreatened,
  };
}

/**
 * Compute spatial urgency: ratio of expandable vertices threatened by opponents.
 */
function computeSpatialUrgency(state: GameState, playerIndex: number): number {
  const playerRoads = state.players[playerIndex].roads;
  if (playerRoads.length === 0) return 0;

  const expandableSet = new Set<string>();

  for (const road of playerRoads) {
    const [v1, v2] = edgeEndpoints(road);
    for (const v of [v1, v2]) {
      if (state.board.vertices[v] !== null) continue;
      const adj = adjacentVertices(v);
      const tooClose = adj.some((av) => {
        const b = state.board.vertices[av];
        return b !== null && b !== undefined;
      });
      if (tooClose) continue;
      expandableSet.add(v);
    }
  }

  if (expandableSet.size === 0) return 1; // Can't expand = max urgency

  let threatened = 0;
  for (const v of expandableSet) {
    const adj = adjacentVertices(v);
    let isThreatened = false;
    for (const av of adj) {
      const b = state.board.vertices[av];
      if (b && b.playerIndex !== playerIndex) { isThreatened = true; break; }
      // Check 2nd hop
      const adj2 = adjacentVertices(av);
      for (const sv of adj2) {
        if (sv === v) continue;
        const b2 = state.board.vertices[sv];
        if (b2 && b2.playerIndex !== playerIndex) { isThreatened = true; break; }
      }
      if (isThreatened) break;
    }
    if (isThreatened) threatened++;
  }

  return threatened / expandableSet.size;
}

/**
 * Compute ranked build goals by proximity (no personality weighting).
 */
function computeBuildGoals(
  state: GameState,
  playerIndex: number,
  productionRates: Record<Resource, number>,
): BuildGoal[] {
  const player = state.players[playerIndex];
  const candidates: Array<BuildGoal & { score: number }> = [];

  const buildTypes: Array<{ type: BuildGoal["type"]; costKey: string; canBuild: boolean }> = [
    { type: "city", costKey: "city", canBuild: player.settlements.length > 0 && player.cities.length < 4 },
    { type: "settlement", costKey: "settlement", canBuild: player.settlements.length + player.cities.length < 5 },
    { type: "road", costKey: "road", canBuild: player.roads.length < 15 },
    { type: "developmentCard", costKey: "developmentCard", canBuild: state.developmentCardDeck.length > 0 },
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

    let estimatedTurns = 0;
    if (totalMissing > 0) {
      for (const [res, need] of Object.entries(missing)) {
        const rate = productionRates[res as Resource];
        if (rate > 0) {
          estimatedTurns = Math.max(estimatedTurns, (need as number) / rate);
        } else {
          estimatedTurns = Math.max(estimatedTurns, 20);
        }
      }
    }

    const score = 1 / (1 + estimatedTurns);
    candidates.push({ type: bt.type, missingResources: missing, estimatedTurns, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.map((c) => ({ type: c.type, missingResources: c.missingResources, estimatedTurns: c.estimatedTurns }));
}

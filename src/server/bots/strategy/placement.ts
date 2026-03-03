import type { GameState, Resource, Terrain } from "@/shared/types/game";
import type { VertexKey, EdgeKey } from "@/shared/types/coordinates";
import {
  adjacentVertices,
  edgesAtVertex,
  edgeEndpoints,
  hexesAdjacentToVertex,
  hexKey,
  vertexKey,
  hexVertices,
} from "@/shared/utils/hexMath";
import { NUMBER_DOTS, TERRAIN_RESOURCE } from "@/shared/constants";
import type { BotStrategicContext } from "./context";

/**
 * Score a vertex for settlement placement.
 * Higher score = better location.
 * Considers: probability dots, resource diversity, port access.
 */
export function scoreVertex(state: GameState, vertex: VertexKey, playerIndex: number): number {
  // Check if vertex is valid (empty, distance rule)
  if (state.board.vertices[vertex] !== null) return -1;
  const adj = adjacentVertices(vertex);
  for (const av of adj) {
    if (state.board.vertices[av] !== undefined && state.board.vertices[av] !== null) return -1;
  }

  let score = 0;
  const adjacentHexes = hexesAdjacentToVertex(vertex);
  const resourceTypes = new Set<Resource>();
  let totalDots = 0;

  for (const hexCoord of adjacentHexes) {
    const hk = hexKey(hexCoord);
    const hex = state.board.hexes[hk];
    if (!hex) continue;

    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (!resource || !hex.number) continue;

    const dots = NUMBER_DOTS[hex.number] || 0;
    totalDots += dots;
    resourceTypes.add(resource);
  }

  // Base score from probability dots (0-15 range)
  score += totalDots * 2;

  // Resource diversity bonus (0-10 range)
  score += resourceTypes.size * 2;

  // Bonus for having both brick+lumber (road building), or ore+grain (city building)
  if (resourceTypes.has("brick") && resourceTypes.has("lumber")) score += 3;
  if (resourceTypes.has("ore") && resourceTypes.has("grain")) score += 3;

  // Port access bonus
  for (const port of state.board.ports) {
    if (port.edgeVertices.includes(vertex)) {
      if (port.type === "any") {
        score += 2;
      } else {
        // Resource-specific port is valuable if we produce that resource
        if (resourceTypes.has(port.type as Resource)) {
          score += 4;
        } else {
          score += 1;
        }
      }
    }
  }

  // Slight penalty for vertices that are mostly off-board (fewer than 3 hexes)
  const onBoardHexes = adjacentHexes.filter((h) => state.board.hexes[hexKey(h)]).length;
  if (onBoardHexes < 3) score -= 2;
  if (onBoardHexes < 2) score -= 3;

  return score;
}

/**
 * Pick the best vertex for settlement placement during setup.
 * For second settlement, also considers complementing the first settlement's resources.
 */
export function pickSetupVertex(state: GameState, playerIndex: number): VertexKey | null {
  const player = state.players[playerIndex];
  const isSecondSettlement = player.settlements.length === 1;

  let bestVertex: VertexKey | null = null;
  let bestScore = -Infinity;

  for (const vk of Object.keys(state.board.vertices)) {
    let score = scoreVertex(state, vk, playerIndex);
    if (score < 0) continue;

    // For second settlement, prefer resources we don't already produce
    if (isSecondSettlement && player.settlements.length > 0) {
      const firstResources = getResourcesAtVertex(state, player.settlements[0]);
      const thisResources = getResourcesAtVertex(state, vk);
      const newResources = thisResources.filter((r) => !firstResources.includes(r));
      score += newResources.length * 3; // Bonus per new resource type
    }

    if (score > bestScore) {
      bestScore = score;
      bestVertex = vk;
    }
  }

  return bestVertex;
}

/**
 * Pick the best edge for road placement during setup.
 * Road must connect to the given settlement vertex.
 */
export function pickSetupRoad(state: GameState, playerIndex: number, settlementVertex: VertexKey): EdgeKey | null {
  const edges = edgesAtVertex(settlementVertex);
  let bestEdge: EdgeKey | null = null;
  let bestScore = -Infinity;

  for (const ek of edges) {
    if (state.board.edges[ek] !== null) continue;
    if (!(ek in state.board.edges)) continue;

    // Score by what the other end of the road leads to
    const [v1, v2] = edgeEndpoints(ek);
    const otherEnd = v1 === settlementVertex ? v2 : v1;

    // Look at vertices reachable from the other end
    let score = 0;
    const reachable = adjacentVertices(otherEnd);
    for (const rv of reachable) {
      const vs = scoreVertex(state, rv, playerIndex);
      if (vs > 0) score += vs * 0.3; // Discount future potential
    }

    // Prefer roads that point toward the center of the board
    score += 1; // small tiebreaker

    if (score > bestScore) {
      bestScore = score;
      bestEdge = ek;
    }
  }

  return bestEdge;
}

/**
 * Pick the best vertex for building a settlement during main game.
 */
export function pickBuildVertex(state: GameState, playerIndex: number): VertexKey | null {
  const player = state.players[playerIndex];
  let bestVertex: VertexKey | null = null;
  let bestScore = 0; // Must be strictly positive (scoreVertex returns -1 for invalid)

  for (const vk of Object.keys(state.board.vertices)) {
    if (state.board.vertices[vk] !== null) continue;

    // Distance rule check
    const adj = adjacentVertices(vk);
    const tooClose = adj.some(
      (av) => state.board.vertices[av] !== null && state.board.vertices[av] !== undefined
    );
    if (tooClose) continue;

    // Must connect to player's road network
    const connectedEdges = edgesAtVertex(vk);
    const hasRoad = connectedEdges.some(
      (ek) => state.board.edges[ek]?.playerIndex === playerIndex
    );
    if (!hasRoad) continue;

    const score = scoreVertex(state, vk, playerIndex);
    if (score > bestScore) {
      bestScore = score;
      bestVertex = vk;
    }
  }

  return bestVertex;
}

function getResourcesAtVertex(state: GameState, vertex: VertexKey): Resource[] {
  const resources: Resource[] = [];
  const adjacentHexes = hexesAdjacentToVertex(vertex);
  for (const hexCoord of adjacentHexes) {
    const hex = state.board.hexes[hexKey(hexCoord)];
    if (!hex) continue;
    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (resource) resources.push(resource);
  }
  return resources;
}

/**
 * Enhanced vertex scoring that uses the bot's strategic context.
 * Adds expansion potential, strategy weighting, and complementary resource bonuses.
 */
export function scoreVertexEnhanced(
  state: GameState,
  vertex: VertexKey,
  playerIndex: number,
  context: BotStrategicContext
): number {
  const base = scoreVertex(state, vertex, playerIndex);
  if (base < 0) return base;

  let score = base;
  const adjacentHexes = hexesAdjacentToVertex(vertex);
  const resourceTypes = new Set<Resource>();

  for (const hexCoord of adjacentHexes) {
    const hex = state.board.hexes[hexKey(hexCoord)];
    if (!hex) continue;
    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (resource && hex.number) resourceTypes.add(resource);
  }

  // --- Strategy weighting ---
  const strategyResources: Record<string, Resource[]> = {
    expansion: ["brick", "lumber"],
    cities: ["ore", "grain"],
    development: ["wool", "ore", "grain"],
  };
  const preferred = strategyResources[context.strategy] || [];
  for (const res of preferred) {
    if (resourceTypes.has(res)) score += 2;
  }

  // --- Complementary resources: big bonus for resources bot doesn't produce ---
  for (const res of context.missingResources) {
    if (resourceTypes.has(res)) score += 5;
  }

  // --- Port strategic value ---
  for (const port of state.board.ports) {
    if (!port.edgeVertices.includes(vertex)) continue;
    if (port.type !== "any") {
      const portRes = port.type as Resource;
      // High production + matching port = big bonus
      if (context.productionRates[portRes] > 0.15) {
        score += 6;
      }
    }
  }

  // --- Expansion potential (2-edge-deep lookahead) ---
  let expansionBonus = 0;
  const adjVerts = adjacentVertices(vertex);
  for (const av of adjVerts) {
    const avScore = scoreVertex(state, av, playerIndex);
    if (avScore > 0) expansionBonus += avScore * 0.15;
    // Second hop
    const secondHop = adjacentVertices(av);
    for (const sv of secondHop) {
      const svScore = scoreVertex(state, sv, playerIndex);
      if (svScore > 0) expansionBonus += svScore * 0.05;
    }
  }
  score += expansionBonus;

  return score;
}

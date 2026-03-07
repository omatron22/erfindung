import type { GameState } from "@/shared/types/game";
import type { EdgeKey, VertexKey } from "@/shared/types/coordinates";
import {
  edgesAtVertex,
  edgeEndpoints,
  adjacentVertices,
} from "@/shared/utils/hexMath";
import { scoreVertex } from "./placement";
import { calculateLongestRoad } from "@/server/engine/longestRoad";
import type { BotStrategicContext } from "./context";

interface RoadPath {
  path: EdgeKey[];
  targetVertex: VertexKey;
  targetScore: number;
}

/**
 * BFS from road frontier to find the best multi-road path toward a high-value empty vertex.
 */
export function planRoadPath(
  state: GameState,
  playerIndex: number,
  context: BotStrategicContext,
  maxDepth: number = 3,
): RoadPath | null {
  // Find frontier vertices (vertices at the end of our road network with no building)
  const frontierVertices = new Set<VertexKey>();
  for (const road of state.players[playerIndex].roads) {
    const [v1, v2] = edgeEndpoints(road);
    for (const v of [v1, v2]) {
      const building = state.board.vertices[v];
      if (!building || building.playerIndex === playerIndex) {
        frontierVertices.add(v);
      }
    }
  }

  // BFS: queue items are { vertex, path (edges traversed), depth }
  interface QueueItem {
    vertex: VertexKey;
    path: EdgeKey[];
    depth: number;
  }

  let bestPath: RoadPath | null = null;
  let bestScore = -Infinity;
  const visited = new Set<VertexKey>();

  const queue: QueueItem[] = [];
  for (const fv of frontierVertices) {
    queue.push({ vertex: fv, path: [], depth: 0 });
    visited.add(fv);
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxDepth) continue;

    const adjEdges = edgesAtVertex(item.vertex);
    for (const ek of adjEdges) {
      if (state.board.edges[ek] !== null) continue; // already occupied

      const [v1, v2] = edgeEndpoints(ek);
      const otherEnd = v1 === item.vertex ? v2 : v1;

      if (visited.has(otherEnd)) continue;

      // Can't pass through opponent buildings
      const otherBuilding = state.board.vertices[otherEnd];
      if (otherBuilding && otherBuilding.playerIndex !== playerIndex) continue;

      const newPath = [...item.path, ek];
      visited.add(otherEnd);

      // Score this vertex as a potential settlement site
      if (!otherBuilding) {
        // Check distance rule — skip if adjacent vertex already has a building
        const adjVerts = adjacentVertices(otherEnd);
        const tooClose = adjVerts.some(
          (av) => state.board.vertices[av] !== null && state.board.vertices[av] !== undefined
        );
        if (!tooClose) {
          const vs = scoreVertex(state, otherEnd, playerIndex);
          if (vs > 0) {
            // Discount by path length — closer targets are better
            const discountedScore = vs / (1 + newPath.length * 0.3);
            if (discountedScore > bestScore) {
              bestScore = discountedScore;
              bestPath = { path: newPath, targetVertex: otherEnd, targetScore: vs };
            }
          }
        }
      }

      if (item.depth + 1 < maxDepth) {
        queue.push({ vertex: otherEnd, path: newPath, depth: item.depth + 1 });
      }
    }
  }

  return bestPath;
}

/**
 * Pick the best edge for road building during main game.
 * Considers: expansion toward good settlements, longest road progress,
 * multi-road path planning, and opponent blocking.
 */
export function pickBuildRoad(state: GameState, playerIndex: number, context?: BotStrategicContext): EdgeKey | null {
  const currentRoadLength = context?.ownRoadLength ?? calculateLongestRoad(state, playerIndex);
  let bestEdge: EdgeKey | null = null;
  let bestScore = -Infinity;

  // Compute planned road path for multi-road planning
  const roadPlan = context ? planRoadPath(state, playerIndex, context) : null;
  const planEdgeSet = roadPlan ? new Set(roadPlan.path) : new Set<EdgeKey>();

  for (const [ek, road] of Object.entries(state.board.edges)) {
    if (road !== null) continue;

    // Must connect to our network
    if (!isConnectedToNetwork(state, playerIndex, ek)) continue;

    let score = 0;

    // Score by what vertices we can reach from the new road's far end
    const [v1, v2] = edgeEndpoints(ek);

    for (const v of [v1, v2]) {
      const building = state.board.vertices[v];
      if (building && building.playerIndex !== playerIndex) continue;

      if (!building) {
        const settlementScore = scoreVertex(state, v, playerIndex);
        if (settlementScore > 0) score += settlementScore * 0.5;
      }

      const nextVerts = adjacentVertices(v);
      for (const nv of nextVerts) {
        const ns = scoreVertex(state, nv, playerIndex);
        if (ns > 0) score += ns * 0.1;
      }
    }

    // --- Multi-road path planning bonus ---
    if (planEdgeSet.has(ek)) {
      score += (roadPlan!.targetScore * 0.8); // Heavily boost roads on the planned path
    }

    // --- Competitive vertex racing ---
    // In Catan, roads don't block opponents — only settlements do (distance rule).
    // So instead of "blocking", we boost roads that lead us toward high-value vertices
    // that an opponent is also racing toward, so WE can settle there first.
    if (context) {
      for (const v of [v1, v2]) {
        const building = state.board.vertices[v];
        if (building) continue; // already occupied

        // Check if we could legally build a settlement here (distance rule)
        const adjVerts = adjacentVertices(v);
        const tooClose = adjVerts.some(
          (av) => state.board.vertices[av] !== null && state.board.vertices[av] !== undefined
        );
        if (tooClose) continue;

        // Check if an opponent is also heading toward this vertex
        const adjEdges = edgesAtVertex(v);
        let opponentNearby = false;
        for (const ae of adjEdges) {
          if (ae === ek) continue;
          const roadData = state.board.edges[ae];
          if (roadData && roadData.playerIndex !== playerIndex) {
            opponentNearby = true;
            break;
          }
        }

        if (opponentNearby) {
          // Boost: race to settle this spot before they do
          const vs = scoreVertex(state, v, playerIndex);
          if (vs > 5) {
            // Only boost if we can actually connect and build here
            score += vs * 0.4;
          }
        }
      }
    }

    // --- Longest road awareness ---
    const simState = simulateRoad(state, playerIndex, ek);
    const newLength = calculateLongestRoad(simState, playerIndex);
    const lengthGain = newLength - currentRoadLength;

    if (lengthGain > 0) {
      score += lengthGain * 3;

      if (context) {
        // Within 2 of claiming longest road — big bonus
        if (context.distanceToLongestRoad > 0 && context.distanceToLongestRoad <= 2) {
          score += 15;
        }
        // We hold longest road and an opponent is close — defensive priority
        if (context.distanceToLongestRoad === 0) {
          const closestThreat = context.playerThreats.find(
            (t) => t.roadLength >= currentRoadLength - 1
          );
          if (closestThreat) score += 12;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestEdge = ek;
    }
  }

  // Only return a road if it actually scores positive (has some purpose)
  return bestScore > 0 ? bestEdge : null;
}

function simulateRoad(state: GameState, playerIndex: number, edge: EdgeKey): GameState {
  const simPlayers = state.players.map((p, i) =>
    i === playerIndex
      ? { ...p, roads: [...p.roads, edge] }
      : p
  );
  const simEdges = { ...state.board.edges, [edge]: { playerIndex } };
  return {
    ...state,
    players: simPlayers,
    board: { ...state.board, edges: simEdges },
  } as GameState;
}

function isConnectedToNetwork(state: GameState, playerIndex: number, edge: EdgeKey): boolean {
  const [v1, v2] = edgeEndpoints(edge);

  for (const v of [v1, v2]) {
    const building = state.board.vertices[v];
    if (building && building.playerIndex === playerIndex) return true;

    if (building && building.playerIndex !== playerIndex) continue;

    const adjacent = edgesAtVertex(v);
    for (const adjEdge of adjacent) {
      if (adjEdge === edge) continue;
      if (state.board.edges[adjEdge]?.playerIndex === playerIndex) return true;
    }
  }

  return false;
}

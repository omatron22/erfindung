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

/**
 * Pick the best edge for road building during main game.
 * Considers: expansion toward good settlements, longest road progress.
 */
export function pickBuildRoad(state: GameState, playerIndex: number, context?: BotStrategicContext): EdgeKey | null {
  const currentRoadLength = context?.ownRoadLength ?? calculateLongestRoad(state, playerIndex);
  let bestEdge: EdgeKey | null = null;
  let bestScore = -Infinity;

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

    score += 2; // base tiebreaker

    if (score > bestScore) {
      bestScore = score;
      bestEdge = ek;
    }
  }

  return bestEdge;
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

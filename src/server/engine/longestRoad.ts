import type { GameState } from "@/shared/types/game";
import type { EdgeKey, VertexKey } from "@/shared/types/coordinates";
import { edgeEndpoints, adjacentVertices, edgesAtVertex } from "@/shared/utils/hexMath";
import { MIN_ROADS_FOR_LONGEST_ROAD } from "@/shared/constants";

/**
 * Calculate the longest road length for a given player using DFS.
 * Roads are broken by opponent settlements/cities.
 */
export function calculateLongestRoad(state: GameState, playerIndex: number): number {
  const playerRoads = new Set(state.players[playerIndex].roads);
  if (playerRoads.size === 0) return 0;

  // Build adjacency: vertex → list of edges belonging to this player
  const vertexEdges = new Map<VertexKey, EdgeKey[]>();

  for (const roadKey of playerRoads) {
    const [v1, v2] = edgeEndpoints(roadKey);
    if (!vertexEdges.has(v1)) vertexEdges.set(v1, []);
    if (!vertexEdges.has(v2)) vertexEdges.set(v2, []);
    vertexEdges.get(v1)!.push(roadKey);
    vertexEdges.get(v2)!.push(roadKey);
  }

  // A vertex blocks the path if it has an opponent's building
  function isBlocked(vertex: VertexKey): boolean {
    const building = state.board.vertices[vertex];
    return building !== null && building !== undefined && building.playerIndex !== playerIndex;
  }

  let maxLength = 0;

  // DFS from each vertex that has at least one player road
  for (const startVertex of vertexEdges.keys()) {
    const visited = new Set<EdgeKey>();
    dfs(startVertex, visited, 0);
  }

  function dfs(vertex: VertexKey, visited: Set<EdgeKey>, length: number) {
    maxLength = Math.max(maxLength, length);

    const edges = vertexEdges.get(vertex) || [];
    for (const edge of edges) {
      if (visited.has(edge)) continue;

      const [v1, v2] = edgeEndpoints(edge);
      const nextVertex = v1 === vertex ? v2 : v1;

      // Can't pass through opponent buildings
      if (length > 0 && isBlocked(vertex)) continue;

      visited.add(edge);
      dfs(nextVertex, visited, length + 1);
      visited.delete(edge);
    }
  }

  return maxLength;
}

/**
 * Recalculate longest road for all players and update the holder.
 * Returns the player index who holds longest road, or null if no one qualifies.
 */
export function updateLongestRoad(state: GameState): {
  longestRoadHolder: number | null;
  playerLengths: number[];
} {
  const playerLengths = state.players.map((_, i) => calculateLongestRoad(state, i));

  let holder = state.longestRoadHolder;
  const currentHolderLength = holder !== null ? playerLengths[holder] : 0;

  // Find the player with the longest road >= 5
  let maxLength = MIN_ROADS_FOR_LONGEST_ROAD - 1;
  let maxPlayer: number | null = null;
  let tied = false;

  for (let i = 0; i < playerLengths.length; i++) {
    if (playerLengths[i] > maxLength) {
      maxLength = playerLengths[i];
      maxPlayer = i;
      tied = false;
    } else if (playerLengths[i] === maxLength && maxPlayer !== null && i !== maxPlayer) {
      tied = true;
    }
  }

  if (maxPlayer === null) {
    // No one has >= 5
    holder = null;
  } else if (tied) {
    // Tie: current holder keeps it. If no holder, no one gets it.
    if (holder !== null && playerLengths[holder] >= maxLength) {
      // Current holder retains
    } else {
      holder = null;
    }
  } else {
    holder = maxPlayer;
  }

  return { longestRoadHolder: holder, playerLengths };
}

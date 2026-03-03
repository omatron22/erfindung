import { useEffect, useState } from "react";
import type { VertexKey, EdgeKey, HexKey } from "@/shared/types/coordinates";
import {
  adjacentVertices,
  edgesAtVertex,
  edgeEndpoints,
} from "@/shared/utils/hexMath";

interface BoardState {
  vertices: Record<string, { playerIndex: number; type: string } | null>;
  edges: Record<string, { playerIndex: number } | null>;
  hexes: Record<string, unknown>;
  robberHex: HexKey;
}

interface HighlightResult {
  highlightedVertices: Set<VertexKey>;
  highlightedEdges: Set<EdgeKey>;
  highlightedHexes: Set<HexKey>;
}

/**
 * Computes valid placement highlights based on the active action and game state.
 */
export function useHighlights(
  activeAction: string | null,
  board: BoardState | null,
  phase: string | null,
  playerSettlements: VertexKey[],
  myPlayerIndex: number,
): HighlightResult {
  const [result, setResult] = useState<HighlightResult>({
    highlightedVertices: new Set(),
    highlightedEdges: new Set(),
    highlightedHexes: new Set(),
  });

  useEffect(() => {
    if (!board || !activeAction) {
      setResult({
        highlightedVertices: new Set(),
        highlightedEdges: new Set(),
        highlightedHexes: new Set(),
      });
      return;
    }

    if (activeAction === "build-settlement" || activeAction === "setup-settlement") {
      const valid = new Set<VertexKey>();
      for (const [vk, building] of Object.entries(board.vertices)) {
        if (building !== null) continue;
        const adj = adjacentVertices(vk);
        if (adj.some((av) => board.vertices[av] !== null && board.vertices[av] !== undefined)) continue;
        if (phase === "main") {
          const edges = edgesAtVertex(vk);
          if (!edges.some((ek) => board.edges[ek]?.playerIndex === myPlayerIndex)) continue;
        }
        valid.add(vk);
      }
      setResult({ highlightedVertices: valid, highlightedEdges: new Set(), highlightedHexes: new Set() });
    } else if (activeAction === "build-road" || activeAction === "setup-road") {
      const valid = new Set<EdgeKey>();
      for (const [ek, road] of Object.entries(board.edges)) {
        if (road !== null) continue;
        const [v1, v2] = edgeEndpoints(ek);
        let connected = false;
        for (const v of [v1, v2]) {
          const b = board.vertices[v];
          if (b && b.playerIndex === myPlayerIndex) { connected = true; break; }
          if (b && b.playerIndex !== myPlayerIndex) continue;
          const adjEdges = edgesAtVertex(v);
          if (adjEdges.some((ae) => ae !== ek && board.edges[ae]?.playerIndex === myPlayerIndex)) {
            connected = true; break;
          }
        }
        if (connected) valid.add(ek);
      }
      setResult({ highlightedVertices: new Set(), highlightedEdges: valid, highlightedHexes: new Set() });
    } else if (activeAction === "build-city") {
      const valid = new Set<VertexKey>();
      for (const vk of playerSettlements) {
        valid.add(vk);
      }
      setResult({ highlightedVertices: valid, highlightedEdges: new Set(), highlightedHexes: new Set() });
    } else if (activeAction === "move-robber") {
      const valid = new Set<HexKey>();
      for (const key of Object.keys(board.hexes)) {
        if (key !== board.robberHex) valid.add(key);
      }
      setResult({ highlightedVertices: new Set(), highlightedEdges: new Set(), highlightedHexes: valid });
    } else {
      setResult({ highlightedVertices: new Set(), highlightedEdges: new Set(), highlightedHexes: new Set() });
    }
  }, [activeAction, board, phase, myPlayerIndex, playerSettlements]);

  return result;
}

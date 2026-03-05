"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Board } from "@/shared/types/game";
import type { VertexKey, EdgeKey, HexKey } from "@/shared/types/coordinates";
import type { BuildingStyle } from "@/shared/types/config";
import { hexToPixel, edgeEndpoints, vertexToPixel } from "@/shared/utils/hexMath";
import { HEX_RING_COORDS, PLAYER_COLOR_HEX } from "@/shared/constants";
import { STYLE_DEFS } from "@/shared/buildingStyles";
import HexTile from "./HexTile";
import Vertex from "./Vertex";
import Edge from "./Edge";
import Port from "./Port";

export interface PendingPlacement {
  type: "settlement" | "city" | "road";
  key: string; // VertexKey or EdgeKey
}

interface Props {
  board: Board;
  size?: number;
  highlightedVertices?: Set<VertexKey>;
  highlightedEdges?: Set<EdgeKey>;
  highlightedHexes?: Set<HexKey>;
  flashingHexes?: Set<HexKey>;
  flashSeven?: boolean;
  nukeFlashHexes?: Set<HexKey>;
  playerColors?: Record<number, string>;
  buildingStyles?: Record<number, BuildingStyle>;
  pendingPlacement?: PendingPlacement | null;
  myPlayerIndex?: number;
  onVertexClick?: (vertex: VertexKey) => void;
  onEdgeClick?: (edge: EdgeKey) => void;
  onHexClick?: (hex: HexKey) => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;
const ZOOM_SHOW_TIMEOUT = 1500;

export default function HexBoard({
  board,
  size = 50,
  highlightedVertices,
  highlightedEdges,
  highlightedHexes,
  flashingHexes,
  flashSeven,
  nukeFlashHexes,
  playerColors,
  buildingStyles,
  pendingPlacement,
  myPlayerIndex,
  onVertexClick,
  onEdgeClick,
  onHexClick,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showZoomControls, setShowZoomControls] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const dragMoved = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Pinch-to-zoom state
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);
  const isPinching = useRef(false);

  const padding = size * 2.8;
  // Use actual hex coords from board for expansion support
  const boardHexCoords = Object.values(board.hexes).map((h) => h.coord);
  const coords = (boardHexCoords.length > 0 ? boardHexCoords : HEX_RING_COORDS).map((c) => hexToPixel(c, size));
  const minX = Math.min(...coords.map((c) => c.x)) - padding;
  const maxX = Math.max(...coords.map((c) => c.x)) + padding;
  const minY = Math.min(...coords.map((c) => c.y)) - padding;
  const maxY = Math.max(...coords.map((c) => c.y)) + padding;
  const width = maxX - minX;
  const height = maxY - minY;

  function flashZoomControls() {
    setShowZoomControls(true);
    if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
    zoomTimeoutRef.current = setTimeout(() => setShowZoomControls(false), ZOOM_SHOW_TIMEOUT);
  }

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => {
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta));
    });
    flashZoomControls();
  }, []);

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag on primary button (left click)
    if (e.button !== 0) return;
    setIsDragging(true);
    dragMoved.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragMoved.current = true;
    }
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Pinch-to-zoom touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.hypot(dx, dy);
      pinchStartZoom.current = zoom;
      flashZoomControls();
    }
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && isPinching.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / pinchStartDist.current;
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom.current * scale)));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    isPinching.current = false;
  }, []);

  // Prevent browser zoom on the board container (passive: false needed for preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const preventGesture = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", preventGesture, { passive: false });
    el.addEventListener("gesturechange", preventGesture, { passive: false });
    // Also prevent touchmove default during pinch to stop page zoom
    const preventTouchZoom = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    el.addEventListener("touchmove", preventTouchZoom, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", preventGesture);
      el.removeEventListener("gesturechange", preventGesture);
      el.removeEventListener("touchmove", preventTouchZoom);
    };
  }, []);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="w-full h-full origin-center"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: isDragging ? "none" : "transform 0.1s",
        }}
      >
        <svg
          viewBox={`${minX} ${minY} ${width} ${height}`}
          className="w-full h-full"
          style={{ aspectRatio: `${width}/${height}` }}
        >
          {/* Hex tiles */}
          {Object.entries(board.hexes).map(([key, hex]) => (
            <HexTile
              key={key}
              hex={hex}
              size={size}
              highlighted={highlightedHexes?.has(key)}
              flashing={flashingHexes?.has(key)}
              flashSeven={flashSeven}
              nukeFlash={nukeFlashHexes?.has(key)}
              onClick={onHexClick ? () => { if (!dragMoved.current) onHexClick(key); } : undefined}
            />
          ))}

          {/* Ports */}
          {board.ports.map((port, i) => (
            <Port key={i} port={port} size={size} />
          ))}

          {/* Placed roads — rendered as polyline chains per player for seamless joins */}
          {(() => {
            const FALLBACK_COLORS = ["red", "blue", "white", "orange", "green", "purple"] as const;
            // Group edges by player, build adjacency graph
            const adj: Record<number, Record<string, string[]>> = {};
            for (const [key, road] of Object.entries(board.edges)) {
              if (!road) continue;
              const pi = road.playerIndex;
              if (!adj[pi]) adj[pi] = {};
              const [v1, v2] = edgeEndpoints(key);
              if (!adj[pi][v1]) adj[pi][v1] = [];
              if (!adj[pi][v2]) adj[pi][v2] = [];
              adj[pi][v1].push(v2);
              adj[pi][v2].push(v1);
            }

            const elements: React.ReactNode[] = [];

            for (const [piStr, graph] of Object.entries(adj)) {
              const pi = Number(piStr);
              const color = playerColors?.[pi] ?? PLAYER_COLOR_HEX[FALLBACK_COLORS[pi] ?? "red"];
              const visitedEdges = new Set<string>();
              const eid = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

              // Start from endpoints (degree 1) and branch points (degree 3+) first
              const verts = Object.keys(graph);
              const starts = [
                ...verts.filter((v) => graph[v].length === 1 || graph[v].length >= 3),
                ...verts,
              ];

              for (const start of starts) {
                for (const neighbor of graph[start]) {
                  const e = eid(start, neighbor);
                  if (visitedEdges.has(e)) continue;

                  // Trace a chain
                  const chain = [start];
                  let cur = start;
                  let next = neighbor;
                  while (true) {
                    const e2 = eid(cur, next);
                    if (visitedEdges.has(e2)) break;
                    visitedEdges.add(e2);
                    chain.push(next);
                    // Continue if degree-2 (straight through)
                    const unvisited = graph[next].filter((n) => !visitedEdges.has(eid(next, n)));
                    if (unvisited.length === 1) {
                      cur = next;
                      next = unvisited[0];
                    } else {
                      break;
                    }
                  }

                  const pts = chain.map((v) => vertexToPixel(v, size));
                  const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
                  const key = `road-${pi}-${chain[0]}-${chain[chain.length - 1]}`;

                  // Outline
                  elements.push(
                    <polyline
                      key={`${key}-outline`}
                      points={pointsStr}
                      fill="none"
                      stroke="#2c1810"
                      strokeWidth={size * 0.14}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                }
              }

              // Second pass: fills on top
              visitedEdges.clear();
              for (const start of starts) {
                for (const neighbor of graph[start]) {
                  const e = eid(start, neighbor);
                  if (visitedEdges.has(e)) continue;

                  const chain = [start];
                  let cur = start;
                  let next = neighbor;
                  while (true) {
                    const e2 = eid(cur, next);
                    if (visitedEdges.has(e2)) break;
                    visitedEdges.add(e2);
                    chain.push(next);
                    const unvisited = graph[next].filter((n) => !visitedEdges.has(eid(next, n)));
                    if (unvisited.length === 1) {
                      cur = next;
                      next = unvisited[0];
                    } else {
                      break;
                    }
                  }

                  const pts = chain.map((v) => vertexToPixel(v, size));
                  const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
                  const key = `road-${pi}-${chain[0]}-${chain[chain.length - 1]}`;

                  elements.push(
                    <polyline
                      key={`${key}-fill`}
                      points={pointsStr}
                      fill="none"
                      stroke={color}
                      strokeWidth={size * 0.1}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                }
              }
            }

            return elements;
          })()}

          {/* Highlighted edges (potential placements) */}
          {Object.entries(board.edges).map(([key, road]) => {
            if (road || !highlightedEdges?.has(key)) return null;
            const isPending = pendingPlacement && pendingPlacement.key === key && pendingPlacement.type === "road";
            if (isPending) return null; // Rendered as preview instead
            return (
              <Edge
                key={key}
                edgeKey={key}
                road={null}
                size={size}
                highlighted={true}
                onClick={onEdgeClick ? () => { if (!dragMoved.current) onEdgeClick(key); } : undefined}
              />
            );
          })}

          {/* Vertices/Buildings */}
          {Object.entries(board.vertices).map(([key, building]) => {
            const isPending = pendingPlacement && pendingPlacement.key === key && pendingPlacement.type !== "road";
            return (
              <Vertex
                key={key}
                vertexKey={key}
                building={building}
                size={size}
                highlighted={highlightedVertices?.has(key) && !isPending}
                playerColors={playerColors}
                buildingStyles={buildingStyles}
                onClick={onVertexClick ? () => { if (!dragMoved.current) onVertexClick(key); } : undefined}
              />
            );
          })}

          {/* Pending placement preview */}
          {pendingPlacement && myPlayerIndex !== undefined && (() => {
            const FALLBACK_COLORS = ["red", "blue", "white", "orange", "green", "purple"] as const;
            const color = playerColors?.[myPlayerIndex] ?? PLAYER_COLOR_HEX[FALLBACK_COLORS[myPlayerIndex] ?? "red"];
            const style = buildingStyles?.[myPlayerIndex] ?? "classic";
            const def = STYLE_DEFS[style];

            if (pendingPlacement.type === "road") {
              const [v1, v2] = edgeEndpoints(pendingPlacement.key);
              const p1 = vertexToPixel(v1, size);
              const p2 = vertexToPixel(v2, size);
              const mx = (p1.x + p2.x) / 2;
              const my = (p1.y + p2.y) / 2;
              const cr = size * 0.22;
              return (
                <g
                  className="cursor-pointer"
                  onClick={onEdgeClick ? () => { if (!dragMoved.current) onEdgeClick(pendingPlacement.key); } : undefined}
                >
                  {/* Outer glow */}
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke={color} strokeWidth={size * 0.3} strokeLinecap="round"
                    opacity={0.25} style={{ animation: "confirm-glow 1.2s ease-in-out infinite" }} />
                  {/* Road outline */}
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke="#2c1810" strokeWidth={size * 0.16} strokeLinecap="round" />
                  {/* Road fill */}
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke={color} strokeWidth={size * 0.11} strokeLinecap="round" />
                  {/* Checkmark badge */}
                  <circle cx={mx} cy={my} r={cr} fill="#1a7a1a" stroke="#fff" strokeWidth={1.5}
                    style={{ animation: "checkmark-pop 0.3s ease-out forwards" }} />
                  <text x={mx} y={my + 1} textAnchor="middle" dominantBaseline="central"
                    fill="#fff" fontSize={cr * 1.2} fontWeight="bold"
                    style={{ animation: "checkmark-pop 0.3s ease-out forwards", pointerEvents: "none" }}>
                    ✓
                  </text>
                  {/* Hit target */}
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke="transparent" strokeWidth={size * 0.4} strokeLinecap="round" />
                </g>
              );
            } else {
              // Settlement or city preview
              const pos = vertexToPixel(pendingPlacement.key, size);
              const r = size * 0.15;
              const path = def[pendingPlacement.type](pos, r);
              const cr = r * 0.9;
              // Checkmark badge position — offset above the building
              const badgeY = pos.y - r * 2.2;
              return (
                <g
                  className="cursor-pointer"
                  onClick={onVertexClick ? () => { if (!dragMoved.current) onVertexClick(pendingPlacement.key); } : undefined}
                >
                  {/* Pulsing glow ring */}
                  <circle cx={pos.x} cy={pos.y} r={r * 2.8}
                    fill="none" stroke={color} strokeWidth={2}
                    opacity={0.5} style={{ animation: "confirm-glow 1.2s ease-in-out infinite", transformOrigin: `${pos.x}px ${pos.y}px` }} />
                  {/* Solid glow fill */}
                  <circle cx={pos.x} cy={pos.y} r={r * 2.2}
                    fill={color} opacity={0.15} />
                  {/* Building shape — full color with gentle bounce */}
                  <path d={path} fill={color} stroke="#000" strokeWidth={2}
                    style={{ animation: "confirm-bounce 1.2s ease-in-out infinite", transformOrigin: `${pos.x}px ${pos.y}px` }} />
                  {/* Checkmark badge */}
                  <circle cx={pos.x} cy={badgeY} r={cr} fill="#1a7a1a" stroke="#fff" strokeWidth={1.5}
                    style={{ animation: "checkmark-pop 0.3s ease-out forwards" }} />
                  <text x={pos.x} y={badgeY + 1} textAnchor="middle" dominantBaseline="central"
                    fill="#fff" fontSize={cr * 1.3} fontWeight="bold"
                    style={{ animation: "checkmark-pop 0.3s ease-out forwards", pointerEvents: "none" }}>
                    ✓
                  </text>
                  {/* Hit target */}
                  <circle cx={pos.x} cy={pos.y} r={r * 3} fill="transparent" />
                </g>
              );
            }
          })()}
        </svg>
      </div>

      {/* Zoom controls — top right, visible only when zooming */}
      <div
        className={`absolute top-2 right-2 flex gap-1 transition-opacity duration-300 ${
          showZoomControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          onClick={() => { setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP * 2)); flashZoomControls(); }}
          className="w-7 h-7 bg-[#f0e6d0] pixel-btn font-pixel text-[10px] text-gray-700 flex items-center justify-center"
        >
          -
        </button>
        <button
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); flashZoomControls(); }}
          className="px-2 h-7 bg-[#f0e6d0] pixel-btn font-pixel text-[8px] text-gray-600 flex items-center justify-center"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => { setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP * 2)); flashZoomControls(); }}
          className="w-7 h-7 bg-[#f0e6d0] pixel-btn font-pixel text-[10px] text-gray-700 flex items-center justify-center"
        >
          +
        </button>
      </div>
    </div>
  );
}

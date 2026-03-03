import type { Board, HexTile, Port, Terrain, PortType } from "@/shared/types/game";
import type { CubeCoord, VertexKey, EdgeKey } from "@/shared/types/coordinates";
import {
  TERRAIN_COUNTS,
  NUMBER_TOKENS,
  PORT_TYPES,
  HEX_RING_COORDS,
  EXPANSION_TERRAIN_COUNTS,
  EXPANSION_NUMBER_TOKENS,
  EXPANSION_PORT_TYPES,
  EXPANSION_HEX_RING_COORDS,
} from "@/shared/constants";
import {
  hexKey,
  hexVertices,
  hexEdges,
  shuffle,
  canonicalVertexKey,
  CUBE_DIRECTIONS,
  cubeAdd,
} from "@/shared/utils/hexMath";

/**
 * Generate a Catan board with random terrain, numbers, and ports.
 * Standard = 19 hexes, Expansion = 30 hexes.
 * Ensures 6 and 8 are never adjacent (standard rule).
 */
export function generateBoard(expansion: boolean = false): Board {
  const terrainCounts = expansion ? EXPANSION_TERRAIN_COUNTS : TERRAIN_COUNTS;
  const numberTokens = expansion ? EXPANSION_NUMBER_TOKENS : NUMBER_TOKENS;
  const hexCoords = expansion ? EXPANSION_HEX_RING_COORDS : HEX_RING_COORDS;

  const terrains = generateTerrainList(terrainCounts);
  const hexes = placeTerrains(terrains);
  const numbers = placeNumbers(hexes, numberTokens);
  const ports = expansion ? placeExpansionPorts() : placePorts();

  const board: Board = {
    hexes: {},
    vertices: {},
    edges: {},
    ports,
    robberHex: "",
  };

  // Build hex map
  for (let i = 0; i < hexCoords.length; i++) {
    const coord = hexCoords[i];
    const key = hexKey(coord);
    const terrain = hexes[i];
    const isDesert = terrain === "desert";

    board.hexes[key] = {
      coord,
      terrain,
      number: isDesert ? null : numbers.shift()!,
      hasRobber: isDesert,
    };

    if (isDesert && !board.robberHex) {
      board.robberHex = key;
    }
  }

  // Initialize all vertex and edge slots
  for (const coord of hexCoords) {
    for (const vk of hexVertices(coord)) {
      if (!(vk in board.vertices)) {
        board.vertices[vk] = null;
      }
    }
    for (const ek of hexEdges(coord)) {
      if (!(ek in board.edges)) {
        board.edges[ek] = null;
      }
    }
  }

  // Retry if 6/8 adjacency rule is violated
  if (hasAdjacentHighNumbers(board)) {
    return generateBoard(expansion);
  }

  return board;
}

function generateTerrainList(counts: Record<Terrain, number>): Terrain[] {
  const terrains: Terrain[] = [];
  for (const [terrain, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      terrains.push(terrain as Terrain);
    }
  }
  return shuffle(terrains);
}

function placeTerrains(terrains: Terrain[]): Terrain[] {
  return terrains; // already shuffled
}

function placeNumbers(hexes: Terrain[], tokens: number[]): number[] {
  return shuffle([...tokens]);
}

/**
 * Check if any two hexes with 6 or 8 are adjacent.
 */
function hasAdjacentHighNumbers(board: Board): boolean {
  const highNumberHexes: CubeCoord[] = [];

  for (const hex of Object.values(board.hexes)) {
    if (hex.number === 6 || hex.number === 8) {
      highNumberHexes.push(hex.coord);
    }
  }

  for (let i = 0; i < highNumberHexes.length; i++) {
    for (let j = i + 1; j < highNumberHexes.length; j++) {
      const a = highNumberHexes[i];
      const b = highNumberHexes[j];
      const dq = Math.abs(a.q - b.q);
      const dr = Math.abs(a.r - b.r);
      const ds = Math.abs(a.s - b.s);
      if (Math.max(dq, dr, ds) === 1) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Place 9 ports around the board perimeter.
 * Ports sit on outer edges and grant access to the two vertices of that edge.
 */
function placePorts(): Port[] {
  const portTypes = shuffle([...PORT_TYPES]);
  const portPositions = getPortPositions();
  const ports: Port[] = [];

  for (let i = 0; i < portTypes.length; i++) {
    const type = portTypes[i];
    const [v1, v2] = portPositions[i];
    ports.push({
      edgeVertices: [v1, v2],
      type,
      ratio: type === "any" ? 3 : 2,
    });
  }

  return ports;
}

/**
 * Get the 9 port positions around the board edge.
 * Each port is defined by two vertices on the outer rim.
 * Standard Catan port layout with fixed positions around the perimeter.
 */
function getPortPositions(): [VertexKey, VertexKey][] {
  // The outer ring hexes and their outward-facing edges give us port positions.
  // We pick 9 evenly-spaced positions around the rim.
  // These are the outer vertices accessible from the perimeter.

  // Ring 2 hex indices in HEX_RING_COORDS (indices 7-18)
  // Going clockwise: top, then clockwise around
  const outerHexIndices = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

  // Port positions: pairs of vertices on the outside of the board.
  // We use specific hex coords and their outward-facing vertices.
  const positions: [VertexKey, VertexKey][] = [];

  // Define 9 port edge positions going clockwise from top-right
  const portEdges: Array<{ hexIdx: number; v1Dir: "N" | "S"; v2Hex: CubeCoord; v2Dir: "N" | "S" }> = [
    // Top: hex (0,-2,2) N vertex area
    { hexIdx: 7, v1Dir: "N", v2Hex: HEX_RING_COORDS[7], v2Dir: "N" },
    // Top-right
    { hexIdx: 9, v1Dir: "N", v2Hex: HEX_RING_COORDS[9], v2Dir: "N" },
    // Right-upper
    { hexIdx: 10, v1Dir: "N", v2Hex: HEX_RING_COORDS[10], v2Dir: "N" },
    // Right-lower
    { hexIdx: 11, v1Dir: "S", v2Hex: HEX_RING_COORDS[11], v2Dir: "S" },
    // Bottom-right
    { hexIdx: 12, v1Dir: "S", v2Hex: HEX_RING_COORDS[12], v2Dir: "S" },
    // Bottom
    { hexIdx: 14, v1Dir: "S", v2Hex: HEX_RING_COORDS[14], v2Dir: "S" },
    // Bottom-left
    { hexIdx: 15, v1Dir: "S", v2Hex: HEX_RING_COORDS[15], v2Dir: "S" },
    // Left-lower
    { hexIdx: 16, v1Dir: "N", v2Hex: HEX_RING_COORDS[16], v2Dir: "N" },
    // Left-upper
    { hexIdx: 17, v1Dir: "N", v2Hex: HEX_RING_COORDS[17], v2Dir: "N" },
  ];

  // Simpler approach: use the actual outer edge endpoints
  // The outer ring has certain vertices that only touch 1 or 2 board hexes.
  // We'll pick 9 pairs of adjacent outer vertices for ports.

  const outerVertexPairs: [VertexKey, VertexKey][] = [
    // Going clockwise from top. These are vertices on the outer rim.
    [
      canonicalVertexKey({ hex: { q: 2, r: -2, s: 0 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 2, r: -2, s: 0 }, CUBE_DIRECTIONS[0]), direction: "S" }),
    ],
    [
      canonicalVertexKey({ hex: { q: 2, r: 0, s: -2 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 2, r: 0, s: -2 }, CUBE_DIRECTIONS[0]), direction: "S" }),
    ],
    [
      canonicalVertexKey({ hex: { q: 1, r: 1, s: -2 }, direction: "S" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 1, r: 1, s: -2 }, CUBE_DIRECTIONS[2]), direction: "N" }),
    ],
    [
      canonicalVertexKey({ hex: { q: 0, r: 2, s: -2 }, direction: "S" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 0, r: 2, s: -2 }, CUBE_DIRECTIONS[2]), direction: "N" }),
    ],
    [
      canonicalVertexKey({ hex: { q: -2, r: 2, s: 0 }, direction: "S" }),
      canonicalVertexKey({ hex: cubeAdd({ q: -2, r: 2, s: 0 }, CUBE_DIRECTIONS[3]), direction: "N" }),
    ],
    [
      canonicalVertexKey({ hex: { q: -2, r: 0, s: 2 }, direction: "S" }),
      canonicalVertexKey({ hex: cubeAdd({ q: -2, r: 0, s: 2 }, CUBE_DIRECTIONS[3]), direction: "N" }),
    ],
    [
      canonicalVertexKey({ hex: { q: -1, r: -1, s: 2 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: -1, r: -1, s: 2 }, CUBE_DIRECTIONS[5]), direction: "S" }),
    ],
    [
      canonicalVertexKey({ hex: { q: 0, r: -2, s: 2 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 0, r: -2, s: 2 }, CUBE_DIRECTIONS[5]), direction: "S" }),
    ],
    [
      canonicalVertexKey({ hex: { q: 1, r: -2, s: 1 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 1, r: -2, s: 1 }, CUBE_DIRECTIONS[0]), direction: "S" }),
    ],
  ];

  return outerVertexPairs;
}

/**
 * Place 11 ports for the expansion board.
 */
function placeExpansionPorts(): Port[] {
  const portTypes = shuffle([...EXPANSION_PORT_TYPES]);
  const portPositions = getExpansionPortPositions();
  const ports: Port[] = [];

  for (let i = 0; i < Math.min(portTypes.length, portPositions.length); i++) {
    const type = portTypes[i];
    const [v1, v2] = portPositions[i];
    ports.push({
      edgeVertices: [v1, v2],
      type,
      ratio: type === "any" ? 3 : 2,
    });
  }

  return ports;
}

/**
 * Get 11 port positions for the expansion board perimeter (ring 3).
 */
function getExpansionPortPositions(): [VertexKey, VertexKey][] {
  // Ring 3 outer hexes — ports on outward-facing edges
  const outerVertexPairs: [VertexKey, VertexKey][] = [
    // Top
    [
      canonicalVertexKey({ hex: { q: 3, r: -3, s: 0 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 3, r: -3, s: 0 }, CUBE_DIRECTIONS[0]), direction: "S" }),
    ],
    // Top-right
    [
      canonicalVertexKey({ hex: { q: 3, r: -1, s: -2 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 3, r: -1, s: -2 }, CUBE_DIRECTIONS[0]), direction: "S" }),
    ],
    // Right-upper
    [
      canonicalVertexKey({ hex: { q: 2, r: 1, s: -3 }, direction: "S" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 2, r: 1, s: -3 }, CUBE_DIRECTIONS[2]), direction: "N" }),
    ],
    // Right-lower
    [
      canonicalVertexKey({ hex: { q: 1, r: 2, s: -3 }, direction: "S" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 1, r: 2, s: -3 }, CUBE_DIRECTIONS[2]), direction: "N" }),
    ],
    // Bottom-right
    [
      canonicalVertexKey({ hex: { q: -1, r: 3, s: -2 }, direction: "S" }),
      canonicalVertexKey({ hex: cubeAdd({ q: -1, r: 3, s: -2 }, CUBE_DIRECTIONS[3]), direction: "N" }),
    ],
    // Bottom
    [
      canonicalVertexKey({ hex: { q: -2, r: 3, s: -1 }, direction: "S" }),
      canonicalVertexKey({ hex: cubeAdd({ q: -2, r: 3, s: -1 }, CUBE_DIRECTIONS[3]), direction: "N" }),
    ],
    // Bottom-left
    [
      canonicalVertexKey({ hex: { q: -3, r: 3, s: 0 }, direction: "S" }),
      canonicalVertexKey({ hex: cubeAdd({ q: -3, r: 3, s: 0 }, CUBE_DIRECTIONS[3]), direction: "N" }),
    ],
    // Left-lower
    [
      canonicalVertexKey({ hex: { q: -3, r: 2, s: 1 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: -3, r: 2, s: 1 }, CUBE_DIRECTIONS[5]), direction: "S" }),
    ],
    // Left-upper
    [
      canonicalVertexKey({ hex: { q: -3, r: 1, s: 2 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: -3, r: 1, s: 2 }, CUBE_DIRECTIONS[5]), direction: "S" }),
    ],
    // Top-left-lower
    [
      canonicalVertexKey({ hex: { q: -2, r: -1, s: 3 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: -2, r: -1, s: 3 }, CUBE_DIRECTIONS[5]), direction: "S" }),
    ],
    // Top (gap area — uses ring-2 perimeter)
    [
      canonicalVertexKey({ hex: { q: 0, r: -2, s: 2 }, direction: "N" }),
      canonicalVertexKey({ hex: cubeAdd({ q: 0, r: -2, s: 2 }, CUBE_DIRECTIONS[5]), direction: "S" }),
    ],
  ];

  return outerVertexPairs;
}

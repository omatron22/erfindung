import type { CubeCoord, VertexKey, EdgeKey, HexKey } from "./coordinates";
import type { GameConfig } from "./config";

export type Terrain =
  | "hills"
  | "forest"
  | "mountains"
  | "fields"
  | "pasture"
  | "desert";

export type Resource = "brick" | "lumber" | "ore" | "grain" | "wool";

export type PortType = Resource | "any";

export type DevelopmentCardType =
  | "knight"
  | "roadBuilding"
  | "yearOfPlenty"
  | "monopoly"
  | "victoryPoint";

export type BuildingType = "settlement" | "city";

export interface HexTile {
  coord: CubeCoord;
  terrain: Terrain;
  number: number | null; // null for desert
  hasRobber: boolean;
}

export interface Port {
  edgeVertices: [VertexKey, VertexKey]; // the two vertices that access this port
  type: PortType;
  ratio: number; // 2 for resource ports, 3 for generic
}

export interface Building {
  type: BuildingType;
  playerIndex: number;
}

export interface Road {
  playerIndex: number;
}

export interface Board {
  hexes: Record<HexKey, HexTile>;
  vertices: Record<VertexKey, Building | null>;
  edges: Record<EdgeKey, Road | null>;
  ports: Port[];
  robberHex: HexKey;
}

export interface PlayerState {
  index: number;
  name: string;
  color: PlayerColor;
  resources: Record<Resource, number>;
  developmentCards: DevelopmentCardType[];
  newDevelopmentCards: DevelopmentCardType[]; // bought this turn, can't play yet
  knightsPlayed: number;
  hasLargestArmy: boolean;
  hasLongestRoad: boolean;
  longestRoadLength: number;
  settlements: VertexKey[];
  cities: VertexKey[];
  roads: EdgeKey[];
  victoryPoints: number; // visible VPs
  hiddenVictoryPoints: number; // from VP dev cards
  hasPlayedDevCardThisTurn: boolean;
  portsAccess: PortType[]; // which port types this player can use
}

export type PlayerColor =
  | "red"
  | "blue"
  | "white"
  | "orange"
  | "green"
  | "purple"
  | "pink"
  | "teal"
  | "yellow"
  | "brown";

export const PLAYER_COLORS: PlayerColor[] = [
  "red", "blue", "white", "orange", "green", "purple", "pink", "teal", "yellow", "brown",
];

export type GamePhase =
  | "waiting" // in lobby
  | "setup-forward" // placing first settlement+road (player 0→3)
  | "setup-reverse" // placing second settlement+road (player 3→0)
  | "main" // normal gameplay
  | "finished";

export type TurnPhase =
  | "roll" // must roll dice
  | "discard" // 7 rolled, players with >7 must discard
  | "robber-place" // must move robber
  | "robber-steal" // must choose who to steal from
  | "trade-or-build" // main phase: can trade, build, buy dev card, or end turn
  | "road-building-1" // playing road building dev card (1st road)
  | "road-building-2" // playing road building dev card (2nd road)
  | "year-of-plenty" // choosing 2 resources
  | "monopoly" // choosing resource to monopolize
  | "sheep-nuke-pick"; // sheep nuke rolled 7, must pick a number

export interface DiceRoll {
  die1: number;
  die2: number;
  total: number;
}

export interface TradeOffer {
  id: string;
  fromPlayer: number;
  toPlayer: number | null; // null = open offer to all
  offering: Partial<Record<Resource, number>>;
  requesting: Partial<Record<Resource, number>>;
  status: "pending" | "accepted" | "rejected" | "countered" | "cancelled";
}

export interface GameState {
  id: string;
  board: Board;
  players: PlayerState[];
  currentPlayerIndex: number;
  phase: GamePhase;
  turnPhase: TurnPhase;
  turnNumber: number;
  lastDiceRoll: DiceRoll | null;
  developmentCardDeck: DevelopmentCardType[];
  pendingTrade: TradeOffer | null;
  discardingPlayers: number[]; // player indices who still need to discard
  setupPlacementsMade: number; // tracks setup progress
  startingPlayerIndex: number; // randomized first player
  winner: number | null;
  longestRoadHolder: number | null;
  largestArmyHolder: number | null;
  log: GameLogEntry[];
  config?: GameConfig;
  fairDiceBag?: number[];
  freeNukeAvailable?: boolean;
}

export interface GameLogEntry {
  timestamp: number;
  playerIndex: number | null;
  message: string;
  type: "action" | "system" | "chat";
}

import type { Resource, DevelopmentCardType, TradeOffer } from "./game";
import type { VertexKey, EdgeKey, HexKey } from "./coordinates";

// === Setup Actions ===

export interface PlaceSettlementAction {
  type: "place-settlement";
  playerIndex: number;
  vertex: VertexKey;
}

export interface PlaceRoadAction {
  type: "place-road";
  playerIndex: number;
  edge: EdgeKey;
}

// === Main Turn Actions ===

export interface RollDiceAction {
  type: "roll-dice";
  playerIndex: number;
}

export interface BuildSettlementAction {
  type: "build-settlement";
  playerIndex: number;
  vertex: VertexKey;
}

export interface BuildCityAction {
  type: "build-city";
  playerIndex: number;
  vertex: VertexKey;
}

export interface BuildRoadAction {
  type: "build-road";
  playerIndex: number;
  edge: EdgeKey;
}

export interface BuyDevelopmentCardAction {
  type: "buy-development-card";
  playerIndex: number;
}

// === Trading ===

export interface OfferTradeAction {
  type: "offer-trade";
  playerIndex: number;
  offering: Partial<Record<Resource, number>>;
  requesting: Partial<Record<Resource, number>>;
  toPlayer: number | null;
}

export interface AcceptTradeAction {
  type: "accept-trade";
  playerIndex: number;
  tradeId: string;
}

export interface RejectTradeAction {
  type: "reject-trade";
  playerIndex: number;
  tradeId: string;
}

export interface CancelTradeAction {
  type: "cancel-trade";
  playerIndex: number;
  tradeId: string;
}

export interface BankTradeAction {
  type: "bank-trade";
  playerIndex: number;
  giving: Resource;
  givingCount: number; // 2, 3, or 4 depending on ports
  receiving: Resource;
}

// === Robber ===

export interface MoveRobberAction {
  type: "move-robber";
  playerIndex: number;
  hex: HexKey;
}

export interface StealResourceAction {
  type: "steal-resource";
  playerIndex: number;
  targetPlayer: number;
}

export interface DiscardResourcesAction {
  type: "discard-resources";
  playerIndex: number;
  resources: Partial<Record<Resource, number>>;
}

// === Development Cards ===

export interface PlayKnightAction {
  type: "play-knight";
  playerIndex: number;
}

export interface PlayRoadBuildingAction {
  type: "play-road-building";
  playerIndex: number;
}

export interface PlayYearOfPlentyAction {
  type: "play-year-of-plenty";
  playerIndex: number;
  resource1: Resource;
  resource2: Resource;
}

export interface PlayMonopolyAction {
  type: "play-monopoly";
  playerIndex: number;
  resource: Resource;
}

// === Sheep Nuke ===

export interface SheepNukeAction {
  type: "sheep-nuke";
  playerIndex: number;
}

export interface SheepNukePickAction {
  type: "sheep-nuke-pick";
  playerIndex: number;
  number: number; // 2-12, the hex number to destroy
}

// === Turn Management ===

export interface EndTurnAction {
  type: "end-turn";
  playerIndex: number;
}

export type GameAction =
  | PlaceSettlementAction
  | PlaceRoadAction
  | RollDiceAction
  | BuildSettlementAction
  | BuildCityAction
  | BuildRoadAction
  | BuyDevelopmentCardAction
  | OfferTradeAction
  | AcceptTradeAction
  | RejectTradeAction
  | CancelTradeAction
  | BankTradeAction
  | MoveRobberAction
  | StealResourceAction
  | DiscardResourcesAction
  | PlayKnightAction
  | PlayRoadBuildingAction
  | PlayYearOfPlentyAction
  | PlayMonopolyAction
  | SheepNukeAction
  | SheepNukePickAction
  | EndTurnAction;

export type GameEventType =
  | "dice-rolled"
  | "resources-distributed"
  | "settlement-built"
  | "city-built"
  | "road-built"
  | "development-card-bought"
  | "trade-completed"
  | "robber-moved"
  | "resource-stolen"
  | "resources-discarded"
  | "knight-played"
  | "road-building-played"
  | "year-of-plenty-played"
  | "monopoly-played"
  | "longest-road-changed"
  | "largest-army-changed"
  | "game-won"
  | "turn-ended"
  | "doubles-roll-again"
  | "sheep-nuke-rolled"
  | "sheep-nuke-destroyed"
  | "sheep-nuke-doubles";

export interface GameEvent {
  type: GameEventType;
  playerIndex: number | null;
  data?: Record<string, unknown>;
}

export interface ActionResult {
  valid: boolean;
  error?: string;
  newState?: import("./game").GameState;
  events?: GameEvent[];
}

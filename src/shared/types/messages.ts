import type { GameAction, GameEvent } from "./actions";
import type { GameState, PlayerState } from "./game";
import type { GameMode, TurnTimer } from "./config";

export interface LobbyConfig {
  fairDice: boolean;
  friendlyRobber: boolean;
  doublesRollAgain: boolean;
  sheepNuke: boolean;
  gameMode: GameMode;
  vpToWin: number;
  turnTimer: TurnTimer;
  expansionBoard: boolean;
}

// Client → Server messages
export interface ClientMessages {
  "game:action": { action: GameAction };
  "game:counter-offer": { offering: Partial<Record<import("./game").Resource, number>>; requesting: Partial<Record<import("./game").Resource, number>> };
  "room:join": { roomCode: string; playerName: string; reconnectToken?: string };
  "room:leave": {};
  "room:add-bot": { difficulty: "easy" | "medium" | "hard"; personality?: string };
  "room:remove-bot": { playerIndex: number };
  "room:start-game": {};
  "room:update-config": { config: Partial<LobbyConfig> };
  "room:update-player": { color?: string; buildingStyle?: string; name?: string };
  "room:update-bot": { playerIndex: number; name?: string; color?: string; personality?: string };
  "room:leave-game": {};
  "room:request-state": {};
  "chat:message": { text: string };
}

// Server → Client messages
export interface ServerMessages {
  "game:state": { state: ClientGameState };
  "game:events": { events: GameEvent[] };
  "game:error": { message: string };
  "room:joined": { roomCode: string; playerIndex: number; reconnectToken: string };
  "room:player-joined": { playerName: string; playerIndex: number };
  "room:player-left": { playerIndex: number };
  "room:lobby-state": { players: LobbyPlayer[]; config: LobbyConfig; hostIndex: number };
  "room:session-ended": { reason: string };
  "chat:message": { playerIndex: number; playerName: string; text: string; timestamp: number };
}

export interface LobbyPlayer {
  index: number;
  name: string;
  isBot: boolean;
  isReady: boolean;
  color: string;
  buildingStyle?: string;
}

/**
 * The game state as sent to a specific client.
 * Hides other players' development cards and resource counts
 * are shown but not specific cards.
 */
export interface TradeResponseInfo {
  playerIndex: number;
  status: "pending" | "accepted" | "rejected";
  counterOffer: { offering: Partial<Record<import("./game").Resource, number>>; requesting: Partial<Record<import("./game").Resource, number>> } | null;
}

export interface ClientGameState extends Omit<GameState, "players" | "developmentCardDeck"> {
  players: ClientPlayerState[];
  developmentCardDeckCount: number;
  myPlayerIndex: number;
  turnDeadline?: number | null;
  tradeResponses?: Record<string, Record<number, TradeResponseInfo>> | null; // keyed by tradeId, then playerIndex
}

export interface ClientPlayerState extends Omit<PlayerState, "developmentCards" | "newDevelopmentCards"> {
  // Only your own cards are visible
  developmentCards?: PlayerState["developmentCards"];
  newDevelopmentCards?: PlayerState["newDevelopmentCards"];
  resourceCount: number;
  developmentCardCount: number;
}

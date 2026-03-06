import type { Server, Socket } from "socket.io";
import type { GameState, Resource } from "@/shared/types/game";
import type { ClientMessages, ServerMessages, LobbyConfig, TradeResponseInfo } from "@/shared/types/messages";
import type { GameConfig, BuildingStyle, BotPersonality } from "@/shared/types/config";

export interface PlayerSlot {
  index: number;
  name: string;
  isBot: boolean;
  socketId: string | null; // null for bots or disconnected players
  reconnectToken: string | null;
  disconnectedAt: number | null; // timestamp when disconnected
  color: string;
  buildingStyle?: BuildingStyle;
  personality?: BotPersonality;
}

export interface Room {
  code: string;
  hostSocketId: string;
  players: PlayerSlot[];
  gameState: GameState | null;
  gameConfig: GameConfig | null;
  lobbyConfig: LobbyConfig;
  botTimers: NodeJS.Timeout[];
  turnTimer: NodeJS.Timeout | null;
  turnDeadline: number | null; // timestamp
  tradeTimer: NodeJS.Timeout | null;
  tradeResponses: Record<string, Record<number, TradeResponseInfo>> | null; // keyed by tradeId, then playerIndex
  createdAt: number;
}

// Convert message interfaces to socket.io EventsMap (value → handler function)
type ToHandlers<T> = {
  [K in keyof T]: (data: T[K]) => void;
};

type ClientEventHandlers = ToHandlers<ClientMessages>;
type ServerEventHandlers = ToHandlers<ServerMessages>;

export type TypedServer = Server<ClientEventHandlers, ServerEventHandlers>;
export type TypedSocket = Socket<ClientEventHandlers, ServerEventHandlers>;

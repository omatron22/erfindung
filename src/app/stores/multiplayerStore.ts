import { create } from "zustand";
import type { ClientGameState, LobbyPlayer, LobbyConfig } from "@/shared/types/messages";
import type { GameEvent } from "@/shared/types/actions";

interface MultiplayerStore {
  // Connection state
  roomCode: string | null;
  playerIndex: number | null;
  reconnectToken: string | null;
  connected: boolean;

  // Lobby state
  lobbyPlayers: LobbyPlayer[];
  lobbyConfig: LobbyConfig | null;
  hostIndex: number;

  // Game state (server-pushed)
  gameState: ClientGameState | null;
  lastEvents: GameEvent[];
  error: string | null;

  // Chat
  chatMessages: Array<{
    playerIndex: number;
    playerName: string;
    text: string;
    timestamp: number;
  }>;

  // Actions
  setRoomJoined: (roomCode: string, playerIndex: number, reconnectToken: string) => void;
  setLobbyState: (data: { players: LobbyPlayer[]; config: LobbyConfig; hostIndex: number }) => void;
  setGameState: (state: ClientGameState) => void;
  setEvents: (events: GameEvent[]) => void;
  setError: (error: string | null) => void;
  setConnected: (connected: boolean) => void;
  addChatMessage: (msg: { playerIndex: number; playerName: string; text: string; timestamp: number }) => void;
  reset: () => void;
}

export const useMultiplayerStore = create<MultiplayerStore>((set) => ({
  roomCode: null,
  playerIndex: null,
  reconnectToken: null,
  connected: false,
  lobbyPlayers: [],
  lobbyConfig: null,
  hostIndex: 0,
  gameState: null,
  lastEvents: [],
  error: null,
  chatMessages: [],

  setRoomJoined: (roomCode, playerIndex, reconnectToken) => {
    // Store reconnect token in localStorage for persistence
    try {
      localStorage.setItem(`catan-reconnect-${roomCode}`, reconnectToken);
    } catch {}
    set({ roomCode, playerIndex, reconnectToken, error: null });
  },

  setLobbyState: ({ players, config, hostIndex }) =>
    set({ lobbyPlayers: players, lobbyConfig: config, hostIndex }),

  setGameState: (state) => set({ gameState: state, error: null }),

  setEvents: (events) => set({ lastEvents: events }),

  setError: (error) => set({ error }),

  setConnected: (connected) => set({ connected }),

  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),

  reset: () =>
    set({
      roomCode: null,
      playerIndex: null,
      reconnectToken: null,
      lobbyPlayers: [],
      lobbyConfig: null,
      hostIndex: 0,
      gameState: null,
      lastEvents: [],
      error: null,
      chatMessages: [],
    }),
}));

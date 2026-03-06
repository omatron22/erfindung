import { create } from "zustand";
import type { ClientGameState, LobbyPlayer, LobbyConfig } from "@/shared/types/messages";
import type { GameEvent } from "@/shared/types/actions";

const SESSION_KEY = "catan-session";

interface SessionData {
  roomCode: string;
  playerIndex: number;
  reconnectToken: string;
}

function saveSession(data: SessionData | null) {
  try {
    if (data) localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.roomCode && data.reconnectToken != null && data.playerIndex != null) return data;
  } catch {}
  return null;
}

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
  restoreSession: () => boolean;
}

export const useMultiplayerStore = create<MultiplayerStore>((set, get) => ({
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
    saveSession({ roomCode, playerIndex, reconnectToken });
    // Also keep legacy key for join page compat
    try { localStorage.setItem(`catan-reconnect-${roomCode}`, reconnectToken); } catch {}
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

  reset: () => {
    saveSession(null);
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
    });
  },

  restoreSession: () => {
    const session = loadSession();
    if (!session) return false;
    set({
      roomCode: session.roomCode,
      playerIndex: session.playerIndex,
      reconnectToken: session.reconnectToken,
    });
    return true;
  },
}));

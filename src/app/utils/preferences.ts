const STORAGE_KEY = "catan-preferences";
const GAME_MODE_STORAGE_KEY = "catan-game-mode-prefs";

export interface PlayerPreferences {
  name: string;
  color: string;
  buildingStyle: string;
}

export interface GameModePreferences {
  fairDice: boolean;
  friendlyRobber: boolean;
  doublesRollAgain: boolean;
  sheepNuke: boolean;
  turnTimer: number;
  vpToWin: number;
  expansionBoard: boolean;
  gameMode: string;
}

export function loadPreferences(): PlayerPreferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlayerPreferences;
  } catch {
    return null;
  }
}

export function savePreferences(prefs: Partial<PlayerPreferences>): void {
  try {
    const existing = loadPreferences();
    const merged = { ...existing, ...prefs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage unavailable (e.g. private browsing)
  }
}

export function loadGameModePrefs(): GameModePreferences | null {
  try {
    const raw = localStorage.getItem(GAME_MODE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GameModePreferences;
  } catch {
    return null;
  }
}

export function saveGameModePrefs(prefs: Partial<GameModePreferences>): void {
  try {
    const existing = loadGameModePrefs();
    const merged = { ...existing, ...prefs };
    localStorage.setItem(GAME_MODE_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage unavailable (e.g. private browsing)
  }
}

const STORAGE_KEY = "catan-preferences";

export interface PlayerPreferences {
  name: string;
  color: string;
  buildingStyle: string;
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

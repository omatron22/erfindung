export type GameMode = "classic" | "speed";

export const BUILDING_STYLES = ["classic", "medieval", "nordic", "colonial", "eastern", "modern"] as const;
export type BuildingStyle = (typeof BUILDING_STYLES)[number];
export const DEFAULT_BUILDING_STYLE: BuildingStyle = "classic";

export interface PlayerConfig {
  name: string;
  color: string;
  isBot: boolean;
  buildingStyle?: BuildingStyle;
}

export const TURN_TIMER_OPTIONS = [0, 60, 90, 120, 180, 240] as const;
export type TurnTimer = (typeof TURN_TIMER_OPTIONS)[number];

export const VP_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

export interface GameConfig {
  players: PlayerConfig[];
  fairDice: boolean;
  friendlyRobber: boolean;
  doublesRollAgain: boolean;
  sheepNuke: boolean;
  gameMode: GameMode;
  vpToWin: number;
  turnTimer: TurnTimer;
  expansionBoard: boolean;
}

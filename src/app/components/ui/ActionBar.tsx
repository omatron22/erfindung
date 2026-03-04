"use client";

import type { GameState, PlayerState, Resource } from "@/shared/types/game";
import type { ClientGameState, ClientPlayerState } from "@/shared/types/messages";
import type { GameAction } from "@/shared/types/actions";
import { BUILDING_COSTS, MAX_ROADS, MAX_SETTLEMENTS, MAX_CITIES, EXPANSION_MAX_ROADS, EXPANSION_MAX_SETTLEMENTS, EXPANSION_MAX_CITIES } from "@/shared/constants";
import {
  RoadPixel,
  HousePixel,
  CityPixel,
  ScrollPixel,
  EndTurnPixel,
} from "@/app/components/icons/PixelIcons";

interface Props {
  gameState: GameState | ClientGameState;
  localPlayerIndex: number;
  onAction: (action: GameAction) => void;
  activeAction: string | null;
  setActiveAction: (action: string | null) => void;
}

function canAfford(player: PlayerState | ClientPlayerState, cost: Partial<Record<Resource, number>>): boolean {
  for (const [res, amount] of Object.entries(cost)) {
    if ((amount || 0) > player.resources[res as Resource]) return false;
  }
  return true;
}

const ACTION_COLORS: Record<string, string> = {
  "build-road": "#8B5E3C",
  "build-settlement": "#E67E22",
  "build-city": "#8E44AD",
  "buy-dev-card": "#2980B9",
  "end-turn": "#27AE60",
};

export default function ActionBar({
  gameState,
  localPlayerIndex,
  onAction,
  activeAction,
  setActiveAction,
}: Props) {
  const player = gameState.players[localPlayerIndex];
  const expansion = gameState.config?.expansionBoard ?? false;

  const roadsLeft = (expansion ? EXPANSION_MAX_ROADS : MAX_ROADS) - player.roads.length;
  const settlementsLeft = (expansion ? EXPANSION_MAX_SETTLEMENTS : MAX_SETTLEMENTS) - player.settlements.length;
  const citiesLeft = (expansion ? EXPANSION_MAX_CITIES : MAX_CITIES) - player.cities.length;

  const actions = [
    {
      id: "build-road",
      icon: <RoadPixel size={20} color="white" />,
      affordable: canAfford(player, BUILDING_COSTS.road) && roadsLeft > 0,
      title: "Road (1 Brick + 1 Wood)",
      remaining: roadsLeft,
    },
    {
      id: "build-settlement",
      icon: <HousePixel size={20} color="white" />,
      affordable: canAfford(player, BUILDING_COSTS.settlement) && settlementsLeft > 0,
      title: "Settlement (1 Brick + 1 Wood + 1 Wheat + 1 Wool)",
      remaining: settlementsLeft,
    },
    {
      id: "build-city",
      icon: <CityPixel size={20} color="white" />,
      affordable: canAfford(player, BUILDING_COSTS.city) && citiesLeft > 0,
      title: "City (3 Ore + 2 Wheat)",
      remaining: citiesLeft,
    },
    {
      id: "buy-dev-card",
      icon: <ScrollPixel size={20} color="white" />,
      affordable:
        canAfford(player, BUILDING_COSTS.developmentCard) &&
        ("developmentCardDeck" in gameState
          ? gameState.developmentCardDeck.length > 0
          : gameState.developmentCardDeckCount > 0),
      title: "Dev Card (1 Ore + 1 Wheat + 1 Wool)",
      remaining: "developmentCardDeck" in gameState
        ? gameState.developmentCardDeck.length
        : gameState.developmentCardDeckCount,
    },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {/* Build action buttons */}
      {actions.map((action) => {
        const isActive = activeAction === action.id;
        const enabled = action.affordable;
        const bg = ACTION_COLORS[action.id] || "#555";
        return (
          <button
            key={action.id}
            onClick={() => {
              if (action.id === "buy-dev-card") {
                onAction({ type: "buy-development-card", playerIndex: localPlayerIndex });
              } else {
                setActiveAction(isActive ? null : action.id);
              }
            }}
            disabled={!enabled}
            title={action.title}
            className={`w-11 h-11 md:w-14 md:h-14 flex flex-col items-center justify-center gap-0.5 pixel-btn text-white ${
              isActive
                ? "translate-x-[2px] translate-y-[2px] !shadow-[1px_1px_0_#000]"
                : !enabled
                ? "opacity-40 cursor-not-allowed"
                : ""
            }`}
            style={{ backgroundColor: isActive ? "#d4900e" : enabled ? bg : "#666" }}
          >
            {action.icon}
            <span className="font-pixel text-[7px]">{action.remaining}</span>
          </button>
        );
      })}

      {/* Sheep Nuke */}
      {gameState.config?.sheepNuke && (() => {
        const freeNuke = !!gameState.freeNukeAvailable;
        const canNuke = freeNuke || player.resources.wool >= 10;
        return (
          <button
            onClick={() => onAction({ type: "sheep-nuke", playerIndex: localPlayerIndex })}
            disabled={!canNuke}
            title={freeNuke ? "FREE NUKE — doubles!" : "Sheep Nuke (10 Wool) — roll dice to destroy structures!"}
            className={`w-11 h-11 md:w-14 md:h-14 flex flex-col items-center justify-center pixel-btn text-white ${
              !canNuke ? "opacity-40 cursor-not-allowed" : ""
            } ${freeNuke ? "animate-pulse ring-2 ring-yellow-400" : ""}`}
            style={{ backgroundColor: canNuke ? "#dc2626" : "#666" }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" shapeRendering="crispEdges">
              <rect x="7" y="5" width="6" height="6" fill="white" />
              <rect x="5" y="7" width="2" height="2" fill="white" />
              <rect x="13" y="7" width="2" height="2" fill="white" />
              <rect x="3" y="3" width="2" height="2" fill="#fbbf24" />
              <rect x="15" y="3" width="2" height="2" fill="#fbbf24" />
              <rect x="3" y="13" width="2" height="2" fill="#fbbf24" />
              <rect x="15" y="13" width="2" height="2" fill="#fbbf24" />
              <rect x="9" y="1" width="2" height="2" fill="#fbbf24" />
              <rect x="9" y="15" width="2" height="2" fill="#fbbf24" />
            </svg>
            <span className="font-pixel text-[5px]">{freeNuke ? "FREE" : "NUKE"}</span>
          </button>
        );
      })()}

      {/* End Turn */}
      <button
        onClick={() => onAction({ type: "end-turn", playerIndex: localPlayerIndex })}
        title="End Turn"
        className="w-11 h-11 md:w-14 md:h-14 flex flex-col items-center justify-center pixel-btn text-white"
        style={{ backgroundColor: ACTION_COLORS["end-turn"] }}
      >
        <EndTurnPixel size={20} color="white" />
        <span className="font-pixel text-[6px]">END</span>
      </button>
    </div>
  );
}

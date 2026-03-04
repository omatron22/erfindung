"use client";

import type { PlayerState } from "@/shared/types/game";
import type { ClientPlayerState } from "@/shared/types/messages";
import { PLAYER_COLOR_HEX } from "@/shared/constants";
import { HelmetPixel, RoadPixel, CrownPixel } from "@/app/components/icons/PixelIcons";

interface Props {
  player: PlayerState | ClientPlayerState;
  isCurrentTurn: boolean;
  isLocalPlayer: boolean;
}

export default function PlayerPanel({ player, isCurrentTurn, isLocalPlayer }: Props) {
  const color = PLAYER_COLOR_HEX[player.color];
  const totalCards = "resourceCount" in player
    ? player.resourceCount
    : Object.values(player.resources).reduce((s, n) => s + n, 0);
  const devCards = "developmentCardCount" in player
    ? player.developmentCardCount
    : player.developmentCards.length + player.newDevelopmentCards.length;

  const hidden = player.hiddenVictoryPoints ?? 0;
  const totalVP = player.victoryPoints + hidden;

  return (
    <div
      className={`border-2 border-black pixel-border-sm px-2 flex items-center gap-2 ${
        isCurrentTurn ? "bg-amber-100/80 outline-2 outline-yellow-400 outline" : "bg-[#e8d8b8]"
      } ${isLocalPlayer ? "py-2 border-l-4" : "py-1.5"}`}
      style={isLocalPlayer ? { borderLeftColor: color } : undefined}
    >
      {/* Player color swatch */}
      <div
        className="w-5 h-5 flex-shrink-0 border-2 border-black"
        style={{ backgroundColor: color }}
      />

      {/* Name */}
      <span className="font-pixel text-[8px] text-gray-800 truncate flex-1">
        {player.name}
      </span>

      {/* Achievements */}
      {player.hasLargestArmy && (
        <span className="font-pixel text-[5px] bg-purple-600 text-white px-0.5 border border-black" title="Largest Army">LA</span>
      )}
      {player.hasLongestRoad && (
        <span className="font-pixel text-[5px] bg-orange-500 text-white px-0.5 border border-black" title="Longest Road">LR</span>
      )}

      {/* VP */}
      <div className="flex items-center gap-0.5" title={`${player.victoryPoints} victory points${isLocalPlayer && hidden > 0 ? ` (${totalVP} with hidden)` : ""}`}>
        <div className="pixel-icon"><CrownPixel size={14} color="#d97706" /></div>
        <span className="text-[9px] text-gray-700 font-bold">
          {player.victoryPoints}
          {isLocalPlayer && hidden > 0 && (
            <span className="text-[7px] text-amber-600"> ({totalVP})</span>
          )}
        </span>
      </div>

      {/* Resource cards */}
      <div className="flex items-center gap-0.5" title={`${totalCards} resource cards`}>
        <div className="w-4 h-5 bg-blue-600 border border-black flex items-center justify-center">
          <span className="text-[6px] text-white font-bold">?</span>
        </div>
        <span className="text-[9px] text-gray-700 font-bold">{totalCards}</span>
      </div>

      {/* Dev cards — plain purple card */}
      <div className="flex items-center gap-0.5" title={`${devCards} development cards`}>
        <div className="w-4 h-5 bg-purple-700 border border-black" />
        <span className="text-[9px] text-gray-700 font-bold">{devCards}</span>
      </div>

      {/* Knights played */}
      <div className="flex items-center gap-0.5" title={`${player.knightsPlayed} knights played`}>
        <div className="pixel-icon"><HelmetPixel size={14} color="#6b21a8" /></div>
        <span className="text-[9px] text-gray-700 font-bold">{player.knightsPlayed}</span>
      </div>

      {/* Longest road length */}
      <div className="flex items-center gap-0.5" title={`Longest road: ${player.longestRoadLength}`}>
        <div className="pixel-icon"><RoadPixel size={14} color="#8b7355" /></div>
        <span className="text-[9px] text-gray-700 font-bold">{player.longestRoadLength}</span>
      </div>
    </div>
  );
}

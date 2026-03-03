import type { Resource, DevelopmentCardType } from "@/shared/types/game";
import type { HexKey } from "@/shared/types/coordinates";
import { ResourceIcon } from "@/app/components/icons/ResourceIcons";
import { RESOURCE_COLORS } from "@/shared/constants";
import { hexVertices, parseHexKey } from "@/shared/utils/hexMath";

export const RESOURCE_LABELS: Record<Resource, string> = {
  brick: "BRK",
  lumber: "WOD",
  ore: "ORE",
  grain: "WHT",
  wool: "WOL",
};

export function MiniCard({
  resource,
  onClick,
  glow,
}: {
  resource: Resource;
  onClick: () => void;
  glow?: "green" | "red";
}) {
  const bg = RESOURCE_COLORS[resource];
  const borderColor = glow === "green" ? "#22c55e" : glow === "red" ? "#ef4444" : "#000";
  const shadowColor = glow === "green" ? "0 0 4px #22c55e" : glow === "red" ? "0 0 4px #ef4444" : "none";

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center select-none hover:scale-105 transition-transform active:scale-95"
      style={{
        width: 30,
        height: 36,
        backgroundColor: bg,
        border: `2px solid ${borderColor}`,
        boxShadow: `2px 2px 0 #000${shadowColor !== "none" ? `, ${shadowColor}` : ""}`,
      }}
    >
      <ResourceIcon resource={resource} size={14} />
      <span className="font-pixel" style={{ fontSize: 5, color: "white", textShadow: "1px 1px 0 rgba(0,0,0,0.6)" }}>
        {RESOURCE_LABELS[resource]}
      </span>
    </button>
  );
}

export function formatDevCard(card: DevelopmentCardType): string {
  switch (card) {
    case "knight": return "Knight";
    case "roadBuilding": return "Road Building";
    case "yearOfPlenty": return "Year of Plenty";
    case "monopoly": return "Monopoly";
    case "victoryPoint": return "Victory Point";
  }
}

export function formatDevCardShort(card: DevelopmentCardType): string {
  switch (card) {
    case "knight": return "KNT";
    case "roadBuilding": return "RDB";
    case "yearOfPlenty": return "YOP";
    case "monopoly": return "MON";
    case "victoryPoint": return "VP";
  }
}

/**
 * Get steal targets at the robber hex. Works with both GameState and ClientGameState.
 */
export function getStealTargets(
  board: { robberHex: HexKey; vertices: Record<string, { playerIndex: number; type: string } | null> },
  players: Array<{ resources: Record<string, number>; resourceCount?: number }>,
  playerIndex: number,
): number[] {
  const targets = new Set<number>();
  const hexCoord = parseHexKey(board.robberHex);
  const vertices = hexVertices(hexCoord);
  for (const vk of vertices) {
    const building = board.vertices[vk];
    if (building && building.playerIndex !== playerIndex) {
      const player = players[building.playerIndex];
      const total = player.resourceCount !== undefined
        ? player.resourceCount
        : Object.values(player.resources).reduce((s: number, n) => s + (n as number), 0);
      if (total > 0) targets.add(building.playerIndex);
    }
  }
  return Array.from(targets);
}

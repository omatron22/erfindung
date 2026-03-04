"use client";

import type { HexTile as HexTileType } from "@/shared/types/game";
import { hexToPixel, hexCornerPixels } from "@/shared/utils/hexMath";
import { TERRAIN_COLORS, NUMBER_DOTS } from "@/shared/constants";
import { RobberIcon } from "@/app/components/icons/GameIcons";
import TerrainIllustration from "./TerrainPattern";

interface Props {
  hex: HexTileType;
  size: number;
  onClick?: () => void;
  highlighted?: boolean;
  flashing?: boolean;
  flashSeven?: boolean;
}

export default function HexTile({ hex, size, onClick, highlighted, flashing, flashSeven }: Props) {
  const center = hexToPixel(hex.coord, size);
  const corners = hexCornerPixels(hex.coord, size);
  const points = corners.map((c) => `${c.x},${c.y}`).join(" ");
  const clipId = `hex-clip-${hex.coord.q}-${hex.coord.r}-${hex.coord.s}`;

  const fillColor = TERRAIN_COLORS[hex.terrain];
  const dots = hex.number ? NUMBER_DOTS[hex.number] || 0 : 0;
  const isHighProbability = hex.number === 6 || hex.number === 8;

  // Sharp square token dimensions (pixel style)
  const tokenW = size * 0.48;
  const tokenH = size * 0.44;
  const tokenRx = 0;
  const tokenY = center.y + size * 0.14;

  const dotRadius = size * 0.032;
  const dotSpacing = size * 0.085;
  const dotY = tokenY + tokenH * 0.32;

  return (
    <g onClick={onClick} className={onClick ? "cursor-pointer" : ""}>
      <defs>
        <clipPath id={clipId}>
          <polygon points={points} />
        </clipPath>
      </defs>

      {/* Base hex fill */}
      <polygon
        points={points}
        fill={fillColor}
        stroke={highlighted ? "#fff" : "#000"}
        strokeWidth={highlighted ? 3 : 2}
        className={flashing ? "hex-flash-resource" : flashSeven ? "hex-flash-seven" : ""}
      />

      {/* Terrain illustration */}
      <TerrainIllustration
        terrain={hex.terrain}
        cx={center.x}
        cy={center.y}
        size={size}
        clipId={clipId}
      />

      {/* Number token — rounded square */}
      {hex.number && (
        <g>
          {/* Token shadow (pixel hard offset) */}
          <rect
            x={center.x - tokenW / 2 + 1.5}
            y={tokenY - tokenH / 2 + 1.5}
            width={tokenW}
            height={tokenH}
            rx={tokenRx}
            fill="#000"
          />
          {/* Token background */}
          <rect
            x={center.x - tokenW / 2}
            y={tokenY - tokenH / 2}
            width={tokenW}
            height={tokenH}
            rx={tokenRx}
            fill="#fffff5"
            stroke="#000"
            strokeWidth={1.5}
          />
          {/* Number */}
          <text
            x={center.x}
            y={tokenY - size * 0.02}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={size * 0.24}
            fontWeight="bold"
            fontFamily="var(--font-pixel), monospace"
            fill={isHighProbability ? "#c0392b" : "#2c3e50"}
          >
            {hex.number}
          </text>
          {/* Probability dots */}
          {Array.from({ length: dots }).map((_, i) => {
            const totalWidth = (dots - 1) * dotSpacing;
            const dotX = center.x - totalWidth / 2 + i * dotSpacing;
            return (
              <circle
                key={i}
                cx={dotX}
                cy={dotY}
                r={dotRadius}
                fill={isHighProbability ? "#c0392b" : "#8b7355"}
              />
            );
          })}
        </g>
      )}

      {/* Robber */}
      {hex.hasRobber && (() => {
        const robberSize = size * 0.5;
        const rx = center.x - robberSize / 2;
        const ry = center.y - robberSize / 2;
        return (
          <g>
            {/* Dark backdrop circle for contrast */}
            <circle cx={center.x} cy={center.y} r={robberSize * 0.55} fill="rgba(0,0,0,0.6)" stroke="#000" strokeWidth={1.5} />
            <foreignObject x={rx} y={ry} width={robberSize} height={robberSize}>
              <div
                style={{ width: robberSize, height: robberSize, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <RobberIcon size={robberSize * 0.8} color="#e74c3c" />
              </div>
            </foreignObject>
          </g>
        );
      })()}
    </g>
  );
}

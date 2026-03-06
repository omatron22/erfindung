import type { Resource } from "@/shared/types/game";
import {
  BrickPixel,
  LumberPixel,
  OrePixel,
  GrainPixel,
  WoolPixel,
  ResourcePixel,
} from "./PixelIcons";

interface IconProps {
  size?: number;
  color?: string;
}

export function BrickIcon({ size = 24, color = "white" }: IconProps) {
  return <BrickPixel size={size} color={color} />;
}

export function LumberIcon({ size = 24, color = "white" }: IconProps) {
  return <LumberPixel size={size} color={color} />;
}

export function OreIcon({ size = 24, color = "white" }: IconProps) {
  return <OrePixel size={size} color={color} />;
}

export function GrainIcon({ size = 24, color = "white" }: IconProps) {
  return <GrainPixel size={size} color={color} />;
}

export function WoolIcon({ size = 24, color = "white" }: IconProps) {
  return <WoolPixel size={size} color={color} />;
}

export function ResourceIcon({ resource, size = 24, color = "white" }: { resource: Resource; size?: number; color?: string }) {
  return <ResourcePixel resource={resource} size={size} color={color} />;
}

const RESOURCE_CARD_COLORS: Record<Resource, string> = {
  brick: "#C4522A",
  lumber: "#2E7D32",
  ore: "#607d8b",
  grain: "#EAB308",
  wool: "#8BC34A",
};

const RESOURCE_LABELS: Record<Resource, string> = {
  brick: "BRK",
  lumber: "WOD",
  ore: "ORE",
  grain: "WHT",
  wool: "WOL",
};

const CARD_W = 36;
const CARD_H = 50;
const STACK_OFFSET = 4;

function SingleCard({ resource, bg }: { resource: Resource; bg: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center select-none"
      style={{
        width: CARD_W,
        height: CARD_H,
        backgroundColor: bg,
        border: "2px solid #000",
        boxShadow: "2px 2px 0 #000",
      }}
    >
      <div className="mb-0.5">
        <ResourcePixel resource={resource} size={18} />
      </div>
      <span className="font-pixel" style={{ fontSize: 6, color: "white", textShadow: "1px 1px 0 rgba(0,0,0,0.6)" }}>
        {RESOURCE_LABELS[resource]}
      </span>
    </div>
  );
}

export function ResourceCard({
  resource,
  count,
}: {
  resource: Resource;
  count: number;
  size?: number;
}) {
  const bg = RESOURCE_CARD_COLORS[resource];
  const stackCount = Math.min(count, 5);

  return (
    <div
      className="relative select-none"
      style={{
        width: CARD_W + (stackCount - 1) * STACK_OFFSET,
        height: CARD_H + (stackCount - 1) * STACK_OFFSET,
      }}
    >
      {Array.from({ length: stackCount }, (_, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: i * STACK_OFFSET,
            top: i * STACK_OFFSET,
            zIndex: i,
          }}
        >
          <SingleCard resource={resource} bg={bg} />
        </div>
      ))}
      {/* Count badge (only if more than 1) */}
      {count > 1 && (
        <div
          className="absolute flex items-center justify-center font-pixel"
          style={{
            bottom: -4,
            right: -4,
            width: 16,
            height: 16,
            backgroundColor: "white",
            border: "2px solid #000",
            fontSize: 8,
            fontWeight: 700,
            color: bg,
            lineHeight: 1,
            zIndex: stackCount + 1,
          }}
        >
          {count}
        </div>
      )}
    </div>
  );
}

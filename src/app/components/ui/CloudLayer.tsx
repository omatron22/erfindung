"use client";

import { WoolPixel } from "@/app/components/icons/PixelIcons";

/** Blocky 8-bit cloud SVG */
function PixelCloud({ size = 80, color = "white" }: { size?: number; color?: string }) {
  const s = size / 80;
  return (
    <svg width={80 * s} height={40 * s} viewBox="0 0 80 40" shapeRendering="crispEdges">
      <rect x="20" y="0"  width="16" height="8" fill={color} />
      <rect x="44" y="4"  width="12" height="8" fill={color} />
      <rect x="8"  y="8"  width="60" height="8" fill={color} />
      <rect x="4"  y="16" width="72" height="8" fill={color} />
      <rect x="12" y="24" width="56" height="8" fill={color} />
      <rect x="20" y="32" width="40" height="8" fill={color} />
    </svg>
  );
}

/** Sheep cloud — uses the existing WoolPixel (sheep icon) scaled up */
function PixelSheepCloud({ size = 80 }: { size?: number }) {
  return <WoolPixel size={size} color="white" />;
}

// Spread delays widely across each cloud's full cycle so they never cluster
const CLOUDS: { top: string; size: number; duration: number; delay: number; opacity: number; sheep?: boolean }[] = [
  // Large foreground clouds — spread across their ~25s cycles
  { top: "4%",   size: 220, duration: 26, delay: -1,   opacity: 1    },
  { top: "55%",  size: 200, duration: 30, delay: -17,  opacity: 0.95, sheep: true },
  { top: "28%",  size: 180, duration: 22, delay: -11,  opacity: 1    },
  { top: "72%",  size: 190, duration: 28, delay: -24,  opacity: 0.9  },
  // Medium mid-layer clouds — spread across their ~35s cycles
  { top: "15%",  size: 140, duration: 34, delay: -5,   opacity: 0.75 },
  { top: "42%",  size: 150, duration: 38, delay: -28,  opacity: 0.7  },
  { top: "65%",  size: 130, duration: 32, delay: -16,  opacity: 0.8  },
  { top: "85%",  size: 160, duration: 36, delay: -33,  opacity: 0.65, sheep: true },
  // Smaller distant clouds — spread across their ~48s cycles
  { top: "10%",  size: 100, duration: 46, delay: -9,   opacity: 0.5  },
  { top: "35%",  size: 90,  duration: 50, delay: -38,  opacity: 0.45 },
  { top: "50%",  size: 110, duration: 44, delay: -22,  opacity: 0.5  },
  { top: "78%",  size: 80,  duration: 52, delay: -45,  opacity: 0.4  },
];

export default function CloudLayer() {
  return (
    <>
      {CLOUDS.map((c, i) => (
        <div
          key={i}
          className="cloud absolute pointer-events-none"
          style={{
            top: c.top,
            animationDuration: `${c.duration}s`,
            animationDelay: `${c.delay}s`,
            opacity: c.opacity,
          }}
        >
          {c.sheep ? <PixelSheepCloud size={c.size} /> : <PixelCloud size={c.size} />}
        </div>
      ))}
    </>
  );
}

import type { BuildingStyle } from "@/shared/types/config";
import { STYLE_DEFS } from "@/shared/buildingStyles";

/** Tiny inline SVG preview of a building style */
export function StylePreview({ style, type, color }: { style: BuildingStyle; type: "settlement" | "city"; color: string }) {
  const def = STYLE_DEFS[style];
  const pos = { x: 16, y: 16 };
  const r = type === "settlement" ? 6 : 7;
  const path = def[type](pos, r);
  return (
    <svg width="32" height="32" viewBox="0 0 32 32">
      <path d={path} fill={color} stroke="#000" strokeWidth={1.2} />
    </svg>
  );
}

/** Blocky pixel rule toggle card */
export function RuleCard({ label, active, onClick, icon, disabled }: { label: string; active: boolean; onClick?: () => void; icon: "robber" | "dice"; disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={`flex flex-col items-center gap-1.5 px-4 py-3 border-2 transition-all w-28 ${
        active
          ? "border-amber-500 bg-amber-50 scale-105"
          : "border-gray-400 bg-[#e8d8b8] hover:border-gray-600 cursor-pointer"
      } ${disabled ? "opacity-70 cursor-default" : ""}`}
    >
      <svg width="28" height="28" viewBox="0 0 28 28" shapeRendering="crispEdges">
        {icon === "robber" ? (
          <>
            <rect x="11" y="4" width="6" height="6" fill={active ? "#e8a024" : "#888"} />
            <rect x="9" y="10" width="10" height="10" fill={active ? "#e8a024" : "#888"} />
            <rect x="7" y="20" width="4" height="4" fill={active ? "#e8a024" : "#888"} />
            <rect x="17" y="20" width="4" height="4" fill={active ? "#e8a024" : "#888"} />
          </>
        ) : (
          <>
            <rect x="4" y="4" width="8" height="8" rx="0" fill={active ? "#e8a024" : "#888"} />
            <rect x="16" y="4" width="8" height="8" rx="0" fill={active ? "#e8a024" : "#888"} />
            <rect x="6" y="6" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="18" y="6" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="20" y="8" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="4" y="16" width="8" height="8" rx="0" fill={active ? "#e8a024" : "#888"} />
            <rect x="16" y="16" width="8" height="8" rx="0" fill={active ? "#e8a024" : "#888"} />
            <rect x="6" y="18" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="8" y="20" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="18" y="18" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="20" y="20" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="18" y="22" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
          </>
        )}
      </svg>
      <span className="font-pixel text-[6px] text-gray-700 text-center leading-tight">{label}</span>
      {active && <span className="font-pixel text-[6px] text-amber-600">ON</span>}
    </button>
  );
}

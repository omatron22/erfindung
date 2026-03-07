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
export function RuleCard({ label, active, onClick, icon, disabled, tooltip }: { label: string; active: boolean; onClick?: () => void; icon: "robber" | "dice" | "doubles" | "nuke"; disabled?: boolean; tooltip?: string }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={`group relative flex flex-col items-center gap-1.5 px-4 py-3 border-2 transition-all w-28 ${
        active
          ? "border-amber-500 bg-amber-50 scale-105"
          : "border-gray-400 bg-[#e8d8b8] hover:border-gray-600 cursor-pointer"
      } ${disabled ? "opacity-70 cursor-default" : ""}`}
    >
      {tooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 px-2.5 py-1.5 bg-[#1a1a2e] text-[#f0e6d0] font-pixel text-[6px] leading-relaxed text-center border-2 border-[#c4a96a] opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity duration-150">
          {tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[#c4a96a]" />
        </div>
      )}
      <svg width="28" height="28" viewBox="0 0 28 28" shapeRendering="crispEdges">
        {icon === "robber" ? (
          <>
            <rect x="11" y="4" width="6" height="6" fill={active ? "#e8a024" : "#888"} />
            <rect x="9" y="10" width="10" height="10" fill={active ? "#e8a024" : "#888"} />
            <rect x="7" y="20" width="4" height="4" fill={active ? "#e8a024" : "#888"} />
            <rect x="17" y="20" width="4" height="4" fill={active ? "#e8a024" : "#888"} />
          </>
        ) : icon === "doubles" ? (
          <>
            {/* Two dice showing same number (doubles) with a circular arrow */}
            <rect x="3" y="6" width="9" height="9" fill={active ? "#e8a024" : "#888"} />
            <rect x="16" y="6" width="9" height="9" fill={active ? "#e8a024" : "#888"} />
            <rect x="5" y="8" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="9" y="12" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="18" y="8" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            <rect x="22" y="12" width="2" height="2" fill={active ? "#fff" : "#bbb"} />
            {/* Circular arrow below */}
            <rect x="8" y="18" width="12" height="2" fill={active ? "#e8a024" : "#888"} />
            <rect x="6" y="20" width="2" height="2" fill={active ? "#e8a024" : "#888"} />
            <rect x="20" y="20" width="2" height="2" fill={active ? "#e8a024" : "#888"} />
            <rect x="8" y="22" width="12" height="2" fill={active ? "#e8a024" : "#888"} />
            {/* Arrow head */}
            <rect x="18" y="16" width="2" height="2" fill={active ? "#e8a024" : "#888"} />
            <rect x="22" y="16" width="2" height="2" fill={active ? "#e8a024" : "#888"} />
          </>
        ) : icon === "nuke" ? (
          <>
            {/* Sheep (wool ball) with explosion lines */}
            <rect x="10" y="8" width="8" height="8" fill={active ? "#e8a024" : "#888"} />
            <rect x="8" y="10" width="2" height="4" fill={active ? "#e8a024" : "#888"} />
            <rect x="18" y="10" width="2" height="4" fill={active ? "#e8a024" : "#888"} />
            <rect x="12" y="6" width="4" height="2" fill={active ? "#e8a024" : "#888"} />
            <rect x="12" y="16" width="4" height="2" fill={active ? "#e8a024" : "#888"} />
            {/* Explosion rays */}
            <rect x="6" y="6" width="2" height="2" fill={active ? "#dc2626" : "#aaa"} />
            <rect x="20" y="6" width="2" height="2" fill={active ? "#dc2626" : "#aaa"} />
            <rect x="6" y="18" width="2" height="2" fill={active ? "#dc2626" : "#aaa"} />
            <rect x="20" y="18" width="2" height="2" fill={active ? "#dc2626" : "#aaa"} />
            <rect x="4" y="12" width="2" height="2" fill={active ? "#dc2626" : "#aaa"} />
            <rect x="22" y="12" width="2" height="2" fill={active ? "#dc2626" : "#aaa"} />
            <rect x="13" y="3" width="2" height="2" fill={active ? "#dc2626" : "#aaa"} />
            <rect x="13" y="21" width="2" height="2" fill={active ? "#dc2626" : "#aaa"} />
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


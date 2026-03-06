"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  isMusicMuted, setMusicMuted,
  setSfxMuted, playClick,
  getMasterVolume, setMasterVolume, updateMusicVolume,
} from "@/app/utils/sounds";
import { PLAYER_COLOR_HEX } from "@/shared/constants";
import { PLAYER_COLORS } from "@/shared/types/game";
import { BUILDING_STYLES, DEFAULT_BUILDING_STYLE } from "@/shared/types/config";
import type { BuildingStyle } from "@/shared/types/config";
import { STYLE_DEFS } from "@/shared/buildingStyles";
import { StylePreview } from "@/app/components/ui/LobbyComponents";
import { loadPreferences, savePreferences } from "@/app/utils/preferences";
import type { PlayerPreferences } from "@/app/utils/preferences";

/** Pixel-art gear icon */
function GearIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
      {/* Outer teeth */}
      <rect x="6" y="0" width="4" height="2" fill="#fbbf24" />
      <rect x="6" y="14" width="4" height="2" fill="#fbbf24" />
      <rect x="0" y="6" width="2" height="4" fill="#fbbf24" />
      <rect x="14" y="6" width="2" height="4" fill="#fbbf24" />
      {/* Diagonal teeth */}
      <rect x="2" y="2" width="3" height="2" fill="#fbbf24" />
      <rect x="11" y="2" width="3" height="2" fill="#fbbf24" />
      <rect x="2" y="12" width="3" height="2" fill="#fbbf24" />
      <rect x="11" y="12" width="3" height="2" fill="#fbbf24" />
      {/* Body */}
      <rect x="3" y="4" width="10" height="8" fill="#fbbf24" />
      <rect x="4" y="3" width="8" height="10" fill="#fbbf24" />
      {/* Center hole */}
      <rect x="6" y="6" width="4" height="4" fill="#78350f" />
      <rect x="7" y="5" width="2" height="6" fill="#78350f" />
      <rect x="5" y="7" width="6" height="2" fill="#78350f" />
    </svg>
  );
}

/** Pixel-art music note icon */
function MusicIcon({ muted, size = 14 }: { muted: boolean; size?: number }) {
  const color = muted ? "#666" : "#fbbf24";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
      <rect x="10" y="1" width="2" height="11" fill={color} />
      <rect x="12" y="1" width="2" height="2" fill={color} />
      <rect x="12" y="3" width="1" height="2" fill={color} />
      <rect x="6" y="10" width="4" height="3" fill={color} />
      <rect x="5" y="11" width="6" height="2" fill={color} />
      {muted && (
        <>
          <rect x="1" y="3" width="2" height="2" fill="#ef4444" />
          <rect x="3" y="5" width="2" height="2" fill="#ef4444" />
          <rect x="1" y="7" width="2" height="2" fill="#ef4444" />
        </>
      )}
    </svg>
  );
}

/** Pixel-art speaker icon */
function SpeakerIcon({ volume, size = 14 }: { volume: number; size?: number }) {
  const color = volume === 0 ? "#666" : "#fbbf24";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
      <rect x="2" y="5" width="3" height="6" fill={color} />
      <rect x="5" y="4" width="1" height="8" fill={color} />
      <rect x="6" y="3" width="1" height="10" fill={color} />
      <rect x="7" y="2" width="1" height="12" fill={color} />
      {volume > 0 && <rect x="9" y="5" width="1" height="6" fill={color} opacity={0.6} />}
      {volume > 40 && <rect x="11" y="4" width="1" height="8" fill={color} opacity={0.4} />}
      {volume > 70 && <rect x="13" y="3" width="1" height="10" fill={color} opacity={0.25} />}
      {volume === 0 && (
        <>
          <rect x="10" y="4" width="2" height="2" fill="#ef4444" />
          <rect x="12" y="6" width="2" height="2" fill="#ef4444" />
          <rect x="10" y="8" width="2" height="2" fill="#ef4444" />
        </>
      )}
    </svg>
  );
}

interface SettingsDropdownProps {
  className?: string;
  onChange?: (prefs: Partial<PlayerPreferences>) => void;
}

export default function SettingsDropdown({ className = "", onChange }: SettingsDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Audio state
  const [musicOff, setMusicOff] = useState(isMusicMuted);
  const [vol, setVol] = useState(getMasterVolume);

  // Player prefs state
  const [name, setName] = useState("");
  const [color, setColor] = useState("red");
  const [buildingStyle, setBuildingStyle] = useState<BuildingStyle>(DEFAULT_BUILDING_STYLE);

  // Load saved prefs on mount
  useEffect(() => {
    const prefs = loadPreferences();
    if (prefs) {
      if (prefs.name) setName(prefs.name);
      if (prefs.color) setColor(prefs.color);
      if (prefs.buildingStyle) setBuildingStyle(prefs.buildingStyle as BuildingStyle);
    }
  }, []);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const toggleMusic = useCallback(() => {
    const next = !musicOff;
    setMusicOff(next);
    setMusicMuted(next);
    if (!next) playClick();
  }, [musicOff]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVol(v);
    setMasterVolume(v);
    updateMusicVolume();
    setSfxMuted(v === 0);
  }, []);

  function updatePref(prefs: Partial<PlayerPreferences>) {
    savePreferences(prefs);
    onChange?.(prefs);
  }

  function handleNameChange(newName: string) {
    setName(newName);
    updatePref({ name: newName });
  }

  function handleColorPick(c: string) {
    playClick();
    setColor(c);
    updatePref({ color: c });
  }

  function handleStylePick(s: BuildingStyle) {
    playClick();
    setBuildingStyle(s);
    updatePref({ buildingStyle: s });
  }

  return (
    <div ref={containerRef} className={className}>
      {/* Gear button */}
      <button
        onClick={() => { setOpen(!open); }}
        className="w-9 h-9 flex items-center justify-center hover:scale-110 transition-transform cursor-pointer"
        title="Settings"
      >
        <GearIcon />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full right-0 mt-1 w-64 bg-[#f0e6d0] pixel-border p-3 z-50 shadow-lg">
          {/* AUDIO section */}
          <h3 className="font-pixel text-[7px] text-gray-500 mb-2">AUDIO</h3>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={toggleMusic}
              className={`flex items-center gap-1.5 px-2 py-1.5 border-2 transition-colors cursor-pointer ${
                musicOff
                  ? "bg-[#e8d8b8] border-gray-400 hover:border-gray-600"
                  : "bg-amber-100 border-amber-500"
              }`}
              title={musicOff ? "Music: OFF" : "Music: ON"}
            >
              <MusicIcon muted={musicOff} />
              <span className="font-pixel text-[7px] text-gray-700">{musicOff ? "OFF" : "ON"}</span>
            </button>

            <div className="flex items-center gap-1.5 flex-1">
              <SpeakerIcon volume={vol} />
              <input
                type="range"
                min={0}
                max={100}
                value={vol}
                onChange={handleVolumeChange}
                className="flex-1 h-1.5 accent-amber-400 cursor-pointer"
                title={`Volume: ${vol}%`}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="h-[2px] bg-[#c4a96a] mb-3" />

          {/* PLAYER section */}
          <h3 className="font-pixel text-[7px] text-gray-500 mb-2">PLAYER</h3>

          {/* Name input */}
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Your name..."
            maxLength={20}
            className="w-full bg-white px-2 py-1.5 text-[10px] text-gray-800 border-2 border-black focus:outline-none mb-2"
          />

          {/* Color swatches */}
          <div className="flex flex-wrap gap-1 mb-2">
            {PLAYER_COLORS.map((c) => (
              <button
                key={c}
                className={`w-6 h-6 border-2 transition-all ${
                  color === c
                    ? "border-gray-900 scale-110"
                    : "border-gray-400 hover:border-gray-700 cursor-pointer hover:scale-110"
                }`}
                style={{ backgroundColor: PLAYER_COLOR_HEX[c] }}
                onClick={() => handleColorPick(c)}
                title={c}
              />
            ))}
          </div>

          {/* Building style grid */}
          <div className="grid grid-cols-3 gap-1">
            {BUILDING_STYLES.map((s) => (
              <button
                key={s}
                className={`flex flex-col items-center gap-0.5 px-1 py-1 border-2 transition-all ${
                  buildingStyle === s
                    ? "border-amber-500 bg-amber-50 scale-105"
                    : "border-gray-300 hover:border-gray-600 cursor-pointer hover:scale-105"
                }`}
                onClick={() => handleStylePick(s)}
              >
                <div className="flex gap-0.5">
                  <StylePreview style={s} type="settlement" color="#888" />
                  <StylePreview style={s} type="city" color="#888" />
                </div>
                <span className="font-pixel text-[5px] text-gray-700">{STYLE_DEFS[s].name.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
import {
  isMusicMuted, setMusicMuted,
  setSfxMuted, playClick,
  getMasterVolume, setMasterVolume, updateMusicVolume,
} from "@/app/utils/sounds";

/** Pixel-art music note icon */
function MusicIcon({ muted, size = 16 }: { muted: boolean; size?: number }) {
  const color = muted ? "#666" : "#fbbf24";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
      {/* Note stem */}
      <rect x="10" y="1" width="2" height="11" fill={color} />
      {/* Flag */}
      <rect x="12" y="1" width="2" height="2" fill={color} />
      <rect x="12" y="3" width="1" height="2" fill={color} />
      {/* Note head */}
      <rect x="6" y="10" width="4" height="3" fill={color} />
      <rect x="5" y="11" width="6" height="2" fill={color} />
      {/* X for muted */}
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

export default function AudioControls({ className = "" }: { className?: string }) {
  const [musicOff, setMusicOff] = useState(isMusicMuted);
  const [vol, setVol] = useState(getMasterVolume);

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

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button
        onClick={toggleMusic}
        className="w-8 h-8 flex items-center justify-center bg-black/40 hover:bg-black/60 border border-white/20 transition-colors cursor-pointer"
        title={musicOff ? "Music: OFF" : "Music: ON"}
      >
        <MusicIcon muted={musicOff} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={vol}
        onChange={handleVolumeChange}
        className="w-16 h-1.5 accent-amber-400 cursor-pointer"
        title={`Volume: ${vol}%`}
      />
    </div>
  );
}

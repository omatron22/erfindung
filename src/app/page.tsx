"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PLAYER_COLOR_HEX } from "@/shared/constants";
import { PLAYER_COLORS } from "@/shared/types/game";
import type { GameConfig, PlayerConfig, BuildingStyle, TurnTimer, BotPersonality } from "@/shared/types/config";
import { BUILDING_STYLES, DEFAULT_BUILDING_STYLE, TURN_TIMER_OPTIONS, VP_OPTIONS, BOT_PERSONALITIES, DEFAULT_BOT_PERSONALITY } from "@/shared/types/config";
import { STYLE_DEFS } from "@/shared/buildingStyles";
import { StylePreview, RuleCard, PersonalityIcon, PERSONALITY_LABELS } from "@/app/components/ui/LobbyComponents";
import { useSocket } from "@/app/hooks/useSocket";
import { useMultiplayerStore } from "@/app/stores/multiplayerStore";
import { playClick, playNavigate, playError as playErrorSound, startMusic, stopMusic } from "@/app/utils/sounds";
import AudioControls from "@/app/components/ui/AudioControls";

const ALL_COLORS = PLAYER_COLORS;
const BOT_NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve"];

function defaultPlayer(name: string, color: string, isBot: boolean): PlayerConfig {
  return { name, color, isBot };
}

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

/** Simplified pixel-art sheep cloud — cloud shape with subtle head bump and small legs */
function PixelSheepCloud({ size = 80, color = "white" }: { size?: number; color?: string }) {
  const s = size / 80;
  return (
    <svg width={80 * s} height={44 * s} viewBox="0 0 80 44" shapeRendering="crispEdges">
      {/* Cloud body */}
      <rect x="20" y="0"  width="16" height="4" fill={color} />
      <rect x="8"  y="4"  width="56" height="4" fill={color} />
      <rect x="4"  y="8"  width="68" height="4" fill={color} />
      <rect x="4"  y="12" width="72" height="4" fill={color} />
      <rect x="8"  y="16" width="68" height="4" fill={color} />
      <rect x="12" y="20" width="56" height="4" fill={color} />
      <rect x="16" y="24" width="48" height="4" fill={color} />
      {/* Head bump */}
      <rect x="64" y="4"  width="12" height="4" fill={color} />
      <rect x="68" y="0"  width="8"  height="4" fill={color} />
      {/* Legs */}
      <rect x="20" y="28" width="4" height="8" fill={color} />
      <rect x="32" y="28" width="4" height="8" fill={color} />
      <rect x="48" y="28" width="4" height="8" fill={color} />
      <rect x="60" y="28" width="4" height="8" fill={color} />
    </svg>
  );
}

const CLOUDS: { top: string; size: number; duration: number; delay: number; opacity: number; sheep?: boolean }[] = [
  // Large foreground clouds
  { top: "4%",   size: 220, duration: 26, delay: -3,  opacity: 1    },
  { top: "55%",  size: 200, duration: 30, delay: -10, opacity: 0.95, sheep: true },
  { top: "28%",  size: 180, duration: 22, delay: -6,  opacity: 1    },
  { top: "72%",  size: 190, duration: 28, delay: -20, opacity: 0.9  },
  // Medium mid-layer clouds
  { top: "15%",  size: 140, duration: 34, delay: -14, opacity: 0.75 },
  { top: "42%",  size: 150, duration: 38, delay: -25, opacity: 0.7  },
  { top: "65%",  size: 130, duration: 32, delay: -8,  opacity: 0.8  },
  { top: "85%",  size: 160, duration: 36, delay: -30, opacity: 0.65, sheep: true },
  // Smaller distant clouds
  { top: "10%",  size: 100, duration: 46, delay: -18, opacity: 0.5  },
  { top: "35%",  size: 90,  duration: 50, delay: -35, opacity: 0.45 },
  { top: "50%",  size: 110, duration: 44, delay: -40, opacity: 0.5  },
  { top: "78%",  size: 80,  duration: 52, delay: -12, opacity: 0.4  },
];

export default function Home() {
  const router = useRouter();
  const [showLobby, setShowLobby] = useState(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("catan-auto-lobby")) {
      sessionStorage.removeItem("catan-auto-lobby");
      return true;
    }
    return false;
  });
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const { socket, connected } = useSocket();
  const mpStore = useMultiplayerStore();
  const [players, setPlayers] = useState<PlayerConfig[]>([
    defaultPlayer("", "red", false),
    defaultPlayer("Alice", "blue", true),
    defaultPlayer("Bob", "white", true),
    defaultPlayer("Carol", "orange", true),
  ]);
  const [fairDice, setFairDice] = useState(false);
  const [friendlyRobber, setFriendlyRobber] = useState(false);
  const [turnTimer, setTurnTimer] = useState<TurnTimer>(0);
  const [customVp, setCustomVp] = useState(10);
  const [chatMessages, setChatMessages] = useState<{ sender: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [colorPickerOpen, setColorPickerOpen] = useState<number | null>(null);
  const [stylePickerOpen, setStylePickerOpen] = useState<number | null>(null);
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const [buildingStyles, setBuildingStyles] = useState<Record<number, BuildingStyle>>({});
  const [personalities, setPersonalities] = useState<Record<number, BotPersonality>>({});
  const [personalityPickerOpen, setPersonalityPickerOpen] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // Start music on first user interaction, stop when leaving page (navigating to game)
  useEffect(() => {
    const handleInteraction = () => {
      startMusic();
      window.removeEventListener("click", handleInteraction);
    };
    window.addEventListener("click", handleInteraction);
    // If music was already started in a previous visit, resume it
    startMusic();
    return () => {
      window.removeEventListener("click", handleInteraction);
      stopMusic();
    };
  }, []);

  const isExpansion = players.length >= 5;
  const vpToWin = customVp;

  // Close color picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(null);
      }
    }
    if (colorPickerOpen !== null) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [colorPickerOpen]);

  const usedColors = new Set(players.map((p) => p.color));

  function addBot() {
    if (players.length >= 6) return;
    playClick();
    const usedNames = new Set(players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !usedNames.has(n)) ?? `Bot ${players.length}`;
    const color = ALL_COLORS.find((c) => !usedColors.has(c)) ?? "green";
    setPlayers([...players, defaultPlayer(name, color, true)]);
  }

  function removeBot(idx: number) {
    if (idx === 0 || players.length <= 2) return;
    playClick();
    setPlayers(players.filter((_, i) => i !== idx));
  }

  function updatePlayer(idx: number, updates: Partial<PlayerConfig>) {
    setPlayers(players.map((p, i) => (i === idx ? { ...p, ...updates } : p)));
  }

  function pickColor(playerIdx: number, color: string) {
    playClick();
    // Swap with whoever had this color
    const otherIdx = players.findIndex((p, i) => i !== playerIdx && p.color === color);
    if (otherIdx !== -1) {
      const oldColor = players[playerIdx].color;
      setPlayers(players.map((p, i) => {
        if (i === playerIdx) return { ...p, color };
        if (i === otherIdx) return { ...p, color: oldColor };
        return p;
      }));
    } else {
      updatePlayer(playerIdx, { color });
    }
    setColorPickerOpen(null);
  }

  function pickStyle(playerIdx: number, style: BuildingStyle) {
    playClick();
    setBuildingStyles((prev) => ({ ...prev, [playerIdx]: style }));
    setStylePickerOpen(null);
  }

  function pickPersonality(playerIdx: number, personality: BotPersonality) {
    playClick();
    setPersonalities((prev) => ({ ...prev, [playerIdx]: personality }));
    setPersonalityPickerOpen(null);
  }

  function startGame() {
    playNavigate();
    setValidationError(null);

    // Validation
    const names = players.map((p, i) => {
      if (p.isBot) return p.name.trim() || BOT_NAMES[i - 1] || `Bot ${i}`;
      return p.name.trim() || "You";
    });
    if (players.length < 2) {
      setValidationError("Need at least 2 players");
      return;
    }
    const uniqueColors = new Set(players.map((p) => p.color));
    if (uniqueColors.size !== players.length) {
      setValidationError("Each player must have a unique color");
      return;
    }
    if (names.some((n) => !n)) {
      setValidationError("All players need a name");
      return;
    }

    const config: GameConfig = {
      players: players.map((p, i) => ({
        ...p,
        name: names[i],
        buildingStyle: buildingStyles[i] ?? DEFAULT_BUILDING_STYLE,
        ...(p.isBot ? { personality: personalities[i] ?? DEFAULT_BOT_PERSONALITY } : {}),
      })),
      fairDice,
      friendlyRobber,
      gameMode: "classic" as const,
      vpToWin,
      turnTimer,
      expansionBoard: isExpansion,
    };

    sessionStorage.setItem("catan-game-config", JSON.stringify(config));
    // Also store legacy format for backwards compat
    sessionStorage.setItem(
      "catan-config",
      JSON.stringify({ playerName: names[0], botNames: names.slice(1) })
    );
    router.push("/game/hotseat");
  }

  // Socket event listeners for online lobby
  useEffect(() => {
    if (!socket) return;

    const onJoined = ({ roomCode, playerIndex, reconnectToken }: { roomCode: string; playerIndex: number; reconnectToken: string }) => {
      mpStore.setRoomJoined(roomCode, playerIndex, reconnectToken);
      setCreating(false);
      router.push("/game/online");
    };

    const onError = ({ message }: { message: string }) => {
      mpStore.setError(message);
      setCreating(false);
    };

    socket.on("room:joined", onJoined);
    socket.on("game:error", onError);

    return () => {
      socket.off("room:joined", onJoined);
      socket.off("game:error", onError);
    };
  }, [socket, router, mpStore]);

  function createRoom() {
    const name = players[0].name.trim() || "Player";
    if (!socket || !connected) return;
    playNavigate();
    setCreating(true);
    socket.emit("room:join", { roomCode: "", playerName: name });
  }

  function joinRoom() {
    const name = players[0].name.trim() || "Player";
    if (!socket || !connected || !joinCode.trim()) return;
    playNavigate();
    setCreating(true);
    socket.emit("room:join", { roomCode: joinCode.trim().toUpperCase(), playerName: name });
  }

  const cloudLayer = (
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

  if (!showLobby) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#2a6ab5] overflow-hidden relative">
        {cloudLayer}

        {/* Audio controls */}
        <AudioControls className="absolute top-4 right-4 z-20" />

        {/* Title + play button */}
        <div className="relative z-10 flex flex-col items-center">
          <h1
            className="font-pixel text-[90px] text-amber-400 mb-16 tracking-wider leading-none"
            style={{ textShadow: "6px 6px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000" }}
          >
            ERFINDUNG
          </h1>

          <button
            onClick={() => { playNavigate(); setShowLobby(true); }}
            className="px-14 py-5 bg-amber-400 text-gray-900 font-pixel text-[20px] pixel-btn start-pulse"
          >
            PLAY
          </button>
        </div>
      </main>
    );
  }

  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    setChatMessages((prev) => [...prev, { sender: players[0].name || "You", text }]);
    setChatInput("");
  }

  const timerIdx = TURN_TIMER_OPTIONS.indexOf(turnTimer);
  const vpIdx = VP_OPTIONS.indexOf(customVp as (typeof VP_OPTIONS)[number]);

  return (
    <main className="h-screen flex flex-col bg-[#2a6ab5] overflow-hidden relative">
      {cloudLayer}

      <button
        onClick={() => { playClick(); setShowLobby(false); }}
        className="absolute top-4 left-4 z-20 font-pixel text-[9px] text-white/70 hover:text-white"
        title="Back to menu"
      >
        &larr; BACK
      </button>

      {/* Audio controls */}
      <AudioControls className="absolute top-4 right-4 z-20" />

      {/* Main 3-column layout */}
      <div className="relative z-10 flex flex-1 min-h-0 items-center px-0">
        {/* ===== LEFT — Players ===== */}
        <div className="w-60 shrink-0 bg-[#f0e6d0] pixel-border ml-3 flex flex-col h-[440px]">
          <div className="px-4 pt-3 pb-2">
            <h2 className="font-pixel text-[9px] text-gray-700">
              PLAYERS ({players.length}/{isExpansion ? 6 : 4})
            </h2>
          </div>

          <div className="px-4 space-y-2 overflow-y-auto flex-1">
            {players.map((player, idx) => (
              <div key={idx} className="relative">
                <div className="flex items-center gap-2 bg-[#e8d8b8] px-2 py-1.5 border-2 border-black">
                  {/* Color swatch */}
                  <button
                    className="w-6 h-6 border-2 border-black cursor-pointer shrink-0 relative"
                    style={{ backgroundColor: PLAYER_COLOR_HEX[player.color] }}
                    onClick={() => { setColorPickerOpen(colorPickerOpen === idx ? null : idx); setStylePickerOpen(null); setPersonalityPickerOpen(null); }}
                    title={`Color: ${player.color}`}
                  >
                    <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold"
                      style={{ color: ["white", "yellow"].includes(player.color) ? "#333" : "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
                    >
                      {colorPickerOpen === idx ? "\u25B2" : "\u25BC"}
                    </span>
                  </button>

                  {/* Name — click to edit */}
                  {editingNameIdx === idx ? (
                    <input
                      type="text"
                      value={player.name}
                      onChange={(e) => updatePlayer(idx, { name: e.target.value })}
                      onBlur={() => setEditingNameIdx(null)}
                      onKeyDown={(e) => { if (e.key === "Enter") setEditingNameIdx(null); }}
                      placeholder={idx === 0 ? "Your name..." : "Bot name..."}
                      className="flex-1 bg-white px-2 py-0.5 text-[10px] text-gray-800 border border-gray-400 focus:outline-none min-w-0"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="flex-1 font-pixel text-[8px] text-gray-800 truncate cursor-pointer hover:text-amber-700"
                      onClick={() => setEditingNameIdx(idx)}
                      title="Click to edit name"
                    >
                      {player.name || (idx === 0 ? "Your name..." : "Bot name...")}
                      {player.isBot && <span className="text-gray-500 text-[6px] ml-1">(BOT)</span>}
                    </span>
                  )}

                  {/* Personality (bots only) */}
                  {player.isBot && (
                    <button
                      className={`w-7 h-7 flex items-center justify-center border-2 shrink-0 ${personalityPickerOpen === idx ? "border-amber-500 bg-amber-50" : "border-gray-400 hover:border-gray-600"}`}
                      onClick={() => { setPersonalityPickerOpen(personalityPickerOpen === idx ? null : idx); setStylePickerOpen(null); setColorPickerOpen(null); }}
                      title={`Personality: ${PERSONALITY_LABELS[personalities[idx] ?? DEFAULT_BOT_PERSONALITY].name}`}
                    >
                      <PersonalityIcon personality={personalities[idx] ?? DEFAULT_BOT_PERSONALITY} size={16} />
                    </button>
                  )}

                  {/* Building style */}
                  <button
                    className={`w-7 h-7 flex items-center justify-center border-2 shrink-0 ${stylePickerOpen === idx ? "border-amber-500 bg-amber-50" : "border-gray-400 hover:border-gray-600"}`}
                    onClick={() => { setStylePickerOpen(stylePickerOpen === idx ? null : idx); setColorPickerOpen(null); setPersonalityPickerOpen(null); }}
                    title={`Style: ${STYLE_DEFS[buildingStyles[idx] ?? DEFAULT_BUILDING_STYLE].name}`}
                  >
                    <StylePreview
                      style={buildingStyles[idx] ?? DEFAULT_BUILDING_STYLE}
                      type="settlement"
                      color={PLAYER_COLOR_HEX[player.color]}
                    />
                  </button>

                  {/* Remove */}
                  {idx > 0 && players.length > 2 && (
                    <button
                      className="w-4 h-4 font-pixel text-[9px] text-red-600 hover:text-red-800 shrink-0"
                      onClick={() => removeBot(idx)}
                      title="Remove player"
                    >
                      X
                    </button>
                  )}
                </div>

                {/* Color picker dropdown */}
                {colorPickerOpen === idx && (
                  <div ref={colorPickerRef} className="bg-[#f5edd5] border-2 border-t-0 border-black px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {ALL_COLORS.map((c) => {
                        const isCurrent = player.color === c;
                        const taken = usedColors.has(c) && !isCurrent;
                        return (
                          <button
                            key={c}
                            className={`relative flex items-center gap-1 px-1.5 py-0.5 border-2 transition-all ${
                              isCurrent
                                ? "border-gray-900 scale-105"
                                : taken
                                  ? "border-gray-300 opacity-35 cursor-not-allowed"
                                  : "border-gray-400 hover:border-gray-700 cursor-pointer hover:scale-105"
                            }`}
                            style={{ backgroundColor: `${PLAYER_COLOR_HEX[c]}25` }}
                            onClick={() => !taken && pickColor(idx, c)}
                            disabled={taken}
                          >
                            <span className="w-3 h-3 border border-black/30 shrink-0" style={{ backgroundColor: PLAYER_COLOR_HEX[c] }} />
                            <span className="font-pixel text-[5px] text-gray-700 uppercase">{c}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Personality picker dropdown */}
                {personalityPickerOpen === idx && player.isBot && (
                  <div className="absolute left-0 z-50 w-52 bg-[#f5edd5] border-2 border-t-0 border-black px-2 py-1.5">
                    <div className="flex flex-col gap-0.5">
                      {BOT_PERSONALITIES.map((p) => {
                        const isCurrent = (personalities[idx] ?? DEFAULT_BOT_PERSONALITY) === p;
                        const info = PERSONALITY_LABELS[p];
                        return (
                          <button
                            key={p}
                            className={`flex items-center gap-2 px-2 py-1 border-2 transition-all ${
                              isCurrent
                                ? "border-amber-500 bg-amber-50"
                                : "border-gray-300 hover:border-gray-600 cursor-pointer"
                            }`}
                            onClick={() => pickPersonality(idx, p)}
                          >
                            <PersonalityIcon personality={p} size={14} />
                            <div className="flex flex-col items-start">
                              <span className="font-pixel text-[6px] text-gray-800">{info.name}</span>
                              <span className="font-pixel text-[5px] text-gray-500">{info.description}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Style picker dropdown */}
                {stylePickerOpen === idx && (
                  <div className="absolute left-0 z-50 w-52 bg-[#f5edd5] border-2 border-t-0 border-black px-2 py-1.5">
                    <div className="grid grid-cols-2 gap-1">
                      {BUILDING_STYLES.map((s) => {
                        const isCurrent = (buildingStyles[idx] ?? DEFAULT_BUILDING_STYLE) === s;
                        return (
                          <button
                            key={s}
                            className={`flex flex-col items-center gap-0.5 px-1 py-1 border-2 transition-all ${
                              isCurrent
                                ? "border-amber-500 bg-amber-50 scale-105"
                                : "border-gray-300 hover:border-gray-600 cursor-pointer hover:scale-105"
                            }`}
                            onClick={() => pickStyle(idx, s)}
                          >
                            <div className="flex gap-0.5">
                              <StylePreview style={s} type="settlement" color={PLAYER_COLOR_HEX[player.color]} />
                              <StylePreview style={s} type="city" color={PLAYER_COLOR_HEX[player.color]} />
                            </div>
                            <span className="font-pixel text-[5px] text-gray-700">{STYLE_DEFS[s].name.toUpperCase()}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add bot + expansion badge */}
          <div className="px-4 pb-3 pt-2">
            {players.length < 6 && (
              <button
                onClick={addBot}
                className="w-full py-2 font-pixel text-[8px] pixel-btn bg-[#8BC34A] text-white hover:bg-[#7CB342]"
              >
                + ADD BOT
              </button>
            )}
            {isExpansion && (
              <div className="mt-2 bg-amber-100 pixel-border-sm px-3 py-1.5 text-center">
                <span className="font-pixel text-[7px] text-amber-700">EXPANSION BOARD</span>
              </div>
            )}
          </div>
        </div>

        {/* ===== CENTER — Settings + Start ===== */}
        <div className="flex-1 flex flex-col min-w-0 px-6 py-4">
          <div className="flex-1 flex flex-col gap-3 justify-center max-w-xl mx-auto w-full">
            {/* Rules */}
            <div className="bg-[#f0e6d0] pixel-border p-4">
              <h2 className="font-pixel text-[9px] text-gray-700 mb-3 text-center">RULES</h2>
              <div className="flex justify-center gap-3">
                <RuleCard label="FRIENDLY ROBBER" active={friendlyRobber} onClick={() => { playClick(); setFriendlyRobber(!friendlyRobber); }} icon="robber" />
                <RuleCard label="BALANCED DICE" active={fairDice} onClick={() => { playClick(); setFairDice(!fairDice); }} icon="dice" />
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="bg-[#f0e6d0] pixel-border p-4">
              <h2 className="font-pixel text-[9px] text-gray-700 mb-3 text-center">ADVANCED SETTINGS</h2>

              <div className="grid grid-cols-2 gap-3">
                {/* Turn Timer */}
                <div className="text-center">
                  <span className="font-pixel text-[8px] text-gray-600 block mb-1">TURN TIMER</span>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      className="font-pixel text-[10px] text-gray-700 hover:text-gray-900 px-1"
                      onClick={() => { if (timerIdx > 0) { playClick(); setTurnTimer(TURN_TIMER_OPTIONS[timerIdx - 1]); } }}
                    >
                      &lt;
                    </button>
                    <span className="font-pixel text-[9px] text-gray-800 w-10 text-center">
                      {turnTimer === 0 ? "OFF" : `${turnTimer}s`}
                    </span>
                    <button
                      className="font-pixel text-[10px] text-gray-700 hover:text-gray-900 px-1"
                      onClick={() => { if (timerIdx < TURN_TIMER_OPTIONS.length - 1) { playClick(); setTurnTimer(TURN_TIMER_OPTIONS[timerIdx + 1]); } }}
                    >
                      &gt;
                    </button>
                  </div>
                </div>

                {/* Points to Win */}
                <div className="text-center">
                  <span className="font-pixel text-[8px] text-gray-600 block mb-1">POINTS TO WIN</span>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      className="font-pixel text-[10px] text-gray-700 hover:text-gray-900 px-1"
                      onClick={() => { if (vpIdx > 0) { playClick(); setCustomVp(VP_OPTIONS[vpIdx - 1]); } }}
                    >
                      &lt;
                    </button>
                    <span className="font-pixel text-[10px] text-amber-600 bg-amber-100 border border-amber-400 w-8 text-center py-0.5">
                      {customVp}
                    </span>
                    <button
                      className="font-pixel text-[10px] text-gray-700 hover:text-gray-900 px-1"
                      onClick={() => { if (vpIdx < VP_OPTIONS.length - 1) { playClick(); setCustomVp(VP_OPTIONS[vpIdx + 1]); } }}
                    >
                      &gt;
                    </button>
                  </div>
                </div>

                {/* Max Players */}
                <div className="text-center">
                  <span className="font-pixel text-[8px] text-gray-600 block mb-1">MAX PLAYERS</span>
                  <span className="font-pixel text-[9px] text-gray-800">
                    {players.length}/{isExpansion ? 6 : 4}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Validation error + Start Game + Online at bottom */}
          <div className="max-w-xl mx-auto w-full pt-2">
            {validationError && (
              <div className="bg-red-100 pixel-border-sm px-3 py-2 text-center mb-2">
                <p className="font-pixel text-[8px] text-red-700">{validationError}</p>
              </div>
            )}
            {mpStore.error && (
              <div className="bg-red-100 pixel-border-sm px-3 py-2 text-center mb-2">
                <p className="font-pixel text-[8px] text-red-700">{mpStore.error}</p>
              </div>
            )}
            <button
              onClick={startGame}
              className="w-full py-4 bg-amber-400 text-gray-900 font-pixel text-[12px] pixel-btn"
            >
              START GAME
            </button>

            {/* Online section */}
            <div className="flex items-center gap-2 my-3">
              <div className="flex-1 h-[2px] bg-white/30" />
              <span className="font-pixel text-[8px] text-white/60">OR PLAY ONLINE</span>
              <div className="flex-1 h-[2px] bg-white/30" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={createRoom}
                disabled={!connected || !(players[0].name.trim()) || creating}
                className="flex-1 py-3 bg-[#4CAF50] text-white font-pixel text-[10px] pixel-btn disabled:opacity-50"
              >
                {creating ? "CREATING..." : "CREATE ROOM"}
              </button>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                placeholder="CODE"
                maxLength={4}
                className="w-20 bg-white px-2 py-2 text-[11px] text-gray-800 border-2 border-black focus:outline-none font-pixel text-center tracking-widest uppercase"
              />
              <button
                onClick={joinRoom}
                disabled={!connected || !(players[0].name.trim()) || !joinCode.trim() || creating}
                className="px-4 py-2 bg-[#4CAF50] text-white font-pixel text-[9px] pixel-btn disabled:opacity-50"
              >
                JOIN
              </button>
            </div>
            {!connected && <p className="font-pixel text-[7px] text-white/50 text-center mt-1">Connecting to server...</p>}
          </div>
        </div>

        {/* ===== RIGHT — Chat ===== */}
        <div className="w-60 shrink-0 bg-[#f0e6d0] pixel-border mr-3 flex flex-col h-[440px]">
          <div className="px-4 pt-3 pb-2">
            <h2 className="font-pixel text-[9px] text-gray-700 text-center">CHAT</h2>
          </div>

          {/* Messages area */}
          <div className="mx-4 bg-[#e8d8b8] border-2 border-black p-2 overflow-y-auto game-log-scroll flex-1">
            {chatMessages.length === 0 ? (
              <p className="font-pixel text-[7px] text-gray-400 text-center mt-4">No messages yet...</p>
            ) : (
              <div className="space-y-1">
                {chatMessages.map((msg, i) => (
                  <div key={i}>
                    <span className="font-pixel text-[7px] text-amber-700 font-bold">{msg.sender}: </span>
                    <span className="font-pixel text-[7px] text-gray-700">{msg.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex gap-1 px-4 py-3">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="Send a message..."
              className="flex-1 bg-white px-2 py-1 text-[9px] text-gray-800 border-2 border-black focus:outline-none min-w-0"
            />
            <button
              onClick={sendChat}
              className="px-2 py-1 bg-amber-400 border-2 border-black font-pixel text-[8px] hover:bg-amber-500"
            >
              &gt;
            </button>
          </div>
        </div>
      </div>

      {/* Fun facts ticker at the bottom */}
      <div className="relative z-10 w-full py-2 overflow-hidden">
        <div className="lobby-ticker whitespace-nowrap font-pixel text-[10px] text-amber-300/70">
          <span className="mx-8">A medieval knight&apos;s armor weighed about 50 pounds</span>
          <span className="mx-8">Wool was medieval Europe&apos;s most traded commodity</span>
          <span className="mx-8">The longest road in the Roman Empire stretched 3,700 miles</span>
          <span className="mx-8">Medieval bricks were often stamped with the maker&apos;s seal</span>
          <span className="mx-8">Iron ore was called &quot;the bones of the earth&quot; by Saxon miners</span>
          <span className="mx-8">A single grain harvest could feed a village for an entire winter</span>
          <span className="mx-8">Knights trained from age 7 as pages before earning their spurs</span>
          <span className="mx-8">Medieval lumber was so valuable that forests had armed guards</span>
          <span className="mx-8">The largest medieval army ever assembled had 100,000 soldiers</span>
          <span className="mx-8">Sheep outnumbered people 3 to 1 in 13th century England</span>
          <span className="mx-8">A medieval knight&apos;s armor weighed about 50 pounds</span>
          <span className="mx-8">Wool was medieval Europe&apos;s most traded commodity</span>
          <span className="mx-8">The longest road in the Roman Empire stretched 3,700 miles</span>
          <span className="mx-8">Medieval bricks were often stamped with the maker&apos;s seal</span>
          <span className="mx-8">Iron ore was called &quot;the bones of the earth&quot; by Saxon miners</span>
        </div>
      </div>
    </main>
  );
}

function ToggleButton({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex">
      <button
        className={`px-3 py-1.5 font-pixel text-[8px] border-2 border-black border-r-0 ${
          !value ? "bg-gray-400 text-white" : "bg-[#e8d8b8] text-gray-500"
        }`}
        onClick={() => onChange(false)}
      >
        OFF
      </button>
      <button
        className={`px-3 py-1.5 font-pixel text-[8px] border-2 border-black ${
          value ? "bg-amber-400 text-gray-900" : "bg-[#e8d8b8] text-gray-500"
        }`}
        onClick={() => onChange(true)}
      >
        ON
      </button>
    </div>
  );
}

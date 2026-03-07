"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PLAYER_COLOR_HEX } from "@/shared/constants";
import { PLAYER_COLORS } from "@/shared/types/game";
import type { GameConfig, PlayerConfig, BuildingStyle, TurnTimer } from "@/shared/types/config";
import { BUILDING_STYLES, DEFAULT_BUILDING_STYLE, TURN_TIMER_OPTIONS, VP_OPTIONS } from "@/shared/types/config";
import { STYLE_DEFS } from "@/shared/buildingStyles";
import { StylePreview, RuleCard } from "@/app/components/ui/LobbyComponents";
import { useSocket } from "@/app/hooks/useSocket";
import { useMultiplayerStore } from "@/app/stores/multiplayerStore";
import { playClick, playNavigate, playError as playErrorSound, startMusic } from "@/app/utils/sounds";
import SettingsDropdown from "@/app/components/ui/SettingsDropdown";
import CloudLayer from "@/app/components/ui/CloudLayer";
import { loadPreferences, loadGameModePrefs, saveGameModePrefs } from "@/app/utils/preferences";

const ALL_COLORS = PLAYER_COLORS;
const MAX_PLAYERS = 8;

const BOT_DEFAULTS: { name: string; color: string; style: BuildingStyle }[] = [
  { name: "Chungus", color: "blue",   style: "medieval" },
  { name: "Lebron",  color: "orange", style: "modern" },
  { name: "Luffy",   color: "green",  style: "eastern" },
  { name: "Keyan",   color: "purple", style: "nordic" },
  { name: "Logan",   color: "teal",   style: "colonial" },
  { name: "Sakura",  color: "pink",   style: "eastern" },
  { name: "Hank",    color: "yellow", style: "medieval" },
];
const BOT_NAMES = BOT_DEFAULTS.map((b) => b.name);

function defaultPlayer(name: string, color: string, isBot: boolean): PlayerConfig {
  return { name, color, isBot };
}


export default function Home() {
  const router = useRouter();
  const [showLobby, setShowLobby] = useState(() => {
    if (typeof window !== "undefined") {
      if (sessionStorage.getItem("catan-auto-lobby")) {
        sessionStorage.removeItem("catan-auto-lobby");
        return true;
      }
      return sessionStorage.getItem("catan-show-lobby") === "true";
    }
    return false;
  });
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const { socket, connected } = useSocket();
  const mpStore = useMultiplayerStore();
  const [players, setPlayers] = useState<PlayerConfig[]>([
    defaultPlayer("", "red", false),
    defaultPlayer(BOT_DEFAULTS[0].name, BOT_DEFAULTS[0].color, true),
    defaultPlayer(BOT_DEFAULTS[1].name, BOT_DEFAULTS[1].color, true),
    defaultPlayer(BOT_DEFAULTS[2].name, BOT_DEFAULTS[2].color, true),
  ]);
  const [fairDice, setFairDice] = useState(false);
  const [friendlyRobber, setFriendlyRobber] = useState(false);
  const [doublesRollAgain, setDoublesRollAgain] = useState(false);
  const [sheepNuke, setSheepNuke] = useState(false);
  const [turnTimer, setTurnTimer] = useState<TurnTimer>(0);
  const [customVp, setCustomVp] = useState(10);
  const [chatMessages, setChatMessages] = useState<{ sender: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [colorPickerOpen, setColorPickerOpen] = useState<number | null>(null);
  const [stylePickerOpen, setStylePickerOpen] = useState<number | null>(null);
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const [buildingStyles, setBuildingStyles] = useState<Record<number, BuildingStyle>>({
    1: BOT_DEFAULTS[0].style,
    2: BOT_DEFAULTS[1].style,
    3: BOT_DEFAULTS[2].style,
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // Persist lobby visibility across refresh
  useEffect(() => {
    if (showLobby) {
      sessionStorage.setItem("catan-show-lobby", "true");
    } else {
      sessionStorage.removeItem("catan-show-lobby");
    }
  }, [showLobby]);

  // Start music on first user interaction (persists across page navigations)
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
    };
  }, []);

  // Load saved preferences on mount
  useEffect(() => {
    const prefs = loadPreferences();
    if (!prefs) return;
    setPlayers((prev) => {
      const updated = [...prev];
      const p0 = { ...updated[0] };
      if (prefs.name) p0.name = prefs.name;
      if (prefs.color) {
        const conflictIdx = updated.findIndex((p, i) => i !== 0 && p.color === prefs.color);
        if (conflictIdx !== -1) {
          updated[conflictIdx] = { ...updated[conflictIdx], color: p0.color };
        }
        p0.color = prefs.color;
      }
      updated[0] = p0;
      return updated;
    });
    if (prefs.buildingStyle) {
      setBuildingStyles((prev) => ({ ...prev, [0]: prefs.buildingStyle as BuildingStyle }));
    }
  }, []);

  const [expansionBoard, setExpansionBoard] = useState(false);
  const vpToWin = customVp;

  // Load saved game mode preferences on mount
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    const modePrefs = loadGameModePrefs();
    if (modePrefs) {
      if (modePrefs.fairDice !== undefined) setFairDice(modePrefs.fairDice);
      if (modePrefs.friendlyRobber !== undefined) setFriendlyRobber(modePrefs.friendlyRobber);
      if (modePrefs.doublesRollAgain !== undefined) setDoublesRollAgain(modePrefs.doublesRollAgain);
      if (modePrefs.sheepNuke !== undefined) setSheepNuke(modePrefs.sheepNuke);
      if (modePrefs.turnTimer !== undefined) setTurnTimer(modePrefs.turnTimer as TurnTimer);
      if (modePrefs.vpToWin !== undefined) setCustomVp(modePrefs.vpToWin);
      if (modePrefs.expansionBoard !== undefined) setExpansionBoard(modePrefs.expansionBoard);
    }
    setPrefsLoaded(true);
  }, []);

  // Save game mode preferences whenever they change (only after initial load completes)
  useEffect(() => {
    if (!prefsLoaded) return;
    saveGameModePrefs({
      fairDice,
      friendlyRobber,
      doublesRollAgain,
      sheepNuke,
      turnTimer,
      vpToWin: customVp,
      expansionBoard,
      gameMode: "classic",
    });
  }, [prefsLoaded, fairDice, friendlyRobber, doublesRollAgain, sheepNuke, turnTimer, customVp, expansionBoard]);

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
    if (players.length >= MAX_PLAYERS) return;
    playClick();
    const usedNames = new Set(players.map((p) => p.name));
    const botDef = BOT_DEFAULTS.find((b) => !usedNames.has(b.name));
    const name = botDef?.name ?? `Bot ${players.length}`;
    const color = botDef && !usedColors.has(botDef.color)
      ? botDef.color
      : ALL_COLORS.find((c) => !usedColors.has(c)) ?? "green";
    const newIdx = players.length;
    setPlayers([...players, defaultPlayer(name, color, true)]);
    if (botDef) {
      setBuildingStyles((prev) => ({ ...prev, [newIdx]: botDef.style }));
    }
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
      })),
      fairDice,
      friendlyRobber,
      doublesRollAgain,
      sheepNuke,
      gameMode: "classic" as const,
      vpToWin,
      turnTimer,
      expansionBoard: expansionBoard,
    };

    sessionStorage.setItem("catan-game-config", JSON.stringify(config));
    sessionStorage.removeItem("catan-game-state"); // Clear any old saved game
    router.push("/game/hotseat");
  }

  // Socket event listeners for online lobby
  // Socket callbacks only update the store — navigation happens in the effect below
  useEffect(() => {
    if (!socket) return;

    const onJoined = ({ roomCode, playerIndex, reconnectToken }: { roomCode: string; playerIndex: number; reconnectToken: string }) => {
      useMultiplayerStore.getState().setRoomJoined(roomCode, playerIndex, reconnectToken);
      // Don't setCreating(false) here — the navigation effect below needs creating=true
    };

    const onError = ({ message }: { message: string }) => {
      useMultiplayerStore.getState().setError(message);
      setCreating(false); // Only reset on error so the user can retry
    };

    socket.on("room:joined", onJoined);
    socket.on("game:error", onError);

    return () => {
      socket.off("room:joined", onJoined);
      socket.off("game:error", onError);
    };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to online page when room is joined (triggered by store update, not socket callback)
  const onlineRoomCode = useMultiplayerStore((s) => s.roomCode);
  useEffect(() => {
    if (creating && onlineRoomCode) {
      setCreating(false);
      router.push("/game/online");
    }
  }, [creating, onlineRoomCode, router]);

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

  if (!showLobby) {
    return (
      <main className="min-h-safe-screen flex items-center justify-center bg-[#2a6ab5] overflow-hidden relative px-4">
        <CloudLayer />

        {/* Settings gear */}
        <SettingsDropdown
          className="absolute top-4 right-4 z-20"
          onChange={(prefs) => {
            if (prefs.name !== undefined || prefs.color !== undefined) {
              setPlayers((prev) => {
                const updated = [...prev];
                const p0 = { ...updated[0] };
                if (prefs.name !== undefined) p0.name = prefs.name;
                if (prefs.color !== undefined) {
                  const conflictIdx = updated.findIndex((p, i) => i !== 0 && p.color === prefs.color);
                  if (conflictIdx !== -1) {
                    updated[conflictIdx] = { ...updated[conflictIdx], color: p0.color };
                  }
                  p0.color = prefs.color;
                }
                updated[0] = p0;
                return updated;
              });
            }
            if (prefs.buildingStyle) {
              setBuildingStyles((prev) => ({ ...prev, [0]: prefs.buildingStyle as BuildingStyle }));
            }
          }}
        />

        {/* Title + play button */}
        <div className="relative z-10 flex flex-col items-center">
          <h1
            className="font-pixel text-[40px] md:text-[90px] text-amber-400 mb-8 md:mb-16 tracking-wider leading-none text-center"
            style={{ textShadow: "6px 6px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000" }}
          >
            ERFINDUNG
          </h1>

          <button
            onClick={() => { playNavigate(); setShowLobby(true); }}
            className="px-10 md:px-14 py-4 md:py-5 bg-amber-400 text-gray-900 font-pixel text-[16px] md:text-[20px] pixel-btn start-pulse"
          >
            PLAY
          </button>
        </div>

        {/* Disclaimer */}
        <div className="absolute bottom-3 inset-x-0 z-10 text-center px-4">
          <p className="font-pixel text-[5px] md:text-[6px] text-white/40 leading-relaxed">
            Erfindung is a fan-made project and is not affiliated with, endorsed by, or associated with Catan GmbH, Catan Studio, or Klaus Teuber&apos;s estate. &quot;Catan&quot; is a registered trademark of Catan GmbH.
          </p>
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
    <main className="h-safe-screen flex flex-col bg-[#2a6ab5] overflow-hidden relative">
      <CloudLayer />

      <button
        onClick={() => { playClick(); setShowLobby(false); }}
        className="absolute top-4 left-4 z-20 font-pixel text-[9px] text-white/70 hover:text-white"
        title="Back to menu"
      >
        &larr; BACK
      </button>

      {/* Settings gear */}
      <SettingsDropdown
        className="absolute top-4 right-4 z-20"
        onChange={(prefs) => {
          if (prefs.name !== undefined || prefs.color !== undefined) {
            setPlayers((prev) => {
              const updated = [...prev];
              const p0 = { ...updated[0] };
              if (prefs.name !== undefined) p0.name = prefs.name;
              if (prefs.color !== undefined) {
                const conflictIdx = updated.findIndex((p, i) => i !== 0 && p.color === prefs.color);
                if (conflictIdx !== -1) {
                  updated[conflictIdx] = { ...updated[conflictIdx], color: p0.color };
                }
                p0.color = prefs.color;
              }
              updated[0] = p0;
              return updated;
            });
          }
          if (prefs.buildingStyle) {
            setBuildingStyles((prev) => ({ ...prev, [0]: prefs.buildingStyle as BuildingStyle }));
          }
        }}
      />

      {/* Main layout: 3-column on desktop, vertical scroll on mobile */}
      <div className="relative z-10 flex flex-col md:flex-row flex-1 min-h-0 md:items-center px-3 md:px-0 overflow-y-auto md:overflow-y-hidden pt-10 md:pt-0 pb-4 md:pb-0 gap-3 md:gap-0">
        {/* ===== LEFT — Players ===== */}
        <div className="w-full md:w-60 shrink-0 bg-[#f0e6d0] pixel-border md:ml-3 flex flex-col md:h-[440px]">
          <div className="px-4 pt-3 pb-2">
            <h2 className="font-pixel text-[9px] text-gray-700">
              PLAYERS ({players.length}/{MAX_PLAYERS})
            </h2>
          </div>

          <div className="px-4 space-y-2 md:overflow-y-auto flex-1">
            {players.map((player, idx) => (
              <div key={idx} className="relative">
                <div className="flex items-center gap-2 bg-[#e8d8b8] px-2 py-1.5 border-2 border-black">
                  {/* Color swatch */}
                  <button
                    className="w-6 h-6 border-2 border-black cursor-pointer shrink-0 relative"
                    style={{ backgroundColor: PLAYER_COLOR_HEX[player.color] }}
                    onClick={() => { setColorPickerOpen(colorPickerOpen === idx ? null : idx); setStylePickerOpen(null) }}
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
                      onBlur={() => { setEditingNameIdx(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { setEditingNameIdx(null); } }}
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

                  {/* Building style */}
                  <button
                    className={`w-7 h-7 flex items-center justify-center border-2 shrink-0 ${stylePickerOpen === idx ? "border-amber-500 bg-amber-50" : "border-gray-400 hover:border-gray-600"}`}
                    onClick={() => { setStylePickerOpen(stylePickerOpen === idx ? null : idx); setColorPickerOpen(null) }}
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
                              <StylePreview style={s} type="settlement" color="#888" />
                              <StylePreview style={s} type="city" color="#888" />
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
            {players.length < MAX_PLAYERS && (
              <button
                onClick={addBot}
                className="w-full py-2 font-pixel text-[8px] pixel-btn bg-[#8BC34A] text-white hover:bg-[#7CB342]"
              >
                + ADD BOT
              </button>
            )}
            {expansionBoard && (
              <div className="mt-2 bg-amber-100 pixel-border-sm px-3 py-1.5 text-center">
                <span className="font-pixel text-[7px] text-amber-700">EXPANSION BOARD</span>
              </div>
            )}
          </div>
        </div>

        {/* ===== CENTER — Settings + Start ===== */}
        <div className="flex-1 flex flex-col min-w-0 px-3 md:px-6 py-4">
          <div className="flex-1 flex flex-col gap-3 justify-center max-w-xl mx-auto w-full">
            {/* Rules */}
            <div className="bg-[#f0e6d0] pixel-border p-4">
              <h2 className="font-pixel text-[9px] text-gray-700 mb-3 text-center">RULES</h2>
              <div className="flex justify-center gap-3 flex-wrap">
                <RuleCard label="FRIENDLY ROBBER" active={friendlyRobber} onClick={() => { playClick(); setFriendlyRobber(!friendlyRobber); }} icon="robber" tooltip="The robber can't target players with 2 or fewer victory points" />
                <RuleCard label="BALANCED DICE" active={fairDice} onClick={() => { playClick(); setFairDice(!fairDice); }} icon="dice" tooltip="Dice rolls follow a balanced distribution instead of pure random — each number appears roughly as often as expected" />
                <RuleCard label="DOUBLES ROLL AGAIN" active={doublesRollAgain} onClick={() => { playClick(); setDoublesRollAgain(!doublesRollAgain); }} icon="doubles" tooltip="Rolling doubles lets you take another turn after ending the current one" />
                <RuleCard label="SHEEP NUKE" active={sheepNuke} onClick={() => { playClick(); setSheepNuke(!sheepNuke); }} icon="nuke" tooltip="Spend 10 wool to roll dice and destroy all buildings & roads on hexes with that number. Roll a 7 to pick the number!" />
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

                {/* Expansion Board */}
                <div className="text-center col-span-2 flex flex-col items-center">
                  <span className="font-pixel text-[8px] text-gray-600 block mb-1">EXPANSION BOARD</span>
                  <ToggleButton value={expansionBoard} onChange={(v) => { playClick(); setExpansionBoard(v); }} />
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
                disabled={!connected || creating}
                className="flex-1 py-3 bg-[#4CAF50] text-white font-pixel text-[10px] pixel-btn disabled:opacity-50"
              >
                {creating ? "CREATING..." : connected ? "CREATE ROOM" : "CONNECTING..."}
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
                disabled={!connected || !joinCode.trim() || creating}
                className="px-4 py-2 bg-[#4CAF50] text-white font-pixel text-[9px] pixel-btn disabled:opacity-50"
              >
                JOIN
              </button>
            </div>
            {!connected && <p className="font-pixel text-[7px] text-white/50 text-center mt-1">Connecting to server...</p>}
          </div>
        </div>

        {/* ===== RIGHT — Chat (hidden on mobile) ===== */}
        <div className="hidden md:flex w-60 shrink-0 bg-[#f0e6d0] pixel-border mr-3 flex-col h-[440px]">
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

      {/* Fun facts ticker at the bottom (hidden on mobile) */}
      <div className="relative z-10 w-full py-2 overflow-hidden hidden md:block">
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

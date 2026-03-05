"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/app/hooks/useSocket";
import { useMultiplayerStore } from "@/app/stores/multiplayerStore";
import GameView from "@/app/components/game/GameView";
import { StylePreview, RuleCard } from "@/app/components/ui/LobbyComponents";
import VictoryOverlay from "@/app/components/ui/VictoryOverlay";
import {
  playDiceRoll, playBuild, playTrade, playTurnNotification,
  playRobber, playSteal, playEndTurn, playDevCard, playError,
  playChat, playWin, playCollect, playAchievement, playExplosion,
  startMusic, stopMusic,
} from "@/app/utils/sounds";
import type { Announcement } from "@/app/components/ui/AnnouncementOverlay";
import type { GameAction } from "@/shared/types/actions";
import type { Resource, GameLogEntry } from "@/shared/types/game";
import { PLAYER_COLORS } from "@/shared/types/game";
import type { ClientGameState, LobbyPlayer, LobbyConfig } from "@/shared/types/messages";
import type { BuildingStyle } from "@/shared/types/config";
import { BUILDING_STYLES, DEFAULT_BUILDING_STYLE, TURN_TIMER_OPTIONS, VP_OPTIONS } from "@/shared/types/config";
import { STYLE_DEFS } from "@/shared/buildingStyles";
import type { HexKey } from "@/shared/types/coordinates";
import { PLAYER_COLOR_HEX } from "@/shared/constants";
import CloudLayer from "@/app/components/ui/CloudLayer";
import { loadPreferences } from "@/app/utils/preferences";
import SettingsDropdown from "@/app/components/ui/SettingsDropdown";

export default function OnlineGamePage() {
  const router = useRouter();
  const { socket, connected } = useSocket();
  const mpStore = useMultiplayerStore();
  const {
    roomCode,
    playerIndex: myPlayerIndex,
    reconnectToken,
    lobbyPlayers,
    lobbyConfig,
    hostIndex,
    gameState,
    lastEvents,
    error,
    chatMessages,
  } = mpStore;

  // Visual state
  const [flashSeven, setFlashSeven] = useState(false);
  const [flashingHexes, setFlashingHexes] = useState<Set<HexKey>>(new Set());
  const [nukeFlashHexes, setNukeFlashHexes] = useState<Set<HexKey>>(new Set());
  const [screenShake, setScreenShake] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  // Keep music playing during online lobby, stop when game starts
  useEffect(() => {
    startMusic();
  }, []);
  useEffect(() => {
    if (gameState) stopMusic();
  }, [gameState]);

  // Lobby UI state
  const [colorPickerOpen, setColorPickerOpen] = useState<number | null>(null);
  const [stylePickerOpen, setStylePickerOpen] = useState<number | null>(null);
  const [lobbyChatInput, setLobbyChatInput] = useState("");
  const [editingBotNameIdx, setEditingBotNameIdx] = useState<number | null>(null);
  const [editingBotName, setEditingBotName] = useState("");
  const [editingMyName, setEditingMyName] = useState(false);
  const [myNameDraft, setMyNameDraft] = useState("");
  const colorPickerRef = useRef<HTMLDivElement>(null);

  const isHost = myPlayerIndex === hostIndex;

  // Close color picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) setColorPickerOpen(null);
    }
    if (colorPickerOpen !== null) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [colorPickerOpen]);

  // --- Socket event listeners ---
  // Use getState() in callbacks to avoid stale closures and prevent
  // listener detach/reattach when the store object changes
  useEffect(() => {
    if (!socket) return;
    const store = () => useMultiplayerStore.getState();
    const onJoined = ({ roomCode: code, playerIndex: idx, reconnectToken: token }: { roomCode: string; playerIndex: number; reconnectToken: string }) => store().setRoomJoined(code, idx, token);
    const onState = ({ state }: { state: ClientGameState }) => store().setGameState(state);
    const onEvents = ({ events }: { events: import("@/shared/types/actions").GameEvent[] }) => store().setEvents(events);
    const onError = ({ message }: { message: string }) => {
      if (message === "Room not found") { store().reset(); router.push("/"); return; }
      setLocalError(message); setTimeout(() => setLocalError(null), 3000);
    };
    const onLobby = (data: { players: LobbyPlayer[]; config: LobbyConfig; hostIndex: number }) => store().setLobbyState(data);
    const onChat = (msg: { playerIndex: number; playerName: string; text: string; timestamp: number }) => { store().addChatMessage(msg); playChat(); };
    const onSessionEnded = () => { store().reset(); router.push("/"); };

    socket.on("room:joined", onJoined);
    socket.on("game:state", onState);
    socket.on("game:events", onEvents);
    socket.on("game:error", onError);
    socket.on("room:lobby-state", onLobby);
    socket.on("chat:message", onChat);
    socket.on("room:session-ended", onSessionEnded);

    return () => {
      socket.off("room:joined", onJoined);
      socket.off("game:state", onState);
      socket.off("game:events", onEvents);
      socket.off("game:error", onError);
      socket.off("room:lobby-state", onLobby);
      socket.off("chat:message", onChat);
      socket.off("room:session-ended", onSessionEnded);
    };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  // If room was lost after being in one (e.g. session ended), go home
  const hasEverHadRoom = useRef(!!roomCode);
  useEffect(() => {
    if (roomCode) { hasEverHadRoom.current = true; return; }
    if (hasEverHadRoom.current) { router.push("/"); }
  }, [roomCode, router]);

  // Request lobby/game state on mount (the broadcast from room creation may have
  // been missed because this page's listeners weren't attached yet)
  useEffect(() => {
    if (!socket || !connected || !roomCode) return;
    socket.emit("room:request-state", {});
  }, [socket, connected, roomCode]);

  // Apply saved preferences (color, buildingStyle) on joining a room
  const prefsApplied = useRef(false);
  useEffect(() => {
    if (!socket || !connected || !roomCode || prefsApplied.current) return;
    const prefs = loadPreferences();
    if (!prefs) return;
    prefsApplied.current = true;
    if (prefs.color) socket.emit("room:update-player", { color: prefs.color });
    if (prefs.buildingStyle) socket.emit("room:update-player", { buildingStyle: prefs.buildingStyle });
  }, [socket, connected, roomCode]);

  // Reconnect after socket disconnect/reconnect (not on initial navigation from home page)
  const didMount = useRef(false);
  useEffect(() => {
    if (!socket || !connected || gameState || !roomCode || !reconnectToken) return;
    // Skip on first mount — we just navigated here from home page, socket is already in the room
    if (!didMount.current) { didMount.current = true; return; }
    // Socket reconnected (got a new ID) — rejoin the room
    socket.emit("room:join", { roomCode, playerName: "", reconnectToken });
  }, [socket, connected, roomCode, reconnectToken, gameState]);

  // --- Sound effects ---
  const prevPlayerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!gameState || myPlayerIndex === null) return;
    const prev = prevPlayerRef.current;
    prevPlayerRef.current = gameState.currentPlayerIndex;
    if (prev !== null && prev !== myPlayerIndex && gameState.currentPlayerIndex === myPlayerIndex && gameState.phase === "main") playTurnNotification();
  }, [gameState?.currentPlayerIndex, gameState?.phase, myPlayerIndex]);

  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase === "finished" && prevPhaseRef.current !== "finished") playWin();
    prevPhaseRef.current = gameState.phase;
  }, [gameState?.phase]);

  useEffect(() => { if (localError) playError(); }, [localError]);

  // --- Hex flash on dice roll ---
  useEffect(() => {
    if (!lastEvents || !gameState) return;
    const diceEvent = lastEvents.find((e) => e.type === "dice-rolled");
    if (diceEvent && gameState.lastDiceRoll) {
      const total = gameState.lastDiceRoll.die1 + gameState.lastDiceRoll.die2;
      if (total === 7) {
        setFlashSeven(true);
        setTimeout(() => setFlashSeven(false), 2000);
      } else {
        const producing = new Set<HexKey>();
        for (const [key, hex] of Object.entries(gameState.board.hexes)) {
          if (hex.number === total && !hex.hasRobber) producing.add(key);
        }
        if (producing.size > 0) { setFlashingHexes(producing); setTimeout(() => setFlashingHexes(new Set()), 1500); }
      }
    }
  }, [lastEvents, gameState]);

  // --- Event-based sounds ---
  useEffect(() => {
    if (!lastEvents || lastEvents.length === 0 || !gameState) return;
    for (const event of lastEvents) {
      switch (event.type) {
        case "dice-rolled": playDiceRoll(); break;
        case "settlement-built": case "city-built": case "road-built": playBuild(); break;
        case "trade-completed": playTrade(); break;
        case "robber-moved": playRobber(); break;
        case "resource-stolen": playSteal(); break;
        case "turn-ended": playEndTurn(); break;
        case "development-card-bought": case "knight-played": case "road-building-played":
        case "year-of-plenty-played": case "monopoly-played": playDevCard(); break;
        case "resources-distributed": playCollect(); break;
        case "sheep-nuke-destroyed": {
          const number = event.data?.number;
          if (number && gameState) {
            const nuked = new Set<HexKey>();
            for (const [key, hex] of Object.entries(gameState.board.hexes)) {
              if (hex.number === number) nuked.add(key);
            }
            if (nuked.size > 0) {
              setNukeFlashHexes(nuked);
              setTimeout(() => setNukeFlashHexes(new Set()), 1600);
            }
          }
          playExplosion();
          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 500);
          break;
        }
        case "largest-army-changed": case "longest-road-changed": {
          if (event.playerIndex !== null) {
            const p = gameState.players[event.playerIndex];
            setAnnouncement({
              playerName: p.name,
              playerColor: PLAYER_COLOR_HEX[p.color],
              type: event.type === "largest-army-changed" ? "largest-army" : "longest-road",
            });
            playAchievement();
          }
          break;
        }
      }
    }
  }, [lastEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Action dispatch ---
  const handleAction = useCallback((action: GameAction) => {
    if (!socket) return;
    setLocalError(null);
    socket.emit("game:action", { action });
  }, [socket]);

  const handleSendChat = useCallback((message: string) => {
    if (!socket) return;
    playChat();
    socket.emit("chat:message", { text: message });
  }, [socket]);

  // --- Lobby actions ---
  function handleAddBot() { socket?.emit("room:add-bot", { difficulty: "medium" }); }
  function handleRemoveBot(playerIndex: number) { socket?.emit("room:remove-bot", { playerIndex }); }
  function handleStartGameClick() { socket?.emit("room:start-game", {}); }
  function handleUpdateConfig(config: Partial<LobbyConfig>) { socket?.emit("room:update-config", { config }); }
  function handlePickColor(color: string) { socket?.emit("room:update-player", { color }); setColorPickerOpen(null); }
  function handleBotPickColor(playerIndex: number, color: string) { socket?.emit("room:update-bot", { playerIndex, color }); setColorPickerOpen(null); }
  function handleSaveBotName(playerIndex: number) { socket?.emit("room:update-bot", { playerIndex, name: editingBotName }); setEditingBotNameIdx(null); }
  function handlePickStyle(style: BuildingStyle) { socket?.emit("room:update-player", { buildingStyle: style }); setStylePickerOpen(null); }
  function handleUpdateName(name: string) { socket?.emit("room:update-player", { name }); }
  function handleLeaveGame() { socket?.emit("room:leave-game", {}); mpStore.reset(); router.push("/"); }
  function sendLobbyChat() {
    if (!socket || !lobbyChatInput.trim()) return;
    playChat(); socket.emit("chat:message", { text: lobbyChatInput.trim() }); setLobbyChatInput("");
  }

  // --- Render ---

  // Waiting for room data (store propagating from home page navigation)
  if (!roomCode || myPlayerIndex === null) {
    return (
      <div className="h-safe-screen flex items-center justify-center bg-[#2a6ab5] relative">
        <button
          onClick={() => router.push("/")}
          className="absolute top-4 left-4 z-20 font-pixel text-[9px] text-white/70 hover:text-white"
        >
          &larr; BACK
        </button>
        <div className="font-pixel text-[12px] text-[#8BC34A] animate-pulse">CONNECTING...</div>
      </div>
    );
  }

  // Lobby
  if (!gameState) {
    const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/join/${roomCode}` : "";
    const isExpansion = lobbyConfig?.expansionBoard ?? false;
    const usedColors = new Set(lobbyPlayers.map((p) => p.color));
    const myPlayer = lobbyPlayers.find((p) => p.index === myPlayerIndex);
    const timerIdx = lobbyConfig ? TURN_TIMER_OPTIONS.indexOf(lobbyConfig.turnTimer) : 0;
    const vpIdx = lobbyConfig ? (VP_OPTIONS as readonly number[]).indexOf(lobbyConfig.vpToWin) : 7;

    return (
      <div className="h-safe-screen flex flex-col bg-[#2a6ab5] overflow-hidden relative">
        <CloudLayer />
        <button
          onClick={handleLeaveGame}
          className="absolute top-4 left-4 z-20 font-pixel text-[9px] text-white/70 hover:text-white"
          title="Leave room"
        >
          &larr; LEAVE
        </button>

        <SettingsDropdown
          className="absolute top-4 right-4 z-20"
          onChange={(prefs) => {
            if (prefs.name !== undefined) socket?.emit("room:update-player", { name: prefs.name });
            if (prefs.color !== undefined) socket?.emit("room:update-player", { color: prefs.color });
            if (prefs.buildingStyle !== undefined) socket?.emit("room:update-player", { buildingStyle: prefs.buildingStyle });
          }}
        />

        {/* Room code header */}
        <div className="relative z-10 w-full pt-10 pb-2">
          <div className="flex items-center justify-center gap-2 md:gap-3 flex-wrap px-4">
            <span className="font-pixel text-[10px] text-white/70">ROOM CODE</span>
            <span className="font-pixel text-[20px] text-amber-300 tracking-[0.3em]" style={{ textShadow: "2px 2px 0 #000" }}>{roomCode}</span>
            <button onClick={() => navigator.clipboard.writeText(shareUrl)} className="px-3 py-1 bg-white/20 border-2 border-white/40 font-pixel text-[7px] text-white hover:bg-white/30 transition-colors" title="Copy invite link">COPY LINK</button>
          </div>
        </div>

        {/* Main layout: 3-column on desktop, vertical scroll on mobile */}
        <div className="relative z-10 flex flex-col md:flex-row flex-1 min-h-0 md:items-center px-3 md:px-0 overflow-y-auto md:overflow-y-hidden pb-4 md:pb-0 gap-3 md:gap-0">
          {/* LEFT — Players */}
          <div className="w-full md:w-60 shrink-0 bg-[#f0e6d0] pixel-border md:ml-3 flex flex-col md:h-[440px]">
            <div className="px-4 pt-3 pb-2">
              <h2 className="font-pixel text-[9px] text-gray-700">PLAYERS ({lobbyPlayers.length}/8)</h2>
            </div>
            <div className="px-4 space-y-2 md:overflow-y-auto flex-1">
              {lobbyPlayers.map((player) => {
                const isMe = player.index === myPlayerIndex;
                const canEditBot = isHost && player.isBot;
                const canPickColor = isMe || canEditBot;
                return (
                  <div key={player.index} className="relative">
                    <div className="flex items-center gap-2 bg-[#e8d8b8] px-2 py-1.5 border-2 border-black">
                      <button
                        className={`w-6 h-6 border-2 border-black shrink-0 relative ${canPickColor ? "cursor-pointer" : "cursor-default"}`}
                        style={{ backgroundColor: PLAYER_COLOR_HEX[player.color] ?? "#888" }}
                        onClick={canPickColor ? () => { setColorPickerOpen(colorPickerOpen === player.index ? null : player.index); setStylePickerOpen(null); } : undefined}
                        title={`Color: ${player.color}`}
                      >
                        {canPickColor && <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold" style={{ color: ["white", "yellow"].includes(player.color) ? "#333" : "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>{colorPickerOpen === player.index ? "\u25B2" : "\u25BC"}</span>}
                      </button>
                      {/* Editable name — human player or host editing bot */}
                      {isMe && editingMyName ? (
                        <input
                          type="text"
                          value={myNameDraft}
                          onChange={(e) => setMyNameDraft(e.target.value)}
                          onBlur={() => { handleUpdateName(myNameDraft); setEditingMyName(false); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { handleUpdateName(myNameDraft); setEditingMyName(false); } }}
                          maxLength={20}
                          placeholder="Your name..."
                          className="flex-1 bg-white px-1 py-0.5 text-[8px] text-gray-800 border border-gray-400 focus:outline-none min-w-0 font-pixel"
                          autoFocus
                        />
                      ) : canEditBot && editingBotNameIdx === player.index ? (
                        <input
                          type="text"
                          value={editingBotName}
                          onChange={(e) => setEditingBotName(e.target.value)}
                          onBlur={() => handleSaveBotName(player.index)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleSaveBotName(player.index); }}
                          maxLength={20}
                          className="flex-1 bg-white px-1 py-0.5 text-[8px] text-gray-800 border border-gray-400 focus:outline-none min-w-0 font-pixel"
                          autoFocus
                        />
                      ) : (
                      <span
                        className={`flex-1 font-pixel text-[8px] text-gray-800 truncate ${(isMe || canEditBot) ? "cursor-pointer hover:text-amber-700" : ""}`}
                        onClick={isMe ? () => { setEditingMyName(true); setMyNameDraft(player.name); } : canEditBot ? () => { setEditingBotNameIdx(player.index); setEditingBotName(player.name); } : undefined}
                        title={isMe ? "Click to edit name" : undefined}
                      >
                        {player.name}
                        {player.isBot && <span className="text-gray-500 text-[6px] ml-1">(BOT)</span>}
                        {player.index === hostIndex && !player.isBot && <span className="text-amber-600 text-[6px] ml-1">HOST</span>}
                      </span>
                      )}
                      {isMe && (
                        <button
                          className={`w-7 h-7 flex items-center justify-center border-2 shrink-0 ${stylePickerOpen === player.index ? "border-amber-500 bg-amber-50" : "border-gray-400 hover:border-gray-600"}`}
                          onClick={() => { setStylePickerOpen(stylePickerOpen === player.index ? null : player.index); setColorPickerOpen(null); }}
                          title={`Style: ${STYLE_DEFS[player.buildingStyle as BuildingStyle ?? DEFAULT_BUILDING_STYLE].name}`}
                        >
                          <StylePreview style={(player.buildingStyle as BuildingStyle) ?? DEFAULT_BUILDING_STYLE} type="settlement" color={PLAYER_COLOR_HEX[player.color] ?? "#888"} />
                        </button>
                      )}
                      {isHost && player.isBot && (
                        <button className="w-4 h-4 font-pixel text-[9px] text-red-600 hover:text-red-800 shrink-0" onClick={() => handleRemoveBot(player.index)} title="Remove bot">X</button>
                      )}
                    </div>

                    {/* Color picker dropdown */}
                    {canPickColor && colorPickerOpen === player.index && (
                      <div ref={colorPickerRef} className="bg-[#f5edd5] border-2 border-t-0 border-black px-2 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {PLAYER_COLORS.map((c) => (
                            <button key={c} className={`relative flex items-center gap-1 px-1.5 py-0.5 border-2 transition-all ${player.color === c ? "border-gray-900 scale-105" : "border-gray-400 hover:border-gray-700 cursor-pointer hover:scale-105"}`} style={{ backgroundColor: `${PLAYER_COLOR_HEX[c]}25` }} onClick={() => canEditBot ? handleBotPickColor(player.index, c) : handlePickColor(c)}>
                              <span className="w-3 h-3 border border-black/30 shrink-0" style={{ backgroundColor: PLAYER_COLOR_HEX[c] }} />
                              <span className="font-pixel text-[5px] text-gray-700 uppercase">{c}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Style picker dropdown */}
                    {isMe && stylePickerOpen === player.index && (
                      <div className="absolute left-0 z-50 w-52 bg-[#f5edd5] border-2 border-t-0 border-black px-2 py-1.5">
                        <div className="grid grid-cols-2 gap-1">
                          {BUILDING_STYLES.map((s) => (
                            <button key={s} className={`flex flex-col items-center gap-0.5 px-1 py-1 border-2 transition-all ${((player.buildingStyle as BuildingStyle) ?? DEFAULT_BUILDING_STYLE) === s ? "border-amber-500 bg-amber-50 scale-105" : "border-gray-300 hover:border-gray-600 cursor-pointer hover:scale-105"}`} onClick={() => handlePickStyle(s)}>
                              <div className="flex gap-0.5">
                                <StylePreview style={s} type="settlement" color={PLAYER_COLOR_HEX[player.color] ?? "#888"} />
                                <StylePreview style={s} type="city" color={PLAYER_COLOR_HEX[player.color] ?? "#888"} />
                              </div>
                              <span className="font-pixel text-[5px] text-gray-700">{STYLE_DEFS[s].name.toUpperCase()}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-4 pb-3 pt-2">
              {isHost && lobbyPlayers.length < 8 && (
                <button onClick={handleAddBot} className="w-full py-2 font-pixel text-[8px] pixel-btn bg-[#8BC34A] text-white hover:bg-[#7CB342]">+ ADD BOT</button>
              )}
              {isExpansion && (
                <div className="mt-2 bg-amber-100 pixel-border-sm px-3 py-1.5 text-center">
                  <span className="font-pixel text-[7px] text-amber-700">EXPANSION BOARD</span>
                </div>
              )}
            </div>
          </div>

          {/* CENTER — Settings + Start */}
          <div className="flex-1 flex flex-col min-w-0 px-3 md:px-6 py-4">
            <div className="flex-1 flex flex-col gap-3 justify-center max-w-xl mx-auto w-full">
              <div className="bg-[#f0e6d0] pixel-border p-4">
                <h2 className="font-pixel text-[9px] text-gray-700 mb-3 text-center">RULES</h2>
                <div className="flex justify-center gap-3 flex-wrap">
                  <RuleCard label="FRIENDLY ROBBER" active={lobbyConfig?.friendlyRobber ?? false} onClick={isHost ? () => handleUpdateConfig({ friendlyRobber: !(lobbyConfig?.friendlyRobber) }) : undefined} icon="robber" disabled={!isHost} tooltip="The robber can't target players with 2 or fewer victory points" />
                  <RuleCard label="BALANCED DICE" active={lobbyConfig?.fairDice ?? false} onClick={isHost ? () => handleUpdateConfig({ fairDice: !(lobbyConfig?.fairDice) }) : undefined} icon="dice" disabled={!isHost} tooltip="Dice rolls follow a balanced distribution instead of pure random — each number appears roughly as often as expected" />
                  <RuleCard label="DOUBLES ROLL AGAIN" active={lobbyConfig?.doublesRollAgain ?? false} onClick={isHost ? () => handleUpdateConfig({ doublesRollAgain: !(lobbyConfig?.doublesRollAgain) }) : undefined} icon="doubles" disabled={!isHost} tooltip="Rolling doubles lets you take another turn after ending the current one" />
                  <RuleCard label="SHEEP NUKE" active={lobbyConfig?.sheepNuke ?? false} onClick={isHost ? () => handleUpdateConfig({ sheepNuke: !(lobbyConfig?.sheepNuke) }) : undefined} icon="nuke" disabled={!isHost} tooltip="Spend 10 wool to roll dice and destroy all buildings & roads on hexes with that number. Roll a 7 to pick the number!" />
                </div>
              </div>

              <div className="bg-[#f0e6d0] pixel-border p-4">
                <h2 className="font-pixel text-[9px] text-gray-700 mb-3 text-center">ADVANCED SETTINGS</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <span className="font-pixel text-[8px] text-gray-600 block mb-1">TURN TIMER</span>
                    {isHost ? (
                      <div className="flex items-center justify-center gap-2">
                        <button className="font-pixel text-[10px] text-gray-700 hover:text-gray-900 px-1" onClick={() => timerIdx > 0 && handleUpdateConfig({ turnTimer: TURN_TIMER_OPTIONS[timerIdx - 1] })}>&lt;</button>
                        <span className="font-pixel text-[9px] text-gray-800 w-10 text-center">{lobbyConfig?.turnTimer === 0 ? "OFF" : `${lobbyConfig?.turnTimer}s`}</span>
                        <button className="font-pixel text-[10px] text-gray-700 hover:text-gray-900 px-1" onClick={() => timerIdx < TURN_TIMER_OPTIONS.length - 1 && handleUpdateConfig({ turnTimer: TURN_TIMER_OPTIONS[timerIdx + 1] })}>&gt;</button>
                      </div>
                    ) : <span className="font-pixel text-[9px] text-gray-800">{lobbyConfig?.turnTimer === 0 ? "OFF" : `${lobbyConfig?.turnTimer}s`}</span>}
                  </div>
                  <div className="text-center">
                    <span className="font-pixel text-[8px] text-gray-600 block mb-1">POINTS TO WIN</span>
                    {isHost ? (
                      <div className="flex items-center justify-center gap-2">
                        <button className="font-pixel text-[10px] text-gray-700 hover:text-gray-900 px-1" onClick={() => vpIdx > 0 && handleUpdateConfig({ vpToWin: VP_OPTIONS[vpIdx - 1] })}>&lt;</button>
                        <span className="font-pixel text-[10px] text-amber-600 bg-amber-100 border border-amber-400 w-8 text-center py-0.5">{lobbyConfig?.vpToWin ?? 10}</span>
                        <button className="font-pixel text-[10px] text-gray-700 hover:text-gray-900 px-1" onClick={() => vpIdx < VP_OPTIONS.length - 1 && handleUpdateConfig({ vpToWin: VP_OPTIONS[vpIdx + 1] })}>&gt;</button>
                      </div>
                    ) : <span className="font-pixel text-[10px] text-amber-600">{lobbyConfig?.vpToWin ?? 10}</span>}
                  </div>
                  <div className="text-center">
                    <span className="font-pixel text-[8px] text-gray-600 block mb-1">EXPANSION BOARD</span>
                    {isHost ? (
                      <div className="flex items-center justify-center gap-2">
                        <button className={`px-3 py-1.5 font-pixel text-[8px] border-2 border-black border-r-0 ${!isExpansion ? "bg-gray-400 text-white" : "bg-[#e8d8b8] text-gray-500"}`} onClick={() => handleUpdateConfig({ expansionBoard: false })}>OFF</button>
                        <button className={`px-3 py-1.5 font-pixel text-[8px] border-2 border-black ${isExpansion ? "bg-amber-400 text-gray-900" : "bg-[#e8d8b8] text-gray-500"}`} onClick={() => handleUpdateConfig({ expansionBoard: true })}>ON</button>
                      </div>
                    ) : <span className="font-pixel text-[9px] text-gray-800">{isExpansion ? "ON" : "OFF"}</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Errors + Start at bottom */}
            <div className="max-w-xl mx-auto w-full pt-2">
              {(localError || error) && (
                <div className="bg-red-100 pixel-border-sm px-3 py-2 text-center mb-2">
                  <p className="font-pixel text-[8px] text-red-700">{localError || error}</p>
                </div>
              )}
              {isHost ? (
                <button onClick={handleStartGameClick} disabled={lobbyPlayers.length < 2} className="w-full py-4 bg-amber-400 text-gray-900 font-pixel text-[12px] pixel-btn disabled:opacity-50">START GAME</button>
              ) : (
                <div className="w-full py-4 text-center"><p className="font-pixel text-[10px] text-white/70 animate-pulse">WAITING FOR HOST TO START...</p></div>
              )}
              {!connected && <p className="font-pixel text-[7px] text-red-400 text-center animate-pulse mt-1">DISCONNECTED — RECONNECTING...</p>}
            </div>
          </div>

          {/* RIGHT — Chat (hidden on mobile) */}
          <div className="hidden md:flex w-60 shrink-0 bg-[#f0e6d0] pixel-border mr-3 flex-col h-[440px]">
            <div className="px-4 pt-3 pb-2">
              <h2 className="font-pixel text-[9px] text-gray-700 text-center">CHAT</h2>
            </div>
            <div className="mx-4 bg-[#e8d8b8] border-2 border-black p-2 overflow-y-auto game-log-scroll flex-1">
              {chatMessages.length === 0 ? (
                <p className="font-pixel text-[7px] text-gray-400 text-center mt-4">No messages yet...</p>
              ) : (
                <div className="space-y-1">
                  {chatMessages.map((msg, i) => (
                    <div key={i}><span className="font-pixel text-[7px] text-amber-700 font-bold">{msg.playerName}: </span><span className="font-pixel text-[7px] text-gray-700">{msg.text}</span></div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-1 px-4 py-3">
              <input type="text" value={lobbyChatInput} onChange={(e) => setLobbyChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendLobbyChat()} placeholder="Send a message..." className="flex-1 bg-white px-2 py-1 text-[9px] text-gray-800 border-2 border-black focus:outline-none min-w-0" />
              <button onClick={sendLobbyChat} className="px-2 py-1 bg-amber-400 border-2 border-black font-pixel text-[8px] hover:bg-amber-500">&gt;</button>
            </div>
          </div>
        </div>

        {/* Fun facts ticker at the bottom (hidden on mobile) */}
        <div className="relative z-10 w-full py-2 overflow-hidden hidden md:block">
          <div className="lobby-ticker whitespace-nowrap font-pixel text-[10px] text-amber-300/60">
            <span className="mx-8">A medieval knight&apos;s armor weighed about 50 pounds</span>
            <span className="mx-8">Wool was medieval Europe&apos;s most traded commodity</span>
            <span className="mx-8">The longest road in the Roman Empire stretched 3,700 miles</span>
            <span className="mx-8">Medieval bricks were often stamped with the maker&apos;s seal</span>
            <span className="mx-8">Iron ore was called &quot;the bones of the earth&quot; by Saxon miners</span>
            <span className="mx-8">A single grain harvest could feed a village for an entire winter</span>
            <span className="mx-8">Knights trained from age 7 as pages before earning their spurs</span>
            <span className="mx-8">Medieval lumber was so valuable that forests had armed guards</span>
            <span className="mx-8">A medieval knight&apos;s armor weighed about 50 pounds</span>
            <span className="mx-8">Wool was medieval Europe&apos;s most traded commodity</span>
            <span className="mx-8">The longest road in the Roman Empire stretched 3,700 miles</span>
            <span className="mx-8">Medieval bricks were often stamped with the maker&apos;s seal</span>
          </div>
        </div>
      </div>
    );
  }

  // Build playerColors
  const playerColors: Record<number, string> = {};
  for (const p of gameState.players) playerColors[p.index] = PLAYER_COLOR_HEX[p.color] ?? "#fff";

  // Chat log — merge game log + multiplayer chat
  const chatLog: GameLogEntry[] = [
    ...gameState.log,
    ...chatMessages.map((m) => ({ timestamp: m.timestamp, playerIndex: m.playerIndex, message: m.text, type: "chat" as const })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <>
      <GameView
        gameState={gameState}
        myPlayerIndex={myPlayerIndex}
        onAction={handleAction}
        playerColors={playerColors}
        buildingStyles={{}}
        chatLog={chatLog}
        onSendChat={handleSendChat}
        onMainMenu={handleLeaveGame}
        onLobby={handleLeaveGame}
        flashingHexes={flashingHexes}
        flashSeven={flashSeven}
        nukeFlashHexes={nukeFlashHexes}
        screenShake={screenShake}
        turnDeadline={gameState.turnDeadline}
        error={localError || error}
        connected={connected}
        announcement={announcement}
        onDismissAnnouncement={() => setAnnouncement(null)}
        onDiceAnimationStart={playDiceRoll}
      />
      {gameState.phase === "finished" && (
        <VictoryOverlay
          gameState={gameState}
          localPlayerIndex={myPlayerIndex}
          onMainMenu={() => { mpStore.reset(); router.push("/"); }}
        />
      )}
    </>
  );
}

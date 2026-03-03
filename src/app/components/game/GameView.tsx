"use client";

import { useEffect, useCallback, useState, useRef, forwardRef, useImperativeHandle } from "react";
import type { ReactNode } from "react";
import HexBoard from "@/app/components/board/HexBoard";
import PlayerPanel from "@/app/components/ui/PlayerPanel";
import DiceDisplay from "@/app/components/ui/DiceDisplay";
import ActionBar from "@/app/components/ui/ActionBar";
import TurnTimerDisplay from "@/app/components/ui/TurnTimerDisplay";
import ResourceSelector from "@/app/components/ui/ResourceSelector";
import ChatBox from "@/app/components/ui/ChatBox";
import { ResourceCard, ResourceIcon } from "@/app/components/icons/ResourceIcons";
import { SwordPixel, ScrollPixel, CrownPixel } from "@/app/components/icons/PixelIcons";
import { useHighlights } from "@/app/hooks/useHighlights";
import { useTradeUI } from "@/app/hooks/useTradeUI";
import { MiniCard, RESOURCE_LABELS, formatDevCard, formatDevCardShort, getStealTargets } from "./helpers";
import type { GameAction } from "@/shared/types/actions";
import type { GameState, GameLogEntry, Resource, DevelopmentCardType } from "@/shared/types/game";
import type { ClientGameState } from "@/shared/types/messages";
import type { BuildingStyle } from "@/shared/types/config";
import type { VertexKey, EdgeKey, HexKey } from "@/shared/types/coordinates";
import {
  ALL_RESOURCES, RESOURCE_COLORS, PLAYER_COLOR_HEX, BUILDING_COSTS,
  MAX_ROADS, MAX_SETTLEMENTS, MAX_CITIES,
  EXPANSION_MAX_ROADS, EXPANSION_MAX_SETTLEMENTS, EXPANSION_MAX_CITIES,
} from "@/shared/constants";
import { getMasterVolume, setMasterVolume } from "@/app/utils/sounds";

type AnyGameState = GameState | ClientGameState;

export interface GameViewHandle {
  closeTrade: () => void;
}

export interface GameViewProps {
  gameState: AnyGameState;
  myPlayerIndex: number;
  onAction: (action: GameAction) => void;
  playerColors: Record<number, string>;
  buildingStyles: Record<number, BuildingStyle>;

  // Chat
  chatLog: GameLogEntry[];
  onSendChat: (text: string) => void;

  // Navigation button (top corner)
  onLeave: () => void;
  leaveLabel: string;
  leaveClassName: string;

  // Visual effects (managed by parent)
  flashingHexes: Set<HexKey>;
  flashSeven: boolean;
  turnDeadline?: number | null;

  // Status indicators
  error?: string | null;
  botThinking?: boolean;
  connected?: boolean;

  // Hotseat: trade response overlay (rendered in place of trade strip)
  tradeOverlay?: ReactNode;
  showTradeOverlay?: boolean;

  // Hotseat: validate requesting against opponent resources
  onAddToRequesting?: (resource: Resource) => void;
}

function canAfford(resources: Record<Resource, number>, cost: Partial<Record<Resource, number>>): boolean {
  for (const [res, amount] of Object.entries(cost)) {
    if ((amount || 0) > resources[res as Resource]) return false;
  }
  return true;
}

const GameView = forwardRef<GameViewHandle, GameViewProps>(function GameView(props, ref) {
  const {
    gameState,
    myPlayerIndex,
    onAction,
    playerColors,
    buildingStyles,
    chatLog,
    onSendChat,
    onLeave,
    leaveLabel,
    leaveClassName,
    flashingHexes,
    flashSeven,
    turnDeadline,
    error,
    botThinking,
    connected,
    tradeOverlay,
    showTradeOverlay,
    onAddToRequesting,
  } = props;

  // --- Settings panel ---
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [volume, setVolume] = useState(getMasterVolume());
  const settingsRef = useRef<HTMLDivElement>(null);

  // Close settings on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [settingsOpen]);

  // --- Active action state ---
  const [activeAction, setActiveAction] = useState<string | null>(null);

  // --- Discard selection state (Fix 3: inline discard) ---
  const [discardSelection, setDiscardSelection] = useState<Record<Resource, number>>({
    brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0,
  });

  // --- Trade UI ---
  const myPlayer = gameState.players[myPlayerIndex];
  const trade = useTradeUI(
    myPlayerIndex,
    myPlayer.resources,
    myPlayer.portsAccess as Array<Resource | "any">,
  );

  // Expose closeTrade to parent via ref
  useImperativeHandle(ref, () => ({
    closeTrade: trade.closeTrade,
  }));

  // --- Resource change notifications ---
  const prevResourcesRef = useRef<Record<Resource, number> | null>(null);
  const [resourceNotifs, setResourceNotifs] = useState<Array<{ id: number; resource: Resource; delta: number }>>([]);
  const notifIdRef = useRef(0);

  useEffect(() => {
    const curr = myPlayer.resources as Record<Resource, number>;
    const prev = prevResourcesRef.current;
    prevResourcesRef.current = { ...curr };
    if (!prev) return;
    const notifs: Array<{ id: number; resource: Resource; delta: number }> = [];
    for (const res of ALL_RESOURCES) {
      const diff = curr[res] - prev[res];
      if (diff !== 0) {
        notifs.push({ id: ++notifIdRef.current, resource: res, delta: diff });
      }
    }
    if (notifs.length > 0) {
      setResourceNotifs((old) => [...old, ...notifs]);
      setTimeout(() => {
        setResourceNotifs((old) => old.filter((n) => !notifs.some((added) => added.id === n.id)));
      }, 1200);
    }
  }, [myPlayer.resources]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Expansion board limits ---
  const expansion = gameState.config?.expansionBoard ?? false;
  const maxRoads = expansion ? EXPANSION_MAX_ROADS : MAX_ROADS;
  const maxSettlements = expansion ? EXPANSION_MAX_SETTLEMENTS : MAX_SETTLEMENTS;
  const maxCities = expansion ? EXPANSION_MAX_CITIES : MAX_CITIES;

  // --- Computed values ---
  const isMyTurn = gameState.currentPlayerIndex === myPlayerIndex;
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const needsDiscard = gameState.turnPhase === "discard" &&
    gameState.discardingPlayers.includes(myPlayerIndex);
  const needsStealTarget = gameState.turnPhase === "robber-steal" && isMyTurn;
  const stealTargets = needsStealTarget
    ? getStealTargets(gameState.board, gameState.players, myPlayerIndex)
    : [];
  const canTradeOrBuild = gameState.phase === "main" && isMyTurn && gameState.turnPhase === "trade-or-build";

  // --- Highlights (Fix 2: pass resources for auto-build) ---
  const { highlightedVertices, highlightedEdges, highlightedHexes } = useHighlights(
    activeAction,
    gameState.board,
    gameState.phase,
    myPlayer.settlements,
    myPlayerIndex,
    myPlayer.resources,
    myPlayer.roads.length,
    myPlayer.cities.length,
    maxRoads,
    maxSettlements,
    maxCities,
  );

  // --- Auto-set active action for setup, special phases, and auto-build ---
  useEffect(() => {
    if (gameState.currentPlayerIndex !== myPlayerIndex) return;
    if (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse") {
      const isSettlement = gameState.setupPlacementsMade % 2 === 0;
      setActiveAction(isSettlement ? "setup-settlement" : "setup-road");
    } else if (gameState.turnPhase === "robber-place") {
      setActiveAction("move-robber");
    } else if (gameState.turnPhase === "road-building-1" || gameState.turnPhase === "road-building-2") {
      setActiveAction("build-road");
    } else if (gameState.phase === "main" && gameState.turnPhase === "trade-or-build") {
      // Auto-build: show all valid positions when no specific action is selected
      setActiveAction("auto-build");
    }
  }, [gameState.phase, gameState.turnPhase, gameState.setupPlacementsMade, gameState.currentPlayerIndex, myPlayerIndex]);

  // --- Reset trade mode on turn change ---
  useEffect(() => {
    trade.closeTrade();
  }, [gameState.currentPlayerIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Reset discard selection when discard phase ends ---
  useEffect(() => {
    if (!needsDiscard) {
      setDiscardSelection({ brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 });
    }
  }, [needsDiscard]);

  // --- Click handlers (Fix 2: auto-build support) ---
  const handleVertexClick = useCallback((vertex: VertexKey) => {
    if (activeAction === "setup-settlement" || activeAction === "build-settlement") {
      const actionType = gameState.phase === "main" ? "build-settlement" : "place-settlement";
      onAction({ type: actionType, playerIndex: myPlayerIndex, vertex } as GameAction);
    } else if (activeAction === "build-city") {
      onAction({ type: "build-city", playerIndex: myPlayerIndex, vertex });
    } else if (activeAction === "auto-build") {
      // Check if this vertex has player's own settlement → upgrade to city
      const building = gameState.board.vertices[vertex];
      if (building && building.playerIndex === myPlayerIndex && building.type === "settlement") {
        onAction({ type: "build-city", playerIndex: myPlayerIndex, vertex });
      } else if (!building) {
        onAction({ type: "build-settlement", playerIndex: myPlayerIndex, vertex });
      }
    }
  }, [gameState.phase, gameState.board.vertices, activeAction, onAction, myPlayerIndex]);

  const handleEdgeClick = useCallback((edge: EdgeKey) => {
    if (activeAction === "setup-road" || activeAction === "build-road") {
      const actionType = (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse")
        ? "place-road" : "build-road";
      onAction({ type: actionType, playerIndex: myPlayerIndex, edge } as GameAction);
    } else if (activeAction === "auto-build") {
      onAction({ type: "build-road", playerIndex: myPlayerIndex, edge } as GameAction);
    }
  }, [gameState.phase, activeAction, onAction, myPlayerIndex]);

  const handleHexClick = useCallback((hex: HexKey) => {
    if (activeAction === "move-robber") {
      onAction({ type: "move-robber", playerIndex: myPlayerIndex, hex });
    }
  }, [activeAction, onAction, myPlayerIndex]);

  const handleSetActiveAction = useCallback((action: string | null) => {
    if (action === "trade") {
      trade.setTradeMode(true);
      setActiveAction(null);
    } else if (action === null) {
      // When explicitly deselecting, go back to auto-build if in trade-or-build
      if (canTradeOrBuild) {
        setActiveAction("auto-build");
      } else {
        setActiveAction(null);
      }
    } else {
      setActiveAction(action);
      trade.closeTrade();
    }
  }, [trade, canTradeOrBuild]);

  // --- Simplified bank trade handler ---
  // Validates offering (all same resource, multiple of ratio) and requesting
  // (count matches, no overlap with giving resource), then fires one action per
  // unique requested resource.
  function handleBankTradeSimple() {
    const info = trade.getBankTradeInfo();
    if (!info || trade.requesting.length === 0) return;
    // Requesting must not include the giving resource
    if (trade.requesting.some((r) => r === info.giving)) return;
    // Requesting count must equal receivingCount
    if (trade.requesting.length !== info.receivingCount) return;

    // Group requesting by resource type
    const reqCounts: Partial<Record<Resource, number>> = {};
    for (const r of trade.requesting) reqCounts[r] = (reqCounts[r] || 0) + 1;

    // Fire one bank-trade per unique requested resource
    // Each action trades ratio cards for 1 of that resource
    for (const [res, count] of Object.entries(reqCounts) as [Resource, number][]) {
      for (let i = 0; i < count; i++) {
        onAction({
          type: "bank-trade",
          playerIndex: myPlayerIndex,
          giving: info.giving,
          givingCount: info.ratio,
          receiving: res,
        });
      }
    }
    trade.closeTrade();
  }

  // --- Player trade handler ---
  function handlePlayerTrade() {
    if (trade.offering.length === 0 || trade.requesting.length === 0) return;
    const offerMap: Partial<Record<Resource, number>> = {};
    for (const r of trade.offering) offerMap[r] = (offerMap[r] || 0) + 1;
    const requestMap: Partial<Record<Resource, number>> = {};
    for (const r of trade.requesting) requestMap[r] = (requestMap[r] || 0) + 1;
    onAction({
      type: "offer-trade",
      playerIndex: myPlayerIndex,
      offering: offerMap,
      requesting: requestMap,
      toPlayer: null,
    });
  }

  // --- Requesting resource (with optional hotseat validation override) ---
  function handleAddToRequesting(resource: Resource) {
    if (onAddToRequesting) {
      onAddToRequesting(resource);
    } else {
      trade.addToRequesting(resource);
    }
  }

  // --- Discard handlers (Fix 3) ---
  const totalResources = Object.values(myPlayer.resources).reduce((s, n) => s + n, 0);
  const discardAmount = Math.floor(totalResources / 2);
  const currentDiscardCount = Object.values(discardSelection).reduce((s, n) => s + n, 0);

  function handleDiscardClick(res: Resource) {
    if (!needsDiscard) return;
    if (discardSelection[res] < myPlayer.resources[res] && currentDiscardCount < discardAmount) {
      setDiscardSelection({ ...discardSelection, [res]: discardSelection[res] + 1 });
    } else if (discardSelection[res] > 0) {
      // Deselect
      setDiscardSelection({ ...discardSelection, [res]: discardSelection[res] - 1 });
    }
  }

  function handleDiscardConfirm() {
    if (currentDiscardCount !== discardAmount) return;
    const filtered = Object.fromEntries(
      Object.entries(discardSelection).filter(([, v]) => v > 0)
    ) as Partial<Record<Resource, number>>;
    onAction({
      type: "discard-resources",
      playerIndex: myPlayerIndex,
      resources: filtered,
    });
  }

  // Phase text
  let phaseText = "";
  if (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse") {
    if (isMyTurn) {
      const isSettlement = gameState.setupPlacementsMade % 2 === 0;
      phaseText = `PLACE ${isSettlement ? "SETTLEMENT" : "ROAD"}`;
    } else {
      phaseText = `${currentPlayer.name.toUpperCase()} PLACING...`;
    }
  } else if (isMyTurn) {
    switch (gameState.turnPhase) {
      case "roll": phaseText = "ROLL THE DICE"; break;
      case "discard": phaseText = "WAITING FOR DISCARDS..."; break;
      case "robber-place": phaseText = "MOVE THE ROBBER"; break;
      case "robber-steal": phaseText = "CHOOSE STEAL TARGET"; break;
      case "trade-or-build": phaseText = "TRADE OR BUILD"; break;
      case "road-building-1": phaseText = "PLACE ROAD 1/2"; break;
      case "road-building-2": phaseText = "PLACE ROAD 2/2"; break;
    }
  } else {
    phaseText = `${currentPlayer.name.toUpperCase()} THINKING...`;
  }

  const myResources = Object.entries(myPlayer.resources) as [Resource, number][];
  const opponents = gameState.players.filter((p) => p.index !== myPlayerIndex);

  // Bank resources: 19 total per type minus all players' holdings
  const bankResources = ALL_RESOURCES.map((res) => {
    const held = gameState.players.reduce((sum, p) => sum + p.resources[res], 0);
    return { resource: res, count: 19 - held };
  });

  const bankInfo = trade.tradeMode ? trade.getBankTradeInfo() : null;
  const showTradeStrip = trade.tradeMode && canTradeOrBuild && !showTradeOverlay;

  // Dev cards (optional in ClientPlayerState, always present in PlayerState)
  const myDevCards: DevelopmentCardType[] = myPlayer.developmentCards ?? [];
  const myNewDevCards: DevelopmentCardType[] = myPlayer.newDevelopmentCards ?? [];

  return (
    <div className="h-screen flex overflow-hidden bg-[#2a6ab5]">
      {/* Left column: board + trade strips + bottom bar */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Board */}
        <div className="flex-1 flex items-center justify-center p-1 min-h-0 min-w-0 overflow-hidden relative">
          <HexBoard
            board={gameState.board}
            size={50}
            highlightedVertices={highlightedVertices}
            highlightedEdges={highlightedEdges}
            highlightedHexes={highlightedHexes}
            flashingHexes={flashingHexes}
            flashSeven={flashSeven}
            playerColors={playerColors}
            buildingStyles={buildingStyles}
            onVertexClick={isMyTurn ? handleVertexClick : undefined}
            onEdgeClick={isMyTurn ? handleEdgeClick : undefined}
            onHexClick={isMyTurn ? handleHexClick : undefined}
          />

          {/* Settings gear */}
          <div className="absolute top-2 left-2 z-30" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="w-8 h-8 flex items-center justify-center bg-[#1a1a2e]/90 border-2 border-[#3a3a5e] text-gray-300 hover:text-white hover:bg-[#1a1a2e] transition-colors"
              title="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" shapeRendering="crispEdges">
                <rect x="6" y="0" width="4" height="2" />
                <rect x="6" y="14" width="4" height="2" />
                <rect x="0" y="6" width="2" height="4" />
                <rect x="14" y="6" width="2" height="4" />
                <rect x="2" y="2" width="2" height="2" />
                <rect x="12" y="2" width="2" height="2" />
                <rect x="2" y="12" width="2" height="2" />
                <rect x="12" y="12" width="2" height="2" />
                <rect x="4" y="4" width="8" height="8" />
                <rect x="6" y="6" width="4" height="4" fill="#1a1a2e" />
              </svg>
            </button>
            {settingsOpen && (
              <div className="mt-1 bg-[#1a1a2e]/95 border-2 border-[#3a3a5e] p-3 w-48" style={{ backdropFilter: "blur(4px)" }}>
                <div className="mb-3">
                  <label className="font-pixel text-[7px] text-gray-400 block mb-1">VOLUME</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={volume}
                      onChange={(e) => { const v = Number(e.target.value); setVolume(v); setMasterVolume(v); }}
                      className="flex-1 h-1 accent-amber-400"
                    />
                    <span className="font-pixel text-[7px] text-gray-300 w-6 text-right">{volume}</span>
                  </div>
                </div>
                <button
                  onClick={onLeave}
                  className="w-full py-1.5 bg-red-600/80 hover:bg-red-600 text-white font-pixel text-[7px] border-2 border-black transition-colors"
                >
                  {leaveLabel}
                </button>
              </div>
            )}
          </div>

          {/* Turn timer (top-right, always visible when active) */}
          {turnDeadline && (
            <div className="absolute top-2 right-2 z-30 bg-[#1a1a2e]/90 border-2 border-[#3a3a5e] px-3 py-1.5">
              <TurnTimerDisplay deadline={turnDeadline} />
            </div>
          )}

          {/* Floating overlays */}
          <div className="absolute bottom-2 right-2 left-2 flex items-end justify-between gap-2 pointer-events-none" style={{ zIndex: 20 }}>
            {/* Left side: trade panels */}
            <div className="flex flex-col gap-2">
              {showTradeStrip && (
                <div className="bg-black/95 border-2 border-[#3a3a5e] px-2 py-1.5 pointer-events-auto" style={{ backdropFilter: "blur(4px)" }}>
                  <div className="flex items-center gap-2">
                    {/* Offering section */}
                    <div className="flex items-center gap-1">
                      <span className="text-[7px] text-green-400">GIVE:</span>
                      {trade.offering.length === 0 ? (
                        <span className="text-[6px] text-gray-600">click cards</span>
                      ) : (
                        trade.offering.map((res, i) => (
                          <MiniCard key={`o-${i}`} resource={res} onClick={() => trade.removeFromOffering(i)} glow="green" />
                        ))
                      )}
                    </div>

                    {/* Swap icon */}
                    <span className="text-[10px] text-amber-400">&#8644;</span>

                    {/* Requesting section */}
                    <div className="flex items-center gap-1">
                      <span className="text-[7px] text-red-400">GET:</span>
                      {trade.requesting.length === 0 ? (
                        <span className="text-[6px] text-gray-600">click +</span>
                      ) : (
                        trade.requesting.map((res, i) => (
                          <MiniCard key={`r-${i}`} resource={res} onClick={() => trade.removeFromRequesting(i)} glow="red" />
                        ))
                      )}
                    </div>

                    {/* Request resource buttons */}
                    <div className="flex gap-0.5">
                      {ALL_RESOURCES.map((res) => (
                        <button
                          key={res}
                          onClick={() => handleAddToRequesting(res)}
                          className={`w-6 h-6 flex items-center justify-center border border-[#3a3a5e] hover:border-white transition-colors${trade.shakenResource === res ? " res-shake" : ""}`}
                          style={{ backgroundColor: RESOURCE_COLORS[res] }}
                          title={`Request ${RESOURCE_LABELS[res]}`}
                        >
                          <ResourceIcon resource={res} size={12} />
                        </button>
                      ))}
                    </div>

                    {/* Bank trade button: validates and executes immediately */}
                    {(() => {
                      const bankValid = bankInfo &&
                        trade.requesting.length > 0 &&
                        trade.requesting.length === bankInfo.receivingCount &&
                        !trade.requesting.some((r) => r === bankInfo.giving);
                      return bankInfo ? (
                        <button
                          onClick={bankValid ? handleBankTradeSimple : undefined}
                          disabled={!bankValid}
                          className={`px-2 py-1 text-[7px] pixel-btn ${
                            bankValid
                              ? "bg-amber-600 text-white"
                              : "bg-[#2a2a4e] text-gray-600 cursor-not-allowed"
                          }`}
                          title={bankValid
                            ? `Bank trade ${bankInfo.ratio}:1 — click to execute`
                            : `Select ${bankInfo.receivingCount} resource(s) to receive (${bankInfo.ratio}:1)`}
                        >
                          BANK {bankInfo.ratio}:1
                        </button>
                      ) : null;
                    })()}

                    {/* Offer to players */}
                    <button
                      onClick={handlePlayerTrade}
                      disabled={trade.offering.length === 0 || trade.requesting.length === 0}
                      className={`px-2 py-1 text-[7px] pixel-btn ${
                        trade.offering.length > 0 && trade.requesting.length > 0
                          ? "bg-green-600 text-white"
                          : "bg-[#2a2a4e] text-gray-600 cursor-not-allowed"
                      }`}
                    >
                      OFFER
                    </button>

                    {/* Close */}
                    <button
                      onClick={() => trade.closeTrade()}
                      className="px-1.5 py-1 text-[7px] text-gray-400 pixel-btn bg-[#2a2a4e] hover:bg-[#3a3a5e]"
                    >
                      X
                    </button>
                  </div>
                </div>
              )}

              {/* Trade response overlay slot (hotseat only) */}
              {showTradeOverlay && tradeOverlay}
            </div>

            {/* Dice */}
            {gameState.phase === "main" && (
              <div className="pointer-events-auto flex items-center gap-2">
                {gameState.turnPhase === "roll" && isMyTurn ? (
                  <DiceDisplay
                    roll={null}
                    canRoll={true}
                    onRoll={() => onAction({ type: "roll-dice", playerIndex: myPlayerIndex })}
                  />
                ) : gameState.lastDiceRoll ? (
                  <DiceDisplay roll={gameState.lastDiceRoll} canRoll={false} onRoll={() => {}} />
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="h-20 bg-[#2a5a4a] border-t-4 border-black flex items-center px-2 gap-2">
          {/* Resource cards */}
          <div className="flex items-end gap-0.5">
            {myResources
              .filter(([, count]) => count > 0)
              .map(([res, count]) => {
                const discardCount = discardSelection[res];
                const notifs = resourceNotifs.filter((n) => n.resource === res);
                return (
                  <div
                    key={res}
                    className={`relative ${needsDiscard || canTradeOrBuild ? "cursor-pointer" : ""}`}
                    onClick={needsDiscard ? () => handleDiscardClick(res) : (canTradeOrBuild ? () => trade.addToOffering(res) : undefined)}
                    title={needsDiscard ? `Click to discard ${RESOURCE_LABELS[res]}` : (canTradeOrBuild ? `Click to offer ${RESOURCE_LABELS[res]}` : undefined)}
                  >
                    <ResourceCard resource={res} count={count} />
                    {/* Discard overlay */}
                    {needsDiscard && discardCount > 0 && (
                      <div className="absolute inset-0 bg-red-600/40 border-2 border-red-500 flex items-center justify-center">
                        <span className="font-pixel text-[10px] text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">-{discardCount}</span>
                      </div>
                    )}
                    {/* Resource change floating badges */}
                    {notifs.map((n) => (
                      <span
                        key={n.id}
                        className={`absolute -top-1 left-1/2 -translate-x-1/2 font-pixel text-[10px] pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${
                          n.delta > 0 ? "text-green-400 anim-card-gain" : "text-red-400 anim-card-lose"
                        }`}
                      >
                        {n.delta > 0 ? `+${n.delta}` : n.delta}
                      </span>
                    ))}
                  </div>
                );
              })}

            {/* Existing dev cards (clickable to play) */}
            {myDevCards.map((card: DevelopmentCardType, i: number) => {
              const isPlayable = canTradeOrBuild && !myPlayer.hasPlayedDevCardThisTurn && card !== "victoryPoint";
              return (
                <button
                  key={`dev-${i}`}
                  className={`w-10 h-14 flex flex-col items-center justify-center border-2 border-black bg-purple-700 relative ${
                    isPlayable ? "cursor-pointer hover:bg-purple-600 hover:border-amber-400" : ""
                  }`}
                  title={formatDevCard(card) + (isPlayable ? " (click to play)" : card === "victoryPoint" ? "" : myPlayer.hasPlayedDevCardThisTurn ? " (already played one this turn)" : "")}
                  onClick={() => {
                    if (!isPlayable) return;
                    if (card === "knight") {
                      onAction({ type: "play-knight", playerIndex: myPlayerIndex });
                    } else if (card === "roadBuilding") {
                      onAction({ type: "play-road-building", playerIndex: myPlayerIndex });
                    } else if (card === "monopoly") {
                      setActiveAction("monopoly");
                    } else if (card === "yearOfPlenty") {
                      setActiveAction("year-of-plenty");
                    }
                  }}
                >
                  {card === "knight" ? (
                    <SwordPixel size={14} color="white" />
                  ) : card === "victoryPoint" ? (
                    <CrownPixel size={14} color="#fbbf24" />
                  ) : (
                    <ScrollPixel size={14} color="white" />
                  )}
                  <span className="text-[5px] text-purple-200">{formatDevCardShort(card)}</span>
                  {isPlayable && (
                    <span className="absolute -top-1 -right-1 bg-green-500 text-black text-[5px] px-0.5 border border-black leading-none py-0.5">
                      PLAY
                    </span>
                  )}
                </button>
              );
            })}

            {/* New dev cards (bought this turn) */}
            {myNewDevCards.map((card: DevelopmentCardType, i: number) => (
              <div
                key={`new-${i}`}
                className="w-10 h-14 flex flex-col items-center justify-center border-2 border-dashed border-purple-400 bg-purple-900/50 opacity-60 relative"
                title={`${formatDevCard(card)} (NEW - can't play until next turn)`}
              >
                {card === "knight" ? (
                  <SwordPixel size={14} color="#a78bfa" />
                ) : card === "victoryPoint" ? (
                  <CrownPixel size={14} color="#fbbf24" />
                ) : (
                  <ScrollPixel size={14} color="#a78bfa" />
                )}
                <span className="text-[5px] text-purple-300">{formatDevCardShort(card)}</span>
                <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[5px] px-0.5 border border-black leading-none py-0.5">
                  NEW
                </span>
              </div>
            ))}
          </div>

          {/* Steal target buttons */}
          {needsStealTarget && (
            <div className="flex gap-1.5 items-center ml-2">
              <span className="font-pixel text-[7px] text-white">STEAL:</span>
              {stealTargets.map((targetIdx) => (
                <button
                  key={targetIdx}
                  onClick={() => onAction({
                    type: "steal-resource",
                    playerIndex: myPlayerIndex,
                    targetPlayer: targetIdx,
                  })}
                  className="px-2 py-1 font-pixel text-[7px] pixel-btn bg-[#e8d8b8]"
                  style={{
                    color: PLAYER_COLOR_HEX[gameState.players[targetIdx].color],
                  }}
                >
                  {gameState.players[targetIdx].name.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {/* Status center */}
          <div className="flex-1 text-center">
            {needsDiscard ? (
              /* Fix 3: Inline discard status */
              <>
                <div className="font-pixel text-[9px] text-red-400">
                  DISCARD {currentDiscardCount}/{discardAmount}
                </div>
                <div className="font-pixel text-[6px] text-gray-400 mt-0.5">
                  Click cards to select
                </div>
                <button
                  onClick={handleDiscardConfirm}
                  disabled={currentDiscardCount !== discardAmount}
                  className={`mt-1 px-4 py-1 font-pixel text-[8px] ${
                    currentDiscardCount === discardAmount
                      ? "bg-red-600 text-white pixel-btn"
                      : "bg-gray-600 text-gray-400 cursor-not-allowed border-2 border-black"
                  }`}
                >
                  CONFIRM
                </button>
              </>
            ) : (
              <>
                <div className={`font-pixel text-[9px] ${isMyTurn ? "text-yellow-300" : "text-gray-400"}`}>
                  {isMyTurn ? "YOUR TURN" : `${currentPlayer.name.toUpperCase()}'S TURN`}
                </div>
                <div className="font-pixel text-[7px] text-gray-300 mt-0.5">
                  {phaseText}
                  {botThinking && !isMyTurn && (
                    <span className="animate-pulse ml-1">...</span>
                  )}
                </div>
                {error && <div className="font-pixel text-[7px] text-red-400 mt-0.5">{error}</div>}
                {connected === false && (
                  <div className="font-pixel text-[7px] text-red-400 mt-0.5 animate-pulse">RECONNECTING...</div>
                )}
              </>
            )}
          </div>

          {/* Action buttons */}
          {canTradeOrBuild && (
            <ActionBar
              gameState={gameState}
              localPlayerIndex={myPlayerIndex}
              onAction={onAction}
              activeAction={activeAction === "auto-build" ? null : activeAction}
              setActiveAction={handleSetActiveAction}
            />
          )}
        </div>
      </div>

      {/* Right sidebar */}
      <div className="w-72 flex flex-col bg-[#f0e6d0] border-l-4 border-black">
        <ChatBox
          log={chatLog}
          playerColors={gameState.players.map((p) => p.color)}
          playerNames={gameState.players.map((p) => p.name)}
          localPlayerIndex={myPlayerIndex}
          onSendChat={onSendChat}
        />

        {/* Bank resource row */}
        <div className="flex items-center justify-center gap-2 px-2 py-2 bg-white/90 border-t-2 border-gray-300">
          {bankResources.map(({ resource, count }) => (
            <div key={resource} className="flex flex-col items-center">
              <div
                className="w-8 h-8 flex items-center justify-center border-2 border-black"
                style={{ backgroundColor: RESOURCE_COLORS[resource], boxShadow: "1px 1px 0 #000" }}
              >
                <ResourceIcon resource={resource} size={16} color="white" />
              </div>
              <span className="text-[7px] text-gray-600 mt-0.5">{count}</span>
            </div>
          ))}
        </div>

        {/* Opponent panels */}
        <div className="space-y-0.5 px-1.5 py-1">
          {opponents.map((p) => (
            <PlayerPanel
              key={p.index}
              player={p}
              isCurrentTurn={p.index === gameState.currentPlayerIndex}
              isLocalPlayer={false}
            />
          ))}
        </div>

        {/* Local player panel */}
        <div className="px-1.5 pb-1.5">
          <PlayerPanel
            player={myPlayer}
            isCurrentTurn={isMyTurn}
            isLocalPlayer={true}
          />
        </div>
      </div>

      {/* Dialogs (Fix 3: DiscardDialog removed, handled inline) */}
      {activeAction === "monopoly" && (
        <ResourceSelector
          type="monopoly"
          playerIndex={myPlayerIndex}
          onAction={onAction}
          onClose={() => setActiveAction(null)}
        />
      )}

      {activeAction === "year-of-plenty" && (
        <ResourceSelector
          type="year-of-plenty"
          playerIndex={myPlayerIndex}
          onAction={onAction}
          onClose={() => setActiveAction(null)}
        />
      )}
    </div>
  );
});

export default GameView;

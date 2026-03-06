"use client";

import { useEffect, useCallback, useState, useRef, forwardRef, useImperativeHandle } from "react";
import type { ReactNode } from "react";
import HexBoard from "@/app/components/board/HexBoard";
import type { PendingPlacement } from "@/app/components/board/HexBoard";
import PlayerPanel from "@/app/components/ui/PlayerPanel";
import DiceDisplay from "@/app/components/ui/DiceDisplay";
import ActionBar from "@/app/components/ui/ActionBar";
import TurnTimerDisplay from "@/app/components/ui/TurnTimerDisplay";
import ResourceSelector from "@/app/components/ui/ResourceSelector";
import ChatBox from "@/app/components/ui/ChatBox";
import AnnouncementOverlay from "@/app/components/ui/AnnouncementOverlay";
import type { Announcement } from "@/app/components/ui/AnnouncementOverlay";
import { ResourceCard, ResourceIcon } from "@/app/components/icons/ResourceIcons";
import { HelmetPixel, ScrollPixel, CrownPixel, RoadBuildPixel, CornucopiaPixel, MonopolyPixel } from "@/app/components/icons/PixelIcons";
import { useHighlights } from "@/app/hooks/useHighlights";
import { useTradeUI } from "@/app/hooks/useTradeUI";
import { MiniCard, RESOURCE_LABELS, formatDevCard, formatDevCardShort, getStealTargets } from "./helpers";
import type { GameAction } from "@/shared/types/actions";
import type { GameState, GameLogEntry, Resource, DevelopmentCardType } from "@/shared/types/game";
import type { ClientGameState } from "@/shared/types/messages";
import type { BuildingStyle } from "@/shared/types/config";
import type { VertexKey, EdgeKey, HexKey } from "@/shared/types/coordinates";
import type { NukeExplosion } from "@/app/components/board/HexBoard";
import {
  ALL_RESOURCES, RESOURCE_COLORS, PLAYER_COLOR_HEX, BUILDING_COSTS,
  MAX_ROADS, MAX_SETTLEMENTS, MAX_CITIES,
  EXPANSION_MAX_ROADS, EXPANSION_MAX_SETTLEMENTS, EXPANSION_MAX_CITIES,
} from "@/shared/constants";
import { getMasterVolume, setMasterVolume, updateMusicVolume, playClick, playMenuOpen, playMenuClose, playConfirm } from "@/app/utils/sounds";

type AnyGameState = GameState | ClientGameState;

export interface GameViewHandle {
  closeTrade: () => void;
  resetTrade: () => void;
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

  // Navigation buttons (settings menu)
  onMainMenu: () => void;
  onLobby: () => void;
  onRestart?: () => void;

  // Visual effects (managed by parent)
  flashingHexes: Set<HexKey>;
  flashSeven: boolean;
  nukeFlashHexes?: Set<HexKey>;
  nukeExplosions?: NukeExplosion[];
  screenShake?: boolean;
  turnDeadline?: number | null;

  // Status indicators
  error?: string | null;
  botThinking?: boolean;
  connected?: boolean;

  // Hotseat: trade response overlay (rendered in place of trade strip)
  tradeOverlay?: ReactNode;
  showTradeOverlay?: boolean;

  // Hotseat: validate requesting against opponent resources (return false to block)
  onAddToRequesting?: (resource: Resource) => boolean;

  // Hotseat: check if any opponent has a given resource (used to hide OFFER button)
  canOpponentProvide?: (resource: Resource) => boolean;

  // Achievement announcements
  announcement?: Announcement | null;
  onDismissAnnouncement?: () => void;

  // Dice animation sound callback
  onDiceAnimationStart?: () => void;
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
    onMainMenu,
    onLobby,
    onRestart,
    flashingHexes,
    flashSeven,
    nukeFlashHexes,
    nukeExplosions,
    screenShake,
    turnDeadline,
    error,
    botThinking,
    connected,
    tradeOverlay,
    showTradeOverlay,
    onAddToRequesting,
    canOpponentProvide,
    announcement,
    onDismissAnnouncement,
    onDiceAnimationStart,
  } = props;

  // --- Menu panel ---
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"lobby" | "mainMenu" | "restart" | null>(null);
  const [volume, setVolume] = useState(getMasterVolume());
  const isOnline = connected !== undefined;

  // --- Mobile sidebar toggle ---
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // --- Active action state ---
  const [activeAction, setActiveAction] = useState<string | null>(null);

  // --- Pending placement confirmation ---
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);

  // --- Nuke picker minimize state ---
  const [nukePickerMinimized, setNukePickerMinimized] = useState(false);
  useEffect(() => {
    if (gameState.turnPhase === "sheep-nuke-pick") setNukePickerMinimized(false);
  }, [gameState.turnPhase]);

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

  // Expose closeTrade/resetTrade to parent via ref
  useImperativeHandle(ref, () => ({
    closeTrade: trade.closeTrade,
    resetTrade: trade.resetTrade,
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

  // --- Clear pending placement when action/turn changes ---
  useEffect(() => {
    setPendingPlacement(null);
  }, [activeAction, gameState.currentPlayerIndex]);

  // --- Escape key cancels pending placement ---
  useEffect(() => {
    if (!pendingPlacement) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingPlacement(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pendingPlacement]);

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

  // --- Click handlers with confirmation (click once to preview, click again to place) ---
  const handleVertexClick = useCallback((vertex: VertexKey) => {
    let placementType: PendingPlacement["type"] | null = null;

    if (activeAction === "setup-settlement" || activeAction === "build-settlement") {
      placementType = "settlement";
    } else if (activeAction === "build-city") {
      placementType = "city";
    } else if (activeAction === "auto-build") {
      const building = gameState.board.vertices[vertex];
      if (building && building.playerIndex === myPlayerIndex && building.type === "settlement") {
        placementType = "city";
      } else if (!building) {
        placementType = "settlement";
      }
    }

    if (!placementType) return;

    // Second click on same spot → confirm
    if (pendingPlacement && pendingPlacement.key === vertex && pendingPlacement.type === placementType) {
      setPendingPlacement(null);
      if (placementType === "settlement") {
        const actionType = gameState.phase === "main" ? "build-settlement" : "place-settlement";
        onAction({ type: actionType, playerIndex: myPlayerIndex, vertex } as GameAction);
      } else {
        onAction({ type: "build-city", playerIndex: myPlayerIndex, vertex });
      }
    } else {
      // First click → show preview
      setPendingPlacement({ type: placementType, key: vertex });
    }
  }, [gameState.phase, gameState.board.vertices, activeAction, onAction, myPlayerIndex, pendingPlacement]);

  const handleEdgeClick = useCallback((edge: EdgeKey) => {
    const isSetup = activeAction === "setup-road" || activeAction === "build-road";
    const isAuto = activeAction === "auto-build";
    if (!isSetup && !isAuto) return;

    // Second click on same spot → confirm
    if (pendingPlacement && pendingPlacement.key === edge && pendingPlacement.type === "road") {
      setPendingPlacement(null);
      const actionType = (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse")
        ? "place-road" : "build-road";
      onAction({ type: actionType, playerIndex: myPlayerIndex, edge } as GameAction);
    } else {
      // First click → show preview
      setPendingPlacement({ type: "road", key: edge });
    }
  }, [gameState.phase, activeAction, onAction, myPlayerIndex, pendingPlacement]);

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

  // --- Shake message for blocked trade resources ---
  const [tradeShakeMessage, setTradeShakeMessage] = useState<string | null>(null);
  const shakeMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Requesting resource (with optional hotseat validation guard) ---
  // Skip the guard for bank trades — the bank has unlimited resources
  function handleAddToRequesting(resource: Resource) {
    const isBankTrade = !!trade.getBankTradeInfo();
    if (!isBankTrade && onAddToRequesting && !onAddToRequesting(resource)) {
      // Trigger shake animation on the blocked resource button
      trade.setShakenResource(null);
      requestAnimationFrame(() => trade.setShakenResource(resource));
      setTimeout(() => trade.setShakenResource(null), 400);
      // Show brief "nobody has this" message
      if (shakeMessageTimerRef.current) clearTimeout(shakeMessageTimerRef.current);
      setTradeShakeMessage(`Nobody has ${RESOURCE_LABELS[resource]}`);
      shakeMessageTimerRef.current = setTimeout(() => setTradeShakeMessage(null), 1500);
      return;
    }
    trade.addToRequesting(resource);
  }

  // --- Discard handlers (Fix 3) ---
  const totalResources = Object.values(myPlayer.resources).reduce((s, n) => s + n, 0);
  const discardAmount = Math.floor(totalResources / 2);
  const currentDiscardCount = Object.values(discardSelection).reduce((s, n) => s + n, 0);

  function handleDiscardAdd(res: Resource) {
    if (!needsDiscard) return;
    if (discardSelection[res] < myPlayer.resources[res] && currentDiscardCount < discardAmount) {
      setDiscardSelection({ ...discardSelection, [res]: discardSelection[res] + 1 });
    }
  }

  function handleDiscardRemove(res: Resource) {
    if (!needsDiscard) return;
    if (discardSelection[res] > 0) {
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

  // Phase text — use turnNumber to deterministically pick variants (no Math.random flickering)
  const turnSeed = gameState.turnNumber ?? 0;
  function pickVariant(variants: string[]) {
    return variants[turnSeed % variants.length];
  }

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
      case "roll": phaseText = pickVariant(["ROLL THE DICE", "YOUR MOVE — ROLL!", "TIME TO ROLL!", "LET 'EM FLY!", "DICE ARE WAITING..."]); break;
      case "discard": phaseText = "WAITING FOR DISCARDS..."; break;
      case "robber-place": phaseText = pickVariant(["UNLEASH THE ROBBER!", "MOVE THE ROBBER", "DEPLOY THE BANDIT!", "WHERE SHALL CHAOS REIGN?"]); break;
      case "robber-steal": phaseText = pickVariant(["CHOOSE YOUR VICTIM", "PICK A POCKET", "ROB 'EM BLIND"]); break;
      case "trade-or-build": phaseText = pickVariant(["BUILD YOUR EMPIRE", "TRADE & BUILD", "MAKE YOUR MOVE", "WHAT'S THE PLAN?", "SHOW 'EM WHAT YOU GOT"]); break;
      case "road-building-1": phaseText = "PLACE ROAD 1/2"; break;
      case "road-building-2": phaseText = "PLACE ROAD 2/2"; break;
      case "sheep-nuke-pick": phaseText = pickVariant(["CHOOSE NUMBER TO DESTROY", "PICK YOUR TARGET!", "RAIN FIRE!"]); break;
    }
  } else {
    const name = currentPlayer.name.toUpperCase();
    switch (gameState.turnPhase) {
      case "roll": phaseText = pickVariant([`${name} IS ROLLING...`, `${name} GRABS THE DICE...`]); break;
      case "trade-or-build": phaseText = pickVariant([`${name} IS PLOTTING...`, `${name} IS SCHEMING...`, `${name} IS BUILDING...`]); break;
      case "robber-place": phaseText = pickVariant([`${name} MOVES THE ROBBER...`, `${name} UNLEASHES CHAOS...`]); break;
      case "robber-steal": phaseText = pickVariant([`${name} IS STEALING...`, `${name} PICKS A POCKET...`]); break;
      case "discard": phaseText = "WAITING FOR DISCARDS..."; break;
      default: phaseText = pickVariant([`${name} THINKING...`, `${name} IS UP...`]); break;
    }
  }

  const myResources = Object.entries(myPlayer.resources) as [Resource, number][];
  const totalCards = myResources.reduce((sum, [, count]) => sum + count, 0);
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
    <div className={`fixed inset-0 flex overflow-hidden bg-[#6b5840] ${screenShake ? "screen-shake" : ""}`}>
      {/* Left column: board + trade strips + bottom bar */}
      <div className="flex-1 flex flex-col min-w-0 relative" style={{ backgroundColor: "#6b5840" }}>
        {/* Board */}
        <div className="flex-1 flex items-center justify-center min-h-0 min-w-0 overflow-hidden relative bg-[#2a6ab5]">
          <HexBoard
            board={gameState.board}
            size={50}
            highlightedVertices={highlightedVertices}
            highlightedEdges={highlightedEdges}
            highlightedHexes={highlightedHexes}
            flashingHexes={flashingHexes}
            flashSeven={flashSeven}
            nukeFlashHexes={nukeFlashHexes}
            nukeExplosions={nukeExplosions}
            playerColors={playerColors}
            buildingStyles={buildingStyles}
            pendingPlacement={pendingPlacement}
            myPlayerIndex={myPlayerIndex}
            onVertexClick={isMyTurn ? handleVertexClick : undefined}
            onEdgeClick={isMyTurn ? handleEdgeClick : undefined}
            onHexClick={isMyTurn ? handleHexClick : undefined}
          />

          {/* Turn/phase status overlay */}
          <div className="absolute top-16 md:top-32 inset-x-0 md:inset-x-auto md:left-4 text-center md:text-left z-10 pointer-events-none" style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.9)) drop-shadow(0 0 14px rgba(0,0,0,0.7))" }}>
            {needsDiscard ? (
              <div className="font-pixel text-[14px] md:text-[18px] text-red-400">SELECT CARDS TO DISCARD</div>
            ) : (
              <>
                <div className={`font-pixel text-[18px] md:text-[28px] leading-none ${isMyTurn ? "text-yellow-300" : "text-gray-400"}`}>
                  {isMyTurn ? "YOUR TURN" : `${currentPlayer.name.toUpperCase()}'S TURN`}
                </div>
                <div className="font-pixel text-[12px] md:text-[16px] text-white/80 mt-1">
                  {phaseText}
                  {botThinking && !isMyTurn && (
                    <span className="animate-pulse ml-1">...</span>
                  )}
                </div>
                {error && <div className="font-pixel text-[10px] md:text-[14px] text-red-400 mt-1">{error}</div>}
                {connected === false && (
                  <div className="font-pixel text-[10px] md:text-[14px] text-red-400 mt-1 animate-pulse">RECONNECTING...</div>
                )}
              </>
            )}
          </div>

          {/* Menu button + audio controls */}
          <div className="absolute top-2 left-2 z-30 flex items-center gap-1">
            <button
              onClick={() => { playMenuOpen(); setMenuOpen(true); }}
              className="w-9 h-9 flex flex-col items-center justify-center gap-[3px] bg-[#f0e6d0]/90 hover:bg-[#f0e6d0] border-2 border-[#8b7355] transition-colors pixel-border-sm cursor-pointer"
              title="Menu"
            >
              <span className="block w-5 h-[3px] bg-[#5a4535] rounded-sm" />
              <span className="block w-5 h-[3px] bg-[#5a4535] rounded-sm" />
              <span className="block w-5 h-[3px] bg-[#5a4535] rounded-sm" />
            </button>
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
              {showTradeStrip && (() => {
                const bankValid = bankInfo &&
                  trade.requesting.length > 0 &&
                  trade.requesting.length === bankInfo.receivingCount &&
                  !trade.requesting.some((r) => r === bankInfo.giving);
                const offerReady = trade.offering.length > 0 && trade.requesting.length > 0;
                const showOffer = offerReady && (
                  !canOpponentProvide || trade.requesting.some((r) => canOpponentProvide(r))
                );
                return (
                <div className="bg-[#f0e6d0] border-2 border-[#8b7355] px-3 py-2.5 pointer-events-auto max-w-[calc(100vw-1rem)]" style={{ backdropFilter: "blur(4px)" }}>
                  <div className="flex flex-col gap-2">
                    {/* Resource selector buttons (top row) — adds to requesting */}
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex gap-1.5 justify-center">
                        {ALL_RESOURCES.map((res) => (
                          <button
                            key={res}
                            onClick={() => handleAddToRequesting(res)}
                            className={`w-8 h-8 flex items-center justify-center border-2 border-[#8b7355] hover:border-amber-500 hover:scale-110 transition-all${trade.shakenResource === res ? " res-shake" : ""}`}
                            style={{ backgroundColor: RESOURCE_COLORS[res] }}
                            title={`Request ${RESOURCE_LABELS[res]}`}
                          >
                          <ResourceIcon resource={res} size={16} />
                        </button>
                        ))}
                      </div>
                      {tradeShakeMessage && (
                        <span className="font-pixel text-[7px] text-red-600 animate-pulse">{tradeShakeMessage}</span>
                      )}
                    </div>

                    {/* Requesting row (what you want — top) */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[7px] text-red-700 font-bold uppercase tracking-wide">Want</span>
                      <div className="flex items-center gap-1 flex-wrap min-h-[36px] bg-[#e8dcc4] border border-[#c4b498] px-1.5 py-1">
                        {trade.requesting.length === 0 ? (
                          <span className="text-[7px] text-gray-400 italic">click resources above</span>
                        ) : (
                          trade.requesting.map((res, i) => (
                            <MiniCard key={`r-${i}`} resource={res} onClick={() => trade.removeFromRequesting(i)} glow="red" />
                          ))
                        )}
                      </div>
                    </div>

                    {/* Offering row (what you give — bottom) */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[7px] text-green-700 font-bold uppercase tracking-wide">Give</span>
                      <div className="flex items-center gap-1 flex-wrap min-h-[36px] bg-[#e8dcc4] border border-[#c4b498] px-1.5 py-1">
                        {trade.offering.length === 0 ? (
                          <span className="text-[7px] text-gray-400 italic">click your cards below</span>
                        ) : (
                          trade.offering.map((res, i) => (
                            <MiniCard key={`o-${i}`} resource={res} onClick={() => trade.removeFromOffering(i)} glow="green" />
                          ))
                        )}
                      </div>
                    </div>

                    {/* Action buttons row */}
                    <div className="flex gap-1.5 justify-end">
                      {bankInfo && (
                        <button
                          onClick={bankValid ? handleBankTradeSimple : undefined}
                          disabled={!bankValid}
                          className={`px-2.5 py-1 text-[8px] pixel-btn ${
                            bankValid
                              ? "bg-amber-600 text-white"
                              : "bg-[#d4c4a8] text-gray-500 cursor-not-allowed"
                          }`}
                          title={bankValid
                            ? `Bank trade ${bankInfo.ratio}:1 — click to execute`
                            : `Select ${bankInfo.receivingCount} resource(s) to receive (${bankInfo.ratio}:1)`}
                        >
                          BANK
                        </button>
                      )}

                      {showOffer && (
                        <button
                          onClick={handlePlayerTrade}
                          className="px-2.5 py-1 text-[8px] pixel-btn bg-green-600 text-white"
                        >
                          OFFER
                        </button>
                      )}

                      <button
                        onClick={() => trade.closeTrade()}
                        className="px-2 py-1 text-[8px] text-gray-600 pixel-btn bg-[#d4c4a8] hover:bg-[#c4b498]"
                      >
                        X
                      </button>
                    </div>
                  </div>
                </div>
                ); })()}

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
                    onAnimationStart={onDiceAnimationStart}
                  />
                ) : gameState.lastDiceRoll ? (
                  <DiceDisplay roll={gameState.lastDiceRoll} canRoll={false} onRoll={() => {}} onAnimationStart={onDiceAnimationStart} />
                ) : null}
              </div>
            )}
          </div>

          {/* Steal target buttons — floating bottom-left */}
          {needsStealTarget && (
            <div className="absolute bottom-3 left-3 right-3 md:right-auto z-20 flex flex-wrap items-center gap-2">
              <span className="font-pixel text-[10px] text-amber-300" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.9))" }}>STEAL FROM:</span>
              {stealTargets.map((targetIdx) => (
                <button
                  key={targetIdx}
                  onClick={() => onAction({
                    type: "steal-resource",
                    playerIndex: myPlayerIndex,
                    targetPlayer: targetIdx,
                  })}
                  className="px-4 py-2 font-pixel text-[10px] pixel-btn bg-[#e8d8b8] hover:bg-[#f0e6d0]"
                  style={{
                    color: PLAYER_COLOR_HEX[gameState.players[targetIdx].color],
                  }}
                >
                  {gameState.players[targetIdx].name.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Discard overlay — floats above the brick bar */}
        {needsDiscard && (
          <div className="flex-shrink-0 relative z-10 mx-2 mb-1 max-w-full md:max-w-[calc(100%-160px)]">
            <div className="flex items-center gap-2 bg-red-900/90 border-2 border-red-500 px-3 py-2" style={{ imageRendering: "pixelated", boxShadow: "3px 3px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000" }}>
              <span className="font-pixel text-[8px] text-red-300 shrink-0">
                DISCARD {currentDiscardCount}/{discardAmount}
              </span>
              <div className="flex items-center gap-0.5 flex-1 min-h-[36px]">
                {currentDiscardCount === 0 ? (
                  <span className="text-[6px] text-red-300/50">click cards below to select</span>
                ) : (
                  ALL_RESOURCES.flatMap((res) =>
                    Array.from({ length: discardSelection[res] }, (_, i) => (
                      <MiniCard key={`ds-${res}-${i}`} resource={res} onClick={() => handleDiscardRemove(res)} glow="red" />
                    ))
                  )
                )}
              </div>
              <button
                onClick={handleDiscardConfirm}
                disabled={currentDiscardCount !== discardAmount}
                className={`px-3 py-1.5 font-pixel text-[8px] shrink-0 ${
                  currentDiscardCount === discardAmount
                    ? "bg-red-600 text-white pixel-btn"
                    : "bg-gray-600 text-gray-400 cursor-not-allowed border-2 border-black"
                }`}
              >
                CONFIRM
              </button>
            </div>
          </div>
        )}

        {/* Bottom bar — cobblestone wall + safe area extension */}
        <div
          className="h-[4.5rem] md:h-20 flex-shrink-0 flex items-center px-2 gap-1 md:gap-2 relative overflow-x-auto"
          style={{
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            backgroundColor: "#6b5840",
            backgroundImage: `
              url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='32'%3E%3Crect width='64' height='32' fill='%236b5840'/%3E%3Crect x='1' y='1' width='30' height='14' rx='2' fill='%237a6850' stroke='%23433020' stroke-width='1'/%3E%3Crect x='33' y='1' width='30' height='14' rx='2' fill='%23705e48' stroke='%23433020' stroke-width='1'/%3E%3Crect x='17' y='17' width='30' height='14' rx='2' fill='%23756350' stroke='%23433020' stroke-width='1'/%3E%3Crect x='-15' y='17' width='30' height='14' rx='2' fill='%236e5c46' stroke='%23433020' stroke-width='1'/%3E%3Crect x='49' y='17' width='30' height='14' rx='2' fill='%23725f4a' stroke='%23433020' stroke-width='1'/%3E%3C/svg%3E")
            `,
            backgroundSize: "64px 32px",
            boxShadow: "inset 0 4px 6px rgba(0,0,0,0.5), 0 -2px 0 #2a1a0a",
          }}
        >
          {/* Resource cards row */}
          <div className="flex items-end gap-0.5">
            {myResources
              .filter(([, count]) => count > 0)
              .map(([res, count]) => {
                const remaining = needsDiscard ? count - discardSelection[res] : count;
                const notifs = resourceNotifs.filter((n) => n.resource === res);
                if (needsDiscard && remaining <= 0) return null;
                return (
                  <div
                    key={res}
                    className={`relative ${needsDiscard || canTradeOrBuild ? "cursor-pointer" : ""}`}
                    onClick={needsDiscard ? () => handleDiscardAdd(res) : (canTradeOrBuild ? () => trade.addToOffering(res) : undefined)}
                    title={needsDiscard ? `Click to discard ${RESOURCE_LABELS[res]}` : (canTradeOrBuild ? `Click to offer ${RESOURCE_LABELS[res]}` : undefined)}
                  >
                    <ResourceCard resource={res} count={remaining} />
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
              const canPlayDevCard = gameState.phase === "main" && isMyTurn &&
                (gameState.turnPhase === "trade-or-build" || gameState.turnPhase === "roll");
              const isPlayable = canPlayDevCard && !myPlayer.hasPlayedDevCardThisTurn && card !== "victoryPoint";
              return (
                <div key={`dev-${i}`} className="relative group">
                  <button
                    className={`w-10 h-14 flex flex-col items-center justify-center border-2 border-black bg-purple-700 relative ${
                      isPlayable ? "cursor-pointer hover:bg-purple-600 hover:border-amber-400" : ""
                    }`}
                    title={formatDevCard(card)}
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
                      <HelmetPixel size={14} color="white" />
                    ) : card === "victoryPoint" ? (
                      <CrownPixel size={14} color="#fbbf24" />
                    ) : card === "roadBuilding" ? (
                      <RoadBuildPixel size={14} color="white" />
                    ) : card === "yearOfPlenty" ? (
                      <CornucopiaPixel size={14} color="white" />
                    ) : card === "monopoly" ? (
                      <MonopolyPixel size={14} color="white" />
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
                  <div className="fixed bottom-20 left-2 hidden group-hover:block z-[9999] pointer-events-none">
                    <div className="bg-[#1a1a2e] border-2 border-purple-500 px-2 py-1 whitespace-nowrap" style={{ boxShadow: "2px 2px 0 #000" }}>
                      <span className="font-pixel text-[6px] text-purple-200">{formatDevCard(card)}</span>
                    </div>
                  </div>
                </div>
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
                  <HelmetPixel size={14} color="#a78bfa" />
                ) : card === "victoryPoint" ? (
                  <CrownPixel size={14} color="#fbbf24" />
                ) : card === "roadBuilding" ? (
                  <RoadBuildPixel size={14} color="#a78bfa" />
                ) : card === "yearOfPlenty" ? (
                  <CornucopiaPixel size={14} color="#a78bfa" />
                ) : card === "monopoly" ? (
                  <MonopolyPixel size={14} color="#a78bfa" />
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

          {/* Mobile total card count badge */}
          <div className="md:hidden shrink-0 flex items-center justify-center bg-[#433020] border-2 border-[#2a1a0a] rounded px-1.5 py-0.5 ml-1">
            <span className="font-pixel text-[8px] text-white">{totalCards}</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

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

      {/* Mobile sidebar toggle button */}
      <button
        onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        className="md:hidden fixed top-12 right-2 z-40 w-9 h-9 flex items-center justify-center bg-[#f0e6d0]/90 border-2 border-[#8b7355] pixel-border-sm"
        title="Toggle info panel"
      >
        <span className="font-pixel text-[8px] text-gray-700">{mobileSidebarOpen ? "X" : "i"}</span>
      </button>

      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40"
          style={{ zIndex: 25 }}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Right sidebar — slide-in drawer on mobile, fixed on desktop */}
      <div className={`
        fixed md:relative inset-y-0 right-0 z-30
        w-64 md:w-72 flex flex-col bg-[#f0e6d0] border-l-4 border-black
        transition-transform duration-200 ease-in-out
        ${mobileSidebarOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"}
      `}>
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

      {/* Achievement announcement */}
      {announcement && onDismissAnnouncement && (
        <AnnouncementOverlay announcement={announcement} onDismiss={onDismissAnnouncement} />
      )}

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

      {/* Sheep Nuke number picker — non-blocking bottom panel */}
      {gameState.turnPhase === "sheep-nuke-pick" && isMyTurn && (
        nukePickerMinimized ? (
          <button
            onClick={() => setNukePickerMinimized(false)}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 border-3 border-[#5a3e28] font-pixel text-[10px] text-red-700 animate-pulse"
            style={{
              backgroundColor: "#f0e6d0",
              boxShadow: "4px 4px 0 #000",
            }}
          >
            PICK NUMBER TO DESTROY
          </button>
        ) : (
          <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center pointer-events-none">
            {/* Tap-to-minimize backdrop — lets user see board */}
            <div
              className="absolute inset-0 bg-black/30 pointer-events-auto"
              onClick={() => setNukePickerMinimized(true)}
            />
            <div
              className="relative pointer-events-auto w-full max-w-sm mx-auto mb-0 border-t-4 border-x-4 border-[#5a3e28] rounded-t-lg p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              style={{
                backgroundColor: "#f0e6d0",
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='6' height='6' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='6' height='6' fill='%23f0e6d0'/%3E%3Crect x='0' y='0' width='3' height='3' fill='%23e8ddc4' opacity='0.4'/%3E%3Crect x='3' y='3' width='3' height='3' fill='%23e8ddc4' opacity='0.4'/%3E%3C/svg%3E")`,
                backgroundSize: "6px 6px",
                boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle / minimize hint */}
              <div
                className="flex justify-center mb-2 cursor-pointer"
                onClick={() => setNukePickerMinimized(true)}
              >
                <div className="w-10 h-1 bg-[#8b7355] rounded-full" />
              </div>
              <div className="text-center mb-2">
                <div className="font-pixel text-[10px] text-red-700">SHEEP NUKE — PICK A NUMBER</div>
                <div className="font-pixel text-[6px] text-gray-500 mt-0.5">Tap backdrop to see board</div>
              </div>
              <div className="grid grid-cols-5 gap-1.5 max-w-xs mx-auto">
                {[2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => onAction({ type: "sheep-nuke-pick", playerIndex: myPlayerIndex, number: n })}
                    className="w-11 h-11 flex items-center justify-center border-2 border-black font-pixel text-[13px] text-gray-900 pixel-btn bg-amber-400 hover:bg-red-500 hover:text-white transition-colors"
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {/* Game menu overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { playMenuClose(); setMenuOpen(false); setConfirmAction(null); }}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-80 border-4 border-[#5a3e28] p-6"
            style={{
              backgroundColor: "#f0e6d0",
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='6' height='6' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='6' height='6' fill='%23f0e6d0'/%3E%3Crect x='0' y='0' width='3' height='3' fill='%23e8ddc4' opacity='0.4'/%3E%3Crect x='3' y='3' width='3' height='3' fill='%23e8ddc4' opacity='0.4'/%3E%3C/svg%3E")`,
              backgroundSize: "6px 6px",
              boxShadow: "6px 6px 0 #000, inset 0 0 20px rgba(139,115,85,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Title */}
            <div className="text-center mb-5">
              <div className="font-pixel text-[16px] text-[#5a3e28]">MENU</div>
              <div className="mt-1 h-[2px] bg-[#8b7355] mx-8" />
            </div>

            {/* Volume */}
            <div className="mb-5">
              <label className="font-pixel text-[9px] text-[#5a3e28] block mb-2">VOLUME</label>
              <div className="flex items-center gap-3">
                <span className="font-pixel text-[9px] text-[#8b7355]">
                  {volume === 0 ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="#8b7355" shapeRendering="crispEdges"><rect x="1" y="4" width="3" height="6"/><rect x="4" y="2" width="2" height="10"/><rect x="6" y="0" width="2" height="14"/><rect x="10" y="3" width="1" height="2"/><rect x="11" y="5" width="1" height="4"/><rect x="10" y="9" width="1" height="2"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="#5a3e28" shapeRendering="crispEdges"><rect x="1" y="4" width="3" height="6"/><rect x="4" y="2" width="2" height="10"/><rect x="6" y="0" width="2" height="14"/><rect x="10" y="3" width="1" height="2"/><rect x="11" y="5" width="1" height="4"/><rect x="10" y="9" width="1" height="2"/></svg>
                  )}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => { const v = Number(e.target.value); setVolume(v); setMasterVolume(v); updateMusicVolume(); }}
                  className="flex-1 h-2 accent-[#8b7355] cursor-pointer"
                />
                <span className="font-pixel text-[9px] text-[#5a3e28] w-8 text-right">{volume}%</span>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { playMenuClose(); setMenuOpen(false); setConfirmAction(null); }}
                className="w-full py-2.5 bg-[#4a8c3f] hover:bg-[#5a9c4f] text-white font-pixel text-[10px] border-2 border-black transition-colors pixel-btn"
              >
                RESUME GAME
              </button>

              {!isOnline && onRestart && (
                confirmAction === "restart" ? (
                  <div className="bg-blue-100 border-2 border-blue-600 p-3">
                    <div className="font-pixel text-[8px] text-blue-800 text-center mb-2">
                      RESTART GAME?
                    </div>
                    <div className="text-[9px] text-blue-700 text-center mb-3">
                      Current game progress will be lost.
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { playClick(); setConfirmAction(null); }} className="flex-1 py-1.5 bg-[#d4c4a8] hover:bg-[#c4b498] text-[#5a3e28] font-pixel text-[8px] border-2 border-black pixel-btn">CANCEL</button>
                      <button onClick={() => { playConfirm(); setMenuOpen(false); setConfirmAction(null); onRestart(); }} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-pixel text-[8px] border-2 border-black pixel-btn">YES, RESTART</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { playClick(); setConfirmAction("restart"); }}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-pixel text-[10px] border-2 border-black transition-colors pixel-btn"
                  >
                    RESTART GAME
                  </button>
                )
              )}

              {isOnline ? (
                /* Online: single leave button */
                confirmAction === "lobby" ? (
                  <div className="bg-red-100 border-2 border-red-600 p-3">
                    <div className="font-pixel text-[8px] text-red-800 text-center mb-2">
                      LEAVE THIS GAME?
                    </div>
                    <div className="text-[9px] text-red-700 text-center mb-3">
                      Your slot will be replaced by a bot. You can rejoin if the game is still active.
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { playClick(); setConfirmAction(null); }} className="flex-1 py-1.5 bg-[#d4c4a8] hover:bg-[#c4b498] text-[#5a3e28] font-pixel text-[8px] border-2 border-black pixel-btn">CANCEL</button>
                      <button onClick={() => { playConfirm(); setMenuOpen(false); setConfirmAction(null); onMainMenu(); }} className="flex-1 py-1.5 bg-red-600 hover:bg-red-500 text-white font-pixel text-[8px] border-2 border-black pixel-btn">YES, LEAVE</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { playClick(); setConfirmAction("lobby"); }}
                    className="w-full py-2.5 bg-red-700 hover:bg-red-600 text-white font-pixel text-[10px] border-2 border-black transition-colors pixel-btn"
                  >
                    LEAVE GAME
                  </button>
                )
              ) : (
                /* Hotseat: lobby + main menu buttons */
                <>
                  {confirmAction === "lobby" ? (
                    <div className="bg-amber-100 border-2 border-amber-600 p-3">
                      <div className="font-pixel text-[8px] text-amber-800 text-center mb-2">
                        RETURN TO LOBBY?
                      </div>
                      <div className="text-[9px] text-amber-700 text-center mb-3">
                        Current game progress will be lost.
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { playClick(); setConfirmAction(null); }} className="flex-1 py-1.5 bg-[#d4c4a8] hover:bg-[#c4b498] text-[#5a3e28] font-pixel text-[8px] border-2 border-black pixel-btn">CANCEL</button>
                        <button onClick={() => { playConfirm(); setMenuOpen(false); setConfirmAction(null); onLobby(); }} className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-pixel text-[8px] border-2 border-black pixel-btn">YES, LEAVE</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { playClick(); setConfirmAction("lobby"); }}
                      className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-pixel text-[10px] border-2 border-black transition-colors pixel-btn"
                    >
                      EXIT TO LOBBY
                    </button>
                  )}

                  {confirmAction === "mainMenu" ? (
                    <div className="bg-red-100 border-2 border-red-600 p-3">
                      <div className="font-pixel text-[8px] text-red-800 text-center mb-2">
                        EXIT TO MAIN MENU?
                      </div>
                      <div className="text-[9px] text-red-700 text-center mb-3">
                        All game progress will be lost.
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { playClick(); setConfirmAction(null); }} className="flex-1 py-1.5 bg-[#d4c4a8] hover:bg-[#c4b498] text-[#5a3e28] font-pixel text-[8px] border-2 border-black pixel-btn">CANCEL</button>
                        <button onClick={() => { playConfirm(); setMenuOpen(false); setConfirmAction(null); onMainMenu(); }} className="flex-1 py-1.5 bg-red-600 hover:bg-red-500 text-white font-pixel text-[8px] border-2 border-black pixel-btn">YES, EXIT</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { playClick(); setConfirmAction("mainMenu"); }}
                      className="w-full py-2.5 bg-red-700 hover:bg-red-600 text-white font-pixel text-[10px] border-2 border-black transition-colors pixel-btn"
                    >
                      EXIT TO MAIN MENU
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Close X */}
            <button
              onClick={() => { playMenuClose(); setMenuOpen(false); setConfirmAction(null); }}
              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center text-[#8b7355] hover:text-[#5a3e28] font-pixel text-[12px] transition-colors"
            >
              X
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default GameView;

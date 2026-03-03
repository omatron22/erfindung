"use client";

import { useEffect, useCallback, useState, useRef, forwardRef, useImperativeHandle } from "react";
import type { ReactNode } from "react";
import HexBoard from "@/app/components/board/HexBoard";
import PlayerPanel from "@/app/components/ui/PlayerPanel";
import DiceDisplay from "@/app/components/ui/DiceDisplay";
import ActionBar from "@/app/components/ui/ActionBar";
import DiscardDialog from "@/app/components/ui/DiscardDialog";
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
import { ALL_RESOURCES, RESOURCE_COLORS, PLAYER_COLOR_HEX } from "@/shared/constants";

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

  // --- Active action state ---
  const [activeAction, setActiveAction] = useState<string | null>(null);

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

  // --- Highlights ---
  const { highlightedVertices, highlightedEdges, highlightedHexes } = useHighlights(
    activeAction,
    gameState.board,
    gameState.phase,
    myPlayer.settlements,
    myPlayerIndex,
  );

  // --- Auto-set active action for setup and special phases ---
  useEffect(() => {
    if (gameState.currentPlayerIndex !== myPlayerIndex) return;
    if (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse") {
      const isSettlement = gameState.setupPlacementsMade % 2 === 0;
      setActiveAction(isSettlement ? "setup-settlement" : "setup-road");
    } else if (gameState.turnPhase === "robber-place") {
      setActiveAction("move-robber");
    } else if (gameState.turnPhase === "road-building-1" || gameState.turnPhase === "road-building-2") {
      setActiveAction("build-road");
    }
  }, [gameState.phase, gameState.turnPhase, gameState.setupPlacementsMade, gameState.currentPlayerIndex, myPlayerIndex]);

  // --- Reset trade mode on turn change ---
  useEffect(() => {
    trade.closeTrade();
  }, [gameState.currentPlayerIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Click handlers ---
  const handleVertexClick = useCallback((vertex: VertexKey) => {
    if (activeAction === "setup-settlement" || activeAction === "build-settlement") {
      const actionType = gameState.phase === "main" ? "build-settlement" : "place-settlement";
      onAction({ type: actionType, playerIndex: myPlayerIndex, vertex } as GameAction);
    } else if (activeAction === "build-city") {
      onAction({ type: "build-city", playerIndex: myPlayerIndex, vertex });
    }
  }, [gameState.phase, activeAction, onAction, myPlayerIndex]);

  const handleEdgeClick = useCallback((edge: EdgeKey) => {
    if (activeAction === "setup-road" || activeAction === "build-road") {
      const actionType = (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse")
        ? "place-road" : "build-road";
      onAction({ type: actionType, playerIndex: myPlayerIndex, edge } as GameAction);
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
    } else {
      setActiveAction(action);
    }
  }, [trade]);

  // --- Bank trade handler ---
  function handleBankTrade(giving: Resource, receiving: Resource) {
    const bankInfo = trade.getBankTradeInfo();
    if (!bankInfo) return;
    if (myPlayer.resources[giving] < bankInfo.ratio * bankInfo.receivingCount) return;
    onAction({
      type: "bank-trade",
      playerIndex: myPlayerIndex,
      giving,
      givingCount: bankInfo.ratio * bankInfo.receivingCount,
      receiving,
    });
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

  // --- Computed values ---
  const isMyTurn = gameState.currentPlayerIndex === myPlayerIndex;
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const needsDiscard = gameState.turnPhase === "discard" &&
    gameState.discardingPlayers.includes(myPlayerIndex);
  const needsStealTarget = gameState.turnPhase === "robber-steal" && isMyTurn;
  const stealTargets = needsStealTarget
    ? getStealTargets(gameState.board, gameState.players, myPlayerIndex)
    : [];

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
  const canTradeOrBuild = gameState.phase === "main" && isMyTurn && gameState.turnPhase === "trade-or-build";
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

          {/* Navigation button */}
          <button
            onClick={onLeave}
            className={leaveClassName}
          >
            {leaveLabel}
          </button>

          {/* Floating overlays */}
          <div className="absolute bottom-2 right-2 left-2 flex items-end justify-between gap-2 pointer-events-none" style={{ zIndex: 20 }}>
            {/* Left side: trade panels */}
            <div className="flex flex-col gap-2">
              {showTradeStrip && (
                <div className="bg-[#1a1a2e]/95 border-2 border-[#3a3a5e] px-3 py-2 pointer-events-auto" style={{ backdropFilter: "blur(4px)" }}>
                  <div className="flex items-center gap-3">
                    {/* Offering section */}
                    <div className="flex items-center gap-1">
                      <span className="text-[7px] text-green-400 mr-1">OFFERING:</span>
                      {trade.offering.length === 0 ? (
                        <span className="text-[6px] text-gray-600">click cards below</span>
                      ) : (
                        trade.offering.map((res, i) => (
                          <MiniCard key={`o-${i}`} resource={res} onClick={() => trade.removeFromOffering(i)} glow="green" />
                        ))
                      )}
                    </div>

                    {/* Swap icon */}
                    <span className="text-[12px] text-amber-400">&#8644;</span>

                    {/* Requesting section */}
                    <div className="flex items-center gap-1">
                      <span className="text-[7px] text-red-400 mr-1">REQUESTING:</span>
                      {trade.requesting.length === 0 ? (
                        <span className="text-[6px] text-gray-600">click + buttons</span>
                      ) : (
                        trade.requesting.map((res, i) => (
                          <MiniCard key={`r-${i}`} resource={res} onClick={() => trade.removeFromRequesting(i)} glow="red" />
                        ))
                      )}
                    </div>

                    {/* Request resource buttons */}
                    <div className="flex gap-1">
                      {ALL_RESOURCES.map((res) => (
                        <button
                          key={res}
                          onClick={() => handleAddToRequesting(res)}
                          className={`w-7 h-7 flex items-center justify-center border border-[#3a3a5e] hover:border-white transition-colors${trade.shakenResource === res ? " res-shake" : ""}`}
                          style={{ backgroundColor: RESOURCE_COLORS[res] }}
                          title={`Request ${RESOURCE_LABELS[res]}`}
                        >
                          <ResourceIcon resource={res} size={14} />
                        </button>
                      ))}
                    </div>

                    {/* Bank trade button */}
                    {bankInfo ? (
                      <div className="flex items-center gap-1">
                        <span className="text-[6px] text-gray-400">{bankInfo.ratio}:1</span>
                        {ALL_RESOURCES.filter((r) => r !== bankInfo.giving).map((res) => (
                          <button
                            key={res}
                            onClick={() => handleBankTrade(bankInfo.giving, res)}
                            className="w-6 h-6 flex items-center justify-center border border-black hover:border-amber-400 relative"
                            style={{ backgroundColor: RESOURCE_COLORS[res] }}
                            title={`Bank: get ${bankInfo.receivingCount} ${RESOURCE_LABELS[res]}`}
                          >
                            <ResourceIcon resource={res} size={12} />
                            {bankInfo.receivingCount > 1 && (
                              <span className="absolute -top-1 -right-1 bg-amber-400 text-black text-[5px] font-pixel px-0.5 border border-black leading-tight">
                                x{bankInfo.receivingCount}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button
                        disabled
                        className="px-2 py-1 bg-[#2a2a4e] text-gray-600 text-[6px] border border-[#3a3a5e] cursor-not-allowed"
                      >
                        BANK
                      </button>
                    )}

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
                      onClick={trade.closeTrade}
                      className="px-2 py-1 text-[7px] text-gray-400 pixel-btn bg-[#2a2a4e] hover:bg-[#3a3a5e]"
                    >
                      X
                    </button>
                  </div>
                </div>
              )}

              {/* Trade response overlay slot (hotseat only) */}
              {showTradeOverlay && tradeOverlay}
            </div>

            {/* Dice + Timer */}
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
                <TurnTimerDisplay deadline={turnDeadline ?? null} />
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
              .map(([res, count]) => (
                <div
                  key={res}
                  className={canTradeOrBuild ? "cursor-pointer" : ""}
                  onClick={canTradeOrBuild ? () => trade.addToOffering(res) : undefined}
                  title={canTradeOrBuild ? `Click to offer ${RESOURCE_LABELS[res]}` : undefined}
                >
                  <ResourceCard resource={res} count={count} />
                </div>
              ))}

            {/* Existing dev cards */}
            {myDevCards.map((card: DevelopmentCardType, i: number) => (
              <div
                key={`dev-${i}`}
                className="w-10 h-14 flex flex-col items-center justify-center border-2 border-black bg-purple-700 relative"
                title={formatDevCard(card)}
              >
                {card === "knight" ? (
                  <SwordPixel size={14} color="white" />
                ) : card === "victoryPoint" ? (
                  <CrownPixel size={14} color="#fbbf24" />
                ) : (
                  <ScrollPixel size={14} color="white" />
                )}
                <span className="text-[5px] text-purple-200">{formatDevCardShort(card)}</span>
              </div>
            ))}

            {/* New dev cards (bought this turn) */}
            {myNewDevCards.map((card: DevelopmentCardType, i: number) => (
              <div
                key={`new-${i}`}
                className="w-10 h-14 flex flex-col items-center justify-center border-2 border-dashed border-purple-400 bg-purple-900/50 opacity-60 relative"
                title={`${formatDevCard(card)} (new - can't play yet)`}
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
          </div>

          {/* Action buttons */}
          {canTradeOrBuild && (
            <ActionBar
              gameState={gameState}
              localPlayerIndex={myPlayerIndex}
              onAction={onAction}
              activeAction={activeAction}
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

      {/* Dialogs */}
      {needsDiscard && (
        <DiscardDialog
          player={myPlayer}
          playerIndex={myPlayerIndex}
          onAction={onAction}
        />
      )}

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

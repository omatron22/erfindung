"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/app/stores/gameStore";
import GameView from "@/app/components/game/GameView";
import type { GameViewHandle } from "@/app/components/game/GameView";
import { VPIcon } from "@/app/components/icons/GameIcons";
import { RESOURCE_LABELS } from "@/app/components/game/helpers";
import {
  playDiceRoll, playBuild, playTrade, playTurnNotification,
  playRobber, playSteal, playEndTurn, playDevCard, playError,
  playChat, playSetup, playWin, playCollect, playClick,
} from "@/app/utils/sounds";
import type { GameAction } from "@/shared/types/actions";
import type { GameState, GameLogEntry, Resource } from "@/shared/types/game";
import type { HexKey } from "@/shared/types/coordinates";
import { PLAYER_COLOR_HEX } from "@/shared/constants";
import { applyAction } from "@/server/engine/gameEngine";
import { decideBotAction, decideBotTradeResponse, generateBotCounterOffer } from "@/server/bots/botController";

const HUMAN_PLAYER_INDEX = 0;
const BOT_DELAY_MS = 600;
const BOT_SETUP_DELAY_MS = 400;

interface PendingTradeUI {
  tradeState: GameState;
  tradeId: string;
  responses: Record<number, "pending" | "accepted" | "rejected">;
  counterOffers: Record<number, { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null>;
  resolved: boolean;
  acceptors: number[];
}

export default function GamePage() {
  const router = useRouter();
  const gameViewRef = useRef<GameViewHandle>(null);
  const {
    gameState,
    fullConfig,
    botIndices,
    error,
    botThinking,
    initGame,
    dispatch,
    setGameState,
    setBotThinking,
    clearError,
  } = useGameStore();

  const [flashSeven, setFlashSeven] = useState(false);
  const [flashingHexes, setFlashingHexes] = useState<Set<HexKey>>(new Set());
  const [pendingTradeUI, setPendingTradeUI] = useState<PendingTradeUI | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const botTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tradeTimersRef = useRef<NodeJS.Timeout[]>([]);

  // Initialize game
  useEffect(() => {
    if (!gameState) {
      const fullStored = sessionStorage.getItem("catan-game-config");
      const legacyStored = sessionStorage.getItem("catan-config");
      if (fullStored) {
        const fc = JSON.parse(fullStored);
        const lc = { playerName: fc.players[0]?.name ?? "You", botNames: fc.players.slice(1).map((p: { name: string }) => p.name) };
        initGame(lc, fc);
      } else if (legacyStored) {
        initGame(JSON.parse(legacyStored));
      } else {
        initGame({ playerName: "You", botNames: ["Alice", "Bob", "Carol"] });
      }
    }
  }, [gameState, initGame]);

  // === BOT AUTO-PLAY ===
  useEffect(() => {
    if (!gameState || gameState.phase === "finished" || gameState.phase === "waiting") return;
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }

    if (gameState.turnPhase === "discard") {
      const botDiscarder = gameState.discardingPlayers.find((pi) => botIndices.includes(pi));
      if (botDiscarder !== undefined) { scheduleBotAction(gameState, botDiscarder, BOT_DELAY_MS); }
      return;
    }

    const currentPlayer = gameState.currentPlayerIndex;
    if (botIndices.includes(currentPlayer)) {
      const delay = (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse")
        ? BOT_SETUP_DELAY_MS : BOT_DELAY_MS;
      scheduleBotAction(gameState, currentPlayer, delay);
    }
  }, [gameState, botIndices]); // eslint-disable-line react-hooks/exhaustive-deps

  function scheduleBotAction(state: GameState, botIndex: number, delay: number) {
    setBotThinking(true);
    botTimerRef.current = setTimeout(() => executeBotAction(state, botIndex), delay);
  }

  function playActionSound(actionType: string) {
    switch (actionType) {
      case "roll-dice": playDiceRoll(); break;
      case "build-road": case "build-settlement": case "build-city": playBuild(); break;
      case "place-settlement": case "place-road": playSetup(); break;
      case "bank-trade": case "offer-trade": playTrade(); break;
      case "move-robber": playRobber(); break;
      case "steal-resource": playSteal(); break;
      case "end-turn": playEndTurn(); break;
      case "buy-development-card": playDevCard(); break;
      case "play-knight": playRobber(); break;
      case "play-road-building": case "play-year-of-plenty": case "play-monopoly": playDevCard(); break;
      default: playClick(); break;
    }
  }

  function executeBotAction(state: GameState, botIndex: number) {
    const action = decideBotAction(state, botIndex);
    if (!action) { setBotThinking(false); return; }
    const result = applyAction(state, action);
    if (result.valid && result.newState) {
      playActionSound(action.type);
      setGameState(result.newState);
    } else {
      console.warn(`Bot ${botIndex} invalid action:`, action.type, result.error);
      if (action.type !== "end-turn" && state.currentPlayerIndex === botIndex && state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid && fallback.newState) setGameState(fallback.newState);
      }
    }
    setBotThinking(false);
  }

  useEffect(() => {
    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
      tradeTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  // === SAFETY: clear stuck trade UI ===
  useEffect(() => {
    if (!gameState?.pendingTrade && pendingTradeUI) {
      tradeTimersRef.current.forEach(clearTimeout);
      tradeTimersRef.current = [];
      setPendingTradeUI(null);
      gameViewRef.current?.closeTrade();
    }
  }, [gameState?.pendingTrade]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Turn timer (hotseat local) ---
  useEffect(() => {
    const timerSeconds = fullConfig?.turnTimer;
    if (!timerSeconds || !gameState || gameState.phase === "finished") {
      setTurnDeadline(null); return;
    }
    if (gameState.currentPlayerIndex !== HUMAN_PLAYER_INDEX || gameState.phase !== "main") {
      setTurnDeadline(null); return;
    }
    const deadline = Date.now() + timerSeconds * 1000;
    setTurnDeadline(deadline);
    const timeout = setTimeout(() => {
      handleAction({ type: "end-turn", playerIndex: HUMAN_PLAYER_INDEX });
    }, timerSeconds * 1000);
    return () => clearTimeout(timeout);
  }, [gameState?.currentPlayerIndex, gameState?.phase, fullConfig?.turnTimer]); // eslint-disable-line react-hooks/exhaustive-deps

  // === SOUND EFFECTS ===
  const prevPlayerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!gameState) return;
    const prev = prevPlayerRef.current;
    prevPlayerRef.current = gameState.currentPlayerIndex;
    if (prev !== null && prev !== HUMAN_PLAYER_INDEX && gameState.currentPlayerIndex === HUMAN_PLAYER_INDEX && gameState.phase === "main") {
      playTurnNotification();
    }
  }, [gameState?.currentPlayerIndex, gameState?.phase]);

  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase === "finished" && prevPhaseRef.current !== "finished") playWin();
    prevPhaseRef.current = gameState.phase;
  }, [gameState?.phase]);

  useEffect(() => { if (error) playError(); }, [error]);

  const prevResourceTotal = useRef<number | null>(null);
  useEffect(() => {
    if (!gameState) return;
    const total = Object.values(gameState.players[HUMAN_PLAYER_INDEX].resources).reduce((s, n) => s + n, 0);
    if (prevResourceTotal.current !== null && total > prevResourceTotal.current && gameState.phase === "main") playCollect();
    prevResourceTotal.current = total;
  }, [gameState?.players[HUMAN_PLAYER_INDEX]?.resources]); // eslint-disable-line react-hooks/exhaustive-deps

  // === TRADE ORCHESTRATION ===
  function startTradeOrchestration(tradeState: GameState) {
    const trade = tradeState.pendingTrade;
    if (!trade) return;

    const responses: Record<number, "pending" | "accepted" | "rejected"> = {};
    const counterOffers: Record<number, { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null> = {};
    for (const bi of botIndices) {
      if (trade.toPlayer === null || trade.toPlayer === bi) {
        responses[bi] = "pending";
        counterOffers[bi] = null;
      }
    }
    setPendingTradeUI({ tradeState, tradeId: trade.id, responses, counterOffers, resolved: false, acceptors: [] });

    const respondingBots = Object.keys(responses).map(Number);
    const decisions: Array<{ botIndex: number; decision: "accept" | "reject" }> = [];
    tradeTimersRef.current.forEach(clearTimeout);
    tradeTimersRef.current = [];

    respondingBots.forEach((bi, i) => {
      const delay = 1000 + i * 1200 + Math.random() * 800;
      const timer = setTimeout(() => {
        const decision = decideBotTradeResponse(tradeState, bi);
        decisions.push({ botIndex: bi, decision });

        let counter: { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null = null;
        if (decision === "reject") counter = generateBotCounterOffer(tradeState, bi);

        setPendingTradeUI((prev) => {
          if (!prev) return null;
          return { ...prev, responses: { ...prev.responses, [bi]: decision === "accept" ? "accepted" : "rejected" }, counterOffers: { ...prev.counterOffers, [bi]: counter } };
        });

        if (decisions.length === respondingBots.length) {
          setTimeout(() => {
            const acceptors = decisions.filter((d) => d.decision === "accept").map((d) => d.botIndex);
            let shouldAutoCancel = false;
            setPendingTradeUI((prev) => {
              if (!prev) return null;
              const hasCounters = decisions.some((d) => d.decision === "reject" && prev.counterOffers?.[d.botIndex] != null);
              if (acceptors.length === 0 && !hasCounters) shouldAutoCancel = true;
              return { ...prev, resolved: true, acceptors };
            });
            if (shouldAutoCancel) setTimeout(() => cancelPendingTrade(tradeState, trade.id), 800);
          }, 600);
        }
      }, delay);
      tradeTimersRef.current.push(timer);
    });
  }

  function cancelPendingTrade(tradeState: GameState, tradeId: string) {
    const result = applyAction(tradeState, { type: "cancel-trade", playerIndex: HUMAN_PLAYER_INDEX, tradeId });
    if (result.valid && result.newState) { playError(); setGameState(result.newState); }
    setPendingTradeUI(null);
    gameViewRef.current?.closeTrade();
  }

  function acceptTradeWith(botIndex: number) {
    if (!pendingTradeUI) return;
    const result = applyAction(pendingTradeUI.tradeState, { type: "accept-trade", playerIndex: botIndex, tradeId: pendingTradeUI.tradeId });
    if (result.valid && result.newState) { playTrade(); setGameState(result.newState); }
    setPendingTradeUI(null);
    gameViewRef.current?.closeTrade();
  }

  function declineAcceptor(botIndex: number) {
    setPendingTradeUI((prev) => {
      if (!prev) return null;
      const newAcceptors = prev.acceptors.filter((a) => a !== botIndex);
      const newCounters = { ...prev.counterOffers, [botIndex]: null };
      const hasCounters = Object.values(newCounters).some((c) => c != null);
      if (newAcceptors.length === 0 && !hasCounters) {
        setTimeout(() => cancelPendingTrade(prev.tradeState, prev.tradeId), 200);
        return null;
      }
      return { ...prev, acceptors: newAcceptors, counterOffers: newCounters };
    });
  }

  function acceptCounterOffer(botIndex: number) {
    if (!pendingTradeUI || !gameState) return;
    const counter = pendingTradeUI.counterOffers[botIndex];
    if (!counter) return;

    const cancelResult = applyAction(pendingTradeUI.tradeState, { type: "cancel-trade", playerIndex: HUMAN_PLAYER_INDEX, tradeId: pendingTradeUI.tradeId });
    if (!cancelResult.valid || !cancelResult.newState) { setPendingTradeUI(null); gameViewRef.current?.closeTrade(); return; }

    const offerResult = applyAction(cancelResult.newState, { type: "offer-trade", playerIndex: HUMAN_PLAYER_INDEX, offering: counter.requesting, requesting: counter.offering, toPlayer: botIndex });
    if (!offerResult.valid || !offerResult.newState || !offerResult.newState.pendingTrade) { setPendingTradeUI(null); gameViewRef.current?.closeTrade(); return; }

    const acceptResult = applyAction(offerResult.newState, { type: "accept-trade", playerIndex: botIndex, tradeId: offerResult.newState.pendingTrade.id });
    if (acceptResult.valid && acceptResult.newState) { playTrade(); setGameState(acceptResult.newState); }
    setPendingTradeUI(null);
    gameViewRef.current?.closeTrade();
  }

  function declineAllTrades() {
    if (!pendingTradeUI) return;
    cancelPendingTrade(pendingTradeUI.tradeState, pendingTradeUI.tradeId);
  }

  // === ACTION HANDLER ===
  const handleAction = useCallback((action: GameAction) => {
    clearError();
    const result = dispatch(action);

    if (action.type === "offer-trade" && result.valid && result.newState) {
      playTrade();
      startTradeOrchestration(result.newState);
      return;
    }

    if (action.type === "roll-dice" && result.valid && result.newState?.lastDiceRoll) {
      const total = result.newState.lastDiceRoll.die1 + result.newState.lastDiceRoll.die2;
      if (total === 7) {
        setFlashSeven(true);
        setTimeout(() => setFlashSeven(false), 2000);
      } else {
        const producing = new Set<HexKey>();
        for (const [key, hex] of Object.entries(result.newState.board.hexes)) {
          if (hex.number === total && !hex.hasRobber) producing.add(key);
        }
        if (producing.size > 0) {
          setFlashingHexes(producing);
          setTimeout(() => setFlashingHexes(new Set()), 1500);
        }
      }
    }

    playActionSound(action.type);
  }, [dispatch, clearError, gameState, botIndices]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSendChat = useCallback((message: string) => {
    if (!gameState) return;
    playChat();
    const entry: GameLogEntry = { timestamp: Date.now(), playerIndex: HUMAN_PLAYER_INDEX, message, type: "chat" };
    setGameState({ ...gameState, log: [...gameState.log, entry] });
  }, [gameState, setGameState]);

  // --- Hotseat: validate requesting against opponent resources ---
  const handleAddToRequesting = useCallback((resource: Resource) => {
    if (!gameState) return;
    // Access the GameView's trade state via the imperative handle isn't practical here,
    // so we let the GameView's hook handle the basic add and rely on the OFFER button
    // being disabled when the trade isn't viable
  }, [gameState]);

  // === RENDER ===
  if (!gameState) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#2a6ab5]">
        <div className="font-pixel text-[12px] text-[#8BC34A] animate-pulse">LOADING...</div>
      </div>
    );
  }

  if (gameState.phase === "finished") {
    const winner = gameState.players[gameState.winner!];
    const isHumanWinner = gameState.winner === HUMAN_PLAYER_INDEX;
    return (
      <div className="h-screen flex items-center justify-center bg-[#2a6ab5]">
        <div className="text-center bg-[#f0e6d0] pixel-border p-10 max-w-md">
          <div className="flex justify-center mb-4">
            <VPIcon size={48} color={isHumanWinner ? "#d97706" : "#ef4444"} />
          </div>
          <h2 className={`font-pixel text-[16px] mb-3 ${isHumanWinner ? "text-amber-600" : "text-red-500"}`}>
            {isHumanWinner ? "YOU WIN!" : `${winner.name.toUpperCase()} WINS!`}
          </h2>
          <p className="text-gray-600 mb-6 text-sm">
            {winner.victoryPoints + winner.hiddenVictoryPoints} victory points
          </p>
          <button
            onClick={() => {
              const fullStored = sessionStorage.getItem("catan-game-config");
              const legacyStored = sessionStorage.getItem("catan-config");
              if (fullStored) {
                const fc = JSON.parse(fullStored);
                const lc = { playerName: fc.players[0]?.name ?? "You", botNames: fc.players.slice(1).map((p: { name: string }) => p.name) };
                initGame(lc, fc);
              } else if (legacyStored) {
                initGame(JSON.parse(legacyStored));
              }
            }}
            className="px-8 py-3 bg-amber-400 text-gray-900 font-pixel text-[10px] pixel-btn"
          >
            PLAY AGAIN
          </button>
        </div>
      </div>
    );
  }

  // Build playerColors and buildingStyles
  const playerColors: Record<number, string> = {};
  const boardBuildingStyles: Record<number, import("@/shared/types/config").BuildingStyle> = {};
  for (const p of gameState.players) {
    playerColors[p.index] = PLAYER_COLOR_HEX[p.color] ?? "#fff";
  }
  if (fullConfig?.players) {
    for (let i = 0; i < fullConfig.players.length; i++) {
      if (fullConfig.players[i].buildingStyle) {
        boardBuildingStyles[i] = fullConfig.players[i].buildingStyle!;
      }
    }
  }

  // Trade response overlay (hotseat-only)
  const tradeOverlayNode = pendingTradeUI && gameState.pendingTrade ? (
    <div className="bg-[#1a1a2e]/95 border-2 border-amber-500/50 px-3 py-2 pointer-events-auto" style={{ backdropFilter: "blur(4px)" }}>
      <div className="flex items-center gap-3">
        <span className="text-[8px] text-amber-400">
          {pendingTradeUI.resolved ? "CHOOSE:" : "WAITING..."}
        </span>
        <div className="flex gap-2">
          {Object.entries(pendingTradeUI.responses).map(([idxStr, status]) => {
            const idx = Number(idxStr);
            const p = gameState.players[idx];
            const color = PLAYER_COLOR_HEX[p.color];
            const isAcceptor = pendingTradeUI.resolved && pendingTradeUI.acceptors.includes(idx);
            const counter = pendingTradeUI.counterOffers[idx];

            return (
              <div key={idx} className="flex items-center gap-1.5 px-2 py-1 bg-[#0d0d1a] border border-[#3a3a5e]">
                <span className="text-[8px] font-bold" style={{ color }}>{p.name.toUpperCase()}</span>
                {status === "pending" && <span className="text-[7px] text-gray-400 animate-pulse">...</span>}
                {status === "rejected" && !counter && <span className="text-[7px] text-red-400">NO</span>}
                {status === "rejected" && counter && pendingTradeUI.resolved && (
                  <div className="flex items-center gap-1">
                    <span className="text-[6px] text-yellow-400">COUNTER:</span>
                    <div className="flex gap-0.5">
                      {Object.entries(counter.offering).map(([r, amt]) => (
                        <span key={r} className="text-[6px] text-green-300">{amt}{RESOURCE_LABELS[r as Resource]}</span>
                      ))}
                    </div>
                    <span className="text-[6px] text-gray-500">for</span>
                    <div className="flex gap-0.5">
                      {Object.entries(counter.requesting).map(([r, amt]) => (
                        <span key={r} className="text-[6px] text-red-300">{amt}{RESOURCE_LABELS[r as Resource]}</span>
                      ))}
                    </div>
                    <button onClick={() => acceptCounterOffer(idx)} className="px-1.5 py-0.5 bg-amber-500 text-black text-[6px] border border-black hover:bg-amber-400">ACCEPT</button>
                  </div>
                )}
                {isAcceptor && (
                  <div className="flex gap-1">
                    <button onClick={() => acceptTradeWith(idx)} className="px-2 py-0.5 bg-green-600 text-white text-[7px] border border-black hover:bg-green-500">TRADE</button>
                    <button onClick={() => declineAcceptor(idx)} className="px-2 py-0.5 bg-red-700 text-white text-[7px] border border-black hover:bg-red-600">DECLINE</button>
                  </div>
                )}
                {status === "accepted" && !pendingTradeUI.resolved && <span className="text-[7px] text-green-400">YES</span>}
              </div>
            );
          })}
        </div>
        {pendingTradeUI.resolved && (
          <button onClick={declineAllTrades} className="px-2 py-1 bg-red-800 text-white text-[7px] pixel-btn hover:bg-red-700">DECLINE ALL</button>
        )}
      </div>
    </div>
  ) : null;

  return (
    <GameView
      ref={gameViewRef}
      gameState={gameState}
      myPlayerIndex={HUMAN_PLAYER_INDEX}
      onAction={handleAction}
      playerColors={playerColors}
      buildingStyles={boardBuildingStyles}
      chatLog={gameState.log}
      onSendChat={handleSendChat}
      onLeave={() => router.push("/")}
      leaveLabel="MENU"
      leaveClassName="absolute top-2 right-2 z-30 px-3 py-1.5 bg-[#1a1a2e]/90 border-2 border-[#3a3a5e] font-pixel text-[8px] text-gray-300 hover:text-white hover:bg-[#1a1a2e]"
      flashingHexes={flashingHexes}
      flashSeven={flashSeven}
      turnDeadline={turnDeadline}
      error={error}
      botThinking={botThinking}
      tradeOverlay={tradeOverlayNode}
      showTradeOverlay={pendingTradeUI !== null}
    />
  );
}

"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/app/stores/gameStore";
import GameView from "@/app/components/game/GameView";
import type { GameViewHandle } from "@/app/components/game/GameView";
import VictoryOverlay from "@/app/components/ui/VictoryOverlay";
import { CheckPixel, XMarkPixel } from "@/app/components/icons/PixelIcons";
import { MiniCard, RESOURCE_LABELS } from "@/app/components/game/helpers";
import {
  playDiceRoll, playBuild, playTrade, playTurnNotification,
  playRobber, playSteal, playEndTurn, playDevCard, playError,
  playChat, playSetup, playWin, playCollect, playClick, playAchievement,
  playExplosion, stopMusic,
} from "@/app/utils/sounds";
import NukeSequenceOverlay from "@/app/components/ui/NukeSequenceOverlay";
import type { Announcement } from "@/app/components/ui/AnnouncementOverlay";
import type { GameAction, GameEvent } from "@/shared/types/actions";
import type { GameState, GameLogEntry, Resource, DiceRoll } from "@/shared/types/game";
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

interface BotTradeUI {
  tradeState: GameState;
  tradeId: string;
  initiatingBot: number;
  botResponses: Record<number, "pending" | "accepted" | "rejected">;
  resolved: boolean;
}

interface NukeSequenceState {
  diceResult: DiceRoll;
  resultState: GameState;
  events: GameEvent[];
  playerName: string;
  playerColor: string;
  isFreeNuke: boolean;
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
    resetGame,
  } = useGameStore();

  const [flashSeven, setFlashSeven] = useState(false);
  const [flashingHexes, setFlashingHexes] = useState<Set<HexKey>>(new Set());
  const [nukeFlashHexes, setNukeFlashHexes] = useState<Set<HexKey>>(new Set());
  const [screenShake, setScreenShake] = useState(false);
  const [pendingTradeUI, setPendingTradeUI] = useState<PendingTradeUI | null>(null);
  const [botTradeUI, setBotTradeUI] = useState<BotTradeUI | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [nukeSequence, setNukeSequence] = useState<NukeSequenceState | null>(null);
  const botTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tradeTimersRef = useRef<NodeJS.Timeout[]>([]);

  // Stop lobby music when game starts
  useEffect(() => { stopMusic(); }, []);

  // Initialize game — restore saved state on refresh, or create new game
  useEffect(() => {
    if (!gameState) {
      // Try to restore in-progress game from sessionStorage
      const savedState = sessionStorage.getItem("catan-game-state");
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState);
          // Re-init via initGame path to also set botIndices and fullConfig
          const fc = parsed.config;
          if (fc) {
            const lc = { playerName: fc.players[0]?.name ?? "You", botNames: fc.players.slice(1).map((p: { name: string }) => p.name) };
            initGame(lc, fc);
            // Overwrite the freshly created game with the saved state
            setGameState(parsed);
          } else {
            setGameState(parsed);
          }
          return;
        } catch {}
      }
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
  }, [gameState, initGame, setGameState]);

  // Save game state to sessionStorage on every change (for refresh persistence)
  useEffect(() => {
    if (gameState) {
      sessionStorage.setItem("catan-game-state", JSON.stringify(gameState));
    }
  }, [gameState]);

  // === BOT AUTO-PLAY ===
  useEffect(() => {
    if (!gameState || gameState.phase === "finished" || gameState.phase === "waiting") return;
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }

    // Don't auto-play while a bot trade is pending (waiting for human response)
    if (botTradeUI) return;

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
  }, [gameState, botIndices, botTradeUI]); // eslint-disable-line react-hooks/exhaustive-deps

  function scheduleBotAction(state: GameState, botIndex: number, delay: number) {
    setBotThinking(true);
    botTimerRef.current = setTimeout(() => executeBotAction(state, botIndex), delay);
  }

  function checkAchievementEvents(events: GameEvent[] | undefined, state: GameState) {
    if (!events) return;
    for (const event of events) {
      if (event.type === "largest-army-changed" && event.playerIndex !== null) {
        const p = state.players[event.playerIndex];
        setAnnouncement({ playerName: p.name, playerColor: PLAYER_COLOR_HEX[p.color], type: "largest-army" });
        playAchievement();
        return;
      }
      if (event.type === "longest-road-changed" && event.playerIndex !== null) {
        const p = state.players[event.playerIndex];
        setAnnouncement({ playerName: p.name, playerColor: PLAYER_COLOR_HEX[p.color], type: "longest-road" });
        playAchievement();
        return;
      }
    }
  }

  function triggerNukeEffects(events: GameEvent[], state: GameState) {
    const nukeEvent = events.find(e => e.type === "sheep-nuke-destroyed");
    if (!nukeEvent) return;
    const number = nukeEvent.data?.number;
    if (!number) return;

    // Find hexes with that number and flash them red
    const nukedHexes = new Set<HexKey>();
    for (const [key, hex] of Object.entries(state.board.hexes)) {
      if (hex.number === number) nukedHexes.add(key);
    }
    if (nukedHexes.size > 0) {
      setNukeFlashHexes(nukedHexes);
      setTimeout(() => setNukeFlashHexes(new Set()), 1600);
    }

    // Screen shake + explosion sound
    playExplosion();
    setScreenShake(true);
    setTimeout(() => setScreenShake(false), 500);
  }

  function playActionSound(actionType: string, isBot = false) {
    switch (actionType) {
      case "roll-dice": if (isBot) playDiceRoll(); break;
      case "build-road": case "build-settlement": case "build-city": playBuild(); break;
      case "place-settlement": case "place-road": playSetup(); break;
      case "bank-trade": case "offer-trade": playTrade(); break;
      case "move-robber": playRobber(); break;
      case "steal-resource": playSteal(); break;
      case "end-turn": playEndTurn(); break;
      case "buy-development-card": playDevCard(); break;
      case "play-knight": playRobber(); break;
      case "play-road-building": case "play-year-of-plenty": case "play-monopoly": playDevCard(); break;
      // Silent actions — no sound needed (nuke effects handled by triggerNukeEffects)
      case "sheep-nuke": case "sheep-nuke-pick":
      case "discard-resources": case "accept-trade":
      case "reject-trade": case "cancel-trade": case "select-monopoly-resource":
      case "select-year-of-plenty-resources": break;
      default: playClick(); break;
    }
  }

  function executeBotAction(state: GameState, botIndex: number) {
    const isSetup = state.phase === "setup-forward" || state.phase === "setup-reverse";

    // Use the latest game state to avoid stale-state issues
    const currentState = useGameStore.getState().gameState;
    if (currentState && currentState !== state) {
      // State changed since this action was scheduled — reschedule with fresh state
      if (currentState.currentPlayerIndex === botIndex) {
        scheduleBotAction(currentState, botIndex, BOT_SETUP_DELAY_MS);
      } else {
        setBotThinking(false);
      }
      return;
    }

    const action = decideBotAction(state, botIndex);
    if (!action) {
      console.warn(`Bot ${botIndex} returned no action (phase=${state.phase}, placements=${state.setupPlacementsMade})`);
      // During setup, retry after a short delay in case of transient issues
      if (isSetup && state.currentPlayerIndex === botIndex) {
        botTimerRef.current = setTimeout(() => executeBotAction(state, botIndex), BOT_DELAY_MS);
        return;
      }
      setBotThinking(false);
      return;
    }

    // Bot-initiated trade: show trade UI to human
    if (action.type === "offer-trade") {
      const result = applyAction(state, action);
      if (result.valid && result.newState && result.newState.pendingTrade) {
        playTrade();
        setGameState(result.newState);
        startBotTradeOrchestration(result.newState, botIndex);
        setBotThinking(false);
        return;
      }
      // Trade failed — continue bot's turn with another action
      setBotThinking(false);
      scheduleBotAction(state, botIndex, BOT_DELAY_MS);
      return;
    }

    const result = applyAction(state, action);
    if (result.valid && result.newState) {
      playActionSound(action.type, true);
      checkAchievementEvents(result.events, result.newState);
      // Flash hexes for bot dice rolls (same logic as human handleAction)
      if (action.type === "roll-dice" && result.newState.lastDiceRoll) {
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
      // Nuke effects for bot sheep-nuke
      if ((action.type === "sheep-nuke" || action.type === "sheep-nuke-pick") ) {
        triggerNukeEffects(result.events ?? [], result.newState);
      }
      setGameState(result.newState);
    } else {
      console.warn(`Bot ${botIndex} invalid action:`, action.type, result.error);
      if (isSetup && state.currentPlayerIndex === botIndex) {
        // Retry during setup — the bot may have picked a conflicting spot
        botTimerRef.current = setTimeout(() => executeBotAction(state, botIndex), BOT_DELAY_MS);
        return;
      }
      if (action.type !== "end-turn" && state.currentPlayerIndex === botIndex && state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid && fallback.newState) setGameState(fallback.newState);
      }
    }
    setBotThinking(false);
  }

  // === BOT-INITIATED TRADE ORCHESTRATION ===
  function startBotTradeOrchestration(tradeState: GameState, initiatingBot: number) {
    const trade = tradeState.pendingTrade;
    if (!trade) return;

    const botResponses: Record<number, "pending" | "accepted" | "rejected"> = {};
    // Other bots respond, human is asked via UI
    for (const bi of botIndices) {
      if (bi === initiatingBot) continue;
      if (trade.toPlayer === null || trade.toPlayer === bi) {
        botResponses[bi] = "pending";
      }
    }

    setBotTradeUI({ tradeState, tradeId: trade.id, initiatingBot, botResponses, resolved: false });

    // Schedule other bots to respond after a delay
    const respondingBots = Object.keys(botResponses).map(Number);
    tradeTimersRef.current.forEach(clearTimeout);
    tradeTimersRef.current = [];

    for (const bi of respondingBots) {
      const timer = setTimeout(() => {
        const decision = decideBotTradeResponse(tradeState, bi);
        setBotTradeUI((prev) => {
          if (!prev) return null;
          return { ...prev, botResponses: { ...prev.botResponses, [bi]: decision === "accept" ? "accepted" : "rejected" } };
        });
      }, 600);
      tradeTimersRef.current.push(timer);
    }

    // Auto-resolve after 8 seconds if human doesn't respond
    const autoTimer = setTimeout(() => {
      handleBotTradeReject();
    }, 8000);
    tradeTimersRef.current.push(autoTimer);
  }

  function canHumanAffordBotTrade(): boolean {
    if (!botTradeUI || !gameState) return false;
    const trade = botTradeUI.tradeState.pendingTrade;
    if (!trade) return false;
    const human = gameState.players[HUMAN_PLAYER_INDEX];
    for (const [res, amount] of Object.entries(trade.requesting)) {
      if ((amount || 0) > human.resources[res as Resource]) return false;
    }
    return true;
  }

  function handleBotTradeAccept() {
    if (!botTradeUI) return;
    const trade = botTradeUI.tradeState.pendingTrade;
    if (!trade) { setBotTradeUI(null); return; }

    // Validate human can afford to give the requested resources
    if (!canHumanAffordBotTrade()) {
      playError();
      handleBotTradeReject();
      return;
    }

    const result = applyAction(botTradeUI.tradeState, {
      type: "accept-trade",
      playerIndex: HUMAN_PLAYER_INDEX,
      tradeId: botTradeUI.tradeId,
    });
    if (result.valid && result.newState) {
      playTrade();
      setGameState(result.newState);
      const bot = botTradeUI.initiatingBot;
      setBotTradeUI(null);
      // Continue bot's turn after trade
      setTimeout(() => scheduleBotAction(result.newState!, bot, BOT_DELAY_MS), 400);
    } else {
      // Trade failed — cancel and continue bot's turn
      handleBotTradeReject();
    }
  }

  function handleBotTradeReject() {
    if (!botTradeUI) return;
    const trade = botTradeUI.tradeState.pendingTrade;
    if (!trade) { setBotTradeUI(null); return; }

    // Check if any other bot accepted — the initiating bot auto-picks the first acceptor
    const acceptingBot = Object.entries(botTradeUI.botResponses).find(([, s]) => s === "accepted");

    if (acceptingBot) {
      const acceptorIdx = Number(acceptingBot[0]);
      const result = applyAction(botTradeUI.tradeState, {
        type: "accept-trade",
        playerIndex: acceptorIdx,
        tradeId: botTradeUI.tradeId,
      });
      if (result.valid && result.newState) {
        playTrade();
        setGameState(result.newState);
        const bot = botTradeUI.initiatingBot;
        setBotTradeUI(null);
        setTimeout(() => scheduleBotAction(result.newState!, bot, BOT_DELAY_MS), 400);
        return;
      }
    }

    // No one accepted — cancel trade
    const cancelResult = applyAction(botTradeUI.tradeState, {
      type: "cancel-trade",
      playerIndex: botTradeUI.initiatingBot,
      tradeId: botTradeUI.tradeId,
    });
    if (cancelResult.valid && cancelResult.newState) {
      setGameState(cancelResult.newState);
      const bot = botTradeUI.initiatingBot;
      setBotTradeUI(null);
      // Continue bot's turn after failed trade
      setTimeout(() => scheduleBotAction(cancelResult.newState!, bot, BOT_DELAY_MS), 400);
    } else {
      setBotTradeUI(null);
    }
  }

  useEffect(() => {
    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
      tradeTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  // === SAFETY: clear stuck trade UI ===
  useEffect(() => {
    if (!gameState?.pendingTrade) {
      if (pendingTradeUI) {
        tradeTimersRef.current.forEach(clearTimeout);
        tradeTimersRef.current = [];
        setPendingTradeUI(null);
        gameViewRef.current?.closeTrade();
      }
      if (botTradeUI) {
        tradeTimersRef.current.forEach(clearTimeout);
        tradeTimersRef.current = [];
        setBotTradeUI(null);
      }
    }
  }, [gameState?.pendingTrade]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Comprehensive turn timer (hotseat local) ---
  const gameStateRef = useRef<GameState | null>(null);
  gameStateRef.current = gameState;

  useEffect(() => {
    const timerSeconds = fullConfig?.turnTimer;
    if (!gameState || gameState.phase === "finished" || gameState.phase === "waiting") {
      setTurnDeadline(null); return;
    }

    const isHumanTurn = gameState.currentPlayerIndex === HUMAN_PLAYER_INDEX;
    const needsHumanDiscard = gameState.turnPhase === "discard" &&
      gameState.discardingPlayers.includes(HUMAN_PLAYER_INDEX);

    // Setup phases: always use 30s timer for human, regardless of turnTimer config
    const isSetup = gameState.phase === "setup-forward" || gameState.phase === "setup-reverse";
    const SETUP_TIMER = 30;

    if (isSetup && isHumanTurn && fullConfig?.turnTimer) {
      const deadline = Date.now() + SETUP_TIMER * 1000;
      setTurnDeadline(deadline);

      const timeout = setTimeout(() => {
        const state = gameStateRef.current;
        if (!state) return;
        const action = decideBotAction(state, HUMAN_PLAYER_INDEX);
        if (action) {
          const result = applyAction(state, action);
          if (result.valid && result.newState) {
            playActionSound(action.type, true);
            setGameState(result.newState);
          }
        }
      }, SETUP_TIMER * 1000);

      return () => clearTimeout(timeout);
    }

    // Non-setup phases require turnTimer to be set
    if (!timerSeconds) {
      setTurnDeadline(null); return;
    }

    const humanNeedsToAct =
      (gameState.phase === "main" && isHumanTurn) ||
      needsHumanDiscard;

    if (!humanNeedsToAct) {
      setTurnDeadline(null); return;
    }

    // Short timer for quick-action phases, full timer for trade-or-build
    const QUICK_TIMER = 10;
    const isQuickPhase = gameState.turnPhase === "roll";
    const effectiveSeconds = isQuickPhase ? Math.min(QUICK_TIMER, timerSeconds) : timerSeconds;

    const deadline = Date.now() + effectiveSeconds * 1000;
    setTurnDeadline(deadline);

    const timeout = setTimeout(() => {
      const state = gameStateRef.current;
      if (!state) return;

      if (state.phase === "main" && state.turnPhase === "trade-or-build") {
        // Auto end-turn (original behavior)
        handleAction({ type: "end-turn", playerIndex: HUMAN_PLAYER_INDEX });
      } else {
        // For all other phases (setup, roll, discard, robber), let the bot AI decide
        const action = decideBotAction(state, HUMAN_PLAYER_INDEX);
        if (action) {
          const result = applyAction(state, action);
          if (result.valid && result.newState) {
            playActionSound(action.type, true);
            // Flash hexes if auto-roll
            if (action.type === "roll-dice" && result.newState.lastDiceRoll) {
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
            setGameState(result.newState);
          }
        }
      }
    }, effectiveSeconds * 1000);

    return () => clearTimeout(timeout);
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    gameState?.currentPlayerIndex, gameState?.phase, gameState?.turnPhase,
    gameState?.setupPlacementsMade, gameState?.discardingPlayers, fullConfig?.turnTimer,
  ]);

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

    respondingBots.forEach((bi) => {
      const delay = 0;
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
            if (shouldAutoCancel) setTimeout(() => cancelPendingTrade(tradeState, trade.id, true), 1200);
          }, 600);
        }
      }, delay);
      tradeTimersRef.current.push(timer);
    });
  }

  function cancelPendingTrade(tradeState: GameState, tradeId: string, keepTradeOpen?: boolean) {
    const result = applyAction(tradeState, { type: "cancel-trade", playerIndex: HUMAN_PLAYER_INDEX, tradeId });
    if (result.valid && result.newState) { playError(); setGameState(result.newState); }
    setPendingTradeUI(null);
    if (keepTradeOpen) {
      gameViewRef.current?.resetTrade();
    } else {
      gameViewRef.current?.closeTrade();
    }
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

  // === NUKE SEQUENCE HANDLER ===
  const handleNukeSequenceComplete = useCallback(() => {
    if (!nukeSequence) return;
    const { resultState, events } = nukeSequence;
    setGameState(resultState);
    triggerNukeEffects(events, resultState);
    checkAchievementEvents(events, resultState);
    setNukeSequence(null);
  }, [nukeSequence, setGameState]); // eslint-disable-line react-hooks/exhaustive-deps

  // === ACTION HANDLER ===
  const handleAction = useCallback((action: GameAction) => {
    clearError();

    // Intercept human sheep-nuke: run cinematic sequence before applying state
    if (action.type === "sheep-nuke" && !botIndices.includes(action.playerIndex) && gameState) {
      const result = applyAction(gameState, action);
      if (result.valid && result.newState && result.newState.lastDiceRoll) {
        const player = gameState.players[action.playerIndex];
        setNukeSequence({
          diceResult: result.newState.lastDiceRoll,
          resultState: result.newState,
          events: result.events ?? [],
          playerName: player.name,
          playerColor: PLAYER_COLOR_HEX[player.color],
          isFreeNuke: !!gameState.freeNukeAvailable,
        });
        return;
      }
      // If invalid, fall through to dispatch for error handling
    }

    const result = dispatch(action);

    if (result.valid && result.newState) {
      checkAchievementEvents(result.events, result.newState);
    }

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

    // Trigger nuke effects for sheep-nuke or sheep-nuke-pick
    if ((action.type === "sheep-nuke" || action.type === "sheep-nuke-pick") && result.valid && result.newState) {
      triggerNukeEffects(result.events ?? [], result.newState);
    }

    playActionSound(action.type);
  }, [dispatch, clearError, gameState, botIndices]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSendChat = useCallback((message: string) => {
    if (!gameState) return;
    playChat();
    const entry: GameLogEntry = { timestamp: Date.now(), playerIndex: HUMAN_PLAYER_INDEX, message, type: "chat" };
    setGameState({ ...gameState, log: [...gameState.log, entry] });
  }, [gameState, setGameState]);

  // --- Hotseat: block requesting resources nobody else has ---
  const handleAddToRequesting = useCallback((resource: Resource): boolean => {
    if (!gameState) return false;
    return gameState.players.some((p, i) => i !== HUMAN_PLAYER_INDEX && p.resources[resource] > 0);
  }, [gameState]);

  // === RENDER ===
  if (!gameState) {
    return (
      <div className="h-safe-screen flex items-center justify-center bg-[#2a6ab5]">
        <div className="font-pixel text-[12px] text-[#8BC34A] animate-pulse">LOADING...</div>
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

  // Bot-initiated trade overlay
  const botTradeOverlayNode = botTradeUI && gameState.pendingTrade ? (() => {
    const trade = gameState.pendingTrade;
    const bot = gameState.players[botTradeUI.initiatingBot];
    const botColor = PLAYER_COLOR_HEX[bot.color];
    const humanCanAfford = canHumanAffordBotTrade();
    return (
      <div className="bg-[#f0e6d0] border-2 border-[#8b7355] px-4 py-3 pointer-events-auto max-w-[calc(100vw-1rem)]" style={{ backdropFilter: "blur(4px)" }}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="font-pixel text-[9px] font-bold" style={{ color: botColor }}>{bot.name.toUpperCase()}</span>
            <span className="font-pixel text-[8px] text-gray-700">OFFERS YOU A TRADE:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="font-pixel text-[7px] text-red-700 font-bold">YOU GIVE:</span>
              <div className="flex gap-0.5">
                {Object.entries(trade.requesting).flatMap(([r, amt]) =>
                  Array.from({ length: amt! }, (_, i) => (
                    <MiniCard key={`br-${r}-${i}`} resource={r as Resource} onClick={() => {}} glow="red" />
                  ))
                )}
              </div>
            </div>
            <span className="font-pixel text-[10px] text-gray-400">&rarr;</span>
            <div className="flex items-center gap-1">
              <span className="font-pixel text-[7px] text-green-700 font-bold">YOU GET:</span>
              <div className="flex gap-0.5">
                {Object.entries(trade.offering).flatMap(([r, amt]) =>
                  Array.from({ length: amt! }, (_, i) => (
                    <MiniCard key={`bo-${r}-${i}`} resource={r as Resource} onClick={() => {}} glow="green" />
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={handleBotTradeAccept}
              disabled={!humanCanAfford}
              className={`px-4 py-1.5 font-pixel text-[8px] border-2 border-black ${
                humanCanAfford
                  ? "bg-green-600 text-white hover:bg-green-500"
                  : "bg-gray-500 text-gray-300 cursor-not-allowed"
              }`}
              title={humanCanAfford ? "Accept this trade" : "You don't have the required resources"}
            >
              ACCEPT
            </button>
            <button
              onClick={handleBotTradeReject}
              className="px-4 py-1.5 bg-red-600 text-white font-pixel text-[8px] border-2 border-black hover:bg-red-500"
            >
              REJECT
            </button>
          </div>
        </div>
      </div>
    );
  })() : null;

  // Trade response overlay (hotseat-only)
  const noDeals = pendingTradeUI?.resolved &&
    pendingTradeUI.acceptors.length === 0 &&
    !Object.values(pendingTradeUI.counterOffers).some((c) => c != null);

  const tradeOverlayNode = pendingTradeUI && gameState.pendingTrade ? (
    <div className="bg-[#f0e6d0] border-2 border-[#8b7355] px-3 py-2 pointer-events-auto max-w-[calc(100vw-1rem)]" style={{ backdropFilter: "blur(4px)" }}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-pixel text-[8px] text-gray-700">
            {!pendingTradeUI.resolved ? "WAITING..." : noDeals ? "" : "CHOOSE:"}
          </span>
          {noDeals && (
            <span className="font-pixel text-[9px] text-red-600 font-bold animate-pulse">NO DEALS</span>
          )}
          {pendingTradeUI.resolved && (
            <button
              onClick={declineAllTrades}
              className="px-3 py-1.5 bg-gray-600 text-white font-pixel text-[7px] border-2 border-black hover:bg-gray-500 ml-auto shrink-0"
            >
              CANCEL TRADE
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(pendingTradeUI.responses).map(([idxStr, status]) => {
            const idx = Number(idxStr);
            const p = gameState.players[idx];
            const color = PLAYER_COLOR_HEX[p.color];
            const isAcceptor = pendingTradeUI.resolved && pendingTradeUI.acceptors.includes(idx);
            const counter = pendingTradeUI.counterOffers[idx];

            return (
              <div key={idx} className="flex flex-wrap items-center gap-1 px-2 py-1 bg-[#e8d8b8] border border-[#8b7355]">
                <span className="font-pixel text-[8px] font-bold" style={{ color }}>{p.name.toUpperCase()}</span>
                {status === "pending" && <span className="text-[7px] text-gray-400 animate-pulse">...</span>}
                {status === "rejected" && !counter && <XMarkPixel size={14} color="#dc2626" />}
                {status === "rejected" && counter && pendingTradeUI.resolved && (() => {
                  const human = gameState.players[HUMAN_PLAYER_INDEX];
                  const canAfford = Object.entries(counter.requesting).every(
                    ([r, amt]) => (amt || 0) <= human.resources[r as Resource]
                  );
                  return (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="font-pixel text-[6px] text-red-700">GIVE:</span>
                      <div className="flex gap-0.5">
                        {Object.entries(counter.requesting).flatMap(([r, amt]) =>
                          Array.from({ length: amt! }, (_, i) => (
                            <MiniCard key={`cr-${r}-${i}`} resource={r as Resource} onClick={() => {}} glow="red" />
                          ))
                        )}
                      </div>
                      <span className="text-[8px] text-gray-400">&rarr;</span>
                      <span className="font-pixel text-[6px] text-green-700">GET:</span>
                      <div className="flex gap-0.5">
                        {Object.entries(counter.offering).flatMap(([r, amt]) =>
                          Array.from({ length: amt! }, (_, i) => (
                            <MiniCard key={`co-${r}-${i}`} resource={r as Resource} onClick={() => {}} glow="green" />
                          ))
                        )}
                      </div>
                      <button
                        onClick={canAfford ? () => acceptCounterOffer(idx) : undefined}
                        disabled={!canAfford}
                        className={`px-1.5 py-0.5 font-pixel text-[6px] border border-black ${
                          canAfford
                            ? "bg-amber-500 text-black hover:bg-amber-400"
                            : "bg-gray-500 text-gray-300 cursor-not-allowed"
                        }`}
                        title={canAfford ? "Accept counter-offer" : "You don't have the required resources"}
                      >ACCEPT</button>
                    </div>
                  );
                })()}
                {isAcceptor && (
                  <div className="flex gap-1 items-center">
                    <button onClick={() => acceptTradeWith(idx)} className="p-0.5 hover:bg-green-100 rounded" title="Accept trade">
                      <CheckPixel size={16} color="#16a34a" />
                    </button>
                    <button onClick={() => declineAcceptor(idx)} className="p-0.5 hover:bg-red-100 rounded" title="Decline">
                      <XMarkPixel size={16} color="#dc2626" />
                    </button>
                  </div>
                )}
                {status === "accepted" && !pendingTradeUI.resolved && <CheckPixel size={14} color="#16a34a" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <GameView
        ref={gameViewRef}
        gameState={gameState}
        myPlayerIndex={HUMAN_PLAYER_INDEX}
        onAction={handleAction}
        playerColors={playerColors}
        buildingStyles={boardBuildingStyles}
        chatLog={gameState.log}
        onSendChat={handleSendChat}
        onMainMenu={() => { resetGame(); sessionStorage.removeItem("catan-game-config"); sessionStorage.removeItem("catan-config"); sessionStorage.removeItem("catan-game-state"); router.push("/"); }}
        onLobby={() => { resetGame(); sessionStorage.removeItem("catan-game-config"); sessionStorage.removeItem("catan-config"); sessionStorage.removeItem("catan-game-state"); sessionStorage.setItem("catan-auto-lobby", "true"); router.push("/"); }}
        onRestart={() => {
          resetGame();
          setBotTradeUI(null);
          setPendingTradeUI(null);
          if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
          sessionStorage.removeItem("catan-game-state");
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
        flashingHexes={flashingHexes}
        flashSeven={flashSeven}
        nukeFlashHexes={nukeFlashHexes}
        screenShake={screenShake}
        turnDeadline={turnDeadline}
        error={error}
        botThinking={botThinking}
        onAddToRequesting={handleAddToRequesting}
        tradeOverlay={botTradeOverlayNode || tradeOverlayNode}
        showTradeOverlay={pendingTradeUI !== null || botTradeUI !== null}
        announcement={announcement}
        onDismissAnnouncement={() => setAnnouncement(null)}
        onDiceAnimationStart={playDiceRoll}
      />
      {nukeSequence && (
        <NukeSequenceOverlay
          diceResult={nukeSequence.diceResult}
          playerName={nukeSequence.playerName}
          playerColor={nukeSequence.playerColor}
          onSequenceComplete={handleNukeSequenceComplete}
          isFreeNuke={nukeSequence.isFreeNuke}
        />
      )}
      {gameState.phase === "finished" && (
        <VictoryOverlay
          gameState={gameState}
          localPlayerIndex={HUMAN_PLAYER_INDEX}
          onPlayAgain={() => {
            setBotTradeUI(null);
            setPendingTradeUI(null);
            if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
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
          onMainMenu={() => router.push("/")}
        />
      )}
    </>
  );
}

import type {
  GameState,
  PlayerState,
  DiceRoll,
  Resource,
  DevelopmentCardType,
  Board,
  TradeOffer,
  GamePhase,
  TurnPhase,
  Building,
  Road,
  PortType,
  PlayerColor,
} from "@/shared/types/game";
import { PLAYER_COLORS } from "@/shared/types/game";
import type { GameConfig } from "@/shared/types/config";
import type {
  GameAction,
  ActionResult,
  GameEvent,
} from "@/shared/types/actions";
import type { VertexKey, EdgeKey, HexKey } from "@/shared/types/coordinates";
import {
  BUILDING_COSTS,
  VP_TO_WIN,
  MAX_SETTLEMENTS,
  MAX_CITIES,
  MAX_ROADS,
  EXPANSION_MAX_SETTLEMENTS,
  EXPANSION_MAX_CITIES,
  EXPANSION_MAX_ROADS,
  MIN_KNIGHTS_FOR_LARGEST_ARMY,
  DISCARD_THRESHOLD,
  ALL_RESOURCES,
  TERRAIN_RESOURCE,
  DEV_CARD_COUNTS,
} from "@/shared/constants";
import {
  hexKey,
  parseHexKey,
  adjacentVertices,
  edgesAtVertex,
  edgeEndpoints,
  hexVertices,
  hexEdges,
  shuffle,
} from "@/shared/utils/hexMath";
import { generateBoard } from "./boardGenerator";
import { distributeResources, totalResources } from "./resourceDistribution";
import { updateLongestRoad } from "./longestRoad";
import { createFairDiceBag, drawFairDice } from "./fairDice";

// === Game creation ===

export function createGame(id: string, playerNames: string[], config?: GameConfig): GameState {
  const expansion = config?.expansionBoard ?? false;
  const board = generateBoard(expansion);
  const devDeck = createDevelopmentCardDeck();

  // Speed mode starting resources
  const startingResources = config?.gameMode === "speed"
    ? { brick: 2, lumber: 2, ore: 2, grain: 2, wool: 2 }
    : { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };

  const players: PlayerState[] = playerNames.map((name, i) => ({
    index: i,
    name,
    color: (config?.players[i]?.color ?? PLAYER_COLORS[i]) as PlayerColor,
    resources: { ...startingResources },
    developmentCards: [],
    newDevelopmentCards: [],
    knightsPlayed: 0,
    hasLargestArmy: false,
    hasLongestRoad: false,
    longestRoadLength: 0,
    settlements: [],
    cities: [],
    roads: [],
    victoryPoints: 0,
    hiddenVictoryPoints: 0,
    hasPlayedDevCardThisTurn: false,
    portsAccess: [],
  }));

  const startingPlayerIndex = Math.floor(Math.random() * players.length);

  const state: GameState = {
    id,
    board,
    players,
    currentPlayerIndex: startingPlayerIndex,
    phase: "setup-forward",
    turnPhase: "trade-or-build",
    turnNumber: 0,
    lastDiceRoll: null,
    developmentCardDeck: devDeck,
    pendingTrades: [],
    discardingPlayers: [],
    setupPlacementsMade: 0,
    startingPlayerIndex,
    winner: null,
    longestRoadHolder: null,
    largestArmyHolder: null,
    log: [{ timestamp: Date.now(), playerIndex: null, message: "Game started!", type: "system" }],
  };

  if (config) {
    state.config = config;
    if (config.fairDice) {
      state.fairDiceBag = createFairDiceBag();
    }
  }

  return state;
}

// === Config-aware helpers ===

function getMaxSettlements(state: GameState): number {
  return state.config?.expansionBoard ? EXPANSION_MAX_SETTLEMENTS : MAX_SETTLEMENTS;
}

function getMaxCities(state: GameState): number {
  return state.config?.expansionBoard ? EXPANSION_MAX_CITIES : MAX_CITIES;
}

function getMaxRoads(state: GameState): number {
  return state.config?.expansionBoard ? EXPANSION_MAX_ROADS : MAX_ROADS;
}

function getVpToWin(state: GameState): number {
  return state.config?.vpToWin ?? VP_TO_WIN;
}

function createDevelopmentCardDeck(): DevelopmentCardType[] {
  const deck: DevelopmentCardType[] = [];
  for (const [type, count] of Object.entries(DEV_CARD_COUNTS)) {
    for (let i = 0; i < count; i++) {
      deck.push(type as DevelopmentCardType);
    }
  }
  return shuffle(deck);
}

// === Main reducer ===

export function applyAction(state: GameState, action: GameAction): ActionResult {
  try {
    switch (action.type) {
      case "place-settlement":
        return handlePlaceSettlement(state, action.playerIndex, action.vertex);
      case "place-road":
        return handlePlaceRoad(state, action.playerIndex, action.edge);
      case "roll-dice":
        return handleRollDice(state, action.playerIndex);
      case "build-settlement":
        return handleBuildSettlement(state, action.playerIndex, action.vertex);
      case "build-city":
        return handleBuildCity(state, action.playerIndex, action.vertex);
      case "build-road":
        return handleBuildRoad(state, action.playerIndex, action.edge);
      case "buy-development-card":
        return handleBuyDevelopmentCard(state, action.playerIndex);
      case "offer-trade":
        return handleOfferTrade(state, action.playerIndex, action.offering, action.requesting, action.toPlayer);
      case "accept-trade":
        return handleAcceptTrade(state, action.playerIndex, action.tradeId);
      case "reject-trade":
        return handleRejectTrade(state, action.playerIndex, action.tradeId);
      case "cancel-trade":
        return handleCancelTrade(state, action.playerIndex, action.tradeId);
      case "confirm-trade":
        return handleConfirmTrade(state, action.playerIndex, action.tradeId, action.withPlayer);
      case "bank-trade":
        return handleBankTrade(state, action.playerIndex, action.giving, action.givingCount, action.receiving);
      case "move-robber":
        return handleMoveRobber(state, action.playerIndex, action.hex);
      case "steal-resource":
        return handleStealResource(state, action.playerIndex, action.targetPlayer);
      case "discard-resources":
        return handleDiscardResources(state, action.playerIndex, action.resources);
      case "play-knight":
        return handlePlayKnight(state, action.playerIndex);
      case "play-road-building":
        return handlePlayRoadBuilding(state, action.playerIndex);
      case "play-year-of-plenty":
        return handlePlayYearOfPlenty(state, action.playerIndex, action.resource1, action.resource2);
      case "play-monopoly":
        return handlePlayMonopoly(state, action.playerIndex, action.resource);
      case "sheep-nuke":
        return handleSheepNuke(state, action.playerIndex);
      case "sheep-nuke-pick":
        return handleSheepNukePick(state, action.playerIndex, action.number);
      case "end-turn":
        return handleEndTurn(state, action.playerIndex);
      default:
        return { valid: false, error: "Unknown action type" };
    }
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

// === Deep clone helper ===

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
}

// === Setup phase handlers ===

function handlePlaceSettlement(state: GameState, playerIndex: number, vertex: VertexKey): ActionResult {
  if (state.phase !== "setup-forward" && state.phase !== "setup-reverse") {
    return { valid: false, error: "Not in setup phase" };
  }
  if (playerIndex !== state.currentPlayerIndex) {
    return { valid: false, error: "Not your turn" };
  }

  // Validate vertex exists and is empty
  if (!(vertex in state.board.vertices)) {
    return { valid: false, error: "Invalid vertex" };
  }
  if (state.board.vertices[vertex] !== null) {
    return { valid: false, error: "Vertex already occupied" };
  }

  // Check distance rule: no adjacent settlements
  const adjVerts = adjacentVertices(vertex);
  for (const av of adjVerts) {
    if (state.board.vertices[av] !== undefined && state.board.vertices[av] !== null) {
      return { valid: false, error: "Too close to another settlement" };
    }
  }

  // Check if this player has already placed settlement this turn in setup
  // In setup, each turn consists of settlement + road. Check if settlement already placed.
  const placementIndex = state.setupPlacementsMade;
  const isSettlementTurn = placementIndex % 2 === 0;
  if (!isSettlementTurn) {
    return { valid: false, error: "Must place road first" };
  }

  const newState = cloneState(state);
  newState.board.vertices[vertex] = { type: "settlement", playerIndex };
  newState.players[playerIndex].settlements.push(vertex);
  newState.players[playerIndex].victoryPoints += 1;

  // Check port access
  updatePortAccess(newState, playerIndex, vertex);

  // In reverse setup, give initial resources from adjacent hexes
  if (state.phase === "setup-reverse") {
    giveInitialResources(newState, playerIndex, vertex);
  }

  newState.setupPlacementsMade += 1;

  const events: GameEvent[] = [
    { type: "settlement-built", playerIndex, data: { vertex } },
  ];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} placed a settlement`,
    type: "action",
  });

  return { valid: true, newState, events };
}

function handlePlaceRoad(state: GameState, playerIndex: number, edge: EdgeKey): ActionResult {
  if (state.phase !== "setup-forward" && state.phase !== "setup-reverse") {
    return { valid: false, error: "Not in setup phase" };
  }
  if (playerIndex !== state.currentPlayerIndex) {
    return { valid: false, error: "Not your turn" };
  }

  if (!(edge in state.board.edges)) {
    return { valid: false, error: "Invalid edge" };
  }
  if (state.board.edges[edge] !== null) {
    return { valid: false, error: "Edge already has a road" };
  }

  const isRoadTurn = state.setupPlacementsMade % 2 === 1;
  if (!isRoadTurn) {
    return { valid: false, error: "Must place settlement first" };
  }

  // Road must connect to the just-placed settlement
  const lastSettlement = state.players[playerIndex].settlements[
    state.players[playerIndex].settlements.length - 1
  ];
  const [v1, v2] = edgeEndpoints(edge);
  if (v1 !== lastSettlement && v2 !== lastSettlement) {
    return { valid: false, error: "Road must connect to your last settlement" };
  }

  const newState = cloneState(state);
  newState.board.edges[edge] = { playerIndex };
  newState.players[playerIndex].roads.push(edge);
  newState.setupPlacementsMade += 1;

  // Advance to next player
  advanceSetup(newState);

  const events: GameEvent[] = [
    { type: "road-built", playerIndex, data: { edge } },
  ];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} placed a road`,
    type: "action",
  });

  return { valid: true, newState, events };
}

function advanceSetup(state: GameState) {
  const numPlayers = state.players.length;
  const totalSetupActions = numPlayers * 4; // 2 settlements + 2 roads per player
  const start = state.startingPlayerIndex;

  if (state.setupPlacementsMade >= totalSetupActions) {
    // Setup complete, start main game
    state.phase = "main";
    state.turnPhase = "roll";
    state.currentPlayerIndex = start;
    state.turnNumber = 1;
    return;
  }

  // Each player does 2 actions (settlement + road) per round
  const actionsPerPlayer = 2;
  const currentRound = Math.floor(state.setupPlacementsMade / (numPlayers * actionsPerPlayer));
  const positionInRound = Math.floor(
    (state.setupPlacementsMade % (numPlayers * actionsPerPlayer)) / actionsPerPlayer
  );

  if (currentRound === 0) {
    state.phase = "setup-forward";
    state.currentPlayerIndex = (start + positionInRound) % numPlayers;
  } else {
    state.phase = "setup-reverse";
    state.currentPlayerIndex = (start + numPlayers - 1 - positionInRound) % numPlayers;
  }
}

function giveInitialResources(state: GameState, playerIndex: number, vertex: VertexKey) {
  for (const hex of Object.values(state.board.hexes)) {
    const verts = hexVertices(hex.coord);
    if (verts.includes(vertex)) {
      const resource = TERRAIN_RESOURCE[hex.terrain];
      if (resource) {
        state.players[playerIndex].resources[resource] += 1;
      }
    }
  }
}

function updatePortAccess(state: GameState, playerIndex: number, vertex: VertexKey) {
  for (const port of state.board.ports) {
    if (port.edgeVertices.includes(vertex)) {
      if (!state.players[playerIndex].portsAccess.includes(port.type)) {
        state.players[playerIndex].portsAccess.push(port.type);
      }
    }
  }
}

// === Main game handlers ===

function handleRollDice(state: GameState, playerIndex: number): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Game not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "roll") return { valid: false, error: "Cannot roll now" };

  const newState = cloneState(state);

  let die1: number, die2: number, total: number;
  if (state.config?.fairDice && newState.fairDiceBag) {
    const result = drawFairDice(newState.fairDiceBag);
    die1 = result.die1;
    die2 = result.die2;
    total = result.total;
    newState.fairDiceBag = result.updatedBag;
  } else {
    die1 = Math.floor(Math.random() * 6) + 1;
    die2 = Math.floor(Math.random() * 6) + 1;
    total = die1 + die2;
  }

  const roll: DiceRoll = { die1, die2, total };
  newState.lastDiceRoll = roll;

  const events: GameEvent[] = [
    { type: "dice-rolled", playerIndex, data: { die1, die2, total } },
  ];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} rolled ${die1} + ${die2} = ${total}`,
    type: "action",
  });

  if (total === 7) {
    // Check who needs to discard
    const discardPlayers: number[] = [];
    for (const p of newState.players) {
      if (totalResources(p.resources) > DISCARD_THRESHOLD) {
        discardPlayers.push(p.index);
      }
    }

    if (discardPlayers.length > 0) {
      newState.turnPhase = "discard";
      newState.discardingPlayers = discardPlayers;
    } else {
      newState.turnPhase = "robber-place";
    }
  } else {
    // Distribute resources
    const { updatedPlayers, events: distEvents, distributions } = distributeResources(newState, total);
    newState.players = updatedPlayers;
    events.push(...distEvents);

    // Log resource pickups per player
    for (const [pidx, res] of Object.entries(distributions)) {
      const parts = Object.entries(res)
        .filter(([, amt]) => (amt as number) > 0)
        .map(([r, amt]) => `${amt} ${r}`);
      if (parts.length > 0) {
        newState.log.push({
          timestamp: Date.now(),
          playerIndex: Number(pidx),
          message: `${newState.players[Number(pidx)].name} received ${parts.join(", ")}`,
          type: "action",
        });
      }
    }

    newState.turnPhase = "trade-or-build";
  }

  return { valid: true, newState, events };
}

function handleBuildSettlement(state: GameState, playerIndex: number, vertex: VertexKey): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build") return { valid: false, error: "Cannot build now" };

  const player = state.players[playerIndex];

  // Check max settlements
  if (player.settlements.length >= getMaxSettlements(state)) {
    return { valid: false, error: "Maximum settlements reached" };
  }

  // Check resources
  if (!canAfford(player, BUILDING_COSTS.settlement)) {
    return { valid: false, error: "Not enough resources" };
  }

  // Check vertex validity
  if (!(vertex in state.board.vertices)) return { valid: false, error: "Invalid vertex" };
  if (state.board.vertices[vertex] !== null) return { valid: false, error: "Vertex occupied" };

  // Distance rule
  const adjVerts = adjacentVertices(vertex);
  for (const av of adjVerts) {
    if (state.board.vertices[av] !== undefined && state.board.vertices[av] !== null) {
      return { valid: false, error: "Too close to another settlement" };
    }
  }

  // Must connect to player's road network
  const connectedEdges = edgesAtVertex(vertex);
  const hasRoad = connectedEdges.some(
    (ek) => state.board.edges[ek]?.playerIndex === playerIndex
  );
  if (!hasRoad) return { valid: false, error: "Must be connected to your road" };

  const newState = cloneState(state);
  deductResources(newState.players[playerIndex], BUILDING_COSTS.settlement);
  newState.board.vertices[vertex] = { type: "settlement", playerIndex };
  newState.players[playerIndex].settlements.push(vertex);
  newState.players[playerIndex].victoryPoints += 1;
  updatePortAccess(newState, playerIndex, vertex);

  const events: GameEvent[] = [{ type: "settlement-built", playerIndex, data: { vertex } }];
  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} built a settlement`,
    type: "action",
  });

  return checkVictory(newState, playerIndex, events);
}

function handleBuildCity(state: GameState, playerIndex: number, vertex: VertexKey): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build") return { valid: false, error: "Cannot build now" };

  const player = state.players[playerIndex];
  if (player.cities.length >= getMaxCities(state)) return { valid: false, error: "Maximum cities reached" };
  if (!canAfford(player, BUILDING_COSTS.city)) return { valid: false, error: "Not enough resources" };

  const building = state.board.vertices[vertex];
  if (!building || building.type !== "settlement" || building.playerIndex !== playerIndex) {
    return { valid: false, error: "Must upgrade your own settlement" };
  }

  const newState = cloneState(state);
  deductResources(newState.players[playerIndex], BUILDING_COSTS.city);
  newState.board.vertices[vertex] = { type: "city", playerIndex };

  // Remove from settlements, add to cities
  newState.players[playerIndex].settlements = newState.players[playerIndex].settlements.filter(
    (v) => v !== vertex
  );
  newState.players[playerIndex].cities.push(vertex);
  newState.players[playerIndex].victoryPoints += 1; // city = 2 VP, settlement was 1, net +1

  const events: GameEvent[] = [{ type: "city-built", playerIndex, data: { vertex } }];
  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} built a city`,
    type: "action",
  });

  return checkVictory(newState, playerIndex, events);
}

function handleBuildRoad(state: GameState, playerIndex: number, edge: EdgeKey): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };

  const isRoadBuilding =
    state.turnPhase === "road-building-1" || state.turnPhase === "road-building-2";
  if (state.turnPhase !== "trade-or-build" && !isRoadBuilding) {
    return { valid: false, error: "Cannot build road now" };
  }

  const player = state.players[playerIndex];
  if (player.roads.length >= getMaxRoads(state)) return { valid: false, error: "Maximum roads reached" };

  if (!isRoadBuilding && !canAfford(player, BUILDING_COSTS.road)) {
    return { valid: false, error: "Not enough resources" };
  }

  if (!(edge in state.board.edges)) return { valid: false, error: "Invalid edge" };
  if (state.board.edges[edge] !== null) return { valid: false, error: "Edge already has a road" };

  // Must connect to player's network (road, settlement, or city)
  if (!isConnectedToNetwork(state, playerIndex, edge)) {
    return { valid: false, error: "Must connect to your road network" };
  }

  const newState = cloneState(state);

  if (!isRoadBuilding) {
    deductResources(newState.players[playerIndex], BUILDING_COSTS.road);
  }

  newState.board.edges[edge] = { playerIndex };
  newState.players[playerIndex].roads.push(edge);

  // Update longest road
  const roadResult = updateLongestRoad(newState);
  const events: GameEvent[] = [{ type: "road-built", playerIndex, data: { edge } }];

  updateLongestRoadState(newState, roadResult, events);

  if (isRoadBuilding) {
    if (state.turnPhase === "road-building-1") {
      // Check if player has any valid road placement for second road
      newState.turnPhase = "road-building-2";
    } else {
      newState.turnPhase = "trade-or-build";
    }
  }

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} built a road`,
    type: "action",
  });

  return checkVictory(newState, playerIndex, events);
}

function handleBuyDevelopmentCard(state: GameState, playerIndex: number): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build") return { valid: false, error: "Cannot buy now" };

  if (state.developmentCardDeck.length === 0) {
    return { valid: false, error: "No development cards left" };
  }

  const player = state.players[playerIndex];
  if (!canAfford(player, BUILDING_COSTS.developmentCard)) {
    return { valid: false, error: "Not enough resources" };
  }

  const newState = cloneState(state);
  deductResources(newState.players[playerIndex], BUILDING_COSTS.developmentCard);

  const card = newState.developmentCardDeck.pop()!;
  newState.players[playerIndex].newDevelopmentCards.push(card);

  if (card === "victoryPoint") {
    newState.players[playerIndex].hiddenVictoryPoints += 1;
  }

  const events: GameEvent[] = [
    { type: "development-card-bought", playerIndex, data: { card } },
  ];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} bought a development card`,
    type: "action",
  });

  return checkVictory(newState, playerIndex, events);
}

// === Trading ===

function handleOfferTrade(
  state: GameState,
  playerIndex: number,
  offering: Partial<Record<Resource, number>>,
  requesting: Partial<Record<Resource, number>>,
  toPlayer: number | null
): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build") return { valid: false, error: "Cannot trade now" };

  // Validate player has the resources for this trade
  const player = state.players[playerIndex];
  for (const [res, amount] of Object.entries(offering)) {
    if ((amount || 0) > player.resources[res as Resource]) {
      return { valid: false, error: `Not enough ${res}` };
    }
  }

  const newState = cloneState(state);
  newState.pendingTrades.push({
    id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fromPlayer: playerIndex,
    toPlayer,
    offering: offering,
    requesting: requesting,
    status: "pending",
    acceptedBy: [],
  });

  return { valid: true, newState, events: [] };
}

function handleAcceptTrade(state: GameState, playerIndex: number, tradeId: string): ActionResult {
  const trade = state.pendingTrades.find((t) => t.id === tradeId);
  if (!trade) {
    return { valid: false, error: "No matching trade" };
  }
  if (playerIndex === trade.fromPlayer) {
    return { valid: false, error: "Cannot accept your own trade" };
  }
  if (trade.toPlayer !== null && trade.toPlayer !== playerIndex) {
    return { valid: false, error: "Trade not offered to you" };
  }
  if (trade.acceptedBy.includes(playerIndex)) {
    return { valid: false, error: "Already accepted" };
  }

  // Validate accepter has the resources
  const accepter = state.players[playerIndex];
  for (const [res, amount] of Object.entries(trade.requesting)) {
    if ((amount || 0) > accepter.resources[res as Resource]) {
      return { valid: false, error: `Not enough ${res}` };
    }
  }

  const newState = cloneState(state);
  const t = newState.pendingTrades.find((t) => t.id === tradeId)!;
  t.acceptedBy.push(playerIndex);

  return { valid: true, newState, events: [] };
}

/** Initiator confirms an accepted trade — executes the swap and clears all pending trades */
function handleConfirmTrade(state: GameState, playerIndex: number, tradeId: string, withPlayer: number): ActionResult {
  const trade = state.pendingTrades.find((t) => t.id === tradeId);
  if (!trade) {
    return { valid: false, error: "No matching trade" };
  }
  if (playerIndex !== trade.fromPlayer) {
    return { valid: false, error: "Only the offerer can confirm" };
  }
  if (!trade.acceptedBy.includes(withPlayer)) {
    return { valid: false, error: "That player hasn't accepted" };
  }

  // Re-validate both players have the resources at confirm time
  const offerer = state.players[playerIndex];
  for (const [res, amount] of Object.entries(trade.offering)) {
    if ((amount || 0) > offerer.resources[res as Resource]) {
      return { valid: false, error: `You no longer have enough ${res}` };
    }
  }
  const accepter = state.players[withPlayer];
  for (const [res, amount] of Object.entries(trade.requesting)) {
    if ((amount || 0) > accepter.resources[res as Resource]) {
      return { valid: false, error: `${accepter.name} no longer has enough ${res}` };
    }
  }

  const newState = cloneState(state);
  const from = newState.players[trade.fromPlayer];
  const to = newState.players[withPlayer];

  // Transfer resources
  for (const [res, amount] of Object.entries(trade.offering)) {
    if (amount) {
      from.resources[res as Resource] -= amount;
      to.resources[res as Resource] += amount;
    }
  }
  for (const [res, amount] of Object.entries(trade.requesting)) {
    if (amount) {
      to.resources[res as Resource] -= amount;
      from.resources[res as Resource] += amount;
    }
  }

  // Clear all pending trades
  newState.pendingTrades = [];

  const events: GameEvent[] = [
    { type: "trade-completed", playerIndex: trade.fromPlayer, data: { with: withPlayer } },
  ];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex: trade.fromPlayer,
    message: `${from.name} traded with ${to.name}`,
    type: "action",
  });

  return { valid: true, newState, events };
}

function handleRejectTrade(state: GameState, playerIndex: number, tradeId: string): ActionResult {
  const trade = state.pendingTrades.find((t) => t.id === tradeId);
  if (!trade) {
    return { valid: false, error: "No matching trade" };
  }

  // Just remove the rejector from acceptedBy if they were there
  const newState = cloneState(state);
  const t = newState.pendingTrades.find((t) => t.id === tradeId)!;
  t.acceptedBy = t.acceptedBy.filter((i) => i !== playerIndex);

  return { valid: true, newState, events: [] };
}

function handleCancelTrade(state: GameState, playerIndex: number, tradeId: string): ActionResult {
  const trade = state.pendingTrades.find((t) => t.id === tradeId);
  if (!trade) {
    return { valid: false, error: "No matching trade" };
  }
  if (playerIndex !== trade.fromPlayer) {
    return { valid: false, error: "Only the offerer can cancel" };
  }

  const newState = cloneState(state);
  newState.pendingTrades = newState.pendingTrades.filter((t) => t.id !== tradeId);

  return { valid: true, newState, events: [] };
}

function handleBankTrade(
  state: GameState,
  playerIndex: number,
  giving: Resource,
  givingCount: number,
  receiving: Resource
): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build") return { valid: false, error: "Cannot trade now" };

  const player = state.players[playerIndex];

  // Determine minimum trade ratio
  let minRatio = 4;
  if (player.portsAccess.includes(giving)) minRatio = 2;
  else if (player.portsAccess.includes("any")) minRatio = 3;

  if (givingCount < minRatio) {
    return { valid: false, error: `Need at least ${minRatio} ${giving} to trade` };
  }
  if (givingCount % minRatio !== 0) {
    return { valid: false, error: `Must give a multiple of ${minRatio} of the resource` };
  }
  if (player.resources[giving] < givingCount) {
    return { valid: false, error: "Not enough resources" };
  }
  if (giving === receiving) {
    return { valid: false, error: "Cannot trade for the same resource" };
  }

  const receivingCount = givingCount / minRatio;
  const newState = cloneState(state);
  newState.players[playerIndex].resources[giving] -= givingCount;
  newState.players[playerIndex].resources[receiving] += receivingCount;

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} traded ${givingCount} ${giving} for ${receivingCount} ${receiving} with the bank`,
    type: "action",
  });

  return { valid: true, newState, events: [] };
}

// === Robber ===

function handleMoveRobber(state: GameState, playerIndex: number, hex: HexKey): ActionResult {
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "robber-place") return { valid: false, error: "Cannot move robber now" };

  if (!(hex in state.board.hexes)) return { valid: false, error: "Invalid hex" };
  if (hex === state.board.robberHex) return { valid: false, error: "Must move robber to a different hex" };

  // Friendly robber: can't place on hex where only players with ≤2 VP have buildings
  if (state.config?.friendlyRobber) {
    const hexCoord = parseHexKey(hex);
    const verts = hexVertices(hexCoord);
    const playersOnHex = new Set<number>();
    for (const vk of verts) {
      const b = state.board.vertices[vk];
      if (b) playersOnHex.add(b.playerIndex);
    }
    if (playersOnHex.size > 0) {
      const allLowVP = [...playersOnHex].every(
        (pi) => state.players[pi].victoryPoints <= 2
      );
      if (allLowVP) {
        return { valid: false, error: "Friendly robber: can't rob players with 2 or fewer VP" };
      }
    }
  }

  const newState = cloneState(state);

  // Remove robber from old hex
  newState.board.hexes[newState.board.robberHex].hasRobber = false;
  // Place on new hex
  newState.board.hexes[hex].hasRobber = true;
  newState.board.robberHex = hex;

  // Find players on this hex who can be stolen from
  const stealTargets = getStealTargets(newState, playerIndex, hex);

  // After robber resolves, return to the phase before the robber was triggered
  // (e.g. "roll" if knight was played before dice, "trade-or-build" otherwise)
  const postRobberPhase = newState.preRobberTurnPhase ?? "trade-or-build";
  if (stealTargets.length === 0) {
    newState.turnPhase = postRobberPhase;
    newState.preRobberTurnPhase = undefined;
  } else if (stealTargets.length === 1) {
    // Auto-steal from the only target
    const target = stealTargets[0];
    stealRandomResource(newState, playerIndex, target);
    newState.turnPhase = postRobberPhase;
    newState.preRobberTurnPhase = undefined;
  } else {
    newState.turnPhase = "robber-steal";
  }

  const events: GameEvent[] = [{ type: "robber-moved", playerIndex, data: { hex } }];

  // Find all players with buildings on the robber hex (to announce who got blocked)
  const parsedRobberHex = parseHexKey(hex);
  const blockedNames = new Set<string>();
  for (const vk of hexVertices(parsedRobberHex)) {
    const building = newState.board.vertices[vk];
    if (building && building.playerIndex !== playerIndex) {
      blockedNames.add(newState.players[building.playerIndex].name);
    }
  }
  const blockedList = Array.from(blockedNames);
  const robberMsg = blockedList.length > 0
    ? `${newState.players[playerIndex].name} moved the robber, blocking ${blockedList.join(" and ")}`
    : `${newState.players[playerIndex].name} moved the robber`;

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: robberMsg,
    type: "action",
  });

  return { valid: true, newState, events };
}

function handleStealResource(state: GameState, playerIndex: number, targetPlayer: number): ActionResult {
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "robber-steal") return { valid: false, error: "Cannot steal now" };

  const stealTargets = getStealTargets(state, playerIndex, state.board.robberHex);
  if (!stealTargets.includes(targetPlayer)) {
    return { valid: false, error: "Invalid steal target" };
  }

  const newState = cloneState(state);
  stealRandomResource(newState, playerIndex, targetPlayer);
  newState.turnPhase = newState.preRobberTurnPhase ?? "trade-or-build";
  newState.preRobberTurnPhase = undefined;

  const events: GameEvent[] = [
    { type: "resource-stolen", playerIndex, data: { from: targetPlayer } },
  ];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} stole a resource from ${newState.players[targetPlayer].name}`,
    type: "action",
  });

  return { valid: true, newState, events };
}

function handleDiscardResources(
  state: GameState,
  playerIndex: number,
  resources: Partial<Record<Resource, number>>
): ActionResult {
  if (state.turnPhase !== "discard") return { valid: false, error: "Not in discard phase" };
  if (!state.discardingPlayers.includes(playerIndex)) {
    return { valid: false, error: "You don't need to discard" };
  }

  const player = state.players[playerIndex];
  const total = totalResources(player.resources);
  const discardAmount = Math.floor(total / 2);

  let discardTotal = 0;
  for (const [res, amount] of Object.entries(resources)) {
    if ((amount || 0) > player.resources[res as Resource]) {
      return { valid: false, error: `Not enough ${res} to discard` };
    }
    discardTotal += amount || 0;
  }

  if (discardTotal !== discardAmount) {
    return { valid: false, error: `Must discard exactly ${discardAmount} cards` };
  }

  const newState = cloneState(state);
  for (const [res, amount] of Object.entries(resources)) {
    if (amount) {
      newState.players[playerIndex].resources[res as Resource] -= amount;
    }
  }

  newState.discardingPlayers = newState.discardingPlayers.filter((i) => i !== playerIndex);

  const events: GameEvent[] = [
    { type: "resources-discarded", playerIndex, data: { count: discardAmount } },
  ];

  // If all players have discarded, move to robber placement
  if (newState.discardingPlayers.length === 0) {
    newState.turnPhase = "robber-place";
  }

  return { valid: true, newState, events };
}

// === Development cards ===

function handlePlayKnight(state: GameState, playerIndex: number): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.players[playerIndex].hasPlayedDevCardThisTurn) {
    return { valid: false, error: "Already played a development card this turn" };
  }

  const cardIdx = state.players[playerIndex].developmentCards.indexOf("knight");
  if (cardIdx === -1) return { valid: false, error: "No knight card" };

  const newState = cloneState(state);
  newState.players[playerIndex].developmentCards.splice(cardIdx, 1);
  newState.players[playerIndex].knightsPlayed += 1;
  newState.players[playerIndex].hasPlayedDevCardThisTurn = true;
  newState.preRobberTurnPhase = state.turnPhase; // remember phase to return to after robber
  newState.turnPhase = "robber-place";

  const events: GameEvent[] = [{ type: "knight-played", playerIndex }];

  // Check largest army
  updateLargestArmy(newState, events);

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} played a knight`,
    type: "action",
  });

  return checkVictory(newState, playerIndex, events);
}

function handlePlayRoadBuilding(state: GameState, playerIndex: number): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build" && state.turnPhase !== "roll") {
    return { valid: false, error: "Cannot play now" };
  }
  if (state.players[playerIndex].hasPlayedDevCardThisTurn) {
    return { valid: false, error: "Already played a development card this turn" };
  }

  const cardIdx = state.players[playerIndex].developmentCards.indexOf("roadBuilding");
  if (cardIdx === -1) return { valid: false, error: "No road building card" };

  const newState = cloneState(state);
  newState.players[playerIndex].developmentCards.splice(cardIdx, 1);
  newState.players[playerIndex].hasPlayedDevCardThisTurn = true;
  newState.turnPhase = "road-building-1";

  const events: GameEvent[] = [{ type: "road-building-played", playerIndex }];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} played Road Building`,
    type: "action",
  });

  return { valid: true, newState, events };
}

function handlePlayYearOfPlenty(
  state: GameState,
  playerIndex: number,
  resource1: Resource,
  resource2: Resource
): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build" && state.turnPhase !== "roll") {
    return { valid: false, error: "Cannot play now" };
  }
  if (state.players[playerIndex].hasPlayedDevCardThisTurn) {
    return { valid: false, error: "Already played a development card this turn" };
  }

  const cardIdx = state.players[playerIndex].developmentCards.indexOf("yearOfPlenty");
  if (cardIdx === -1) return { valid: false, error: "No Year of Plenty card" };

  const newState = cloneState(state);
  newState.players[playerIndex].developmentCards.splice(cardIdx, 1);
  newState.players[playerIndex].hasPlayedDevCardThisTurn = true;
  newState.players[playerIndex].resources[resource1] += 1;
  newState.players[playerIndex].resources[resource2] += 1;

  const events: GameEvent[] = [
    { type: "year-of-plenty-played", playerIndex, data: { resource1, resource2 } },
  ];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} played Year of Plenty`,
    type: "action",
  });

  // If played before rolling, still need to roll
  if (state.turnPhase === "roll") {
    // Stay in roll phase
  } else {
    newState.turnPhase = "trade-or-build";
  }

  return { valid: true, newState, events };
}

function handlePlayMonopoly(state: GameState, playerIndex: number, resource: Resource): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build" && state.turnPhase !== "roll") {
    return { valid: false, error: "Cannot play now" };
  }
  if (state.players[playerIndex].hasPlayedDevCardThisTurn) {
    return { valid: false, error: "Already played a development card this turn" };
  }

  const cardIdx = state.players[playerIndex].developmentCards.indexOf("monopoly");
  if (cardIdx === -1) return { valid: false, error: "No Monopoly card" };

  const newState = cloneState(state);
  newState.players[playerIndex].developmentCards.splice(cardIdx, 1);
  newState.players[playerIndex].hasPlayedDevCardThisTurn = true;

  let totalStolen = 0;
  for (let i = 0; i < newState.players.length; i++) {
    if (i === playerIndex) continue;
    const amount = newState.players[i].resources[resource];
    newState.players[i].resources[resource] = 0;
    totalStolen += amount;
  }
  newState.players[playerIndex].resources[resource] += totalStolen;

  const events: GameEvent[] = [
    { type: "monopoly-played", playerIndex, data: { resource, amount: totalStolen } },
  ];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} played Monopoly on ${resource} (took ${totalStolen})`,
    type: "action",
  });

  if (state.turnPhase === "roll") {
    // Stay in roll phase
  } else {
    newState.turnPhase = "trade-or-build";
  }

  return { valid: true, newState, events };
}

// === Sheep Nuke ===

const SHEEP_NUKE_COST = 10;

function handleSheepNuke(state: GameState, playerIndex: number): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build") return { valid: false, error: "Cannot nuke now" };
  if (!state.config?.sheepNuke) return { valid: false, error: "Sheep nuke is not enabled" };

  const player = state.players[playerIndex];
  const isFreeNuke = !!state.freeNukeAvailable;
  if (!isFreeNuke && player.resources.wool < SHEEP_NUKE_COST) {
    return { valid: false, error: `Need ${SHEEP_NUKE_COST} wool to sheep nuke` };
  }

  const newState = cloneState(state);
  if (isFreeNuke) {
    newState.freeNukeAvailable = false;
  } else {
    newState.players[playerIndex].resources.wool -= SHEEP_NUKE_COST;
  }

  // Roll dice
  const die1 = Math.floor(Math.random() * 6) + 1;
  const die2 = Math.floor(Math.random() * 6) + 1;
  const total = die1 + die2;

  newState.lastDiceRoll = { die1, die2, total };

  const events: GameEvent[] = [
    { type: "sheep-nuke-rolled", playerIndex, data: { die1, die2, total } },
  ];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: isFreeNuke
      ? `${player.name} used FREE NUKE (doubles!) and rolled ${die1} + ${die2} = ${total}!`
      : `${player.name} spent ${SHEEP_NUKE_COST} wool and rolled ${die1} + ${die2} = ${total} for SHEEP NUKE!`,
    type: "action",
  });

  if (total === 7) {
    // Player picks a number
    newState.turnPhase = "sheep-nuke-pick";
    newState.log.push({
      timestamp: Date.now(),
      playerIndex,
      message: `${player.name} rolled a 7 — choose a number to destroy!`,
      type: "action",
    });
    return { valid: true, newState, events };
  }

  // Destroy structures on hexes with this number
  const destroyEvents = destroyStructuresOnNumber(newState, total, playerIndex);
  events.push(...destroyEvents);

  // Free nuke on doubles
  if (newState.config?.doublesRollAgain && die1 === die2) {
    newState.freeNukeAvailable = true;
    events.push({ type: "sheep-nuke-doubles", playerIndex });
    newState.log.push({
      timestamp: Date.now(),
      playerIndex,
      message: `${player.name} rolled doubles — FREE NUKE available!`,
      type: "action",
    });
  }

  newState.turnPhase = "trade-or-build";
  return { valid: true, newState, events };
}

function handleSheepNukePick(state: GameState, playerIndex: number, number: number): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "sheep-nuke-pick") return { valid: false, error: "Not in sheep nuke pick phase" };
  if (number < 2 || number > 12 || number === 7) return { valid: false, error: "Invalid number (must be 2-12, not 7)" };

  const newState = cloneState(state);

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${newState.players[playerIndex].name} chose number ${number} to destroy!`,
    type: "action",
  });

  const events: GameEvent[] = [];
  const destroyEvents = destroyStructuresOnNumber(newState, number, playerIndex);
  events.push(...destroyEvents);

  // Free nuke on doubles (the dice that triggered the pick were doubles if die1===die2)
  if (newState.config?.doublesRollAgain && state.lastDiceRoll && state.lastDiceRoll.die1 === state.lastDiceRoll.die2) {
    newState.freeNukeAvailable = true;
    events.push({ type: "sheep-nuke-doubles", playerIndex });
    newState.log.push({
      timestamp: Date.now(),
      playerIndex,
      message: `${newState.players[playerIndex].name} rolled doubles — FREE NUKE available!`,
      type: "action",
    });
  }

  newState.turnPhase = "trade-or-build";
  return { valid: true, newState, events };
}

function destroyStructuresOnNumber(state: GameState, number: number, instigatorIndex: number): GameEvent[] {
  const events: GameEvent[] = [];
  const destroyedVertices = new Set<string>();
  const destroyedEdges = new Set<string>();

  // Track destruction per player: { playerIndex: { settlements, cities, roads } }
  const destructionByPlayer = new Map<number, { settlements: number; cities: number; roads: number }>();
  const getPlayerDestruction = (pidx: number) => {
    if (!destructionByPlayer.has(pidx)) {
      destructionByPlayer.set(pidx, { settlements: 0, cities: 0, roads: 0 });
    }
    return destructionByPlayer.get(pidx)!;
  };

  // Find all hexes with this number
  for (const [hk, hex] of Object.entries(state.board.hexes)) {
    if (hex.number !== number) continue;

    const parsedHex = parseHexKey(hk);

    // Destroy buildings on vertices of this hex
    for (const vk of hexVertices(parsedHex)) {
      if (destroyedVertices.has(vk)) continue;
      const building = state.board.vertices[vk];
      if (!building) continue;
      destroyedVertices.add(vk);

      const owner = state.players[building.playerIndex];
      if (building.type === "settlement") {
        owner.settlements = owner.settlements.filter((v) => v !== vk);
        owner.victoryPoints -= 1;
        getPlayerDestruction(owner.index).settlements += 1;
      } else if (building.type === "city") {
        owner.cities = owner.cities.filter((v) => v !== vk);
        owner.victoryPoints -= 2;
        getPlayerDestruction(owner.index).cities += 1;
      }
      state.board.vertices[vk] = null;
    }

    // Destroy roads on edges of this hex
    for (const ek of hexEdges(parsedHex)) {
      if (destroyedEdges.has(ek)) continue;
      const road = state.board.edges[ek];
      if (!road) continue;
      destroyedEdges.add(ek);

      const owner = state.players[road.playerIndex];
      owner.roads = owner.roads.filter((e) => e !== ek);
      state.board.edges[ek] = null;
      getPlayerDestruction(owner.index).roads += 1;
    }
  }

  // Log per-player destruction summaries with commentary
  const mildComments = ["took a hit", "felt that one", "needs a moment"];
  const mediumComments = ["got rekt", "is in shambles", "won't recover from that easily"];
  const severeComments = ["is absolutely cooked", "'s empire crumbled to dust", "needs to call 911"];

  for (const [pidx, counts] of destructionByPlayer) {
    const name = state.players[pidx].name;
    const totalLost = counts.settlements + counts.cities + counts.roads;

    // Build the "lost X and Y" summary
    const parts: string[] = [];
    if (counts.settlements > 0) parts.push(`${counts.settlements} settlement${counts.settlements > 1 ? "s" : ""}`);
    if (counts.cities > 0) parts.push(`${counts.cities} cit${counts.cities > 1 ? "ies" : "y"}`);
    if (counts.roads > 0) parts.push(`${counts.roads} road${counts.roads > 1 ? "s" : ""}`);

    state.log.push({
      timestamp: Date.now(),
      playerIndex: pidx,
      message: `${name} lost ${parts.join(" and ")} to the sheep nuke!`,
      type: "action",
    });

    // Pick a funny comment based on severity
    let comment: string;
    if (totalLost <= 2) {
      comment = mildComments[Math.floor(Math.random() * mildComments.length)];
    } else if (totalLost <= 4) {
      comment = mediumComments[Math.floor(Math.random() * mediumComments.length)];
    } else {
      comment = severeComments[Math.floor(Math.random() * severeComments.length)];
    }

    state.log.push({
      timestamp: Date.now(),
      playerIndex: pidx,
      message: `${name} ${comment}`,
      type: "action",
    });
  }

  // Update port access for all affected players
  const affectedPlayers = new Set<number>();
  for (const vk of destroyedVertices) {
    // We already cleared the building, but we need to know which player lost port access
    // Recalculate port access for all players
    for (const p of state.players) affectedPlayers.add(p.index);
  }
  for (const pidx of affectedPlayers) {
    recalculatePortAccess(state, pidx);
  }

  // Update longest road for all players (roads were destroyed)
  if (destroyedEdges.size > 0) {
    const roadResult = updateLongestRoad(state);
    updateLongestRoadState(state, roadResult, events);
  }

  const totalDestroyed = destroyedVertices.size + destroyedEdges.size;
  events.push({
    type: "sheep-nuke-destroyed",
    playerIndex: instigatorIndex,
    data: {
      number,
      buildingsDestroyed: destroyedVertices.size,
      roadsDestroyed: destroyedEdges.size,
      destroyedVertexKeys: Array.from(destroyedVertices),
      destroyedEdgeKeys: Array.from(destroyedEdges),
    },
  });

  if (totalDestroyed === 0) {
    state.log.push({
      timestamp: Date.now(),
      playerIndex: instigatorIndex,
      message: `Sheep nuke on ${number} — nothing was destroyed!`,
      type: "action",
    });
  }

  return events;
}

function recalculatePortAccess(state: GameState, playerIndex: number): void {
  const player = state.players[playerIndex];
  const newPorts: Set<string> = new Set();
  for (const port of state.board.ports) {
    for (const vk of port.edgeVertices) {
      const building = state.board.vertices[vk];
      if (building && building.playerIndex === playerIndex) {
        newPorts.add(port.type);
      }
    }
  }
  player.portsAccess = Array.from(newPorts) as typeof player.portsAccess;
}

// === Turn management ===

function handleEndTurn(state: GameState, playerIndex: number): ActionResult {
  if (state.phase !== "main") return { valid: false, error: "Not in main phase" };
  if (playerIndex !== state.currentPlayerIndex) return { valid: false, error: "Not your turn" };
  if (state.turnPhase !== "trade-or-build") return { valid: false, error: "Cannot end turn now" };

  const newState = cloneState(state);

  // Move new dev cards to playable
  const player = newState.players[playerIndex];
  player.developmentCards.push(...player.newDevelopmentCards);
  player.newDevelopmentCards = [];
  player.hasPlayedDevCardThisTurn = false;

  // Cancel any pending trades
  newState.pendingTrades = [];

  // Reset free nuke
  newState.freeNukeAvailable = false;

  // Doubles roll again: if enabled and last roll was doubles, same player rolls again
  const doublesRollAgain = newState.config?.doublesRollAgain &&
    newState.lastDiceRoll &&
    newState.lastDiceRoll.die1 === newState.lastDiceRoll.die2;

  if (doublesRollAgain) {
    newState.turnPhase = "roll";
    newState.lastDiceRoll = null;

    const events: GameEvent[] = [{ type: "doubles-roll-again", playerIndex }];
    newState.log.push({
      timestamp: Date.now(),
      playerIndex,
      message: `${player.name} rolled doubles — rolling again!`,
      type: "action",
    });
    return { valid: true, newState, events };
  }

  // Advance to next player
  newState.currentPlayerIndex = (playerIndex + 1) % newState.players.length;
  newState.turnNumber += 1;
  newState.turnPhase = "roll";
  newState.lastDiceRoll = null;

  const events: GameEvent[] = [{ type: "turn-ended", playerIndex }];

  newState.log.push({
    timestamp: Date.now(),
    playerIndex,
    message: `${player.name} ended their turn`,
    type: "action",
  });

  return { valid: true, newState, events };
}

// === Helper functions ===

function canAfford(player: PlayerState, cost: Partial<Record<Resource, number>>): boolean {
  for (const [res, amount] of Object.entries(cost)) {
    if ((amount || 0) > player.resources[res as Resource]) return false;
  }
  return true;
}

function deductResources(player: PlayerState, cost: Partial<Record<Resource, number>>) {
  for (const [res, amount] of Object.entries(cost)) {
    if (amount) player.resources[res as Resource] -= amount;
  }
}

function isConnectedToNetwork(state: GameState, playerIndex: number, edge: EdgeKey): boolean {
  const [v1, v2] = edgeEndpoints(edge);

  // Check if either endpoint has a building
  for (const v of [v1, v2]) {
    const building = state.board.vertices[v];
    if (building && building.playerIndex === playerIndex) return true;
  }

  // Check if either endpoint has a connected road
  for (const v of [v1, v2]) {
    // Don't pass through opponent buildings
    const building = state.board.vertices[v];
    if (building && building.playerIndex !== playerIndex) continue;

    const adjacent = edgesAtVertex(v);
    for (const adjEdge of adjacent) {
      if (adjEdge === edge) continue;
      if (state.board.edges[adjEdge]?.playerIndex === playerIndex) return true;
    }
  }

  return false;
}

function getStealTargets(state: GameState, playerIndex: number, hex: HexKey): number[] {
  const targets = new Set<number>();
  const hexCoord = parseHexKey(hex);
  const vertices = hexVertices(hexCoord);

  for (const vk of vertices) {
    const building = state.board.vertices[vk];
    if (building && building.playerIndex !== playerIndex) {
      if (totalResources(state.players[building.playerIndex].resources) > 0) {
        targets.add(building.playerIndex);
      }
    }
  }

  return Array.from(targets);
}

function stealRandomResource(state: GameState, thief: number, victim: number) {
  const victimResources = state.players[victim].resources;
  const available: Resource[] = [];

  for (const res of ALL_RESOURCES) {
    for (let i = 0; i < victimResources[res]; i++) {
      available.push(res);
    }
  }

  if (available.length === 0) return;

  const stolen = available[Math.floor(Math.random() * available.length)];
  state.players[victim].resources[stolen] -= 1;
  state.players[thief].resources[stolen] += 1;
}

function updateLargestArmy(state: GameState, events: GameEvent[]) {
  let holder = state.largestArmyHolder;
  const currentHolderKnights = holder !== null ? state.players[holder].knightsPlayed : 0;

  for (let i = 0; i < state.players.length; i++) {
    const knights = state.players[i].knightsPlayed;
    if (knights >= MIN_KNIGHTS_FOR_LARGEST_ARMY) {
      if (holder === null || knights > currentHolderKnights) {
        if (holder !== null) {
          state.players[holder].hasLargestArmy = false;
          state.players[holder].victoryPoints -= 2;
        }
        holder = i;
        state.players[i].hasLargestArmy = true;
        state.players[i].victoryPoints += 2;
        state.largestArmyHolder = i;
        events.push({
          type: "largest-army-changed",
          playerIndex: i,
          data: { knights },
        });
        break;
      }
    }
  }
}

function updateLongestRoadState(
  state: GameState,
  result: { longestRoadHolder: number | null; playerLengths: number[] },
  events: GameEvent[]
) {
  const oldHolder = state.longestRoadHolder;
  const newHolder = result.longestRoadHolder;

  // Update all player lengths
  for (let i = 0; i < state.players.length; i++) {
    state.players[i].longestRoadLength = result.playerLengths[i];
  }

  if (oldHolder !== newHolder) {
    if (oldHolder !== null) {
      state.players[oldHolder].hasLongestRoad = false;
      state.players[oldHolder].victoryPoints -= 2;
    }
    if (newHolder !== null) {
      state.players[newHolder].hasLongestRoad = true;
      state.players[newHolder].victoryPoints += 2;
    }
    state.longestRoadHolder = newHolder;
    events.push({
      type: "longest-road-changed",
      playerIndex: newHolder,
      data: { length: newHolder !== null ? result.playerLengths[newHolder] : 0 },
    });
  }
}

function checkVictory(state: GameState, playerIndex: number, events: GameEvent[]): ActionResult {
  const player = state.players[playerIndex];
  const totalVP = player.victoryPoints + player.hiddenVictoryPoints;

  if (totalVP >= getVpToWin(state)) {
    state.phase = "finished";
    state.winner = playerIndex;
    events.push({ type: "game-won", playerIndex, data: { vp: totalVP } });
    state.log.push({
      timestamp: Date.now(),
      playerIndex,
      message: `${player.name} wins with ${totalVP} victory points!`,
      type: "system",
    });
  }

  return { valid: true, newState: state, events };
}

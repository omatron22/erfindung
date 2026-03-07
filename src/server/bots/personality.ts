export interface PersonalityWeights {
  cityScore: number;
  settlementScore: number;
  roadScore: number;
  devCardScore: number;
  playerTradeChance: number;
  tradeAcceptThreshold: number;
  counterOfferChance: number;
  robberAggression: number;
  robberSelfProtect: number;
  knightEagerness: number;
  resourceHoarding: number;
  endgameThreshold: number;
  setupDiversity: number;
  portStrategyWeight: number;
}

/**
 * Single optimal weight set based on Catan game theory.
 * All bots play with the same theory-optimal strategy.
 */
const OPTIMAL_WEIGHTS: PersonalityWeights = {
  cityScore: 1.0,
  settlementScore: 1.0,
  roadScore: 1.0,
  devCardScore: 1.0,
  playerTradeChance: 0.4,
  tradeAcceptThreshold: 0,
  counterOfferChance: 0.35,
  robberAggression: 1.0,
  robberSelfProtect: 1.0,
  knightEagerness: 1.0,
  resourceHoarding: 1.0,
  endgameThreshold: 0.8,
  setupDiversity: 1.0,
  portStrategyWeight: 0.5,
};

export function getWeights(): PersonalityWeights {
  return OPTIMAL_WEIGHTS;
}

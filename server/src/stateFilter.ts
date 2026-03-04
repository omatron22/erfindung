import type { GameState, Resource } from "@/shared/types/game";
import type { ClientGameState, ClientPlayerState } from "@/shared/types/messages";

/**
 * Filter game state for a specific player.
 * Hides opponent development cards and shows only resource/devcard counts.
 */
export function filterStateForPlayer(
  state: GameState,
  playerIndex: number
): ClientGameState {
  const players: ClientPlayerState[] = state.players.map((p) => {
    const resourceCount = Object.values(p.resources).reduce(
      (sum: number, n) => sum + n,
      0
    );
    const developmentCardCount =
      p.developmentCards.length + p.newDevelopmentCards.length;

    if (p.index === playerIndex) {
      // Full visibility for the requesting player
      return {
        ...p,
        developmentCards: p.developmentCards,
        newDevelopmentCards: p.newDevelopmentCards,
        resourceCount,
        developmentCardCount,
      };
    }

    // Opponent: hide dev cards, specific resources, and hidden VP
    const { developmentCards, newDevelopmentCards, hiddenVictoryPoints, ...rest } = p;
    return {
      ...rest,
      hiddenVictoryPoints: 0,
      resourceCount,
      developmentCardCount,
    };
  });

  const { developmentCardDeck, ...restState } = state;

  return {
    ...restState,
    players,
    developmentCardDeckCount: developmentCardDeck.length,
    myPlayerIndex: playerIndex,
  };
}

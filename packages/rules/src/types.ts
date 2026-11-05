export type CardColor = "red" | "green" | "blue" | "black";
export type IdentityKind = "witch" | "constable" | "townspeople";
export type RoleId = "sarah-good" | "other";

export interface GameConfig {
  playerCount: number;
  witchCount: number;
  identityCardsPerPlayer: number;
  constableCount: number;
}

export interface ConfigInput {
  playerCount: number;
  witchCount?: number;
  identityCardsPerPlayer?: number;
}

export interface IdentityCard {
  id: string;
  kind: IdentityKind;
}

export interface PlayerState {
  id: number;
  role: RoleId;
  blue: string[];
  hand: string[];
  identityCards: IdentityCard[];
  alive: boolean;
}

export interface GameState {
  config: GameConfig;
  players: PlayerState[];
  discard: string[];
}

export interface CardSpec {
  id: string;
  color: CardColor;
}

export type GameEvent =
  | { type: "cardPlayed"; actorId: number; cardId: string; targetId?: number; sourceId?: number }
  | { type: "cardNullified"; cardId: string; reason: "sarah-good" }
  | { type: "handDiscarded"; playerId: number; count: number }
  | { type: "handTransferred"; fromId: number; toId: number; count: number }
  | { type: "blueAttached"; playerId: number; cardId: string };

export type PlayResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: string };

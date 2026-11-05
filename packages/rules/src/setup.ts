import { identityCardCounts, resolveConfig } from "./config.ts";
import type { GameConfig, GameState, IdentityCard, PlayerState, RoleId } from "./types.ts";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildIdentityDeck(config: GameConfig): IdentityCard[] {
  const counts = identityCardCounts(config);
  const deck: IdentityCard[] = [];
  let n = 0;
  for (let i = 0; i < counts.townspeople; i++) deck.push({ id: "townspeople-" + n++, kind: "townspeople" });
  for (let i = 0; i < counts.witches; i++) deck.push({ id: "witch-" + n++, kind: "witch" });
  for (let i = 0; i < counts.constables; i++) deck.push({ id: "constable-" + n++, kind: "constable" });
  return deck;
}

export interface CreateGameOptions {
  seed?: number;
  roles?: RoleId[];
  hands?: string[][];
}

export function createGame(input: Parameters<typeof resolveConfig>[0], options: CreateGameOptions = {}): GameState {
  const config = resolveConfig(input);
  const random = mulberry32(options.seed ?? 1);
  const deck = shuffle(buildIdentityDeck(config), random);
  const players: PlayerState[] = [];

  for (let i = 0; i < config.playerCount; i++) {
    const identityCards = deck.slice(i * config.identityCardsPerPlayer, (i + 1) * config.identityCardsPerPlayer);
    players.push({
      id: i,
      role: options.roles?.[i] ?? "other",
      blue: [],
      hand: options.hands?.[i]?.slice() ?? [],
      identityCards,
      alive: true,
    });
  }

  return { config, players, discard: [] };
}

export function witchCountOf(player: PlayerState): number {
  return player.identityCards.filter((card) => card.kind === "witch").length;
}

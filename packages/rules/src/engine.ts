import type { CardSpec, GameEvent, GameState, PlayerState, PlayResult } from "./types.ts";

export const CARD_CATALOG: Record<string, CardSpec> = {
  accusation: { id: "accusation", color: "red" },
  evidence: { id: "evidence", color: "red" },
  witness: { id: "witness", color: "red" },
  alibi: { id: "alibi", color: "green" },
  stocks: { id: "stocks", color: "green" },
  scapegoat: { id: "scapegoat", color: "green" },
  arson: { id: "arson", color: "green" },
  curse: { id: "curse", color: "green" },
  robbery: { id: "robbery", color: "green" },
  asylum: { id: "asylum", color: "blue" },
  blackcat: { id: "blackcat", color: "blue" },
  matchmaker: { id: "matchmaker", color: "blue" },
  piety: { id: "piety", color: "blue" },
  conspiracy: { id: "conspiracy", color: "black" },
  night: { id: "night", color: "black" },
};

export function thresholdFor(player: PlayerState): number {
  return player.role === "george-burroughs" ? 8 : 7;
}

export function canPlayCard(
  state: GameState,
  actorId: number,
  cardId: string,
  targetId?: number,
): { ok: true } | { ok: false; reason: string } {
  const card = CARD_CATALOG[cardId];
  if (!card) return { ok: false, reason: "unknown-card" };
  const actor = state.players[actorId];
  if (!actor || !actor.alive) return { ok: false, reason: "actor-not-alive" };
  if (card.color === "black") return { ok: true };
  if (targetId === undefined) return { ok: false, reason: "target-required" };
  const target = state.players[targetId];
  if (!target || !target.alive) return { ok: false, reason: "target-not-alive" };
  if (targetId === actorId) return { ok: false, reason: "cannot-target-self" };

  // 中文旧版信徒：其他玩家不能对你打出红卡。
  // 注意：嫁祸/医生等“移动红卡”的效果不是“打出红卡”，不受此限制。
  if (card.color === "red" && target.blue.includes("piety")) {
    return { ok: false, reason: "piety:red-immunity" };
  }
  return { ok: true };
}

function cloneState(state: GameState): GameState {
  return {
    config: { ...state.config },
    players: state.players.map((p) => ({ ...p, blue: p.blue.slice(), hand: p.hand.slice(), identityCards: p.identityCards.slice() })),
    discard: state.discard.slice(),
  };
}

export function playCard(
  state: GameState,
  action: { actorId: number; cardId: string; targetId?: number; sourceId?: number },
): PlayResult {
  const check = canPlayCard(state, action.actorId, action.cardId, action.targetId);
  if (!check.ok) return { ok: false, reason: check.reason };

  const actor = state.players[action.actorId];
  if (!actor.hand.includes(action.cardId)) return { ok: false, reason: "card-not-in-hand" };

  const next = cloneState(state);
  const nextActor = next.players[action.actorId];
  nextActor.hand.splice(nextActor.hand.indexOf(action.cardId), 1);
  next.discard.push(action.cardId);

  const events: GameEvent[] = [
    { type: "cardPlayed", actorId: action.actorId, cardId: action.cardId, targetId: action.targetId, sourceId: action.sourceId },
  ];
  const card = CARD_CATALOG[action.cardId];
  const target = action.targetId === undefined ? undefined : next.players[action.targetId];

  if (card.color === "green" && action.cardId === "arson" && target) {
    if (target.role === "sarah-good") {
      events.push({ type: "cardNullified", cardId: action.cardId, reason: "sarah-good" });
    } else {
      events.push({ type: "handDiscarded", playerId: target.id, count: target.hand.length });
      target.hand = [];
    }
  } else if (card.color === "green" && action.cardId === "robbery") {
    const source = action.sourceId === undefined ? undefined : next.players[action.sourceId];
    if (!source || !target) return { ok: false, reason: "robbery-source-required" };
    if (source.role === "sarah-good") {
      events.push({ type: "cardNullified", cardId: action.cardId, reason: "sarah-good" });
    } else {
      const count = source.hand.length;
      target.hand.push(...source.hand);
      source.hand = [];
      events.push({ type: "handTransferred", fromId: source.id, toId: target.id, count });
    }
  } else if (card.color === "blue" && target) {
    target.blue.push(action.cardId);
    events.push({ type: "blueAttached", playerId: target.id, cardId: action.cardId });
  }

  return { ok: true, state: next, events };
}

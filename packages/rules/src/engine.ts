import { CARD_CATALOG, pointsOf } from "./cards.ts";
import { findConstableId, nextRandom, shuffleInPlace, updateConstable } from "./setup.ts";
import type {
  ActionResult,
  CardId,
  GameEvent,
  GameState,
  NightState,
  PendingRevealView,
  PlayAction,
  PlayerState,
  Projection,
  PublicPlayer,
  PublicTrial,
  RevealCause,
  RevealCommand,
  RoleId,
  TrialCard,
} from "./types.ts";

export interface NightChoice {
  killerId?: number;
  targetId: number;
  hammerTargetId?: number;
  confessions?: number[];
  /** 威廉·菲普斯：不自首翻牌，但仍获得当夜免疫。 */
  silentConfessions?: number[];
}

export interface DrawOptions {
  night?: NightChoice;
}

function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

function aliveCount(state: GameState): number {
  return state.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
}

function nextAliveId(state: GameState, from: number): number | null {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const id = (from + step) % n;
    if (state.players[id].alive) return id;
  }
  return null;
}

/** 玛莎复制右手边第一个存活玩家（座位号递减方向）。 */
export function effectiveRole(state: GameState, playerId: number): RoleId {
  const player = state.players[playerId];
  if (!player) return "none";
  if (player.role !== "martha-corey") return player.role;
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const id = (playerId - step + n * 2) % n;
    const other = state.players[id];
    if (other.alive && other.role !== "martha-corey" && other.role !== "none") return other.role;
  }
  return "none";
}

export function thresholdFor(state: GameState, targetId: number, attackerId: number): number {
  const targetRole = effectiveRole(state, targetId);
  const attackerRole = effectiveRole(state, attackerId);
  if (attackerRole === "thomas-danforth") return targetRole === "george-burroughs" ? 7 : 6;
  return targetRole === "george-burroughs" ? 8 : 7;
}

export function accusationTotal(state: GameState, playerId: number, cardId?: CardId): number {
  const target = state.players[playerId];
  let total = 0;
  for (const id of target.accusations) {
    if (id === "evidence" && effectiveRole(state, playerId) === "cotton-mather") total += 1;
    else total += pointsOf(id);
  }
  if (cardId) {
    if (cardId === "evidence" && effectiveRole(state, playerId) === "cotton-mather") total += 1;
    else total += pointsOf(cardId);
  }
  return total;
}

function cloneTrial(t: TrialCard): TrialCard {
  return { ...t };
}

export function cloneState(state: GameState): GameState {
  return {
    config: { ...state.config },
    players: state.players.map((p) => ({
      ...p,
      roleOptions: p.roleOptions.slice(),
      hand: p.hand.slice(),
      accusations: p.accusations.slice(),
      blue: p.blue.slice(),
      green: p.green.slice(),
      trials: p.trials.map(cloneTrial),
      used: { ...p.used },
    })),
    deck: state.deck.slice(),
    discard: state.discard.slice(),
    phase: state.phase,
    currentPlayerId: state.currentPlayerId,
    turn: { ...state.turn },
    night: state.night ? { ...state.night, confessions: state.night.confessions.slice() } : null,
    pendingReveal: state.pendingReveal ? { ...state.pendingReveal } : null,
    winner: state.winner,
    winnerReason: state.winnerReason,
    constableId: state.constableId,
    rngState: state.rngState,
    log: state.log.slice(),
  };
}

export function chooseRole(state: GameState, playerId: number, roleId: RoleId): ActionResult {
  if (state.phase !== "deal") return { ok: false, reason: "not-deal-phase" };
  const player = state.players[playerId];
  if (!player) return { ok: false, reason: "unknown-player" };
  if (player.roleChosen) return { ok: false, reason: "role-already-chosen" };
  if (!player.roleOptions.includes(roleId)) return { ok: false, reason: "role-not-offered" };
  const next = cloneState(state);
  const chosen = next.players[playerId];
  chosen.role = roleId;
  chosen.roleOptions = [];
  chosen.roleChosen = true;
  const events: GameEvent[] = [{ type: "roleChosen", playerId, role: roleId }];
  pushEvents(next, events);
  return { ok: true, state: next, events };
}

export function canPlayCard(
  state: GameState,
  actorId: number,
  cardId: CardId,
  targetId?: number,
  sourceId?: number,
  discardIndexes?: number[],
): { ok: true } | { ok: false; reason: string } {
  const card = CARD_CATALOG[cardId];
  if (!card) return { ok: false, reason: "unknown-card" };
  const actor = state.players[actorId];
  if (!actor || !actor.alive) return { ok: false, reason: "actor-not-alive" };
  if (state.phase !== "action") return { ok: false, reason: "not-action-phase" };
  if (state.pendingReveal) return { ok: false, reason: "pending-reveal" };
  if (state.currentPlayerId !== actorId) return { ok: false, reason: "not-your-turn" };
  if (!actor.hand.includes(cardId)) return { ok: false, reason: "card-not-in-hand" };
  if (card.color === "black") return { ok: false, reason: "black-card-resolves-on-draw" };
  if (targetId === undefined) return { ok: false, reason: "target-required" };
  const target = state.players[targetId];
  if (!target || !target.alive) return { ok: false, reason: "target-not-alive" };
  if (targetId === actorId) return { ok: false, reason: "cannot-target-self" };

  if (card.color === "red" && target.blue.includes("piety")) {
    return { ok: false, reason: "piety:red-immunity" };
  }
  if (cardId === "curse" && target.blue.length === 0) {
    return { ok: false, reason: "curse:no-blue-card" };
  }
  if (cardId === "matchmaker" && target.blue.includes("matchmaker")) {
    return { ok: false, reason: "matchmaker:duplicate" };
  }
  if (cardId === "alibi" && discardIndexes !== undefined) {
    if (new Set(discardIndexes).size !== discardIndexes.length) return { ok: false, reason: "alibi:duplicate-index" };
    if (discardIndexes.length === 0 || discardIndexes.length > 3) return { ok: false, reason: "alibi:count" };
    if (discardIndexes.some((i) => !Number.isInteger(i) || i < 0 || i >= target.accusations.length)) {
      return { ok: false, reason: "alibi:bad-index" };
    }
    const picked = discardIndexes.map((i) => target.accusations[i]);
    const evidence = picked.filter((c) => c === "evidence").length;
    if (evidence > 1 || (evidence === 1 && picked.length > 1)) return { ok: false, reason: "alibi:evidence-alone" };
    if (picked.some((c) => c !== "accusation" && c !== "evidence")) return { ok: false, reason: "alibi:not-red" };
  }
  if (cardId === "robbery" || cardId === "scapegoat") {
    if (sourceId === undefined) return { ok: false, reason: "source-required" };
    const source = state.players[sourceId];
    if (!source || !source.alive) return { ok: false, reason: "source-not-alive" };
    if (sourceId === actorId) return { ok: false, reason: "cannot-involve-self" };
    if (sourceId === targetId) return { ok: false, reason: "source-equals-target" };
    if (aliveCount(state) <= 2) return { ok: false, reason: "only-two-players-left" };
  }
  return { ok: true };
}

function pushEvents(state: GameState, events: GameEvent[]): void {
  state.log.push(...events);
}

function revealTrial(
  state: GameState,
  targetId: number,
  chooserId: number,
  cause: string,
  events: GameEvent[],
  trialId?: string,
): boolean {
  const target = state.players[targetId];
  if (!target || !target.alive) return false;
  const trial = trialId
    ? target.trials.find((t) => t.id === trialId && !t.revealed)
    : target.trials.find((t) => !t.revealed);
  if (!trial) {
    // 没有未揭示身份卡：按“所有身份卡已揭示”死亡处理。
    killPlayer(state, targetId, "no-unrevealed-trial", events);
    return false;
  }
  trial.revealed = true;
  events.push({ type: "trialRevealed", playerId: targetId, kind: trial.kind, cause, chooserId });
  if (state.phase === "action" && state.currentPlayerId === chooserId) state.turn.trialsRevealed += 1;
  if (trial.kind === "witch") {
    target.everWitch = true;
    killPlayer(state, targetId, "witch-revealed", events);
    return true;
  }
  if (trial.kind === "constable") updateConstable(state);
  if (target.trials.every((t) => t.revealed)) {
    killPlayer(state, targetId, "all-trials-revealed", events);
  }
  checkWin(state, events);
  return true;
}

function chooseDefaultTrialId(player: PlayerState): string | undefined {
  return player.trials.find((t) => !t.revealed)?.id;
}

function drawTop(state: GameState, events: GameEvent[]): CardId | null {
  if (state.deck.length === 0) {
    reshuffleDeck(state, events);
  }
  if (state.deck.length === 0) return null;
  return state.deck.shift() ?? null;
}

function reshuffleDeck(state: GameState, events: GameEvent[]): void {
  const cards = state.discard.filter((id) => id !== "night");
  const kept = state.deck.filter((id) => id !== "night");
  const all = kept.concat(cards);
  if (all.length === 0) return;
  shuffleInPlace(all, () => nextRandom(state));
  all.push("night");
  state.deck = all;
  state.discard = [];
  events.push({ type: "deckReshuffled", count: all.length - 1 });
}

function drawOne(
  state: GameState,
  events: GameEvent[],
  forEffect: boolean,
  playerId: number = state.currentPlayerId,
): "night" | "ok" | "empty" {
  const cardId = drawTop(state, events);
  if (!cardId) return "empty";
  if (cardId === "night") {
    beginNight(state, events);
    return "night";
  }
  const player = state.players[playerId];
  player.hand.push(cardId);
  if (!forEffect && state.turn.gilesEligible && state.turn.mainDraws.length < 2) {
    state.turn.mainDraws.push(cardId);
  }
  events.push({ type: "cardDrawn", playerId: player.id, count: 1 });
  if (cardId === "conspiracy") {
    resolveConspiracy(state, player.id, events);
  }
  return state.winner ? "ok" : "ok";
}

function beginNight(state: GameState, events: GameEvent[]): void {
  state.phase = "night";
  state.night = { killerId: null, targetId: null, hammerTargetId: null, confessions: [], resolved: false };
  events.push({ type: "nightStarted" });
}

function checkWin(state: GameState, events: GameEvent[]): void {
  if (state.winner) return;
  const totalWitchCards = state.players.reduce(
    (n, p) => n + p.trials.filter((t) => t.kind === "witch").length,
    0,
  );
  const allWitchRevealed =
    totalWitchCards > 0 &&
    state.players.every((p) => p.trials.filter((t) => t.kind === "witch").every((t) => t.revealed));
  if (allWitchRevealed) {
    state.winner = "town";
    state.winnerReason = "所有女巫身份卡都已揭示";
    state.phase = "gameOver";
    events.push({ type: "winner", winner: "town", reason: state.winnerReason });
    return;
  }
  const alive = alivePlayers(state);
  if (alive.length > 0 && alive.every((p) => p.everWitch)) {
    state.winner = "witches";
    state.winnerReason = "所有存活玩家都曾经持有女巫卡";
    state.phase = "gameOver";
    events.push({ type: "winner", winner: "witches", reason: state.winnerReason });
  }
}

function discardFront(state: GameState, player: PlayerState): void {
  state.discard.push(...player.hand, ...player.accusations, ...player.blue, ...player.green);
  player.hand = [];
  player.accusations = [];
  player.blue = [];
  player.green = [];
}

function killPlayer(state: GameState, playerId: number, cause: string, events: GameEvent[]): void {
  const player = state.players[playerId];
  if (!player || !player.alive) return;
  player.alive = false;
  for (const trial of player.trials) {
    trial.revealed = true;
    if (trial.kind === "witch") player.everWitch = true;
  }
  updateConstable(state);
  events.push({ type: "playerDied", playerId, cause, everWitch: player.everWitch });

  const matchmaker = player.blue.includes("matchmaker");
  let partnerId: number | null = null;
  if (matchmaker) {
    const partner = state.players.find((p) => p.id !== playerId && p.alive && p.blue.includes("matchmaker"));
    if (partner) partnerId = partner.id;
  }

  // 约翰·普罗克特在其他玩家死亡时先拿牌；默认取前 3 张，服务端可改为交互式。
  for (const other of state.players) {
    if (!other.alive || other.id === playerId) continue;
    if (effectiveRole(state, other.id) !== "john-proctor") continue;
    const take = Math.min(3, player.hand.length);
    const picked = player.hand.splice(0, take);
    other.hand.push(...picked);
    events.push({ type: "handTransferred", fromId: playerId, toId: other.id, count: take });
    events.push({ type: "powerUsed", playerId: other.id, power: "john-proctor" });
    break;
  }

  discardFront(state, player);
  checkWin(state, events);
  if (state.winner) return;

  // 情侣连锁：玛丽·沃伦当搭档时不死；玛丽自己死时搭档仍死。
  if (partnerId !== null && state.players[partnerId].alive) {
    if (effectiveRole(state, partnerId) !== "mary-warren") {
      events.push({ type: "matchmakerBroke", playerIds: [playerId, partnerId] });
      killPlayer(state, partnerId, "matchmaker", events);
    }
  }
}

/**
 * 放弃只在「托马斯·丹福斯把普通玩家压到第 6 点」时可选：
 * 再往上的点数按普通门槛正常触发，不再给第二次放弃机会。
 */
function canDeclineReveal(state: GameState, targetId: number, chooserId: number, cause: RevealCause): boolean {
  if (cause !== "accusation") return false;
  if (thresholdFor(state, targetId, chooserId) !== 6) return false;
  return accusationTotal(state, targetId) === 6;
}

/** 揭示之后的附带结算：清空目标红卡、阿比盖尔弃自己的红卡、丽贝卡抽 1。 */
function settleAfterReveal(
  state: GameState,
  targetId: number,
  chooserId: number,
  cause: RevealCause,
  useAbigail: boolean,
  events: GameEvent[],
): void {
  const target = state.players[targetId];
  const count = target.accusations.length;
  state.discard.push(...target.accusations);
  target.accusations = [];
  events.push({ type: "accusationsDiscarded", playerId: targetId, count });
  const actor = state.players[chooserId];
  if (useAbigail && actor && actor.alive && effectiveRole(state, chooserId) === "abigail-williams" && actor.accusations.length > 0) {
    const own = actor.accusations.length;
    state.discard.push(...actor.accusations);
    actor.accusations = [];
    events.push({ type: "accusationsDiscarded", playerId: chooserId, count: own });
    events.push({ type: "powerUsed", playerId: chooserId, power: "abigail-williams" });
  }
  // 丽贝卡：其他玩家因指控翻牌时抽 1。
  if (cause !== "accusation") return;
  const rebecca = state.players.find((p) => p.alive && effectiveRole(state, p.id) === "rebecca-nurse");
  if (rebecca && rebecca.id !== targetId && !state.winner) drawOne(state, events, true, rebecca.id);
}

/**
 * 达到门槛后的揭示入口：只剩一张未揭示时直接翻开，否则挂起等选择者指定位置。
 * 卡 id 在挂起期间不离开规则层，对外只发位置号。
 */
function triggerReveal(
  state: GameState,
  targetId: number,
  chooserId: number,
  cause: RevealCause,
  events: GameEvent[],
  useAbigail = false,
): void {
  const target = state.players[targetId];
  if (!target || !target.alive) return;
  const hidden = target.trials.filter((t) => !t.revealed);
  if (hidden.length === 0) {
    // 没有未揭示身份卡：按“所有身份卡已揭示”死亡处理。
    killPlayer(state, targetId, "no-unrevealed-trial", events);
    settleAfterReveal(state, targetId, chooserId, cause, useAbigail, events);
    return;
  }
  if (hidden.length === 1) {
    revealTrial(state, targetId, chooserId, cause, events, hidden[0].id);
    settleAfterReveal(state, targetId, chooserId, cause, useAbigail, events);
    return;
  }
  state.pendingReveal = {
    targetId,
    chooserId,
    cause,
    canDecline: canDeclineReveal(state, targetId, chooserId, cause),
    useAbigail,
  };
}

function addAccusation(
  state: GameState,
  targetId: number,
  cardId: CardId,
  attackerId: number,
  events: GameEvent[],
  useAbigail = false,
): void {
  const target = state.players[targetId];
  target.accusations.push(cardId);
  const points = cardId === "evidence" && effectiveRole(state, targetId) === "cotton-mather" ? 1 : pointsOf(cardId);
  const total = accusationTotal(state, targetId);
  events.push({ type: "accusationAdded", targetId, cardId, points, total });
  if (total >= thresholdFor(state, targetId, attackerId)) {
    triggerReveal(state, targetId, attackerId, "accusation", events, useAbigail);
  }
}

export function playCard(state: GameState, action: PlayAction): ActionResult {
  const check = canPlayCard(state, action.actorId, action.cardId, action.targetId, action.sourceId, action.discardIndexes);
  if (!check.ok) return { ok: false, reason: check.reason };
  const next = cloneState(state);
  const events: GameEvent[] = [
    { type: "cardPlayed", actorId: action.actorId, cardId: action.cardId, targetId: action.targetId, sourceId: action.sourceId, asWitness: action.asWitness },
  ];
  const actor = next.players[action.actorId];
  const card = CARD_CATALOG[action.cardId];
  const target = action.targetId === undefined ? undefined : next.players[action.targetId];

  actor.hand.splice(actor.hand.indexOf(action.cardId), 1);
  actor.used = { ...actor.used };

  if (card.color === "red") {
    if (target) addAccusation(next, target.id, action.cardId, actor.id, events, action.useAbigail === true);
  } else if (action.cardId === "alibi") {
    if (action.asWitness) {
      if (effectiveRole(next, actor.id) !== "will-griggs") return { ok: false, reason: "only-will-griggs" };
      if (target) addAccusation(next, target.id, "witness", actor.id, events, action.useAbigail === true);
      next.discard.push(action.cardId);
    } else {
      if (target) {
        let indexes: number[];
        if (action.discardIndexes?.length) {
          indexes = action.discardIndexes.slice().sort((a, b) => b - a);
        } else {
          // 未指定时按规则自动挑：优先最多 3 张指控；没有指控则弃 1 张证据。
          const accusations = target.accusations
            .map((c, i) => ({ c, i }))
            .filter((x) => x.c === "accusation")
            .slice(0, 3)
            .map((x) => x.i);
          if (accusations.length) indexes = accusations.sort((a, b) => b - a);
          else {
            const evidence = target.accusations.indexOf("evidence");
            indexes = evidence >= 0 ? [evidence] : [];
          }
        }
        const removed: CardId[] = [];
        for (const index of indexes) removed.push(...target.accusations.splice(index, 1));
        next.discard.push(...removed);
        events.push({ type: "accusationsDiscarded", playerId: target.id, count: removed.length });
      }
      next.discard.push(action.cardId);
    }
  } else if (action.cardId === "arson") {
    if (target) {
      if (effectiveRole(next, target.id) === "sarah-good") {
        events.push({ type: "cardNullified", cardId: "arson", reason: "sarah-good" });
      } else {
        events.push({ type: "handDiscarded", playerId: target.id, count: target.hand.length });
        next.discard.push(...target.hand);
        target.hand = [];
      }
    }
    next.discard.push(action.cardId);
  } else if (action.cardId === "curse") {
    if (target) {
      const wanted = action.blueCardId ?? target.blue[0];
      const at = target.blue.indexOf(wanted);
      if (at >= 0) {
        target.blue.splice(at, 1);
        next.discard.push(wanted);
        events.push({ type: "blueDiscarded", playerId: target.id, cardId: wanted });
        if (wanted === "piety" && accusationTotal(next, target.id) >= thresholdFor(next, target.id, actor.id)) {
          triggerReveal(next, target.id, actor.id, "curse", events, action.useAbigail === true);
        }
      }
    }
    next.discard.push(action.cardId);
  } else if (action.cardId === "robbery") {
    const source = action.sourceId === undefined ? undefined : next.players[action.sourceId];
    if (!source || !target) return { ok: false, reason: "source-required" };
    if (effectiveRole(next, source.id) === "sarah-good") {
      events.push({ type: "cardNullified", cardId: "robbery", reason: "sarah-good" });
    } else {
      const count = source.hand.length;
      target.hand.push(...source.hand);
      source.hand = [];
      events.push({ type: "handTransferred", fromId: source.id, toId: target.id, count });
    }
    next.discard.push(action.cardId);
  } else if (action.cardId === "scapegoat") {
    const source = action.sourceId === undefined ? undefined : next.players[action.sourceId];
    if (!source || !target) return { ok: false, reason: "source-required" };
    const red = source.accusations.length;
    const blue = source.blue.length;
    const green = source.green.length;
    target.accusations.push(...source.accusations);
    target.blue.push(...source.blue);
    target.green.push(...source.green);
    source.accusations = [];
    source.blue = [];
    source.green = [];
    events.push({ type: "frontMoved", fromId: source.id, toId: target.id, red, blue, green });
    const matchmakers = target.blue.filter((c) => c === "matchmaker").length;
    if (matchmakers >= 2) {
      target.blue = target.blue.filter((c) => c !== "matchmaker");
      next.discard.push(...Array.from({ length: matchmakers }, () => "matchmaker" as CardId));
      events.push({ type: "matchmakerBroke", playerIds: [target.id] });
    }
    if (accusationTotal(next, target.id) >= thresholdFor(next, target.id, actor.id)) {
      triggerReveal(next, target.id, actor.id, "scapegoat", events, action.useAbigail === true);
    }
    next.discard.push(action.cardId);
  } else if (action.cardId === "stocks") {
    if (target) {
      target.green.push("stocks");
      events.push({ type: "blueAttached", playerId: target.id, cardId: "stocks" });
    }
  } else if (card.color === "blue") {
    if (target) {
      target.blue.push(action.cardId);
      events.push({ type: "blueAttached", playerId: target.id, cardId: action.cardId });
      if (action.cardId === "matchmaker" && target.blue.filter((c) => c === "matchmaker").length >= 2) {
        target.blue = target.blue.filter((c) => c !== "matchmaker");
        next.discard.push("matchmaker", "matchmaker");
        events.push({ type: "matchmakerBroke", playerIds: [target.id] });
      }
    }
  } else {
    return { ok: false, reason: "black-card-resolves-on-draw" };
  }

  next.turn.cardsPlayed += 1;
  next.turn.actionTaken = true;
  pushEvents(next, events);
  checkWin(next, events);
  return { ok: true, state: next, events };
}

/**
 * 结算挂起式揭示：按位置号翻开目标那一张身份卡，或（仅丹福斯对普通玩家第 6 点）放弃。
 * 位置号在规则层映射回身份卡 id，卡 id 不出规则包。
 */
export function resolvePendingReveal(state: GameState, actorId: number, command: RevealCommand): ActionResult {
  const pending = state.pendingReveal;
  if (!pending) return { ok: false, reason: "no-pending-reveal" };
  if (pending.chooserId !== actorId) return { ok: false, reason: "not-chooser" };
  const target = state.players[pending.targetId];
  if (!target) return { ok: false, reason: "unknown-target" };

  if (command.kind === "decline") {
    if (!pending.canDecline) return { ok: false, reason: "cannot-decline" };
    const next = cloneState(state);
    const declined = next.players[pending.targetId];
    next.pendingReveal = null;
    const events: GameEvent[] = [
      { type: "notice", text: next.players[actorId].name + " 放弃揭示：" + declined.name + " 面前的红卡保留。" },
    ];
    pushEvents(next, events);
    return { ok: true, state: next, events };
  }

  if (!Number.isInteger(command.trialIndex) || command.trialIndex < 0 || command.trialIndex >= target.trials.length) {
    return { ok: false, reason: "bad-trial-index" };
  }
  if (target.trials[command.trialIndex].revealed) return { ok: false, reason: "trial-already-revealed" };

  const next = cloneState(state);
  const trialId = next.players[pending.targetId].trials[command.trialIndex].id;
  next.pendingReveal = null;
  const events: GameEvent[] = [];
  revealTrial(next, pending.targetId, pending.chooserId, pending.cause, events, trialId);
  settleAfterReveal(next, pending.targetId, pending.chooserId, pending.cause, pending.useAbigail, events);
  pushEvents(next, events);
  return { ok: true, state: next, events };
}

/** 贾尔斯·科里：一次抽两张若都是红卡，展示后补抽第三张。 */
function maybeGilesDraw(state: GameState, events: GameEvent[]): void {
  if (!state.turn.gilesEligible || state.winner) return;
  const actor = state.players[state.currentPlayerId];
  if (!actor || effectiveRole(state, actor.id) !== "giles-corey") {
    state.turn.gilesEligible = false;
    return;
  }
  if (state.turn.mainDraws.length < 2) return;
  state.turn.gilesEligible = false;
  const firstTwo = state.turn.mainDraws.slice(0, 2);
  if (!firstTwo.every((id) => CARD_CATALOG[id].color === "red")) return;
  events.push({ type: "powerUsed", playerId: actor.id, power: "giles-corey" });
  drawOne(state, events, true);
}

function continueDraws(state: GameState, events: GameEvent[], options: DrawOptions = {}): void {
  while (state.turn.pendingDraws > 0 && !state.winner) {
    const current = state.players[state.currentPlayerId];
    // 抽牌过程中当前玩家可能因夜晚、传染或指控死亡；剩余抽牌作废，直接推进到下一个存活玩家。
    if (!current || !current.alive) {
      state.turn.pendingDraws = 0;
      advanceTurn(state, events);
      return;
    }
    state.turn.pendingDraws -= 1;
    const result = drawOne(state, events, false);
    if (result === "night") {
      if (options.night) {
        resolveNightInternal(state, options.night, events);
        continue;
      }
      return;
    }
    if (result === "empty") break;
  }
  if (state.winner) return;
  if (state.phase === "night") return;
  maybeGilesDraw(state, events);
  if (state.winner || state.phase === "night") return;
  if (state.turn.ending) {
    advanceTurn(state, events);
  } else {
    endTurnInternal(state, events);
  }
}

export function drawTwo(state: GameState, options: DrawOptions = {}): ActionResult {
  if (state.phase !== "action") return { ok: false, reason: "not-action-phase" };
  if (state.pendingReveal) return { ok: false, reason: "pending-reveal" };
  if (state.turn.actionTaken) return { ok: false, reason: "action-already-taken" };
  const next = cloneState(state);
  const events: GameEvent[] = [];
  next.turn.actionTaken = true;
  next.turn.pendingDraws = 2;
  next.turn.mainDraws = [];
  next.turn.gilesEligible = true;
  continueDraws(next, events, options);
  pushEvents(next, events);
  return { ok: true, state: next, events };
}

export function endTurn(state: GameState): ActionResult {
  if (state.phase !== "action") return { ok: false, reason: "not-action-phase" };
  if (state.pendingReveal) return { ok: false, reason: "pending-reveal" };
  if (!state.turn.actionTaken) return { ok: false, reason: "must-draw-or-play" };
  const next = cloneState(state);
  const events: GameEvent[] = [];
  endTurnInternal(next, events);
  pushEvents(next, events);
  return { ok: true, state: next, events };
}

function endTurnInternal(state: GameState, events: GameEvent[]): void {
  if (state.winner) return;
  const player = state.players[state.currentPlayerId];
  if (effectiveRole(state, player.id) === "anne-putnam" && state.turn.trialsRevealed > 0) {
    state.turn.ending = true;
    state.turn.pendingDraws += state.turn.trialsRevealed * 2;
    events.push({ type: "powerUsed", playerId: player.id, power: "anne-putnam" });
    continueDraws(state, events);
    return;
  }
  advanceTurn(state, events);
}

function advanceTurn(state: GameState, events: GameEvent[]): void {
  if (state.winner) return;
  const current = state.players[state.currentPlayerId];
  events.push({ type: "turnEnded", playerId: current.id });
  const next = nextAliveId(state, current.id);
  if (next === null) {
    checkWin(state, events);
    return;
  }
  state.currentPlayerId = next;
  startTurnInternal(state, events);
}

function startTurnInternal(state: GameState, events: GameEvent[]): void {
  if (state.winner) return;
  let id = state.currentPlayerId;
  let guard = 0;
  while (guard++ < state.players.length * 4) {
    const player = state.players[id];
    if (!player.alive) {
      const n = nextAliveId(state, id);
      if (n === null) return;
      id = n;
      continue;
    }
    if (player.green.includes("stocks")) {
      const at = player.green.indexOf("stocks");
      player.green.splice(at, 1);
      state.discard.push("stocks");
      events.push({ type: "stocksSkipped", playerId: id, remaining: player.green.filter((c) => c === "stocks").length });
      const n = nextAliveId(state, id);
      if (n === null) return;
      id = n;
      continue;
    }
    break;
  }
  state.currentPlayerId = id;
  state.phase = "action";
  state.turn = { playerId: id, actionTaken: false, drewThisTurn: 0, cardsPlayed: 0, trialsRevealed: 0, pendingDraws: 0, ending: false, mainDraws: [], gilesEligible: false };
  events.push({ type: "turnStarted", playerId: id });
}

function resolveConspiracy(state: GameState, drawerId: number, events: GameEvent[]): void {
  events.push({ type: "conspiracyStarted", drawerId });
  const holder = state.players.find((p) => p.alive && p.blue.includes("blackcat"));
  if (holder && effectiveRole(state, holder.id) !== "mary-warren") {
    const trial = holder.trials.find((t) => !t.revealed);
    if (trial) {
      revealTrial(state, holder.id, drawerId, "conspiracy", events, trial.id);
      if (state.winner) return;
    }
  }
  const picks: { to: PlayerState; from: PlayerState; trial: TrialCard }[] = [];
  for (const to of state.players) {
    if (!to.alive) continue;
    const fromId = (to.id + 1) % state.players.length;
    const from = state.players[fromId];
    if (!from.alive) continue;
    const trial = from.trials.find((t) => !t.revealed);
    if (trial) picks.push({ to, from, trial });
  }
  for (const pick of picks) {
    pick.from.trials = pick.from.trials.filter((t) => t.id !== pick.trial.id);
    pick.to.trials.push({ ...pick.trial, revealed: false });
    events.push({ type: "conspiracySwap", fromId: pick.from.id, toId: pick.to.id });
  }
  for (const player of state.players) {
    player.everWitch = player.everWitch || player.trials.some((t) => t.kind === "witch");
  }
  // 规则书未覆盖的边界：存活玩家把最后一张身份卡传给左邻、而自己的左邻已死时，
  // 会没有任何身份卡，也就永远无法再被指控翻牌。按“无身份即出局”处理，避免不死状态。
  for (const player of state.players.slice()) {
    if (player.alive && player.trials.length === 0) {
      killPlayer(state, player.id, "no-trials", events);
      if (state.winner) return;
    }
  }
  updateConstable(state);
  checkWin(state, events);
}

export function confess(state: GameState, playerId: number, trialId?: string, useWilliam = false): ActionResult {
  if (state.phase !== "night" || !state.night || state.night.resolved) return { ok: false, reason: "not-night" };
  const player = state.players[playerId];
  if (!player || !player.alive) return { ok: false, reason: "player-not-alive" };
  if (state.night.confessions.includes(playerId)) return { ok: false, reason: "already-confessed" };
  const next = cloneState(state);
  const events: GameEvent[] = [];
  const p = next.players[playerId];
  if (useWilliam) {
    if (effectiveRole(next, playerId) !== "william-phipps") return { ok: false, reason: "not-william-phipps" };
    if (p.used.william) return { ok: false, reason: "william-power-used" };
    p.used.william = true;
    next.night!.confessions.push(playerId);
    events.push({ type: "confession", playerId, revealed: false });
    events.push({ type: "powerUsed", playerId, power: "william-phipps" });
  } else {
    const trial = trialId ? p.trials.find((t) => t.id === trialId && !t.revealed) : p.trials.find((t) => !t.revealed);
    if (!trial) return { ok: false, reason: "no-unrevealed-trial" };
    next.night!.confessions.push(playerId);
    events.push({ type: "confession", playerId, revealed: true });
    revealTrial(next, playerId, playerId, "confession", events, trial.id);
  }
  pushEvents(next, events);
  return { ok: true, state: next, events };
}

export function resolveNight(state: GameState, choice: NightChoice): ActionResult {
  if (state.phase !== "night" || !state.night) return { ok: false, reason: "not-night" };
  const next = cloneState(state);
  const events: GameEvent[] = [];
  resolveNightInternal(next, choice, events);
  pushEvents(next, events);
  return { ok: true, state: next, events };
}

function resolveNightInternal(state: GameState, choice: NightChoice, events: GameEvent[]): void {
  const night = state.night;
  if (!night) return;
  const target = state.players[choice.targetId];
  if (!target || !target.alive) {
    events.push({ type: "notice", text: "夜杀目标已死亡，夜晚空过。" });
    finishNight(state, events);
    return;
  }
  night.killerId = choice.killerId ?? state.players.find((p) => p.alive && p.everWitch)?.id ?? null;
  night.targetId = target.id;
  night.hammerTargetId = choice.hammerTargetId ?? null;
  if (night.hammerTargetId !== null) {
    const hammer = state.players[night.hammerTargetId];
    // hammerTargetId 是被木槌赦免的玩家；必须先有在任警长。
    if (!hammer || !hammer.alive || state.constableId === null || night.hammerTargetId === state.constableId) {
      night.hammerTargetId = null;
    }
  }
  for (const id of choice.confessions ?? []) {
    if (night.confessions.includes(id)) continue;
    const p = state.players[id];
    if (!p || !p.alive) continue;
    night.confessions.push(id);
    events.push({ type: "confession", playerId: id, revealed: true });
    revealTrial(state, id, id, "confession", events);
    if (state.winner) return;
  }
  for (const id of choice.silentConfessions ?? []) {
    if (night.confessions.includes(id)) continue;
    const p = state.players[id];
    if (!p || !p.alive) continue;
    if (effectiveRole(state, id) !== "william-phipps" || p.used.william) continue;
    p.used.william = true;
    night.confessions.push(id);
    events.push({ type: "confession", playerId: id, revealed: false });
    events.push({ type: "powerUsed", playerId: id, power: "william-phipps" });
  }
  if (state.players[target.id].alive) {
    const saved = target.blue.includes("asylum") || night.hammerTargetId === target.id || night.confessions.includes(target.id);
    events.push({ type: "nightResolved", targetId: target.id, saved, cause: saved ? "saved" : "night-kill" });
    if (!saved) killPlayer(state, target.id, "night-kill", events);
  }
  finishNight(state, events);
}

function finishNight(state: GameState, events: GameEvent[]): void {
  state.night = null;
  // 夜晚结束后先回到可行动态，再续抽/推进回合；否则续抽逻辑会因 phase 仍是 night 提前返回。
  if (!state.winner) state.phase = "action";
  const cards = state.deck.concat(state.discard).filter((id) => id !== "night");
  shuffleInPlace(cards, () => nextRandom(state));
  cards.push("night");
  state.deck = cards;
  state.discard = [];
  if (state.winner) return;
  if (state.turn.pendingDraws > 0) {
    continueDraws(state, events);
    return;
  }
  if (state.turn.ending) {
    advanceTurn(state, events);
  } else {
    endTurnInternal(state, events);
  }
}

export function samuelTake(state: GameState, actorId: number, cardIds: CardId[]): ActionResult {
  if (state.phase !== "action" || state.currentPlayerId !== actorId) return { ok: false, reason: "not-your-turn" };
  if (state.pendingReveal) return { ok: false, reason: "pending-reveal" };
  const actor = state.players[actorId];
  if (!actor || !actor.alive) return { ok: false, reason: "actor-not-alive" };
  if (effectiveRole(state, actorId) !== "samuel-parris") return { ok: false, reason: "not-samuel" };
  if (actor.used.samuel >= 2) return { ok: false, reason: "samuel-power-used" };
  if (cardIds.length > 2) return { ok: false, reason: "too-many-cards" };
  if (state.turn.actionTaken) return { ok: false, reason: "action-already-taken" };
  const next = cloneState(state);
  const events: GameEvent[] = [];
  const p = next.players[actorId];
  for (const id of cardIds) {
    if (CARD_CATALOG[id].color === "black") return { ok: false, reason: "cannot-take-black" };
    const at = next.discard.indexOf(id);
    if (at < 0) return { ok: false, reason: "card-not-in-discard" };
    next.discard.splice(at, 1);
    p.hand.push(id);
  }
  p.used.samuel += 1;
  next.turn.actionTaken = true;
  events.push({ type: "powerUsed", playerId: actorId, power: "samuel-parris" });
  pushEvents(next, events);
  endTurnInternal(next, events);
  return { ok: true, state: next, events };
}

export function titubaReorder(state: GameState, actorId: number, order: CardId[]): ActionResult {
  if (state.phase !== "action" || state.currentPlayerId !== actorId) return { ok: false, reason: "not-your-turn" };
  if (state.pendingReveal) return { ok: false, reason: "pending-reveal" };
  const actor = state.players[actorId];
  if (!actor || !actor.alive) return { ok: false, reason: "actor-not-alive" };
  if (effectiveRole(state, actorId) !== "tituba") return { ok: false, reason: "not-tituba" };
  if (actor.used.tituba) return { ok: false, reason: "tituba-power-used" };
  if (order.length !== state.deck.length) return { ok: false, reason: "order-must-cover-deck" };
  const sorted = order.slice().sort();
  const current = state.deck.slice().sort();
  if (sorted.join(",") !== current.join(",")) return { ok: false, reason: "order-not-permutation" };
  const next = cloneState(state);
  const events: GameEvent[] = [];
  next.deck = order.slice();
  next.players[actorId].used.tituba = true;
  events.push({ type: "powerUsed", playerId: actorId, power: "tituba" });
  pushEvents(next, events);
  return { ok: true, state: next, events };
}

export function project(state: GameState, viewerId: number): Projection {
  const viewer = state.players[viewerId];
  if (!viewer) throw new Error("unknown-viewer");
  const seats: PublicPlayer[] = state.players.map((p) => {
    const trials: PublicTrial[] = p.trials.map((t) => ({
      id: p.id === viewerId || t.revealed ? t.id : "hidden-" + p.id + "-" + p.trials.indexOf(t),
      kind: p.id === viewerId || t.revealed ? t.kind : null,
      revealed: t.revealed,
    }));
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      roleOptions: p.roleOptions.slice(),
      roleChosen: p.roleChosen,
      alive: p.alive,
      handCount: p.hand.length,
      accusations: accusationTotal(state, p.id),
      accusationsCards: p.accusations.slice(),
      blue: p.blue.slice(),
      green: p.green.slice(),
      trials,
      everWitch: p.id === viewerId || !p.alive ? p.everWitch : null,
    };
  });
  const projection: Projection = {
    version: state.log.length,
    phase: state.phase,
    currentPlayerId: state.currentPlayerId,
    actionTaken: state.turn.actionTaken,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    discard: state.discard.slice(),
    deckOrder: effectiveRole(state, viewerId) === "tituba" && !viewer.used.tituba ? state.deck.slice() : null,
    winner: state.winner,
    winnerReason: state.winnerReason,
    log: state.log.slice(),
    self: {
      id: viewer.id,
      role: viewer.role,
      hand: viewer.hand.slice(),
      accusations: viewer.accusations.slice(),
      blue: viewer.blue.slice(),
      green: viewer.green.slice(),
      trials: viewer.trials.map(cloneTrial),
      alive: viewer.alive,
      everWitch: viewer.everWitch,
      used: { ...viewer.used },
    },
    seats,
    night: state.night ? { active: true, targetKnown: false } : null,
  };
  // 挂起态只投给选择者：位置号是公开可说的，「哪一张是哪张」不是。
  const pending = state.pendingReveal;
  if (pending && pending.chooserId === viewerId) {
    const view: PendingRevealView = {
      chooserId: pending.chooserId,
      targetId: pending.targetId,
      slots: state.players[pending.targetId].trials.map((t) => (t.revealed ? "revealed" : "hidden")),
      canDecline: pending.canDecline,
    };
    projection.pendingReveal = view;
  }
  return projection;
}

export function defaultNightChoice(state: GameState): NightChoice {
  const killer = state.players.find((p) => p.alive && p.everWitch);
  const targets = state.players.filter((p) => p.alive && p.id !== killer?.id);
  return {
    killerId: killer?.id,
    targetId: targets[0]?.id ?? state.players.find((p) => p.alive)?.id ?? 0,
    confessions: [],
  };
}

export function resolveConspiracyForTest(state: GameState, drawerId: number): void {
  const events: GameEvent[] = [];
  resolveConspiracy(state, drawerId, events);
  state.log.push(...events);
}

export function beginNightForTest(state: GameState): void {
  const events: GameEvent[] = [];
  beginNight(state, events);
  state.log.push(...events);
}

export function forceRevealForTest(state: GameState, targetId: number, chooserId: number, cause = "test"): void {
  const events: GameEvent[] = [];
  revealTrial(state, targetId, chooserId, cause, events);
  state.log.push(...events);
}

export function forceKillForTest(state: GameState, playerId: number, cause = "test"): void {
  const events: GameEvent[] = [];
  killPlayer(state, playerId, cause, events);
  state.log.push(...events);
}

export function findBlackCatHolder(state: GameState): number | null {
  return state.players.find((p) => p.alive && p.blue.includes("blackcat"))?.id ?? null;
}

export function remainingWitchCards(state: GameState): number {
  return state.players.reduce((n, p) => n + p.trials.filter((t) => t.kind === "witch" && !t.revealed).length, 0);
}

export function constableId(state: GameState): number | null {
  return findConstableId(state);
}

export function nightState(state: GameState): NightState | null {
  return state.night ? { ...state.night, confessions: state.night.confessions.slice() } : null;
}

export function playerAt(state: GameState, id: number): PlayerState | undefined {
  return state.players[id];
}
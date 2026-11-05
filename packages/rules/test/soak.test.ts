import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_CATALOG,
  canPlayCard,
  createGame,
  defaultNightChoice,
  drawTwo,
  effectiveRole,
  endTurn,
  finishDeal,
  playCard,
  project,
  resolveNight,
  startGame,
} from "../src/index.ts";
import type { CardId, GameState, PlayAction, RoleId } from "../src/types.ts";

const FULL_CARD_COUNT = Object.values(CARD_CATALOG).reduce((n, c) => n + c.count, 0);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function cardCount(state: GameState): number {
  let total = state.deck.length + state.discard.length;
  for (const p of state.players) {
    total += p.hand.length + p.accusations.length + p.blue.length + p.green.length;
  }
  return total;
}

function assertInvariants(state: GameState, label: string): void {
  // 夜晚阶段夜晚牌已从牌堆抽走、尚未在结算后放回，账面上在“夜晚状态”里。
  const expected = FULL_CARD_COUNT - (state.phase === "night" ? 1 : 0);
  assert.equal(cardCount(state), expected, label + " 牌张守恒");
  assert.equal(state.night === null || state.phase === "night", true, label + " 夜晚状态与阶段一致");
  for (const p of state.players) {
    if (!p.alive) {
      assert.equal(p.hand.length + p.accusations.length + p.blue.length + p.green.length, 0, label + " 死者面前无牌");
    }
    assert.ok(p.hand.length <= FULL_CARD_COUNT, label + " 手牌数量合理");
    if (p.alive) assert.ok(p.trials.length > 0, label + " 存活玩家至少一张身份卡");
  }
}

function assertProjection(state: GameState, label: string): void {
  for (const viewer of state.players) {
    const view = project(state, viewer.id);
    assert.deepEqual(view.self.hand, viewer.hand, label + " 自己手牌可见");
    assert.equal(view.self.id, viewer.id);
    for (const seat of view.seats) {
      assert.equal("hand" in seat, false, label + " 投影不带他人手牌");
      if (seat.id !== viewer.id) {
        for (const trial of seat.trials) {
          if (!trial.revealed) {
            assert.equal(trial.kind, null, label + " 未揭示身份卡不可见");
            assert.match(trial.id, /^hidden-/, label + " 未揭示身份卡 id 脱敏");
          }
        }
        const source = state.players[seat.id];
        if (source.alive) assert.equal(seat.everWitch, null, label + " 活人 everWitch 不可见");
      }
    }
    const tituba = effectiveRole(state, viewer.id) === "tituba" && !viewer.used.tituba;
    if (tituba) {
      assert.equal(view.deckOrder?.length, state.deck.length, label + " 蒂图巴可见牌堆顺序");
    } else {
      assert.equal(view.deckOrder, null, label + " 他人不可见牌堆顺序");
    }
  }
}

function candidates(state: GameState): PlayAction[] {
  const actor = state.players[state.currentPlayerId];
  if (!actor || !actor.alive) return [];
  const others = state.players.filter((p) => p.alive && p.id !== actor.id);
  const out: PlayAction[] = [];
  for (const cardId of [...new Set(actor.hand)]) {
    const spec = CARD_CATALOG[cardId];
    if (spec.color === "black") continue;
    for (const target of others) {
      const withSource = cardId === "robbery" || cardId === "scapegoat";
      const sources = withSource ? others.filter((s) => s.id !== target.id) : [undefined];
      for (const source of sources) {
        let discardIndexes: number[] | undefined;
        if (cardId === "alibi") {
          const evidence = target.accusations.findIndex((c) => c === "evidence");
          const accusations = target.accusations
            .map((c, i) => ({ c, i }))
            .filter((x) => x.c === "accusation")
            .slice(0, 3)
            .map((x) => x.i);
          discardIndexes = evidence >= 0 ? [evidence] : accusations.length ? accusations : undefined;
        }
        const action: PlayAction = {
          actorId: actor.id,
          cardId,
          targetId: target.id,
          sourceId: source?.id,
          discardIndexes,
        };
        if (canPlayCard(state, actor.id, cardId, target.id, source?.id, discardIndexes).ok) out.push(action);
      }
    }
  }
  return out;
}

function runGame(seed: number): string {
  const random = lcg(seed);
  let state = startGame(finishDeal(createGame({ playerCount: 12, witchCount: 2, identityCardsPerPlayer: 3 }, { seed })), 0);
  let step = 0;
  while (state.phase !== "gameOver" && step < 4000) {
    step += 1;
    assertInvariants(state, "seed " + seed + " step " + step);
    if (step % 10 === 0) assertProjection(state, "seed " + seed + " step " + step);

    if (state.phase === "night") {
      const result = resolveNight(state, defaultNightChoice(state));
      assert.equal(result.ok, true, "夜间结算");
      if (result.ok) state = result.state;
      continue;
    }
    if (state.phase !== "action") throw new Error("unexpected phase " + state.phase);

    const pool = shuffle(candidates(state), random);
    if (pool.length && random() < 0.72) {
      const action = pool[0];
      const result = playCard(state, action);
      assert.equal(result.ok, true, "可打出的牌应结算成功");
      if (result.ok) state = result.state;
    } else {
      const result = drawTwo(state);
      assert.equal(result.ok, true, "抽牌");
      if (result.ok) state = result.state;
    }
    if (state.phase === "action" && state.turn.actionTaken) {
      const result = endTurn(state);
      assert.equal(result.ok, true, "结束回合");
      if (result.ok) state = result.state;
    }
  }
  assert.equal(state.phase, "gameOver", "seed " + seed + " 应在步数上限内终局");
  assert.ok(state.winner === "town" || state.winner === "witches", "seed " + seed + " 有胜者");
  assertProjection(state, "seed " + seed + " final");
  return state.winner + ":" + state.winnerReason + ":" + step;
}

const SOAK_SEEDS = Math.max(1, Number(process.env.SOAK_SEEDS ?? "48") || 48);

test(`12 人随机对局 soak：${SOAK_SEEDS} seed 牌张守恒、投影不泄漏、能到终局`, () => {
  const results: string[] = [];
  for (let seed = 1; seed <= SOAK_SEEDS; seed++) results.push("seed " + seed + " " + runGame(seed));
  console.log(results.join("\n"));
});

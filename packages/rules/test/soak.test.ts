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
  resolvePendingReveal,
  settleConspiracy,
  startGame,
  submitCatReveal,
  submitConspiracyPick,
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
    if (state.pendingReveal) {
      if (state.pendingReveal.chooserId === viewer.id) {
        assert.ok(view.pendingReveal, label + " 选择者可见挂起态");
        assert.deepEqual(
          view.pendingReveal.slots,
          state.players[state.pendingReveal.targetId].trials.map((t) => (t.revealed ? "revealed" : "hidden")),
          label + " 挂起态位置号与目标身份卡一致",
        );
      } else {
        assert.equal("pendingReveal" in view, false, label + " 非选择者投影没有挂起键");
        assert.equal(JSON.stringify(view).includes("pendingReveal"), false, label + " 非选择者投影不含挂起字段");
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

/** 挂起式揭示总得有人结算：soak 里由选择者按「第一张未揭示」的位置号收掉。 */
function settlePending(state: GameState, label: string): GameState {
  let cur = state;
  let guard = 0;
  while (cur.pendingReveal && guard++ < 12) {
    const pending = cur.pendingReveal;
    const index = cur.players[pending.targetId].trials.findIndex((t) => !t.revealed);
    assert.ok(index >= 0, label + " 挂起时目标还有未揭示身份卡");
    const result = resolvePendingReveal(cur, pending.chooserId, { kind: "reveal", trialIndex: index });
    assert.equal(result.ok, true, label + " 挂起式揭示按位置号结算");
    if (!result.ok) break;
    cur = result.state;
  }
  assert.equal(cur.pendingReveal, null, label + " 挂起态已结算");
  return cur;
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
    // 传染阶段现在等玩家出手：这里是假服务端，按「每人取第一个候选」推进。
    if (state.phase === "conspiracy") {
      const phase = state.conspiracy!;
      if (phase.step === "cat") {
        const cat = state.players[phase.catSeatId!];
        const slot = cat.trials.findIndex((t) => !t.revealed);
        assert.equal(slot >= 0, true, "黑猫持有者应有未揭示的卡");
        const result = submitCatReveal(state, phase.drawerId, slot);
        assert.equal(result.ok, true, "揭示黑猫持有者");
        if (result.ok) state = result.state;
        continue;
      }
      for (const player of state.players) {
        if (!player.alive) continue;
        const left = state.players[(player.id + 1) % state.players.length];
        if (!left || !left.alive) continue;
        const slot = left.trials.findIndex((t) => !t.revealed);
        if (slot < 0) continue;
        const picked = submitConspiracyPick(state, player.id, slot);
        assert.equal(picked.ok, true, "提交传染选择");
        if (picked.ok) state = picked.state;
      }
      const settled = settleConspiracy(state);
      assert.equal(settled.ok, true, "传染病结算");
      if (settled.ok) state = settled.state;
      // 丽贝卡补抽等 resume=none 的路径结算后不续抽，本回合行动已经用掉，直接收尾。
      if (state.phase === "action" && state.turn.actionTaken) {
        const ended = endTurn(state);
        assert.equal(ended.ok, true, "传染结算后结束回合");
        if (ended.ok) state = ended.state;
      }
      continue;
    }
    if (state.phase !== "action") throw new Error("unexpected phase " + state.phase);

    const pool = shuffle(candidates(state), random);
    if (pool.length && random() < 0.72) {
      const action = pool[0];
      const result = playCard(state, action);
      assert.equal(result.ok, true, "可打出的牌应结算成功");
      if (result.ok) {
        state = result.state;
        if (state.pendingReveal) assertProjection(state, "seed " + seed + " step " + step + " 挂起");
        state = settlePending(state, "seed " + seed + " step " + step);
      }
    } else {
      const result = drawTwo(state);
      assert.equal(
        result.ok,
        true,
        "抽牌 " +
          (result.ok ? "" : result.reason) +
          " seed=" + seed + " step=" + step +
          " phase=" + state.phase +
          " actionTaken=" + state.turn.actionTaken,
      );
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

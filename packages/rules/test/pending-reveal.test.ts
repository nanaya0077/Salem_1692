import test from "node:test";
import assert from "node:assert/strict";
import {
  beginNightForTest,
  canPlayCard,
  confess,
  createGame,
  drawTwo,
  endTurn,
  finishDeal,
  playCard,
  project,
  resolveConspiracyForTest,
  resolvePendingReveal,
  startGame,
  updateConstable,
  type CardId,
  type GameState,
  type IdentityKind,
  type RoleId,
} from "../src/index.ts";

function setTrials(game: GameState, playerId: number, kinds: IdentityKind[]): void {
  game.players[playerId].trials = kinds.map((kind, i) => ({ id: "p" + playerId + "-t" + i, kind, revealed: false }));
  game.players[playerId].everWitch = kinds.includes("witch");
  updateConstable(game);
}

function setHands(game: GameState, hands: CardId[][]): void {
  for (const player of game.players) player.hand = (hands[player.id] ?? []).slice();
}

function baseGame(roles: RoleId[] = ["none", "none", "none", "none"]): GameState {
  const game = createGame({ playerCount: 4 }, { seed: 11, roles });
  for (let i = 0; i < 4; i++) setTrials(game, i, ["townspeople", "townspeople"]);
  return startGame(finishDeal(game), 0);
}

/** 按位置号揭示：取目标第一张未揭示的位置，模拟「取第一张兜底」。 */
function revealFirst(state: GameState): GameState {
  const pending = state.pendingReveal;
  assert.ok(pending, "应处于挂起态");
  const index = state.players[pending!.targetId].trials.findIndex((t) => !t.revealed);
  const result = resolvePendingReveal(state, pending!.chooserId, { kind: "reveal", trialIndex: index });
  assert.equal(result.ok, true);
  return result.ok ? result.state : state;
}

test("门槛后进入挂起：不自动揭示，红卡暂不清空", () => {
  const game = baseGame();
  setHands(game, [["witness"], [], [], []]);
  const result = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const pending = result.state.pendingReveal;
  assert.ok(pending);
  assert.equal(pending!.targetId, 1);
  assert.equal(pending!.chooserId, 0);
  assert.equal(pending!.cause, "accusation");
  assert.equal(pending!.canDecline, false);
  assert.equal(result.state.players[1].trials.filter((t) => t.revealed).length, 0, "不再自动揭示第一张");
  assert.deepEqual(result.state.players[1].accusations, ["witness"], "红卡挂起期间保留");
});

test("挂起态只投给选择者：位置号数组，他人拿到空", () => {
  const game = baseGame();
  setTrials(game, 1, ["townspeople", "townspeople", "townspeople"]);
  setHands(game, [["witness"], [], [], []]);
  const played = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  const chooser = project(played.state, 0);
  assert.deepEqual(chooser.pendingReveal, {
    chooserId: 0,
    targetId: 1,
    slots: ["hidden", "hidden", "hidden"],
    canDecline: false,
  });
  for (const viewerId of [1, 2, 3]) {
    const view = project(played.state, viewerId);
    assert.equal("pendingReveal" in view, false, "非选择者投影里没有挂起键");
    assert.equal(JSON.stringify(view).includes("pendingReveal"), false, "序列化后也不出现挂起键");
  }
});

test("揭示命令按位置号结算：卡顺序不被打乱，红卡随后清空", () => {
  const game = baseGame();
  // 用警长而不是女巫：翻到女巫会立刻死亡并公开全部身份卡，看不出「只翻指定位置」。
  setTrials(game, 1, ["townspeople", "constable", "townspeople"]);
  setHands(game, [["witness"], [], [], []]);
  const played = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  const before = played.state.players[1].trials.map((t) => t.id);
  const result = resolvePendingReveal(played.state, 0, { kind: "reveal", trialIndex: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const after = result.state.players[1].trials.map((t) => t.id);
  assert.deepEqual(after, before, "身份卡顺序不被打乱");
  assert.equal(result.state.players[1].trials[0].revealed, false);
  assert.equal(result.state.players[1].trials[1].revealed, true, "揭示的是第 2 个位置");
  assert.equal(result.state.players[1].trials[2].revealed, false);
  assert.equal(result.state.pendingReveal, null, "结算后挂起态清空");
  assert.deepEqual(result.state.players[1].accusations, [], "结算后红卡清空");
  const revealEvent = result.events.find((e) => e.type === "trialRevealed");
  assert.deepEqual(revealEvent, { type: "trialRevealed", playerId: 1, kind: "constable", cause: "accusation", chooserId: 0 });
});

test("非法位置被拒：越界、非整数、已揭示的位置、非选择者", () => {
  const game = baseGame();
  setTrials(game, 1, ["townspeople", "townspeople", "townspeople"]);
  setHands(game, [["witness"], [], [], []]);
  const played = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  const snapshot = JSON.stringify(played.state);
  assert.deepEqual(resolvePendingReveal(played.state, 0, { kind: "reveal", trialIndex: 3 }), { ok: false, reason: "bad-trial-index" });
  assert.deepEqual(resolvePendingReveal(played.state, 0, { kind: "reveal", trialIndex: -1 }), { ok: false, reason: "bad-trial-index" });
  assert.deepEqual(resolvePendingReveal(played.state, 0, { kind: "reveal", trialIndex: 1.5 }), { ok: false, reason: "bad-trial-index" });
  assert.deepEqual(resolvePendingReveal(played.state, 2, { kind: "reveal", trialIndex: 0 }), { ok: false, reason: "not-chooser" });
  assert.equal(JSON.stringify(played.state), snapshot, "拒绝不改变状态");

  const seen = played.state.players[1].trials.map((t, i) => (i === 0 ? { ...t, revealed: true } : t));
  const partial: GameState = { ...played.state, players: played.state.players.map((p) => (p.id === 1 ? { ...p, trials: seen } : p)) };
  assert.deepEqual(resolvePendingReveal(partial, 0, { kind: "reveal", trialIndex: 0 }), { ok: false, reason: "trial-already-revealed" });
});

test("重复的揭示命令被拒，且不产生第二次揭示", () => {
  const game = baseGame();
  setTrials(game, 1, ["townspeople", "townspeople", "townspeople"]);
  setHands(game, [["witness"], [], [], []]);
  const played = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  const first = resolvePendingReveal(played.state, 0, { kind: "reveal", trialIndex: 0 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const snapshot = JSON.stringify(first.state);
  assert.deepEqual(resolvePendingReveal(first.state, 0, { kind: "reveal", trialIndex: 0 }), { ok: false, reason: "no-pending-reveal" });
  assert.deepEqual(resolvePendingReveal(first.state, 0, { kind: "reveal", trialIndex: 1 }), { ok: false, reason: "no-pending-reveal" });
  assert.equal(JSON.stringify(first.state), snapshot, "重复命令不改状态");
  assert.equal(first.state.players[1].trials.filter((t) => t.revealed).length, 1, "只翻开一张");
});

test("普通门槛下目标只剩一张未揭示时不进挂起，直接揭示", () => {
  const game = baseGame();
  setTrials(game, 1, ["townspeople"]);
  setHands(game, [["witness"], [], [], []]);
  const result = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.pendingReveal, null, "不进挂起");
  assert.equal(result.state.players[1].trials.filter((t) => t.revealed).length, 1);
  assert.equal(result.state.players[1].accusations.length, 0, "直接揭示时红卡照常清空");
});

test("丹福斯 6 点遇到只剩一张仍未揭示的目标时先进挂起，可放弃优先于省掉选位置", () => {
  const game = baseGame(["thomas-danforth", "none", "none", "none"]);
  setTrials(game, 1, ["townspeople"]);
  setHands(game, [["evidence", "evidence", "accusation"], [], [], []]);
  const first = playCard(game, { actorId: 0, cardId: "evidence", targetId: 1 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = playCard(first.state, { actorId: 0, cardId: "evidence", targetId: 1 });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.state.pendingReveal?.targetId, 1, "只剩一张也要挂起");
  assert.equal(second.state.pendingReveal?.canDecline, true, "6 点可放弃");
  assert.equal(second.state.players[1].trials.filter((t) => t.revealed).length, 0, "挂起期不揭示");

  const declined = resolvePendingReveal(second.state, 0, { kind: "decline" });
  assert.equal(declined.ok, true);
  if (!declined.ok) return;
  assert.equal(declined.state.players[1].trials.filter((t) => t.revealed).length, 0, "放弃后仍不揭示");

  const third = playCard(declined.state, { actorId: 0, cardId: "accusation", targetId: 1 });
  assert.equal(third.ok, true);
  if (!third.ok) return;
  assert.equal(third.state.pendingReveal, null, "第 7 点不再给放弃机会");
  assert.equal(third.state.players[1].trials.filter((t) => t.revealed).length, 1, "单张直接翻开");
});

test("丹福斯对普通玩家 6 点可放弃：红卡保留，第 7 点再次触发", () => {
  const game = baseGame(["thomas-danforth", "none", "none", "none"]);
  setTrials(game, 1, ["townspeople", "townspeople", "townspeople"]);
  setHands(game, [["evidence", "evidence", "accusation"], [], [], []]);
  const first = playCard(game, { actorId: 0, cardId: "evidence", targetId: 1 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.state.pendingReveal, null, "3 点未到门槛");
  const second = playCard(first.state, { actorId: 0, cardId: "evidence", targetId: 1 });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.state.pendingReveal?.canDecline, true, "第 6 点可放弃");
  assert.equal(project(second.state, 0).pendingReveal?.canDecline, true, "投影里也能看到可放弃");

  const declined = resolvePendingReveal(second.state, 0, { kind: "decline" });
  assert.equal(declined.ok, true);
  if (!declined.ok) return;
  assert.equal(declined.state.pendingReveal, null);
  assert.deepEqual(declined.state.players[1].accusations, ["evidence", "evidence"], "放弃后红卡保留");
  assert.equal(declined.state.players[1].trials.filter((t) => t.revealed).length, 0, "放弃后不揭示");

  const third = playCard(declined.state, { actorId: 0, cardId: "accusation", targetId: 1 });
  assert.equal(third.ok, true);
  if (!third.ok) return;
  assert.ok(third.state.pendingReveal, "第 7 点再次触发");
  assert.equal(third.state.pendingReveal?.canDecline, false, "7 点不再可放弃");
  assert.deepEqual(resolvePendingReveal(third.state, 0, { kind: "decline" }), { ok: false, reason: "cannot-decline" });
});

test("其余路径的放弃命令被拒：诅咒与普通指控都不可放弃", () => {
  const curse = baseGame();
  curse.players[1].blue.push("piety");
  curse.players[1].accusations = ["witness"];
  setHands(curse, [["curse"], [], [], []]);
  const played = playCard(curse, { actorId: 0, cardId: "curse", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  assert.equal(played.state.pendingReveal?.cause, "curse");
  assert.equal(played.state.pendingReveal?.canDecline, false);
  assert.deepEqual(resolvePendingReveal(played.state, 0, { kind: "decline" }), { ok: false, reason: "cannot-decline" });
  assert.equal(revealFirst(played.state).players[1].trials.filter((t) => t.revealed).length, 1);

  const plain = baseGame();
  setHands(plain, [["witness"], [], [], []]);
  const hit = playCard(plain, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(hit.ok, true);
  if (!hit.ok) return;
  assert.equal(hit.state.pendingReveal?.canDecline, false);
  assert.deepEqual(resolvePendingReveal(hit.state, 0, { kind: "decline" }), { ok: false, reason: "cannot-decline" });
});

test("挂起期间抽牌、出牌、结束回合一律被拒", () => {
  const game = baseGame();
  setHands(game, [["witness", "accusation"], [], [], []]);
  const played = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  const state = played.state;
  assert.ok(state.pendingReveal);
  const snapshot = JSON.stringify(state);
  assert.deepEqual(drawTwo(state), { ok: false, reason: "reveal-pending" });
  assert.deepEqual(endTurn(state), { ok: false, reason: "reveal-pending" });
  assert.deepEqual(canPlayCard(state, 0, "accusation", 2), { ok: false, reason: "reveal-pending" });
  assert.deepEqual(playCard(state, { actorId: 0, cardId: "accusation", targetId: 2 }), { ok: false, reason: "reveal-pending" });
  assert.equal(JSON.stringify(state), snapshot, "被拒时状态不变");
});

test("零泄漏：非选择者投影不含挂起键，也不含带类型的身份卡 id", () => {
  const game = baseGame();
  setTrials(game, 1, ["witch", "townspeople", "townspeople"]);
  setHands(game, [["witness"], [], [], []]);
  const played = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  assert.equal(played.state.players[1].trials[0].kind, "witch");
  const chooser = project(played.state, 0);
  assert.ok(chooser.pendingReveal);
  const serializedPending = JSON.stringify(chooser.pendingReveal);
  assert.deepEqual(chooser.pendingReveal!.slots, ["hidden", "hidden", "hidden"], "只给位置号，不给卡 id");
  assert.equal(/witch-|constable-|trialIndex|trialId/.test(serializedPending), false, "挂起态不含带类型的 id");
  for (const viewerId of [1, 2, 3]) {
    const view = project(played.state, viewerId);
    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes("pendingReveal"), false, "非选择者投影没有挂起键");
    assert.equal(/"trialIndex"|"trialId"/.test(serialized), false, "非选择者投影没有位置号字段");
    for (const seat of view.seats) {
      if (seat.id === viewerId) continue;
      for (const trial of seat.trials) {
        if (trial.revealed) continue;
        assert.equal(/^witch-|^constable-/.test(trial.id), false, "他人未揭示身份卡 id 不带类型");
        assert.equal(trial.kind, null);
      }
    }
  }
});

test("回归：传染与自首仍自动揭示第一张，不进挂起", () => {
  const conspiracy = baseGame();
  conspiracy.players[0].blue.push("blackcat");
  setTrials(conspiracy, 0, ["townspeople", "townspeople"]);
  setTrials(conspiracy, 1, ["witch", "townspeople"]);
  resolveConspiracyForTest(conspiracy, 0);
  assert.equal(conspiracy.pendingReveal, null, "传染不进入挂起");
  assert.equal(conspiracy.players[0].trials.filter((t) => t.revealed).length, 1, "传染仍自动揭示第一张");

  const confessGame = baseGame();
  beginNightForTest(confessGame);
  const confessed = confess(confessGame, 1);
  assert.equal(confessed.ok, true);
  if (!confessed.ok) return;
  assert.equal(confessed.state.pendingReveal, null, "自首不进入挂起");
  assert.equal(confessed.state.players[1].trials[0].revealed, true, "自首翻开第一张");
  assert.equal(confessed.state.players[1].trials[1].revealed, false);
});

test("挂起推迟附带结算：阿比盖尔的弃红牌与丽贝卡的抽牌都在揭示之后", () => {
  const rebecca = baseGame(["rebecca-nurse", "none", "none", "none"]);
  setHands(rebecca, [[], ["accusation"], ["witness"], []]);
  rebecca.currentPlayerId = 2;
  const played = playCard(rebecca, { actorId: 2, cardId: "witness", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  assert.equal(played.state.players[0].hand.length, 0, "揭示之前丽贝卡不抽牌");
  const resolved = revealFirst(played.state);
  assert.equal(resolved.players[0].hand.length, 1, "揭示之后丽贝卡抽 1");

  const abigail = baseGame(["abigail-williams", "none", "none", "none"]);
  abigail.players[0].accusations = ["evidence"];
  setHands(abigail, [["witness"], [], [], []]);
  const hit = playCard(abigail, { actorId: 0, cardId: "witness", targetId: 1, useAbigail: true });
  assert.equal(hit.ok, true);
  if (!hit.ok) return;
  assert.deepEqual(hit.state.players[0].accusations, ["evidence"], "揭示之前不弃自己的红卡");
  const after = revealFirst(hit.state);
  assert.deepEqual(after.players[0].accusations, [], "揭示之后弃自己的红卡");
});

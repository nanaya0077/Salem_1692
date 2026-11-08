import test from "node:test";
import assert from "node:assert/strict";
import {
  beginConspiracyForTest,
  createGame,
  finishDeal,
  project,
  settleConspiracy,
  startGame,
  submitCatReveal,
  submitConspiracyPick,
  updateConstable,
  type GameState,
  type IdentityKind,
} from "../src/index.ts";

/**
 * 传染阶段状态机的边界用例（#54）。
 * 刻意不走 `resolveConspiracyForTest`：那个快捷入口会把整段跑完，
 * 而这一组要验的正是「停在半路、谁能出手、别人看得见什么、什么时候兜底」。
 */

function setTrials(game: GameState, playerId: number, kinds: IdentityKind[]): void {
  game.players[playerId].trials = kinds.map((kind, i) => ({
    id: "p" + playerId + "-t" + i,
    kind,
    revealed: false,
  }));
  game.players[playerId].everWitch = kinds.includes("witch");
  updateConstable(game);
}

function started(playerCount = 6): GameState {
  const game = finishDeal(createGame({ playerCount, witchCount: 2, identityCardsPerPlayer: 3 }, { seed: 7 }));
  const next = startGame(game, 0);
  for (const player of next.players) {
    // 开局会随机把黑猫放到某人面前；这一组用例自己决定黑猫在哪，先清空。
    player.blue = player.blue.filter((card) => card !== "blackcat");
    setTrials(next, player.id, ["townspeople", "townspeople", "townspeople"]);
  }
  return next;
}

test("有黑猫时先进 cat 子步，并广播 conspiracyStarted", () => {
  const game = started();
  game.players[2].blue.push("blackcat");
  beginConspiracyForTest(game, 1);

  assert.equal(game.phase, "conspiracy");
  assert.equal(game.conspiracy?.step, "cat");
  assert.equal(game.conspiracy?.catSeatId, 2);
  assert.equal(game.conspiracy?.drawerId, 1);
  assert.equal(game.conspiracy?.returnPhase, "action");
  assert.equal(game.conspiracy?.returnPlayerId, game.currentPlayerId);
  assert.equal(game.log.some((e) => e.type === "conspiracyStarted" && e.drawerId === 1), true);
});

test("没有黑猫时直接进 pick 子步", () => {
  const game = started();
  beginConspiracyForTest(game, 0);
  assert.equal(game.conspiracy?.step, "pick");
  assert.equal(game.conspiracy?.catSeatId, null);
});

test("黑猫在玛丽·沃伦面前时跳过 cat 子步（角色免疫）", () => {
  const game = started();
  game.players[3].role = "mary-warren";
  game.players[3].blue.push("blackcat");
  beginConspiracyForTest(game, 0);
  assert.equal(game.conspiracy?.step, "pick");
  assert.equal(game.conspiracy?.catSeatId, null);
});

test("黑猫持有者已没有未揭示的卡时也跳过 cat", () => {
  const game = started();
  game.players[2].blue.push("blackcat");
  game.players[2].trials = game.players[2].trials.map((t) => ({ ...t, revealed: true }));
  beginConspiracyForTest(game, 0);
  assert.equal(game.conspiracy?.step, "pick");
  assert.equal(game.conspiracy?.catSeatId, null);
});

test("只有抽到传染的人能提交 cat，且只能选未揭示的位置", () => {
  const game = started();
  game.players[2].blue.push("blackcat");
  beginConspiracyForTest(game, 1);

  const outsider = submitCatReveal(game, 0, 0);
  assert.equal(outsider.ok, false);
  assert.equal(outsider.ok === false && outsider.reason, "not-drawer");

  game.players[2].trials[0] = { ...game.players[2].trials[0], revealed: true };
  const revealed = submitCatReveal(game, 1, 0);
  assert.equal(revealed.ok, false);
  assert.equal(revealed.ok === false && revealed.reason, "trial-already-revealed");

  const okRes = submitCatReveal(game, 1, 1);
  assert.equal(okRes.ok, true);
  if (!okRes.ok) return;
  assert.equal(okRes.state.conspiracy?.step, "pick");
  assert.equal(okRes.state.conspiracy?.catPick, 1);
  assert.equal(okRes.state.players[2].trials[1].revealed, true);
  assert.equal(okRes.events.some((e) => e.type === "trialRevealed" && e.cause === "conspiracy"), true);
});

test("pick 可改判，以最后一次提交为准", () => {
  const game = started();
  beginConspiracyForTest(game, 0);

  const first = submitConspiracyPick(game, 1, 0);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.state.conspiracy?.picks[1], 0);

  const second = submitConspiracyPick(first.state, 1, 2);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.state.conspiracy?.picks[1], 2);
  // 别人的选择不受影响
  assert.equal(typeof second.state.conspiracy?.picks[0], "undefined");
});

test("死人不能提交 pick", () => {
  const game = started();
  game.players[4].alive = false;
  beginConspiracyForTest(game, 0);
  const res = submitConspiracyPick(game, 4, 0);
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "player-not-alive");
});

test("未提交的人按位置号最小的未揭示卡兜底", () => {
  const game = started();
  beginConspiracyForTest(game, 0);
  // 只让 0 号和 1 号提交，其余走兜底
  const a = submitConspiracyPick(game, 0, 1);
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const b = submitConspiracyPick(a.state, 1, 0);
  assert.equal(b.ok, true);
  if (!b.ok) return;

  const settled = settleConspiracy(b.state);
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  // 每个人仍然三张卡：取走一张、收进一张
  for (const player of settled.state.players) {
    assert.equal(player.trials.length, 3, "座位 " + player.id + " 卡数守恒");
  }
  assert.equal(settled.state.conspiracy, null);
  assert.equal(settled.state.phase, "action", "结算后回到原阶段");
  assert.equal(settled.events.filter((e) => e.type === "conspiracySwap").length, 6);
});

test("提交的位置被换走后不致错位：越界索引按兜底处理", () => {
  const game = started();
  beginConspiracyForTest(game, 0);
  const res = submitConspiracyPick(game, 2, 2);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  // 人为把该玩家提交的索引改成越界值，模拟「提交后卡被揭示」的极端情况
  res.state.conspiracy!.picks[2] = 99;
  const settled = settleConspiracy(res.state);
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  for (const player of settled.state.players) assert.equal(player.trials.length, 3);
});

test("投影：只有正在出手的人拿到 conspiracy，且不含任何 kind", () => {
  const game = started();
  game.players[2].blue.push("blackcat");
  beginConspiracyForTest(game, 1);

  const drawerView = project(game, 1);
  assert.equal(drawerView.conspiracy?.step, "cat");
  assert.deepEqual(drawerView.conspiracy?.candidates, [0, 1, 2]);
  assert.equal(drawerView.conspiracy?.submitted, false);

  // cat 阶段其他人不该看到这个键
  assert.equal(project(game, 0).conspiracy, undefined);
  assert.equal(project(game, 2).conspiracy, undefined);

  const payload = JSON.stringify(drawerView);
  assert.equal(payload.includes("witch-"), false);
  assert.equal(payload.includes("constable-"), false);
});

test("投影：pick 阶段所有存活玩家都能看到候选，死人看不到", () => {
  const game = started();
  game.players[5].alive = false;
  beginConspiracyForTest(game, 0);

  const alive = project(game, 2);
  assert.equal(alive.conspiracy?.step, "pick");
  // 2 号的左邻是 3 号，候选是 3 号的三张卡
  assert.deepEqual(alive.conspiracy?.candidates, [0, 1, 2]);
  assert.equal(alive.conspiracy?.submitted, false);

  const dead = project(game, 5);
  assert.equal(dead.conspiracy, undefined);
});

test("已提交的人投影里 submitted 为真，别人的提交状态不外泄", () => {
  const game = started();
  beginConspiracyForTest(game, 0);
  const res = submitConspiracyPick(game, 0, 1);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const mine = project(res.state, 0);
  assert.equal(mine.conspiracy?.submitted, true);
  const other = project(res.state, 1);
  assert.equal(other.conspiracy?.submitted, false);
  // 投影里既没有 picks 也没有别人的选择
  assert.equal(JSON.stringify(other).includes('"picks"'), false);
});

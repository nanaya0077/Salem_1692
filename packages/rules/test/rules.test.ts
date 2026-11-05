import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_CATALOG,
  canPlayCard,
  createGame,
  defaultConfigFor,
  identityCardCounts,
  playCard,
  resolveConfig,
  witchCountOf,
} from "../src/index.ts";

test("中文旧版默认配比：9 人 1 女巫、每人 5 张身份卡", () => {
  const config = defaultConfigFor(9);
  assert.equal(config.witchCount, 1);
  assert.equal(config.identityCardsPerPlayer, 5);
  assert.deepEqual(identityCardCounts(config), { total: 45, witches: 1, constables: 1, townspeople: 43 });
});

test("默认配比覆盖 4–12 人", () => {
  const table = [4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => defaultConfigFor(n));
  assert.deepEqual(table.map((c) => c.witchCount), [1, 1, 2, 2, 2, 1, 2, 2, 2]);
  assert.deepEqual(table.map((c) => c.identityCardsPerPlayer), [5, 5, 5, 5, 5, 5, 3, 3, 3]);
});

test("女巫数与每人身份卡数可自定义", () => {
  const config = resolveConfig({ playerCount: 9, witchCount: 3, identityCardsPerPlayer: 4 });
  assert.equal(config.witchCount, 3);
  assert.equal(config.identityCardsPerPlayer, 4);
  assert.deepEqual(identityCardCounts(config), { total: 36, witches: 3, constables: 1, townspeople: 32 });
});

test("身份卡总数不够时拒绝开局", () => {
  assert.throws(() => resolveConfig({ playerCount: 4, witchCount: 4, identityCardsPerPlayer: 2 }), /女巫数/);
  assert.throws(() => resolveConfig({ playerCount: 3 }), /4–12/);
  assert.throws(() => resolveConfig({ playerCount: 9, identityCardsPerPlayer: 9 }), /2–8/);
});

test("发牌后每人正好拿到配置的身份卡数", () => {
  const game = createGame({ playerCount: 9, witchCount: 3, identityCardsPerPlayer: 4 }, { seed: 7 });
  assert.equal(game.players.length, 9);
  for (const player of game.players) assert.equal(player.identityCards.length, 4);
  assert.equal(game.players.reduce((n, p) => n + witchCountOf(p), 0), 3);
});

test("信徒：红卡不能打给持有者，蓝卡可以", () => {
  const game = createGame({ playerCount: 4 }, { hands: [["accusation", "asylum"], [], [], []] });
  game.players[1].blue.push("piety");

  assert.deepEqual(canPlayCard(game, 0, "accusation", 1), { ok: false, reason: "piety:red-immunity" });
  const blocked = playCard(game, { actorId: 0, cardId: "accusation", targetId: 1 });
  assert.equal(blocked.ok, false);
  assert.equal(game.players[0].hand.length, 2, "被拒绝时卡牌仍在手里");

  assert.deepEqual(canPlayCard(game, 0, "asylum", 1), { ok: true });
});

test("莎拉·古德：纵火无效并被丢弃", () => {
  const game = createGame(
    { playerCount: 4 },
    { roles: ["other", "sarah-good", "other", "other"], hands: [["arson"], [], ["accusation"], []] },
  );
  const before = game.players[1].hand.slice();
  const result = playCard(game, { actorId: 0, cardId: "arson", targetId: 1 });

  assert.equal(result.ok, true);
  assert.deepEqual(game.players[1].hand, before);
  if (result.ok) {
    assert.deepEqual(result.events.at(-1), { type: "cardNullified", cardId: "arson", reason: "sarah-good" });
    assert.deepEqual(result.state.discard, ["arson"]);
  }
});

test("莎拉·古德：作为抢劫来源时无效并被丢弃；作为去向时正常收牌", () => {
  const game = createGame(
    { playerCount: 4 },
    { roles: ["other", "sarah-good", "other", "other"], hands: [["robbery"], ["accusation", "evidence"], [], []] },
  );
  const result = playCard(game, { actorId: 0, cardId: "robbery", sourceId: 1, targetId: 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(game.players[1].hand, ["accusation", "evidence"]);
  if (result.ok) assert.deepEqual(result.events.at(-1), { type: "cardNullified", cardId: "robbery", reason: "sarah-good" });

  const game2 = createGame(
    { playerCount: 4 },
    { roles: ["other", "other", "sarah-good", "other"], hands: [["robbery"], ["accusation"], [], []] },
  );
  const result2 = playCard(game2, { actorId: 0, cardId: "robbery", sourceId: 1, targetId: 2 });
  assert.equal(result2.ok, true);
  assert.equal(result2.ok, true);
  if (result2.ok) assert.deepEqual(result2.state.players[2].hand, ["accusation"]);
});

test("卡表覆盖 15 张基础卡与四种颜色", () => {
  assert.equal(Object.keys(CARD_CATALOG).length, 15);
  assert.equal(CARD_CATALOG.piety.color, "blue");
  assert.equal(CARD_CATALOG.arson.color, "green");
  assert.equal(CARD_CATALOG.accusation.color, "red");
  assert.equal(CARD_CATALOG.night.color, "black");
});

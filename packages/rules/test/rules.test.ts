import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_ROLES,
  CARD_CATALOG,
  accusationTotal,
  canPlayCard,
  chooseRole,
  createGame,
  finishDeal,
  defaultConfigFor,
  drawTwo,
  effectiveRole,
  fullCardCount,
  identityCardCounts,
  playCard,
  project,
  resolveConfig,
  resolveConspiracyForTest,
  resolvePendingReveal,
  resolveNight,
  beginNightForTest,
  confess,
  endTurn,
  samuelTake,
  startGame,
  titubaReorder,
  updateConstable,
  witchCountOf,
  type CardId,
  type GameEvent,
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

/** 走完挂起式揭示：按位置号取目标第一张未揭示的身份卡（“取第一张”兜底）。 */
function settlePending(state: GameState): { state: GameState; events: GameEvent[] } {
  let cur = state;
  const events: GameEvent[] = [];
  while (cur.pendingReveal) {
    const pending = cur.pendingReveal;
    const index = cur.players[pending.targetId].trials.findIndex((t) => !t.revealed);
    const result = resolvePendingReveal(cur, pending.chooserId, { kind: "reveal", trialIndex: index });
    assert.equal(result.ok, true, "挂起式揭示应能按位置号结算");
    if (!result.ok) break;
    events.push(...result.events);
    cur = result.state;
  }
  return { state: cur, events };
}

test("中文旧版默认配比：9 人 1 女巫、共 35 张身份卡", () => {
  const config = defaultConfigFor(9);
  assert.equal(config.witchCount, 1);
  assert.equal(config.identityCardsPerPlayer, 4);
  assert.equal(config.identityCardTotal, 35);
  assert.deepEqual(identityCardCounts(config), { total: 35, witches: 1, constables: 1, townspeople: 33 });
});

test("默认配比覆盖 4–12 人", () => {
  const table = [4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => defaultConfigFor(n));
  assert.deepEqual(table.map((c) => c.witchCount), [1, 1, 2, 2, 2, 1, 2, 2, 2]);
  assert.deepEqual(table.map((c) => c.identityCardsPerPlayer), [5, 5, 5, 5, 4, 4, 3, 3, 3]);
  assert.deepEqual(table.map((c) => c.identityCardTotal), [20, 25, 30, 35, 32, 35, 30, 33, 36]);
});

test("女巫数与每人身份卡数可自定义；非法配置拒绝开局", () => {
  const config = resolveConfig({ playerCount: 9, witchCount: 3, identityCardsPerPlayer: 4 });
  assert.equal(config.witchCount, 3);
  assert.equal(config.identityCardsPerPlayer, 4);
  assert.equal(config.identityCardTotal, 36);
  assert.deepEqual(identityCardCounts(config), { total: 36, witches: 3, constables: 1, townspeople: 32 });
  assert.throws(() => resolveConfig({ playerCount: 4, witchCount: 4, identityCardsPerPlayer: 2 }), /女巫数/);
  assert.throws(() => resolveConfig({ playerCount: 3 }), /4–12/);
  assert.throws(() => resolveConfig({ playerCount: 9, identityCardsPerPlayer: 9 }), /2–8/);
});

test("牌堆与发牌：59 张守恒、每人 3 张手牌、夜晚置底、黑猫在黎明目标面前", () => {
  const game = startGame(finishDeal(createGame({ playerCount: 4 }, { seed: 42 })), 2);
  assert.equal(fullCardCount(), 59);
  assert.equal(game.players.length, 4);
  assert.equal(game.players.every((p) => p.hand.length === 3), true);
  assert.equal(game.players[2].blue.includes("blackcat"), true);
  assert.equal(game.deck.at(-1), "night");
  assert.equal(game.deck.filter((c) => c === "night").length, 1);
  assert.equal(game.deck.includes("blackcat"), false);
  assert.equal(game.deck.includes("conspiracy"), true);
  assert.equal(game.currentPlayerId, 2);
});

test("发牌按身份卡总数分配；9 人默认 35 张为前 8 人 4 张、末位 3 张", () => {
  const official = createGame({ playerCount: 9 }, { seed: 7 });
  assert.equal(official.players.length, 9);
  assert.deepEqual(official.players.map((p) => p.trials.length), [4, 4, 4, 4, 4, 4, 4, 4, 3]);
  assert.equal(official.players.reduce((n, p) => n + p.trials.length, 0), 35);
  assert.equal(official.players.reduce((n, p) => n + witchCountOf(p), 0), 1);

  const custom = createGame({ playerCount: 9, witchCount: 3, identityCardsPerPlayer: 4 }, { seed: 7 });
  for (const player of custom.players) assert.equal(player.trials.length, 4);
  assert.equal(custom.players.reduce((n, p) => n + witchCountOf(p), 0), 3);
});

test("红卡：达到门槛先进挂起，按位置号翻开女巫即死亡并判平民胜", () => {
  const game = baseGame();
  setTrials(game, 1, ["witch", "townspeople"]);
  setHands(game, [["witness"], [], [], []]);
  const result = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.state.pendingReveal, "达到门槛先进挂起");
  assert.equal(result.state.players[1].accusations.length, 1, "挂起期间红卡保留");
  assert.equal(result.state.players[1].alive, true, "挂起期间不结算");
  const settled = settlePending(result.state);
  assert.equal(settled.state.players[1].alive, false);
  assert.equal(settled.state.players[1].trials.every((t) => t.revealed), true);
  assert.equal(settled.state.players[1].accusations.length, 0);
  assert.equal(settled.state.winner, "town");
  assert.equal(game.players[1].alive, true, "纯函数：原状态不变");
});

test("红卡不跨次累计：9 点只翻一张，多余点数丢弃", () => {
  const game = baseGame();
  setHands(game, [["evidence", "evidence"], [], [], []]);
  game.players[1].accusations = ["evidence", "evidence"];
  const result = playCard(game, { actorId: 0, cardId: "evidence", targetId: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const settled = settlePending(result.state);
  assert.equal(settled.state.players[1].trials.filter((t) => t.revealed).length, 1);
  assert.equal(settled.state.players[1].accusations.length, 0);
});

test("贾尔斯·科里：抽两张都是红卡时补抽第三张", () => {
  const game = baseGame(["giles-corey", "none", "none", "none"]);
  game.currentPlayerId = 0;
  game.turn = { ...game.turn, playerId: 0, actionTaken: false, pendingDraws: 0, ending: false, mainDraws: [], gilesEligible: false };
  game.players[0].hand = [];
  game.deck = ["accusation", "witness", "alibi", "evidence", "curse"];
  const result = drawTwo(game);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.players[0].hand.length, 3);
  assert.deepEqual(result.state.players[0].hand.slice(0, 3), ["accusation", "witness", "alibi"]);
  assert.equal(result.events.some((e) => e.type === "powerUsed" && e.power === "giles-corey"), true);
});

test("贾尔斯·科里：两张中有一张非红卡不补抽", () => {
  const game = baseGame(["giles-corey", "none", "none", "none"]);
  game.currentPlayerId = 0;
  game.turn = { ...game.turn, playerId: 0, actionTaken: false, pendingDraws: 0, ending: false, mainDraws: [], gilesEligible: false };
  game.players[0].hand = [];
  game.deck = ["accusation", "alibi", "witness", "evidence", "curse"];
  const result = drawTwo(game);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.players[0].hand.length, 2);
  assert.equal(result.events.some((e) => e.type === "powerUsed" && e.power === "giles-corey"), false);
});

test("乔治 8 点、托马斯对普通 6 点、对乔治 7 点", () => {
  const george = baseGame(["none", "george-burroughs", "none", "none"]);
  setHands(george, [["witness"], [], [], []]);
  const g1 = playCard(george, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(g1.ok, true);
  if (g1.ok) assert.equal(g1.state.players[1].trials.filter((t) => t.revealed).length, 0, "7 点不够乔治");

  const thomas = baseGame(["thomas-danforth", "none", "none", "none"]);
  setHands(thomas, [["evidence", "evidence"], [], [], []]);
  const t1 = playCard(thomas, { actorId: 0, cardId: "evidence", targetId: 1 });
  assert.equal(t1.ok, true);
  if (!t1.ok) return;
  const t2 = playCard(t1.state, { actorId: 0, cardId: "evidence", targetId: 1 });
  assert.equal(t2.ok, true);
  if (!t2.ok) return;
  assert.equal(t2.state.pendingReveal?.canDecline, true, "托马斯对普通玩家 6 点可放弃");
  assert.equal(settlePending(t2.state).state.players[1].trials.filter((t) => t.revealed).length, 1, "托马斯 6 点");
});

test("阿比盖尔：使目标翻牌时，弃自己面前红卡是可选项", () => {
  const game = baseGame(["abigail-williams", "none", "none", "none"]);
  setHands(game, [["witness", "witness"], [], [], []]);
  game.players[0].accusations = ["evidence"];
  const without = playCard(game, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(without.ok, true);
  if (!without.ok) return;
  assert.deepEqual(settlePending(without.state).state.players[0].accusations, ["evidence"], "不声明则不弃");

  const withPower = playCard(game, { actorId: 0, cardId: "witness", targetId: 1, useAbigail: true });
  assert.equal(withPower.ok, true);
  if (!withPower.ok) return;
  assert.deepEqual(withPower.state.players[0].accusations, ["evidence"], "挂起期间先不弃");
  const settled = settlePending(withPower.state);
  assert.deepEqual(settled.state.players[0].accusations, [], "揭示之后才弃");
  assert.equal(settled.events.some((e) => e.type === "powerUsed" && e.power === "abigail-williams"), true);
});

test("科顿·马瑟：打在他面前的证据只算 1 点", () => {
  const game = baseGame(["none", "cotton-mather", "none", "none"]);
  game.players[1].accusations = ["evidence"];
  assert.equal(accusationTotal(game, 1), 1);
  setHands(game, [["evidence"], [], [], []]);
  const result = playCard(game, { actorId: 0, cardId: "evidence", targetId: 1 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(accusationTotal(result.state, 1), 2);
});

test("信徒：红卡不能打给持有者，蓝卡可以；嫁祸移动红卡不受限", () => {
  const game = baseGame();
  game.players[1].blue.push("piety");
  setHands(game, [["accusation", "asylum", "scapegoat"], [], [], []]);
  assert.deepEqual(canPlayCard(game, 0, "accusation", 1), { ok: false, reason: "piety:red-immunity" });
  assert.deepEqual(canPlayCard(game, 0, "asylum", 1), { ok: true });
  setTrials(game, 2, ["townspeople", "townspeople"]);
  game.players[1].accusations = ["witness"];
  game.players[1].blue = ["piety"];
  // 嫁祸把来源的红卡移到信徒面前：移动不是“打出红卡”。
  const move = playCard(game, { actorId: 0, cardId: "scapegoat", sourceId: 1, targetId: 2 });
  assert.equal(move.ok, true);
  if (!move.ok) return;
  assert.ok(move.state.pendingReveal, "嫁祸达到门槛后挂起");
  assert.equal(settlePending(move.state).state.players[2].trials.filter((t) => t.revealed).length, 1);
});

test("莎拉·古德：纵火无效并被丢弃；作为抢劫来源无效", () => {
  const game = baseGame(["none", "sarah-good", "none", "none"]);
  setHands(game, [["arson", "robbery"], ["accusation"], [], []]);
  const arson = playCard(game, { actorId: 0, cardId: "arson", targetId: 1 });
  assert.equal(arson.ok, true);
  if (!arson.ok) return;
  assert.deepEqual(arson.state.players[1].hand, ["accusation"]);
  assert.equal(arson.state.discard.includes("arson"), true);

  const robbery = playCard(arson.state, { actorId: 0, cardId: "robbery", sourceId: 1, targetId: 2 });
  assert.equal(robbery.ok, true);
  if (robbery.ok) assert.deepEqual(robbery.state.players[1].hand, ["accusation"]);
});

test("抢劫转移整手牌；嫁祸移动全部面前牌并重算红卡", () => {
  const game = baseGame();
  setHands(game, [["robbery", "scapegoat"], ["accusation", "evidence"], [], []]);
  const robbery = playCard(game, { actorId: 0, cardId: "robbery", sourceId: 1, targetId: 2 });
  assert.equal(robbery.ok, true);
  if (!robbery.ok) return;
  assert.deepEqual(robbery.state.players[1].hand, []);
  assert.deepEqual(robbery.state.players[2].hand, ["accusation", "evidence"]);

  const game2 = baseGame();
  setHands(game2, [["scapegoat"], [], [], []]);
  game2.players[1].accusations = ["witness"];
  game2.players[1].blue.push("piety");
  const move = playCard(game2, { actorId: 0, cardId: "scapegoat", sourceId: 1, targetId: 2 });
  assert.equal(move.ok, true);
  if (!move.ok) return;
  assert.equal(move.state.players[1].accusations.length, 0);
  assert.equal(move.state.players[1].blue.length, 0);
  const settled = settlePending(move.state);
  assert.equal(settled.state.players[2].trials.filter((t) => t.revealed).length, 1);
});

test("拘留：跳过下一个回合并在跳过时弃掉", () => {
  const game = baseGame();
  setHands(game, [["stocks"], [], [], []]);
  const played = playCard(game, { actorId: 0, cardId: "stocks", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  assert.deepEqual(played.state.players[1].green, ["stocks"]);
  const ended = endTurn(played.state);
  assert.equal(ended.ok, true);
  if (!ended.ok) return;
  assert.equal(ended.state.currentPlayerId, 2);
  assert.equal(ended.state.players[1].green.length, 0);
  assert.equal(ended.state.discard.includes("stocks"), true);
});

test("诅咒：弃掉信徒后若已达门槛立刻翻牌", () => {
  const game = baseGame();
  game.players[1].blue.push("piety");
  game.players[1].accusations = ["witness"];
  setHands(game, [["curse"], [], [], []]);
  const result = playCard(game, { actorId: 0, cardId: "curse", targetId: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.players[1].blue.length, 0);
  const settled = settlePending(result.state);
  assert.equal(settled.state.players[1].trials.filter((t) => t.revealed).length, 1);
  assert.equal(settled.state.players[1].accusations.length, 0);
});

test("情侣：同一人不能拿第二张，另一个人可以配对", () => {
  const game = baseGame();
  game.players[1].blue.push("matchmaker");
  setHands(game, [["matchmaker", "matchmaker"], [], [], []]);
  const duplicate = playCard(game, { actorId: 0, cardId: "matchmaker", targetId: 1 });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.reason, "matchmaker:duplicate");
  const pair = playCard(game, { actorId: 0, cardId: "matchmaker", targetId: 2 });
  assert.equal(pair.ok, true);
  if (!pair.ok) return;
  assert.equal(pair.state.players[2].blue.includes("matchmaker"), true);
  assert.equal(pair.state.players[1].blue.includes("matchmaker"), true);
});

test("辩护：可选 1 张证据，或最多 3 张指控，两类不能混选", () => {
  const game = baseGame();
  game.players[1].accusations = ["evidence", "accusation", "accusation", "accusation"];
  setHands(game, [["alibi", "alibi", "alibi"], [], [], []]);
  const mixed = playCard(game, { actorId: 0, cardId: "alibi", targetId: 1, discardIndexes: [0, 1] });
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.equal(mixed.reason, "alibi:evidence-alone");
  const oneEvidence = playCard(game, { actorId: 0, cardId: "alibi", targetId: 1, discardIndexes: [0] });
  assert.equal(oneEvidence.ok, true);
  if (!oneEvidence.ok) return;
  assert.deepEqual(oneEvidence.state.players[1].accusations, ["accusation", "accusation", "accusation"]);
  assert.equal(oneEvidence.state.discard.filter((c) => c === "evidence").length, 1);
  const three = playCard(oneEvidence.state, { actorId: 0, cardId: "alibi", targetId: 1, discardIndexes: [0, 1, 2] });
  assert.equal(three.ok, true);
  if (three.ok) assert.equal(three.state.players[1].accusations.length, 0);
});

test("辩护：未指定时自动先弃最多 3 张指控", () => {
  const game = baseGame();
  game.players[1].accusations = ["accusation", "evidence", "accusation", "accusation"];
  setHands(game, [["alibi"], [], [], []]);
  const result = playCard(game, { actorId: 0, cardId: "alibi", targetId: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state.players[1].accusations, ["evidence"]);
});

test("威尔·格里格斯：辩护可当 7 点目击；对信徒也可用", () => {
  const game = baseGame(["will-griggs", "none", "none", "none"]);
  game.players[1].blue.push("piety");
  setHands(game, [["alibi"], [], [], []]);
  const result = playCard(game, { actorId: 0, cardId: "alibi", targetId: 1, asWitness: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(settlePending(result.state).state.players[1].trials.filter((t) => t.revealed).length, 1);
});

test("夜晚：庇护/木槌/自首可救；情侣连锁杀死搭档；玛丽免疫连锁", () => {
  const asylum = baseGame();
  asylum.players[1].blue.push("asylum");
  setTrials(asylum, 1, ["townspeople", "townspeople"]);
  beginNightForTest(asylum);
  const saved = resolveNight(asylum, { targetId: 1 });
  assert.equal(saved.ok, true);
  if (saved.ok) assert.equal(saved.state.players[1].alive, true);

  const hammer = baseGame();
  hammer.constableId = 2;
  beginNightForTest(hammer);
  const saved2 = resolveNight(hammer, { targetId: 1, hammerTargetId: 1 });
  assert.equal(saved2.ok, true);
  if (saved2.ok) assert.equal(saved2.state.players[1].alive, true);

  const confessed = baseGame();
  beginNightForTest(confessed);
  const c = confess(confessed, 1);
  assert.equal(c.ok, true);
  if (!c.ok) return;
  const saved3 = resolveNight(c.state, { targetId: 1 });
  assert.equal(saved3.ok, true);
  if (saved3.ok) assert.equal(saved3.state.players[1].alive, true);

  const chain = baseGame();
  setTrials(chain, 1, ["townspeople", "townspeople"]);
  setTrials(chain, 2, ["townspeople", "townspeople"]);
  chain.players[1].blue.push("matchmaker");
  chain.players[2].blue.push("matchmaker");
  beginNightForTest(chain);
  const killed = resolveNight(chain, { targetId: 1 });
  assert.equal(killed.ok, true);
  if (killed.ok) {
    assert.equal(killed.state.players[1].alive, false);
    assert.equal(killed.state.players[2].alive, false);
  }

  const mary = baseGame(["none", "none", "mary-warren", "none"]);
  setTrials(mary, 1, ["townspeople", "townspeople"]);
  mary.players[1].blue.push("matchmaker");
  mary.players[2].blue.push("matchmaker");
  beginNightForTest(mary);
  const maryResult = resolveNight(mary, { targetId: 1 });
  assert.equal(maryResult.ok, true);
  if (maryResult.ok) assert.equal(maryResult.state.players[2].alive, true);
});

test("威廉·菲普斯：夜晚可不翻牌获得免疫，每局一次", () => {
  const game = baseGame(["none", "william-phipps", "none", "none"]);
  setTrials(game, 1, ["townspeople", "townspeople"]);
  beginNightForTest(game);
  const result = resolveNight(game, { targetId: 1, silentConfessions: [1] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.players[1].alive, true);
  assert.equal(result.state.players[1].used.william, true);
  assert.equal(result.state.players[1].trials.every((t) => !t.revealed), true);
  assert.equal(result.events.some((e) => e.type === "confession" && e.playerId === 1 && e.revealed === false), true);
  assert.equal(result.events.some((e) => e.type === "powerUsed" && e.power === "william-phipps"), true);
});

test("夜晚结束后未完成的抽牌会继续结算，不会停在 phase=night 且 night=null", () => {
  const game = baseGame();
  game.turn.pendingDraws = 2;
  game.deck = ["accusation", "evidence", "alibi", "curse"];
  beginNightForTest(game);
  const result = resolveNight(game, { targetId: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.night, null);
  assert.equal(result.state.phase, "action");
  assert.equal(result.state.players[0].hand.length, 5, "原手牌 3 张 + 续抽 2 张");
});

test("传染：黑猫持有者先被翻一张，然后全体从左邻换一张；收到女巫即成为女巫", () => {
  const game = baseGame();
  game.players[0].blue.push("blackcat");
  setTrials(game, 0, ["townspeople", "townspeople"]);
  setTrials(game, 1, ["witch", "townspeople"]);
  resolveConspiracyForTest(game, 0);
  assert.equal(game.players[0].everWitch, true);
  assert.equal(game.players.every((p) => p.trials.length === 2), true);
});

test("投影：不泄漏牌堆、他人手牌与未揭示身份；自己可见", () => {
  const game = baseGame();
  setTrials(game, 1, ["witch", "townspeople"]);
  game.players[1].hand = ["witness"];
  const view = project(game, 0);
  assert.equal(view.deckCount > 0, true);
  assert.equal(view.seats[1].handCount, 1);
  assert.equal(view.seats[1].trials[0].kind, null);
  assert.equal(view.seats[1].everWitch, null);
  assert.equal(JSON.stringify(view).includes("witness"), false);
  assert.equal(JSON.stringify(view).includes("deck\":["), false);
  const self = project(game, 1);
  assert.equal(self.self.trials[0].kind, "witch");
  assert.deepEqual(self.self.hand, ["witness"]);

  // 挂起式揭示也进这张零泄漏扫描：非选择者投影里不许出现挂起字段或带类型的身份卡 id。
  const pendingGame = baseGame();
  setTrials(pendingGame, 1, ["witch", "townspeople", "townspeople"]);
  setHands(pendingGame, [["witness"], [], [], []]);
  const played = playCard(pendingGame, { actorId: 0, cardId: "witness", targetId: 1 });
  assert.equal(played.ok, true);
  if (!played.ok) return;
  assert.ok(played.state.pendingReveal, "扫描用的局面确实处于挂起");
  const forbidden = ["pendingReveal", "trialIndex", "trialId", "canDecline", "slots"];
  for (const viewerId of [1, 2, 3]) {
    const other = project(played.state, viewerId);
    const text = JSON.stringify(other);
    for (const key of forbidden) assert.equal(text.includes(key), false, "非选择者投影不含 " + key);
    assert.equal("pendingReveal" in other, false, "非选择者投影没有挂起键");
    const targetSeat = other.seats[1];
    if (targetSeat.id !== viewerId) {
      for (const trial of targetSeat.trials) assert.match(trial.id, /^hidden-/);
      assert.equal(text.includes('"p1-t'), false, "带类型的身份卡 id 不出现");
      assert.equal(text.includes("witch"), false, "身份卡类型不出现");
    }
  }
  assert.deepEqual(project(played.state, 0).pendingReveal, {
    chooserId: 0,
    targetId: 1,
    slots: ["hidden", "hidden", "hidden"],
    canDecline: false,
  });
});

test("投影：弃牌堆公开；牌堆顺序仅蒂图巴本人可见", () => {
  const game = baseGame(["tituba", "none", "none", "none"]);
  game.discard.push("accusation");
  const tituba = project(game, 0);
  const other = project(game, 1);
  assert.deepEqual(tituba.discard, ["accusation"]);
  assert.deepEqual(tituba.deckOrder, game.deck);
  assert.equal(other.deckOrder, null);
  game.players[0].used.tituba = true;
  assert.equal(project(game, 0).deckOrder, null);
});

test("阴谋：存活玩家最后一张身份卡被传走且左邻已死时，按无身份出局", () => {
  const game = baseGame();
  setTrials(game, 0, ["townspeople"]);
  setTrials(game, 1, ["townspeople"]);
  game.players[1].alive = false;
  for (const p of game.players) p.blue = [];
  resolveConspiracyForTest(game, 2);
  assert.equal(game.players[0].alive, false);
  assert.equal(game.players[0].trials.length, 0);
  assert.equal(game.log.some((e) => e.type === "playerDied" && e.playerId === 0 && e.cause === "no-trials"), true);
});

test("丽贝卡·诺斯：他人因指控翻牌时由丽贝卡自己抽 1，而不是当前玩家", () => {
  const game = baseGame(["rebecca-nurse", "none", "none", "none"]);
  setTrials(game, 1, ["townspeople", "townspeople"]);
  setHands(game, [[], ["accusation"], ["witness"], []]);
  game.currentPlayerId = 2;
  const result = playCard(game, { actorId: 2, cardId: "witness", targetId: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.players[0].hand.length, 0, "揭示之前丽贝卡不抽牌");
  const settled = settlePending(result.state);
  assert.equal(settled.state.players[0].hand.length, 1, "揭示之后丽贝卡抽牌");
  assert.equal(settled.state.players[2].hand.length, 0, "当前玩家不因丽贝卡能力抽牌");
  assert.equal(settled.events.some((e) => e.type === "cardDrawn" && e.playerId === 0), true);
});

test("12 人默认 2 女巫、每人 3 张身份卡；初始牌堆守恒", () => {
  const game = createGame({ playerCount: 12 }, { seed: 3 });
  assert.equal(game.config.witchCount, 2);
  assert.equal(game.players.every((p) => p.trials.length === 3), true);
  assert.equal(game.players.every((p) => p.hand.length === 3), true);
  assert.equal(game.deck.length, 58 - 36);
  assert.equal(game.players.reduce((n, p) => n + witchCountOf(p), 0), 2);
});

test("萨缪尔·帕里斯：花整个回合从弃牌堆拿非黑牌；蒂图巴可重排牌堆", () => {
  const samuel = baseGame(["samuel-parris", "none", "none", "none"]);
  samuel.players[0].hand = [];
  samuel.discard.push("accusation", "evidence", "conspiracy");
  const result = samuelTake(samuel, 0, ["accusation", "evidence"]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.state.players[0].hand, ["accusation", "evidence"]);
    assert.equal(result.state.players[0].used.samuel, 1);
  }
  assert.equal(samuelTake(samuel, 0, ["conspiracy"]).ok, false);

  const tituba = baseGame(["tituba", "none", "none", "none"]);
  const order = tituba.deck.slice().reverse();
  const reorder = titubaReorder(tituba, 0, order);
  assert.equal(reorder.ok, true);
  if (reorder.ok) assert.deepEqual(reorder.state.deck, order);
  assert.equal(titubaReorder(tituba, 0, order).ok, true, "原状态未消耗能力");
});

test("发牌相位：开局停在 deal，抽牌、出牌、结束回合都被拒绝", () => {
  const game = createGame({ playerCount: 5 }, { seed: 5 });
  assert.equal(game.phase, "deal");
  assert.deepEqual(drawTwo(game), { ok: false, reason: "not-action-phase" });
  assert.deepEqual(endTurn(game), { ok: false, reason: "not-action-phase" });
  assert.deepEqual(canPlayCard(game, 0, "witness", 1), { ok: false, reason: "not-action-phase" });
  assert.deepEqual(playCard(game, { actorId: 0, cardId: "witness", targetId: 1 }), { ok: false, reason: "not-action-phase" });
  assert.equal(game.log.some((e) => e.type === "cardDrawn" || e.type === "cardPlayed"), false, "没有动作写入日志");
});

test("5 人局每人两张候选角色；选定后另一张静默移出本局", () => {
  const game = createGame({ playerCount: 5 }, { seed: 21 });
  assert.equal(game.phase, "deal");
  assert.equal(game.players.every((p) => p.role === "none" && p.roleOptions.length === 2 && !p.roleChosen), true);
  assert.equal(new Set(game.players.flatMap((p) => p.roleOptions)).size, 10, "候选角色互不重复");
  const options = game.players[0].roleOptions.slice();
  const picked = options.find((role) => role !== "martha-corey") ?? options[0];
  const other = options.find((role) => role !== picked);
  assert.ok(other);
  const deckBefore = game.deck.slice();
  const discardBefore = game.discard.slice();
  const result = chooseRole(game, 0, picked);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.players[0].role, picked);
  assert.deepEqual(result.state.players[0].roleOptions, []);
  assert.equal(result.state.players[0].roleChosen, true);
  assert.equal(result.state.players.some((p) => p.role === other), false, "另一张不落到任何人");
  assert.equal(result.state.players.some((p) => p.roleOptions.includes(other)), false, "另一张不在候选里");
  assert.deepEqual(result.state.deck, deckBefore, "牌堆不变");
  assert.deepEqual(result.state.discard, discardBefore, "弃牌堆不变");
  assert.deepEqual(result.events, [{ type: "roleChosen", playerId: 0, role: picked }]);
  assert.deepEqual(result.state.log.at(-1), { type: "roleChosen", playerId: 0, role: picked });
  assert.equal(effectiveRole(result.state, 0), picked, "选择后角色生效");
  assert.equal(effectiveRole(game, 0), "none", "原状态不变");

  const otherView = project(result.state, 1);
  assert.equal(otherView.seats[0].role, picked, "其他座位能看到已选角色");
  assert.deepEqual(otherView.seats[0].roleOptions, [], "选定后候选对他人也清空");
  assert.equal(otherView.seats[1].role, "none", "未选座位角色仍未生效");
  assert.equal(otherView.seats[1].roleOptions.length, 2, "未选座位的候选仍公开");
});

test("未选中的候选角色不参与玛莎复制", () => {
  const game = createGame({ playerCount: 5 }, { seed: 1 });
  const seat = game.players.findIndex((p) => p.roleOptions.includes("martha-corey"));
  assert.notEqual(seat, -1, "5 人局应有一人拿到玛莎候选");
  const marthaOptions = game.players[seat].roleOptions.slice();
  const martha = chooseRole(game, seat, "martha-corey");
  assert.equal(martha.ok, true);
  if (!martha.ok) return;
  const neighbor = (seat - 1 + 5) % 5;
  const neighborRole = martha.state.players[neighbor].roleOptions[0];
  assert.ok(neighborRole);
  const picked = chooseRole(martha.state, neighbor, neighborRole);
  assert.equal(picked.ok, true);
  if (!picked.ok) return;
  assert.equal(effectiveRole(picked.state, seat), neighborRole, "玛莎复制右手边已选角色");
  const dropped = marthaOptions.find((role) => role !== "martha-corey");
  assert.ok(dropped);
  assert.notEqual(effectiveRole(picked.state, seat), dropped, "未选中的候选不可被复制");
});

test("角色选择被拒：重复选择、非候选、非发牌相位，且状态不变", () => {
  const game = createGame({ playerCount: 5 }, { seed: 9 });
  const picked = game.players[0].roleOptions[0];
  const first = chooseRole(game, 0, picked);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const chosen = first.state;
  const snapshot = JSON.stringify(chosen);
  assert.deepEqual(chooseRole(chosen, 0, picked), { ok: false, reason: "role-already-chosen" });
  const outsider = ALL_ROLES.find((role) => !chosen.players[1].roleOptions.includes(role));
  assert.ok(outsider);
  assert.deepEqual(chooseRole(chosen, 1, outsider), { ok: false, reason: "role-not-offered" });
  assert.deepEqual(chooseRole(chosen, 99, picked), { ok: false, reason: "unknown-player" });
  assert.equal(JSON.stringify(chosen), snapshot, "拒绝不改变状态");

  const started = startGame(finishDeal(chosen), 0);
  assert.equal(started.phase, "action");
  const startedSnapshot = JSON.stringify(started);
  assert.deepEqual(chooseRole(started, 1, picked), { ok: false, reason: "not-deal-phase" });
  assert.equal(JSON.stringify(started), startedSnapshot, "非发牌相位拒绝且状态不变");
});

test("8 人以上开局即定角色：12 人每人一张、候选为空", () => {
  const game = createGame({ playerCount: 12 }, { seed: 10 });
  assert.equal(game.phase, "deal");
  assert.equal(game.players.every((p) => p.role !== "none" && p.roleChosen && p.roleOptions.length === 0), true);
  assert.equal(new Set(game.players.map((p) => p.role)).size, 12, "12 人角色互不重复");
  assert.deepEqual(chooseRole(game, 0, "none"), { ok: false, reason: "role-already-chosen" });
});

test("发牌相位投影：所有人角色与候选公开，自己的身份卡张数与实际一致", () => {
  const game = createGame({ playerCount: 9 }, { seed: 11 });
  const view = project(game, 8);
  assert.equal(view.phase, "deal");
  assert.deepEqual(view.seats.map((s) => s.role), game.players.map((p) => p.role));
  assert.deepEqual(view.seats.map((s) => s.roleOptions), game.players.map((p) => p.roleOptions));
  assert.deepEqual(view.seats.map((s) => s.roleChosen), game.players.map((p) => p.roleChosen));
  assert.equal(view.self.trials.length, 3);
  assert.equal(view.seats[8].trials.length, 3);
  assert.equal(view.seats[0].trials.length, 4);
});

test("推进发牌相位：未选者按第一张候选自动落定，随后进入黎明", () => {
  const game = createGame({ playerCount: 5 }, { seed: 12 });
  const firstPicks = game.players.map((p) => p.roleOptions[0]);
  assert.throws(() => startGame(game, 0), /game-already-started/, "不能从发牌相位直接开局");
  const dawn = finishDeal(game);
  assert.equal(dawn.phase, "dawn");
  assert.equal(dawn.players.every((p) => p.roleChosen && p.roleOptions.length === 0), true);
  assert.deepEqual(dawn.players.map((p) => p.role), firstPicks);
  assert.equal(dawn.log.filter((e) => e.type === "roleChosen").length, 0, "超时兜底不伪造选择日志");
  assert.equal(startGame(dawn, 0).phase, "action");
});

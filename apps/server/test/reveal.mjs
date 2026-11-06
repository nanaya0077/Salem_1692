import WebSocket from "ws";
import assert from "node:assert/strict";
import { CARD_CATALOG } from "../../../packages/rules/src/index.ts";
import { passDealPhase } from "./lib/deal.mjs";

/**
 * 票 #13 生命周期：揭示命令与自动回合拦截。
 * 需要服务端 SALEM_FAKE_CLOCK=1（回合计时也走假时钟，才能把「选着选着就到期」推出来）。
 */
const BASE = process.env.BASE || "http://127.0.0.1:8121";
const WS = BASE.replace(/^http/, "ws") + "/ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TURN_MS = Number(process.env.TURN_MS || 90000);
/** 红卡只有三种，按点数从大到小打，尽快把目标压到门槛。 */
const RED_POINTS = ["witness", "evidence", "accusation"];

class Client {
  constructor(name) {
    this.name = name;
    this.ws = new WebSocket(WS);
    this.seatId = null;
    this.code = null;
    this.room = null;
    this.projection = null;
    this.private = null;
    this.errors = [];
    this.clockReplies = [];
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "welcome") { this.seatId = msg.seatId; this.code = msg.code; }
      if (msg.type === "room") this.room = msg.room;
      if (msg.type === "projection") { this.projection = msg.projection; this.private = msg.private; this.room = msg.room ?? this.room; }
      if (msg.type === "error") this.errors.push(msg);
      if (msg.type === "clock") this.clockReplies.push(msg);
    });
  }
  open() { return new Promise((resolve, reject) => { this.ws.once("open", resolve); this.ws.once("error", reject); }); }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
  close() { this.ws.close(); }
  get version() { return this.projection?.version ?? -1; }
}

async function waitFor(label, fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(30);
  }
  throw new Error("timeout waiting for " + label);
}

function pickTarget(projection, actorId) {
  const alive = projection.seats.filter((s) => s.alive && s.id !== actorId);
  if (!alive.length) return null;
  // 指控全砸一个人身上：先挑已经背得最多的，凑门槛最快。
  alive.sort((a, b) => b.accusations - a.accusations || a.id - b.id);
  return alive[0].id;
}

function bestRed(hand) {
  for (const cardId of RED_POINTS) if (hand.includes(cardId)) return cardId;
  return null;
}

function voteDawn(clients) {
  for (const c of clients) {
    const dawn = c.private?.dawn;
    if (!dawn?.isWitch || dawn.submitted) continue;
    const target = c.projection.seats.find((s) => s.alive && s.id !== c.seatId);
    if (target) c.send({ type: "action", action: { kind: "dawn", targetId: target.id } });
  }
}

function voteNight(clients) {
  for (const c of clients) {
    const night = c.private?.night;
    if (!night || night.submitted) continue;
    if (!night.required.includes(c.seatId)) continue;
    const action = { kind: "night" };
    if (night.isWitch) {
      const target = c.projection.seats.find((s) => s.alive && s.id !== c.seatId);
      if (target) action.targetId = target.id;
    }
    if (night.isConstable) action.hammerTargetId = null;
    c.send({ type: "action", action });
  }
}

async function setUpRoom(names) {
  const clients = names.map((name) => new Client(name));
  await Promise.all(clients.map((c) => c.open()));
  clients[0].send({ type: "create", name: names[0] });
  await waitFor("create", () => clients[0].code);
  const code = clients[0].code;
  for (let i = 1; i < clients.length; i++) clients[i].send({ type: "join", code, name: names[i] });
  await waitFor("seats", () => clients.every((c) => c.room?.seats?.length === names.length));
  for (const c of clients) c.send({ type: "ready", ready: true });
  await waitFor("startable", () => clients.every((c) => c.room?.startable), 5000);
  clients[0].send({ type: "start" });
  for (const c of clients) {
    await passDealPhase({ seatId: c.seatId, getProjection: () => c.projection, getPrivate: () => c.private, send: (m) => c.send(m), waitFor });
  }
  await waitFor("dawn", () => clients.every((c) => c.projection?.phase === "dawn"), 8000);
  return { clients, code };
}

/** 轮流把红卡往同一个活人身上砸，直到有人拿到「选哪张」的挂起。 */
async function driveUntilPending(clients, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const chooser = clients.find((c) => c.projection?.pendingReveal);
    if (chooser) return chooser;
    const view = clients[0].projection;
    if (!view) { await sleep(40); continue; }
    if (view.phase === "over") throw new Error("对局在挂起出现前就分出了胜负");
    if (view.phase === "dawn") { voteDawn(clients); await sleep(80); continue; }
    if (view.phase === "night") { voteNight(clients); await sleep(80); continue; }
    if (view.phase !== "action") { await sleep(60); continue; }
    const actor = clients.find((c) => c.seatId === view.currentPlayerId);
    if (!actor?.projection?.self) { await sleep(40); continue; }
    if (view.actionTaken) {
      actor.send({ type: "action", action: { kind: "end" } });
    } else {
      const targetId = pickTarget(view, actor.seatId);
      const cardId = targetId === null ? null : bestRed(actor.projection.self.hand);
      if (cardId) actor.send({ type: "action", action: { kind: "play", play: { cardId, targetId } } });
      else actor.send({ type: "action", action: { kind: "draw" } });
    }
    await sleep(90);
  }
  throw new Error("timeout waiting for 挂起揭示");
}

// ── 片一：挂起只报给选择者；别人的命令被拒；选择者揭示一张后回合继续 ──────────────
const { clients } = await setUpRoom(["阿比盖尔", "约翰", "玛丽", "乔治"]);
const chooser = await driveUntilPending(clients);
const pending = chooser.projection.pendingReveal;
const targetId = pending.targetId;
console.log("pending ok: chooser", chooser.name, "#" + chooser.seatId, "-> target", targetId, "slots", pending.slots.join(","));

assert.equal(pending.chooserId, chooser.seatId, "挂起的 chooserId 应是本人");
assert.ok(
  clients.filter((c) => c !== chooser).every((c) => !c.projection.pendingReveal),
  "挂起只该投给选择者，别人的投影里不该有 pendingReveal",
);
const hiddenSlots = pending.slots.map((s, i) => (s === "hidden" ? i : -1)).filter((i) => i >= 0);
assert.ok(hiddenSlots.length >= 2, "挂起的前提是至少两张未揭示身份卡，实际 " + hiddenSlots.length);

const revealedBefore = clients[0].projection.seats[targetId].trials.filter((t) => t.revealed).length;
const versionBefore = clients[0].version;
const bystander = clients.find((c) => c !== chooser);
const bystanderErrors = bystander.errors.length;

// 别人的命令：抽牌、出牌、结束回合、替人揭示，一律被拒，界面一个字节都不动。
const bystanderCard = bestRed(bystander.projection.self.hand);
bystander.send({ type: "action", action: { kind: "draw" } });
bystander.send({ type: "action", action: { kind: "end" } });
if (bystanderCard) {
  bystander.send({ type: "action", action: { kind: "play", play: { cardId: bystanderCard, targetId } } });
}
bystander.send({ type: "action", action: { kind: "reveal", trialIndex: hiddenSlots[0] } });
await sleep(250);
assert.ok(bystander.errors.length > bystanderErrors, "挂起期别人的命令应被拒绝，实际没有报错");
const bystanderReasons = bystander.errors.slice(bystanderErrors).map((e) => e.reason);
assert.ok(
  !bystanderReasons.includes("unknown-action"),
  "揭示命令不该被当成未知操作：" + bystanderReasons.join(","),
);
assert.ok(
  bystanderReasons.includes("not-chooser"),
  "非选择者替人揭示应被拒（not-chooser），实际 " + bystanderReasons.join(","),
);
assert.equal(clients[0].version, versionBefore, "被拒的命令不该改动对局状态");

// 选择者自己：挂起期不能抽牌、不能结束回合；越界位置号、替别人揭示也要被拒。
const chooserErrors = chooser.errors.length;
chooser.send({ type: "action", action: { kind: "draw" } });
chooser.send({ type: "action", action: { kind: "end" } });
await sleep(200);
const chooserReasons = chooser.errors.slice(chooserErrors).map((e) => e.reason);
assert.deepEqual(chooserReasons, ["pending-reveal", "pending-reveal"], "挂起期选择者不该能抽牌或结束回合");
assert.equal(clients[0].version, versionBefore, "被拒的命令不该改动对局状态");
chooser.send({ type: "action", action: { kind: "reveal", trialIndex: 99 } });
await sleep(150);
assert.equal(chooser.errors.at(-1).reason, "bad-trial-index", "越界位置号应被拒");
assert.equal(clients[0].version, versionBefore, "越界位置号不该改动对局状态");
assert.ok(chooser.projection.pendingReveal, "被拒之后挂起应还在");

// 选择者本人揭示第一张未揭示的身份卡。
const firstHidden = hiddenSlots[0];
const currentBefore = chooser.projection.currentPlayerId;
chooser.send({ type: "action", action: { kind: "reveal", trialIndex: firstHidden } });
await waitFor("挂起解除", () => !chooser.projection.pendingReveal, 5000);
await waitFor("揭示落定", () => clients[0].projection.seats[targetId].trials[firstHidden].revealed, 5000);
const revealedAfter = clients[0].projection.seats[targetId].trials.filter((t) => t.revealed).length;
assert.equal(revealedAfter, revealedBefore + 1, "揭示应正好翻一张");
assert.equal(
  clients.filter((c) => c.projection.seats[targetId].trials[firstHidden].revealed).length,
  clients.length,
  "揭示结果要广播给所有人",
);
console.log("reveal ok: 翻的是第", firstHidden, "张，目标现已揭示", revealedAfter, "张");

// 手动揭示：事件里不该带 auto，客户端凭这一点不加「自动取了第一个位置」的后缀。
const manualEvent = clients[0].projection.log.filter((e) => e.type === "trialRevealed").at(-1);
assert.equal(manualEvent?.playerId, targetId, "最后一条揭示事件应指向本次目标");
assert.ok(!("auto" in manualEvent), "手动揭示的事件不该带 auto 字段，实际 " + JSON.stringify(manualEvent));

// 重复揭示不该翻第二张（幂等：状态不变）。
const dupVersion = clients[0].version;
chooser.send({ type: "action", action: { kind: "reveal", trialIndex: hiddenSlots[1] } });
await sleep(200);
assert.equal(clients[0].version, dupVersion, "重复揭示命令不该改动对局状态");
assert.equal(
  clients[0].projection.seats[targetId].trials.filter((t) => t.revealed).length,
  revealedAfter,
  "重复揭示命令不能翻第二张",
);
console.log("duplicate reveal ignored:", chooser.errors.at(-1)?.reason);

for (const c of clients) c.close();

// ── 片二：挂起 + 回合计时到期 → 自动翻第一张未揭示，然后照常交出回合 ──────────────
// 这里绝不出现「挂着选择先抽两张」：挂起期抽牌会被规则层拒掉，自动回合必须先把选择落定。
const room2 = await setUpRoom(["阿比盖尔", "约翰", "玛丽", "乔治"]);
const waiter = await driveUntilPending(room2.clients);
const pending2 = waiter.projection.pendingReveal;
const hidden2 = pending2.slots.map((s, i) => (s === "hidden" ? i : -1)).filter((i) => i >= 0);
const firstHidden2 = hidden2[0];
const target2 = pending2.targetId;
const chooserSeat = waiter.projection.currentPlayerId;
const handBefore = waiter.projection.self.hand.length;
const logBefore = room2.clients[0].projection.log.length;
console.log("pending ok (计时到期那局): chooser", waiter.name, "#" + chooserSeat, "-> target", target2);

// 谁都可以推假时钟；只有服务端在 SALEM_FAKE_CLOCK=1 下认。
room2.clients[0].send({ type: "clock", advance: TURN_MS + 600 });
await waitFor("clock reply", () => room2.clients[0].clockReplies.length > 0, 5000);
assert.ok(room2.clients[0].clockReplies.at(-1).fired >= 1, "推进假时钟应触发回合计时");

await waitFor("挂起自动解除", () => !waiter.projection.pendingReveal, 6000);
await waitFor("自动揭示落定", () => room2.clients[0].projection.seats[target2].trials[firstHidden2].revealed, 6000);
const revealedAuto = room2.clients[0].projection.seats[target2].trials.filter((t) => t.revealed).length;
assert.equal(revealedAuto, 1, "自动回合只该翻一张（第一张未揭示的）");
assert.equal(
  room2.clients[0].projection.seats[target2].trials.findIndex((t) => t.revealed),
  firstHidden2,
  "自动揭示应取第一张未揭示的身份卡",
);

const after = room2.clients[0].projection;
assert.ok(
  after.currentPlayerId !== chooserSeat || after.phase !== "action",
  "揭示落定后要把回合交出去，不能停在原座位",
);
const newEvents = after.log.slice(logBefore);
const drewTwo = newEvents.some((e) => e.type === "cardDrawn" && e.playerId === chooserSeat && e.count === 2);
assert.ok(!drewTwo, "挂着选择的时候抽两张：自动回合必须先揭示再继续");
const selfAfter = waiter.projection.self;
assert.ok(selfAfter.hand.length <= handBefore, "自动揭示不该顺手给选择者补牌（" + handBefore + " -> " + selfAfter.hand.length + "）");
// 超时代翻：auto 由规则层写进事件本身，客户端不用再另外数日志对位。
const autoEvent = after.log.filter((e) => e.type === "trialRevealed").at(-1);
assert.equal(autoEvent?.playerId, target2, "最后一条揭示事件应指向本次目标");
assert.equal(autoEvent?.auto, true, "超时自动揭示的事件必须带 auto: true，实际 " + JSON.stringify(autoEvent));
console.log("turn timeout ok: 自动翻第", firstHidden2, "张，回合交到", after.currentPlayerId);

for (const c of room2.clients) c.close();

// ── 片三：机器人当选择者时立刻翻第一张，不等回合计时 ────────────────────────────
// 房主只抽牌/结束回合，从不打红卡，所以它永远不是选择者；出现的揭示一律来自机器人选择者。
// 假时钟下机器人的回合上限根本不会到期，这一局能往前走本身就是「机器人不等人」的证据。
const r3 = await (async () => {
  const c = new Client("房主");
  await c.open();
  c.send({ type: "create", name: "房主" });
  await waitFor("create", () => c.code);
  for (let i = 0; i < 3; i += 1) c.send({ type: "add-bot" });
  await waitFor("4 seats", () => c.room?.seats?.length === 4);
  c.send({ type: "ready", ready: true });
  await waitFor("startable", () => c.room?.startable, 5000);
  c.send({ type: "start" });
  await passDealPhase({ seatId: c.seatId, getProjection: () => c.projection, getPrivate: () => c.private, send: (m) => c.send(m), waitFor });
  await waitFor("dawn", () => c.projection?.phase === "dawn", 8000);
  return { clients: [c], host: c };
})();
const host = r3.host;
const botIds = new Set(host.room.seats.filter((s) => s.bot).map((s) => s.id));
assert.equal(botIds.size, 3, "应有三张机器人座位");

const bots = r3.clients;
const startC = Date.now();
let botReveals = [];
while (Date.now() - startC < 120000) {
  const view = host.projection;
  if (view?.phase === "over") break;
  botReveals = (view?.log ?? []).filter((e) => e.type === "trialRevealed" && botIds.has(e.chooserId));
  if (botReveals.length) break;
  if (view?.phase === "dawn") { voteDawn(bots); await sleep(60); continue; }
  if (view?.phase === "night") { voteNight(bots); await sleep(60); continue; }
  if (view?.phase === "action" && view.currentPlayerId === host.seatId) {
    host.send({ type: "action", action: view.actionTaken ? { kind: "end" } : { kind: "draw" } });
  }
  await sleep(70);
}
assert.ok(botReveals.length > 0, "机器人当选择者时应在 " + Math.round((Date.now() - startC) / 1000) + " 秒内自己翻牌，不该等人");
assert.ok(botReveals.every((e) => botIds.has(e.chooserId)), "揭示事件的选择者都应是机器人座位");
// 4 人局每人 5 张身份卡：翻第一张时至少还有 2 张未揭示，所以这一翻必然越过了挂起。
const revealedSeat = host.projection.seats[botReveals[0].playerId];
assert.equal(revealedSeat.trials.length, 5, "4 人局每人应有 5 张身份卡");
assert.ok(revealedSeat.trials.some((t) => t.revealed), "机器人选择者应已翻出第一张");
assert.ok(botReveals.every((e) => e.auto === true), "机器人托管代翻的事件也要带 auto: true");
console.log("bot chooser ok:", botReveals.map((e) => "选" + e.chooserId + "翻" + e.playerId).join(", "));

host.close();
console.log("\nreveal.mjs ok");

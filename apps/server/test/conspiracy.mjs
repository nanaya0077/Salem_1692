import WebSocket from "ws";
import assert from "node:assert/strict";
import { passDealPhase } from "./lib/deal.mjs";

/**
 * 票 #55：传染阶段的服务端行为。
 * 依赖 SALEM_FAKE_CLOCK=1 与 SALEM_TEST_CONSPIRACY=1（把传染压到牌堆顶，稳定复现抽到即进阶段）。
 * 覆盖：人类选择 / 非抽到者被拒 / 两个 step 的 20 秒兜底 / 机器人不等计时 / 投影零泄漏。
 */
const BASE = process.env.BASE || "http://127.0.0.1:8192";
const WS = BASE.replace(/^http/, "ws") + "/ws";
const CONSPIRACY_MS = Number(process.env.CONSPIRACY_MS || 20000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      if (msg.type === "projection") {
        this.projection = msg.projection;
        this.private = msg.private;
        this.room = msg.room ?? this.room;
      }
      if (msg.type === "error") this.errors.push(msg);
      if (msg.type === "clock") this.clockReplies.push(msg);
    });
  }
  open() { return new Promise((resolve, reject) => { this.ws.once("open", resolve); this.ws.once("error", reject); }); }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
  close() { this.ws.close(); }
}

async function waitFor(label, fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(30);
  }
  throw new Error("timeout waiting for " + label);
}

function voteDawn(clients) {
  for (const c of clients) {
    const dawn = c.private?.dawn;
    if (!dawn?.isWitch || dawn.submitted) continue;
    const target = c.projection.seats.find((s) => s.alive && s.id !== c.seatId);
    if (target) c.send({ type: "action", action: { kind: "dawn", targetId: target.id } });
  }
}

async function setUpHumanRoom(names) {
  const clients = names.map((name) => new Client(name));
  await Promise.all(clients.map((c) => c.open()));
  clients[0].send({ type: "create", name: names[0] });
  await waitFor("create", () => clients[0].code);
  const code = clients[0].code;
  for (let i = 1; i < clients.length; i += 1) clients[i].send({ type: "join", code, name: names[i] });
  await waitFor("seats", () => clients.every((c) => c.room?.seats?.length === names.length));
  for (const c of clients) c.send({ type: "ready", ready: true });
  await waitFor("startable", () => clients.every((c) => c.room?.startable), 5000);
  clients[0].send({ type: "start" });
  for (const c of clients) {
    await passDealPhase({ seatId: c.seatId, getProjection: () => c.projection, getPrivate: () => c.private, send: (m) => c.send(m), waitFor });
  }
  await waitFor("dawn/action", () => ["dawn", "action"].includes(clients[0].projection?.phase), 8000);
  if (clients[0].projection.phase === "dawn") voteDawn(clients);
  await waitFor("action", () => clients[0].projection?.phase === "action", 8000);
  return clients;
}

async function drawConspiracy(clients) {
  const view = clients[0].projection;
  const actor = clients.find((c) => c.seatId === view.currentPlayerId);
  assert.ok(actor, "当前玩家应在客户端里");
  actor.send({ type: "action", commandId: "draw-conspiracy", action: { kind: "draw" } });
  await waitFor("进入传染阶段", () => clients[0].projection?.phase === "conspiracy", 6000);
  return actor;
}

let commandSeq = 0;
function submitAvailable(clients) {
  for (const c of clients) {
    const view = c.projection?.conspiracy;
    if (!view || view.submitted || !view.candidates?.length) continue;
    c.send({
      type: "action",
      commandId: "conspiracy-" + (++commandSeq),
      action: { kind: "conspiracyPick", trialIndex: view.candidates[0] },
    });
  }
}

async function waitSettled(clients, timeout = 12000) {
  const start = Date.now();
  while (clients[0].projection?.phase === "conspiracy") {
    if (Date.now() - start > timeout) throw new Error("传染阶段没有在 " + timeout + "ms 内结算");
    submitAvailable(clients);
    await sleep(60);
  }
}

// ── 片一：人类抽到传染；投影所有人可见、候选只给出手者；非抽到者被拒 ─────────────
const clients1 = await setUpHumanRoom(["甲", "乙", "丙", "丁"]);
const drawer = await drawConspiracy(clients1);
const opened = clients1[0].projection;
assert.equal(opened.phase, "conspiracy");
assert.ok(opened.conspiracy, "1 号客户端应看到传染阶段");
const allowedKeys = new Set(["step", "drawerId", "catSeatId", "submitted", "submittedCount", "eligibleCount", "candidates", "revealed"]);
for (const c of clients1) {
  const view = c.projection.conspiracy;
  assert.ok(view, "每个座位都该看到阶段与计数");
  assert.equal(view.drawerId, drawer.seatId, "抽到者对所有人公开");
  for (const key of Object.keys(view)) assert.ok(allowedKeys.has(key), "传染病视图不应多出字段：" + key);
  assert.ok(view.candidates.every((n) => Number.isInteger(n)), "候选只能是位置号");
  assert.ok(view.revealed.every((n) => Number.isInteger(n)), "已揭示位置只能是位置号");
  if (view.step === "cat" && c.seatId !== drawer.seatId) {
    assert.deepEqual(view.candidates, [], "黑猫步只有抽到者能看候选");
  }
}
if (opened.conspiracy.step === "cat") {
  const bystander = clients1.find((c) => c.seatId !== drawer.seatId);
  const before = bystander.errors.length;
  bystander.send({ type: "action", commandId: "cp-bad", action: { kind: "conspiracyPick", trialIndex: 0 } });
  await waitFor("非抽到者被拒", () => bystander.errors.length > before, 3000);
  assert.equal(bystander.errors.at(-1).reason, "not-drawer");
}
// 阶段中拒绝抽牌：任何客户端发 draw 都该拿到 conspiracy-phase。
const phaseErrors = clients1[0].errors.length;
clients1[0].send({ type: "action", commandId: "cp-draw", action: { kind: "draw" } });
await waitFor("阶段中拒绝抽牌", () => clients1[0].errors.length > phaseErrors, 3000);
assert.equal(clients1[0].errors.at(-1).reason, "conspiracy-phase");

await waitSettled(clients1);
for (const c of clients1) assert.equal(c.projection.conspiracy ?? null, null, "结算后不应再投传染视图");
assert.equal(clients1[0].projection.phase !== "conspiracy", true);
const swaps1 = clients1[0].projection.log.filter((e) => e.type === "conspiracySwap").length;
assert.ok(swaps1 > 0, "结算应留下换牌事件");
console.log("片一 ok：人类抽到传染，阶段/计数公开，候选只给出手者，非抽到者被拒");
for (const c of clients1) c.close();

// ── 片二：两个 step 的 20 秒兜底（cat 默认第一张，pick 默认左邻第一张）─────────────
const clients2 = await setUpHumanRoom(["阿比盖尔", "约翰", "玛丽", "乔治"]);
await drawConspiracy(clients2);
const c2 = clients2[0];
const initialStep = c2.projection.conspiracy.step;
c2.send({ type: "clock", advance: CONSPIRACY_MS + 1000 });
await waitFor("clock reply", () => c2.clockReplies.length > 0, 4000);
await waitFor("cat 兜底或直接进 pick", () => {
  const view = c2.projection;
  return view.phase !== "conspiracy" || view.conspiracy.step === "pick";
}, 6000);
if (c2.projection.phase === "conspiracy") {
  c2.send({ type: "clock", advance: CONSPIRACY_MS + 1000 });
  await waitFor("pick 兜底结算", () => c2.projection.phase !== "conspiracy", 6000);
}
assert.notEqual(c2.projection.phase, "conspiracy", "两个屏障都该由兜底走完");
// 有黑猫持有者且能翻牌时才会走 cat 步；没有（例如玛丽持有）时直接进 pick。
if (initialStep === "cat") {
  assert.ok(
    c2.projection.log.some((e) => e.type === "trialRevealed" && e.cause === "conspiracy"),
    "cat 步兜底应完成黑猫揭示",
  );
}
console.log("片二 ok：20 秒兜底能走完 cat 与 pick，阶段不会卡死");
for (const c of clients2) c.close();

// ── 片三：机器人当抽到者/换牌者时不等 20 秒 ─────────────────────────────────────
const host = new Client("房主");
await host.open();
host.send({ type: "create", name: "房主" });
await waitFor("create", () => host.code);
for (let i = 0; i < 3; i += 1) host.send({ type: "add-bot" });
await waitFor("4 seats", () => host.room?.seats?.length === 4);
host.send({ type: "ready", ready: true });
await waitFor("startable", () => host.room?.startable, 5000);
host.send({ type: "start" });
await waitFor("deal", () => host.projection?.phase === "deal", 8000);
await passDealPhase({ seatId: host.seatId, getProjection: () => host.projection, getPrivate: () => host.private, send: (m) => host.send(m), waitFor });
await waitFor("dawn/action", () => ["dawn", "action"].includes(host.projection?.phase), 8000);
if (host.projection.phase === "dawn") voteDawn([host]);
await waitFor("action", () => host.projection?.phase === "action", 8000);

const botDeadline = Date.now() + 20000;
while (host.projection.phase === "action" && Date.now() < botDeadline) {
  if (host.projection.currentPlayerId === host.seatId) {
    host.send({ type: "action", commandId: "host-draw-" + (++commandSeq), action: { kind: "draw" } });
  }
  await sleep(80);
}
await waitFor("机器人抽到传染", () => host.projection.phase === "conspiracy", 8000);

// 若 stage 是 cat 且抽到者正好是真人，真人必须先提交；否则机器人应自己推进。
if (host.projection.conspiracy.step === "cat" && host.projection.conspiracy.drawerId === host.seatId) {
  const view = host.projection.conspiracy;
  host.send({ type: "action", commandId: "host-cat", action: { kind: "conspiracyPick", trialIndex: view.candidates[0] } });
}
await waitFor("cat 步不等 20 秒", () => {
  const view = host.projection;
  return view.phase !== "conspiracy" || view.conspiracy.step !== "cat";
}, 4000);

const partsDeadline = Date.now() + 8000;
while (host.projection.phase === "conspiracy") {
  const view = host.projection.conspiracy;
  if (!view.submitted && view.candidates?.length) {
    host.send({ type: "action", commandId: "host-pick-" + (++commandSeq), action: { kind: "conspiracyPick", trialIndex: view.candidates[0] } });
  }
  if (Date.now() > partsDeadline) throw new Error("机器人换牌没有在 8 秒内收齐");
  await sleep(60);
}
assert.notEqual(host.projection.phase, "conspiracy");
console.log("片三 ok：机器人不等待 20 秒，cat → pick 自动推进");
host.close();

console.log("conspiracy ok: 人类选择 / 非抽到者拒绝 / 两段兜底 / 机器人即时 / 投影零泄漏");

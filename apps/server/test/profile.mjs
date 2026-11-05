import WebSocket from "ws";
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://127.0.0.1:8103";
const WS = BASE.replace(/^http/, "ws") + "/ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) {
    this.name = name;
    this.ws = new WebSocket(WS);
    this.seatId = null;
    this.code = null;
    this.token = null;
    this.welcome = null;
    this.room = null;
    this.projection = null;
    this.private = null;
    this.errors = [];
    this.notices = [];
    this.avatars = [];
    this.leaks = [];
    this.ws.on("message", (raw) => {
      const text = raw.toString();
      const msg = JSON.parse(text);
      if (msg.type === "welcome") {
        this.welcome = msg;
        this.seatId = msg.seatId;
        this.code = msg.code;
        this.token = msg.token;
      }
      if (msg.type === "room" || msg.type === "projection") {
        if (text.includes("data:image")) this.leaks.push(msg.type);
      }
      if (msg.type === "room") this.room = msg.room;
      if (msg.type === "projection") {
        this.projection = msg.projection;
        this.private = msg.private;
        this.room = msg.room ?? this.room;
      }
      if (msg.type === "error") this.errors.push(msg);
      if (msg.type === "notice") this.notices.push(msg);
      if (msg.type === "avatar") this.avatars.push(msg);
    });
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
  }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
  close() { this.ws.close(); }
  seat(id) { return this.room?.seats?.find((s) => s.id === id) ?? null; }
  projectedSeat(id) { return this.projection?.seats?.find((s) => s.id === id) ?? null; }
}

async function waitFor(label, fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error("timeout waiting for " + label);
}

// 四人开局到 action 阶段，用于在对局中验证「改名」与对局状态同步。
const names = ["阿比盖尔", "约翰", "玛丽", "乔治"];
const clients = names.map((name) => new Client(name));
await Promise.all(clients.map((c) => c.open()));
const [abigail, john, mary, george] = clients;

abigail.send({ type: "create", name: names[0] });
await waitFor("create", () => abigail.code);
const code = abigail.code;
for (let i = 1; i < clients.length; i++) clients[i].send({ type: "join", code, name: names[i] });
await waitFor("4 seats", () => clients.every((c) => c.room?.seats?.length === 4));
for (const c of clients) c.send({ type: "ready", ready: true });
await waitFor("startable", () => clients.every((c) => c.room?.startable), 5000);
abigail.send({ type: "start" });
await waitFor("dawn", () => clients.every((c) => c.projection?.phase === "dawn"), 8000);
for (const c of clients) {
  if (c.private?.dawn?.isWitch && !c.private.dawn.submitted) {
    c.send({ type: "action", commandId: "dawn-" + c.seatId, action: { kind: "dawn", targetId: 0 } });
  }
}
await waitFor("action", () => clients.every((c) => c.projection?.phase === "action"), 10000);
console.log("room", code, "in action phase; current", abigail.projection.currentPlayerId);

// ── 片一：改名同时写两处，广播一次提示，不动对局日志与投影版本号 ──────────────
const renamerId = john.seatId;
const oldName = names[1];
const newName = "约翰·普罗克特";
const beforeLog = abigail.projection.log.length;
const beforeVersion = abigail.projection.version;
john.send({ type: "profile", name: newName });
await waitFor("room seats renamed", () => clients.every((c) => c.seat(renamerId)?.name === newName), 8000);
await waitFor("projection seats renamed", () => clients.every((c) => c.projectedSeat(renamerId)?.name === newName), 8000);
for (const c of clients) {
  assert.equal(c.seat(renamerId)?.name, newName, c.name + " room seat name");
  assert.equal(c.projectedSeat(renamerId)?.name, newName, c.name + " projection seat name");
  const roomNames = c.room.seats.map((s) => s.name);
  const projectedNames = c.projection.seats.map((s) => s.name);
  assert.equal(roomNames.includes(oldName), false, c.name + " room 里旧名残留");
  assert.equal(projectedNames.includes(oldName), false, c.name + " projection 里旧名残留");
}
const expectedNotice = `「${oldName}」改名为「${newName}」`;
for (const c of [abigail, mary, george]) {
  const hits = c.notices.filter((n) => n.message === expectedNotice);
  assert.equal(hits.length, 1, c.name + " 收到改名提示条数");
}
assert.equal(abigail.projection.log.length, beforeLog, "改名不应写对局日志");
assert.equal(abigail.projection.version, beforeVersion, "改名不应动投影版本号");
console.log("rename ok:", oldName, "->", newName, "; log", beforeLog, "unchanged");

// 1 秒硬闸：同一座位 1 秒内第二次写入被静默丢弃，不报错。
await sleep(1100);
const errorCountBefore = john.errors.length;
john.send({ type: "profile", name: "约翰甲" });
john.send({ type: "profile", name: "约翰乙" });
await waitFor("first gate write applied", () => clients.every((c) => c.seat(renamerId)?.name === "约翰甲"), 8000);
await sleep(200);
assert.equal(clients.every((c) => c.seat(renamerId)?.name === "约翰甲"), true, "超频写入不应生效");
assert.equal(john.errors.length, errorCountBefore, "超频写入不应报错");
assert.equal(abigail.notices.filter((n) => n.message.includes("约翰乙")).length, 0, "超频写入不应广播提示");
console.log("profile gate ok: second write dropped silently");

// 身份只来自连接：消息里声明别人的座位也改不到别人。
await sleep(1100);
mary.send({ type: "profile", name: "冒名顶替", seatId: renamerId, targetSeatId: renamerId, id: renamerId });
await waitFor("own seat renamed", () => clients.every((c) => c.seat(mary.seatId)?.name === "冒名顶替"), 8000);
await sleep(200);
for (const c of clients) {
  assert.equal(c.seat(renamerId)?.name, "约翰甲", c.name + " 别人的座位被改动了");
  assert.equal(c.seat(mary.seatId)?.name, "冒名顶替", c.name + " 自己的座位没改");
}
console.log("profile identity ok: only own seat changed");

// ── 片二：头像单独广播、welcome 带全量头像、room/projection 不带头像 ─────────
function fakeAvatar(kind, bytes) {
  const buf = Buffer.alloc(bytes, 0x20);
  if (kind === "webp") {
    buf.write("RIFF", 0, "latin1");
    buf.write("WEBP", 8, "latin1");
  } else {
    buf[0] = 0xff;
    buf[1] = 0xd8;
    buf[2] = 0xff;
  }
  return `data:image/${kind};base64,` + buf.toString("base64");
}

await sleep(1100);
const avatarA = fakeAvatar("webp", 4096);
const johnSeat = john.seatId;
john.send({ type: "profile", avatar: avatarA });
await waitFor("avatar broadcast", () => mary.avatars.some((m) => m.seatId === johnSeat && m.dataUrl === avatarA), 8000);
assert.equal(
  mary.avatars.filter((m) => m.seatId === johnSeat && m.dataUrl === avatarA).length,
  1,
  "头像变更应广播一条单独消息",
);
console.log("avatar broadcast ok; bytes", avatarA.length);

const marySeat = mary.seatId;
const maryToken = mary.token;
mary.close();
await waitFor("mary offline", () => abigail.seat(marySeat)?.connected === false, 8000);
const mary2 = new Client("玛丽重连");
await mary2.open();
mary2.send({ type: "join", code, token: maryToken });
await waitFor("reconnect welcome", () => mary2.welcome?.reconnected && mary2.seatId === marySeat, 8000);
assert.equal(mary2.welcome.avatars?.[String(johnSeat)], avatarA, "重连 welcome 应带全量头像");
assert.equal(
  Object.prototype.hasOwnProperty.call(mary2.welcome.avatars ?? {}, String(marySeat)),
  false,
  "没有头像的座位不应出现",
);
await waitFor("reconnect projection", () => mary2.projection?.phase === "action", 8000);
console.log("welcome.avatars ok on reconnect");

const liveClients = [abigail, john, mary2, george];
for (const c of [...liveClients, mary]) {
  assert.deepEqual(c.leaks, [], c.name + " 的 room/projection 里出现了 data:image");
}
console.log("room/projection carry no avatar");

// ── 片三：新加入的 welcome 带全量头像；过大/非法被拒且座位不变；可移除 ──────
const host2 = new Client("房主二");
await host2.open();
host2.send({ type: "create", name: "房主二" });
await waitFor("room2 created", () => host2.code);
const code2 = host2.code;
const host2Seat = host2.seatId;

await sleep(1100);
const avatarJpeg = fakeAvatar("jpeg", 3000);
host2.send({ type: "profile", avatar: avatarJpeg });
await waitFor("host2 avatar echo", () => host2.avatars.some((m) => m.seatId === host2Seat && m.dataUrl === avatarJpeg), 8000);

async function joinProbe(label) {
  const probe = new Client(label);
  await probe.open();
  probe.send({ type: "join", code: code2, name: label });
  await waitFor(label + " welcome", () => probe.welcome, 8000);
  return probe;
}

const joiner = await joinProbe("新人");
assert.deepEqual(Object.keys(joiner.welcome.avatars ?? {}), [String(host2Seat)], "welcome.avatars 只含设过头像的座位");
assert.equal(joiner.welcome.avatars[String(host2Seat)], avatarJpeg, "新人 welcome 应带全量头像");
console.log("welcome.avatars ok on fresh join");

await sleep(1100);
host2.send({ type: "profile", avatar: fakeAvatar("webp", 96 * 1024 + 1) });
await waitFor("too large error", () => host2.errors.some((e) => e.reason === "avatar-too-large"), 8000);
const probeLarge = await joinProbe("超限探针");
assert.equal(probeLarge.welcome.avatars[String(host2Seat)], avatarJpeg, "超限头像不应改动座位");
console.log("avatar-too-large rejected; seat unchanged");

await sleep(1100);
host2.send({ type: "profile", avatar: "data:image/png;base64," + Buffer.alloc(64, 1).toString("base64") });
await waitFor("png rejected", () => host2.errors.filter((e) => e.reason === "avatar-invalid").length >= 1, 8000);
await sleep(50);
const badMagic = Buffer.from("RIFF" + "0000" + "JUNK" + "x".repeat(24), "latin1");
host2.send({ type: "profile", avatar: "data:image/webp;base64," + badMagic.toString("base64") });
await waitFor("bad magic rejected", () => host2.errors.filter((e) => e.reason === "avatar-invalid").length >= 2, 8000);
const probeBad = await joinProbe("非法探针");
assert.equal(probeBad.welcome.avatars[String(host2Seat)], avatarJpeg, "非法头像不应改动座位");
console.log("avatar-invalid rejected (png prefix + bad magic); seat unchanged");

await sleep(1100);
host2.send({ type: "profile", avatar: null });
await waitFor("avatar removed", () => host2.avatars.some((m) => m.seatId === host2Seat && m.dataUrl === null), 8000);
const probeRemoved = await joinProbe("移除探针");
assert.equal(
  Object.keys(probeRemoved.welcome.avatars ?? {}).includes(String(host2Seat)),
  false,
  "移除后 welcome 不再带该座位",
);
console.log("avatar removal ok");

for (const c of [...liveClients, host2, joiner, probeLarge, probeBad, probeRemoved]) c.close();
console.log("profile ok");


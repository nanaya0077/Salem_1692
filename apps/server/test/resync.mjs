import WebSocket from "ws";
import assert from "node:assert/strict";
import { passDealPhase } from "./lib/deal.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8103";
const WS = BASE.replace(/^http/, "ws") + "/ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一张能过 magic 校验的 JPEG 头像 data URL：只用到前缀 + 三字节头。 */
const AVATAR = "data:image/jpeg;base64,/9j/AA==";

class Client {
  constructor(name) {
    this.name = name;
    this.ws = new WebSocket(WS);
    this.seatId = null;
    this.code = null;
    this.room = null;
    this.projection = null;
    this.private = null;
    this.avatars = {};
    /** 每次收到的 resync 载荷（挂在 room / projection 上）。最新一条 = 客户端此刻认的座位号与头像表。 */
    this.resyncs = [];
    this.errors = [];
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "welcome") {
        this.seatId = msg.seatId;
        this.code = msg.code;
        this.avatars = msg.avatars ?? {};
      }
      // resync 不做成独立消息，挂在 room / projection 上一起发；客户端收到就整份换掉。
      // 顺带记下同一条消息里的座位表，用来证明「新座位号 + 旧座位表」那一帧不存在。
      if (msg.resync) {
        this.resyncs.push({ type: msg.type, ...msg.resync, seats: msg.room?.seats });
        this.seatId = msg.resync.seatId;
        this.avatars = msg.resync.avatars ?? {};
      }
      if (msg.type === "room") this.room = msg.room;
      if (msg.type === "projection") {
        this.projection = msg.projection;
        this.private = msg.private;
        this.room = msg.room ?? this.room;
      }
      if (msg.type === "error") this.errors.push(msg);
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
  /** 客户端认的座位号在公开投影里对上的昵称；找不到返回 MISSING。 */
  nameAtMySeat() {
    return this.projection?.seats?.find((s) => s.id === this.seatId)?.name ?? "MISSING";
  }
}

async function waitFor(label, fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error("timeout waiting for " + label);
}

const names = ["房主", "约翰", "阿比盖尔", "玛丽", "戊"];
const clients = names.map((name) => new Client(name));
await Promise.all(clients.map((c) => c.open()));
const [host, john, abigail, mary, wu] = clients;

host.send({ type: "create", name: names[0] });
await waitFor("create", () => host.code);
const code = host.code;
for (let i = 1; i < clients.length; i++) clients[i].send({ type: "join", code, name: names[i] });
await waitFor("5 seats", () => host.room?.seats?.length === 5);
console.log("lobby 5 seats", host.room.seats.map((s) => s.name + "#" + s.id).join(", "));

// 两个座位设头像：约翰（要走的那个）与阿比盖尔（要跟着重编号换号的那个）。
john.send({ type: "profile", avatar: AVATAR });
await sleep(1100); // 越过 1 秒资料硬闸
abigail.send({ type: "profile", avatar: AVATAR });
await sleep(200);
assert.deepEqual([john.errors, abigail.errors], [[], []], "头像写入被拒：" + JSON.stringify([...john.errors, ...abigail.errors]));

const johnId = john.seatId;
const abigailOldId = abigail.seatId;
assert.equal(johnId, 1, "要被踢掉的应是中间那张座位");
host.send({ type: "kick", seatId: johnId });
await waitFor("kick removes seat", () => host.room?.seats?.length === 4);
await sleep(150);

const remaining = [host, abigail, mary, wu];
assert.deepEqual(remaining.map((c) => c.seatId), [0, 2, 3, 4], "踢人只该留空号，不该重编号");

// 座位一旦消失，剩下的人必须收到新的头像表：旧号的头像不能继续挂着。
for (const c of remaining) {
  assert.ok(c.resyncs.length > 0, c.name + " 在踢人后没收到 resync");
  const kickResync = c.resyncs.at(-1);
  assert.equal(kickResync.seats?.length, 4, c.name + " 的 resync 与旧座位表一起到了，不是同一张图");
  const table = kickResync.avatars;
  assert.equal(table[String(johnId)], undefined, c.name + " 仍留着被踢者 " + johnId + " 号的头像");
  assert.equal(table[String(abigailOldId)], AVATAR, c.name + " 丢了阿比盖尔 " + abigailOldId + " 号的头像");
}
console.log("kick ok; avatar table re-keyed for", remaining.map((c) => c.name).join(", "));

for (const c of remaining) c.send({ type: "ready", ready: true });
await waitFor("startable", () => host.room?.startable, 5000);
const resyncsBefore = new Map(remaining.map((c) => [c.name, c.resyncs.length]));
host.send({ type: "start" });
for (const c of remaining) {
  await passDealPhase({ seatId: c.seatId, getProjection: () => c.projection, getPrivate: () => c.private, send: (m) => c.send(m), waitFor });
}
await waitFor("dawn", () => remaining.every((c) => c.projection?.phase === "dawn"), 8000);

for (const c of remaining) {
  assert.ok(
    c.resyncs.length > resyncsBefore.get(c.name),
    c.name + " 开局重编号后没收到 resync",
  );
  assert.equal(
    c.nameAtMySeat(),
    c.name,
    c.name + " 认的座位号 " + c.seatId + " 在投影里指向 " + c.nameAtMySeat(),
  );
  assert.equal(
    c.private?.seatId,
    c.seatId,
    c.name + " 的 resync 座位号与投影 private.seatId 不一致",
  );
  assert.deepEqual(
    c.resyncs.at(-1).seats?.map((s) => s.id),
    [0, 1, 2, 3],
    c.name + " 的 resync 与重编号后的座位表不是同一张图",
  );
}
assert.deepEqual(remaining.map((c) => c.seatId), [0, 1, 2, 3], "开局应按加入顺序重编号");
console.log("seats after renumber", remaining.map((c) => c.name + "#" + c.seatId).join(", "));

// 重编号后头像要跟着人走，而不是跟着号走。
const abigailNow = abigail.seatId;
for (const c of remaining) {
  const table = c.resyncs.at(-1).avatars;
  assert.equal(table[String(abigailNow)], AVATAR, c.name + " 没把阿比盖尔的头像挪到 " + abigailNow + " 号");
  assert.equal(table[String(abigailOldId)], undefined, c.name + " 仍挂着阿比盖尔旧号 " + abigailOldId + " 的头像");
}
console.log("avatars follow the seat, not the index");

for (const c of [...remaining, john]) c.close();
// 场景二：大厅里有人直接关掉页面（leaveRoom 路径，不是踢人），留下的人同样要换表。
const names2 = ["乙房主", "乙甲", "乙乙", "乙丙"];
const room2 = names2.map((name) => new Client(name));
await Promise.all(room2.map((c) => c.open()));
const [h2, a2, b2, c2] = room2;
h2.send({ type: "create", name: names2[0] });
await waitFor("room2 created", () => h2.code);
for (let i = 1; i < room2.length; i++) room2[i].send({ type: "join", code: h2.code, name: names2[i] });
await waitFor("room2 4 seats", () => h2.room?.seats?.length === 4);
b2.send({ type: "profile", avatar: AVATAR });
await sleep(200);
const b2Id = b2.seatId;
b2.close();
await waitFor("room2 3 seats", () => h2.room?.seats?.length === 3);
await sleep(150);
for (const c of [h2, a2, c2]) {
  const table = c.resyncs.at(-1)?.avatars;
  assert.ok(table, c.name + " 在有人掉线后没收到 resync");
  assert.equal(table[String(b2Id)], undefined, c.name + " 仍留着已离开的 " + b2Id + " 号头像");
}
console.log("leave ok; avatar table re-keyed for", [h2, a2, c2].map((c) => c.name).join(", "));

// 座位号取最小空位：新来的人会继承离开者的号。号可以复用，脸不行——
// 上一段已经看到离开时的 resync 把整张表换掉了，这里验到底：新玩家拿到的号上没有旧脸。
const d2 = new Client("乙丁");
await d2.open();
d2.send({ type: "join", code: h2.code, name: "乙丁" });
await waitFor("room2 back to 4 seats", () => h2.room?.seats?.length === 4);
await sleep(200);
assert.equal(d2.seatId, b2Id, "新座位应复用最小空位 " + b2Id);
for (const c of [h2, a2, c2, d2]) {
  assert.equal(c.avatars[String(b2Id)], undefined, c.name + " 把 " + b2Id + " 号上一任的头像留给了新玩家");
}
console.log("seat id reused, stale avatar cleared");

for (const c of [...room2, d2]) c.ws.close();
console.log("resync ok: kick / leave / renumber re-issue identity + avatar table, reused seat id drops old face");

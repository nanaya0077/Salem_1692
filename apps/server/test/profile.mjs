// 座位级个人资料（昵称与头像）的协议层验收。
// 默认自带服务器：随机端口起 src/server.mjs，跑完就 kill；设了 BASE 就直接连现成的服务器。
import WebSocket from "ws";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, "../src/server.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 服务端只校验 data URL 前缀、magic bytes 与解码后体积，不真的解码图像，
// 所以测试里内联拼最小的合法字节就够。
function webpDataUrl(payload = Buffer.alloc(8)) {
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + payload.length, 4);
  head.write("WEBP", 8, "latin1");
  return "data:image/webp;base64," + Buffer.concat([head, payload]).toString("base64");
}

function jpegDataUrl(payload = Buffer.alloc(8)) {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const tail = Buffer.from([0xff, 0xd9]);
  return "data:image/jpeg;base64," + Buffer.concat([head, payload, tail]).toString("base64");
}

const AVATAR_WEBP = webpDataUrl();
const AVATAR_JPEG = jpegDataUrl();
const AVATAR_WEBP_2 = webpDataUrl(Buffer.from("另一张头像的载荷"));
const AVATAR_TOO_LARGE = webpDataUrl(Buffer.alloc(110 * 1024)); // 解码后 112652 字节 > 96KB
const AVATAR_PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
const AVATAR_BAD_MAGIC = "data:image/webp;base64," + Buffer.from("XXXX-不是-webp").toString("base64");

async function freePort() {
  return await new Promise((ok, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => ok(port));
    });
  });
}

async function waitHealth(base, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(base + "/health");
      if (res.ok) return;
    } catch {}
    await sleep(120);
  }
  throw new Error("服务器没有就绪：" + base + "/health");
}

async function waitFor(label, fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error("等待超时：" + label);
}

const serverLog = [];
let child = null;
let BASE = process.env.BASE || "";
const results = [];

async function main() {
  if (!BASE) {
    const port = await freePort();
    BASE = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        NIGHT_MS: "60000",
        DAWN_MS: "60000",
        TURN_MS: "120000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => serverLog.push(chunk.toString()));
    child.stderr.on("data", (chunk) => serverLog.push(chunk.toString()));
    await waitHealth(BASE);
  }
  const WS = BASE.replace(/^http/, "ws") + "/ws";

  class Client {
    constructor(tag) {
      this.tag = tag;
      this.ws = new WebSocket(WS);
      this.seatId = null;
      this.code = null;
      this.token = null;
      this.welcome = null;
      this.room = null;
      this.projection = null;
      this.private = null;
      this.avatars = [];
      this.notices = [];
      this.errors = [];
      this.visible = []; // room / projection 的序列化串，用来做「投影零泄漏」硬断言
      this.ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "welcome") {
          this.welcome = msg;
          this.seatId = msg.seatId;
          this.code = msg.code;
          this.token = msg.token;
        }
        if (msg.type === "room") {
          this.room = msg.room;
          this.visible.push(JSON.stringify(msg));
        }
        if (msg.type === "projection") {
          this.projection = msg.projection;
          this.private = msg.private;
          this.room = msg.room ?? this.room;
          this.visible.push(JSON.stringify(msg));
        }
        if (msg.type === "avatar") this.avatars.push(msg);
        if (msg.type === "notice") this.notices.push(msg.message);
        if (msg.type === "error") this.errors.push(msg);
      });
    }
    open() {
      return new Promise((ok, fail) => {
        this.ws.once("open", ok);
        this.ws.once("error", fail);
      });
    }
    send(msg) { this.ws.send(JSON.stringify(msg)); }
    close() { this.ws.close(); }
    nameOf(seatId, source = this.room) {
      return source?.seats?.find((s) => s.id === seatId)?.name;
    }
    projectionNameOf(seatId) {
      return this.projection?.seats?.find((s) => s.id === seatId)?.name;
    }
  }

  const host = new Client("房主");
  const john = new Client("约翰");
  const mary = new Client("玛丽");
  let george = null;
  let host2 = null;
  let john2 = null;

  // ——— 建房间：三个人进大厅 ———
  await step("大厅：三个人进房间", async () => {
    await Promise.all([host, john, mary].map((c) => c.open()));
    host.send({ type: "create", name: "旧名别名" });
    await waitFor("create", () => host.code);
    john.send({ type: "join", code: host.code, name: "约翰" });
    mary.send({ type: "join", code: host.code, name: "玛丽" });
    await waitFor("3 seats", () => host.room?.seats?.length === 3);
    assert.equal(host.room.seats.find((s) => s.id === host.seatId)?.name, "旧名别名");
  });

  const code = host.code;
  const hostId = host.seatId;

  // ——— 验收 3：大厅里改头像，其他座位收到单独一条 avatar ———
  await step("头像：其他人收到 {type:avatar, seatId, dataUrl}", async () => {
    host.send({ type: "profile", avatar: AVATAR_WEBP });
    await waitFor("avatar 广播", () => john.avatars.length >= 1 && mary.avatars.length >= 1);
    assert.equal(john.avatars[0].type, "avatar");
    assert.equal(john.avatars[0].seatId, hostId);
    assert.equal(john.avatars[0].dataUrl, AVATAR_WEBP);
    assert.equal(mary.avatars[0].dataUrl, AVATAR_WEBP);
  });

  // ——— 验收 4（前半）：新加入的 welcome 带全量 avatars ———
  await step("welcome：新加入的 welcome.avatars 带全量头像", async () => {
    george = new Client("乔治");
    await george.open();
    george.send({ type: "join", code, name: "乔治" });
    await waitFor("新加入 welcome", () => george.welcome);
    assert.deepEqual(george.welcome.avatars, { [hostId]: AVATAR_WEBP });
    await waitFor("4 seats", () => host.room?.seats?.length === 4);
  });

  // ——— 开局（改名要看 projection，必须先有对局） ———
  await step("开局：四人 ready 后进到行动阶段", async () => {
    const all = [host, john, mary, george];
    for (const c of all) c.send({ type: "ready", ready: true });
    await waitFor("startable", () => host.room?.startable);
    host.send({ type: "start" });
    await waitFor("dawn", () => all.every((c) => c.projection?.phase === "dawn"));
    for (const c of all) {
      if (c.private?.dawn?.isWitch && !c.private.dawn.submitted) {
        c.send({ type: "action", commandId: "dawn-" + c.seatId, action: { kind: "dawn", targetId: 0 } });
      }
    }
    await waitFor("action", () => all.every((c) => c.projection?.phase === "action"));
  });

  // ——— 验收 1 + 2：改名同时写 room 与 projection，一条提示，日志不动 ———
  await step("改名：room 与 projection 同时是新名字，旧名字不残留", async () => {
    const others = [john, mary, george];
    const beforeLog = john.projection.log.length;
    const beforeVersion = john.projection.version;
    await sleep(1100); // 与上一条写入隔开 1 秒硬闸
    host.send({ type: "profile", name: "新名别名" });
    await waitFor("room 里新名字", () => others.every((c) => c.nameOf(hostId) === "新名别名"));
    await waitFor("projection 里新名字", () => others.every((c) => c.projectionNameOf(hostId) === "新名别名"));
    for (const c of others) {
      const wire = JSON.stringify({ room: c.room, projection: c.projection });
      assert.equal(wire.includes("旧名别名"), false, "room/projection 里还残留旧名字：" + c.tag);
    }
    assert.equal(john.projection.log.length, beforeLog, "改名不该写对局日志");
    assert.equal(john.projection.version, beforeVersion, "改名不该动投影版本号");
  });

  await step("改名：其他人收到一条「旧名改名为新名」提示，且只有一条", async () => {
    const others = [john, mary, george];
    for (const c of others) {
      const rename = c.notices.filter((m) => m.includes("改名"));
      assert.equal(rename.length, 1, c.tag + " 收到的改名提示数量不对");
      assert.equal(rename[0].includes("旧名别名") && rename[0].includes("新名别名"), true, "提示文案缺旧名或新名：" + rename[0]);
    }
  });

  // ——— 验收 5（前半）：超过 96KB 的头像被拒 ———
  await step("超限：>96KB 头像被拒，reason=avatar-too-large", async () => {
    await sleep(1100);
    const before = mary.avatars.length;
    host.errors.length = 0;
    host.send({ type: "profile", avatar: AVATAR_TOO_LARGE });
    await waitFor("avatar-too-large", () => host.errors.some((e) => e.reason === "avatar-too-large"));
    const err = host.errors.find((e) => e.reason === "avatar-too-large");
    assert.equal(typeof err.message, "string");
    assert.equal(err.message.length > 0, true);
    await sleep(200);
    assert.equal(mary.avatars.length, before, "被拒的头像不该广播");
  });

  // ——— 验收 5（后半）+ 4（后半）：重连 welcome 里头像未变、原头像仍在 ———
  await step("重连：welcome 带全量 avatars，原头像仍在", async () => {
    const token = host.token;
    host.close();
    await sleep(150);
    host2 = new Client("房主重连");
    await host2.open();
    host2.send({ type: "join", code, name: "新名别名", token });
    await waitFor("重连 welcome", () => host2.welcome?.reconnected);
    assert.equal(host2.seatId, hostId);
    assert.deepEqual(host2.welcome.avatars, { [hostId]: AVATAR_WEBP });
    await waitFor("重连后 projection", () => host2.projection);
  });

  // ——— 验收 6：非法前缀 / magic 不符 ———
  await step("非法：PNG 前缀与坏 magic 都被拒，reason=avatar-invalid", async () => {
    const before = john.avatars.length;
    mary.errors.length = 0;
    mary.send({ type: "profile", avatar: AVATAR_PNG });
    await waitFor("avatar-invalid（前缀）", () => mary.errors.some((e) => e.reason === "avatar-invalid"));
    mary.send({ type: "profile", avatar: AVATAR_BAD_MAGIC });
    await waitFor("avatar-invalid（magic）", () => mary.errors.filter((e) => e.reason === "avatar-invalid").length === 2);
    await sleep(200);
    assert.equal(john.avatars.length, before, "非法头像不该广播");
    await waitFor("玛丽仍在座位上的原名字", () => john.nameOf(mary.seatId) === "玛丽");
  });

  // ——— 验收 8：1 秒硬闸，第二次静默丢弃 ———
  await step("硬闸：1 秒内第二次写入被静默丢弃，且不报错", async () => {
    const beforeAvatars = john.avatars.length;
    john.errors.length = 0;
    await sleep(1100);
    john.send({ type: "profile", name: "约翰第一次", avatar: AVATAR_JPEG });
    john.send({ type: "profile", name: "约翰第二次", avatar: AVATAR_WEBP_2 });
    await waitFor("第一次生效", () => mary.nameOf(john.seatId) === "约翰第一次");
    await sleep(400);
    assert.equal(mary.nameOf(john.seatId), "约翰第一次", "第二次写入没被丢弃");
    const got = john.avatars.slice(beforeAvatars).filter((m) => m.seatId === john.seatId);
    assert.equal(got.length, 1, "第二次写入不该广播头像");
    assert.equal(got[0].dataUrl, AVATAR_JPEG);
    assert.equal(john.errors.length, 0, "静默丢弃不该回 error：" + JSON.stringify(john.errors));
  });

  // ——— 验收 9：消息里塞别人的 seatId 改不到别人 ———
  await step("越权：塞别人的 seatId 只改到自己", async () => {
    await sleep(1100);
    john.send({ type: "profile", seatId: hostId, name: "冒名" });
    await waitFor("自己改名", () => mary.nameOf(john.seatId) === "冒名");
    assert.equal(mary.nameOf(hostId), "新名别名", "别人座位被改名了");
    assert.equal(mary.projectionNameOf(hostId), "新名别名", "投影里别人座位被改名了");
  });

  // ——— 移除头像：dataUrl 为 null，welcome.avatars 里不再有该座位 ———
  await step("移除：avatar 广播 dataUrl=null，重连 welcome 里该座位消失", async () => {
    const johnId = john.seatId;
    const token = john.token;
    await sleep(1100);
    const before = mary.avatars.length;
    john.send({ type: "profile", avatar: null });
    await waitFor("移除广播", () => mary.avatars.length > before);
    const removed = mary.avatars[mary.avatars.length - 1];
    assert.equal(removed.type, "avatar");
    assert.equal(removed.seatId, johnId);
    assert.equal(removed.dataUrl, null);
    john.close();
    await sleep(150);
    john2 = new Client("约翰重连");
    await john2.open();
    john2.send({ type: "join", code, token });
    await waitFor("重连 welcome", () => john2.welcome?.reconnected);
    assert.equal(john2.welcome.avatars?.[johnId], undefined, "移除后的头像不该出现在 welcome.avatars");
    assert.equal(john2.welcome.avatars?.[hostId], AVATAR_WEBP, "别的座位的头像不该丢");
  });

  // ——— 验收 7：硬断言，room / projection 全程不含 data:image ———
  await step("零泄漏：任何 room / projection 序列化后都不含 data:image", async () => {
    const all = [host, john, mary, george, host2, john2].filter(Boolean);
    for (const c of all) {
      for (const wire of c.visible) {
        assert.equal(wire.includes("data:image"), false, c.tag + " 的 room/projection 泄漏了头像：" + wire.slice(0, 200));
      }
    }
    assert.equal(all.reduce((n, c) => n + c.visible.length, 0) > 0, true, "没有收集到 room/projection 消息");
  });

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error("\n失败 " + failed.length + " 项：");
    for (const f of failed) console.error(" - " + f.name + "：" + f.message);
    if (serverLog.length) console.error("\n服务器输出（尾部）：\n" + serverLog.join("").slice(-4000));
    process.exitCode = 1;
  } else {
    console.log("\nprofile 全部通过（" + results.length + " 项）");
  }

  for (const c of [host, john, mary, george, host2, john2]) {
    if (!c) continue;
    try { c.close(); } catch {}
  }
}

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("✓ " + name);
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
    console.error("✗ " + name + "\n    " + error.message);
  }
}

try {
  await main();
} catch (error) {
  console.error("测试中止：" + (error?.stack || error));
  if (serverLog.length) console.error("\n服务器输出（尾部）：\n" + serverLog.join("").slice(-4000));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((ok) => {
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} ok(); }, 3000);
      child.once("exit", () => { clearTimeout(timer); ok(); });
    });
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
}

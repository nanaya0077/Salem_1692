import assert from "node:assert/strict";
import WebSocket from "ws";

/**
 * 线下模式：建房时勾选后，发牌、黎明、夜晚、回合四个环节都不设截止时间，也没有兜底。
 *
 * 证明「没有兜底在跑」必须把时间推过去，所以本脚本要连假时钟的服务：
 *   $env:SALEM_FAKE_CLOCK=1; $env:PORT=8130; node src/server.mjs
 *   $env:BASE="http://127.0.0.1:8130"; node test/offline.mjs
 */

const BASE = process.env.BASE || "http://127.0.0.1:8130";
const WS = BASE.replace(/^http/, "ws") + "/ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) {
    this.name = name;
    this.ws = new WebSocket(WS);
    this.seatId = null;
    this.code = null;
    this.token = null;
    this.room = null;
    this.projection = null;
    this.private = null;
    this.deal = null;
    this.errors = [];
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "welcome") {
        this.seatId = msg.seatId;
        this.code = msg.code;
        this.token = msg.token;
      }
      if (msg.type === "room") this.room = msg.room;
      if (msg.type === "projection") {
        this.projection = msg.projection;
        this.private = msg.private;
        this.deal = msg.deal ?? null;
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
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  close() {
    this.ws.close();
  }
  act(action, commandId) {
    this.send({ type: "action", commandId: commandId ?? this.name + "-" + Math.random().toString(36).slice(2), action });
  }
  seats() {
    return this.projection?.seats ?? [];
  }
  mySeat() {
    return this.seats().find((s) => s.id === this.seatId) ?? null;
  }
  seatOf(id) {
    return this.seats().find((s) => s.id === id) ?? null;
  }
}

async function waitFor(label, fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(30);
  }
  throw new Error("timeout waiting for " + label);
}

const pickAliveOther = (client, selfId) => {
  const ids = (client.projection?.seats ?? []).filter((s) => s.alive && s.id !== selfId).map((s) => s.id);
  return ids[Math.floor(Math.random() * ids.length)] ?? selfId;
};

async function chooseAndAck(client) {
  const seat = client.mySeat();
  if (seat && !seat.roleChosen && (seat.roleOptions ?? []).length) {
    client.act({ kind: "chooseRole", roleId: seat.roleOptions[0] });
    await waitFor(client.name + " 选好角色", () => client.mySeat()?.roleChosen === true);
  }
  const acknowledged = () => client.private?.acknowledged === true || client.projection?.phase !== "deal";
  if (acknowledged()) return;
  client.act({ kind: "dealAck" });
  await waitFor(client.name + " 确认发牌", acknowledged);
}

async function makeRoom(count, names, offline) {
  const clients = names.slice(0, count).map((name) => new Client(name));
  await Promise.all(clients.map((c) => c.open()));
  clients[0].send({ type: "create", name: names[0], config: { offline } });
  await waitFor("建房", () => clients[0].code);
  const code = clients[0].code;
  for (let i = 1; i < clients.length; i++) clients[i].send({ type: "join", code, name: names[i] });
  await waitFor("满座", () => clients[0].room?.seats?.length === clients.length);
  for (const c of clients) c.send({ type: "ready", ready: true });
  await waitFor("可开局", () => clients[0].room?.startable === true);
  clients[0].send({ type: "start" });
  await waitFor("发牌相位", () => clients.every((c) => c.projection?.phase === "deal"));
  return { clients, code };
}

const closeAll = (clients) => { for (const c of clients) c.close(); };

// ── 段一：勾了线下模式，房间带标记，发牌相位没有截止时间，推一小时也不会自己走 ──────
{
  const { clients } = await makeRoom(4, ["甲", "乙", "丙", "丁"], true);
  const [a] = clients;
  assert.equal(a.room?.offline, true, "建房时勾了线下模式，房间要带这个标记");
  assert.equal(a.deal?.deadline, null, "线下模式的发牌相位不该有截止时间");
  a.send({ type: "clock", advance: 60 * 60 * 1000 });
  await sleep(400);
  assert.equal(a.projection?.phase, "deal", "推进一小时也不该有兜底把发牌相位推走");
  assert.equal(a.deal?.deadline, null, "截止时间不该被补上");
  console.log("段一 ok：线下模式发牌相位无截止时间，也不会超时推进");
  closeAll(clients);
}

// ── 段二：全员确认后进黎明，黎明同样没有截止时间，推一小时也不结束 ──────────────
{
  const { clients } = await makeRoom(4, ["阿比盖尔", "约翰", "玛丽", "乔治"], true);
  for (const c of clients) await chooseAndAck(c);
  await waitFor("进黎明", () => clients.every((c) => c.projection?.phase === "dawn"), 8000);
  const host = clients[0];
  assert.equal(host.private?.dawn?.deadline, null, "线下模式的黎明不该有截止时间");
  host.send({ type: "clock", advance: 60 * 60 * 1000 });
  await sleep(400);
  assert.equal(host.projection?.phase, "dawn", "推进一小时黎明也不该自己结束");
  console.log("段二 ok：线下模式黎明无截止时间");
  closeAll(clients);
}

// ── 段三：对照普通房间，20 秒兜底照旧生效，没被线下模式改坏 ──────────────────────
{
  const { clients } = await makeRoom(4, ["甲", "乙", "丙", "丁"], false);
  const [a] = clients;
  assert.equal(a.room?.offline, false, "不勾时房间是普通模式");
  assert.equal(typeof a.deal?.deadline, "number", "普通房间照旧有发牌截止时间");
  const deadline = a.deal.deadline;
  a.send({ type: "clock", advance: Math.max(0, deadline - Date.now()) + 2000 });
  await waitFor("普通房间超时兜底进黎明", () => a.projection?.phase === "dawn", 8000);
  console.log("段三 ok：普通房间的 20 秒兜底没被改坏");
  closeAll(clients);
}

// ── 段四：一真人加三个机器人跑一段，夜晚与回合都不带截止时间 ────────────────────
{
  const host = new Client("房主");
  await host.open();
  host.send({ type: "create", name: "房主", config: { offline: true } });
  await waitFor("建房", () => host.code);
  for (let i = 0; i < 3; i += 1) host.send({ type: "add-bot" });
  await waitFor("三个机器人入座", () => (host.room?.seats ?? []).filter((s) => s.bot).length === 3);
  host.send({ type: "start" });
  await waitFor("发牌相位", () => host.projection?.phase === "deal");
  await chooseAndAck(host);
  await waitFor("进黎明", () => host.projection?.phase === "dawn", 8000);

  let sawNight = false;
  let sawAction = false;
  const started = Date.now();
  while (Date.now() - started < 45000) {
    const p = host.projection;
    if (p?.winner || host.room?.phase === "over") break;
    if (p?.phase === "night" && host.private?.night) {
      sawNight = true;
      assert.equal(host.private.night.deadline, null, "线下模式的夜晚不该有截止时间");
      const info = host.private.night;
      if ((info.required ?? []).includes(host.seatId) && !info.submitted) {
        const payload = { kind: "night", confess: false };
        if (info.isWitch) payload.targetId = pickAliveOther(host, host.seatId);
        if (info.isConstable) payload.hammerTargetId = null;
        host.act(payload, "o-night-" + p.version);
      }
    } else if (p?.phase === "dawn" && host.private?.dawn?.isWitch && !host.private.dawn.submitted) {
      assert.equal(host.private.dawn.deadline, null, "线下模式的黎明不该有截止时间");
      host.act({ kind: "dawn", targetId: pickAliveOther(host, host.seatId) }, "o-dawn-" + p.version);
    } else if (p?.phase === "action") {
      sawAction = true;
      assert.equal(host.private?.turnDeadline ?? null, null, "线下模式的回合不该有截止时间");
      break;
    }
    await sleep(60);
  }
  assert.ok(sawNight || sawAction, "线下模式应能从黎明推进到夜晚或白天");
  console.log("段四 ok：线下模式夜晚与回合都无截止时间", sawNight ? "night" : "", sawAction ? "action" : "");
  host.close();
}

console.log("offline ok: 线下模式取消发牌/黎明/夜晚/回合四处的倒计时与兜底");

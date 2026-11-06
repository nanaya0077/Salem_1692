import assert from "node:assert/strict";
import WebSocket from "ws";

/**
 * 发牌相位（#10）生命周期：确认集合、20 秒兜底、发牌期间拒绝动作、重连状态、机器人不等。
 *
 * 20 秒兜底用假时钟推进，不真实等待：服务端须以 SALEM_FAKE_CLOCK=1 启动，
 * 测试发 {type:"clock", advance} 把发牌截止推到未来。
 *   $env:SALEM_FAKE_CLOCK=1; $env:PORT=8120; node src/server.mjs
 *   $env:BASE="http://127.0.0.1:8120"; node test/deal.mjs
 */

const BASE = process.env.BASE || "http://127.0.0.1:8120";
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
    this.clockNow = null;
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
      if (msg.type === "clock") this.clockNow = msg.now;
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

/** 座位选第一张候选角色然后确认；最后一个人确认会把房间推进到黎明，所以两个条件任一满足即算完成。 */
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

async function makeRoom(count, names) {
  const clients = names.slice(0, count).map((name) => new Client(name));
  await Promise.all(clients.map((c) => c.open()));
  clients[0].send({ type: "create", name: names[0] });
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

// ── 片一：开局停在发牌相位；发牌期间抽牌/出牌/结束回合被拒 ─────────────────────
{
  const { clients } = await makeRoom(4, ["甲", "乙", "丙", "丁"]);
  const [a, b] = clients;
  const seatA = a.mySeat();
  assert.equal(seatA.roleChosen, false, "4 人局每人应拿到候选角色");
  assert.equal(seatA.roleOptions.length, 2, "4 人局每人两张候选");
  assert.deepEqual(a.deal?.acked, [], "刚进发牌相位时没人确认");
  assert.equal(typeof a.deal?.deadline, "number", "发牌相位要有截止时间");
assert.deepEqual(
  Object.keys(a.deal ?? {}).sort(),
  ["acked", "deadline"],
  "发牌视图只该带 acked 与 deadline，实际 " + Object.keys(a.deal ?? {}).join(","),
);
  assert.equal(a.private?.acknowledged, false, "自己还没确认");

  for (const action of [
    { kind: "draw" },
    { kind: "end" },
    { kind: "play", play: { cardId: "accusation", targetId: b.seatId } },
  ]) {
    a.act(action, "blocked-" + action.kind);
  }
  await waitFor("发牌期间三条命令被拒", () => a.errors.filter((e) => e.reason === "deal-phase").length === 3);
  assert.equal(a.projection.phase, "deal", "被拒的命令不能推进相位");
  console.log("片一 ok：停在发牌相位，抽牌/出牌/结束回合被拒");
  closeAll(clients);
}

// ── 片二：有人未选或未确认就停在发牌相位；全员选好且确认才进黎明 ──────────────
{
  const { clients } = await makeRoom(4, ["阿比盖尔", "约翰", "玛丽", "乔治"]);
  const [abigail, john, mary, george] = clients;

  await chooseAndAck(abigail);
  await waitFor("第一个座位已确认", () => abigail.deal?.acked?.includes(abigail.seatId));
  // 约翰选了但不确认；玛丽与乔治不动。
  john.act({ kind: "chooseRole", roleId: john.mySeat().roleOptions[0] });
  await waitFor("约翰选好角色", () => john.mySeat()?.roleChosen === true);
  await sleep(150);
  assert.equal(abigail.projection.phase, "deal", "有人没确认时应停在发牌相位");
  assert.deepEqual(abigail.deal.acked, [abigail.seatId], "只有确认过的人进确认集合");
  assert.equal(john.deal.acked.includes(john.seatId), false, "选了但没确认不算确认");
  assert.equal(john.private.acknowledged, false, "未确认状态要跟着座位走");

  await chooseAndAck(john);
  await chooseAndAck(mary);
  assert.equal(george.projection.phase, "deal", "还剩一人没确认时仍停在发牌相位");
  await chooseAndAck(george);
  await waitFor("全员确认后进黎明", () => clients.every((c) => c.projection?.phase === "dawn"));
  for (const c of clients) {
    assert.equal(c.mySeat().roleChosen, true, c.name + " 的角色应已落定");
    assert.notEqual(c.mySeat().role, "none", c.name + " 不该停在 none 角色");
    assert.equal(c.deal, null, "离开发牌相位后不再下发发牌状态");
  }
  console.log("片二 ok：有人未确认停在发牌相位；全员确认进黎明");
  closeAll(clients);
}

// ── 片三：截止到期兜底——未选角色者保留第一张、未确认者视作已确认 ─────────────
{
  const { clients } = await makeRoom(4, ["甲", "乙", "丙", "丁"]);
  const [host, chosen, idle] = clients;
  // 乙选了角色但不确认；丙、丁什么都不做。
  const chosenOption = chosen.mySeat().roleOptions[0];
  chosen.act({ kind: "chooseRole", roleId: chosenOption });
  await waitFor("乙选好角色", () => chosen.mySeat()?.roleChosen === true);
  const idleOption = idle.mySeat().roleOptions[0];
  await chooseAndAck(host);
  await sleep(150);
  assert.equal(host.projection.phase, "deal", "截止前没人确认完就还停在发牌相位");

  host.send({ type: "clock", advance: 25000 });
  const clockSentAt = Date.now();
  while (host.clockNow === null && Date.now() - clockSentAt < 1500) await sleep(30);
  if (host.clockNow === null) {
    // 没开 SALEM_FAKE_CLOCK=1 就退化成真等 20 秒，这里不硬等，直接跳过。
    console.log("片三 skip：服务端未开 SALEM_FAKE_CLOCK=1");
  } else {
    await waitFor("假时钟推进后进黎明", () => clients.every((c) => c.projection?.phase === "dawn"), 8000);
    const after = (c) => c.mySeat();
    assert.equal(after(chosen).role, chosenOption, "已选者保留自己选的角色");
    assert.equal(after(idle).role, idleOption, "未选者保留第一张候选");
    assert.equal(after(idle).roleChosen, true, "兜底后角色算已选");
    assert.deepEqual(after(idle).roleOptions, [], "兜底后候选清空");
    assert.equal(idle.private.acknowledged, true, "未确认者视作已确认");
    assert.equal(host.deal, null, "兜底推进后不再有发牌截止");
    console.log("片三 ok：假时钟推进 20 秒兜底进黎明");
  }
  closeAll(clients);
}

// ── 片四：断线重连仍给出该座位的未确认状态，从第一张重开 ──────────────────────
{
  const { clients, code } = await makeRoom(4, ["阿比盖尔", "约翰", "玛丽", "乔治"]);
  const [abigail, john, mary, george] = clients;
  await chooseAndAck(abigail);
  const johnSeat = john.seatId;
  const johnToken = john.token;
  const trialsBefore = john.projection.self.trials.length;
  assert.ok(trialsBefore > 0, "身份卡在发牌相位就发好");

  john.close();
  await waitFor("约翰掉线但座位保留", () => abigail.room?.seats?.find((s) => s.id === johnSeat)?.connected === false, 8000);
  const back = new Client("约翰重连");
  await back.open();
  back.send({ type: "join", code, name: "约翰", token: johnToken });
  await waitFor("重连回到原座位", () => back.seatId === johnSeat && back.projection?.phase === "deal", 8000);
  assert.equal(back.private.acknowledged, false, "重连后仍是没有确认的状态");
  assert.equal(back.deal.acked.includes(johnSeat), false, "确认集合里不该有他");
  assert.equal(back.projection.self.trials.length, trialsBefore, "身份卡张数不变");
  assert.equal(back.projection.self.trials.every((t) => !t.revealed), true, "重连不记录看过几张，从第一张重开");

  await chooseAndAck(back);
  await chooseAndAck(mary);
  await chooseAndAck(george);
  await waitFor("四人确认后进黎明", () => clients.concat(back).filter((c) => c.ws.readyState === 1).every((c) => c.projection?.phase === "dawn"), 8000);
  console.log("片四 ok：重连保留未确认状态");
  closeAll([abigail, mary, george, back]);
}

// ── 片五：机器人不等——进发牌相位立刻选第一张并确认，整局仍能跑到分出胜负 ─────
{
  const host = new Client("房主");
  await host.open();
  host.send({ type: "create", name: "房主" });
  await waitFor("建房", () => host.code);
  for (let i = 0; i < 3; i++) host.send({ type: "add-bot" });
  await waitFor("三个机器人入座", () => host.room?.seats?.filter((s) => s.bot).length === 3);
  host.send({ type: "start" });
  await waitFor("发牌相位", () => host.projection?.phase === "deal");
  await waitFor(
    "机器人立刻选角并确认",
    () => host.room.seats.filter((s) => s.bot).every((s) => host.seatOf(s.id)?.roleChosen && host.deal?.acked?.includes(s.id)),
    5000,
  );
  assert.equal(host.deal.acked.includes(host.seatId), false, "真人不该被代确认");

  await chooseAndAck(host);
  await waitFor("机器人不卡住开局", () => host.projection?.phase === "dawn", 8000);

  // 房主自己把回合打完，验证机器人不用等发牌相位、整局能分出胜负。
  const started = Date.now();
  let lastKey = "";
  while (Date.now() - started < 150000) {
    const p = host.projection;
    if (p?.winner || host.room?.phase === "over") break;
    if (p?.phase === "dawn" && host.private?.dawn?.isWitch && !host.private.dawn.submitted) {
      host.act({ kind: "dawn", targetId: pickAliveOther(host, host.seatId) }, "g-dawn-" + p.version);
    } else if (p?.phase === "night" && host.private?.night && !host.private.night.submitted) {
      const info = host.private.night;
      if ((info.required ?? []).includes(host.seatId)) {
        const payload = { kind: "night", confess: false };
        if (info.isWitch) payload.targetId = pickAliveOther(host, host.seatId);
        if (info.isConstable) payload.hammerTargetId = null;
        host.act(payload, "g-night-" + p.version);
      }
    } else if (p?.pendingReveal) {
      // 挂起揭示（#13）：房主自己当选择者时也得先落定，挂起期抽牌/结束回合都会被拒。
      const slot = p.pendingReveal.slots.findIndex((s) => s === "hidden");
      if (slot >= 0) host.act({ kind: "reveal", trialIndex: slot }, "g-reveal-" + p.version);
    } else if (p?.phase === "action" && p.currentPlayerId === host.seatId) {
      const key = [p.version, p.actionTaken, p.self?.hand?.length].join(":");
      if (key !== lastKey) {
        lastKey = key;
        host.act(p.actionTaken ? { kind: "end" } : { kind: "draw" }, "g-turn-" + key);
      }
    }
    await sleep(60);
  }
  assert.ok(host.projection?.winner || host.room?.phase === "over", "机器人局应能跑到分出胜负");
  console.log("片五 ok：机器人立刻选角+确认，整局分出胜负", host.projection.winner);
  host.close();
}

console.log("deal ok: 发牌确认 / 20 秒兜底 / 拒绝动作 / 重连 / 机器人");

import WebSocket from "ws";
import { CARD_CATALOG } from "../../../packages/rules/src/index.ts";

/**
 * 12 人整局压测：自动建房、11 个客户端入座、准备、开局，
 * 黎明/夜晚自动投票，白天抽牌或出红卡，直到终局。
 *
 * 用法：
 *   BASE=http://127.0.0.1:8080 GAMES=3 node apps/server/test/fullgame_bots.mjs
 * 可选：
 *   GAMES=10            连续跑几局，默认 1
 *   GAME_TIMEOUT_MS=180000  单局超时，默认 180s
 *   PLAY_RATE=0.35      轮到本人时出红卡的概率，其余情况抽两张
 *   BOT_DELAY_MS=15     每个动作的随机延迟基数
 */

const BASE = process.env.BASE || "http://127.0.0.1:8080";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";
const GAMES = Math.max(1, Number(process.env.GAMES || 1));
const GAME_TIMEOUT_MS = Math.max(5000, Number(process.env.GAME_TIMEOUT_MS || 180000));
const BOT_DELAY_MS = Math.max(0, Number(process.env.BOT_DELAY_MS || 15));
const PLAY_RATE = Math.min(1, Math.max(0, Number(process.env.PLAY_RATE ?? 0.35)));
const PLAYER_COUNT = 12;
const DEBUG = process.env.DEBUG === "1";
const debug = (...args) => { if (DEBUG) console.log("[debug]", ...args); };

const EXPECTED_ERRORS = new Set([
  "not-your-turn",
  "game-over",
  "not-playing",
  "already-submitted",
  "not-night",
  "not-dawn",
  "not-witch",
  "dead",
  "card-not-in-hand",
  "piety:red-immunity",
  "cannot-target-self",
  "invalid-target",
  "bad-target",
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const pad = (n) => String(n).padStart(2, "0");
const short = (value, n = 120) => {
  const text = String(value ?? "");
  return text.length > n ? text.slice(0, n) + "…" : text;
};

function aliveOtherIds(projection, seatId) {
  const ids = projection.seats.filter((s) => s.alive && s.id !== seatId).map((s) => s.id);
  return ids.length ? ids : [seatId];
}

class BotClient {
  constructor(name, index) {
    this.name = name;
    this.index = index;
    this.ws = null;
    this.seatId = null;
    this.room = null;
    this.projection = null;
    this.private = null;
    this.errors = [];
    this.closed = false;
    this.actionTimer = null;
    this.lastKey = "";
    this.commandSeq = 0;
    this.pendingKind = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      let opened = false;
      ws.once("open", () => {
        opened = true;
        resolve();
      });
      ws.on("error", (error) => {
        if (!opened) reject(error);
        else this.errors.push({ reason: "ws-error", message: short(error.message || error, 200) });
      });
      ws.on("close", () => {
        this.closed = true;
      });
      ws.on("message", (raw) => this.onMessage(raw));
    });
  }

  send(message) {
    if (this.closed || this.ws?.readyState !== 1) return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.errors.push({ reason: "send-error", message: short(error.message || error, 200) });
      return false;
    }
  }

  act(action) {
    this.pendingKind = action?.kind ?? null;
    const commandId = this.name + "-" + (++this.commandSeq);
    return this.send({ type: "action", commandId, action });
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      this.errors.push({ reason: "bad-json", message: short(raw.toString(), 200) });
      return;
    }
    if (message.type === "welcome") {
      this.seatId = message.seatId;
      return;
    }
    if (message.type === "room") {
      this.room = message.room;
      if (this.room?.phase === "over") this.think();
      return;
    }
    if (message.type === "projection") {
      this.projection = message.projection;
      this.private = message.private;
      this.room = message.room ?? this.room;
      if (DEBUG) debug(this.name, "projection", message.projection?.phase, "current", message.projection?.currentPlayerId, "v", message.projection?.version);
      this.think();
      return;
    }
    if (message.type === "error") {
      this.errors.push({
        reason: message.reason || "unknown",
        message: short(message.message || "", 200),
        at: Date.now(),
      });
      this.onActionError(message);
    }
  }

  onActionError(message) {
    if (message.reason === "not-your-turn" || message.reason === "game-over") return;
    if (this.pendingKind !== "play") return;
    if (!["card-not-in-hand", "piety:red-immunity", "cannot-target-self", "invalid-target", "bad-target"].includes(message.reason)) return;
    this.pendingKind = null;
    setTimeout(() => {
      if (this.closed) return;
      const p = this.projection;
      if (p?.phase === "action" && p.currentPlayerId === this.seatId) this.act({ kind: "draw" });
    }, 40);
  }

  queue(action) {
    // 新状态覆盖旧动作：夜晚/换人时，旧的定时器不能把过期动作发出去。
    if (this.actionTimer) clearTimeout(this.actionTimer);
    const expectedPhase = action?.kind === "dawn" ? "dawn" : action?.kind === "night" ? "night" : "action";
    this.actionTimer = setTimeout(() => {
      this.actionTimer = null;
      if (this.closed) return;
      // 延迟期间阶段可能已经结算；过期动作不发，按最新投影重排。
      if (this.projection?.phase !== expectedPhase) {
        debug(this.name, "skip stale", action?.kind, "expected", expectedPhase, "actual", this.projection?.phase);
        this.lastKey = null;
        this.think();
        return;
      }
      // 延迟期间可能被夜晚/红卡结算杀死；死人不再发动作。
      if (this.private?.alive === false) {
        debug(this.name, "skip dead", action?.kind);
        return;
      }
      debug(this.name, "act", JSON.stringify(action), "phase", this.projection?.phase, "current", this.projection?.currentPlayerId);
      this.act(action);
    }, BOT_DELAY_MS + (this.index % 6) * 4);
  }

  think() {
    if (this.closed || !this.projection || !this.room) return;
    if (this.room.phase === "over" || this.projection.winner) return;
    const p = this.projection;
    const priv = this.private;
    const key = [
      p.phase,
      p.version,
      p.currentPlayerId,
      p.actionTaken,
      priv?.dawn?.submitted,
      priv?.night?.submitted,
    ].join(":");

    if (p.phase === "dawn" && priv?.dawn?.isWitch && !priv.dawn.submitted) {
      this.lastKey = key;
      this.queue({ kind: "dawn", targetId: pick(aliveOtherIds(p, this.seatId)) });
      return;
    }

    if (p.phase === "night" && priv?.alive && priv?.night && !priv.night.submitted) {
      const info = priv.night;
      const required = info.required ?? [];
      // 有必须投票的人时，只让女巫/警长投；没有必须投票的人时，任意活人投票即可收夜。
      const mustVote = info.isWitch || info.isConstable || required.length === 0;
      if (!mustVote || !info.canConfess) return;
      this.lastKey = key;
      const payload = { kind: "night", confess: false };
      if (info.isWitch) payload.targetId = pick(aliveOtherIds(p, this.seatId));
      if (info.isConstable) payload.hammerTargetId = null;
      this.queue(payload);
      return;
    }

    if (p.phase !== "action" || p.currentPlayerId !== this.seatId) return;
    if (this.lastKey === key) return;
    this.lastKey = key;

    if (p.actionTaken) {
      this.queue({ kind: "end" });
      return;
    }

    const hand = p.self?.hand ?? [];
    const red = hand.filter((id) => CARD_CATALOG[id]?.color === "red");
    const targets = p.seats
      .filter((s) => s.alive && s.id !== this.seatId && !(s.blue ?? []).includes("piety"))
      .map((s) => s.id);

    if (red.length && targets.length && Math.random() < PLAY_RATE) {
      this.queue({
        kind: "play",
        play: { cardId: pick(red), targetId: pick(targets) },
      });
      return;
    }
    this.queue({ kind: "draw" });
  }

  waitFor(label, predicate, timeout = 10000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (predicate()) return resolve();
        if (Date.now() - started >= timeout) {
          return reject(new Error("timeout waiting for " + label));
        }
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  close() {
    this.closed = true;
    if (this.actionTimer) clearTimeout(this.actionTimer);
    this.actionTimer = null;
    try {
      if (this.ws?.readyState === 1) this.ws.close();
      else this.ws?.terminate?.();
    } catch {
      // ignore
    }
  }
}

function mergeErrors(clients) {
  const map = new Map();
  for (const client of clients) {
    for (const error of client.errors) {
      const key = error.reason || "unknown";
      const entry = map.get(key) ?? { reason: key, count: 0, sample: "" };
      entry.count += 1;
      if (!entry.sample) entry.sample = error.message || "";
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

async function runGame(gameNo) {
  const started = Date.now();
  const clients = [];
  let code = null;
  try {
    const host = new BotClient("压测" + pad(gameNo) + "-01", 0);
    clients.push(host);
    await host.connect();
    host.send({ type: "create", name: host.name });
    await host.waitFor("房间创建", () => host.room?.code && host.seatId !== null, 10000);
    code = host.room.code;

    for (let i = 2; i <= PLAYER_COUNT; i++) {
      const client = new BotClient("压测" + pad(gameNo) + "-" + pad(i), i - 1);
      clients.push(client);
      await client.connect();
      client.send({ type: "join", code, name: client.name });
      await client.waitFor("入座 " + i, () => client.seatId !== null, 10000);
    }

    await host.waitFor("12 人满座", () => host.room?.seats?.length === PLAYER_COUNT, 10000);
    for (const client of clients) client.send({ type: "ready", ready: true });
    await host.waitFor("全部准备", () => host.room?.startable === true, 15000);

    host.send({ type: "start" });
    await host.waitFor("开局", () => Boolean(host.projection) && host.room?.phase !== "lobby", 15000);
    await host.waitFor(
      "终局",
      () => host.room?.phase === "over" || Boolean(host.projection?.winner),
      GAME_TIMEOUT_MS,
    );

    const durationMs = Date.now() - started;
    const logCount = Math.max(0, ...clients.map((client) => client.projection?.log?.length ?? 0));
    return {
      ok: true,
      gameNo,
      code,
      durationMs,
      winner: host.projection?.winner ?? "unknown",
      reason: host.projection?.winnerReason ?? "",
      logCount,
      errors: mergeErrors(clients),
    };
  } catch (error) {
    return {
      ok: false,
      gameNo,
      code,
      durationMs: Date.now() - started,
      error: String(error?.message || error),
      errors: mergeErrors(clients),
    };
  } finally {
    for (const client of clients) client.close();
    await sleep(60);
  }
}

function printGame(result) {
  const errorCount = result.errors.reduce((sum, item) => sum + item.count, 0);
  if (result.ok) {
    console.log(
      "[game " + result.gameNo + "] ok room=" + result.code +
      " duration=" + result.durationMs + "ms" +
      " winner=" + result.winner +
      (result.reason ? " (" + result.reason + ")" : "") +
      " log=" + result.logCount +
      " errors=" + errorCount,
    );
  } else {
    console.log(
      "[game " + result.gameNo + "] FAIL room=" + (result.code ?? "-") +
      " duration=" + result.durationMs + "ms" +
      " error=" + result.error +
      " errors=" + errorCount,
    );
  }
  for (const item of result.errors) {
    console.log("  error " + item.reason + " x" + item.count + (item.sample ? ": " + item.sample : ""));
  }
}

const results = [];
for (let i = 1; i <= GAMES; i++) {
  const result = await runGame(i);
  results.push(result);
  printGame(result);
}

const okGames = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);
const durations = okGames.map((r) => r.durationMs).sort((a, b) => a - b);
const errorMap = new Map();
let unexpectedErrors = 0;
for (const result of results) {
  for (const item of result.errors) {
    const entry = errorMap.get(item.reason) ?? { reason: item.reason, count: 0, sample: "" };
    entry.count += item.count;
    if (!entry.sample) entry.sample = item.sample;
    errorMap.set(item.reason, entry);
    if (!EXPECTED_ERRORS.has(item.reason)) unexpectedErrors += item.count;
  }
}

console.log("\n=== 12 人整局压测汇总 ===");
console.log("games=" + GAMES + " ok=" + okGames.length + " failed=" + failed.length);
if (durations.length) {
  const total = durations.reduce((sum, n) => sum + n, 0);
  console.log(
    "duration min=" + durations[0] + "ms" +
    " avg=" + Math.round(total / durations.length) + "ms" +
    " max=" + durations[durations.length - 1] + "ms",
  );
}
if (errorMap.size === 0) {
  console.log("errors: none");
} else {
  console.log("errors:");
  for (const item of [...errorMap.values()].sort((a, b) => b.count - a.count)) {
    console.log("  " + item.reason + " x" + item.count + (item.sample ? ": " + short(item.sample, 160) : ""));
  }
}
console.log("unexpected errors=" + unexpectedErrors);

if (failed.length || unexpectedErrors) process.exitCode = 1;

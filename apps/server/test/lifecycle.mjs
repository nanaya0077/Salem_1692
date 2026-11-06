import WebSocket from "ws";
import assert from "node:assert/strict";
import { passDealPhase } from "./lib/deal.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8102";
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
    this.errors = [];
    this.reconnected = false;
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "welcome") {
        this.seatId = msg.seatId;
        this.code = msg.code;
        this.token = msg.token;
        this.reconnected = Boolean(msg.reconnected);
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
}

async function waitFor(label, fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error("timeout waiting for " + label);
}

const names = ["房主", "阿比盖尔", "约翰", "玛丽", "被踢者"];
const clients = names.map((name) => new Client(name));
await Promise.all(clients.map((c) => c.open()));
const [host, abigail, john, mary, kicked] = clients;

host.send({ type: "create", name: names[0] });
await waitFor("create", () => host.code);
const code = host.code;
for (let i = 1; i < clients.length; i++) {
  clients[i].send({ type: "join", code, name: names[i] });
}
await waitFor("5 seats", () => host.room?.seats?.length === 5);
console.log("lobby 5 seats", host.room.seats.map((s) => s.name + "#" + s.id).join(", "));

host.send({ type: "kick", seatId: kicked.seatId });
await waitFor("kick removes seat", () => host.room?.seats?.length === 4);
await waitFor("kicked socket closed", () => kicked.ws.readyState === WebSocket.CLOSED, 5000);
assert.equal(kicked.errors.some((e) => e.reason === "kicked"), true);
assert.equal(host.room.seats.some((s) => s.id === kicked.seatId), false);
console.log("kick ok; seats", host.room.seats.map((s) => s.name + "#" + s.id).join(", "));

for (const c of [host, abigail, john, mary]) c.send({ type: "ready", ready: true });
await waitFor("startable", () => host.room?.startable, 5000);
host.send({ type: "start" });
for (const c of [host, abigail, john, mary]) {
  await passDealPhase({ seatId: c.seatId, getProjection: () => c.projection, getPrivate: () => c.private, send: (m) => c.send(m), waitFor });
}
await waitFor("dawn", () => clients.slice(0, 4).every((c) => c.projection?.phase === "dawn"), 8000);
for (const c of [host, abigail, john, mary]) {
  if (c.private?.dawn?.isWitch && !c.private.dawn.submitted) {
    c.send({ type: "action", commandId: "dawn-" + c.seatId, action: { kind: "dawn", targetId: 0 } });
  }
}
await waitFor("action", () => clients.slice(0, 4).every((c) => c.projection?.phase === "action"), 10000);
console.log("game started; current", host.projection.currentPlayerId);

const marySeat = mary.seatId;
const maryToken = mary.token;
mary.close();
await waitFor("mary offline seat kept", () => host.room?.seats?.find((s) => s.id === marySeat)?.connected === false, 5000);
await sleep(120);
const mary2 = new Client("玛丽重连");
await mary2.open();
mary2.send({ type: "join", code, name: "玛丽", token: maryToken });
await waitFor("reconnected welcome", () => mary2.reconnected && mary2.seatId === marySeat, 8000);
await waitFor("reconnected projection", () => mary2.projection?.phase === "action", 8000);
await waitFor("seat online", () => host.room?.seats?.find((s) => s.id === marySeat)?.connected === true, 5000);
assert.equal(mary2.code, code);
console.log("reconnect ok; seat", mary2.seatId, "token reused");

const oldHostSeat = host.seatId;
host.close();
await waitFor("host transfer", () => [abigail, john, mary2].every((c) => c.room?.hostSeat && c.room.hostSeat !== oldHostSeat), 8000);
await waitFor("old host offline", () => mary2.room?.seats?.find((s) => s.id === oldHostSeat)?.connected === false, 5000);
console.log("host transfer ok; new host seat", mary2.room.hostSeat);

const errors = [abigail, john, mary2].flatMap((c) => c.errors);
assert.equal(errors.length, 0, "unexpected errors: " + JSON.stringify(errors));
console.log("lifecycle ok: kick / reconnect / host transfer");
for (const c of [abigail, john, mary2]) c.close();

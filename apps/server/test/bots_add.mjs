import assert from "node:assert/strict";
import WebSocket from "ws";
import { passDealPhase } from "./lib/deal.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8080";
const WS = BASE.replace(/^http/, "ws") + "/ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(WS);
let seatId = null;
let room = null;
let projection = null;
let privateState = null;
const errors = [];

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "welcome") seatId = msg.seatId;
  if (msg.type === "room") room = msg.room;
  if (msg.type === "projection") {
    projection = msg.projection;
    privateState = msg.private;
    room = msg.room ?? room;
  }
  if (msg.type === "error") errors.push(msg);
});

async function waitFor(label, fn, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error("timeout waiting for " + label);
}

await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
ws.send(JSON.stringify({ type: "create", name: "房主" }));
await waitFor("create", () => room && seatId !== null);
const code = room.code;
console.log("room", code, "host", seatId);

for (let i = 0; i < 4; i++) ws.send(JSON.stringify({ type: "add-bot" }));
await waitFor("4 bots", () => room?.seats?.length === 5 && room.seats.filter((s) => s.bot).length === 4);
const kicked = room.seats.find((s) => s.bot).id;
ws.send(JSON.stringify({ type: "kick", seatId: kicked }));
await waitFor("bot removed", () => room?.seats?.length === 4 && room.seats.filter((s) => s.bot).length === 3);
assert.equal(room.startable, true, "bots should be ready and connected");
console.log("seats", room.seats.map((s) => s.name + (s.bot ? "(bot)" : "") + "#" + s.id).join(", "));

ws.send(JSON.stringify({ type: "start" }));
// 机器人自己选角确认；房主这一步补齐就推进到黎明。
await passDealPhase({
  seatId,
  getProjection: () => projection,
  getPrivate: () => privateState,
  send: (m) => ws.send(JSON.stringify(m)),
  waitFor,
});
await waitFor("dawn", () => projection?.phase === "dawn");
if (privateState?.dawn?.isWitch && !privateState.dawn.submitted) {
  ws.send(JSON.stringify({ type: "action", commandId: "dawn-host", action: { kind: "dawn", targetId: 0 } }));
}
await waitFor("action", () => projection?.phase === "action", 10000);
console.log("action started; current", projection.currentPlayerId);
const before = projection.currentPlayerId;
if (before === seatId) {
  ws.send(JSON.stringify({ type: "action", commandId: "draw-host", action: { kind: "draw" } }));
}
await waitFor("turn advances", () => projection.phase === "night" || projection.currentPlayerId !== before, 10000);
console.log("turn advanced; current", projection.currentPlayerId, "phase", projection.phase);
assert.equal(errors.length, 0, "no server errors: " + JSON.stringify(errors));
console.log("add-bot ok: 3 bots, startable, auto turn");
ws.close();

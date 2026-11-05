import WebSocket from "ws";

const BASE = process.env.BASE || "http://127.0.0.1:8101";
const WS = BASE.replace(/^http/, "ws") + "/ws";
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
    this.messages = [];
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      this.messages.push(msg);
      if (msg.type === "welcome") { this.seatId = msg.seatId; this.code = msg.code; this.token = msg.token; }
      if (msg.type === "room") this.room = msg.room;
      if (msg.type === "projection") { this.projection = msg.projection; this.private = msg.private; this.room = msg.room ?? this.room; }
      if (msg.type === "error") this.errors.push(msg);
    });
  }
  open() { return new Promise((resolve, reject) => { this.ws.once("open", resolve); this.ws.once("error", reject); }); }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
  close() { this.ws.close(); }
}

async function waitFor(label, fn, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error("timeout waiting for " + label);
}

const names = ["阿比盖尔", "约翰", "玛丽", "乔治"];
const clients = names.map((name) => new Client(name));
await Promise.all(clients.map((c) => c.open()));
clients[0].send({ type: "create", name: names[0] });
await waitFor("create", () => clients[0].code);
const code = clients[0].code;
console.log("room", code, "host seat", clients[0].seatId);

for (let i = 1; i < clients.length; i++) {
  clients[i].send({ type: "join", code, name: names[i] });
}
await waitFor("4 seats", () => clients.every((c) => c.room?.seats?.length === 4));
console.log("seats", clients[0].room.seats.map((s) => s.name + "#" + s.id).join(", "));
for (const c of clients) c.send({ type: "ready", ready: true });
await waitFor("ready", () => clients.every((c) => c.room?.startable), 5000);

clients[0].send({ type: "start" });
await waitFor("dawn", () => clients.every((c) => c.projection?.phase === "dawn"), 8000);
console.log("dawn phase ok; witches", clients.filter((c) => c.private?.dawn?.isWitch).map((c) => c.name));

for (const c of clients) {
  if (c.private?.dawn?.isWitch && !c.private.dawn.submitted) {
    c.send({ type: "action", commandId: "dawn-" + c.seatId, action: { kind: "dawn", targetId: 0 } });
  }
}
await waitFor("playing", () => clients.every((c) => c.projection?.phase === "action"), 8000);
console.log("playing; first", clients[0].projection.currentPlayerId);

const firstId = clients[0].projection.currentPlayerId;
const first = clients.find((c) => c.seatId === firstId);
await waitFor("first projection", () => first.projection?.self?.hand, 8000);
const beforeHand = first.projection.self.hand.length;
const beforeCurrent = first.projection.currentPlayerId;
first.send({ type: "action", commandId: "draw-1", action: { kind: "draw" } });
await waitFor("turn advanced", () => clients.every((c) => c.projection && (c.projection.currentPlayerId !== beforeCurrent || c.projection.phase === "night")), 10000);
console.log("draw ok: hand", beforeHand, "->", first.projection.self.hand.length, "next/phase", first.projection.currentPlayerId, first.projection.phase);
console.log("errors", clients.map((c) => c.name + ":" + c.errors.length).join(" "));
for (const c of clients) c.close();

import WebSocket from "ws";

const code = (process.env.CODE || "").toUpperCase();
const count = Number(process.env.BOTS || 3);
const base = process.env.BASE || "http://127.0.0.1:8101";
const wsUrl = base.replace(/^http/, "ws") + "/ws";
const names = (process.env.NAMES || "约翰,玛丽,乔治,科顿,安妮,威尔,蒂图巴,玛莎,丽贝卡,塞缪尔,托马斯").split(",");
if (!code) { console.error("CODE required"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = [];

class Bot {
  constructor(name, index) {
    this.name = name;
    this.index = index;
    this.seatId = null;
    this.projection = null;
    this.private = null;
    this.room = null;
    this.lastAct = "";
    this.ws = new WebSocket(wsUrl);
    this.ws.on("open", () => this.send({ type: "join", code, name }));
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "welcome") {
        this.seatId = msg.seatId;
        this.send({ type: "ready", ready: true });
      }
      if (msg.type === "room") this.room = msg.room;
      if (msg.type === "projection") {
        this.projection = msg.projection;
        this.private = msg.private;
        this.room = msg.room ?? this.room;
        this.think();
      }
      if (msg.type === "error" && !["not-your-turn"].includes(msg.reason)) {
        console.log("[bot]", this.name, "error", msg.reason, msg.message);
      }
    });
  }
  send(msg) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  act(action) {
    this.send({ type: "action", commandId: "bot-" + this.seatId + "-" + Date.now() + "-" + Math.random().toString(36).slice(2), action });
  }
  think() {
    const p = this.projection;
    if (!p || !this.room) return;
    // 发牌相位（#10）：先选第一张候选，再确认身份卡。
    if (p.phase === "deal") {
      const seat = p.seats.find((s) => s.id === this.seatId);
      if (!seat) return;
      if (!seat.roleChosen && (seat.roleOptions ?? []).length) {
        this.act({ kind: "chooseRole", roleId: seat.roleOptions[0] });
        return;
      }
      if (!this.private?.acknowledged) this.act({ kind: "dealAck" });
      return;
    }
    const key = [p.phase, p.currentPlayerId, p.version, this.private?.night?.submitted, this.private?.dawn?.submitted].join(":");
    if (this.lastAct === key) return;
    if (p.phase === "dawn" && this.private?.dawn?.isWitch && !this.private.dawn.submitted) {
      this.lastAct = key;
      const targets = p.seats.filter((s) => s.alive).map((s) => s.id);
      const target = targets[Math.floor(Math.random() * targets.length)] ?? 0;
      setTimeout(() => this.act({ kind: "dawn", targetId: target }), 400 + this.index * 120);
      return;
    }
    if (p.phase === "night" && this.private?.night) {
      const info = this.private.night;
      if (info.submitted) return;
      const hasTask = info.isWitch || info.isConstable || info.canConfess;
      if (!hasTask) return;
      this.lastAct = key;
      const payload = { kind: "night", confess: false };
      if (info.isWitch) {
        const targets = p.seats.filter((s) => s.alive).map((s) => s.id);
        payload.targetId = targets[Math.floor(Math.random() * targets.length)] ?? 0;
      }
      if (info.isConstable) payload.hammerTargetId = null;
      setTimeout(() => this.act(payload), 500 + this.index * 120);
      return;
    }
    if (p.phase === "action" && p.currentPlayerId === this.seatId) {
      this.lastAct = key;
      setTimeout(() => {
        if (p.actionTaken) this.act({ kind: "end" });
        else this.act({ kind: "draw" });
      }, 900 + this.index * 150);
    }
  }
}

for (let i = 0; i < Math.min(count, names.length); i++) {
  const bot = new Bot(names[i], i);
  clients.push(bot);
  await sleep(120);
}
console.log("bots joining", code, clients.map((c) => c.name).join(","));
process.on("SIGTERM", () => { for (const c of clients) c.ws.close(); process.exit(0); });
setInterval(() => {
  const status = clients.map((c) => c.name + ":" + (c.room ? "seat" + c.seatId : "wait")).join(" ");
  console.log(new Date().toISOString(), status, "phase", clients[0]?.room?.phase);
}, 10000);

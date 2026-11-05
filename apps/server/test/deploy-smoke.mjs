// 部署冒烟：对任意已启动的实例跑一遍"能开房"的最小结论。
//
//   BASE=http://127.0.0.1:8080 node apps/server/test/deploy-smoke.mjs
//   BASE=https://<子域>.up.railway.app node apps/server/test/deploy-smoke.mjs
//
// 只依赖 Node 内置 fetch 与服务端的 ws 包，不改业务代码。
import WebSocket from "ws";

const BASE = (process.env.BASE || "http://127.0.0.1:8080").replace(/\/+$/, "");
const WS = BASE.replace(/^http/, "ws") + "/ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}

async function waitFor(label, fn, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = fn();
    if (value) return value;
    await sleep(40);
  }
  throw new Error("timeout waiting for " + label);
}

// 1. 健康检查
const healthRes = await fetch(BASE + "/health");
const health = await healthRes.json().catch(() => null);
check("GET /health 2xx", healthRes.ok, `status ${healthRes.status}`);
check("/health 返回 ok 与房间数", health?.ok === true && typeof health?.rooms === "number", JSON.stringify(health));

// 2. 首页可访问
const indexRes = await fetch(BASE + "/");
const indexHtml = await indexRes.text();
check("GET / 返回页面", indexRes.ok && indexHtml.includes("<html"), `status ${indexRes.status}, ${indexHtml.length} bytes`);

// 3. 房间列表
const roomsRes = await fetch(BASE + "/api/rooms");
const roomsBefore = await roomsRes.json().catch(() => null);
check("GET /api/rooms 可解析", roomsRes.ok && Array.isArray(roomsBefore), `status ${roomsRes.status}`);

// 4. WS 建连（101）并收到首帧
const ws = new WebSocket(WS);
const messages = [];
let firstFrame = null;
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  messages.push(msg);
  if (!firstFrame) firstFrame = msg;
});
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});
check("WS 握手成功", ws.readyState === WebSocket.OPEN, WS);

// 5. 建房 + 按房码回查
ws.send(JSON.stringify({ type: "create", name: "冒烟测试员" }));
const welcome = await waitFor("welcome", () => messages.find((m) => m.type === "welcome"));
const code = welcome.code;
check("建房拿到房码", typeof code === "string" && code.length === 6, code);

const roomRes = await fetch(BASE + "/api/rooms/" + code);
const room = await roomRes.json().catch(() => null);
check("按房码查房", roomRes.ok && room?.code === code, `status ${roomRes.status}`);

const listAfter = await (await fetch(BASE + "/api/rooms")).json();
check("房间出现在列表里", listAfter.some((r) => r.code === code));

// 6. 不存在的房码
const missing = await fetch(BASE + "/api/rooms/ZZZZZZ");
check("不存在的房码返回 404", missing.status === 404, `status ${missing.status}`);

ws.close();
console.log(`\n${failures === 0 ? "冒烟通过" : "冒烟失败：" + failures + " 项"}  (${BASE})`);
process.exit(failures === 0 ? 0 : 1);

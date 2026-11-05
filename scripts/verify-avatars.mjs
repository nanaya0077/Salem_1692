// 端到端验证（#5 客户端：所有展示面换成头像）。
//
// 覆盖票面验收：
//   1. 七处展示面（大厅座位、对手卡、自己面板、夜晚目标格、木槌目标格、黎明目标格、结算名单）
//      显示的是同一串头像 data URL；
//   2. 没有头像的座位仍然是昵称首字，且没有 <img> 残留；
//   3. avatar:null 之后同一帧回落到首字；
//   4. emoji 昵称的首字是整个 emoji；
//   5. 聊天区没有任何头像；
//   6. 改名后各展示面只有新名字。
//
// 跑法：node scripts/verify-avatars.mjs
// 依赖：本机 Chrome 或 Edge（可用 CHROME_PATH 指定）；Node 24 自带的 fetch / WebSocket。
// 不新增 npm 依赖，也不进 npm test —— 它要起服务器和浏览器。

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = 8140;
const CDP_PORT = 9333;
const BASE = "http://127.0.0.1:" + PORT;
// 1x1 的合法 WebP：喂给页面自己的压缩管线，落库的是 canvas 重新编码的 256×256 图。
const TINY_WEBP_BASE64 = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

const passed = [];
const failed = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed.push(name);
    console.log("PASS  " + name);
  } else {
    failed.push(name + (detail ? " —— " + detail : ""));
    console.log("FAIL  " + name + (detail ? " —— " + detail : ""));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = "HTTP " + res.status;
    } catch (error) {
      last = String(error?.message ?? error);
    }
    await sleep(120);
  }
  throw new Error("等待 " + url + " 超时：" + last);
}

async function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const path of candidates) {
    try {
      await stat(path);
      return path;
    } catch {
      // 换下一个候选
    }
  }
  throw new Error("找不到 Chrome / Edge；可以用 CHROME_PATH 指定可执行文件");
}

// 最小 CDP 客户端：一个浏览器级连接 + 扁平化 session，够用就好。
class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolveOpen, rejectOpen) => {
      this.ws.addEventListener("open", resolveOpen, { once: true });
      this.ws.addEventListener("error", () => rejectOpen(new Error("CDP 连接失败")), { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
    });
  }

  close() {
    try { this.ws.close(); } catch { /* 已经关了 */ }
  }
}

async function openPage(cdp, label) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = { label, sessionId, targetId };

  page.eval = async (expression) => {
    const result = await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      sessionId
    );
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error("[" + label + "] 页面脚本异常：" + detail);
    }
    return result.result?.value;
  };

  page.waitFor = async (expression, what, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await page.eval(expression)) return true;
      await sleep(80);
    }
    throw new Error("[" + label + "] 等待超时：" + what);
  };

  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url: BASE + "/" }, sessionId);
  await page.waitFor(
    "document.readyState === 'complete' && Boolean(globalThis.__salem) && globalThis.__salem.open === true",
    "页面就绪并连上服务器"
  );
  return page;
}

// ---------- 页面侧动作 ----------

async function setField(page, id, value) {
  await page.eval(
    "(() => { const el = document.getElementById(" + JSON.stringify(id) + ");" +
      " el.value = " + JSON.stringify(value) + ";" +
      " el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()"
  );
}

async function click(page, id) {
  await page.eval("document.getElementById(" + JSON.stringify(id) + ").click(); true");
}

async function openProfile(page) {
  await click(page, "openProfileLanding");
  await page.waitFor("!document.getElementById('profileModal').hidden", "个人资料弹层打开");
}

async function setAvatar(page) {
  await openProfile(page);
  await page.eval(
    "(() => {" +
      " const bytes = Uint8Array.from(atob(" + JSON.stringify(TINY_WEBP_BASE64) + "), (c) => c.charCodeAt(0));" +
      " const file = new File([bytes], 'avatar.webp', { type: 'image/webp' });" +
      " const dt = new DataTransfer();" +
      " dt.items.add(file);" +
      " const input = document.getElementById('profileFile');" +
      " input.files = dt.files;" +
      " input.dispatchEvent(new Event('change'));" +
      " return true; })()"
  );
  // 页面自己的压缩管线跑完才会出现预览 <img>。
  await page.waitFor("Boolean(document.querySelector('#profileAvatar img'))", "头像压缩完成");
  await click(page, "profileSave");
  await page.waitFor("document.getElementById('profileModal').hidden", "弹层关闭");
  await page.waitFor(
    "Boolean(globalThis.__salem.avatars && globalThis.__salem.avatars[globalThis.__salem.seatId])",
    "服务端确认头像"
  );
}

async function removeAvatar(page) {
  await openProfile(page);
  await click(page, "profileRemove");
  await click(page, "profileSave");
  await page.waitFor("document.getElementById('profileModal').hidden", "弹层关闭");
  await page.waitFor(
    "!globalThis.__salem.avatars?.[globalThis.__salem.seatId]",
    "服务端确认头像已移除"
  );
}

async function renameTo(page, name) {
  await openProfile(page);
  await setField(page, "profileName", name);
  await click(page, "profileSave");
  await page.waitFor("document.getElementById('profileModal').hidden", "弹层关闭");
}

// 读某座位在某个容器里的头像状态：src（有图）与首字文本（无图）。
const SNAPSHOT = "const shot = (root, sel) => {" +
  " const box = root.querySelector(sel);" +
  " if (!box) return null;" +
  " return { src: box.querySelector('img')?.getAttribute('src') ?? null, text: box.textContent.trim() };" +
  "};";

// ---------- 主流程 ----------

async function main() {
  const browserPath = await findBrowser();
  const profileDir = await mkdtemp(join(tmpdir(), "salem-verify-"));
  console.log("浏览器：" + browserPath);
  console.log("临时 profile：" + profileDir);

  const server = spawn(process.execPath, ["apps/server/src/server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (chunk) => process.stderr.write("[server] " + chunk));

  const browser = spawn(browserPath, [
    "--headless=new",
    "--remote-debugging-port=" + CDP_PORT,
    "--user-data-dir=" + profileDir,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-gpu",
    "--window-size=1280,960",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });

  let cdp = null;
  try {
    await waitHttp(BASE + "/health");
    await waitHttp("http://127.0.0.1:" + CDP_PORT + "/json/version");
    const version = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/version")).json();
    cdp = new Cdp(version.webSocketDebuggerUrl);
    await cdp.connect();

    const alice = await openPage(cdp, "阿甲");
    await setField(alice, "nameInput", "阿甲");
    await click(alice, "createBtn");
    await alice.waitFor("Boolean(globalThis.__salem.room?.code)", "房间码出现");
    const code = await alice.eval("globalThis.__salem.room.code");

    // 1) 大厅：设头像 → 其他客户端看到同一张图
    await setAvatar(alice);
    const av1 = await alice.eval("globalThis.__salem.avatars[globalThis.__salem.seatId]");
    check("头像来自页面压缩管线（WebP data URL）", typeof av1 === "string" && av1.startsWith("data:image/webp;base64,"), String(av1).slice(0, 32));

    await click(alice, "addBotBtn");
    await click(alice, "addBotBtn");
    await alice.waitFor("document.getElementById('seatCount').textContent.startsWith('3/')", "两个机器人入座");
    await click(alice, "readyBtn");

    const bob = await openPage(cdp, "布丁");
    // 同一浏览器共享 localStorage：先清掉，别让补传把别人的头像贴到自己身上。
    await bob.eval("localStorage.clear(); true");
    await setField(bob, "nameInput", "布丁");
    await setField(bob, "codeInput", code);
    await click(bob, "joinBtn");
    await bob.waitFor("!document.getElementById('lobby').hidden", "布丁进了大厅");

    const lobbyShot = await bob.eval("(() => {" + SNAPSHOT +
      " const seats = Array.from(document.querySelectorAll('#lobbySeats .lobby-seat'));" +
      " const row = seats.find((el) => el.querySelector('.seat-name')?.textContent === " + JSON.stringify("阿甲") + ");" +
      " const bot = seats.find((el) => el.querySelector('.seat-name')?.textContent?.startsWith('机器人'));" +
      " return { alice: shot(row, '.avatar'), bot: shot(bot, '.avatar') }; })()");
    check("大厅座位：有头像的座位是 <img> 且指向同一张图",
      lobbyShot.alice?.src === av1, JSON.stringify(lobbyShot.alice));
    check("大厅座位：机器人没有头像，仍是首字「机」",
      lobbyShot.bot?.src === null && lobbyShot.bot?.text === "机", JSON.stringify(lobbyShot.bot));

    // 2) 移除 → 大厅同一帧回落首字
    await sleep(1100); // 服务端同座位 1 秒硬闸
    await removeAvatar(alice);
    const lobbyAfterRemove = await bob.eval("(() => {" + SNAPSHOT +
      " const seats = Array.from(document.querySelectorAll('#lobbySeats .lobby-seat'));" +
      " const row = seats.find((el) => el.querySelector('.seat-name')?.textContent === " + JSON.stringify("阿甲") + ");" +
      " return shot(row, '.avatar'); })()");
    check("大厅座位：移除头像后回到首字「阿」且没有 <img> 残留",
      lobbyAfterRemove?.src === null && lobbyAfterRemove?.text === "阿", JSON.stringify(lobbyAfterRemove));

    // 3) 重新设头像，开局，验证对局里的展示面
    await sleep(1100);
    await setAvatar(alice);
    const av2 = await bob.eval("globalThis.__salem.avatars[globalThis.__salem.seatId] ?? null");
    await bob.eval("true"); // 让消息处理完
    await bob.waitFor("Boolean(globalThis.__salem.avatars && Object.keys(globalThis.__salem.avatars).length)", "布丁收到头像表");
    const av2OnBob = await bob.eval("Object.values(globalThis.__salem.avatars)[0]");
    check("头像在客户端之间一致（同一串 data URL）", av2OnBob === (await alice.eval("globalThis.__salem.avatars[globalThis.__salem.seatId]")), String(av2));

    await click(bob, "readyBtn");
    // 换头像会把座位打回未准备（服务端 applyProfile 的行为），开局前再点一次。
    await click(alice, "readyBtn");
    await alice.waitFor("!document.getElementById('startBtn').disabled", "房主可开局");
    await click(alice, "startBtn");
    await alice.waitFor("!document.getElementById('game').hidden", "进入对局");
    await bob.waitFor("!document.getElementById('game').hidden", "布丁进入对局");

    const ids = await bob.eval("(() => { const p = globalThis.__salem.projection; return {" +
      " alice: p.seats.find((s) => s.name === '阿甲')?.id ?? null," +
      " bot: p.seats.find((s) => s.name?.startsWith('机器人'))?.id ?? null," +
      " self: globalThis.__salem.seatId }; })()");
    check("找到阿甲与机器人的座位 id", ids.alice !== null && ids.bot !== null, JSON.stringify(ids));

    const opponentShot = await bob.eval("(() => {" + SNAPSHOT +
      " const card = document.querySelector('#opponents .seat-card[data-seat=\"' + " + ids.alice + " + '\"]');" +
      " return shot(card, '.avatar'); })()");
    check("对手卡：阿甲显示同一张头像", opponentShot?.src === av2OnBob, JSON.stringify(opponentShot));

    const selfShot = await alice.eval("(() => {" + SNAPSHOT + " return shot(document.querySelector('#selfPanel'), '.avatar'); })()");
    check("对局自己面板：显示同一张头像", selfShot?.src === av2OnBob, JSON.stringify(selfShot));

    // 4) 聊天区：只有昵称，没有任何头像
    await bob.eval("(() => { const i = document.getElementById('chatInput'); i.value = '夜里见';" +
      " document.getElementById('chatSend').click(); return true; })()");
    await bob.waitFor("document.getElementById('logList').textContent.includes('夜里见')", "聊天消息进日志");
    const chatShot = await bob.eval("(() => ({" +
      " imgs: document.querySelectorAll('#logList img').length," +
      " avatars: document.querySelectorAll('#logList .avatar').length," +
      " hasName: document.getElementById('logList').textContent.includes('布丁') }))()");
    check("聊天区没有 <img>、没有头像圆牌，且昵称照旧",
      chatShot.imgs === 0 && chatShot.avatars === 0 && chatShot.hasName, JSON.stringify(chatShot));

    // 5) 夜晚 / 木槌 / 黎明 / 结算：用真实 projection 消息形状驱动渲染
    const nightShot = await bob.eval("(() => {" + SNAPSHOT +
      " const S = globalThis.__salem;" +
      " const projection = Object.assign({}, S.projection, { phase: 'night' });" +
      " const priv = { seatId: S.seatId, phase: 'night', night: { isWitch: true, isConstable: true," +
      "  canConfess: false, canWilliam: false, submitted: false, targetId: null, hammerTargetId: null," +
      "  confess: false, useWilliam: false, deadline: Date.now() + 60000 } };" +
      " S.ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'projection', projection, private: priv }) }));" +
      " const id = " + ids.alice + "; const botId = " + ids.bot + ";" +
      " return {" +
      "  visible: !document.getElementById('nightOverlay').hidden," +
      "  kill: shot(document.querySelector('#nightTargets .pick[data-night-target=\"' + id + '\"]'), '.avatar')," +
      "  hammer: shot(document.querySelector('#nightHammer .pick[data-hammer=\"' + id + '\"]'), '.avatar')," +
      "  bot: shot(document.querySelector('#nightTargets .pick[data-night-target=\"' + botId + '\"]'), '.avatar') }; })()");
    check("夜晚目标格：显示同一张头像", nightShot.visible && nightShot.kill?.src === av2OnBob, JSON.stringify(nightShot.kill));
    check("木槌目标格：显示同一张头像", nightShot.hammer?.src === av2OnBob, JSON.stringify(nightShot.hammer));
    check("夜晚目标格：机器人没有头像，仍是首字「机」",
      nightShot.bot?.src === null && nightShot.bot?.text === "机", JSON.stringify(nightShot.bot));

    const dawnShot = await bob.eval("(() => {" + SNAPSHOT +
      " const S = globalThis.__salem;" +
      " const projection = Object.assign({}, S.projection, { phase: 'dawn' });" +
      " const priv = { seatId: S.seatId, phase: 'dawn', dawn: { isWitch: true, submitted: false, accepted: true, deadline: Date.now() + 60000 } };" +
      " S.ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'projection', projection, private: priv }) }));" +
      " const id = " + ids.alice + ";" +
      " return { visible: !document.getElementById('dawnOverlay').hidden," +
      "  pick: shot(document.querySelector('#dawnTargets .pick[data-dawn-target=\"' + id + '\"]'), '.avatar') }; })()");
    check("黎明黑猫目标格：显示同一张头像", dawnShot.visible && dawnShot.pick?.src === av2OnBob, JSON.stringify(dawnShot.pick));

    const overShot = await bob.eval("(() => {" + SNAPSHOT +
      " const S = globalThis.__salem;" +
      " const projection = Object.assign({}, S.projection, { phase: 'gameOver', winner: 'town', winnerReason: '验证' });" +
      " S.ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'projection', projection, private: null }) }));" +
      " const rows = Array.from(document.querySelectorAll('#overRoles .over-role'));" +
      " const row = rows.find((el) => el.querySelector('.over-name b')?.textContent?.startsWith('阿甲'));" +
      " return { visible: !document.getElementById('overOverlay').hidden, pick: shot(row, '.avatar') }; })()");
    check("结算名单：显示同一张头像", overShot.visible && overShot.pick?.src === av2OnBob, JSON.stringify(overShot.pick));

    // 6) 改名：所有展示面只有新名字
    await sleep(1100);
    await renameTo(alice, "阿甲二");
    await bob.waitFor("globalThis.__salem.room.seats.some((s) => s.name === '阿甲二')", "布丁收到新名字");
    const renameShot = await bob.eval("(() => ({" +
      " cardName: document.querySelector('#opponents .seat-card[data-seat=\"' + " + ids.alice + " + '\"] .seat-name')?.textContent ?? null," +
      " oldNameLeft: Array.from(document.querySelectorAll('#opponents .seat-name')).some((el) => el.textContent === '阿甲')," +
      " selfName: document.querySelector('#selfPanel .self-name')?.textContent ?? null }))()");
    check("改名后对手卡只有新名字", renameShot.cardName === "阿甲二" && renameShot.oldNameLeft === false, JSON.stringify(renameShot));

    // 7) 移除头像：对局里的六处展示面回落到首字
    await sleep(1100);
    await removeAvatar(alice);
    await bob.waitFor("!globalThis.__salem.avatars?.[" + ids.alice + "]", "布丁收到移除");
    await bob.waitFor("globalThis.__salem.room.seats.some((s) => s.name === '阿甲二')", "房间仍在");

    const fallback = await bob.eval("(() => {" + SNAPSHOT +
      " const S = globalThis.__salem; const id = " + ids.alice + ";" +
      " const out = {};" +
      " out.opponent = shot(document.querySelector('#opponents .seat-card[data-seat=\"' + id + '\"]'), '.avatar');" +
      " const night = Object.assign({}, S.projection, { phase: 'night' });" +
      " S.ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'projection', projection: night," +
      "  private: { seatId: S.seatId, night: { isWitch: true, isConstable: true, canConfess: false, canWilliam: false," +
      "   submitted: false, targetId: null, hammerTargetId: null, confess: false, useWilliam: false, deadline: Date.now() + 60000 } } }) }));" +
      " out.kill = shot(document.querySelector('#nightTargets .pick[data-night-target=\"' + id + '\"]'), '.avatar');" +
      " out.hammer = shot(document.querySelector('#nightHammer .pick[data-hammer=\"' + id + '\"]'), '.avatar');" +
      " const dawn = Object.assign({}, S.projection, { phase: 'dawn' });" +
      " S.ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'projection', projection: dawn," +
      "  private: { seatId: S.seatId, dawn: { isWitch: true, submitted: false, accepted: true, deadline: Date.now() + 60000 } } }) }));" +
      " out.dawn = shot(document.querySelector('#dawnTargets .pick[data-dawn-target=\"' + id + '\"]'), '.avatar');" +
      " const over = Object.assign({}, S.projection, { phase: 'gameOver', winner: 'town', winnerReason: '验证' });" +
      " S.ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'projection', projection: over, private: null }) }));" +
      " const row = Array.from(document.querySelectorAll('#overRoles .over-role')).find((el) =>" +
      "  el.querySelector('.over-name b')?.textContent?.startsWith('阿甲二'));" +
      " out.over = shot(row, '.avatar');" +
      " return out; })()");
    for (const [where, shot] of Object.entries(fallback)) {
      check("移除头像后「" + where + "」回落首字「阿」且无 <img> 残留",
        shot?.src === null && shot?.text === "阿", JSON.stringify(shot));
    }
    const selfFallback = await alice.eval("(() => {" + SNAPSHOT + " return shot(document.querySelector('#selfPanel'), '.avatar'); })()");
    check("移除头像后「自己面板」回落首字「阿」且无 <img> 残留",
      selfFallback?.src === null && selfFallback?.text === "阿", JSON.stringify(selfFallback));

    // 8) emoji 昵称：首字是整个 emoji
    const cat = await openPage(cdp, "🐱喵");
    await cat.eval("localStorage.clear(); true");
    await setField(cat, "nameInput", "🐱喵");
    await click(cat, "createBtn");
    await cat.waitFor("Boolean(globalThis.__salem.room?.code)", "emoji 房主建好房间");
    const emojiShot = await cat.eval("(() => {" + SNAPSHOT +
      " const row = document.querySelector('#lobbySeats .lobby-seat');" +
      " return { shot: shot(row, '.avatar'), name: row.querySelector('.seat-name')?.textContent ?? null }; })()");
    check("emoji 昵称：首字圆牌是整个 🐱（不是半个代理对）",
      emojiShot.shot?.text === "🐱" && emojiShot.shot?.src === null && emojiShot.name === "🐱喵",
      JSON.stringify(emojiShot));
  } finally {
    if (cdp) cdp.close();
    browser.kill();
    server.kill();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log("");
  console.log("通过 " + passed.length + " 项，失败 " + failed.length + " 项。");
  if (failed.length) {
    for (const item of failed) console.log("  - " + item);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("验证脚本出错：" + (error?.stack ?? error));
  process.exitCode = 1;
});

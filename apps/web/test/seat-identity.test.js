import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "..", "app.js"), "utf8");
const server = readFileSync(join(here, "..", "..", "server", "src", "server.mjs"), "utf8");

// 从 marker 之后第一个 "{" 起取整段函数体；marker 要把参数表里的默认值 {} 一并带上，
// 否则会把参数里的那对空括号当成函数体。
function bodyOf(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "找不到 " + marker);
  const open = source.indexOf("{", start + marker.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(marker + " 的大括号没闭合");
}

// 客户端只在 welcome 里拿到过一次座位号与头像表，之后一直按座位号取人、取头像。
// 座位表结构一变，这两样必须一起换；分开换会出现「新座位号 + 旧头像表」的中间态。
test("客户端收到 resync 就整份换掉座位号与头像表", () => {
  const body = bodyOf(app, "function adoptResync(resync) ");
  assert.ok(body.includes("adoptIdentity(resync.seatId, resync.avatars)"), "座位号与头像要一起换，不能只改一样");
  assert.ok(body.includes("saveSession("), "新座位号要写回会话，否则重连后又对不上");
  const shared = bodyOf(app, "function adoptIdentity(seatId, avatars) ");
  assert.ok(shared.includes("S.seatId = seatId"), "要先换自己的座位号");
  assert.ok(shared.includes("resetAvatars(avatars)"), "要整份换掉头像;只改座位号会留下别的座位的脸");
  assert.ok(
    app.includes("if (msg.resync) adoptResync(msg.resync);"),
    "resync 挂在 room / projection 上，handle() 里要按载荷判断，不能再等一条独立消息",
  );
  assert.ok(!app.includes('case "resync":'), "独立 resync 消息已经取消，客户端不该还留着这个分支");
});

test("服务端把 resync 挂进同一条 room / projection，而不是另发一条", () => {
  const body = bodyOf(server, "function sync(room, reissue = false) ");
  assert.ok(
    body.includes("resync: mine(seat)"),
    "每个连接自己的座位号不同，所以重发要逐座塞进它自己那条消息",
  );
  assert.ok(
    body.includes('broadcast(room, { type: "room", room: pub })'),
    "没有结构变化时仍走一次广播，不要给每个座位各发一条",
  );
  const calls = server.split("\n").filter((line) => line.trim() === "sync(room, true);").length;
  assert.ok(calls >= 3, "开局重编号、踢人、大厅掉线三条路径都要带 resync，实际只有 " + calls + " 处");
  assert.ok(!server.includes('type: "resync"'), "不该再有独立的 resync 消息类型");
});

// 第 15 版规则不公开「是否曾为女巫」：服务端始终知道，界面上一个字都不该露。
test("界面不显示某人是否曾为女巫", () => {
  const css = readFileSync(join(here, "..", "styles.css"), "utf8");
  assert.ok(!app.includes("曾为女巫"), "座位卡不该再挂「曾为女巫」小字");
  const over = bodyOf(app, "function renderOver() ");
  assert.ok(!over.includes("everWitch"), "结束面板不该按曾为女巫加任何标记");
  assert.ok(!/\.over-role\.witch\b/.test(css), "已不再生成的 witch 样式要一起删掉");
});

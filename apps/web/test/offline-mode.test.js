import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * 线下模式（建房时勾选，全程不设倒计时）：接线层面的断言。
 * 真正的「没有兜底在跑」由服务端 offline.mjs 推时钟证明，这里只钉住客户端三处接线：
 * 建房把开关传上去、大厅显示状态、计时位改成「不限时」。
 */

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, "../index.html"), "utf8");
const app = readFileSync(resolve(here, "../app.js"), "utf8");
const css = readFileSync(resolve(here, "../styles.css"), "utf8");

function bodyOf(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, "找不到 " + marker);
  const start = source.indexOf("{", at);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(marker + " 的函数体没有闭合");
}

test("建房页有线下模式开关，且排在创建按钮前面", () => {
  assert.match(html, /id="offlineMode"[^>]*type="checkbox"/, "建房页要有线下模式的勾选框");
  assert.match(html, /线下模式/, "勾选项要写清这是线下模式");
  assert.match(html, /不设任何倒计时/, "勾选项要说明它取消了倒计时");
  const toggle = html.indexOf('id="offlineMode"');
  const create = html.indexOf('id="createBtn"');
  assert.ok(toggle > 0 && create > 0, "两个元素都要在");
  assert.ok(toggle < create, "开关要在「创建房间」上面，勾完才能建");
});

test("建房时把线下模式一起发给服务端", () => {
  const body = bodyOf(app, "function createRoom(");
  assert.match(body, /offlineMode/, "要读勾选框");
  assert.match(body, /checked === true/, "只认明确勾上的");
  assert.match(body, /config: \{ offline \}/, "offline 要放进 create 的 config 里发出去");
});

test("计时位在线下模式显示「不限时」，不留上一局的秒数", () => {
  const body = bodyOf(app, "function updateTimers(");
  assert.ok(body.includes("?.offline === true"), "离线标记从房间元信息读");
  assert.ok(body.includes("S.room"), "房间元信息落在 S.room 上，投影里没有 room");
  assert.match(body, /不限时/, "四个计时位要改成不限时");
  assert.match(body, /turnBadge/, "回合徽标也在其中");
  // 早退必须排在写秒数之前，否则旧值会先被写进去。
  const early = body.indexOf("offline");
  const seconds = body.indexOf('+ "s"');
  assert.ok(early >= 0 && seconds > early, "线下模式的分支要在写秒数之前返回");
});

test("大厅里能看到这个房是线下模式", () => {
  assert.match(html, /id="offlineBadge"/, "大厅要有线下模式的提示位");
  const body = bodyOf(app, "function renderLobby(");
  assert.match(body, /offlineBadge/, "大厅渲染要更新这个提示位");
  assert.match(body, /room\.offline !== true/, "按房间标记决定显隐");
});

test("线下模式样式与全局 hidden 不打架", () => {
  assert.match(css, /\.offline-row/, "勾选项要有自己的样式，不能被 .field 的输入宽度撑开");
  assert.match(css, /\.offline-label em/, "副标题要压成小字");
  assert.match(css, /\.offline-badge/, "大厅提示要有样式");
});

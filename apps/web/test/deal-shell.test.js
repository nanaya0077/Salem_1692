import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const html = readFileSync(join(web, "index.html"), "utf8");
const app = readFileSync(join(web, "app.js"), "utf8");
const sw = readFileSync(join(web, "sw.js"), "utf8");

// 开局整屏接管：发牌确认屏要有自己的骨架，不能借用黎明/夜晚的文案与按钮。
test("发牌确认屏在壳里有整屏骨架：卡片条、计数、选角、进入黎明", () => {
  for (const id of ["dealOverlay", "dealCards", "dealCount", "dealRoles", "dealSeats", "dealAckBtn"]) {
    assert.ok(html.includes('id="' + id + '"'), "index.html 缺 #" + id);
  }
  const overlay = html.slice(html.indexOf('id="dealOverlay"'), html.indexOf('id="overOverlay"'));
  assert.ok(overlay.includes("进入黎明"), "确认按钮的文案是「进入黎明」");
  assert.ok(overlay.includes("你的身份卡"), "发牌屏要有自己的身份卡区标题");
});

// 确认与选角走现有 action 通道；协议形状由服务端 #10 定死。
test("点「进入黎明」发 dealAck，选角色发 chooseRole", () => {
  assert.ok(/act\(\{\s*kind:\s*"dealAck"\s*\}\)/.test(app), "确认按钮要发 { kind: \"dealAck\" }");
  assert.ok(/act\(\{\s*kind:\s*"chooseRole",\s*roleId/.test(app), "选角要发 { kind: \"chooseRole\", roleId }");
  assert.ok(app.includes('from "./deal-view.js"'), "阶段标签与发牌展示语义要从 deal-view.js 取");
});

// 离线壳：新模块必须进 SHELL 并升 VERSION，否则旧缓存里还是没这个文件的 app.js。
test("离线壳收进新模块并升版本", () => {
  const version = sw.match(/const VERSION = "([^"]+)"/)?.[1];
  assert.equal(version, "salem-v20", "新模块进壳后 VERSION 必须是当前这一版，旧缓存才会整批作废");
  const shell = sw.slice(sw.indexOf("const SHELL"), sw.indexOf("const cacheable"));
  assert.ok(shell.includes('"/deal-view.js"'), "SHELL 要收 /deal-view.js");
  assert.ok(shell.includes('"/reveal-view.js"'), "SHELL 要收 /reveal-view.js");
  const cacheable = sw.slice(sw.indexOf("const cacheable"));
  assert.ok(cacheable.includes('"/deal-view.js"'), "cacheable 列表也要收 /deal-view.js");
  assert.ok(cacheable.includes('"/reveal-view.js"'), "cacheable 列表也要收 /reveal-view.js");
});


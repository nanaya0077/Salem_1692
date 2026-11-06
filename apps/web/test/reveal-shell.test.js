import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const html = readFileSync(join(web, "index.html"), "utf8");
const app = readFileSync(join(web, "app.js"), "utf8");
const css = readFileSync(join(web, "styles.css"), "utf8");
const sw = readFileSync(join(web, "sw.js"), "utf8");

// 挂起揭示要有一条自己的条形区：选择者在那儿选位置，其他人看「等待 X 选择」。
test("壳里有揭示条骨架，且不挡在手牌下面", () => {
  assert.ok(html.includes('id="revealBar"'), "index.html 缺 #revealBar");
  const bar = html.indexOf('id="revealBar"');
  assert.ok(bar > html.indexOf('id="targetBanner"'), "揭示条排在目标条之后");
  assert.ok(bar < html.indexOf('id="opponents"'), "揭示条在座位区之前，390px 竖屏不用滚动就能看到");
});

test("位置条窄屏不溢出、可横向滑动，已揭示位不可点", () => {
  assert.ok(/\.reveal-bar\b/.test(css), "要有 .reveal-bar 样式");
  const slots = css.slice(css.indexOf(".reveal-slots"));
  assert.ok(slots.includes("overflow-x: auto"), "位置条要可横向滑动");
  assert.ok(/\.reveal-slot\[disabled\]|\.reveal-slot:disabled/.test(css), "已揭示位置要有禁用样式");
});

// 动作走现有 action 通道；挂起语义由规则层 #13 定死。
test("点位置发 reveal、点放弃发 decline，都走 act()", () => {
  assert.ok(/act\(\{\s*kind:\s*"reveal",\s*trialIndex/.test(app), "要发 { kind: \"reveal\", trialIndex }");
  assert.ok(/act\(\{\s*kind:\s*"decline"\s*\}\)/.test(app), "要发 { kind: \"decline\" }");
  assert.ok(app.includes('from "./reveal-view.js"'), "揭示展示语义要从 reveal-view.js 取");
});

// 挂起期的公开信号挂在 projection 消息顶层（不是规则投影里，避免把 slots 泄漏给非选择者）。
test("客户端读顶层 revealWait 与自动揭示记录", () => {
  assert.ok(/msg\.revealWait/.test(app), "handle() 要读 msg.revealWait");
  assert.ok(!/autoReveals/.test(app), "自动揭示不再另发一份对位记录");
  assert.ok(/case "trialRevealed".*revealLogText/.test(app), "日志句读事件自带的 auto 字段");
  assert.ok(/pendingReveal/.test(app), "选择者自己的挂起态从 projection.pendingReveal 读");
});

test("离线壳收进新模块并升版本", () => {
  const version = sw.match(/const VERSION = "([^"]+)"/)?.[1];
  assert.equal(version, "salem-v11", "新模块进壳后 VERSION 必须是当前这一版，旧缓存才会整批作废");
  assert.ok(sw.includes('"/reveal-view.js"'), "SHELL 要收 /reveal-view.js");
  const cacheable = sw.slice(sw.indexOf("const cacheable"));
  assert.ok(cacheable.includes('"/reveal-view.js"'), "cacheable 列表也要收 /reveal-view.js");
});

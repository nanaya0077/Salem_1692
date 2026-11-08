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
// 挂起揭示与传染共用同一套底部抽屉：槽位契约在 drawer-shell.js，这里只核揭示侧接上了没有。
test("壳里有挂起揭示抽屉，且用的是共享槽位", () => {
  assert.ok(html.includes('id="revealDrawer"'), "index.html 缺 #revealDrawer");
  const at = html.indexOf('id="revealDrawer"');
  const slice = html.slice(at, at + 1400);
  assert.ok(slice.includes('data-slot-root="drawer"'), "抽屉根要标 data-slot-root");
  for (const name of ["kicker", "clock", "title", "sub", "cards", "waiting", "note", "decline", "submit"]) {
    assert.ok(slice.includes('data-slot="' + name + '"'), "抽屉缺槽位：" + name);
  }
  assert.ok(!html.includes('id="revealBar"'), "旧的顶部揭示条已删，只留一套抽屉");
});

test("抽屉外观复用传染那一套，旧的 reveal-bar 规则已删净", () => {
  assert.ok(/\.conspiracy-bar\s*\{/.test(css), "抽屉定位与外观来自 .conspiracy-bar");
  assert.ok(/\.conspiracy-card\s*\{/.test(css), "位置卡复用 .conspiracy-card");
  assert.ok(!/\.reveal-bar\b/.test(css), ".reveal-bar 已无对应元素，规则应删净");
  assert.ok(!/\.reveal-slot\b/.test(css), ".reveal-slot 同理");
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
  assert.equal(version, "salem-v23", "新模块进壳后 VERSION 必须是当前这一版，旧缓存才会整批作废");
  assert.ok(sw.includes('"/reveal-view.js"'), "SHELL 要收 /reveal-view.js");
  const cacheable = sw.slice(sw.indexOf("const cacheable"));
  assert.ok(cacheable.includes('"/reveal-view.js"'), "cacheable 列表也要收 /reveal-view.js");
});


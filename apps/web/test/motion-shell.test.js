import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const web = (...parts) => readFile(path.join(webDir, ...parts), "utf8");

test("游戏内有动效三档入口", async () => {
  const html = await web("index.html");
  assert.match(html, /id="motionToggle"/);
  assert.match(html, /aria-label="动效/);
  assert.match(html, /class="top-actions"/);
  assert.match(html, /id="logBtn"[^>]*>对局信息</);
});

test("app.js 接上 motion 与 keyed patch，手牌走 renderHand", async () => {
  const app = await web("app.js");
  assert.match(app, /from "\.\/motion\.js"/);
  assert.match(app, /from "\.\/render-patch\.js"/);
  assert.match(app, /function renderHand\(/);
  assert.match(app, /patchKeyed\(hand, items/);
  assert.match(app, /if \(isBlocked\(\)\) return;/);
  assert.match(app, /motionTimerWarn\(\$\("turnBadge"\)/);
  assert.match(app, /cycleMotionLevel\(\)/);
});

test("调度器只通过 dataset 暴露档位与 block", async () => {
  const motion = await web("motion.js");
  assert.match(motion, /document\.documentElement\.dataset\.motion = level/);
  assert.match(motion, /document\.documentElement\.dataset\.motionBlock = "1"/);
  assert.match(motion, /delete document\.documentElement\.dataset\.motionBlock/);
  assert.doesNotMatch(motion, /animationend/);
  assert.ok(motion.includes("isBlockingGroup"));
});

test("样式有 token、三档降级与 block 输入门", async () => {
  const css = await web("styles.css");
  assert.match(css, /--motion-fast:\s*120ms/);
  assert.match(css, /--motion-reveal:\s*600ms/);
  assert.match(css, /\[data-motion="reduced"\]/);
  assert.match(css, /\[data-motion="off"\]/);
  assert.match(css, /\[data-motion-block="1"\] #actionBar/);
  assert.match(css, /\.motion-fab/);
  assert.match(css, /\.top-actions/);
  assert.match(css, /\.log-btn/);
  assert.match(css, /z-index:\s*90/);
  assert.match(css, /height:\s*var\(--app-vh/);
});

test("移动端视口高度用 visualViewport 同步", async () => {
  const app = await web("app.js");
  assert.match(app, /function syncViewportHeight\(/);
  assert.match(app, /window\.visualViewport/);
  assert.match(app, /viewport\.height/);
  assert.match(app, /--app-vh/);
});

test("PWA 壳同步升级到 v17 并收进动效与音频模块", async () => {
  const sw = await web("sw.js");
  assert.match(sw, /const VERSION = "salem-v22"/);
  for (const file of ["/motion-events.js", "/motion-level.js", "/motion.js", "/render-patch.js", "/audio.js"]) {
    assert.ok(sw.includes('"' + file + '"'), file);
  }
  assert.match(sw, /"\/motion\.js",\s*"\/render-patch\.js",\s*"\/audio\.js",\s*"\/manifest\.webmanifest"/);
});


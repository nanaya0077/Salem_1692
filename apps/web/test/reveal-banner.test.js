import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");

function web(...parts) {
  return readFile(path.join(webDir, ...parts), "utf8");
}

/** 从 marker 之后第一个 { 起，按大括号配对截出函数体。 */
function bodyOf(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "找不到 " + marker);
  const first = source.indexOf("{", start);
  let depth = 0;
  for (let i = first; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(first, i + 1);
    }
  }
  return source.slice(first);
}

test("落地页与样式都给全桌提示留了挂点", async () => {
  const html = await web("index.html");
  assert.ok(html.includes('id="revealBanner"'));
  assert.ok(html.includes('id="revealBannerImage"'));
  assert.ok(html.includes('id="revealBannerKicker"'));
  assert.ok(html.includes('id="revealBannerTitle"'));
  const css = await web("styles.css");
  assert.match(css, /\.reveal-banner\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.reveal-banner\s*\{[^}]*top:\s*40%/);
});

test("只播新翻的牌：首次进入与换局都当作已读", async () => {
  const src = await web("app.js");
  const body = bodyOf(src, "function announceReveals()");
  assert.ok(body.includes("S.seenLog"));
  assert.ok(body.includes("log.length < S.seenLog"));
  assert.ok(body.includes('event?.type === "trialRevealed"'));
  assert.ok(body.includes("S.revealQueue.push"));
  assert.ok(body.includes("REVEAL_QUEUE_MAX"));
});

test("一次翻多张会排队，不会互相盖掉", async () => {
  const src = await web("app.js");
  const body = bodyOf(src, "function showNextReveal()");
  assert.ok(body.includes("S.revealQueue.shift()"));
  assert.ok(body.includes("REVEAL_BANNER_MS"));
  assert.ok(body.includes("scheduleNextReveal()"));
});

test("横幅纯展示不挡操作，重连与换局会清干净", async () => {
  const src = await web("app.js");
  const css = await web("styles.css");
  assert.match(css, /\.reveal-banner\s*\{[^}]*pointer-events:\s*none/);
  const reset = bodyOf(src, "function resetRoomState()");
  assert.ok(reset.includes("S.seenLog = null"));
  assert.ok(reset.includes("S.revealQueue = []"));
  assert.ok(reset.includes("clearTimeout(S.revealTimer)"));
  assert.ok(reset.includes("clearTimeout(S.revealDelay)"));
});

test("身份卡是双面 3D 翻牌，只给这次新翻的那张播动画", async () => {
  const src = await web("app.js");
  const body = bodyOf(src, "function trialStrip(");
  assert.ok(body.includes("trial-inner"));
  assert.ok(body.includes("trial-back"));
  assert.ok(body.includes("trial-front"));
  assert.ok(body.includes("flip-in"));
  assert.ok(body.includes("S.flipSeen"));
  const css = await web("styles.css");
  assert.ok(css.includes("transform-style: preserve-3d"));
  assert.ok(css.includes("backface-visibility: hidden"));
  assert.ok(css.includes("@keyframes trial-flip"));
  assert.ok(css.includes("prefers-reduced-motion"));
});

test("横幅文案走同一个纯函数，便于单测覆盖句式", async () => {
  const src = await web("app.js");
  assert.ok(src.includes("revealBannerText(event"));
  assert.ok(src.includes("nameOf: seatName"));
  assert.ok(src.includes("label: trialLabel"));
});

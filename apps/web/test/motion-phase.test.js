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

test("翻牌、揭示与死亡演出都是公开事件，且不 per-seat", async () => {
  const src = await web("app.js");
  const announce = bodyOf(src, "function announceReveals()");
  assert.ok(announce.includes('event?.type === "playerDied"'));
  assert.ok(announce.includes('event?.type === "matchmakerBroke"'));
  assert.ok(announce.includes("showDeath(deaths)"));
  const death = bodyOf(src, "function showDeath(");
  assert.ok(death.includes('playSfx("sfx.life.death")'));
  assert.ok(death.includes("startBlock(\"fx.life.death\""));
  assert.ok(death.includes("DEATH_MS"));
});

test("揭示队列最多 3 条，翻了牌再出横幅", async () => {
  const src = await web("app.js");
  const announce = bodyOf(src, "function announceReveals()");
  assert.ok(announce.includes("REVEAL_QUEUE_MAX"));
  assert.ok(announce.includes("S.revealQueue.push"));
  const show = bodyOf(src, "function showNextReveal()");
  const schedule = bodyOf(src, "function scheduleNextReveal()");
  assert.ok(schedule.includes("REVEAL_FLIP_MS"));
  assert.ok(show.includes("REVEAL_BANNER_MS"));
  assert.ok(show.includes("scheduleNextReveal()"));
});

test("死亡遮罩有独立骨架，且不会重复成两个 revealBanner", async () => {
  const html = await web("index.html");
  assert.equal((html.match(/id="revealBanner"/g) || []).length, 1);
  assert.ok(html.includes('id="deathOverlay"'));
  assert.ok(html.includes('id="deathKicker"'));
  assert.ok(html.includes('id="deathTitle"'));
  assert.ok(html.includes('id="deathText"'));
});

test("夜晚入场 600ms、黎明交叉 375ms、死亡 1200ms 与跳过回执都在", async () => {
  const src = await web("app.js");
  assert.ok(src.includes('startBlock("fx.phase.night"'));
  assert.ok(src.includes("duration: 600"));
  assert.ok(src.includes("cap: 900"));
  assert.ok(src.includes("startDawnCrossfade"));
  assert.ok(src.includes("375"));
  const bind = bodyOf(src, "function bind()");
  assert.ok(bind.includes('event.detail?.eventId === "fx.phase.night"'));
  assert.ok(bind.includes('event.detail?.eventId === "fx.life.death"'));
  assert.ok(bind.includes("hideDeath()"));
});

test("样式有夜晚星幕、死亡入画、横幅 1080 曲线与 reduced/off", async () => {
  const css = await web("styles.css");
  assert.ok(css.includes("@keyframes reveal-banner-cycle"));
  assert.ok(css.includes("reveal-banner-cycle 1080ms"));
  assert.ok(css.includes("reveal-banner-cycle-reduced 920ms"));
  assert.ok(css.includes("@keyframes fx-night-in"));
  assert.ok(css.includes("@keyframes fx-dawn-in"));
  assert.ok(css.includes("@keyframes fx-death-in"));
  assert.ok(css.includes(".night-sky"));
  assert.match(css, /\.death-veil\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.reveal-banner\s*\{[^}]*pointer-events:\s*none/);
  assert.ok(css.includes('[data-motion="off"] .death-veil.show .death-card'));
});

test("PWA 已升到 v17", async () => {
  const sw = await web("sw.js");
  assert.match(sw, /const VERSION = "salem-v20"/);
});


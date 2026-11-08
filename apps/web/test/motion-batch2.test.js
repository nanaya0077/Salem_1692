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

test("终局四段 240/400/300/280，总 1220ms，且不新增 block", async () => {
  const src = await web("app.js");
  assert.ok(src.includes("OVER_STEPS_FULL = [[\"1\", 0], [\"2\", 240], [\"3\", 640], [\"4\", 940]]"));
  assert.ok(src.includes("OVER_STEPS_REDUCED"));
  assert.ok(src.includes("S.overShown"));
  assert.ok(src.includes("function finishOverSequence()"));
  assert.ok(src.includes("function clearOverTimers()"));
  const over = bodyOf(src, "function renderOver(");
  assert.ok(over.includes("getMotionLevel() === \"off\""));
  assert.ok(over.includes("S.overTimers.push"));
  assert.ok(!over.includes("startBlock("), "终局不能新增 block");
  assert.ok(!over.includes("skip"), "终局没有跳过按钮/语义，点击直接落终态");
});

test("终局播放中任意点击落终态，重连首帧不重播", async () => {
  const src = await web("app.js");
  const bind = bodyOf(src, "function bind()");
  assert.ok(bind.includes('$("overOverlay").addEventListener("pointerdown"'));
  assert.ok(bind.includes("finishOverSequence()"));
  assert.ok(src.includes("if (suppress || getMotionLevel() === \"off\")"));
  assert.ok(src.includes("S.overShown = false"));
  assert.ok(src.includes("clearOverTimers()"));
});

test("指控成立只认服务端 trialRevealed.cause === accusation，不硬编码阈值", async () => {
  const src = await web("app.js");
  assert.ok(src.includes("const ACCUSE_UPHELD_MS = 420"));
  assert.ok(src.includes("const ACCUSE_UPHELD_MAX = 3"));
  assert.ok(src.includes('event?.type === "trialRevealed" && event.cause === "accusation"'));
  const announce = bodyOf(src, "function announceReveals()");
  assert.ok(announce.includes("showAccuseUpheld(accusations)"));
  const upheld = bodyOf(src, "function showAccuseUpheld(");
  assert.ok(upheld.includes("ACCUSE_UPHELD_MAX"));
  assert.ok(upheld.includes("offsetWidth"));
  assert.ok(upheld.includes("accuse-upheld"));
  assert.ok(!src.includes("thresholdFor"), "客户端不能重算 accuse 阈值");
});

test("终局与指控样式有独立骨架、减弱与关闭覆盖", async () => {
  const css = await web("styles.css");
  assert.ok(css.includes("@keyframes fx-over-curtain"));
  assert.ok(css.includes('.overlay.over[data-stage="2"]'));
  assert.ok(css.includes('.overlay.over[data-stage="3"]'));
  assert.ok(css.includes('.overlay.over[data-stage="4"]'));
  assert.ok(css.includes('.overlay.over[data-stage="4"] #overTitle'));
  assert.ok(css.includes("@keyframes fx-accuse-upheld"));
  assert.ok(css.includes(".seat-card.accuse-upheld::after"));
  assert.ok(css.includes('[data-motion="reduced"] .seat-card.accuse-upheld::after'));
  assert.ok(css.includes('[data-motion="off"] .seat-card.accuse-upheld::after'));
});

test("终局遮罩仍只有一份，入口与返回按钮都在", async () => {
  const html = await web("index.html");
  assert.equal((html.match(/id="overOverlay"/g) || []).length, 1);
  assert.ok(html.includes('id="overTitle"'));
  assert.ok(html.includes('id="overReason"'));
  assert.ok(html.includes('id="overRoles"'));
  assert.ok(html.includes('id="backLobby"'));
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, "..");
const repoDir = path.join(webDir, "..", "..");

const {
  MOTION_GROUPS,
  MOTION_MEMBER_BY_ID,
  BLOCKING_GROUP_IDS,
  motionGroup,
  eventDuration,
} = await import("../motion-events.js");
const { AUDIO_MANIFEST, SHORT_SFX_IDS } = await import("../audio.js");
const { CONSPIRACY_SWAP_PHASES, conspiracyStage } = await import("../conspiracy-view.js");

const appSource = await readFile(path.join(webDir, "app.js"), "utf8");
const htmlSource = await readFile(path.join(webDir, "index.html"), "utf8");
const cssSource = await readFile(path.join(webDir, "styles.css"), "utf8");
const swSource = await readFile(path.join(webDir, "sw.js"), "utf8");

/** 从 marker 后第一个 { 起按大括号配对截函数体，用来断言接线而不是断言整文件。 */
function bodyOf(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "找不到 " + marker);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error("函数体没有闭合: " + marker);
}

test("传染的四组演出在册，且没有新增 blocking", () => {
  const ids = MOTION_GROUPS.map((group) => group.id);
  for (const id of ["fx.phase.conspiracy", "fx.conspiracy.cat", "fx.conspiracy.pick", "fx.conspiracy.swap"]) {
    assert.ok(ids.includes(id), "缺组 " + id);
  }
  assert.deepEqual(BLOCKING_GROUP_IDS.slice().sort(), ["fx.life.death", "fx.phase.night"]);
});

test("换牌三拍相加正好等于组的 900ms", () => {
  const swap = MOTION_GROUPS.find((group) => group.id === "fx.conspiracy.swap");
  assert.equal(swap.duration, 900);
  assert.deepEqual(swap.phases, { curl: 200, fly: 450, drop: 250 });
  assert.equal(swap.phases.curl + swap.phases.fly + swap.phases.drop, swap.duration);
  assert.equal(CONSPIRACY_SWAP_PHASES.curl + CONSPIRACY_SWAP_PHASES.fly + CONSPIRACY_SWAP_PHASES.drop, 900);
});

test("成员级事件 id 也能取到组与时长", () => {
  assert.equal(motionGroup("fx.state.accuse")?.id, "fx.state.seat");
  assert.equal(eventDuration("fx.state.accuse"), 300);
  assert.equal(eventDuration("fx.card.conspiracy"), 500);
  assert.equal(eventDuration("fx.conspiracy.swap"), 900);
  assert.ok(MOTION_MEMBER_BY_ID.has("fx.card.conspiracy"));
});

test("抽到传染卡有一拍 500ms 的即弃，不是揭示", () => {
  const hand = MOTION_GROUPS.find((group) => group.id === "fx.card.hand");
  const member = hand.members.find((entry) => entry.id === "fx.card.conspiracy");
  assert.ok(member, "fx.card.hand 缺 fx.card.conspiracy 成员");
  assert.equal(member.duration, 500);
  assert.match(member.trigger, /传染/);
});

test("新增音效在清单里且文件不超过 40KB", async () => {
  assert.ok(AUDIO_MANIFEST["sfx.conspiracy.start"], "缺 sfx.conspiracy.start");
  assert.equal(AUDIO_MANIFEST["sfx.conspiracy.start"].kind, "sfx");
  assert.ok(SHORT_SFX_IDS.includes("sfx.conspiracy.start"));
  const info = await stat(path.join(repoDir, "assets", "audio", "sfx.conspiracy.start.mp3"));
  assert.ok(info.size > 0);
  assert.ok(info.size <= 40 * 1024, "短音效 ≤40KB");
});

test("印章图存在且被离线壳预缓存", async () => {
  const info = await stat(path.join(repoDir, "assets", "fx", "conspiracy-seal.svg"));
  assert.ok(info.size > 0);
  assert.match(swSource, /"\/assets\/fx\/conspiracy-seal\.svg"/);
  assert.match(swSource, /const VERSION = "salem-v20"/);
});

test("页面里有压暗、印章与换牌三个演出层", () => {
  assert.match(htmlSource, /id="conspiracyVeil"[^>]*class="conspiracy-veil"/);
  assert.match(htmlSource, /id="conspiracySeal"[^>]*class="conspiracy-seal"/);
  assert.match(htmlSource, /id="conspiracySwap"[^>]*class="conspiracy-swap"/);
  assert.match(htmlSource, /src="\/assets\/fx\/conspiracy-seal\.svg"/);
});

test("样式表给出三拍与三档降级", () => {
  assert.match(cssSource, /\.conspiracy-veil\b/);
  assert.match(cssSource, /\.conspiracy-veil\.on\b/);
  assert.match(cssSource, /\.conspiracy-seal\.on\b/);
  assert.match(cssSource, /\.conspiracy-swap-card\.fly\b/);
  assert.match(cssSource, /\.conspiracy-swap-card\.drop\b/);
  assert.match(cssSource, /\.trial-card\.conspiracy-peek \.trial-inner/);
  assert.match(cssSource, /@keyframes conspiracy-peek/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*conspiracy-veil/);
  assert.match(cssSource, /html\[data-level="reduced"\][\s\S]{0,240}conspiracy/);
  assert.match(cssSource, /html\[data-level="off"\][\s\S]{0,240}\.conspiracy-swap \{ display: none; \}/);
});

test("进场与退场把三层都收干净", () => {
  const enter = bodyOf(appSource, "function enterConspiracyStage()");
  assert.match(enter, /conspiracyVeil/);
  assert.match(enter, /conspiracySeal/);
  assert.match(enter, /sfx\.conspiracy\.start/);
  assert.match(enter, /haptic\("long"\)/);

  const leave = bodyOf(appSource, "function leaveConspiracyStage()");
  assert.match(leave, /classList\.remove\("on"\)/);
  assert.match(leave, /conspiracySwap/);

  const reset = bodyOf(appSource, "function resetRoomState()");
  assert.match(reset, /leaveConspiracyStage\(\)/);
  assert.match(reset, /S\.conspiracyShown = null/);
});

test("只在首次进场与换步时演出，每帧重绘不会重播", () => {
  const render = bodyOf(appSource, "function renderConspiracy()");
  assert.match(render, /conspiracyStage\(view, S\.conspiracyShown\)/);
  assert.match(render, /if \(stage\.enter\) enterConspiracyStage\(\)/);
  assert.match(render, /else if \(stage\.stepChanged\) playConspiracyStep\(\)/);
  assert.match(render, /S\.conspiracyShown = stage\.step/);
  assert.match(render, /leaveConspiracyStage\(\)/);
});

test("conspiracyStage 只回答该演哪一拍，不带隐藏信息", () => {
  assert.deepEqual(conspiracyStage(null, "cat"), { enter: false, step: null, stepChanged: false });
  assert.deepEqual(conspiracyStage({ step: "cat" }, null), { enter: true, step: "cat", stepChanged: false });
  assert.deepEqual(conspiracyStage({ step: "pick" }, "cat"), { enter: false, step: "pick", stepChanged: true });
  assert.deepEqual(conspiracyStage({ step: "pick" }, "pick"), { enter: false, step: "pick", stepChanged: false });
  const json = JSON.stringify(conspiracyStage({ step: "cat", candidates: [1, 2] }, null));
  assert.ok(!json.includes("candidates"));
});

test("换牌只演自己这一对，且降到 off 档完全不动", () => {
  const swap = bodyOf(appSource, "function playConspiracySwap()");
  assert.match(swap, /level === "off"\) return/);
  assert.match(swap, /data-swap="out"/);
  assert.match(swap, /data-swap="in"/);
  assert.match(swap, /haptic\("short"\)/);
  assert.match(swap, /sfx\.reveal\.flip/);
  assert.doesNotMatch(swap, /candidates|revealed|kind/);
});

test("换牌走公开日志的差量管道，日志文案不写在手牌上", () => {
  const announce = bodyOf(appSource, "function announceReveals()");
  assert.match(announce, /event\?\.type === "conspiracySwap"/);
  assert.match(announce, /playConspiracySwap\(\)/);
  assert.match(appSource, /取走一张身份卡/);
  assert.doesNotMatch(appSource, /取一张身份卡查看后洗回/);
});

test("触觉只在支持时调，且 off 档不调", async () => {
  const audio = await readFile(path.join(webDir, "audio.js"), "utf8");
  const haptic = bodyOf(audio, "export function haptic(mode)");
  assert.match(haptic, /level === "off"\) return false/);
  assert.match(haptic, /typeof navigator\.vibrate !== "function"\) return false/);
  assert.match(haptic, /try \{/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canSubmitConspiracy,
  conspiracyClockText,
  conspiracyClockWarn,
  conspiracyHeading,
  conspiracyNote,
  conspiracySlots,
  conspiracyWaitText,
  leftOfSeat,
} from "../conspiracy-view.js";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const read = (name) => readFileSync(join(web, name), "utf8");
const app = read("app.js");
const html = read("index.html");
const css = read("styles.css");
const sw = read("sw.js");
const shell = read("drawer-shell.js");

/** 从 marker 之后第一个 `{` 起按大括号配对截出函数体，用来断言「接线接上了」。 */
function bodyOf(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "找不到 " + marker);
  let depth = 0;
  let began = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      began = true;
    } else if (ch === "}") {
      depth -= 1;
      if (began && depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail("函数体没有闭合：" + marker);
}

const nameOf = (id) => "S" + id;

test("左邻与规则层同口径：座位号 +1 取模", () => {
  assert.equal(leftOfSeat(0, 4), 1);
  assert.equal(leftOfSeat(3, 4), 0);
  assert.equal(leftOfSeat(11, 12), 0);
  assert.equal(leftOfSeat(0, 0), null);
  assert.equal(leftOfSeat(null, 4), null);
});

test("cat 步点名的就是黑猫持有者本人面前那张", () => {
  const heading = conspiracyHeading({ step: "cat", catSeatId: 2, candidates: [0] }, { nameOf, seatId: 2, playerCount: 4 });
  assert.equal(heading.title, "选择要揭示的身份卡");
  assert.match(heading.sub, /S2/);
  assert.equal(heading.subjectId, 2);
});

test("pick 步把「左邻」翻成具体的人", () => {
  const heading = conspiracyHeading({ step: "pick", catSeatId: null, candidates: [0, 1] }, { nameOf, seatId: 5, playerCount: 12 });
  assert.equal(heading.title, "从左邻手里取一张身份卡");
  assert.match(heading.sub, /S6/);
  assert.equal(heading.subjectId, 6);
});

test("座位数组缺失时给通用文案，不点名错人", () => {
  const heading = conspiracyHeading({ step: "pick", candidates: [] }, { nameOf, seatId: 0, playerCount: 0 });
  assert.equal(heading.subjectId, null);
  assert.ok(heading.sub.length > 0);
  assert.ok(!heading.sub.includes("S1"));
});

test("位置槽把可选的与已揭示的合并成一条，已揭示的不可选", () => {
  const slots = conspiracySlots({ step: "pick", candidates: [0, 1, 3], revealed: [2] });
  assert.deepEqual(slots, [
    { index: 0, revealed: false, selectable: true },
    { index: 1, revealed: false, selectable: true },
    { index: 2, revealed: true, selectable: false },
    { index: 3, revealed: false, selectable: true },
  ]);
  assert.deepEqual(conspiracySlots(null), []);
});

test("只有候选里、且还没提交的位置才能提交", () => {
  const view = { step: "pick", submitted: false, candidates: [0, 2] };
  assert.equal(canSubmitConspiracy(view, 0), true);
  assert.equal(canSubmitConspiracy(view, 1), false);
  assert.equal(canSubmitConspiracy(view, null), false);
  assert.equal(canSubmitConspiracy({ ...view, submitted: true }, 0), false);
  assert.equal(canSubmitConspiracy(null, 0), false);
});

test("等待态只报人数，不泄露谁选了哪张", () => {
  const text = conspiracyWaitText({ step: "pick", submittedCount: 3, eligibleCount: 9 });
  assert.match(text, /3\/9/);
  assert.ok(!text.includes("#"));
  assert.equal(conspiracyWaitText({ step: "pick", submittedCount: 0, eligibleCount: 9 }), "已提交，等待其他玩家");
});

test("底部提示：未提交说还能改，提交后不再提撤销", () => {
  assert.match(conspiracyNote({ step: "pick", submitted: false }, 0), /已选 #1/);
  assert.equal(conspiracyNote({ step: "pick", submitted: false }, null), "");
  const done = conspiracyNote({ step: "pick", submitted: true }, 0);
  assert.ok(!done.includes("撤销"));
});

test("倒计时没有 deadline 时不显示数字", () => {
  assert.equal(conspiracyClockText(null, 1000), "");
  assert.equal(conspiracyClockText(55_000, 50_000), "5 秒");
  assert.equal(conspiracyClockText(40_000, 50_000), "0 秒");
});

test("落地页有阶段容器与全部子节点", () => {
  for (const id of ["conspiracyBar", "conspiracyTitle", "conspiracySub", "conspiracyClock", "conspiracyCards", "conspiracyWaiting", "conspiracyWaitText", "conspiracyNote", "conspiracySubmit"]) {
    assert.ok(html.includes('id="' + id + '"'), "index.html 缺 #" + id);
  }
});

test("app.js 接了渲染、提交与倒计时", () => {
  const render = bodyOf(app, "function renderConspiracy()");
  assert.ok(render.includes('S.projection?.phase === "conspiracy"'), "只在传染阶段开面板");
  assert.ok(render.includes("conspiracySlots(view)"), "位置槽走纯函数");
  assert.ok(render.includes("conspiracyWaitText(view)"), "等待态走纯函数");
  assert.ok(render.includes("canSubmitConspiracy(view, S.conspiracyPick)"), "提交可用性走纯函数");
  assert.ok(render.includes("updateConspiracyClock()"), "渲染完就刷新倒计时");

  const submit = bodyOf(app, '$("conspiracySubmit").addEventListener');
  assert.ok(submit.includes('kind: "conspiracyPick"'), "提交发 conspiracyPick");
  assert.ok(submit.includes("trialIndex"), "位置号随命令一起发");

  const clock = bodyOf(app, "function updateConspiracyClock()");
  assert.ok(clock.includes("S.room?.conspiracyDeadline"), "倒计时取房间上的 deadline");

  const timers = bodyOf(app, "function updateTimers()");
  assert.ok(timers.includes("updateConspiracyClock()"), "500ms 循环里要跟着走");

  const reset = bodyOf(app, "function resetRoomState()");
  assert.ok(reset.includes("S.conspiracyPick = null"), "换局清选中");
  assert.ok(reset.includes('$("conspiracyBar").hidden = true'), "换局关面板");
});

test("与挂起揭示条、出牌目标横幅互斥，且阶段内锁手牌", () => {
  const reveal = bodyOf(app, "function renderRevealBar()");
  assert.ok(reveal.includes('S.projection?.phase === "conspiracy"'), "传染期收起揭示条");
  const target = bodyOf(app, "function renderTargetBanner()");
  assert.ok(target.includes('S.projection?.phase === "conspiracy"'), "传染期收起目标横幅");
  const game = bodyOf(app, "function renderGame()");
  assert.ok(game.includes('p.phase === "conspiracy"'), "传染期锁手牌");
});

test("样式：抽屉、可滚动、12 人一屏", () => {
  assert.ok(css.includes(".conspiracy-bar"), "缺抽屉容器样式");
  assert.ok(css.includes("max-height: calc(100dvh - 32px)"), "面板不能超出视口");
  assert.ok(css.includes("grid-template-columns: repeat(auto-fit, minmax(52px, 1fr))"), "候选网格按 52px 折行");
  assert.ok(css.includes("min-height: 44px"), "提交按钮要够点");
});

test("倒计时最后 5 秒变金，没有 deadline 时不提醒", () => {
  const now = 1_000_000;
  assert.equal(conspiracyClockWarn(null, now), false, "线下模式没有 deadline");
  assert.equal(conspiracyClockWarn(undefined, now), false, "阶段刚起没有 deadline");
  assert.equal(conspiracyClockWarn(now + 12_000, now), false, "还剩 12 秒不提醒");
  assert.equal(conspiracyClockWarn(now + 6_000, now), false, "还剩 6 秒不提醒");
  assert.equal(conspiracyClockWarn(now + 5_000, now), true, "剩 5 秒开始提醒");
  assert.equal(conspiracyClockWarn(now + 2_000, now), true, "剩 2 秒继续提醒");
  assert.equal(conspiracyClockWarn(now, now), false, "已经到点就不再变金");
  assert.equal(conspiracyClockWarn(now - 3_000, now), false, "过期后不再变金");
});

test("倒计时变金接在同一处刷新里，样式也留了挂点", () => {
  assert.ok(app.includes("clockWarn: conspiracyClockWarn("), "每次刷新把 warn 交给壳");
  assert.ok(css.includes(".conspiracy-clock.warn"), "样式里有 .conspiracy-clock.warn");
  assert.ok(
    shell.includes('classList.toggle("warn", m.clockWarn === true)'),
    "壳里负责切 warn 类",
  );
});

test("新模块进离线壳", () => {
  assert.ok(sw.includes('"/conspiracy-view.js"'), "conspiracy-view.js 必须进 SHELL");
  assert.match(sw, /const VERSION = "salem-v21"/);
});

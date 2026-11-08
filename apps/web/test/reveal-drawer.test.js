import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  revealHeading,
  revealWaitModel,
  revealSubmitLabel,
  toggleRevealPick,
  canSubmitReveal,
} from "../reveal-view.js";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const app = readFileSync(join(web, "app.js"), "utf8");

/** 从 `marker` 起按大括号配对截出函数体，用来核对接线而不是执行页面。 */
function bodyOf(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, "找不到 " + marker);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error("大括号没配平：" + marker);
}

const nameOf = (id) => ({ 0: "阿比盖尔", 1: "机器人1" }[id] ?? null);

test("指控的标题带点数与门槛，嫁祸与诅咒不带", () => {
  const accused = revealHeading({ cause: "accusation", targetId: 1, threshold: 6 }, { nameOf, total: 6 });
  assert.equal(accused.kicker, "指控成立");
  assert.equal(accused.title, "机器人1 的身份卡 6 点（门槛 6）");
  assert.match(accused.sub, /选中后再点「选定」/);

  const scapegoat = revealHeading({ cause: "scapegoat", targetId: 1, threshold: null }, { nameOf, total: 9 });
  assert.equal(scapegoat.kicker, "嫁祸");
  assert.equal(scapegoat.title, "机器人1 的身份卡", "没有门槛时不能写「门槛 0」，也不能写点数");
});

test("等待模型点名谁在选、目标是谁，并复用同一条等待文案", () => {
  const wait = revealWaitModel(
    { chooserId: 0, targetId: 1, cause: "accusation", threshold: 6, accusationTotal: 6 },
    { nameOf },
  );
  assert.equal(wait.kicker, "指控成立");
  assert.equal(wait.title, "机器人1 的身份卡 6 点（门槛 6）");
  assert.match(wait.sub, /由 阿比盖尔 决定/);
  assert.equal(wait.waitText, "等待 阿比盖尔 选择揭示位置");
  assert.equal(revealWaitModel(null, { nameOf }), null, "没有等待态就该让调用方关掉抽屉");
});

test("按钮文案跟着选中位走，没选就是「选定」", () => {
  assert.equal(revealSubmitLabel(null), "选定");
  assert.equal(revealSubmitLabel(0), "选定（第 1 张）");
  assert.equal(revealSubmitLabel(4), "选定（第 5 张）");
});

test("再点同一张就取消，换成另一张则替换", () => {
  assert.equal(toggleRevealPick(null, 2), 2);
  assert.equal(toggleRevealPick(2, 2), null);
  assert.equal(toggleRevealPick(2, 3), 3);
  assert.equal(toggleRevealPick(2, null), 2, "非法的索引不该把已有选择清掉");
});

test("已提交、没选、选到已揭示位，都不许提交", () => {
  // 服务端给的是位置号字符串数组：hidden 可点，revealed 已翻开。
  const slots = ["revealed", "hidden"];
  assert.equal(canSubmitReveal({ slots, pick: null }, 0), false, "已揭示位不能选");
  assert.equal(canSubmitReveal({ slots, pick: null }, null), false);
  assert.equal(canSubmitReveal({ slots, pick: null }, 1), true);
  assert.equal(canSubmitReveal({ slots, pick: 1 }, 1), false, "服务端已经记下选择，别重复提交");
  assert.equal(canSubmitReveal(null, 1), false);
});

test("两步选定：点位置只改本地选中，点「选定」才发 reveal", () => {
  const handler = bodyOf(app, '$("revealDrawer").addEventListener("click"');
  assert.match(handler, /S\.revealPick = toggleRevealPick\(S\.revealPick, index\)/, "点位置只动本地选中");
  assert.match(handler, /renderRevealDrawer\(\)/);
  assert.ok(!/data-reveal-index[\s\S]{0,200}act\(/.test(handler), "点位置不能直接提交");
  assert.match(handler, /act\(\{ kind: "reveal", trialIndex: S\.revealPick \}\)/, "提交走选定键");
  assert.match(handler, /act\(\{ kind: "decline" \}\)/, "放弃仍走 decline");
});

test("抽屉把模型交给共享壳，不自己摸标题与卡片的 DOM", () => {
  const body = bodyOf(app, "function renderRevealDrawer()");
  assert.match(body, /applyDrawerModel\(bar, \{/);
  assert.match(body, /setDrawerOpen\(bar, true\)/);
  assert.ok(!/\$\("revealTitle"\)/.test(body), "标题走槽位，不再逐个取元素");
  assert.ok(!/\$\("revealCards"\)\.innerHTML/.test(body), "卡片内容也走槽位");
  assert.match(body, /S\.projection\?\.phase === "conspiracy"[\s\S]{0,120}setDrawerOpen\(bar, false\)/, "与传染互斥");
});

test("时钟读回合剩余，最后 5 秒才告警", () => {
  const body = bodyOf(app, "function updateRevealClock()");
  assert.match(body, /S\.private\?\.turnDeadline/);
  assert.match(body, /clockWarn: left !== null && left <= 5000/);
  assert.match(body, /left === null \? ""/, "没有回合时限就整块隐藏，别显示 0 秒");
});

test("压暗与目标描边是自己的层，不复用传染那套 veil", () => {
  const css = readFileSync(join(web, "styles.css"), "utf8");
  const html = readFileSync(join(web, "index.html"), "utf8");
  assert.ok(html.includes('id="revealVeil"'), "index.html 要有自己的压暗层");
  assert.ok(/\.reveal-veil\s*\{/.test(css), "压暗层要有着色与 backdrop-filter");
  assert.match(css, /backdrop-filter: brightness\(\.6\) saturate\(\.8\)/, "#65 定稿的压暗值");
  assert.ok(/\.reveal-target\s*\{/.test(css), "目标座位要有金色描边类");
  const body = bodyOf(app, "function setRevealStage(");
  assert.match(body, /revealVeil/, "压暗层由 setRevealStage 开关");
  assert.match(body, /reveal-target/, "描边也在这里挂");
  assert.match(bodyOf(app, "function renderRevealDrawer()"), /setRevealStage\(true, view\.targetId\)/, "选择者打开时把目标座位点亮");
});

test("12 人 3 张卡不再被撑大：固定 60px 居中", () => {
  const css = readFileSync(join(web, "styles.css"), "utf8");
  assert.match(css, /#revealDrawer \.conspiracy-cards \{[^}]*display: flex/, "位置卡改 flex");
  assert.match(css, /#revealDrawer \.conspiracy-card \{[^}]*flex: 0 0 60px/, "固定 60px，不随容器拉伸");
  assert.ok(!/#revealDrawer \.conspiracy-cards \{[^}]*auto-fit/.test(css), "不能再留 auto-fit");
});
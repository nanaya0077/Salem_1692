import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "..", "app.js"), "utf8");
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const css = readFileSync(join(here, "..", "styles.css"), "utf8");
const catalog = JSON.parse(readFileSync(join(here, "..", "..", "..", "assets", "cards", "cards.zh.json"), "utf8"));

// 从 marker 之后第一个 "{" 起取整段函数体；marker 要把参数表里的默认值 {} 一并带上，
// 否则会把参数里的那对空括号当成函数体。
function bodyOf(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "找不到 " + marker);
  const open = source.indexOf("{", start + marker.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(marker + " 的大括号没闭合");
}

test("自己那排写上本次角色的技能效果", () => {
  assert.ok(app.includes("selfAbilityLine(my.role)"), "自己面板要带上本次选的角色的技能文案");
  const body = bodyOf(app, "function selfAbilityLine(role) ");
  assert.ok(body.includes("roleAbility(role)"), "技能行与角色卡浮层共用同一个取文案的函数");
  assert.ok(body.includes('self-ability'), "技能行要有自己的 class，否则和角色名挤成一行");
  assert.ok(css.includes(".self-ability"), "技能行的样式要在样式表里");
});

test("技能文案只从卡牌资源取一份，不另抄副本", () => {
  const body = bodyOf(app, "function roleAbility(id) ");
  assert.ok(body.includes("S.cards.get(id)?.text"), "技能文案来自整份下发的卡牌资源");
  const identity = (catalog.cards ?? []).filter((card) => card.kind === "identity");
  assert.equal(identity.length, 15, "角色卡张数变了就要一起看这里");
  const missing = identity.filter((card) => !card.text || !String(card.text).trim()).map((card) => card.id);
  assert.deepEqual(missing, [], "每个角色卡都要有技能文案，否则点开是一张读不出效果的卡");
});

test("没有出牌目标时点别人是查看角色卡，不是没反应", () => {
  const body = bodyOf(app, "function onSeatClick(id) ");
  const guard = body.indexOf("if (!S.pending)");
  assert.ok(guard >= 0, "onSeatClick 要先分出「没有待出牌」这条路径");
  assert.ok(body.slice(guard, guard + 120).includes("openRoleInfo(id)"), "没有出牌目标时点座位要打开角色卡");
  const locked = body.indexOf("revealLocked()");
  assert.ok(guard < locked, "查看信息不该被揭示挂起挡住");
});

test("点自己的面板：身份卡开卡详情，空白处开角色卡", () => {
  const body = bodyOf(app, '$("selfPanel").addEventListener("click", (event) => ');
  const trial = body.indexOf("[data-trial]");
  const role = body.indexOf("openRoleInfo(S.seatId)");
  assert.ok(trial >= 0 && body.includes("openTrialModal"), "点身份卡仍走身份卡详情");
  assert.ok(role >= 0, "点自己面板空白处要打开自己的角色卡");
  assert.ok(trial < role, "身份卡要先判，否则点卡会落到角色卡上");
  assert.ok(
    !app.includes('$("selfPanel").addEventListener("click", openProfile)'),
    "自己面板不该再挂第二个 click 去开资料编辑，那正是与身份卡打架的原因",
  );
});

test("开局后不再让改昵称与头像", () => {
  const body = bodyOf(app, "function openProfile() ");
  assert.ok(body.includes('phase !== "lobby"'), "对局进行中要挡住资料编辑");
  assert.ok(body.includes("toast("), "挡住时要给一句人话，不能静默失效");
  assert.ok(
    app.includes('$("openProfileLanding").addEventListener("click", openProfile)'),
    "落地页仍要能改资料",
  );
  assert.ok(
    app.includes('if (event.target.closest("[data-profile]")) openProfile();'),
    "大厅座位上的改资料入口保留",
  );
});

test("角色卡浮层只读：有牌面、有状态行、能关掉，且不发消息", () => {
  assert.ok(html.includes('id="roleModal"'), "角色卡浮层要在页面里");
  for (const id of ["roleImage", "roleKicker", "roleTitle", "roleText", "roleMeta"]) {
    assert.ok(html.includes('id="' + id + '"'), "浮层缺了 " + id);
  }
  assert.ok(html.includes("data-close-role"), "浮层要有关闭入口");
  const body = bodyOf(app, "function openRoleInfo(seatId) ");
  assert.ok(body.includes('$("roleImage")'), "牌面要真的塞进浮层，不能只写名字");
  assert.ok(body.includes("seatMetaText"), "存活、指控与身份卡进度要一起给");
  assert.ok(!body.includes("send("), "角色卡是只读的，不该往服务端发东西");
  assert.ok(!body.includes("act("), "角色卡不该触发对局动作");
  assert.ok(
    app.includes('document.querySelectorAll("[data-close-role]")'),
    "关闭按钮要接上 closeRoleInfo",
  );
});

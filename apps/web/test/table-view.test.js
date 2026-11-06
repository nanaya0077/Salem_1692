import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TRIAL_LABELS, compactRoleName, seatRoleView, trialLabel } from "../table-view.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_SOURCE = readFileSync(join(HERE, "..", "app.js"), "utf8");
const SHEET = readFileSync(join(HERE, "..", "styles.css"), "utf8");

// 缝：桌面展示层的纯函数模块（apps/web/table-view.js）。
// 只断言「座位上写什么字」，不碰 DOM、不发消息。

const lookup = (map) => (role) => map[role] ?? null;

const NAMES = {
  tituba: "蒂图巴",
  "george-burroughs": "乔治·伯勒斯",
  "william-phipps": "威廉·菲普斯",
  "will-griggs": "威尔·格里格斯",
};

test("开局即见：座位上有角色就给出角色名，不需要等终局公开", () => {
  const view = seatRoleView({ id: 3, role: "tituba", alive: true }, lookup(NAMES));
  assert.equal(view.full, "蒂图巴");
  assert.equal(view.compact, "蒂图巴");
});

test("死亡玩家仍然显示角色，灰化交给样式而不是删字", () => {
  const alive = seatRoleView({ id: 3, role: "tituba", alive: true }, lookup(NAMES));
  const dead = seatRoleView({ id: 3, role: "tituba", alive: false }, lookup(NAMES));
  assert.deepEqual(dead, alive);
});

test("带分隔符的角色名在窄卡上压成短名，全名留给悬停与读屏", () => {
  const view = seatRoleView({ role: "george-burroughs" }, lookup(NAMES));
  assert.equal(view.full, "乔治·伯勒斯");
  assert.equal(view.compact, "乔治");
});

test("短名只切掉「·」后缀，不做其他缩写：威尔与威廉仍分得清", () => {
  assert.equal(compactRoleName("威廉·菲普斯"), "威廉");
  assert.equal(compactRoleName("威尔·格里格斯"), "威尔");
  assert.equal(compactRoleName("蒂图巴"), "蒂图巴");
  assert.equal(compactRoleName("·前导"), "·前导");
  assert.equal(compactRoleName(""), "");
});

test("卡牌资源没加载时回落到角色 id，不显示空白", () => {
  const view = seatRoleView({ role: "tituba" }, () => null);
  assert.equal(view.full, "tituba");
  assert.equal(view.compact, "tituba");
});

test("没有角色的人写「无角色」，而不是留空或显示 none", () => {
  assert.deepEqual(seatRoleView({ role: "none" }, lookup(NAMES)), { full: "无角色", compact: "无角色" });
  assert.deepEqual(seatRoleView({}, lookup(NAMES)), { full: "无角色", compact: "无角色" });
  assert.deepEqual(seatRoleView(null, lookup(NAMES)), { full: "无角色", compact: "无角色" });
});

test("身份卡称呼用「警长」，与卡牌资源一致", () => {
  assert.equal(trialLabel("constable"), "警长");
  assert.equal(trialLabel("witch"), "女巫");
  assert.equal(trialLabel("townspeople"), "平民");
  assert.equal(TRIAL_LABELS.constable, "警长");
});

test("座位模板真的把角色行画出来：接线、标记与样式都在", () => {
  assert.ok(APP_SOURCE.includes('from "./table-view.js"'), "app.js 应当从 table-view.js 取文案");
  assert.ok(APP_SOURCE.includes("seatRoleView(player, roleCardName)"), "座位要用 seatRoleView 算角色行");
  assert.ok(APP_SOURCE.includes('class="seat-role" title='), "座位模板要画出 .seat-role 并带全名 title");
  assert.ok(SHEET.includes(".seat-role {"), "样式表要有 .seat-role 的行高与截断");
});

test("身份卡类型缺失按平民算，未知类型原样透出便于排查", () => {
  assert.equal(trialLabel(undefined), "平民");
  assert.equal(trialLabel(null), "平民");
  assert.equal(trialLabel("elder"), "elder");
});

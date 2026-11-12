import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEATH_CAUSE_LABELS,
  ERROR_REASON_LABELS,
  TRIAL_LABELS,
  canPlayHandCard,
  compactRoleName,
  copiedRoleNote,
  deathCauseLabel,
  effectiveRoleOf,
  errorReasonLabel,
  seatRoleView,
  seatTargetState,
  trialLabel,
} from "../table-view.js";

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

test("死因码与规则错误码都有中文标签，不把内部英文原样抛给玩家", () => {
  assert.equal(deathCauseLabel("witch-revealed"), "女巫身份暴露");
  assert.equal(deathCauseLabel("all-trials-revealed"), "身份卡全部揭示");
  assert.equal(deathCauseLabel("no-unrevealed-trial"), "无未揭示身份卡");
  assert.equal(deathCauseLabel("night-kill"), "夜晚遇害");
  assert.equal(deathCauseLabel("matchmaker"), "情侣殉情");
  assert.equal(deathCauseLabel("no-trials"), "失去全部身份卡");
  assert.equal(deathCauseLabel("saved"), "平安获救");
  assert.equal(deathCauseLabel(""), "死亡");
  assert.equal(Object.keys(DEATH_CAUSE_LABELS).length >= 7, true);

  assert.equal(errorReasonLabel("piety:red-immunity"), "目标面前有「信徒」，不能对其打出红卡");
  assert.equal(errorReasonLabel("curse:no-blue-card"), "目标面前没有蓝卡，不能打出「诅咒」");
  assert.equal(errorReasonLabel("matchmaker:duplicate"), "目标面前已有「情侣」，不能重复放置");
  assert.equal(errorReasonLabel("action-already-taken"), "本回合已行动，请结束回合");
  assert.equal(errorReasonLabel("unknown-code", "自定义中文提示"), "自定义中文提示");
  assert.equal(errorReasonLabel("unknown-code", "unknown-code"), "操作失败");
  assert.equal(Object.keys(ERROR_REASON_LABELS).length >= 30, true);
});

test("玛莎·科里按座位号递减方向复制右邻第一个存活非玛莎角色", () => {
  const seats = [
    { id: 0, role: "martha-corey", alive: true },
    { id: 1, role: "samuel-parris", alive: true },
    { id: 2, role: "tituba", alive: false },
    { id: 3, role: "will-griggs", alive: true },
  ];
  // 座位 0 的右邻（递减取模）依次是 3（存活，威尔·格里格斯）、2（死亡）、1（存活）。
  assert.equal(effectiveRoleOf(seats, 0), "will-griggs");
  assert.equal(copiedRoleNote(seats, 0, lookup(NAMES)), "复制：威尔·格里格斯");
  assert.equal(copiedRoleNote(seats, 1, lookup(NAMES)), "");

  // 若座位 3 也出局，座位 2 已死，继续往右找座位 1（塞缪尔·帕里斯）。
  const seatsAfter = seats.map((s) => (s.id === 3 ? { ...s, alive: false } : s));
  assert.equal(effectiveRoleOf(seatsAfter, 0), "samuel-parris");
});

test("手牌打出与座位目标预校验：拦截已行动、信徒免红、无蓝卡诅咒、重复情侣与双目标来源", () => {
  const projection = {
    phase: "action",
    currentPlayerId: 0,
    actionTaken: false,
    pendingReveal: null,
    self: {
      id: 0,
      role: "martha-corey",
      alive: true,
      hand: ["accusation", "curse", "matchmaker", "alibi", "robbery"],
    },
    seats: [
      { id: 0, role: "martha-corey", alive: true, blue: [], accusations: 0, accusationsCards: [] },
      { id: 1, role: "tituba", alive: true, blue: ["piety"], accusations: 0, accusationsCards: [] },
      { id: 2, role: "will-griggs", alive: true, blue: ["matchmaker"], accusations: 1, accusationsCards: ["accusation"] },
    ],
  };

  // 本回合已行动：不可再打手牌
  assert.deepEqual(
    canPlayHandCard({ ...projection, actionTaken: true }, 0, "accusation", { color: "red", target: "other" }),
    { ok: false, reason: "action-already-taken", message: "本回合已行动，请结束回合" },
  );

  // 红卡：座位 1 有信徒不可选，座位 2 无信徒可选
  const redPending = { cardId: "accusation", stage: "target", sourceId: null };
  assert.equal(seatTargetState(projection, 0, redPending, { color: "red", target: "other" }, 1).selectable, false);
  assert.equal(seatTargetState(projection, 0, redPending, { color: "red", target: "other" }, 1).reason, "piety:red-immunity");
  assert.equal(seatTargetState(projection, 0, redPending, { color: "red", target: "other" }, 2).selectable, true);

  // 玛莎复制座位 2（威尔·格里格斯）：可把辩护当目击打出，且同样受「信徒」限制
  assert.equal(
    canPlayHandCard(projection, 0, "alibi", { color: "green", target: "other" }, { asWitness: true }).ok,
    true,
  );
  const witnessPending = { cardId: "alibi", asWitness: true, stage: "target", sourceId: null };
  assert.equal(seatTargetState(projection, 0, witnessPending, { color: "green", target: "other" }, 1).reason, "piety:red-immunity");

  // 情侣：座位 2 已有情侣不可重复放，座位 1 可放
  const mmPending = { cardId: "matchmaker", stage: "target", sourceId: null };
  assert.equal(seatTargetState(projection, 0, mmPending, { color: "blue", target: "other" }, 2).selectable, false);
  assert.equal(seatTargetState(projection, 0, mmPending, { color: "blue", target: "other" }, 1).selectable, true);

  // 辩护（普通用法）：座位 1 没有红卡不可选，座位 2 有 1 张指控可选
  const alibiPending = { cardId: "alibi", asWitness: false, stage: "target", sourceId: null };
  assert.equal(seatTargetState(projection, 0, alibiPending, { color: "green", target: "other" }, 1).reason, "alibi:no-red-card");
  assert.equal(seatTargetState(projection, 0, alibiPending, { color: "green", target: "other" }, 2).selectable, true);

  // 双目标卡（抢劫）：选定座位 1 为来源后，座位 1 标记为 isSource 且不可再作为目标
  const robTargetPending = { cardId: "robbery", stage: "target", sourceId: 1 };
  const s1 = seatTargetState(projection, 0, robTargetPending, { color: "green", target: "two" }, 1);
  assert.equal(s1.selectable, false);
  assert.equal(s1.isSource, true);
  const s2 = seatTargetState(projection, 0, robTargetPending, { color: "green", target: "two" }, 2);
  assert.equal(s2.selectable, true);
  assert.equal(s2.isSource, false);
});

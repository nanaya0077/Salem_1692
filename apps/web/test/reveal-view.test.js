import test from "node:test";
import assert from "node:assert/strict";
import {
  slotView,
  canDecline,
  revealWaitText,
  actionsLocked,
  revealLogText,
} from "../reveal-view.js";

// 缝：挂起揭示的展示语义。全是纯函数：页面只把投影 / 协议消息喂进来，把结果画出去。

const nameOf = (id) => ({ 1: "安妮·普特南", 2: "约翰·普罗克特" })[id] ?? null;
const label = (kind) => ({ witch: "女巫", constable: "警长", townspeople: "平民" })[kind] ?? kind;

test("位置条按目标面前的身份卡张数渲染，已揭示的位置不可点", () => {
  assert.deepEqual(slotView(["hidden", "revealed", "hidden"]), [
    { index: 0, revealed: false, disabled: false, label: "第 1 张" },
    { index: 1, revealed: true, disabled: true, label: "已揭示" },
    { index: 2, revealed: false, disabled: false, label: "第 3 张" },
  ]);
  assert.deepEqual(slotView(undefined), []);
  assert.deepEqual(slotView([]), []);
});

test("只有服务端说可放弃时才给放弃按钮", () => {
  assert.equal(canDecline({ canDecline: true }), true);
  assert.equal(canDecline({ canDecline: false }), false);
  assert.equal(canDecline(null), false);
});

test("其他人看到「等待 X 选择」，没有挂起态时什么都不显示", () => {
  assert.equal(revealWaitText({ chooserId: 1, targetId: 2 }, nameOf), "等待 安妮·普特南 选择揭示位置");
  // 名字没同步到也不许空着。
  assert.equal(revealWaitText({ chooserId: 9, targetId: 2 }, nameOf), "等待 座位 9 选择揭示位置");
  assert.equal(revealWaitText(null, nameOf), "");
});

test("挂起期任何人都不能抽牌/出牌/结束回合：选择者与旁观者都锁", () => {
  assert.equal(actionsLocked({ pendingReveal: { slots: [] }, revealWait: null }), true);
  assert.equal(actionsLocked({ pendingReveal: null, revealWait: { chooserId: 1 } }), true);
  assert.equal(actionsLocked({ pendingReveal: null, revealWait: null }), false);
});

test("日志写清谁翻的：X 由 Y 选择翻开了一张身份卡（女巫）", () => {
  const event = { type: "trialRevealed", playerId: 2, kind: "witch", cause: "accusation", chooserId: 1 };
  assert.equal(revealLogText(event, { nameOf, label }), "约翰·普罗克特 由 安妮·普特南 选择翻开了一张身份卡（女巫）。");
});

// 自动与否是事件自带的字段（规则层在服务端代翻时写死），客户端不再数日志对位。
test("事件带 auto 时同一句里点明是自动取的第一个位置", () => {
  const event = { type: "trialRevealed", playerId: 2, kind: "constable", cause: "accusation", chooserId: 1, auto: true };
  const text = revealLogText(event, { nameOf, label });
  assert.ok(text.includes("约翰·普罗克特 由 安妮·普特南 选择翻开了一张身份卡（警长）"), text);
  assert.ok(text.includes("自动") && text.includes("第一个位置"), text);
});

test("事件没有 auto（或 auto: false）时不加自动后缀，同局其它揭示也不受牵连", () => {
  const plain = { type: "trialRevealed", playerId: 2, kind: "witch", cause: "accusation", chooserId: 1 };
  const explicit = { ...plain, auto: false };
  const expected = "约翰·普罗克特 由 安妮·普特南 选择翻开了一张身份卡（女巫）。";
  assert.equal(revealLogText(plain, { nameOf, label }), expected);
  assert.equal(revealLogText(explicit, { nameOf, label }), expected);
});

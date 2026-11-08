/**
 * 底部抽屉的共享外壳：只管「槽位」与「怎么把一份模型写进槽位」，
 * 不管内容从哪来、也不碰任何阶段逻辑。
 *
 * 抽壳的动机是传染、挂起揭示、以及后面的自首都用同一套选卡交互（压暗桌面、
 * 拇指区选位置、两步选定、等待层），三份各写一遍必然会漂。
 *
 * 槽位契约是这一层的全部约定：谁要接抽屉，就在自己的根元素里摆好这些
 * `data-slot`，然后调 `applyDrawerModel`。槽位之外的东西（印章、换牌三拍、
 * 压暗层）**不属于壳**，由各阶段自己挂。
 *
 * 这一层是纯 DOM 操作，不 import 任何东西，也不读全局状态。
 */

/** 槽位清单。顺序即文档顺序，测试按它逐个核对元素存在。 */
export const DRAWER_SLOTS = Object.freeze([
  "head",
  "kicker",
  "clock",
  "title",
  "sub",
  "body",
  "cards",
  "waiting",
  "waitText",
  "note",
  "foot",
  "decline",
  "submit",
]);

/** 取某个槽位；root 里没有这个槽就返回 null，调用方据此跳过。 */
export function drawerSlot(root, name) {
  if (!root || typeof name !== "string" || name === "") return null;
  return root.querySelector('[data-slot="' + name + '"]');
}

/** 实际摆在 root 里的槽位名（按文档顺序）。用来核对契约有没有落实。 */
export function drawerSlots(root) {
  if (!root) return [];
  return [...root.querySelectorAll("[data-slot]")].map((el) => el.dataset.slot);
}

/**
 * 把一份模型写进槽位。模型里没给的字段一律不动——
 * 这样倒计时可以只传 clockText，不必把整份内容重写一遍。
 *
 * 字段：
 *   kicker / title / sub / note   → 纯文本
 *   cardsHtml                     → 直接写 innerHTML（选卡按钮由调用方拼）
 *   cardsHidden                   → 收起选卡区（已提交、或非选择者）
 *   waiting / waitText            → 等待层显隐与文案
 *   submitLabel / submitDisabled  → 主按钮
 *   clockText / clockWarn         → 时钟；空串等于隐藏，最后 5 秒由调用方给 warn
 */
export function applyDrawerModel(root, model) {
  if (!root) return root;
  const m = model ?? {};
  const text = (name, value) => {
    if (value == null) return;
    const el = drawerSlot(root, name);
    if (el) el.textContent = String(value);
  };
  const show = (name, visible) => {
    if (visible == null) return;
    const el = drawerSlot(root, name);
    if (el) el.hidden = visible !== true;
  };

  text("kicker", m.kicker);
  text("title", m.title);
  text("sub", m.sub);
  text("note", m.note);

  const cards = drawerSlot(root, "cards");
  if (cards) {
    if (typeof m.cardsHtml === "string") cards.innerHTML = m.cardsHtml;
    if (m.cardsHidden != null) cards.hidden = m.cardsHidden === true;
  }

  show("waiting", m.waiting);
  text("waitText", m.waitText);

  const submit = drawerSlot(root, "submit");
  if (submit) {
    if (m.submitLabel != null) submit.textContent = String(m.submitLabel);
    if (m.submitDisabled != null) submit.disabled = m.submitDisabled === true;
  }

  // 「放弃」只有挂起揭示才有：壳只负责显隐与文案，什么时候给得起由规则层（canDecline）说。
  const decline = drawerSlot(root, "decline");
  if (decline) {
    if (m.declineVisible != null) decline.hidden = m.declineVisible !== true;
    if (m.declineLabel != null) decline.textContent = String(m.declineLabel);
  }

  const clock = drawerSlot(root, "clock");
  if (clock) {
    if (m.clockText != null) {
      clock.textContent = String(m.clockText);
      clock.hidden = m.clockText === "";
    }
    if (m.clockWarn != null) clock.classList.toggle("warn", m.clockWarn === true);
  }

  return root;
}

/** 抽屉开合。壳只认 hidden 属性，动画与层叠留给样式。 */
export function setDrawerOpen(root, open) {
  if (root) root.hidden = open !== true;
  return root;
}

export function isDrawerOpen(root) {
  return Boolean(root) && root.hidden === false;
}

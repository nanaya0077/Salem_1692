/**
 * 挂起揭示的展示语义：位置条、放弃按钮、等待文案、日志句式。
 *
 * 纯函数、不碰 DOM、不 import 任何东西——页面里画出来的与 `node --test` 跑的是同一份。
 *
 * 两条信息来自不同地方，别混：
 * - 选择者自己的挂起态在 `projection.pendingReveal`（带 slots / canDecline，只发给选择者本人）；
 * - 其他人的「有人在选位置」在 projection 消息顶层的 `revealWait`（只有 chooserId / targetId）。
 */

const HIDDEN = "hidden";

/** 服务端只给位置号：`["hidden", "revealed", ...]` → 位置按钮的展示模型。 */
export function slotView(slots) {
  if (!Array.isArray(slots)) return [];
  return slots.map((slot, index) => {
    const revealed = slot !== HIDDEN;
    // 位置号只用来定位按钮（规格决策 18：判定一律点数口径，不出现「第几张」）。
    return { index, revealed, disabled: revealed };
  });
}

/** 「放弃」只在规则层允许时才出现（丹福斯对普通玩家的第 6 点）。 */
export function canDecline(view) {
  return view?.canDecline === true;
}

function seatLabel(id, nameOf) {
  const name = typeof nameOf === "function" ? nameOf(id) : null;
  const text = typeof name === "string" ? name.trim() : "";
  return text || "座位 " + id;
}

/** 非选择者看到的等待条；没有挂起态返回空串，调用方据此隐藏整条。 */
export function revealWaitText(wait, nameOf) {
  if (!wait) return "";
  return "等待 " + seatLabel(wait.chooserId, nameOf) + " 选择揭示位置";
}

/**
 * 挂起期抽牌 / 出牌 / 结束回合都会被规则层拒掉（reason: reveal-pending），
 * 选择者本人也一样，所以两种信号都算锁。
 */
export function actionsLocked(state) {
  return Boolean(state?.pendingReveal || state?.revealWait);
}

/**
 * 日志句：「X 由 Y 选择翻开了一张身份卡（女巫）」；自动代翻时补一句说清取了第一个位置。
 * 是否自动只认事件本身（规则层写的 `auto` 字段），不在客户端另算一遍对位。
 */
export function revealLogText(event, options = {}) {
  const { nameOf, label } = options;
  const auto = event?.auto === true;
  const who = seatLabel(event?.playerId, nameOf);
  const chooser = seatLabel(event?.chooserId, nameOf);
  const kind = typeof label === "function" ? label(event?.kind) : event?.kind;
  const name = kind ?? "身份卡";
  // 传染与自首是规则层直接翻的（已知偏差），没有「谁选了位置」这回事：
  // 传染的 chooserId 是抽牌者、自首的 chooserId 是自己，照抄「由谁选择」会写出假话。
  if (event?.cause === "conspiracy") return who + " 被传染：翻开了一张身份卡（" + name + "）。";
  if (event?.cause === "confession") return who + " 自首，翻开了自己一张身份卡（" + name + "）。";
  let text = who + " 由 " + chooser + " 选择翻开了一张身份卡（" + name + "）。";
  if (auto) text += "（超时或托管，自动取了第一个位置。）";
  return text;
}

/**
 * 全桌横幅：翻开身份卡是公开事件，每个人都要在当场看到「翻了谁的、翻出的是什么」，
 * 而不是事后自己去翻日志。返回 { kicker, title }，title 就是身份卡类别（女巫 / 平民 / 警长）。
 */
export function revealBannerText(event, options = {}) {
  const { nameOf, label } = options;
  const who = seatLabel(event?.playerId, nameOf);
  const chooser = seatLabel(event?.chooserId, nameOf);
  const kind = typeof label === "function" ? label(event?.kind) : event?.kind;
  const title = kind ?? "身份卡";
  if (event?.cause === "conspiracy") return { kicker: who + " 被传染，翻开一张身份卡", title };
  if (event?.cause === "confession") return { kicker: who + " 自首，翻开自己一张身份卡", title };
  const auto = event?.auto === true ? "（自动取了第一个位置）" : "";
  return { kicker: chooser + " 翻开了 " + who + " 的身份卡" + auto, title };
}


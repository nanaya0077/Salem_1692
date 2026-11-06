/**
 * 桌面展示层的「写什么字」：座位上的角色行与身份卡标签。
 *
 * 纯函数、不碰 DOM、不 import 任何东西：页面脚本接线之后，浏览器与 `node --test`
 * 跑的是同一份实现。角色名与卡名仍以 assets/cards 为准，这里只负责「没有名字时怎么办」
 * 与「窄卡上写多短」。
 */

/** 身份卡类型的展示名；与 assets/cards/cards.zh.json 里 trial 三张卡的 name 一致。 */
export const TRIAL_LABELS = Object.freeze({
  witch: "女巫",
  constable: "警长",
  townspeople: "平民",
});

/** 身份卡类型 → 展示名。类型缺失按平民算（牌面本来就只有女巫/警长/平民三种）。 */
export function trialLabel(kind) {
  return TRIAL_LABELS[kind] ?? (kind ?? TRIAL_LABELS.townspeople);
}

const NO_ROLE = "无角色";
const NAME_SEPARATOR = "·";

/**
 * 窄座位卡上的短名：只切掉「·」之后的部分。
 * 「乔治·伯勒斯」→「乔治」、「威廉·菲普斯」→「威廉」；没有分隔符就原样返回。
 */
export function compactRoleName(name) {
  const text = String(name ?? "");
  const cut = text.indexOf(NAME_SEPARATOR);
  if (cut <= 0) return text;
  const head = text.slice(0, cut).trim();
  return head || text;
}

/**
 * 座位上的角色行：返回 `{ full, compact }`。
 * 角色是否显示与生死无关——死亡只是样式灰化，字要留着。
 * 卡牌资源没加载时回落到角色 id，绝不显示空白。
 */
export function seatRoleView(seat, resolveName) {
  const role = seat?.role;
  if (!role || role === "none") return { full: NO_ROLE, compact: NO_ROLE };
  const resolved = typeof resolveName === "function" ? resolveName(role) : null;
  const full = typeof resolved === "string" && resolved.trim() ? resolved.trim() : String(role);
  return { full, compact: compactRoleName(full) };
}


/** 身份卡类型 → 卡牌资源 id；只有女巫 / 警长 / 平民三种牌面。 */
export const TRIAL_FACE_CARD = Object.freeze({
  witch: "witch",
  constable: "constable",
  townspeople: "not-a-witch",
});

/** 身份卡牌背；资源目录里现成的 back-trial 图，不进 cards.zh.json。 */
export const TRIAL_BACK_IMAGE = "assets/cards/zh/back-trial.png";

/** 身份卡类型的牌面资源 id；未知类型返回 null，由调用方退回牌背。 */
export function trialFaceCardId(kind) {
  return TRIAL_FACE_CARD[kind] ?? null;
}

/**
 * 身份卡类型 → 座位点阵的角标颜色类名（witch 血红 / constable 蓝 / on 金）。
 *
 * 座位点阵与自家身份卡卡片条共用这一份映射：两处颜色必须一致，谁也别各写一份。
 */
export function trialTone(kind) {
  if (kind === "witch") return "witch";
  if (kind === "constable") return "constable";
  return "on";
}

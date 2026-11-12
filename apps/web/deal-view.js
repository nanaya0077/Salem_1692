/**
 * 发牌相位（Deal Phase）的展示语义：阶段名、已看 / 未看计数、能否进入黎明、其他座位的选角状态。
 *
 * 纯函数、不碰 DOM、不 import 任何东西：页面接线之后，浏览器与 `node --test` 跑的是同一份实现。
 * 「看过」是本地行为（服务端只记整份确认），所以计数由调用方把「翻开过的位置」喂进来。
 */

export const PHASE_LABELS = Object.freeze({
  lobby: "大厅",
  deal: "发牌",
  dawn: "黎明",
  action: "白天",
  playing: "白天",
  conspiracy: "传染",
  night: "夜晚",
  gameOver: "结束",
  over: "结束",
});

/** 阶段标签；未登记的相位原样透出，便于排查。 */
export function phaseLabel(phase) {
  return PHASE_LABELS[phase] ?? phase;
}

/** 已看 / 未看计数：本地点开过或已经揭示的身份卡都算看过。 */
export function dealProgress(trials, flipped) {
  const list = trials ?? [];
  const set = flipped instanceof Set ? flipped : new Set(flipped ?? []);
  let seen = 0;
  list.forEach((trial, index) => {
    if (trial?.revealed || set.has(index)) seen += 1;
  });
  const total = list.length;
  return { seen, total, allSeen: total > 0 && seen >= total };
}

/** 「已看 2 / 4」。 */
export function dealCountText(progress) {
  const seen = progress?.seen ?? 0;
  const total = progress?.total ?? 0;
  return "已看 " + seen + " / " + total;
}

/** 「进入黎明」只在全部翻开且选好角色之后可点；已经确认过就不必再点。 */
export function canEnterDawn({ seen = 0, total = 0, roleChosen = false, acknowledged = false } = {}) {
  return total > 0 && seen >= total && Boolean(roleChosen) && !acknowledged;
}

const PENDING_ROLE = "待选";

/** 其他座位：选角前「待选」，选好后显示所选角色；生死不影响这行字。 */
export function dealSeatStatus(seat, resolveRoleName) {
  if (!seat || !seat.roleChosen) return PENDING_ROLE;
  const role = seat.role;
  if (!role || role === "none") return PENDING_ROLE;
  const resolved = typeof resolveRoleName === "function" ? resolveRoleName(role) : null;
  const text = typeof resolved === "string" ? resolved.trim() : "";
  return text || String(role);
}

/** 房间层的确认进度；没有发牌相位时返回空串，调用方不画这一行。 */
export function ackSummary(deal, seatCount) {
  if (!deal) return "";
  const acked = Array.isArray(deal.acked) ? deal.acked.length : 0;
  const total = Math.max(0, Number(seatCount) || 0);
  return acked + " / " + total + " 已确认";
}

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

/** 规则层死因与夜晚结算原因码 → 中文展示文案。 */
export const DEATH_CAUSE_LABELS = Object.freeze({
  "witch-revealed": "女巫身份暴露",
  "all-trials-revealed": "身份卡全部揭示",
  "no-unrevealed-trial": "无未揭示身份卡",
  "night-kill": "夜晚遇害",
  matchmaker: "情侣殉情",
  "no-trials": "失去全部身份卡",
  saved: "平安获救",
});

/** 死因码转中文；空值回落「死亡」，未知值原样透出便于排查。 */
export function deathCauseLabel(cause) {
  if (!cause) return "死亡";
  return DEATH_CAUSE_LABELS[cause] ?? String(cause);
}

/** 规则层与服务端拒单 reason → 面向玩家的中文提示。 */
export const ERROR_REASON_LABELS = Object.freeze({
  "not-deal-phase": "当前不是发牌阶段",
  "unknown-player": "找不到该玩家",
  "role-already-chosen": "角色已选定，不能更改",
  "role-not-offered": "所选角色不在候选中",
  "unknown-card": "未知卡牌",
  "actor-not-alive": "你已出局，不能行动",
  "player-not-alive": "你已出局，不能行动",
  dead: "你已出局，不能行动",
  "not-action-phase": "当前不是白天行动阶段",
  "reveal-pending": "请先等待本次揭示选完位置",
  "not-your-turn": "还没轮到你行动",
  "card-not-in-hand": "手里没有这张牌",
  "black-card-resolves-on-draw": "黑卡抽到即生效，不能手动打出",
  "target-required": "请先选择目标玩家",
  "target-not-alive": "目标玩家已出局",
  "cannot-target-self": "目标不能是自己",
  "piety:red-immunity": "目标面前有「信徒」，不能对其打出红卡",
  "curse:no-blue-card": "目标面前没有蓝卡，不能打出「诅咒」",
  "matchmaker:duplicate": "目标面前已有「情侣」，不能重复放置",
  "alibi:duplicate-index": "「辩护」不能重复选择同一张红卡",
  "alibi:count": "「辩护」最多弃 3 张指控或单独 1 张证据",
  "alibi:bad-index": "所选红卡位置无效",
  "alibi:evidence-alone": "「证据」只能单独弃掉，不能与「指控」混选",
  "alibi:not-red": "「辩护」只能弃掉红卡",
  "alibi:no-red-card": "目标面前没有红卡，无需「辩护」",
  "source-required": "请先选择来源玩家",
  "source-not-alive": "来源玩家已出局",
  "cannot-involve-self": "来源与目标都不能是自己",
  "source-equals-target": "目标不能与来源相同",
  "only-two-players-left": "场上其他存活玩家不足 2 人，无法使用此卡",
  "only-will-griggs": "只有威尔·格里格斯可以把「辩护」当「目击」打出",
  "action-already-taken": "本回合已行动，请结束回合",
  "must-draw-or-play": "请先打出一张牌，或抽两张牌",
  "no-pending-reveal": "当前没有待处理的揭示",
  "not-chooser": "本次揭示由其他玩家选择",
  "unknown-target": "目标玩家不存在",
  "cannot-decline": "本次揭示不能放弃",
  "bad-trial-index": "所选身份卡位置无效",
  "trial-not-found": "所选身份卡位置无效",
  "trial-already-revealed": "该身份卡已经揭示，请换一张",
  "not-conspiracy-cat": "当前不在黑猫揭示步骤",
  "not-conspiracy-pick": "当前不在传染取牌步骤",
  "not-conspiracy": "传染阶段已结束",
  "conspiracy-phase": "传染阶段只能选择身份卡",
  "not-drawer": "只有抽到传染的玩家可以选择黑猫揭示",
  "no-cat": "场上没有可翻开的黑猫持有者",
  "left-not-available": "左邻没有可取的未揭示身份卡",
  "not-night": "当前不是夜晚阶段",
  "already-confessed": "本夜已经自首过了",
  "not-william-phipps": "你不是威廉·菲普斯",
  "not-william": "你不是威廉·菲普斯",
  "william-power-used": "威廉·菲普斯能力每局只能用一次",
  "william-used": "威廉·菲普斯能力每局只能用一次",
  "no-unrevealed-trial": "没有未揭示的身份卡可供自首",
  "not-samuel": "你不是塞缪尔·帕里斯",
  "samuel-power-used": "塞缪尔·帕里斯能力本局已用满 2 次",
  "too-many-cards": "最多只能从弃牌堆拿 2 张牌",
  "cannot-take-black": "不能从弃牌堆拿黑卡",
  "card-not-in-discard": "所选卡牌不在弃牌堆中",
  "not-tituba": "你不是蒂图巴",
  "tituba-power-used": "蒂图巴能力每局只能用一次",
  "order-must-cover-deck": "牌堆重排顺序无效",
  "order-not-permutation": "牌堆重排顺序无效",
  "game-not-over": "对局尚未结束",
});

/**
 * 把服务端或规则层返回的错误码转成中文提示。
 * 命中已知 reason 时优先用标准中文提示；未命中时回落到 fallback（非同串英文码）或「操作失败」。
 */
export function errorReasonLabel(reason, fallback = "") {
  if (reason && ERROR_REASON_LABELS[reason]) return ERROR_REASON_LABELS[reason];
  const text = typeof fallback === "string" ? fallback.trim() : "";
  if (text && text !== reason) return text;
  if (typeof reason === "string" && reason.trim()) return ERROR_REASON_LABELS[reason.trim()] ?? "操作失败";
  return "操作失败";
}

/**
 * 玛莎·科里（martha-corey）复制右邻第一个存活玩家（座位号递减方向）的角色。
 * 与 packages/rules/src/engine.ts:52-63 的 effectiveRole 完全同口径。
 */
export function effectiveRoleOf(seats, seatId) {
  const list = Array.isArray(seats) ? seats : [];
  const startIdx = list.findIndex((s) => s?.id === seatId);
  if (startIdx < 0) return "none";
  const player = list[startIdx];
  const role = player?.role ?? "none";
  if (role !== "martha-corey") return role;
  const n = list.length;
  for (let step = 1; step <= n; step += 1) {
    const other = list[(startIdx - step + n * 2) % n];
    if (other?.alive && other.role && other.role !== "martha-corey" && other.role !== "none") {
      return other.role;
    }
  }
  return "none";
}

/**
 * 玛莎·科里当前复制的角色说明：非玛莎或无可复制对象时返回空串，
 * 有复制对象时返回「复制：XXX」供自身面板与角色弹窗展示。
 */
export function copiedRoleNote(seats, seatId, resolveName) {
  const list = Array.isArray(seats) ? seats : [];
  const player = list.find((s) => s?.id === seatId);
  if (!player || player.role !== "martha-corey") return "";
  const effective = effectiveRoleOf(list, seatId);
  if (!effective || effective === "none" || effective === "martha-corey") return "";
  const resolved = typeof resolveName === "function" ? resolveName(effective) : null;
  const name = typeof resolved === "string" && resolved.trim() ? resolved.trim() : effective;
  return "复制：" + name;
}

/**
 * 选目标阶段下，某个座位相对当前待打出手牌（pending）的可选状态与拒绝原因。
 * 返回 { selectable, isSource, reason, message }。
 */
export function seatTargetState(projection, seatId, pending, cardSpec, targetSeatId) {
  if (!pending || !projection) {
    return { selectable: false, isSource: false, reason: null, message: null };
  }
  const seats = Array.isArray(projection.seats) ? projection.seats : [];
  const target = seats.find((s) => s?.id === targetSeatId);
  if (!target || !target.alive) {
    const reason = pending.stage === "source" ? "source-not-alive" : "target-not-alive";
    return { selectable: false, isSource: false, reason, message: errorReasonLabel(reason) };
  }
  if (targetSeatId === seatId) {
    const reason = pending.stage === "source" ? "cannot-involve-self" : "cannot-target-self";
    return { selectable: false, isSource: false, reason, message: errorReasonLabel(reason) };
  }
  if (pending.sourceId === targetSeatId) {
    return {
      selectable: false,
      isSource: true,
      reason: "source-equals-target",
      message: errorReasonLabel("source-equals-target"),
    };
  }
  if (pending.stage === "source") {
    const otherTargets = seats.filter((s) => s?.alive && s.id !== seatId && s.id !== targetSeatId);
    if (otherTargets.length === 0) {
      return {
        selectable: false,
        isSource: false,
        reason: "only-two-players-left",
        message: errorReasonLabel("only-two-players-left"),
      };
    }
    return { selectable: true, isSource: false, reason: null, message: null };
  }

  const isRedAttack = cardSpec?.color === "red" || (pending.cardId === "alibi" && Boolean(pending.asWitness));
  if (isRedAttack && (target.blue ?? []).includes("piety")) {
    return {
      selectable: false,
      isSource: false,
      reason: "piety:red-immunity",
      message: errorReasonLabel("piety:red-immunity"),
    };
  }
  if (pending.cardId === "curse" && (target.blue ?? []).length === 0) {
    return {
      selectable: false,
      isSource: false,
      reason: "curse:no-blue-card",
      message: errorReasonLabel("curse:no-blue-card"),
    };
  }
  if (pending.cardId === "matchmaker" && (target.blue ?? []).includes("matchmaker")) {
    return {
      selectable: false,
      isSource: false,
      reason: "matchmaker:duplicate",
      message: errorReasonLabel("matchmaker:duplicate"),
    };
  }
  if (pending.cardId === "alibi" && !pending.asWitness) {
    const redCount = Array.isArray(target.accusationsCards)
      ? target.accusationsCards.length
      : Number(target.accusations ?? 0);
    if (redCount <= 0) {
      return {
        selectable: false,
        isSource: false,
        reason: "alibi:no-red-card",
        message: errorReasonLabel("alibi:no-red-card"),
      };
    }
  }
  return { selectable: true, isSource: false, reason: null, message: null };
}

/**
 * 手牌详情弹窗里的「打出」预校验：检查是否轮到本人、是否已行动、是否挂起，
 * 以及场上是否存在至少一个合法目标（避免点出去才发现全员无蓝卡/全员信徒/人数不足）。
 */
export function canPlayHandCard(projection, seatId, cardId, cardSpec, options = {}) {
  if (!projection || projection.phase !== "action") {
    return { ok: false, reason: "not-action-phase", message: errorReasonLabel("not-action-phase") };
  }
  if (projection.currentPlayerId !== seatId) {
    return { ok: false, reason: "not-your-turn", message: errorReasonLabel("not-your-turn") };
  }
  if (projection.self?.alive === false) {
    return { ok: false, reason: "actor-not-alive", message: errorReasonLabel("actor-not-alive") };
  }
  if (projection.pendingReveal || options.revealLocked) {
    return { ok: false, reason: "reveal-pending", message: errorReasonLabel("reveal-pending") };
  }
  if (projection.actionTaken) {
    return { ok: false, reason: "action-already-taken", message: errorReasonLabel("action-already-taken") };
  }
  if (!(projection.self?.hand ?? []).includes(cardId)) {
    return { ok: false, reason: "card-not-in-hand", message: errorReasonLabel("card-not-in-hand") };
  }
  if (cardSpec?.color === "black") {
    return {
      ok: false,
      reason: "black-card-resolves-on-draw",
      message: errorReasonLabel("black-card-resolves-on-draw"),
    };
  }
  const asWitness = Boolean(options.asWitness);
  if (asWitness) {
    const effRole = effectiveRoleOf(projection.seats, seatId) || projection.self?.role;
    if (cardId !== "alibi" || effRole !== "will-griggs") {
      return { ok: false, reason: "only-will-griggs", message: errorReasonLabel("only-will-griggs") };
    }
  }
  const seats = Array.isArray(projection.seats) ? projection.seats : [];
  const aliveOthers = seats.filter((s) => s?.alive && s.id !== seatId);
  if (cardSpec?.target === "two") {
    if (aliveOthers.length < 2) {
      return { ok: false, reason: "only-two-players-left", message: errorReasonLabel("only-two-players-left") };
    }
    return { ok: true, reason: null, message: null };
  }
  if (cardSpec?.target === "other") {
    if (aliveOthers.length === 0) {
      return { ok: false, reason: "target-required", message: errorReasonLabel("target-required") };
    }
    const pendingProbe = { cardId, asWitness, stage: "target", sourceId: null };
    const states = aliveOthers.map((s) => seatTargetState(projection, seatId, pendingProbe, cardSpec, s.id));
    if (states.some((st) => st.selectable)) {
      return { ok: true, reason: null, message: null };
    }
    const firstDenied = states.find((st) => st.reason);
    const reason = firstDenied?.reason ?? "target-required";
    return { ok: false, reason, message: errorReasonLabel(reason) };
  }
  return { ok: true, reason: null, message: null };
}

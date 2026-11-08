const CONSPIRACY_WARN_MS = 5000;

/**
 * 传染阶段（黑猫揭示 + 从左邻取牌）的界面文案与可交互判定。
 *
 * 这里只做纯函数：把服务端下发的 `projection.conspiracy` 翻译成「标题 / 副标 / 位置槽 /
 * 按钮是否可点 / 等待态文案」，不碰 DOM、不读全局状态，便于直接单测。
 * 位置号与已揭示状态都由服务端给（`candidates` / `revealed`），客户端不自己推断谁能选。
 */

/** 左邻：与规则层的 `leftOf` 同一口径（座位号 +1 取模），左邻已出局时服务端不会给候选。 */
export function leftOfSeat(seatId, playerCount) {
  if (!Number.isInteger(seatId) || !Number.isInteger(playerCount) || playerCount <= 0) return null;
  return (seatId + 1) % playerCount;
}

/**
 * 标题与副标。`cat` 步只有黑猫持有者能选，点名的就是他自己面前那张；
 * `pick` 步全员同时选左邻，所以副标把「左邻」翻成具体的人，不让人自己数座位号。
 */
export function conspiracyHeading(view, ctx = {}) {
  const nameOf = typeof ctx.nameOf === "function" ? ctx.nameOf : (id) => "玩家 " + (Number(id) + 1);
  if (!view) return { title: "传染", sub: "", subjectId: null };
  if (view.step === "cat") {
    return {
      title: "选择要揭示的身份卡",
      sub: nameOf(view.catSeatId) + " 就在你面前，先翻开一张。",
      subjectId: view.catSeatId,
    };
  }
  const left = leftOfSeat(ctx.seatId, ctx.playerCount);
  return {
    title: "从左邻手里取一张身份卡",
    sub: left === null
      ? "同时选一张面朝下的身份卡，别人看不到你拿了哪张。"
      : "你的左邻是 " + nameOf(left) + "，从他手里取一张面朝下的。",
    subjectId: left,
  };
}

/** 位置槽：可选的与已揭示的合并成一条，已揭示的灰显且不可点。 */
export function conspiracySlots(view) {
  if (!view) return [];
  const candidates = new Set(view.candidates ?? []);
  const revealed = new Set(view.revealed ?? []);
  const highest = Math.max(-1, ...candidates, ...revealed);
  const slots = [];
  for (let index = 0; index <= highest; index += 1) {
    slots.push({
      index,
      revealed: revealed.has(index),
      selectable: candidates.has(index),
    });
  }
  return slots;
}

export function canSubmitConspiracy(view, pick) {
  if (!view || view.submitted) return false;
  if (!Number.isInteger(pick)) return false;
  return (view.candidates ?? []).includes(pick);
}

/** 等待态：只报「已提交几人」，不报谁选了哪张（信息边界见 #61 的 §9 清单）。 */
export function conspiracyWaitText(view) {
  if (!view) return "";
  const submitted = Number(view.submittedCount ?? 0);
  const eligible = Number(view.eligibleCount ?? 0);
  if (view.step === "cat") return submitted > 0 ? "已揭示，等待结算" : "等待揭示";
  return eligible > 0 && submitted > 0
    ? "已提交 " + submitted + "/" + eligible + "，等待其他玩家"
    : "已提交，等待其他玩家";
}

/** 底部提示条：未提交时提示还能改，提交后不再给「还能撤销」的假承诺。 */
export function conspiracyNote(view, pick) {
  if (!view) return "";
  if (view.submitted) return "已提交，等待其他玩家。";
  if (!Number.isInteger(pick)) return "";
  return "已选 #" + (pick + 1) + "，提交前可以改。";
}

/** 倒计时文字：服务端 deadline 缺失（线下模式或阶段刚起）时不显示数字。 */
export function conspiracyClockText(deadline, now) {
  if (deadline === null || deadline === undefined) return "";
  const left = Number(deadline) - Number(now);
  if (!Number.isFinite(left)) return "";
  return Math.max(0, Math.ceil(left / 1000)) + " 秒";
}

/** 倒计时只剩 5 秒（含）以内时变金提醒；没有 deadline 时不变。 */
export function conspiracyClockWarn(deadline, now) {
  if (deadline === null || deadline === undefined) return false;
  const left = Number(deadline) - Number(now);
  if (!Number.isFinite(left)) return false;
  return left > 0 && left <= CONSPIRACY_WARN_MS;
}

/** 换牌三拍：卷起 200 / 交换 450 / 落位 250，总计 900（与 motion-events 的 fx.conspiracy.swap 同源）。 */
export const CONSPIRACY_SWAP_PHASES = Object.freeze({ curl: 200, fly: 450, drop: 250 });

/**
 * 演出舞台状态。
 * previousStep 传上一帧的 step（首次渲染传 null）：
 *   enter=true  → 这一帧才进入传染阶段，演「抽到即弃 500 + 转场 260」
 *   stepChanged → 刚切到 pick，演「计数变化 150」
 * 不返回任何隐藏信息，只回答「该演哪一拍」。
 */
export function conspiracyStage(view, previousStep = null) {
  if (!view) return { enter: false, step: null, stepChanged: false };
  const step = view.step === "cat" ? "cat" : "pick";
  const enter = previousStep === null || previousStep === undefined;
  return { enter, step, stepChanged: !enter && previousStep !== step };
}

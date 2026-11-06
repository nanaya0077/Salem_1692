/**
 * 断线重连判定：只做「决策」，不碰 DOM、不碰 WebSocket、不发消息。
 *
 * 页面脚本负责 socket、定时器与界面，这个模块只回答三类问题：
 * 1) socket 连上之后要不要补发 join、补发什么（{@link rejoinPlan}）；
 * 2) socket 断了要不要再连、隔多久（{@link reconnectPlan}）；
 * 3) 服务端这条错误是不是「房间没了」的终态（{@link errorOutcome}）。
 *
 * 为什么单独抽出来：旧实现在补发 join 上用了 `!S.room` 当守卫，而断线后
 * `S.room` 一直挂着旧的房间对象，于是重连出来的新 socket 永远不补发 join——
 * 服务端重启后页面就停在一个「连上了但没有房间」的空转状态，既没有终态提示，
 * 也不会收到 `room-not-found`。判定逻辑放在这里之后，`node --test` 跑的和
 * 浏览器跑的是同一份实现。
 */

/** 断线后等多久再连（毫秒）。短断线靠它自动恢复，不闪终态。 */
export const RECONNECT_DELAY_MS = 1500;

/** 终态提示：与落地页的房码错误共用 #landingError 的位置。 */
export const ROOM_GONE_MESSAGE = "房间已失效，请重新开房。";

/**
 * 补发 join 的入参。有存档房码与令牌、不是主动离开、没进终态，就补发。
 *
 * 注意这里**不看**「当前是否还挂着房间」：断线时 `S.room` 一直是旧值，
 * 拿它当守卫正是旧实现不补发 join 的原因。
 */
export function rejoinPlan({ session, leaving = false, roomGone = false }) {
  if (leaving || roomGone) return null;
  if (!session?.code || !session?.token) return null;
  return { code: session.code, token: session.token };
}

/**
 * 断开后要不要重连：房间还在、非主动离开、没进终态才重连。
 * 进了终态就返回 null——这是「停止无限重连」的落点。
 */
export function reconnectPlan({ inRoom, leaving = false, roomGone = false }) {
  if (roomGone || leaving || !inRoom) return null;
  return { delayMs: RECONNECT_DELAY_MS };
}

/** 房间级不存在的错误码：房间没了，座位也就没了。 */
const ROOM_GONE_REASONS = new Set(["room-not-found", "no-seat"]);

/**
 * 错误分类：
 * - `room-gone`：补发 join 时撞上房间不存在 → 进终态，停止重连并给出提示；
 * - `join-failed`：玩家手输房码撞上房间不存在 → 保持落地页原有提示，不进终态；
 * - `transient`：其它错误，连接与重连行为都不动。
 */
export function errorOutcome({ reason, rejoining = false }) {
  if (!ROOM_GONE_REASONS.has(reason)) return "transient";
  return rejoining ? "room-gone" : "join-failed";
}

/**
 * 断线重连判定：只做「决策」，不碰 DOM、不碰 WebSocket、不发消息。
 *
 * 页面脚本负责 socket、定时器与界面，这个模块只回答三类问题：
 * 1) socket 连上之后要不要补发 join、补发什么（{@link rejoinPlan}）；
 * 2) socket 断了怎么处置——重连、被顶号、被踢、房间已解散（{@link closeOutcome}）；
 * 3) 服务端这条错误是不是「房间没了」的终态（{@link errorOutcome}）。
 *
 * 为什么单独抽出来：旧实现在补发 join 上用了 `!S.room` 当守卫，而断线后
 * `S.room` 一直挂着旧的房间对象，于是重连出来的新 socket 永远不补发 join——
 * 服务端重启后页面就停在一个「连上了但没有房间」的空转状态，既没有终态提示，
 * 也不会收到 `room-not-found`。判定逻辑放在这里之后，`node --test` 跑的和
 * 浏览器跑的是同一份实现。
 */

/** 网络层断开后等多久再连（毫秒）。短断线靠它自动恢复，不闪终态。 */
export const RECONNECT_DELAY_MS = 1500;

/** 终态提示：与落地页的房码错误共用 #landingError 的位置。 */
export const ROOM_GONE_MESSAGE = "房间已失效，请重新开房。";

/**
 * 服务端主动关连接用的 close code，全仓只有这三处（`apps/server/src/server.mjs`）：
 * - 4001 `replaced`：同一 token 在别处加入，旧 socket 被顶掉；
 * - 1001 `room-closed`：房间被回收，`cleanupRoom()` 关掉房内所有连接；
 * - 4003 `kicked`：被房主移出房间。
 */
export const REPLACED_CLOSE_CODE = 4001;
export const ROOM_CLOSED_CLOSE_CODE = 1001;
export const KICKED_CLOSE_CODE = 4003;

/** 被顶号：房间还在，只是这页不是它的活连接了。所以只提示，不清存档、不进终态。 */
export const REPLACED_MESSAGE = "此房间已在另一处打开，本页停止重连";

/** 被踢：座位已经从房间删掉，重连换不到座位，只能回落地页。 */
export const KICKED_MESSAGE = "你已被移出房间。";

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
 * 断开之后的处置，按 close code 分类：
 * - `replaced`：被同 token 的另一处连接顶掉 → 不重连。重连回去又会把对方顶掉，
 *   两页会每 {@link RECONNECT_DELAY_MS} 互踢一次；
 * - `kicked`：被房主踢出 → 不重连。座位已删，`joinRoom()` 拿旧 token 查不到座位时
 *   会在大厅期新建一个座位，重连等于被踢者换个新身份立刻回来；
 * - `room-closed`：房间被回收 → 直接进终态。重连再补 join 也只会拿到
 *   `room-not-found`，绕一圈才到同一个终态；
 * - `stop`：主动离开、已在终态、或本来就不在房间 → 不重连；
 * - `reconnect`：网络层断开 → 等 {@link RECONNECT_DELAY_MS} 再连。
 */
export function closeOutcome({ code = null, inRoom, leaving = false, roomGone = false }) {
  if (code === REPLACED_CLOSE_CODE) return "replaced";
  if (code === KICKED_CLOSE_CODE) return "kicked";
  if (code === ROOM_CLOSED_CLOSE_CODE) return "room-closed";
  if (roomGone || leaving || !inRoom) return "stop";
  return "reconnect";
}

/**
 * 房间级终态的唯一原因。`joinRoom()` 查不到房码时只发这一条；`no-seat` 不在其中——
 * 服务端从不因「座位没了」判定房间失效，那个码只从 `action` 与踢人的目标校验发出，
 * 房间还在，所以走 `transient`。
 */
const ROOM_GONE_REASON = "room-not-found";

/**
 * 错误分类：
 * - `room-gone`：补发 join 时撞上房间不存在 → 进终态，停止重连并给出提示；
 * - `join-failed`：玩家手输房码撞上房间不存在 → 保持落地页原有提示，不进终态；
 * - `transient`：其它错误（含 `no-seat`），连接与重连行为都不动。
 */
export function errorOutcome({ reason, rejoining = false }) {
  if (reason !== ROOM_GONE_REASON) return "transient";
  return rejoining ? "room-gone" : "join-failed";
}

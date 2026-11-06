import test from "node:test";
import assert from "node:assert/strict";
import {
  KICKED_CLOSE_CODE,
  KICKED_MESSAGE,
  RECONNECT_DELAY_MS,
  REPLACED_CLOSE_CODE,
  REPLACED_MESSAGE,
  ROOM_CLOSED_CLOSE_CODE,
  ROOM_GONE_MESSAGE,
  closeOutcome,
  errorOutcome,
  rejoinPlan,
} from "../reconnect.js";

// 缝：客户端断线重连的判定模块（apps/web/reconnect.js）。
// 只断言它对外给出的决策，不碰 DOM、不碰 WebSocket。

const session = { code: "ABC234", token: "tok" };

test("连接建立后补发 join：存档里有房码与令牌就要补发", () => {
  assert.deepEqual(rejoinPlan({ session, leaving: false, roomGone: false }), { code: "ABC234", token: "tok" });
});

test("断线时房间里还挂着旧状态，也照样补发 join", () => {
  // 旧实现在这里用 !S.room 当守卫；S.room 断线后从不清空，于是重连的 socket 永远不补发 join。
  assert.ok(rejoinPlan({ session, leaving: false, roomGone: false, inRoom: true }));
});

test("没有存档、存档缺令牌、正在离开、已进终态，都不补发 join", () => {
  assert.equal(rejoinPlan({ session: null, leaving: false, roomGone: false }), null);
  assert.equal(rejoinPlan({ session: { code: "ABC234" }, leaving: false, roomGone: false }), null);
  assert.equal(rejoinPlan({ session, leaving: true, roomGone: false }), null);
  assert.equal(rejoinPlan({ session, leaving: false, roomGone: true }), null);
});

test("网络层断开：房间还在就等 1.5 秒重连", () => {
  // 1006 = 异常断开（服务端进程没了、网络掉线），1000 = 正常关闭但没带主动离开标记。
  assert.equal(closeOutcome({ code: 1006, inRoom: true, leaving: false, roomGone: false }), "reconnect");
  assert.equal(closeOutcome({ code: 1000, inRoom: true, leaving: false, roomGone: false }), "reconnect");
  assert.equal(closeOutcome({ code: null, inRoom: true, leaving: false, roomGone: false }), "reconnect");
  assert.equal(RECONNECT_DELAY_MS, 1500);
});

test("4001 被顶号：不重连，避免两页每 1.5 秒互踢", () => {
  // 同一房码同一 token 在另一处加入时，服务端用 4001 关掉旧 socket（joinRoom 的 replaced）。
  // 旧 socket 若还重连，会重新 join 并把另一页顶掉，循环无解。
  assert.equal(REPLACED_CLOSE_CODE, 4001);
  assert.equal(closeOutcome({ code: 4001, inRoom: true, leaving: false, roomGone: false }), "replaced");
  // 即便本页已经不认为自己在房间里，顶号仍然是顶号，不能退回「重连」。
  assert.equal(closeOutcome({ code: 4001, inRoom: false, leaving: false, roomGone: false }), "replaced");
});

test("4003 被踢：不重连，否则旧 token 会换一个新座位回来", () => {
  // 踢人只删座位；被踢者拿旧 token 补发 join 时 joinRoom 查不到座位，大厅期会新建一个。
  assert.equal(KICKED_CLOSE_CODE, 4003);
  assert.equal(closeOutcome({ code: 4003, inRoom: true, leaving: false, roomGone: false }), "kicked");
});

test("1001 房间已解散：直接进终态，不必绕一圈等 room-not-found", () => {
  assert.equal(ROOM_CLOSED_CLOSE_CODE, 1001);
  assert.equal(closeOutcome({ code: 1001, inRoom: true, leaving: false, roomGone: false }), "room-closed");
});

test("房间已失效后不再重连：无限重连在这里断掉", () => {
  assert.equal(closeOutcome({ code: 1006, inRoom: true, leaving: false, roomGone: true }), "stop");
});

test("主动离开、或本来就不在房间里，不重连", () => {
  assert.equal(closeOutcome({ code: 1006, inRoom: true, leaving: true, roomGone: false }), "stop");
  assert.equal(closeOutcome({ code: 1006, inRoom: false, leaving: false, roomGone: false }), "stop");
});

test("补发 join 撞上房间不存在：进入终态", () => {
  assert.equal(errorOutcome({ reason: "room-not-found", rejoining: true }), "room-gone");
});

test("no-seat 不算房间没了：服务端 joinRoom 从不发它，房间还在，走 transient", () => {
  // no-seat 只从 action 的座位校验与 kick 的目标校验发出，房间与座位表都还在。
  assert.equal(errorOutcome({ reason: "no-seat", rejoining: true }), "transient");
  assert.equal(errorOutcome({ reason: "no-seat", rejoining: false }), "transient");
});

test("玩家手输房码撞上房间不存在：仍走落地页原有提示", () => {
  assert.equal(errorOutcome({ reason: "room-not-found", rejoining: false }), "join-failed");
});

test("其它错误不动连接", () => {
  assert.equal(errorOutcome({ reason: "room-full", rejoining: true }), "transient");
  assert.equal(errorOutcome({ reason: "not-host", rejoining: false }), "transient");
  assert.equal(errorOutcome({ reason: "kicked", rejoining: false }), "transient");
});

test("终态与被顶号/被踢的文案分开", () => {
  assert.match(ROOM_GONE_MESSAGE, /房间已失效，请重新开房/);
  assert.match(REPLACED_MESSAGE, /在另一处打开/);
  assert.match(KICKED_MESSAGE, /移出房间/);
});

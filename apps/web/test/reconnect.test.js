import test from "node:test";
import assert from "node:assert/strict";
import {
  RECONNECT_DELAY_MS,
  ROOM_GONE_MESSAGE,
  errorOutcome,
  reconnectPlan,
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

test("房间还在时断线：1.5 秒后重连", () => {
  assert.deepEqual(reconnectPlan({ inRoom: true, leaving: false, roomGone: false }), { delayMs: RECONNECT_DELAY_MS });
  assert.equal(RECONNECT_DELAY_MS, 1500);
});

test("房间已失效后不再重连：无限重连在这里断掉", () => {
  assert.equal(reconnectPlan({ inRoom: true, leaving: false, roomGone: true }), null);
});

test("主动离开、或本来就不在房间里，不重连", () => {
  assert.equal(reconnectPlan({ inRoom: true, leaving: true, roomGone: false }), null);
  assert.equal(reconnectPlan({ inRoom: false, leaving: false, roomGone: false }), null);
});

test("补发 join 撞上房间不存在：进入终态", () => {
  assert.equal(errorOutcome({ reason: "room-not-found", rejoining: true }), "room-gone");
  assert.equal(errorOutcome({ reason: "no-seat", rejoining: true }), "room-gone");
});

test("玩家手输房码撞上房间不存在：仍走落地页原有提示", () => {
  assert.equal(errorOutcome({ reason: "room-not-found", rejoining: false }), "join-failed");
});

test("其它错误不动连接", () => {
  assert.equal(errorOutcome({ reason: "room-full", rejoining: true }), "transient");
  assert.equal(errorOutcome({ reason: "not-host", rejoining: false }), "transient");
});

test("终态文案与票面一致", () => {
  assert.match(ROOM_GONE_MESSAGE, /房间已失效，请重新开房/);
});

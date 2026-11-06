import test from "node:test";
import assert from "node:assert/strict";
import { phaseLabel, dealProgress, canEnterDawn, dealSeatStatus, ackSummary } from "../deal-view.js";

// 缝：发牌相位的展示语义。全是纯函数，页面只负责把投影喂进来、把结果画出去。

const trial = (revealed = false) => ({ id: "witch-0", kind: revealed ? "witch" : null, revealed });

test("阶段标签认发牌相位，未知相位原样回落", () => {
  assert.equal(phaseLabel("deal"), "发牌");
  assert.equal(phaseLabel("action"), "白天");
  assert.equal(phaseLabel("night"), "夜晚");
  assert.equal(phaseLabel("mystery"), "mystery");
});

test("已看 / 未看计数按「翻开或已揭示」算，总数是身份卡张数", () => {
  assert.deepEqual(dealProgress([trial(), trial(), trial(), trial()], [0, 2]), { seen: 2, total: 4, allSeen: false });
  assert.deepEqual(dealProgress([trial(), trial()], [0, 1]), { seen: 2, total: 2, allSeen: true });
  // 局中已揭示的卡不需要再点开，也算看过。
  assert.deepEqual(dealProgress([trial(true), trial()], []), { seen: 1, total: 2, allSeen: false });
  assert.deepEqual(dealProgress([], []), { seen: 0, total: 0, allSeen: false });
});

test("进入黎明要全部翻开且已经选好角色，确认过一次就不再重复确认", () => {
  const base = { seen: 4, total: 4, roleChosen: true, acknowledged: false };
  assert.equal(canEnterDawn(base), true);
  assert.equal(canEnterDawn({ ...base, seen: 3 }), false);
  assert.equal(canEnterDawn({ ...base, roleChosen: false }), false);
  assert.equal(canEnterDawn({ ...base, acknowledged: true }), false);
  assert.equal(canEnterDawn({ seen: 0, total: 0, roleChosen: true, acknowledged: false }), false);
});

test("其他座位选角前显示待选，选好后显示所选角色", () => {
  const nameOf = (id) => ({ "anne-putnam": "安妮·普特南" })[id] ?? null;
  assert.equal(dealSeatStatus({ roleChosen: false, roleOptions: ["a", "b"] }, nameOf), "待选");
  assert.equal(dealSeatStatus({ roleChosen: true, role: "anne-putnam", roleOptions: [] }, nameOf), "安妮·普特南");
  // 角色资源没加载时回落 id，绝不显示空白。
  assert.equal(dealSeatStatus({ roleChosen: true, role: "john-proctor", roleOptions: [] }, nameOf), "john-proctor");
  assert.equal(dealSeatStatus(null, nameOf), "待选");
});

test("确认进度只数房间里还在的人数", () => {
  assert.equal(ackSummary({ acked: [1, 3], deadline: 123 }, 4), "2 / 4 已确认");
  assert.equal(ackSummary(null, 4), "");
});

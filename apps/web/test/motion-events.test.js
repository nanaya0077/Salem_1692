import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKING_GROUP_IDS,
  MOTION_GROUPS,
  MOTION_MEMBER_IDS,
  groupCap,
  groupDuration,
  motionGroup,
} from "../motion-events.js";

test("G1 表：20 个调度组、23 个成员 id（#58 加了传染四组与即弃一拍）", () => {
  assert.equal(MOTION_GROUPS.length, 20);
  assert.equal(MOTION_MEMBER_IDS.length, 23);
  assert.equal(new Set(MOTION_MEMBER_IDS).size, 23);
});

test("只有夜晚入场与公开死亡是 block", () => {
  assert.deepEqual(BLOCKING_GROUP_IDS.sort(), ["fx.life.death", "fx.phase.night"]);
  assert.equal(motionGroup("fx.phase.night").duration, 600);
  assert.equal(groupCap("fx.phase.night"), 900);
  assert.equal(motionGroup("fx.life.death").duration, 1200);
  assert.equal(groupCap("fx.life.death"), 1200);
});

test("四个新增首批 id 都在表里", () => {
  for (const id of ["fx.ui.toast", "fx.card.deal", "fx.life.deathPrivate", "fx.phase.nightStep"]) {
    assert.ok(MOTION_MEMBER_IDS.includes(id), id);
  }
});

test("揭示横幅是 300/600/180，且非阻塞", () => {
  const settle = motionGroup("fx.reveal.settle");
  assert.deepEqual(settle.phases, { enter: 300, hold: 600, exit: 180 });
  assert.equal(settle.block, false);
  assert.equal(groupDuration("fx.reveal.settle"), 1080);
});

test("其余组不会误标 block", () => {
  for (const group of MOTION_GROUPS) {
    if (group.id === "fx.phase.night" || group.id === "fx.life.death") continue;
    assert.equal(group.block, false, group.id);
  }
});

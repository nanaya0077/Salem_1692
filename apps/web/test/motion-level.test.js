import test from "node:test";
import assert from "node:assert/strict";
import {
  MOTION_LEVELS,
  motionLevelDescription,
  motionLevelLabel,
  nextMotionLevel,
  resolveMotionLevel,
  scaledDuration,
} from "../motion-level.js";

test("档位循环 full → reduced → off → full", () => {
  assert.equal(nextMotionLevel("full"), "reduced");
  assert.equal(nextMotionLevel("reduced"), "off");
  assert.equal(nextMotionLevel("off"), "full");
  assert.deepEqual(MOTION_LEVELS, ["full", "reduced", "off"]);
});

test("存储值优先，非法值不生效", () => {
  assert.equal(resolveMotionLevel({ stored: "off", prefersReduced: false }), "off");
  assert.equal(resolveMotionLevel({ stored: "reduced", prefersReduced: false }), "reduced");
  assert.equal(resolveMotionLevel({ stored: "bogus", prefersReduced: true }), "reduced");
});

test("没有存储时跟随系统与设备：低端机只降一档", () => {
  assert.equal(resolveMotionLevel({ prefersReduced: true }), "reduced");
  assert.equal(resolveMotionLevel({ hardwareConcurrency: 4 }), "reduced");
  assert.equal(resolveMotionLevel({ deviceMemory: 2 }), "reduced");
  assert.equal(resolveMotionLevel({ hardwareConcurrency: 8, deviceMemory: 8 }), "full");
  assert.equal(resolveMotionLevel({ stored: "off", hardwareConcurrency: 2 }), "off");
});

test("off 时长为 0，reduced 上限 200ms", () => {
  assert.equal(scaledDuration("off", 1200), 0);
  assert.equal(scaledDuration("reduced", 1200), 200);
  assert.equal(scaledDuration("reduced", 120), 120);
  assert.equal(scaledDuration("full", 600), 600);
});

test("标签与说明可读", () => {
  assert.equal(motionLevelLabel("full"), "全开");
  assert.equal(motionLevelLabel("reduced"), "减弱");
  assert.equal(motionLevelLabel("off"), "关");
  assert.ok(motionLevelDescription("reduced").includes("淡入淡出"));
});

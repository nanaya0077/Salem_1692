import test from "node:test";
import assert from "node:assert/strict";
import { diffKeys } from "../render-patch.js";

test("新卡入场、旧卡退出", () => {
  const diff = diffKeys(["a", "b"], ["b", "c"]);
  assert.deepEqual(diff.entered, ["c"]);
  assert.deepEqual(diff.exited, ["a"]);
  assert.deepEqual(diff.moved, ["b"]);
  assert.equal(diff.reordered, true);
});

test("同序复用不产生动画信号", () => {
  const diff = diffKeys(["a", "b", "c"], ["a", "b", "c"]);
  assert.deepEqual(diff.entered, []);
  assert.deepEqual(diff.exited, []);
  assert.deepEqual(diff.moved, []);
  assert.equal(diff.reordered, false);
});

test("手牌增删后重排", () => {
  const diff = diffKeys(["a", "b", "c"], ["c", "a", "b"]);
  assert.deepEqual(diff.entered, []);
  assert.deepEqual(diff.exited, []);
  assert.equal(diff.moved.length, 3);
  assert.equal(diff.reordered, true);
});

test("空手牌到有牌", () => {
  const diff = diffKeys([], ["a"]);
  assert.deepEqual(diff.entered, ["a"]);
  assert.deepEqual(diff.exit, undefined);
  assert.deepEqual(diff.exited, []);
});

test("有牌到空手牌", () => {
  const diff = diffKeys(["a"], []);
  assert.deepEqual(diff.exited, ["a"]);
  assert.deepEqual(diff.entered, []);
});

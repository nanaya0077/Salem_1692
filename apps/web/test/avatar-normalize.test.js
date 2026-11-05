import test from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_BUDGET_BYTES,
  AVATAR_TIERS,
  budgetVerdict,
  cropRect,
  dataUrlMime,
  encodingPlan,
  isTargetDataUrl,
  tierAt,
  withinBudget,
} from "../avatar-normalize.js";

// 缝：客户端头像归一化的纯函数模块（apps/web/avatar-normalize.js）。
// 只断言模块对外给出的决策，不碰 DOM、不碰 canvas。

test("正方形原图裁切等于原图", () => {
  assert.deepEqual(cropRect(1024, 1024), { x: 0, y: 0, size: 1024 });
});

test("宽 > 高：左右各裁掉等宽留白", () => {
  assert.deepEqual(cropRect(1200, 800), { x: 200, y: 0, size: 800 });
});

test("高 > 宽：上下各裁掉等高留白", () => {
  assert.deepEqual(cropRect(800, 1200), { x: 0, y: 200, size: 800 });
});

test("非偶数差值的留白向下取整，源矩形仍是整数像素", () => {
  assert.deepEqual(cropRect(1001, 600), { x: 200, y: 0, size: 600 });
});

test("宽高读不出来（0 / 负数 / 非数字）时不裁切，交给页面提示换图", () => {
  assert.equal(cropRect(0, 100), null);
  assert.equal(cropRect(100, 0), null);
  assert.equal(cropRect(-4, 100), null);
  assert.equal(cropRect("100", 100), null);
  assert.equal(cropRect(Number.NaN, 100), null);
});

test("尺寸档位从常规档到降档：边长与质量都变小", () => {
  const normal = tierAt(0);
  const reduced = tierAt(1);
  assert.equal(normal.edge, 256);
  assert.equal(normal.quality, 0.82);
  assert.equal(reduced.edge, 160);
  assert.equal(reduced.quality, 0.7);
  assert.ok(reduced.edge < normal.edge);
  assert.ok(reduced.quality < normal.quality);
  assert.equal(AVATAR_TIERS.length, 2);
});

test("档位用完就没了：再要下一档返回 null", () => {
  assert.equal(tierAt(2), null);
  assert.equal(tierAt(-1), null);
});

test("编码回退顺序是 WebP → JPEG → PNG", () => {
  const plan = encodingPlan(tierAt(0));
  assert.deepEqual(
    plan.map((candidate) => candidate.mime),
    ["image/webp", "image/jpeg", "image/png"],
  );
});

test("编码候选带上该档的质量；PNG 无损，不给质量", () => {
  assert.deepEqual(encodingPlan(tierAt(0)), [
    { mime: "image/webp", quality: 0.82 },
    { mime: "image/jpeg", quality: 0.82 },
    { mime: "image/png", quality: null },
  ]);
  assert.deepEqual(
    encodingPlan(tierAt(1)).map((candidate) => candidate.quality),
    [0.7, 0.7, null],
  );
});

test("前缀检查只认 WebP 与 JPEG 的 data URL", () => {
  assert.equal(isTargetDataUrl("data:image/webp;base64,UklGRg=="), true);
  assert.equal(isTargetDataUrl("data:image/jpeg;base64,/9j/4A=="), true);
  assert.equal(isTargetDataUrl("data:image/png;base64,iVBORw0KGgo="), false);
  assert.equal(isTargetDataUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(isTargetDataUrl("data:text/html;base64,PGI+"), false);
});

test("非 data URL 一律判为非目标格式", () => {
  assert.equal(isTargetDataUrl("https://example.com/a.webp"), false);
  assert.equal(isTargetDataUrl("blob:https://example.com/1234"), false);
  assert.equal(isTargetDataUrl("data:image/webp,UklGRg=="), false);
  assert.equal(isTargetDataUrl(""), false);
  assert.equal(isTargetDataUrl(null), false);
  assert.equal(isTargetDataUrl(undefined), false);
});

test("能读出 data URL 声称的 MIME，用来核对浏览器是否真的给了 WebP", () => {
  assert.equal(dataUrlMime("data:image/webp;base64,UklGRg=="), "image/webp");
  assert.equal(dataUrlMime("data:image/jpeg;base64,/9j/4A=="), "image/jpeg");
  assert.equal(dataUrlMime("data:image/png;base64,iVBORw0KGgo="), "image/png");
  assert.equal(dataUrlMime("data:text/plain,hello"), null);
});

test("体积预算：恰好等于预算算未超限，多一个字节就算超限", () => {
  assert.equal(withinBudget(40 * 1024, 40 * 1024), true);
  assert.equal(withinBudget(40 * 1024 - 1, 40 * 1024), true);
  assert.equal(withinBudget(40 * 1024 + 1, 40 * 1024), false);
});

test("体积预算判断同时回答「超没超」与「还有没有下一档可降」", () => {
  assert.deepEqual(budgetVerdict(40960, AVATAR_BUDGET_BYTES, 0), { over: false, retryTier: null });

  const retry = budgetVerdict(50000, AVATAR_BUDGET_BYTES, 0);
  assert.equal(retry.over, true);
  assert.equal(retry.retryTier.name, "reduced");
  assert.equal(retry.retryTier.edge, 160);

  assert.deepEqual(budgetVerdict(50000, AVATAR_BUDGET_BYTES, 1), { over: true, retryTier: null });
});

test("客户端默认预算按 40KB 量级（本仓裁决）", () => {
  assert.equal(AVATAR_BUDGET_BYTES, 40 * 1024);
});

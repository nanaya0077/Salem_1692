import test from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_TIERS,
  budgetVerdict,
  cropRect,
  dataUrlMime,
  encodingPlan,
  isTargetDataUrl,
  matchesMime,
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
  const rect = cropRect(1001, 600);
  assert.deepEqual(rect, { x: 200, y: 0, size: 600 });
  // 取整后两侧只差 1 像素：左 200、右 201，加起来正好是原宽。
  assert.equal(rect.x, 200);
  assert.equal(1001 - rect.size - rect.x, 201);
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

test("核对「拿到的是不是我请求的格式」：WebP 位上的 PNG 要认出来", () => {
  const requested = "image/webp";
  assert.equal(matchesMime("data:image/webp;base64,UklGRg==", requested), true);
  assert.equal(matchesMime("data:image/webp;base64,UklGRg==", "image/jpeg"), false);
  // 浏览器对不支持的格式会静默返回 PNG，这里必须落空，页面才会退到下一个候选。
  assert.equal(matchesMime("data:image/png;base64,iVBORw0KGgo=", requested), false);
});

test("带参数的 data URL 不算目标格式：前缀按服务端逐字接受的样子认", () => {
  // 服务端只认 data:image/jpeg;base64, 这一种形状，带 charset 的串发过去也会被拒。
  assert.equal(dataUrlMime("data:image/jpeg;charset=utf-8;base64,/9j/4A=="), null);
  assert.equal(isTargetDataUrl("data:image/jpeg;charset=utf-8;base64,/9j/4A=="), false);
});

test("体积预算：恰好等于预算算未超限，多一个字节就算超限", () => {
  assert.equal(withinBudget(40 * 1024, 40 * 1024), true);
  assert.equal(withinBudget(40 * 1024 - 1, 40 * 1024), true);
  assert.equal(withinBudget(40 * 1024 + 1, 40 * 1024), false);
});

test("体积预算判断同时回答「超没超」与「还有没有下一档可降」", () => {
  const budget = 40 * 1024; // 40KB 量级，父票 #1 的裁决值；具体接线在 #4。

  assert.deepEqual(budgetVerdict(40960, budget, 0), { over: false, downgradeTo: null });

  const retry = budgetVerdict(50000, budget, 0);
  assert.equal(retry.over, true);
  assert.equal(retry.downgradeTo.name, "reduced");
  assert.equal(retry.downgradeTo.edge, 160);

  // 已经在最后一档还超限：超了，但没档可降，只能提示换图。
  assert.deepEqual(budgetVerdict(50000, budget, 1), { over: true, downgradeTo: null });
});

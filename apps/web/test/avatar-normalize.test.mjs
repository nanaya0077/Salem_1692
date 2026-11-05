import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AVATAR_BUDGET_BYTES,
  AVATAR_DOWNSCALED_TIER,
  AVATAR_REGULAR_TIER,
  budgetVerdict,
  encodingCandidates,
  estimateDataUrlBytes,
  isTargetAvatarDataUrl,
  squareCropRect,
  tierFor,
} from "../avatar-normalize.js";

// 源矩形自证：边长一致（正方形）、整块落在源图范围内、并且是从中心对称裁出来的。
function assertSquareWithin(rect, width, height) {
  const rectWidth = rect.size;
  const rectHeight = rect.size;
  assert.equal(rectWidth, rectHeight, "源矩形宽高必须相等");
  assert.ok(rect.size > 0, "源矩形边长必须为正");
  assert.ok(rect.sx >= 0 && rect.sy >= 0, "源矩形左上角不能越界到负坐标");
  assert.ok(rect.sx + rectWidth <= width, "源矩形右边界必须落在源图内");
  assert.ok(rect.sy + rectHeight <= height, "源矩形下边界必须落在源图内");
  assert.equal(rect.sx, (width - rectWidth) / 2, "水平方向必须居中");
  assert.equal(rect.sy, (height - rectHeight) / 2, "垂直方向必须居中");
}

test("裁切源矩形：正方形图取整张原图", () => {
  const rect = squareCropRect(800, 800);
  assert.deepEqual(rect, { sx: 0, sy: 0, size: 800 });
  assertSquareWithin(rect, 800, 800);
});

test("裁切源矩形：宽>高时按高裁切并水平居中", () => {
  const rect = squareCropRect(1200, 800);
  assert.deepEqual(rect, { sx: 200, sy: 0, size: 800 });
  assertSquareWithin(rect, 1200, 800);
});

test("裁切源矩形：高>宽时按宽裁切并垂直居中", () => {
  const rect = squareCropRect(600, 1000);
  assert.deepEqual(rect, { sx: 0, sy: 200, size: 600 });
  assertSquareWithin(rect, 600, 1000);
});

test("裁切源矩形：窄长图与奇数尺寸仍然是从中心取的方块", () => {
  const rect = squareCropRect(999, 1000);
  assert.equal(rect.size, 999);
  assert.equal(rect.sx, 0);
  assert.equal(rect.sy, 0.5);
  assertSquareWithin(rect, 999, 1000);
});

test("裁切源矩形：宽高为 0 或非数字时返回安全的零矩形（上层据此判断读不出尺寸）", () => {
  const cases = [
    [0, 800],
    [800, 0],
    [0, 0],
    [-800, 600],
    [Number.NaN, 600],
    [800, Number.NaN],
    [Number.POSITIVE_INFINITY, 800],
    ["800", 600],
    [null, 600],
    [undefined, undefined],
  ];
  for (const [width, height] of cases) {
    const rect = squareCropRect(width, height);
    assert.deepEqual(rect, { sx: 0, sy: 0, size: 0 }, `输入 ${String(width)}×${String(height)} 应返回零矩形`);
  }
});

test("目标档位：常规档 256 边长 / 质量 0.82", () => {
  assert.equal(AVATAR_REGULAR_TIER.edge, 256);
  assert.equal(AVATAR_REGULAR_TIER.quality, 0.82);
});

test("目标档位：降档 160 边长 / 质量 0.7，两个值都严格小于常规档", () => {
  assert.equal(AVATAR_DOWNSCALED_TIER.edge, 160);
  assert.equal(AVATAR_DOWNSCALED_TIER.quality, 0.7);
  assert.ok(AVATAR_DOWNSCALED_TIER.edge < AVATAR_REGULAR_TIER.edge, "降档边长必须更小");
  assert.ok(AVATAR_DOWNSCALED_TIER.quality < AVATAR_REGULAR_TIER.quality, "降档质量必须更低");
});

test("目标档位：按是否降档返回对应档位", () => {
  assert.equal(tierFor(false), AVATAR_REGULAR_TIER);
  assert.equal(tierFor(true), AVATAR_DOWNSCALED_TIER);
});

test("编码回退：顺序为 WebP → JPEG → PNG", () => {
  const candidates = encodingCandidates();
  assert.deepEqual(
    candidates.map((item) => item.mime),
    ["image/webp", "image/jpeg", "image/png"],
  );
});

test("编码回退：WebP 与 JPEG 带质量，PNG 不带质量参数", () => {
  const [webp, jpeg, png] = encodingCandidates();
  assert.equal(webp.quality, AVATAR_REGULAR_TIER.quality);
  assert.equal(jpeg.quality, AVATAR_REGULAR_TIER.quality);
  assert.equal(png.quality, undefined);
  assert.deepEqual(png, { mime: "image/png" });
});

test("编码回退：候选按传入档位取值，降档时质量更低", () => {
  const candidates = encodingCandidates(AVATAR_DOWNSCALED_TIER);
  assert.deepEqual(
    candidates.map((item) => item.mime),
    ["image/webp", "image/jpeg", "image/png"],
  );
  assert.equal(candidates[0].quality, 0.7);
  assert.equal(candidates[1].quality, 0.7);
  assert.equal(candidates[2].quality, undefined);
});

test("编码回退：每次调用给新数组，调用方改不动共享状态", () => {
  const first = encodingCandidates();
  first.push({ mime: "image/gif" });
  first[0].mime = "image/png";
  const second = encodingCandidates();
  assert.equal(second.length, 3);
  assert.equal(second[0].mime, "image/webp");
});

test("前缀检查：WebP 与 JPEG 的 data URL 是目标格式", () => {
  assert.equal(isTargetAvatarDataUrl("data:image/webp;base64,UklGRg=="), true);
  assert.equal(isTargetAvatarDataUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg=="), true);
});

test("前缀检查：PNG 与其它格式被判为非目标格式", () => {
  const rejected = [
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/webp,notbase64",
    "data:image/jpeg;base64",
    "https://example.com/a.webp",
  ];
  for (const value of rejected) {
    assert.equal(isTargetAvatarDataUrl(value), false, `${value} 不应被当成目标格式`);
  }
});

test("前缀检查：乱串、非字符串与超长垃圾一律为假", () => {
  const garbage = [
    "不是 data URL",
    "",
    " ",
    "data:",
    null,
    undefined,
    123,
    {},
    [],
    ["data:image/webp;base64,UklGRg=="],
    "x".repeat(200000),
    `data:image/${"x".repeat(200000)}`,
    `data:text/plain;base64,${"A".repeat(200000)}`,
  ];
  for (const value of garbage) {
    assert.equal(isTargetAvatarDataUrl(value), false, `${String(value).slice(0, 40)} 不应被当成目标格式`);
  }
});

test("体积预算：小于预算未超限", () => {
  assert.deepEqual(budgetVerdict(AVATAR_BUDGET_BYTES - 1), { over: false, needsDownscale: false });
});

test("体积预算：恰好等于预算算未超限（边界）", () => {
  assert.deepEqual(budgetVerdict(AVATAR_BUDGET_BYTES), { over: false, needsDownscale: false });
});

test("体积预算：超出预算 1 字节即超限并要求降档（边界）", () => {
  assert.deepEqual(budgetVerdict(AVATAR_BUDGET_BYTES + 1), { over: true, needsDownscale: true });
});

test("体积预算：可传入自定义预算", () => {
  assert.deepEqual(budgetVerdict(2048, 2048), { over: false, needsDownscale: false });
  assert.deepEqual(budgetVerdict(2049, 2048), { over: true, needsDownscale: true });
});

test("体积预算：降档后仍超限时不再要求继续降档", () => {
  assert.deepEqual(budgetVerdict(AVATAR_BUDGET_BYTES + 1, AVATAR_BUDGET_BYTES, true), {
    over: true,
    needsDownscale: false,
  });
});

test("体积预算：默认预算为 40KB", () => {
  assert.equal(AVATAR_BUDGET_BYTES, 40 * 1024);
});

test("data URL 字节估算：base64 长度换算回原始字节", () => {
  assert.equal(estimateDataUrlBytes("data:image/webp;base64,UklGRg=="), 4);
  assert.equal(estimateDataUrlBytes("data:image/jpeg;base64,QUJD"), 3);
  assert.equal(estimateDataUrlBytes(`data:image/png;base64,${"A".repeat(4000)}`), 3000);
});

test("data URL 字节估算：非法输入返回 0 而不是抛错", () => {
  for (const value of ["", "没有逗号", null, undefined, 42, {}]) {
    assert.equal(estimateDataUrlBytes(value), 0);
  }
  assert.equal(estimateDataUrlBytes("data:image/png;base64,"), 0);
});

test("模块不碰浏览器全局：不出现 document / window / canvas / Image 等标识符", async () => {
  const source = await readFile(new URL("../avatar-normalize.js", import.meta.url), "utf8");
  const forbidden = /\b(document|window|navigator|canvas|HTMLCanvasElement|OffscreenCanvas|Image|createImageBitmap|FileReader|Blob)\b/;
  assert.equal(forbidden.test(source), false, "决策模块不应出现 DOM / 浏览器 API 标识符");
});

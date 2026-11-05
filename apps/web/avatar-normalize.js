// 头像归一化的纯决策模块。
// 这里只回答「怎么裁、缩到多大、按什么格式与质量编码、超没超体积预算」，
// 不碰任何浏览器全局：解码、绘制与导出留在页面脚本里，渲染怎么变都不影响这些判断。
// 所有阈值都是本仓裁决（见 docs/research/avatar-upload-mobile-web-facts.md）。

/** 常规档：256 边长，质量 0.82。 */
export const AVATAR_REGULAR_TIER = Object.freeze({ edge: 256, quality: 0.82 });

/** 降档档位：160 边长，质量 0.7；两个值都严格小于常规档。 */
export const AVATAR_DOWNSCALED_TIER = Object.freeze({ edge: 160, quality: 0.7 });

/** 头像体积预算：40KB（解码后字节数，不是 data URL 字符串长度）。 */
export const AVATAR_BUDGET_BYTES = 40 * 1024;

/**
 * 目标 data URL 前缀白名单。
 * 标准允许编码器对不支持的格式静默回退 PNG，所以「请求了 WebP」不等于「拿到了 WebP」，
 * 必须用返回串前缀校验；PNG 不在此列，它是回落档而不是目标格式。
 */
export const AVATAR_TARGET_MIME_PREFIXES = Object.freeze([
  "data:image/webp;base64,",
  "data:image/jpeg;base64,",
]);

const ZERO_RECT = Object.freeze({ sx: 0, sy: 0, size: 0 });

function isPositiveSize(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 居中方形裁切的源矩形。
 * 正方形取整张；宽>高按高裁并水平居中；高>宽按宽裁并垂直居中。
 * 宽高为 0 / 非数字 / 非有限值时返回 {sx:0, sy:0, size:0}，让上层能判断「读不出尺寸」。
 *
 * @param {number} width 原图宽
 * @param {number} height 原图高
 * @returns {{ sx: number, sy: number, size: number }}
 */
export function squareCropRect(width, height) {
  if (!isPositiveSize(width) || !isPositiveSize(height)) return { ...ZERO_RECT };
  const size = Math.min(width, height);
  return { sx: (width - size) / 2, sy: (height - size) / 2, size };
}

/**
 * 取目标档位。
 *
 * @param {boolean} [reduced] 是否已降档
 * @returns {{ edge: number, quality: number }}
 */
export function tierFor(reduced) {
  return reduced ? AVATAR_DOWNSCALED_TIER : AVATAR_REGULAR_TIER;
}

/**
 * 按序尝试的编码候选：WebP → JPEG → PNG。
 * 质量取自档位；PNG 忽略质量参数，故不带 quality 字段。
 * 每次调用返回新数组，调用方改不动共享状态。
 *
 * @param {{ edge: number, quality: number }} [tier] 目标档位，默认常规档
 * @returns {{ mime: string, quality?: number }[]}
 */
export function encodingCandidates(tier = AVATAR_REGULAR_TIER) {
  const quality = tier.quality;
  return [
    { mime: "image/webp", quality },
    { mime: "image/jpeg", quality },
    { mime: "image/png" },
  ];
}

/**
 * 前缀检查：返回串是否真的是我们要的目标格式（WebP / JPEG）。
 * PNG 与任何非法串、非字符串都为假。
 *
 * @param {unknown} value 编码器返回的 data URL
 * @returns {boolean}
 */
export function isTargetAvatarDataUrl(value) {
  if (typeof value !== "string") return false;
  return AVATAR_TARGET_MIME_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * 体积预算判断：恰好等于预算算未超限。
 * 降档后仍超限的，`needsDownscale` 为假——说明该提示用户换一张，而不是继续降。
 *
 * @param {unknown} bytes 解码后字节数
 * @param {number} [budget] 预算，默认 40KB
 * @param {boolean} [reduced] 这批字节是否已经是降档后的产物
 * @returns {{ over: boolean, needsDownscale: boolean }}
 */
export function budgetVerdict(bytes, budget = AVATAR_BUDGET_BYTES, reduced = false) {
  const size = isPositiveSize(bytes) ? bytes : 0;
  const over = size > budget;
  return { over, needsDownscale: over && !reduced };
}

/**
 * data URL 的字节估算：只看 base64 载荷长度（含尾部 padding 修正），不读真实图片。
 * 用于在编码后、发送前判断体积；非法输入返回 0。
 *
 * @param {unknown} dataUrl
 * @returns {number}
 */
export function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== "string") return 0;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const payload = dataUrl.slice(comma + 1);
  if (payload.length === 0) return 0;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

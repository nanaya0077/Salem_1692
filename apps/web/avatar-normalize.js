/**
 * 头像归一化：只做「决策」，不碰 DOM、不碰 canvas、不发消息。
 *
 * 页面脚本负责解码、画布、文件选择与协议；这个模块只回答四类问题：
 * 1) 从原图里切哪一块方图（{@link cropRect}）；
 * 2) 这次要多少边长、多少质量（{@link AVATAR_TIERS} / {@link tierAt}）；
 * 3) 按什么顺序尝试编码格式（{@link encodingPlan}）；
 * 4) 拿到的 data URL 是不是服务端要的格式、体积是否超预算
 *    （{@link dataUrlMime} / {@link matchesMime} / {@link isTargetDataUrl} / {@link withinBudget}）。
 *
 * 纯函数、无副作用、不 import 任何东西：页面脚本接线之后，浏览器与 `node --test`
 * 跑的是同一份实现（接 app.js 与 service worker 缓存清单属于 #4）。
 */

/** 居中方形裁切：给定原图宽高，返回要切的正方形源矩形；宽高不可用时返回 null。 */
export function cropRect(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const size = Math.floor(Math.min(width, height));
  if (size < 1) return null;
  return {
    x: Math.floor((width - size) / 2),
    y: Math.floor((height - size) / 2),
    size,
  };
}

/**
 * 尺寸档位：先按常规档出图，超预算时按降档重试一次。
 * 降档的边长与质量都必须小于常规档，否则「重试」不会让体积变小。
 */
export const AVATAR_TIERS = Object.freeze([
  Object.freeze({ name: "normal", edge: 256, quality: 0.82 }),
  Object.freeze({ name: "reduced", edge: 160, quality: 0.7 }),
]);

/** 取第 index 档；index 越界（含负数）返回 null，表示没有下一档可用。 */
export function tierAt(index) {
  if (!Number.isInteger(index) || index < 0 || index >= AVATAR_TIERS.length) return null;
  return AVATAR_TIERS[index];
}

/**
 * 编码候选，按尝试顺序排列：WebP → JPEG → PNG。
 *
 * 顺序的理由是「小」与「可验证」：WebP 最省，但标准允许浏览器对不支持的格式
 * 静默返回 PNG，所以拿到结果后必须用 {@link dataUrlMime} / {@link matchesMime}
 * 核对前缀，不匹配才轮到 JPEG；两者都拿不到时才用 PNG，此时体积只能靠上限兜住。
 * PNG 无损，不传质量参数，故 quality 为 null。
 */
export function encodingPlan(tier) {
  if (!tier || !Number.isFinite(tier.quality)) throw new TypeError("encodingPlan 需要一档尺寸");
  return Object.freeze([
    Object.freeze({ mime: "image/webp", quality: tier.quality }),
    Object.freeze({ mime: "image/jpeg", quality: tier.quality }),
    Object.freeze({ mime: "image/png", quality: null }),
  ]);
}

/** 服务端只收这两种 data URL；PNG 与其它格式在这里就拦下，不浪费一次消息。 */
const TARGET_MIME = Object.freeze(["image/webp", "image/jpeg"]);

/**
 * 读出 data URL 自己声称的 MIME（小写）；不是 `data:<mime>;base64,` 形状就返回 null。
 * 形状按服务端逐字接受的前缀来认（`data:image/jpeg;base64,`），带额外参数的一律不认——
 * 那种串发过去也会被服务端拒掉。
 */
export function dataUrlMime(value) {
  if (typeof value !== "string") return null;
  const match = /^data:([a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*);base64,/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

/** 拿到的串是不是这次请求的那种格式：用来抓「请求 WebP、浏览器静默给 PNG」。 */
export function matchesMime(value, mime) {
  return typeof mime === "string" && dataUrlMime(value) === mime.toLowerCase();
}

/** 这个 data URL 能不能发给服务端：只认 WebP 与 JPEG。 */
export function isTargetDataUrl(value) {
  return TARGET_MIME.includes(dataUrlMime(value));
}

/** 体积是否在预算内；恰好等于预算算未超限（上限是闭区间）。 */
export function withinBudget(bytes, budget) {
  if (!Number.isFinite(bytes) || !Number.isFinite(budget) || bytes < 0 || budget < 0) return false;
  return bytes <= budget;
}

/**
 * 一次给出两个答案：是否超限，超限时降到哪一档。
 *
 * `tierIndex` 是刚用过的档位序号；`downgradeTo` 为 null 表示降档机会已用完，只能提示换图。
 * 两种 state 要分开读：over=false 是「过了」，over=true 且 downgradeTo=null 是「超限且无档可降」。
 */
export function budgetVerdict(bytes, budget, tierIndex) {
  const over = !withinBudget(bytes, budget);
  return { over, downgradeTo: over ? tierAt(tierIndex + 1) : null };
}

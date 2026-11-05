// 个人资料的本机存储与补传决策。
// 这里不碰 DOM：storage 以接口注入（getItem / setItem / removeItem），
// 这样配额失败、补传幂等这些容易出错的分支都能用 node --test 直接覆盖。
// 浏览器里只负责把本地存储包一层传进来，页面脚本只管弹层与图像管线。

import { isTargetDataUrl } from "./avatar-normalize.js";

/** 昵称沿用既有键。 */
export const NAME_KEY = "salem.name";
/** 头像存压缩后的 data URL。 */
export const AVATAR_KEY = "salem.avatar";
/** 服务端 safeName 的默认值，客户端先清洗一遍，两边口径保持一致。 */
export const DEFAULT_NAME = "玩家";
/** 昵称上限，单位是 UTF-16 码元，与 maxlength="16" 一致。 */
export const NAME_MAX = 16;

// 只认服务端白名单里的目标格式（WebP / JPEG）；PNG 是编码回落档，不落本地。
function isAvatarDataUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  return isTargetDataUrl(value);
}
/**
 * 昵称清洗：去控制字符与尖括号、trim、空则「玩家」、最多 16 字。
 * 与服务端 safeName 同一套规则，客户端提前清洗只是为了弹层里能立刻回显结果。
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function cleanName(raw) {
  const text = String(raw ?? "").replace(/[\u0000-\u001f<>]/g, "").trim();
  return (text || DEFAULT_NAME).slice(0, NAME_MAX);
}

/**
 * 个人资料存储。
 *
 * @param {{ getItem(key: string): string|null, setItem(key: string, value: string): void, removeItem(key: string): void }} storage
 * @param {{ send?: (message: { type: "profile", avatar: string }) => unknown }} [options] 发送器，补传时使用
 */
export function createProfileStore(storage, options = {}) {
  const send = typeof options.send === "function" ? options.send : () => {};
  // 同一次连接只补传一次；新连接（ws open）时由 beginConnection 重置。
  let reuploadedThisConnection = false;

  function read(key) {
    try {
      const value = storage.getItem(key);
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }

  function readName() {
    const value = read(NAME_KEY);
    return value === null ? "" : value;
  }

  function readAvatar() {
    const value = read(AVATAR_KEY);
    return isAvatarDataUrl(value) ? value : null;
  }

  /**
   * 写昵称。存储失败不阻断改名，只返回降级标记。
   *
   * @param {unknown} raw
   * @returns {{ ok: boolean, degraded: boolean, name: string }}
   */
  function writeName(raw) {
    const name = cleanName(raw);
    try {
      storage.setItem(NAME_KEY, name);
      return { ok: true, degraded: false, name };
    } catch {
      return { ok: false, degraded: true, name };
    }
  }

  /**
   * 写头像。配额失败时静默降级为「本次无头像」：顺手清掉可能残留的旧图，
   * 免得下次连接把用户以为已经换掉的图补传回去。
   *
   * @param {unknown} dataUrl
   * @returns {{ ok: boolean, degraded: boolean }}
   */
  function writeAvatar(dataUrl) {
    if (!isAvatarDataUrl(dataUrl)) return { ok: false, degraded: false };
    try {
      storage.setItem(AVATAR_KEY, dataUrl);
      return { ok: true, degraded: false };
    } catch {
      try {
        storage.removeItem(AVATAR_KEY);
      } catch {
        // 清不掉也不影响降级结论
      }
      return { ok: false, degraded: true };
    }
  }

  /** 移除头像：服务端同时会收到 avatar: null，这里只负责清本机。 */
  function removeAvatar() {
    try {
      storage.removeItem(AVATAR_KEY);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /** 每次 WebSocket 新建连接时调用，重置「本次连接已补传」的闸。 */
  function beginConnection() {
    reuploadedThisConnection = false;
  }

  /**
   * 连上后是否需要补传头像。
   * 条件：welcome.avatars 里没有自己的座位、本机存着头像、本连接还没补过。
   * 满足时直接调用注入的发送器，并返回 true。
   *
   * @param {{ avatars?: Record<string|number, string>|null, seatId?: number|null }} snapshot
   * @returns {boolean}
   */
  function maybeReupload(snapshot = {}) {
    if (reuploadedThisConnection) return false;
    const { avatars, seatId } = snapshot;
    if (seatId === null || seatId === undefined) return false;
    if (avatars && avatars[seatId]) return false;
    const stored = readAvatar();
    if (!stored) return false;
    reuploadedThisConnection = true;
    send({ type: "profile", avatar: stored });
    return true;
  }

  return {
    readName,
    readAvatar,
    writeName,
    writeAvatar,
    removeAvatar,
    beginConnection,
    maybeReupload,
  };
}

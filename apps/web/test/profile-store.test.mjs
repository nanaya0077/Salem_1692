import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AVATAR_KEY,
  DEFAULT_NAME,
  NAME_KEY,
  cleanName,
  createProfileStore,
  initialOf,
} from "../profile-store.js";

const WEBP = "data:image/webp;base64,UklGRg==";
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

// 测试用的存储替身：接口只取 getItem / setItem / removeItem 三个方法，
// 与浏览器的 Storage 形状一致，但不依赖 DOM。
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

// 写头像就抛 QuotaExceededError，写昵称正常：用来验证「配额失败不阻断改名」。
function quotaStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (key === AVATAR_KEY) {
        const error = new Error("存储配额不足");
        error.name = "QuotaExceededError";
        throw error;
      }
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("昵称清洗：去控制字符与尖括号、trim、空则默认名字", () => {
  assert.equal(cleanName("  阿比盖尔  "), "阿比盖尔");
  assert.equal(cleanName("阿<比>盖\u0000尔"), "阿比盖尔");
  assert.equal(cleanName("   "), DEFAULT_NAME);
  assert.equal(cleanName(undefined), DEFAULT_NAME);
  assert.equal(cleanName(null), DEFAULT_NAME);
});

test("昵称清洗：最多 16 字", () => {
  assert.equal(cleanName("a".repeat(20)), "a".repeat(16));
  assert.equal(cleanName("一二三四五六七八九十一二三四五六七八").length, 16);
});

test("首字：按字符取，emoji 昵称取整个 emoji 而不是半个代理对", () => {
  assert.equal(initialOf("🐱喵"), "🐱");
  assert.equal(initialOf("🌙"), "🌙");
  assert.equal(initialOf("阿比盖尔"), "阿");
  assert.equal(initialOf("  阿比  "), "阿");
});

test("首字：组合 emoji 取整个字素簇，不切出其中一段", () => {
  // 家庭 emoji 由 ZWJ 连接、国旗由两个区域指示符组成、肤色是修饰符，都是一整个字素簇。
  assert.equal(initialOf("👨‍👩‍👧家常"), "👨‍👩‍👧");
  assert.equal(initialOf("🇨🇳爱国者"), "🇨🇳");
  assert.equal(initialOf("👍🏽赞"), "👍🏽");
});

test("首字：单字符与仅一个 emoji 都取自身", () => {
  assert.equal(initialOf("阿"), "阿");
  assert.equal(initialOf("A"), "A");
});

test("首字：空串、空白串与非字符串回落到默认名字的首字", () => {
  const fallback = Array.from(DEFAULT_NAME)[0];
  assert.equal(initialOf(""), fallback);
  assert.equal(initialOf("   "), fallback);
  assert.equal(initialOf("\t\n"), fallback);
  assert.equal(initialOf(null), fallback);
  assert.equal(initialOf(undefined), fallback);
  assert.equal(initialOf(42), fallback);
});

test("读取：没写过时昵称是空串、头像为空", () => {
  const store = createProfileStore(memoryStorage());
  assert.equal(store.readName(), "");
  assert.equal(store.readAvatar(), null);
});

test("写入头像后能读回同一串（昵称同样按清洗后的值存回）", () => {
  const storage = memoryStorage();
  const store = createProfileStore(storage);
  assert.deepEqual(store.writeAvatar(WEBP), { ok: true, degraded: false });
  assert.equal(store.readAvatar(), WEBP);
  assert.equal(storage.map.get(AVATAR_KEY), WEBP);
  assert.equal(store.writeName("  阿比盖尔  ").ok, true);
  assert.equal(store.readName(), "阿比盖尔");
  assert.equal(storage.map.get(NAME_KEY), "阿比盖尔");
});

test("读取：非法头像值当作没有头像", () => {
  for (const bad of ["", "不是 data URL", "data:text/plain;base64,QUJD", 42]) {
    const store = createProfileStore(memoryStorage({ [AVATAR_KEY]: bad }));
    assert.equal(store.readAvatar(), null, `${String(bad)} 不应被当成头像`);
  }
});

test("寄存器报错：读不出存储时不抛错，按没写过处理", () => {
  const broken = {
    getItem() { throw new Error("拒绝访问"); },
    setItem() { throw new Error("拒绝访问"); },
    removeItem() { throw new Error("拒绝访问"); },
  };
  const store = createProfileStore(broken);
  assert.equal(store.readName(), "");
  assert.equal(store.readAvatar(), null);
  // 写昵称失败也不该把错误抛到上层
  assert.equal(store.writeName("阿比").ok, false);
  assert.equal(store.removeAvatar().ok, false);
});

test("配额失败：写头像返回降级且不抛错，昵称仍写入成功", () => {
  const storage = quotaStorage({ [AVATAR_KEY]: JPEG });
  const store = createProfileStore(storage);
  assert.deepEqual(store.writeAvatar(WEBP), { ok: false, degraded: true });
  // 没存下就当作没有头像，避免下次连接把旧图补传回去
  assert.equal(store.readAvatar(), null);
  assert.equal(storage.map.has(AVATAR_KEY), false);

  const written = store.writeName("写满也能改名");
  assert.equal(written.ok, true);
  assert.equal(store.readName(), "写满也能改名");
});

test("写入：非法 data URL 不落盘", () => {
  const storage = memoryStorage();
  const store = createProfileStore(storage);
  assert.deepEqual(store.writeAvatar("data:image/png;base64,iVBORw0KGgo="), {
    ok: false,
    degraded: false,
  });
  assert.equal(storage.map.has(AVATAR_KEY), false);
});

test("移除头像：读回为空，且不会再被补传", () => {
  const sent = [];
  const store = createProfileStore(memoryStorage({ [AVATAR_KEY]: WEBP }), {
    send: (message) => sent.push(message),
  });
  assert.equal(store.readAvatar(), WEBP);
  assert.equal(store.removeAvatar().ok, true);
  assert.equal(store.readAvatar(), null);
  store.beginConnection();
  assert.equal(store.maybeReupload({ avatars: {}, seatId: 3 }), false);
  assert.equal(sent.length, 0, "移除后的头像不该再补传");
});

test("补传：welcome 没有自己、本机有图 → 补发一次 profile", () => {
  const sent = [];
  const store = createProfileStore(memoryStorage({ [AVATAR_KEY]: WEBP }), {
    send: (message) => sent.push(message),
  });
  store.beginConnection();
  assert.equal(store.maybeReupload({ avatars: {}, seatId: 3 }), true);
  assert.deepEqual(sent, [{ type: "profile", avatar: WEBP }]);
});

test("补传：welcome 里有别的座位但没自己，仍然要补", () => {
  const sent = [];
  const store = createProfileStore(memoryStorage({ [AVATAR_KEY]: WEBP }), {
    send: (message) => sent.push(message),
  });
  store.beginConnection();
  assert.equal(store.maybeReupload({ avatars: { 5: JPEG }, seatId: 3 }), true);
  assert.equal(sent.length, 1);
});

test("补传：welcome 已有自己 → 不补发", () => {
  const sent = [];
  const store = createProfileStore(memoryStorage({ [AVATAR_KEY]: WEBP }), {
    send: (message) => sent.push(message),
  });
  store.beginConnection();
  assert.equal(store.maybeReupload({ avatars: { 3: JPEG }, seatId: 3 }), false);
  assert.equal(sent.length, 0);
});

test("补传：本机无图 → 不补发", () => {
  const sent = [];
  const store = createProfileStore(memoryStorage(), { send: (message) => sent.push(message) });
  store.beginConnection();
  assert.equal(store.maybeReupload({ avatars: {}, seatId: 3 }), false);
  assert.equal(sent.length, 0);
});

test("补传：同一次连接里重复调用只补一次", () => {
  const sent = [];
  const store = createProfileStore(memoryStorage({ [AVATAR_KEY]: WEBP }), {
    send: (message) => sent.push(message),
  });
  store.beginConnection();
  assert.equal(store.maybeReupload({ avatars: {}, seatId: 3 }), true);
  assert.equal(store.maybeReupload({ avatars: {}, seatId: 3 }), false);
  assert.equal(store.maybeReupload({ avatars: { 7: JPEG }, seatId: 3 }), false);
  assert.equal(sent.length, 1, "同一次连接只该发一条补传");
});

test("补传：重连（新连接）后可以再补一次", () => {
  const sent = [];
  const store = createProfileStore(memoryStorage({ [AVATAR_KEY]: WEBP }), {
    send: (message) => sent.push(message),
  });
  store.beginConnection();
  store.maybeReupload({ avatars: {}, seatId: 3 });
  store.beginConnection();
  store.maybeReupload({ avatars: {}, seatId: 3 });
  assert.equal(sent.length, 2);
});

test("补传：没有座位（还没进房）时不发消息", () => {
  const sent = [];
  const store = createProfileStore(memoryStorage({ [AVATAR_KEY]: WEBP }), {
    send: (message) => sent.push(message),
  });
  store.beginConnection();
  assert.equal(store.maybeReupload({ avatars: {} }), false);
  assert.equal(sent.length, 0);
});

test("模块不碰浏览器全局：不出现 document / window / canvas / Image 等标识符", async () => {
  const source = await readFile(new URL("../profile-store.js", import.meta.url), "utf8");
  const forbidden =
    /\b(document|window|navigator|canvas|HTMLCanvasElement|OffscreenCanvas|Image|createImageBitmap|FileReader|Blob|localStorage|sessionStorage)\b/;
  assert.equal(forbidden.test(source), false, "存储模块不应出现 DOM / 浏览器 API 标识符");
});

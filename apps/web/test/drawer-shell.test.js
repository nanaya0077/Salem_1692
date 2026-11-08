import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DRAWER_SLOTS,
  applyDrawerModel,
  drawerSlot,
  drawerSlots,
  isDrawerOpen,
  setDrawerOpen,
} from "../drawer-shell.js";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");

/** 一个够用的元素替身：壳只碰 textContent / hidden / disabled / innerHTML / classList。 */
function makeEl(name) {
  return {
    dataset: { slot: name },
    textContent: "",
    hidden: false,
    disabled: false,
    innerHTML: "",
    classList: {
      set: new Set(),
      toggle(cls, on) {
        if (on) this.set.add(cls);
        else this.set.delete(cls);
      },
      contains(cls) {
        return this.set.has(cls);
      },
    },
  };
}

/** 假根：只认 [data-slot="…"] 与 "[data-slot]" 两种选择器，正好覆盖壳的用法。 */
function makeRoot(names = DRAWER_SLOTS) {
  const els = new Map(names.map((name) => [name, makeEl(name)]));
  return {
    els,
    hidden: false,
    querySelector(selector) {
      const matched = /^\[data-slot="([^"]+)"\]$/.exec(selector);
      return matched ? els.get(matched[1]) ?? null : null;
    },
    querySelectorAll(selector) {
      return selector === "[data-slot]" ? [...els.values()] : [];
    },
  };
}

test("槽位清单是这一层的唯一契约", () => {
  assert.deepEqual([...DRAWER_SLOTS], [
    "head",
    "kicker",
    "clock",
    "title",
    "sub",
    "body",
    "cards",
    "waiting",
    "waitText",
    "note",
    "foot",
    "decline",
    "submit",
  ]);
  assert.equal(new Set(DRAWER_SLOTS).size, DRAWER_SLOTS.length);
});

test("缺槽返回 null，不抛错", () => {
  const root = makeRoot(["title"]);
  assert.equal(drawerSlot(root, "sub"), null);
  assert.equal(drawerSlot(null, "title"), null);
  assert.equal(drawerSlot(root, ""), null);
  assert.deepEqual(drawerSlots(root), ["title"]);
});

test("文本类槽位逐个写入，里层多一个空格都不许丢", () => {
  const root = makeRoot();
  applyDrawerModel(root, {
    kicker: "指控成立",
    title: "玛丽·沃伦 的身份卡 7 点（门槛 7）",
    sub: "选择要揭示的身份卡。",
    note: "超时或托管会自动取第一个未揭示位置。",
  });
  assert.equal(root.els.get("kicker").textContent, "指控成立");
  assert.equal(root.els.get("title").textContent, "玛丽·沃伦 的身份卡 7 点（门槛 7）");
  assert.equal(root.els.get("sub").textContent, "选择要揭示的身份卡。");
  assert.equal(root.els.get("note").textContent, "超时或托管会自动取第一个未揭示位置。");
});

test("选卡区写 innerHTML，收起时不重建内容", () => {
  const root = makeRoot();
  const html = '<button data-conspiracy-index="0">#1</button>';
  applyDrawerModel(root, { cardsHtml: html, cardsHidden: false });
  assert.equal(root.els.get("cards").innerHTML, html);
  assert.equal(root.els.get("cards").hidden, false);

  applyDrawerModel(root, { cardsHidden: true });
  assert.equal(root.els.get("cards").hidden, true);
  assert.equal(root.els.get("cards").innerHTML, html, "只改显隐，不该把已拼好的按钮冲掉");
});

test("等待层同时管显隐与文案", () => {
  const root = makeRoot();
  applyDrawerModel(root, { waiting: true, waitText: "已提交 3/4，等待其他玩家" });
  assert.equal(root.els.get("waiting").hidden, false);
  assert.equal(root.els.get("waitText").textContent, "已提交 3/4，等待其他玩家");

  applyDrawerModel(root, { waiting: false });
  assert.equal(root.els.get("waiting").hidden, true);
  assert.equal(
    root.els.get("waitText").textContent,
    "已提交 3/4，等待其他玩家",
    "收起等待层不该清文案",
  );
});

test("主按钮文案与禁用分开写", () => {
  const root = makeRoot();
  applyDrawerModel(root, { submitLabel: "选定（第 3 张）", submitDisabled: false });
  assert.equal(root.els.get("submit").textContent, "选定（第 3 张）");
  assert.equal(root.els.get("submit").disabled, false);

  applyDrawerModel(root, { submitDisabled: true });
  assert.equal(root.els.get("submit").disabled, true);
  assert.equal(root.els.get("submit").textContent, "选定（第 3 张）");
});

test("时钟空串等于隐藏，warn 单独 toggle", () => {
  const root = makeRoot();
  applyDrawerModel(root, { clockText: "20 秒", clockWarn: false });
  assert.equal(root.els.get("clock").textContent, "20 秒");
  assert.equal(root.els.get("clock").hidden, false);
  assert.equal(root.els.get("clock").classList.contains("warn"), false);

  applyDrawerModel(root, { clockText: "4 秒", clockWarn: true });
  assert.equal(root.els.get("clock").classList.contains("warn"), true);

  applyDrawerModel(root, { clockText: "" });
  assert.equal(root.els.get("clock").hidden, true);
});

test("没给的字段一律不动——倒计时可以只写时钟", () => {
  const root = makeRoot();
  applyDrawerModel(root, {
    title: "约翰 的身份卡",
    sub: "从左邻手里取一张身份卡。",
    note: "超时或托管会自动取第一个未揭示位置。",
    submitLabel: "选定",
    submitDisabled: true,
  });
  const before = {
    title: root.els.get("title").textContent,
    sub: root.els.get("sub").textContent,
    note: root.els.get("note").textContent,
    submit: root.els.get("submit").textContent,
    disabled: root.els.get("submit").disabled,
  };

  applyDrawerModel(root, { clockText: "18 秒", clockWarn: false });

  assert.equal(root.els.get("title").textContent, before.title);
  assert.equal(root.els.get("sub").textContent, before.sub);
  assert.equal(root.els.get("note").textContent, before.note);
  assert.equal(root.els.get("submit").textContent, before.submit);
  assert.equal(root.els.get("submit").disabled, before.disabled);
});

test("开合只认 hidden 属性", () => {
  const root = makeRoot();
  setDrawerOpen(root, true);
  assert.equal(root.hidden, false);
  assert.equal(isDrawerOpen(root), true);

  setDrawerOpen(root, false);
  assert.equal(root.hidden, true);
  assert.equal(isDrawerOpen(root), false);
  assert.equal(isDrawerOpen(null), false);
});

test("两个抽屉都按契约摆好槽位（传染没有「放弃」）", async () => {
  const html = await readFile(join(webRoot, "index.html"), "utf8");
  const readSlots = (id) => {
    const at = html.indexOf('id="' + id + '"');
    assert.ok(at > 0, "index.html 缺 #" + id);
    // 抽屉块长度有限（14 个槽 + 一层容器），窗口取窄一点免得吃进下一个面板的槽位。
    const slice = html.slice(at, at + 1400);
    return { slice, found: [...slice.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]) };
  };
  const conspiracy = readSlots("conspiracyBar");
  const reveal = readSlots("revealDrawer");

  for (const name of DRAWER_SLOTS) {
    assert.ok(reveal.found.includes(name), "挂起揭示抽屉缺槽位：" + name);
  }
  assert.equal(reveal.found.length, DRAWER_SLOTS.length, "挂起揭示抽屉的槽位不该多也不该少");

  for (const name of DRAWER_SLOTS) {
    if (name === "decline") continue; // 传染一次点击即提交，没有「放弃」
    assert.ok(conspiracy.found.includes(name), "传染抽屉缺槽位：" + name);
  }
  assert.equal(conspiracy.found.length, DRAWER_SLOTS.length - 1);

  for (const { slice } of [conspiracy, reveal]) {
    assert.ok(slice.includes('data-slot-root="drawer"'), "根上要有 data-slot-root 标记");
    assert.ok(slice.includes('aria-modal="false"'), "抽屉是 dialog 语义，但不吞焦点");
    assert.ok(slice.includes('role="dialog"'));
  }
});

test("传染改用壳：不再自己摸标题、副标与卡片的 DOM", async () => {
  const app = await readFile(join(webRoot, "app.js"), "utf8");
  assert.ok(app.includes('import { applyDrawerModel, setDrawerOpen } from "./drawer-shell.js";'));

  const start = app.indexOf("function renderConspiracy()");
  const end = app.indexOf("function updateConspiracyClock()");
  assert.ok(start > 0 && end > start, "两个函数都要在");
  const body = app.slice(start, end);

  assert.ok(body.includes("applyDrawerModel(bar, {"), "走壳写内容");
  assert.ok(body.includes("setDrawerOpen(bar, true)"));
  assert.ok(body.includes("setDrawerOpen(bar, false)"));
  assert.ok(!body.includes('$("conspiracyTitle").textContent'), "标题该走 title 槽");
  assert.ok(!body.includes('$("conspiracySub").textContent'), "副标该走 sub 槽");
  assert.ok(!body.includes('$("conspiracyCards").innerHTML'), "卡片该走 cardsHtml");
  assert.ok(!body.includes('$("conspiracySubmit").disabled'), "提交键该走 submitDisabled");
  assert.ok(!body.includes('$("conspiracyWaitText")'), "等待文案该走 waitText");
  assert.ok(!body.includes("bar.hidden = true") && !body.includes("bar.hidden = false"));

  // 时钟独立更新，只写两个槽
  const clock = app.slice(end, end + 700);
  assert.ok(clock.includes("applyDrawerModel(bar, {"));
  assert.ok(clock.includes("clockText:"));
  assert.ok(clock.includes("clockWarn:"));
  assert.ok(!clock.includes('$("conspiracyClock").textContent'), "时钟也该走槽位");
});

test("drawer-shell.js 进壳且版本跟着升", async () => {
  const sw = await readFile(join(webRoot, "sw.js"), "utf8");
  assert.match(sw, /const VERSION = "salem-v23"/);
  const shell = sw.slice(sw.indexOf("const SHELL = ["), sw.indexOf("];", sw.indexOf("const SHELL = [")));
  assert.ok(shell.includes('"/drawer-shell.js"'), "预缓存清单要有壳");
  const cacheable = sw.slice(sw.indexOf("const cacheable"));
  assert.ok(cacheable.includes('"/drawer-shell.js"'), "运行时缓存白名单也要有壳");
});

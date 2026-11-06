import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { trialTone } from "../table-view.js";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const app = readFileSync(join(web, "app.js"), "utf8");

// 身份卡的角标颜色要和座位点阵一致：两边共用同一个映射，谁也别各写一份。
test("身份卡类型映射到座位点阵的颜色角标", () => {
  assert.equal(trialTone("witch"), "witch");
  assert.equal(trialTone("constable"), "constable");
  assert.equal(trialTone("townspeople"), "on");
  assert.equal(trialTone(null), "on");
  assert.equal(trialTone(undefined), "on");
});

test("座位点阵与身份卡卡片条共用 trialTone，不各写一份颜色", () => {
  assert.ok(app.includes("trialTone("), "app.js 要用 trialTone 出角标颜色");
  assert.equal((app.match(/kind === "witch" \? "witch"/g) ?? []).length, 0, "app.js 不该再手写 witch/constable 的颜色三元式");
});

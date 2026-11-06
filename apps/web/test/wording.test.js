import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRIAL_LABELS } from "../table-view.js";

// 缝：展示层文案。扫描真正下发的代码与资源，不扫 docs/ 里的历史记录。

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "test" || entry.startsWith(".") || entry === "_shots") continue;
      walk(full, out);
    } else if (/\.(js|mjs|ts|html|css|webmanifest)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function shippedFiles() {
  return [
    ...walk(join(ROOT, "apps", "web")),
    ...walk(join(ROOT, "apps", "server", "src")),
    ...walk(join(ROOT, "packages", "rules", "src")),
  ];
}

test("身份卡相关的下发文案里不再出现「治安官」", () => {
  const offenders = shippedFiles()
    .filter((file) => readFileSync(file, "utf8").includes("治安官"))
    .map((file) => file.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.deepEqual(offenders, []);
});

test("卡牌资源与页面文案一致：整份下发资源里也没有「治安官」", () => {
  const catalog = readFileSync(join(ROOT, "assets", "cards", "cards.zh.json"), "utf8");
  assert.equal(catalog.includes("治安官"), false);
});

test("身份卡标签与卡牌资源里的三张 trial 卡同名", () => {
  const catalog = JSON.parse(readFileSync(join(ROOT, "assets", "cards", "cards.zh.json"), "utf8"));
  const nameOf = (id) => catalog.cards.find((c) => c.id === id)?.name;
  assert.equal(TRIAL_LABELS.witch, nameOf("witch"));
  assert.equal(TRIAL_LABELS.constable, nameOf("constable"));
  assert.equal(TRIAL_LABELS.townspeople, nameOf("not-a-witch"));
});

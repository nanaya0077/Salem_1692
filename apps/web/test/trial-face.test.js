import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TRIAL_FACE_CARD, TRIAL_BACK_IMAGE, trialFaceCardId } from "../table-view.js";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "..", "..", "..", "assets", "cards", "cards.zh.json"), "utf8"));

// 身份卡只有女巫 / 警长 / 平民三种牌面；类型 → 卡牌资源的映射写死在这里，
// 免得界面各处自己拼 id（例如把 townspeople 拼成 townspeople.png）。
test("身份卡类型映射到卡牌资源里的三张 trial 卡", () => {
  assert.equal(trialFaceCardId("witch"), "witch");
  assert.equal(trialFaceCardId("constable"), "constable");
  assert.equal(trialFaceCardId("townspeople"), "not-a-witch");
  assert.equal(trialFaceCardId("unknown-kind"), null);
  assert.equal(trialFaceCardId(null), null);
  for (const id of Object.values(TRIAL_FACE_CARD)) {
    const resource = catalog.cards.find((c) => c.id === id);
    assert.ok(resource, "卡牌资源里缺 " + id);
    assert.equal(resource.kind, "trial");
  }
});

test("身份卡牌背用资源目录里的 back-trial 图，不进卡牌 JSON", () => {
  assert.equal(TRIAL_BACK_IMAGE, "assets/cards/zh/back-trial.png");
});

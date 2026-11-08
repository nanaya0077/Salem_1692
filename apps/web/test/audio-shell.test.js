import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repoDir = path.resolve(here, "../../..");
const web = (...parts) => readFile(path.join(webDir, ...parts), "utf8");

const {
  AUDIO_MANIFEST,
  SHORT_SFX_IDS,
  audioGainForLevel,
} = await import("../audio.js");

test("首批音频清单是 6 条短音效 + 1 条夜晚环境垫", () => {
  assert.deepEqual(
    Object.keys(AUDIO_MANIFEST).sort(),
    [
      "amb.night",
      "sfx.card.play",
      "sfx.life.death",
      "sfx.phase.dawn",
      "sfx.reveal.flip",
      "sfx.timer.warn",
      "sfx.ui.tap",
    ],
  );
  assert.deepEqual(SHORT_SFX_IDS.slice().sort(), [
    "sfx.card.play",
    "sfx.life.death",
    "sfx.phase.dawn",
    "sfx.reveal.flip",
    "sfx.timer.warn",
    "sfx.ui.tap",
  ]);
  for (const entry of Object.values(AUDIO_MANIFEST)) {
    assert.match(entry.file, /^[a-z0-9.]+\.mp3$/);
  }
});

test("音频文件存在且符合体积预算", async () => {
  const dir = path.join(repoDir, "assets", "audio");
  let total = 0;
  for (const entry of Object.values(AUDIO_MANIFEST)) {
    const info = await stat(path.join(dir, entry.file));
    assert.ok(info.isFile(), entry.file);
    assert.ok(info.size > 0, entry.file);
    total += info.size;
    if (entry.kind === "ambience") assert.ok(info.size <= 200 * 1024, "环境垫 ≤200KB");
    else assert.ok(info.size <= 40 * 1024, "短音效 ≤40KB");
  }
  assert.ok(total <= 500 * 1024, "首批音频总量 ≤500KB");
});

test("三档音量只有全开/减弱/关，不设独立静音", () => {
  assert.equal(audioGainForLevel("full"), 0.6);
  assert.equal(audioGainForLevel("reduced"), 0.24);
  assert.equal(audioGainForLevel("off"), 0);
  assert.equal(audioGainForLevel("whatever"), 0.6);
});

test("解锁发生在手势同步栈，先 resume 再异步预解码", async () => {
  const audio = await web("audio.js");
  assert.match(audio, /if \(!ctx\) \{[\s\S]*ctx = new AC\(\);[\s\S]*ctx\.resume\(\);/);
  assert.match(audio, /const resumed = ctx\.resume\(\);/);
  assert.match(audio, /decodeAudioData/);
  assert.match(audio, /if \(ambientRequested\) startAmbience\(\)/);
  assert.match(audio, /if \(level === "off" \|\| !unlocked/);
});

test("app.js 在首次手势解锁，并接上六个事件音效", async () => {
  const app = await web("app.js");
  assert.match(app, /from "\.\/audio\.js"/);
  assert.match(app, /initAudio\(getMotionLevel\(\)\)/);
  assert.match(app, /document\.addEventListener\(type, unlockAudio, true\)/);
  assert.match(app, /unlockAudio\(\);\s*const target = event\.target\.closest/);
  for (const id of [
    "sfx.ui.tap",
    "sfx.card.play",
    "sfx.reveal.flip",
    "sfx.life.death",
    "sfx.timer.warn",
    "sfx.phase.dawn",
  ]) {
    assert.ok(app.includes('playSfx("' + id + '")'), id);
  }
  assert.match(app, /setAudioPhase\(p\.phase\)/);
  assert.match(app, /setAudioLevel\(getMotionLevel\(\)\)/);
});

test("PWA 只预缓存 audio.js，音频文件走 /assets/ 按需缓存", async () => {
  const sw = await web("sw.js");
  assert.match(sw, /const VERSION = "salem-v17"/);
  assert.ok(sw.includes('"/audio.js"'));
  assert.doesNotMatch(sw, /"\/assets\/audio\//);
});

test("授权登记覆盖全部 7 条素材并注明 CC0", async () => {
  const credits = await readFile(path.join(repoDir, "docs", "research", "audio-credits.md"), "utf8");
  assert.match(credits, /CC0 1\.0/);
  for (const entry of Object.values(AUDIO_MANIFEST)) {
    assert.ok(credits.includes(entry.file), entry.file);
  }
  assert.match(credits, /脚本.*合成|合成.*脚本/);
});


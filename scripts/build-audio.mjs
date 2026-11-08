#!/usr/bin/env node
// 合成 assets/audio 下的音效。源在代码里，产物是普通静态文件，不进构建链（#39 §7）。
//
//   node scripts/build-audio.mjs                  只生成缺失的
//   node scripts/build-audio.mjs --force          全部重生成（会替换线上听感，慎用）
//   node scripts/build-audio.mjs sfx.ui.tap ...   只处理点名的
//
// 需要本机有 ffmpeg（只用来把 PCM 编成 mp3）。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets", "audio");
const TMP_DIR = join(ROOT, ".tmp-audio");
const RATE = 44100;

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((arg) => !arg.startsWith("--"));

function makeBuffer(seconds) {
  return new Float32Array(Math.round(RATE * seconds));
}

function addTone(buf, { from, freq, to = freq, dur, gain = 1, shape = "sine", decay = 0 }) {
  const start = Math.round(from * RATE);
  const length = Math.round(dur * RATE);
  let phase = 0;
  for (let i = 0; i < length && start + i < buf.length; i += 1) {
    const t = i / length;
    const f = freq + (to - freq) * t;
    phase += (2 * Math.PI * f) / RATE;
    const wave = shape === "square" ? Math.sign(Math.sin(phase)) : Math.sin(phase);
    const fade = Math.min(1, i / 220, (length - i) / 220);
    const decayFactor = decay > 0 ? Math.exp(-decay * t) : 1;
    buf[start + i] += wave * gain * fade * decayFactor;
  }
}

function addNoise(buf, { from, dur, gain = 1, decay = 0, smooth = 0 }) {
  const start = Math.round(from * RATE);
  const length = Math.round(dur * RATE);
  let previous = 0;
  for (let i = 0; i < length && start + i < buf.length; i += 1) {
    const t = i / length;
    const raw = Math.random() * 2 - 1;
    previous = smooth > 0 ? previous + (raw - previous) * (1 - smooth) : raw;
    const fade = Math.min(1, i / 200, (length - i) / 200);
    const decayFactor = decay > 0 ? Math.exp(-decay * t) : 1;
    buf[start + i] += previous * gain * fade * decayFactor;
  }
}

function normalize(buf, peak = 0.86) {
  let max = 0;
  for (const value of buf) max = Math.max(max, Math.abs(value));
  if (max === 0) return buf;
  const scale = peak / max;
  for (let i = 0; i < buf.length; i += 1) buf[i] *= scale;
  return buf;
}

function toWav(samples) {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

// 每条音效一个合成函数，返回 Float32Array。改这里就能改听感。
const RECIPES = {
  "sfx.ui.tap": () => {
    const buf = makeBuffer(0.12);
    addTone(buf, { from: 0, freq: 1180, to: 820, dur: 0.1, gain: 0.9, decay: 2.4 });
    addNoise(buf, { from: 0, dur: 0.03, gain: 0.18, decay: 3 });
    return normalize(buf, 0.7);
  },
  "sfx.card.play": () => {
    const buf = makeBuffer(0.26);
    addNoise(buf, { from: 0, dur: 0.2, gain: 0.55, decay: 1.6, smooth: 0.72 });
    addTone(buf, { from: 0.02, freq: 320, to: 180, dur: 0.16, gain: 0.5, decay: 2.2 });
    return normalize(buf, 0.76);
  },
  "sfx.reveal.flip": () => {
    const buf = makeBuffer(0.42);
    addNoise(buf, { from: 0, dur: 0.26, gain: 0.5, decay: 1.2, smooth: 0.6 });
    addTone(buf, { from: 0.1, freq: 660, to: 990, dur: 0.24, gain: 0.42, decay: 1.8 });
    addTone(buf, { from: 0.24, freq: 1320, dur: 0.16, gain: 0.22, decay: 2.6 });
    return normalize(buf, 0.8);
  },
  "sfx.life.death": () => {
    const buf = makeBuffer(1.2);
    addTone(buf, { from: 0, freq: 220, to: 62, dur: 1.1, gain: 0.85, decay: 1.4 });
    addTone(buf, { from: 0.06, freq: 110, to: 55, dur: 1.0, gain: 0.5, decay: 1.6 });
    addNoise(buf, { from: 0, dur: 0.5, gain: 0.22, decay: 2.2, smooth: 0.86 });
    return normalize(buf, 0.84);
  },
  "sfx.timer.warn": () => {
    const buf = makeBuffer(0.3);
    addTone(buf, { from: 0, freq: 880, dur: 0.09, gain: 0.6, decay: 2 });
    addTone(buf, { from: 0.12, freq: 880, dur: 0.09, gain: 0.5, decay: 2 });
    return normalize(buf, 0.72);
  },
  "sfx.phase.dawn": () => {
    const buf = makeBuffer(0.9);
    addTone(buf, { from: 0, freq: 392, dur: 0.7, gain: 0.4, decay: 1.1 });
    addTone(buf, { from: 0.04, freq: 587, dur: 0.7, gain: 0.34, decay: 1.1 });
    addTone(buf, { from: 0.08, freq: 784, dur: 0.7, gain: 0.28, decay: 1.2 });
    addNoise(buf, { from: 0.1, dur: 0.5, gain: 0.07, smooth: 0.94 });
    return normalize(buf, 0.7);
  },
  "sfx.conspiracy.start": () => {
    const buf = makeBuffer(0.5);
    // 低频下坠：阴谋压下来
    addTone(buf, { from: 0, freq: 168, to: 68, dur: 0.44, gain: 0.9, decay: 1.3 });
    addTone(buf, { from: 0, freq: 336, to: 150, dur: 0.36, gain: 0.32, decay: 1.8 });
    // 一点金属摩擦：黑猫与印章
    addNoise(buf, { from: 0.12, dur: 0.22, gain: 0.28, decay: 1.5, smooth: 0.5 });
    addTone(buf, { from: 0.3, freq: 2360, to: 1980, dur: 0.1, gain: 0.16, decay: 3 });
    return normalize(buf, 0.82);
  },
  "amb.night": () => {
    const seconds = 10;
    const buf = makeBuffer(seconds);
    // 三层缓慢起伏的低频垫，10 秒可无缝循环（首尾都归零）
    const layers = [
      { freq: 55, gain: 0.5, period: 10 },
      { freq: 82.5, gain: 0.28, period: 5 },
      { freq: 110, gain: 0.16, period: 2.5 },
    ];
    for (const layer of layers) {
      const cycles = Math.round(seconds / layer.period);
      for (let i = 0; i < buf.length; i += 1) {
        const t = i / RATE;
        const lfo = 0.5 + 0.5 * Math.sin((2 * Math.PI * cycles * t) / seconds - Math.PI / 2);
        buf[i] += Math.sin(2 * Math.PI * layer.freq * t) * layer.gain * (0.35 + 0.65 * lfo);
      }
    }
    addNoise(buf, { from: 0, dur: seconds, gain: 0.05, smooth: 0.97 });
    // 循环缝：两端各 0.6 秒交叉淡化
    const edge = Math.round(RATE * 0.6);
    for (let i = 0; i < edge; i += 1) {
      const k = i / edge;
      buf[i] *= k;
      buf[buf.length - 1 - i] *= k;
    }
    return normalize(buf, 0.62);
  },
};

function encode(id, samples) {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  const wavPath = join(TMP_DIR, `${id}.wav`);
  writeFileSync(wavPath, toWav(samples));
  const mp3Path = join(OUT_DIR, `${id}.mp3`);
  execFileSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "96k", "-ac", "1", "-ar", String(RATE), mp3Path],
    { stdio: "inherit" },
  );
  return mp3Path;
}

function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const ids = only.length > 0 ? only : Object.keys(RECIPES);
  let built = 0;
  let skipped = 0;
  for (const id of ids) {
    const recipe = RECIPES[id];
    if (!recipe) throw new Error(`没有这条音效的合成配方: ${id}`);
    const target = join(OUT_DIR, `${id}.mp3`);
    if (!force && existsSync(target)) {
      skipped += 1;
      console.log(`skip  ${id}（已存在，要重生成加 --force）`);
      continue;
    }
    const path = encode(id, recipe());
    built += 1;
    console.log(`build ${id} -> ${path.replace(ROOT, ".")}`);
  }
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\n完成：生成 ${built} 条，跳过 ${skipped} 条。`);
}

main();

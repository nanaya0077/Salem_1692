/**
 * 事件音效与环境垫。
 *
 * 三条硬约束来自研究票 #39：
 * 1. 首次真实手势里同步创建 / resume AudioContext，解锁前不补播；
 * 2. 音量只跟随动效三档（全开 / 减弱 / 关），不做独立静音开关；
 * 3. 音频永远只是增强：加载失败、解码失败、没有 AudioContext 时静默降级，
 *    夜晚与翻牌的信息必须仍有视觉等价物。
 */

export const AUDIO_BASE = "/assets/audio/";

export const AUDIO_MANIFEST = {
  "sfx.ui.tap": { file: "sfx.ui.tap.mp3", kind: "sfx" },
  "sfx.card.play": { file: "sfx.card.play.mp3", kind: "sfx" },
  "sfx.reveal.flip": { file: "sfx.reveal.flip.mp3", kind: "sfx" },
  "sfx.life.death": { file: "sfx.life.death.mp3", kind: "sfx" },
  "sfx.timer.warn": { file: "sfx.timer.warn.mp3", kind: "sfx" },
  "sfx.phase.dawn": { file: "sfx.phase.dawn.mp3", kind: "sfx" },
  "sfx.conspiracy.start": { file: "sfx.conspiracy.start.mp3", kind: "sfx" },
  "amb.night": { file: "amb.night.mp3", kind: "ambience" },
};

export const SHORT_SFX_IDS = Object.freeze(
  Object.keys(AUDIO_MANIFEST).filter((id) => AUDIO_MANIFEST[id].kind === "sfx"),
);

export const AUDIO_LEVELS = Object.freeze(["full", "reduced", "off"]);

/** 触觉四档：none 不调，short 12ms，long 35ms，double 是「两下短」。 */
export const HAPTIC_PATTERNS = Object.freeze({ short: 12, long: 35, double: [0, 18, 80, 18] });

/** 主增益：全开 0.6，减弱 0.24（×0.4），关 0。 */
export function audioGainForLevel(level) {
  if (level === "off") return 0;
  if (level === "reduced") return 0.24;
  return 0.6;
}

let ctx = null;
let master = null;
let level = "full";
let unlocked = false;
let unlockPromise = null;
let ambientRequested = false;
let ambience = null;
const buffers = new Map();
const loading = new Map();
const failed = new Set();

function AudioCtor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function now() {
  return ctx ? ctx.currentTime : 0;
}

/** 读侧状态，测试与调试用；不暴露 AudioContext 本身。 */
export function getAudioState() {
  return {
    unlocked,
    level,
    hasContext: Boolean(ctx),
    buffers: [...buffers.keys()],
    ambience: Boolean(ambience),
    ambientRequested,
  };
}

export function initAudio(initialLevel = "full") {
  setAudioLevel(initialLevel);
}

export function setAudioLevel(next) {
  level = AUDIO_LEVELS.includes(next) ? next : "full";
  if (ctx && master) {
    const t = now();
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(audioGainForLevel(level), t, 0.01);
  }
  if (level === "off") stopAmbience();
  else if (ambientRequested) startAmbience();
  return level;
}

function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    const result = ctx.decodeAudioData(data, resolve, reject);
    if (result && typeof result.then === "function") result.then(resolve, reject);
  });
}

function loadBuffer(id) {
  if (buffers.has(id)) return Promise.resolve(buffers.get(id));
  if (failed.has(id)) return Promise.resolve(null);
  if (loading.has(id)) return loading.get(id);
  const entry = AUDIO_MANIFEST[id];
  if (!entry || !ctx) return Promise.resolve(null);
  const job = fetch(AUDIO_BASE + entry.file, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("audio " + id + " " + response.status);
      return response.arrayBuffer();
    })
    .then((data) => decode(ctx, data))
    .then((buffer) => {
      if (buffer) buffers.set(id, buffer);
      return buffer || null;
    })
    .catch(() => {
      failed.add(id);
      return null;
    })
    .finally(() => { loading.delete(id); });
  loading.set(id, job);
  return job;
}

function preloadShort() {
  return Promise.allSettled(SHORT_SFX_IDS.map((id) => loadBuffer(id)));
}

/**
 * 必须在真实手势的同步栈里调用：先 new AudioContext + resume()，再异步拉文件。
 * 返回的 promise 只用于测试/调试，播放路径不 await 它。
 */
export function unlockAudio() {
  if (unlockPromise) return unlockPromise;
  const AC = AudioCtor();
  if (!AC) return Promise.resolve(false);
  try {
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = audioGainForLevel(level);
      master.connect(ctx.destination);
    }
    // 这一行必须在手势同步栈里执行，不能放进 await 之后。
    const resumed = ctx.resume();
    unlocked = true;
    unlockPromise = Promise.resolve(resumed)
      .catch(() => {})
      .then(() => preloadShort())
      .then(() => {
        if (ambientRequested) startAmbience();
        return true;
      })
      .catch(() => true);
    return unlockPromise;
  } catch {
    return Promise.resolve(false);
  }
}

/** 播一条短音效；未解锁、关档、未预解码都直接跳过，绝不延迟补播。 */
export function playSfx(id) {
  if (level === "off" || !unlocked || !ctx || !master) return false;
  if (!AUDIO_MANIFEST[id] || AUDIO_MANIFEST[id].kind !== "sfx") return false;
  const buffer = buffers.get(id);
  if (!buffer) {
    loadBuffer(id);
    return false;
  }
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start();
    return true;
  } catch {
    return false;
  }
}

/** phase 变化时调用；night 起环境垫，其他相位淡出。 */
export function setAudioPhase(phase) {
  ambientRequested = phase === "night";
  if (ambientRequested) startAmbience();
  else stopAmbience();
}

function startAmbience() {
  ambientRequested = true;
  if (level === "off" || !unlocked || !ctx || !master || ambience) return;
  const buffer = buffers.get("amb.night");
  if (!buffer) {
    loadBuffer("amb.night").then((loaded) => {
      if (loaded && ambientRequested) startAmbience();
    });
    return;
  }
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(master);
    source.start();
    gain.gain.linearRampToValueAtTime(0.55, now() + 0.4);
    ambience = { source, gain };
  } catch {
    ambience = null;
  }
}

function stopAmbience() {
  if (!ambience || !ctx) {
    ambience = null;
    return;
  }
  const { source, gain } = ambience;
  ambience = null;
  try {
    const t = now();
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.6);
    source.stop(t + 0.65);
  } catch {
    try { source.stop(); } catch {}
  }
}

/**
 * 触觉反馈：只在支持 Vibration API 且档位不是 off 时触发。
 * iOS Safari 从未实现该 API，这里静默跳过——不提示、不承载任何信息（#39 §5）。
 */
export function haptic(mode) {
  if (level === "off") return false;
  const pattern = HAPTIC_PATTERNS[mode];
  if (pattern === undefined) return false;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

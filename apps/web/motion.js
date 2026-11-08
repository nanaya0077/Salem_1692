// 动效调度器：档位、一次性反馈、手牌入场、block 门。
// 只写 documentElement.dataset.motion / dataset.motionBlock，不碰 S / projection。
import {
  MOTION_STORAGE_KEY,
  motionLevelLabel,
  nextMotionLevel,
  resolveMotionLevel,
  scaledDuration,
} from "./motion-level.js";
import { groupCap, groupDuration, isBlockingGroup } from "./motion-events.js";

const state = {
  level: "full",
  phase: "idle",
  initialized: false,
  blockTimer: null,
  blockStartedAt: 0,
  blockEventId: null,
  skipHandler: null,
  keyHandler: null,
};

function prefersReduced() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readStoredLevel() {
  try {
    return localStorage.getItem(MOTION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLevel(level) {
  try {
    localStorage.setItem(MOTION_STORAGE_KEY, level);
  } catch {
    /* 隐私模式/配额失败：只影响下次默认值，不影响本次 */
  }
}

function applyLevel(level, persist) {
  state.level = level;
  document.documentElement.dataset.motion = level;
  document.documentElement.dataset.motionLabel = motionLevelLabel(level);
  if (persist) writeStoredLevel(level);
  if (level === "off") resetMotion();
  try {
    window.dispatchEvent(new CustomEvent("motion:level", { detail: { level } }));
  } catch {
    /* ignore */
  }
}

export function initMotion() {
  if (state.initialized) return state.level;
  state.initialized = true;
  const level = resolveMotionLevel({
    stored: readStoredLevel(),
    prefersReduced: prefersReduced(),
    hardwareConcurrency: navigator.hardwareConcurrency ?? 8,
    deviceMemory: navigator.deviceMemory ?? 8,
  });
  applyLevel(level, false);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetMotion();
  });
  return level;
}

export function getMotionLevel() {
  return state.level;
}

export function getMotionState() {
  return state.phase;
}

export function isBlocked() {
  return state.phase === "blocked";
}

export function setMotionLevel(level, { persist = true } = {}) {
  if (!["full", "reduced", "off"].includes(level)) return state.level;
  applyLevel(level, persist);
  return state.level;
}

export function cycleMotionLevel() {
  const level = nextMotionLevel(state.level);
  applyLevel(level, true);
  return level;
}

export function motionLabel(level = state.level) {
  return motionLevelLabel(level);
}

function animate(el, keyframes, options, fallbackClass) {
  if (!el) return null;
  if (state.level === "off") return null;
  if (typeof el.animate === "function") {
    try {
      const animation = el.animate(keyframes, options);
      animation.finished?.catch?.(() => {});
      return animation;
    } catch {
      /* 回退 class */
    }
  }
  if (fallbackClass) {
    el.classList.add(fallbackClass);
    setTimeout(() => el.classList.remove(fallbackClass), options.duration ?? 200);
  }
  return null;
}

export function motionPress(el) {
  if (!el || state.level === "off" || isBlocked()) return;
  if (state.level === "reduced") {
    animate(el, [{ opacity: 1 }, { opacity: 0.82 }, { opacity: 1 }], { duration: 110, easing: "ease-out" });
    return;
  }
  animate(
    el,
    [
      { transform: "translateY(0) scale(1)" },
      { transform: "translateY(1px) scale(.985)" },
      { transform: "translateY(0) scale(1)" },
    ],
    { duration: 130, easing: "ease-out" }
  );
}

export function motionDenied(el) {
  if (!el || state.level === "off") return;
  if (state.level === "reduced") {
    animate(el, [{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
    return;
  }
  animate(
    el,
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-3px)" },
      { transform: "translateX(3px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 180, easing: "ease-out" }
  );
}

export function motionToast(el, ok = false) {
  if (!el || state.level === "off") return;
  if (state.level === "reduced") {
    animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "ease-out" });
    return;
  }
  animate(
    el,
    [
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: ok ? 160 : 200, easing: "cubic-bezier(.2,0,0,1)" }
  );
}

export function motionCardEnter(el) {
  if (!el || state.level === "off") return;
  if (state.level === "reduced") {
    animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
    return;
  }
  animate(
    el,
    [
      { opacity: 0, transform: "translateY(12px) scale(.96)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ],
    { duration: 220, easing: "cubic-bezier(.2,0,0,1)" }
  );
}

export function motionTimerWarn(el, on) {
  if (!el) return;
  if (state.level === "off") {
    el.classList.remove("fx-timer-warn");
    return;
  }
  el.classList.toggle("fx-timer-warn", Boolean(on));
}

export function startBlock(eventId, options = {}) {
  if (isBlocked()) return false;
  if (!isBlockingGroup(eventId) && options.force !== true) return false;
  const levelDuration = scaledDuration(state.level, options.duration ?? groupDuration(eventId), options.reducedMax ?? 200);
  if (levelDuration <= 0) return false;
  const cap = Math.max(levelDuration, options.cap ?? groupCap(eventId));
  state.phase = "blocked";
  state.blockEventId = eventId;
  state.blockStartedAt = Date.now();
  document.documentElement.dataset.motionBlock = "1";
  document.documentElement.setAttribute("aria-busy", "true");
  clearTimeout(state.blockTimer);
  state.blockTimer = setTimeout(() => finishBlock("timeout"), Math.min(cap, levelDuration));
  bindSkip();
  return true;
}

export function skipBlock() {
  if (!isBlocked()) return false;
  finishBlock("skip");
  return true;
}

function finishBlock(reason) {
  if (!isBlocked()) return;
  const eventId = state.blockEventId;
  clearTimeout(state.blockTimer);
  state.blockTimer = null;
  state.phase = "idle";
  state.blockEventId = null;
  delete document.documentElement.dataset.motionBlock;
  document.documentElement.removeAttribute("aria-busy");
  try {
    window.dispatchEvent(new CustomEvent("motion:blockend", { detail: { reason, eventId } }));
  } catch {
    /* ignore */
  }
}

export function resetMotion() {
  clearTimeout(state.blockTimer);
  state.blockTimer = null;
  state.phase = "idle";
  state.blockEventId = null;
  delete document.documentElement.dataset.motionBlock;
  document.documentElement.removeAttribute("aria-busy");
}

function isEditable(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable]"));
}

function bindSkip() {
  if (state.skipHandler) return;
  state.skipHandler = (event) => {
    if (!isBlocked()) return;
    if (event.type === "pointerdown" && event.button !== 0) return;
    if (isEditable(event.target)) return;
    skipBlock();
  };
  state.keyHandler = (event) => {
    if (!isBlocked()) return;
    if (!["Escape", "Space", "Enter"].includes(event.code)) return;
    if (isEditable(event.target)) return;
    skipBlock();
  };
  document.addEventListener("pointerdown", state.skipHandler, true);
  document.addEventListener("keydown", state.keyHandler, true);
}

// 预留：T2/T3 把真实事件接到这里；T1 先只处理手牌入场。
export function enqueue(ops = []) {
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    if (op.type === "enter") motionCardEnter(op.el);
    else if (op.type === "block") startBlock(op.id, op);
  }
}

// 首次 init 时把 skip 监听挂上；调用方也可以显式调用。
export function armSkip() {
  bindSkip();
}

// 三档动效的唯一解析规则。纯函数，不碰 DOM，方便 node --test 直接覆盖。

export const MOTION_STORAGE_KEY = "salem.motion";
export const MOTION_LEVELS = ["full", "reduced", "off"];

export function isMotionLevel(value) {
  return MOTION_LEVELS.includes(value);
}

export function nextMotionLevel(level) {
  const index = MOTION_LEVELS.indexOf(level);
  return MOTION_LEVELS[(index + 1) % MOTION_LEVELS.length];
}

export function motionLevelLabel(level) {
  if (level === "reduced") return "减弱";
  if (level === "off") return "关";
  return "全开";
}

export function motionLevelDescription(level) {
  if (level === "reduced") return "只保留淡入淡出与必要反馈";
  if (level === "off") return "不播放动效，直接呈现终态";
  return "完整动效与转场";
}

// 存储值优先；没有存储时才看系统偏好与设备能力。
// 低端机只降一档：full → reduced，reduced/off 不变。
export function resolveMotionLevel({ stored, prefersReduced = false, hardwareConcurrency = 8, deviceMemory = 8 } = {}) {
  if (isMotionLevel(stored)) return stored;
  if (prefersReduced) return "reduced";
  const lowEnd = Number(hardwareConcurrency) <= 4 || Number(deviceMemory) <= 4;
  return lowEnd ? "reduced" : "full";
}

// 当前档位下某个事件实际播放多久；off 永远 0。
// reduced 默认封顶 200ms；死亡揭示按 G5 保留 400ms，由调用方传 reducedMax 覆盖。
export function scaledDuration(level, duration, reducedMax = 200) {
  const value = Number(duration) || 0;
  if (level === "off") return 0;
  if (level === "reduced") return Math.min(value, reducedMax);
  return value;
}

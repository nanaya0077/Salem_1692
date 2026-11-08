// G1 裁决的唯一事件表：16 个调度组、18 个成员 id。
// 组是调度单位（同一组共享时长/合并策略），成员是触发与音效单位。
// 这里只放数据，不碰 DOM；motion.js / app.js / 测试都从这里取。

export const MOTION_GROUPS = [
  {
    id: "fx.ui.tap",
    domain: "ui",
    trigger: "按钮/可点元素按下",
    duration: 120,
    block: false,
    merge: "pointer",
    hint: "只做按下反馈，不改变布局",
  },
  {
    id: "fx.ui.select",
    domain: "ui",
    trigger: "选牌/选目标/选中座位",
    duration: 150,
    block: false,
    merge: "pointer",
    hint: "选中态描边 + 轻微抬起",
  },
  {
    id: "fx.ui.denied",
    domain: "ui",
    trigger: "非法操作/规则拒绝",
    duration: 180,
    block: false,
    merge: "pointer",
    hint: "横向抖动 1 次，不重复叠",
  },
  {
    id: "fx.ui.toast",
    domain: "ui",
    trigger: "短提示/错误提示",
    duration: 200,
    block: false,
    merge: "pointer",
    hint: "从下缘淡入，不抢焦点",
  },
  {
    id: "fx.card.hand",
    domain: "card",
    trigger: "手牌增删/换位",
    duration: 260,
    block: false,
    merge: "state",
    hint: "新卡入场；旧卡不重播",
    members: [
      { id: "fx.card.draw", trigger: "抽牌入手", duration: 220 },
      { id: "fx.card.play", trigger: "打出手牌", duration: 260 },
    ],
  },
  {
    id: "fx.card.deal",
    domain: "card",
    trigger: "发牌/发牌确认翻面",
    duration: 600,
    block: false,
    merge: "reveal",
    hint: "与身份卡翻面共用节奏",
  },
  {
    id: "fx.state.seat",
    domain: "state",
    trigger: "回合/指控/存活等座位状态变化",
    duration: 320,
    block: false,
    merge: "state",
    hint: "整批更新，不逐座位串行",
    members: [
      { id: "fx.state.accuse", trigger: "指控数变化", duration: 300 },
      { id: "fx.turn.start", trigger: "轮到某人", duration: 320 },
    ],
  },
  {
    id: "fx.reveal.flip",
    domain: "reveal",
    trigger: "身份卡翻面",
    duration: 600,
    block: false,
    merge: "reveal",
    hint: "保留现有 3D 翻牌 600ms",
  },
  {
    id: "fx.reveal.settle",
    domain: "reveal",
    trigger: "公开揭示横幅",
    duration: 1080,
    block: false,
    merge: "reveal",
    hint: "入 300 / 停 600 / 出 180；指针穿透",
    phases: { enter: 300, hold: 600, exit: 180 },
  },
  {
    id: "fx.life.deathPrivate",
    domain: "life",
    trigger: "只给当事人的死亡提示",
    duration: 300,
    block: false,
    merge: "death",
    hint: "唯一私密演出；不对外播放",
  },
  {
    id: "fx.life.death",
    domain: "life",
    trigger: "公开死亡结算",
    duration: 1200,
    cap: 1200,
    block: true,
    merge: "death",
    hint: "可跳过；一次结算只 gate 一次",
  },
  {
    id: "fx.phase.deal",
    domain: "phase",
    trigger: "进入发牌相位",
    duration: 375,
    block: false,
    merge: "phase",
    hint: "交叉淡入",
  },
  {
    id: "fx.phase.night",
    domain: "phase",
    trigger: "进入夜晚",
    duration: 600,
    cap: 900,
    block: true,
    merge: "phase",
    hint: "可跳过；硬上限 900ms",
  },
  {
    id: "fx.phase.nightStep",
    domain: "phase",
    trigger: "夜晚内部步骤切换",
    duration: 240,
    block: false,
    merge: "phase",
    hint: "统一容器/时长，不按角色区分",
  },
  {
    id: "fx.phase.dawn",
    domain: "phase",
    trigger: "夜晚→黎明",
    duration: 375,
    block: false,
    merge: "phase",
    hint: "交叉淡入 + 相位时钟",
  },
  {
    id: "fx.timer.warn",
    domain: "timer",
    trigger: "最后 10 秒",
    duration: 200,
    block: false,
    merge: "pointer",
    hint: "低频脉冲，不每帧重启动画",
  },
];

export const MOTION_GROUP_BY_ID = new Map(MOTION_GROUPS.map((group) => [group.id, group]));

export const MOTION_MEMBER_IDS = MOTION_GROUPS.flatMap((group) =>
  group.members ? group.members.map((member) => member.id) : [group.id]
);

export const BLOCKING_GROUP_IDS = MOTION_GROUPS.filter((group) => group.block).map((group) => group.id);

export function motionGroup(id) {
  return MOTION_GROUP_BY_ID.get(id) ?? null;
}

export function groupDuration(id) {
  return motionGroup(id)?.duration ?? 0;
}

export function groupCap(id) {
  const group = motionGroup(id);
  return group?.cap ?? group?.duration ?? 0;
}

export function isBlockingGroup(id) {
  return motionGroup(id)?.block === true;
}

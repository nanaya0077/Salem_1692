export type CardColor = "red" | "green" | "blue" | "black";

export type CardId =
  | "accusation"
  | "evidence"
  | "witness"
  | "alibi"
  | "stocks"
  | "scapegoat"
  | "arson"
  | "curse"
  | "robbery"
  | "asylum"
  | "blackcat"
  | "matchmaker"
  | "piety"
  | "conspiracy"
  | "night";

export type IdentityKind = "witch" | "constable" | "townspeople";

export type RoleId =
  | "abigail-williams"
  | "anne-putnam"
  | "cotton-mather"
  | "george-burroughs"
  | "giles-corey"
  | "john-proctor"
  | "martha-corey"
  | "mary-warren"
  | "rebecca-nurse"
  | "samuel-parris"
  | "sarah-good"
  | "thomas-danforth"
  | "tituba"
  | "will-griggs"
  | "william-phipps"
  | "none";

export type Phase = "deal" | "dawn" | "turnStart" | "action" | "conspiracy" | "night" | "gameOver";
export type Winner = "town" | "witches" | null;

export interface GameConfig {
  playerCount: number;
  witchCount: number;
  /** 名义每人张数；9 人官方 35 张无法均分时，实际为 4/4/…/3。 */
  identityCardsPerPlayer: number;
  /** 身份卡总数；默认取官方表，人数 x 每人张数无法表达 9 人 35 张。 */
  identityCardTotal: number;
  constableCount: number;
}

export interface ConfigInput {
  playerCount: number;
  witchCount?: number;
  identityCardsPerPlayer?: number;
}

export interface IdentityCard {
  id: string;
  kind: IdentityKind;
}

export interface TrialCard extends IdentityCard {
  revealed: boolean;
}

export interface PlayerUsed {
  tituba: boolean;
  samuel: number;
  william: boolean;
}

export interface PlayerState {
  id: number;
  name: string;
  role: RoleId;
  /** 发牌相位收到的候选角色；选定后清空。 */
  roleOptions: RoleId[];
  /** 是否已选定角色；8 人以上开局即为 true。 */
  roleChosen: boolean;
  hand: CardId[];
  accusations: CardId[];
  blue: CardId[];
  green: CardId[];
  trials: TrialCard[];
  alive: boolean;
  everWitch: boolean;
  used: PlayerUsed;
}

/** 挂起式揭示的起因：只有这三处会挂起，传染与自首保持自动揭示第一张。 */
export type RevealCause = "accusation" | "curse" | "scapegoat";

/**
 * 挂起式揭示：达到门槛后停在这里，等选择者按位置号指定要翻开的身份卡。
 * 同一时刻最多一个。身份卡 id 里带类型，所以对外只发位置号。
 */
export interface PendingReveal {
  targetId: number;
  chooserId: number;
  cause: RevealCause;
  /** 只有「托马斯·丹福斯把普通玩家压到第 6 点」才允许放弃。 */
  canDecline: boolean;
  /** 打出达到门槛那张牌的玩家是否声明使用阿比盖尔能力；结算揭示时才生效。 */
  useAbigail: boolean;
}

export type TrialSlot = "hidden" | "revealed";

/** 挂起态的对外投影：只投给选择者，只有位置号，没有卡 id。 */
export interface PendingRevealView {
  chooserId: number;
  targetId: number;
  /** 长度 = 目标面前身份卡张数。 */
  slots: TrialSlot[];
  canDecline: boolean;
}

export type RevealCommand = { kind: "reveal"; trialIndex: number } | { kind: "decline" };

/**
 * 传染阶段：独立子阶段，不复用 `pendingReveal`。
 * 玩家提交的是**位置号**（相对某个玩家 `trials` 数组的索引），不是卡 id；
 * 结算前没有任何人会改动 `trials`，所以提交时的索引在结算时仍然指向同一张卡。
 */
export interface ConspiracyState {
  /** 抽到传染的玩家；黑猫揭示由他发起。 */
  drawerId: number;
  /** `cat` = 揭示黑猫持有者一张；`pick` = 全体同时从左邻取一张。 */
  step: "cat" | "pick";
  /** 黑猫持有者；没有黑猫或持有者免疫时为 null。 */
  catSeatId: number | null;
  /** 抽到者对黑猫持有者的选择（位置号）。 */
  catPick: number | null;
  /** 选择者 playerId → 位置号。改判时覆盖。 */
  picks: Record<number, number>;
  /** 结算完回到哪里（抽牌可能发生在回合内或补抽效果里）。 */
  returnPhase: Phase;
  returnPlayerId: number;
  returnTurn: TurnState;
}

/** 传染阶段的对外投影：只给位置号与「我是否已提交」，不给卡 id，也不给别人的提交状态。 */
export interface ConspiracyView {
  step: "cat" | "pick";
  drawerId: number;
  catSeatId: number | null;
  /** 只反映**本人**是否已提交。 */
  submitted: boolean;
  /** 本步聚合：已提交人数与应提交人数。只给计数，不下发「谁交了」。 */
  submittedCount: number;
  eligibleCount: number;
  /** 候选位置号，长度 = 被选人当前的身份卡张数。 */
  candidates: number[];
  /** 其中已揭示、因此不可选的位置号。 */
  revealed: number[];
}


export interface TurnState {
  playerId: number;
  actionTaken: boolean;
  drewThisTurn: number;
  cardsPlayed: number;
  trialsRevealed: number;
  pendingDraws: number;
  ending: boolean;
  /** 本回合“抽两张”主行动已经抽到的牌，用于贾尔斯·科里补抽第三张。 */
  mainDraws: CardId[];
  /** 本回合是否处于一次“抽两张”主行动中；贾尔斯判定后置 false，避免夜晚续抽重复触发。 */
  gilesEligible: boolean;
}

export interface NightState {
  killerId: number | null;
  targetId: number | null;
  hammerTargetId: number | null;
  confessions: number[];
  resolved: boolean;
}

export interface GameState {
  config: GameConfig;
  players: PlayerState[];
  deck: CardId[];
  discard: CardId[];
  phase: Phase;
  currentPlayerId: number;
  turn: TurnState;
  night: NightState | null;
  /** 挂起式揭示；null 表示没有等待中的选择。 */
  pendingReveal: PendingReveal | null;
  /** 传染阶段；null 表示不在这个阶段。deadline 由服务端补，不进 GameState。 */
  conspiracy: ConspiracyState | null;
  winner: Winner;
  winnerReason: string | null;
  constableId: number | null;
  rngState: number;
  log: GameEvent[];
}

export interface CardSpec {
  id: CardId;
  color: CardColor;
  points?: number;
  count: number;
}

export type GameEvent =
  | { type: "roleChosen"; playerId: number; role: RoleId }
  | { type: "gameStarted"; firstPlayerId: number }
  | { type: "blackCatPlaced"; targetId: number }
  | { type: "turnStarted"; playerId: number }
  | { type: "turnEnded"; playerId: number }
  | { type: "stocksSkipped"; playerId: number; remaining: number }
  | { type: "cardDrawn"; playerId: number; count: number }
  | { type: "deckReshuffled"; count: number }
  | { type: "cardPlayed"; actorId: number; cardId: CardId; targetId?: number; sourceId?: number; asWitness?: boolean }
  | { type: "cardNullified"; cardId: CardId; reason: "sarah-good" }
  | { type: "accusationAdded"; targetId: number; cardId: CardId; points: number; total: number }
  | { type: "accusationsDiscarded"; playerId: number; count: number }
  | { type: "trialRevealed"; playerId: number; kind: IdentityKind; cause: string; chooserId: number; auto?: boolean }
  | { type: "playerDied"; playerId: number; cause: string; everWitch: boolean }
  | { type: "handDiscarded"; playerId: number; count: number }
  | { type: "handTransferred"; fromId: number; toId: number; count: number }
  | { type: "blueAttached"; playerId: number; cardId: CardId }
  | { type: "blueDiscarded"; playerId: number; cardId: CardId }
  | { type: "frontMoved"; fromId: number; toId: number; red: number; blue: number; green: number }
  | { type: "matchmakerBroke"; playerIds: number[] }
  | { type: "powerUsed"; playerId: number; power: string }
  | { type: "conspiracyStarted"; drawerId: number }
  | { type: "conspiracySwap"; fromId: number; toId: number }
  | { type: "nightStarted" }
  | { type: "confession"; playerId: number; revealed: boolean }
  | { type: "nightResolved"; targetId: number; saved: boolean; cause: string }
  | { type: "winner"; winner: Winner; reason: string }
  | { type: "notice"; text: string };

export interface PublicTrial {
  id: string;
  kind: IdentityKind | null;
  revealed: boolean;
}

export interface PublicPlayer {
  id: number;
  name: string;
  role: RoleId;
  roleOptions: RoleId[];
  roleChosen: boolean;
  alive: boolean;
  handCount: number;
  accusations: number;
  accusationsCards: CardId[];
  blue: CardId[];
  green: CardId[];
  trials: PublicTrial[];
  everWitch: boolean | null;
}

export interface SelfView {
  id: number;
  role: RoleId;
  hand: CardId[];
  accusations: CardId[];
  blue: CardId[];
  green: CardId[];
  trials: TrialCard[];
  alive: boolean;
  everWitch: boolean;
  used: PlayerUsed;
}

export interface Projection {
  version: number;
  phase: Phase;
  currentPlayerId: number;
  actionTaken: boolean;
  deckCount: number;
  discardCount: number;
  /** 公开弃牌堆，塞缪尔能力与客户端日志需要。 */
  discard: CardId[];
  /** 仅蒂图巴本人、且能力未用时可见的牌堆顺序；其他人为 null。 */
  deckOrder: CardId[] | null;
  winner: Winner;
  winnerReason: string | null;
  log: GameEvent[];
  self: SelfView;
  seats: PublicPlayer[];
  night: { active: boolean; targetKnown: boolean } | null;
  /** 只有选择者本人收到这个键；其他人的投影里键不存在。 */
  pendingReveal?: PendingRevealView;
  /** 只有本人在传染阶段涉及选择时收到；其他人没有这个键。 */
  conspiracy?: ConspiracyView;
}

export interface ActionOk {
  ok: true;
  state: GameState;
  events: GameEvent[];
}

export interface ActionError {
  ok: false;
  reason: string;
}

export type ActionResult = ActionOk | ActionError;

export interface PlayAction {
  actorId: number;
  cardId: CardId;
  targetId?: number;
  sourceId?: number;
  asWitness?: boolean;
  blueCardId?: CardId;
  useAbigail?: boolean;
  /** 辩护：目标红卡堆中要弃掉的索引；不传则服务端按规则自动挑选。 */
  discardIndexes?: number[];
}
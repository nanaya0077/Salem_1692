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

export type Phase = "dawn" | "turnStart" | "action" | "night" | "gameOver";
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
  hand: CardId[];
  accusations: CardId[];
  blue: CardId[];
  green: CardId[];
  trials: TrialCard[];
  alive: boolean;
  everWitch: boolean;
  used: PlayerUsed;
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
  | { type: "trialRevealed"; playerId: number; kind: IdentityKind; cause: string; chooserId: number }
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
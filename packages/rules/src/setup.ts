import { CARD_CATALOG, CARD_IDS } from "./cards.ts";
import { identityCardCounts, resolveConfig } from "./config.ts";
import { ALL_ROLES } from "./roles.ts";
import type {
  CardId,
  GameConfig,
  GameState,
  IdentityCard,
  PlayerState,
  RoleId,
  TrialCard,
} from "./types.ts";

/** mulberry32：服务端种子化 RNG；状态保存在 GameState.rngState，可回放。 */
export function nextRandom(state: { rngState: number }): number {
  let a = state.rngState >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  state.rngState = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffleInPlace<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  return shuffleInPlace(items.slice(), random);
}

export function buildIdentityDeck(config: GameConfig): IdentityCard[] {
  const counts = identityCardCounts(config);
  const deck: IdentityCard[] = [];
  let n = 0;
  for (let i = 0; i < counts.townspeople; i++) deck.push({ id: "townspeople-" + n++, kind: "townspeople" });
  for (let i = 0; i < counts.witches; i++) deck.push({ id: "witch-" + n++, kind: "witch" });
  for (let i = 0; i < counts.constables; i++) deck.push({ id: "constable-" + n++, kind: "constable" });
  return deck;
}

export interface CreateGameOptions {
  seed?: number;
  roles?: RoleId[];
  hands?: CardId[][];
  names?: string[];
}

export function createGame(input: Parameters<typeof resolveConfig>[0], options: CreateGameOptions = {}): GameState {
  const config = resolveConfig(input);
  const state: GameState = {
    config,
    players: [],
    deck: [],
    discard: [],
    phase: "deal",
    currentPlayerId: 0,
    turn: { playerId: 0, actionTaken: false, drewThisTurn: 0, cardsPlayed: 0, trialsRevealed: 0, pendingDraws: 0, ending: false, mainDraws: [], gilesEligible: false },
    night: null,
    pendingReveal: null,
    winner: null,
    winnerReason: null,
    constableId: null,
    rngState: (options.seed ?? 1) >>> 0,
    log: [],
  };
  const random = () => nextRandom(state);

  const identityDeck = shuffle(buildIdentityDeck(config), random);
  const roleDeck = shuffle(ALL_ROLES.slice(), random);
  // 4–7 人每人两张候选选一张；8 人以上直接一人一张。
  const dealsTwoRoleOptions = config.playerCount <= 7;

  // 官方 9 人 35 张无法均分：前 8 人 4 张、末位 3 张；其余人数正常均分。
  const identityTotal = identityCardCounts(config).total;
  const baseCards = Math.floor(identityTotal / config.playerCount);
  const extra = identityTotal % config.playerCount;
  for (let i = 0; i < config.playerCount; i++) {
    const dealt = identityDeck.splice(0, baseCards + (i < extra ? 1 : 0));
    const trials: TrialCard[] = dealt.map((card) => ({ ...card, revealed: false }));
    const explicitRole = options.roles?.[i];
    let role: RoleId;
    let roleOptions: RoleId[] = [];
    let roleChosen: boolean;
    if (explicitRole !== undefined) {
      role = explicitRole;
      roleChosen = true;
    } else if (dealsTwoRoleOptions) {
      role = "none";
      roleOptions = roleDeck.splice(0, 2);
      roleChosen = false;
    } else {
      role = roleDeck.splice(0, 1)[0] ?? "none";
      roleChosen = true;
    }
    const player: PlayerState = {
      id: i,
      name: options.names?.[i] ?? "玩家" + (i + 1),
      role,
      roleOptions,
      roleChosen,
      hand: [],
      accusations: [],
      blue: [],
      green: [],
      trials,
      alive: true,
      everWitch: trials.some((t) => t.kind === "witch"),
      used: { tituba: false, samuel: 0, william: false },
    };
    state.players.push(player);
  }

  // 初始牌堆：59 张去掉黑猫、夜晚、传染；发 3 张；传染洗回；夜晚置底。
  const deck: CardId[] = [];
  for (const id of CARD_IDS) {
    if (id === "blackcat" || id === "night" || id === "conspiracy") continue;
    for (let i = 0; i < CARD_CATALOG[id].count; i++) deck.push(id);
  }
  shuffleInPlace(deck, random);
  for (const player of state.players) player.hand = deck.splice(0, 3);
  deck.push("conspiracy");
  shuffleInPlace(deck, random);
  deck.push("night");
  state.deck = deck;

  // 若测试显式给手牌，按手牌覆盖并从牌堆移除同数量同名牌，保持 59 张守恒。
  if (options.hands) {
    for (const player of state.players) {
      const wanted = options.hands[player.id] ?? [];
      player.hand = wanted.slice();
      for (const cardId of wanted) {
        const at = state.deck.indexOf(cardId);
        if (at >= 0) state.deck.splice(at, 1);
      }
    }
  }

  state.constableId = findConstableId(state);
  state.log.push({ type: "notice", text: "身份卡已发；角色卡已发。" });
  return state;
}

/**
 * 发牌相位收口：未选者按第一张候选静默落定（超时兜底），随后进入黎明。
 * 真正的选择日志由 chooseRole 写入；房间层若要把超时兜底写进日志，自行补事件。
 */
export function finishDeal(state: GameState): GameState {
  if (state.phase !== "deal") throw new Error("not-deal-phase");
  for (const player of state.players) {
    if (player.roleChosen) continue;
    player.role = player.roleOptions[0] ?? "none";
    player.roleOptions = [];
    player.roleChosen = true;
  }
  state.phase = "dawn";
  return state;
}

export function startGame(state: GameState, blackCatTarget: number): GameState {
  if (state.phase !== "dawn") throw new Error("game-already-started");
  const target = state.players[blackCatTarget];
  if (!target || !target.alive) throw new Error("invalid-blackcat-target");
  // 黎明女巫投放黑猫；黑猫是蓝卡，之后按蓝卡处理。
  target.blue.push("blackcat");
  state.currentPlayerId = target.id;
  state.phase = "action";
  state.turn = { playerId: target.id, actionTaken: false, drewThisTurn: 0, cardsPlayed: 0, trialsRevealed: 0, pendingDraws: 0, ending: false, mainDraws: [], gilesEligible: false };
  state.log.push({ type: "blackCatPlaced", targetId: target.id });
  state.log.push({ type: "gameStarted", firstPlayerId: target.id });
  state.log.push({ type: "turnStarted", playerId: target.id });
  return state;
}

export function witchCountOf(player: PlayerState): number {
  return player.trials.filter((card) => card.kind === "witch").length;
}

export function findConstableId(state: GameState): number | null {
  for (const player of state.players) {
    if (!player.alive) continue;
    if (player.trials.some((t) => t.kind === "constable" && !t.revealed)) return player.id;
  }
  return null;
}

export function updateConstable(state: GameState): void {
  state.constableId = findConstableId(state);
}
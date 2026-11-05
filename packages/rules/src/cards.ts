import type { CardId, CardSpec } from "./types.ts";

export const CARD_CATALOG: Record<CardId, CardSpec> = {
  accusation: { id: "accusation", color: "red", points: 1, count: 35 },
  evidence: { id: "evidence", color: "red", points: 3, count: 5 },
  witness: { id: "witness", color: "red", points: 7, count: 1 },
  alibi: { id: "alibi", color: "green", count: 3 },
  stocks: { id: "stocks", color: "green", count: 3 },
  scapegoat: { id: "scapegoat", color: "green", count: 2 },
  arson: { id: "arson", color: "green", count: 1 },
  curse: { id: "curse", color: "green", count: 1 },
  robbery: { id: "robbery", color: "green", count: 1 },
  asylum: { id: "asylum", color: "blue", count: 1 },
  blackcat: { id: "blackcat", color: "blue", count: 1 },
  matchmaker: { id: "matchmaker", color: "blue", count: 2 },
  piety: { id: "piety", color: "blue", count: 1 },
  conspiracy: { id: "conspiracy", color: "black", count: 1 },
  night: { id: "night", color: "black", count: 1 },
};

export const CARD_IDS = Object.keys(CARD_CATALOG) as CardId[];

export const CARD_LABELS: Record<CardId, string> = {
  accusation: "指控",
  evidence: "证据",
  witness: "目击",
  alibi: "辩护",
  stocks: "拘留",
  scapegoat: "嫁祸",
  arson: "纵火",
  curse: "诅咒",
  robbery: "抢劫",
  asylum: "避难",
  blackcat: "黑猫",
  matchmaker: "情侣",
  piety: "信徒",
  conspiracy: "传染",
  night: "夜晚",
};

/** 基础 59 张：黑猫不在初始牌堆，夜晚置底，传染洗回。 */
export function fullCardCount(): number {
  return CARD_IDS.reduce((n, id) => n + CARD_CATALOG[id].count, 0);
}

export function cardsFor(color: "red" | "green" | "blue" | "black"): CardId[] {
  const out: CardId[] = [];
  for (const id of CARD_IDS) {
    if (CARD_CATALOG[id].color === color) {
      for (let i = 0; i < CARD_CATALOG[id].count; i++) out.push(id);
    }
  }
  return out;
}

export function pointsOf(cardId: CardId): number {
  return CARD_CATALOG[cardId].points ?? 0;
}

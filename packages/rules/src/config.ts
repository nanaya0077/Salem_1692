import type { ConfigInput, GameConfig } from "./types.ts";

/**
 * 中文旧版默认配比（andyventure 对照页）。
 * 女巫数与每人身份卡数都可以在开局前覆盖。
 * 9 人官方 35 张（33 平民 + 1 女巫 + 1 警长）不能均分，实际发 4/4/…/3。
 */
export const DEFAULT_TABLE: Record<number, { witchCount: number; identityCardsPerPlayer: number; identityCardTotal: number }> = {
  4: { witchCount: 1, identityCardsPerPlayer: 5, identityCardTotal: 20 },
  5: { witchCount: 1, identityCardsPerPlayer: 5, identityCardTotal: 25 },
  6: { witchCount: 2, identityCardsPerPlayer: 5, identityCardTotal: 30 },
  7: { witchCount: 2, identityCardsPerPlayer: 5, identityCardTotal: 35 },
  8: { witchCount: 2, identityCardsPerPlayer: 4, identityCardTotal: 32 },
  9: { witchCount: 1, identityCardsPerPlayer: 4, identityCardTotal: 35 },
  10: { witchCount: 2, identityCardsPerPlayer: 3, identityCardTotal: 30 },
  11: { witchCount: 2, identityCardsPerPlayer: 3, identityCardTotal: 33 },
  12: { witchCount: 2, identityCardsPerPlayer: 3, identityCardTotal: 36 },
};

export class ConfigError extends Error {}

export function defaultConfigFor(playerCount: number): GameConfig {
  const row = DEFAULT_TABLE[playerCount];
  if (!row) throw new ConfigError("玩家人数必须在 4–12 人之间");
  return {
    playerCount,
    witchCount: row.witchCount,
    identityCardsPerPlayer: row.identityCardsPerPlayer,
    identityCardTotal: row.identityCardTotal,
    constableCount: 1,
  };
}

export function resolveConfig(input: ConfigInput): GameConfig {
  const base = defaultConfigFor(input.playerCount);
  const witchCount = input.witchCount ?? base.witchCount;
  const identityCardsPerPlayer = input.identityCardsPerPlayer ?? base.identityCardsPerPlayer;
  // 只有显式覆盖每人张数时才改成均分总数；默认保留官方 9 人 35 张的不均匀发牌。
  const identityCardTotal =
    input.identityCardsPerPlayer === undefined
      ? base.identityCardTotal
      : input.playerCount * identityCardsPerPlayer;

  if (!Number.isInteger(witchCount) || witchCount < 1 || witchCount > input.playerCount - 1) {
    throw new ConfigError("女巫数必须是 1 到 人数-1 的整数");
  }
  if (!Number.isInteger(identityCardsPerPlayer) || identityCardsPerPlayer < 2 || identityCardsPerPlayer > 8) {
    throw new ConfigError("每人身份卡数必须是 2–8 的整数");
  }

  const townspeople = identityCardTotal - witchCount - base.constableCount;
  if (townspeople < 0) {
    throw new ConfigError("身份卡总数不够：至少需要 女巫数 + 1 张警长");
  }

  return {
    playerCount: input.playerCount,
    witchCount,
    identityCardsPerPlayer,
    identityCardTotal,
    constableCount: base.constableCount,
  };
}

export function identityCardCounts(config: GameConfig): {
  total: number;
  witches: number;
  constables: number;
  townspeople: number;
} {
  const total = config.identityCardTotal;
  return {
    total,
    witches: config.witchCount,
    constables: config.constableCount,
    townspeople: total - config.witchCount - config.constableCount,
  };
}

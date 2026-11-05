import type { ConfigInput, GameConfig } from "./types.ts";

/**
 * 中文旧版默认配比（andyventure 对照页）。
 * 女巫数与每人身份卡数都可以在开局前覆盖。
 */
export const DEFAULT_TABLE: Record<number, { witchCount: number; identityCardsPerPlayer: number }> = {
  4: { witchCount: 1, identityCardsPerPlayer: 5 },
  5: { witchCount: 1, identityCardsPerPlayer: 5 },
  6: { witchCount: 2, identityCardsPerPlayer: 5 },
  7: { witchCount: 2, identityCardsPerPlayer: 5 },
  8: { witchCount: 2, identityCardsPerPlayer: 5 },
  9: { witchCount: 1, identityCardsPerPlayer: 5 },
  10: { witchCount: 2, identityCardsPerPlayer: 3 },
  11: { witchCount: 2, identityCardsPerPlayer: 3 },
  12: { witchCount: 2, identityCardsPerPlayer: 3 },
};

export class ConfigError extends Error {}

export function defaultConfigFor(playerCount: number): GameConfig {
  const row = DEFAULT_TABLE[playerCount];
  if (!row) throw new ConfigError("玩家人数必须在 4–12 人之间");
  return {
    playerCount,
    witchCount: row.witchCount,
    identityCardsPerPlayer: row.identityCardsPerPlayer,
    constableCount: 1,
  };
}

export function resolveConfig(input: ConfigInput): GameConfig {
  const base = defaultConfigFor(input.playerCount);
  const witchCount = input.witchCount ?? base.witchCount;
  const identityCardsPerPlayer = input.identityCardsPerPlayer ?? base.identityCardsPerPlayer;

  if (!Number.isInteger(witchCount) || witchCount < 1 || witchCount > input.playerCount - 1) {
    throw new ConfigError("女巫数必须是 1 到 人数-1 的整数");
  }
  if (!Number.isInteger(identityCardsPerPlayer) || identityCardsPerPlayer < 2 || identityCardsPerPlayer > 8) {
    throw new ConfigError("每人身份卡数必须是 2–8 的整数");
  }

  const totalIdentityCards = input.playerCount * identityCardsPerPlayer;
  const townspeople = totalIdentityCards - witchCount - base.constableCount;
  if (townspeople < 0) {
    throw new ConfigError("身份卡总数不够：至少需要 女巫数 + 1 张警长");
  }

  return {
    playerCount: input.playerCount,
    witchCount,
    identityCardsPerPlayer,
    constableCount: base.constableCount,
  };
}

export function identityCardCounts(config: GameConfig): {
  total: number;
  witches: number;
  constables: number;
  townspeople: number;
} {
  const total = config.playerCount * config.identityCardsPerPlayer;
  return {
    total,
    witches: config.witchCount,
    constables: config.constableCount,
    townspeople: total - config.witchCount - config.constableCount,
  };
}

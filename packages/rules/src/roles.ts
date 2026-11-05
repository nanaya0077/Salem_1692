import type { RoleId } from "./types.ts";

export interface RoleSpec {
  id: RoleId;
  name: string;
  short: string;
  ability: string;
}

export const ROLE_CATALOG: Record<RoleId, RoleSpec> = {
  "abigail-williams": { id: "abigail-williams", name: "阿比盖尔·威廉姆斯", short: "阿比盖尔", ability: "你打出使目标翻牌的最后一击时，可以弃掉自己面前所有红卡。" },
  "anne-putnam": { id: "anne-putnam", name: "安妮·普特南", short: "安妮", ability: "回合结束时，本回合每翻开一张身份卡，抽 2 张牌。" },
  "cotton-mather": { id: "cotton-mather", name: "科顿·马瑟", short: "科顿", ability: "打在你面前的证据只算 1 点指控。" },
  "george-burroughs": { id: "george-burroughs", name: "乔治·伯勒斯", short: "乔治", ability: "需要 8 点指控才能翻你的身份卡。" },
  "giles-corey": { id: "giles-corey", name: "贾尔斯·科里", short: "贾尔斯", ability: "一次抽两张时若两张都是红卡，展示后补抽第三张。" },
  "john-proctor": { id: "john-proctor", name: "约翰·普罗克特", short: "约翰", ability: "其他玩家死亡时，你从其手牌中拿至多 3 张，其余弃掉。" },
  "martha-corey": { id: "martha-corey", name: "玛莎·科里", short: "玛莎", ability: "复制你右手边第一个存活玩家的能力。" },
  "mary-warren": { id: "mary-warren", name: "玛丽·沃伦", short: "玛丽", ability: "免疫情侣连锁与黑猫的翻牌效果。" },
  "rebecca-nurse": { id: "rebecca-nurse", name: "丽贝卡·诺斯", short: "丽贝卡", ability: "其他玩家因指控翻牌时，你抽 1 张。" },
  "samuel-parris": { id: "samuel-parris", name: "塞缪尔·帕里斯", short: "塞缪尔", ability: "每局两次，花整个回合从弃牌堆拿至多 2 张非黑牌。" },
  "sarah-good": { id: "sarah-good", name: "莎拉·古德", short: "莎拉", ability: "对你打出的抢劫/纵火无效，并立刻丢弃该卡。" },
  "thomas-danforth": { id: "thomas-danforth", name: "托马斯·丹福斯", short: "托马斯", ability: "你对普通玩家只要 6 点指控即可翻牌；对乔治需要 7 点。" },
  tituba: { id: "tituba", name: "蒂图巴", short: "蒂图巴", ability: "每局一次，在你回合开始前可重排牌堆。" },
  "will-griggs": { id: "will-griggs", name: "威尔·格里格斯", short: "威尔", ability: "你可以把辩护当作 7 点目击打出。" },
  "william-phipps": { id: "william-phipps", name: "威廉·菲普斯", short: "威廉", ability: "每局一次，夜晚可以不自首翻牌而获得当夜免疫。" },
  none: { id: "none", name: "无角色", short: "无", ability: "没有角色能力。" },
};

export const ALL_ROLES: RoleId[] = [
  "abigail-williams",
  "anne-putnam",
  "cotton-mather",
  "george-burroughs",
  "giles-corey",
  "john-proctor",
  "martha-corey",
  "mary-warren",
  "rebecca-nurse",
  "samuel-parris",
  "sarah-good",
  "thomas-danforth",
  "tituba",
  "will-griggs",
  "william-phipps",
];

export function roleName(role: RoleId): string {
  return ROLE_CATALOG[role].name;
}

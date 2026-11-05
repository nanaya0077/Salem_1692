import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  CARD_CATALOG,
  beginNightForTest,
  canPlayCard,
  createGame,
  defaultConfigFor,
  defaultNightChoice,
  drawTwo,
  effectiveRole,
  endTurn,
  project,
  playCard,
  resolveNight,
  resolveConfig,
  samuelTake,
  startGame,
  titubaReorder,
} from "../../../packages/rules/src/index.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const WEB = resolve(ROOT, "apps/web");
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const NIGHT_MS = Number(process.env.NIGHT_MS || 30000);
const DAWN_MS = Number(process.env.DAWN_MS || 45000);
const TURN_MS = Number(process.env.TURN_MS || 90000);
const GRACE_MS = Number(process.env.GRACE_MS || 60000);
/** 同一座位的资料写入硬闸：1 秒内只认第一笔，超频静默丢弃。 */
const PROFILE_GATE_MS = 1000;
/** 头像解码后的字节上限。超限整条拒绝，不截断也不降采样。 */
const AVATAR_MAX_BYTES = 96 * 1024;
/** base64 最长长度：每 3 字节编成 4 个字符，先按字符串长度挡一道，省得白解码。 */
const AVATAR_MAX_BASE64 = Math.ceil(AVATAR_MAX_BYTES / 3) * 4;
/**
 * 只认 WebP 与 JPEG 的 data URL。头一个字段就能判断格式，接着用 magic bytes 确认，
 * 免得客户端把别的格式套个 image/webp 的壳递进来。
 */
const AVATAR_TYPES = [
  {
    prefix: "data:image/webp;base64,",
    magic: (buf) =>
      buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP",
  },
  {
    prefix: "data:image/jpeg;base64,",
    magic: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** @typedef {"lobby"|"dawn"|"playing"|"night"|"over"} RoomPhase */

const rooms = new Map();
const sockets = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function safeName(raw) {
  const s = String(raw ?? "").replace(/[\u0000-\u001f<>]/g, "").trim();
  return (s || "玩家").slice(0, 16);
}

function newCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

function newToken() {
  return randomBytes(24).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostSeat: room.hostSeat,
    seats: room.seats.map((s) => ({
      id: s.id,
      name: s.name,
      ready: s.ready,
      connected: s.connected,
      auto: Boolean(s.auto),
      bot: Boolean(s.bot),
      isHost: s.id === room.hostSeat,
    })),
    config: room.config,
    defaults: room.seats.length >= 4 ? defaultConfigFor(room.seats.length) : defaultConfigFor(4),
    minPlayers: 4,
    maxPlayers: 12,
    startable: room.phase === "lobby" && room.seats.length >= 4 && room.seats.length <= 12 && room.seats.every((s) => s.ready) && room.seats.every((s) => s.connected),
  };
}

function send(ws, message) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(message));
  } catch (error) {
    log("send failed", error.message);
  }
}

function sendError(ws, message, reason) {
  send(ws, { type: "error", message, reason });
}

function broadcast(room, message, exceptSeat = null) {
  for (const seat of room.seats) {
    if (exceptSeat !== null && seat.id === exceptSeat) continue;
    send(seat.ws, message);
  }
}

function seatOf(room, id) {
  return room.seats.find((s) => s.id === id) ?? null;
}

/**
 * 昵称写在两个地方：座位自己的名字，以及该玩家在对局状态里的名字。
 * 投影里的座位名取自后者，只写一处会新旧并存。规则逻辑不读名字，所以中途改是安全的。
 * 返回 null 表示名字没变。
 */
function applySeatName(room, seat, rawName) {
  const next = safeName(rawName);
  if (next === seat.name) return null;
  const before = seat.name;
  seat.name = next;
  const player = room.game?.players?.[seat.id];
  if (player) player.name = next;
  return { before, after: next };
}

function broadcastRename(room, before, after) {
  if (!before) return;
  broadcast(room, { type: "notice", message: `「${before}」改名为「${after}」` });
}

/**
 * 校验头像 data URL。返回 {dataUrl} 表示可用，否则 {reason, message} 面向玩家。
 * 顺序：前缀 → 字符串长度（挡明显超限）→ 解码 → 字节长度 → magic bytes。
 */
function parseAvatar(raw) {
  const invalid = { reason: "avatar-invalid", message: "这张图片读不出来，换一张试试" };
  if (typeof raw !== "string") return invalid;
  const type = AVATAR_TYPES.find((t) => raw.startsWith(t.prefix));
  if (!type) return invalid;
  const body = raw.slice(type.prefix.length);
  if (body.length > AVATAR_MAX_BASE64) {
    return { reason: "avatar-too-large", message: "这张图片太大了，换一张小一点的" };
  }
  const buf = Buffer.from(body, "base64");
  if (buf.length === 0) return invalid;
  if (buf.length > AVATAR_MAX_BYTES) {
    return { reason: "avatar-too-large", message: "这张图片太大了，换一张小一点的" };
  }
  if (!type.magic(buf)) return invalid;
  return { dataUrl: raw };
}

/** 全量头像 {seatId: dataUrl}：只出设过头像的座位。 */
function avatarsOf(room) {
  const out = {};
  for (const seat of room.seats) {
    if (seat.avatar) out[String(seat.id)] = seat.avatar;
  }
  return out;
}

/**
 * 个人资料写入。身份只来自连接自身的座位归属，消息里任何座位字段都不作数，因此只能改自己。
 * 1 秒硬闸：闸内的第二笔静默丢弃（不报错、不提示）。
 * 一条消息里的昵称与头像一起校验：任一不合法就整条拒绝，什么都不改。
 */
function handleProfile(room, seat, message) {
  if (!seat) return;
  const now = Date.now();
  if (seat.profileAt !== undefined && now - seat.profileAt < PROFILE_GATE_MS) return;
  const wantsAvatar = message.avatar !== undefined;
  let nextAvatar = null;
  if (wantsAvatar && message.avatar !== null) {
    const parsed = parseAvatar(message.avatar);
    if (parsed.reason) return sendError(seat.ws, parsed.message, parsed.reason);
    nextAvatar = parsed.dataUrl;
  }
  const rename = message.name === undefined || message.name === null ? null : applySeatName(room, seat, message.name);
  const avatarChanged = wantsAvatar && nextAvatar !== (seat.avatar ?? null);
  if (!rename && !avatarChanged) return;
  seat.profileAt = now;
  if (avatarChanged) seat.avatar = nextAvatar;
  if (rename) broadcastRename(room, rename.before, rename.after);
  // 头像单独一条消息，发全房间（含本人，客户端靠它确认写入结果）；不进 room，所以不必重投影。
  if (avatarChanged) broadcast(room, { type: "avatar", seatId: seat.id, dataUrl: nextAvatar });
  if (rename) sync(room);
}

function aliveWitches(game) {
  return game.players.filter((p) => p.alive && p.everWitch);
}

function aliveConstable(game) {
  return game.constableId === null ? null : game.players[game.constableId];
}

function nightRequired(room) {
  const game = room.game;
  if (!game || game.phase !== "night") return [];
  const required = [];
  for (const p of game.players) {
    if (!p.alive) continue;
    if (p.everWitch || game.constableId === p.id) required.push(p.id);
  }
  return required;
}

function privateState(room, seat) {
  const game = room.game;
  if (!game) return null;
  const player = game.players[seat.id];
  const base = {
    seatId: seat.id,
    phase: game.phase,
    role: player.role,
    alive: player.alive,
    everWitch: player.everWitch,
    isConstable: game.constableId === seat.id,
    auto: Boolean(seat.auto),
    turnDeadline: game.phase === "action" ? room.turnDeadline ?? null : null,
  };
  if (game.phase === "dawn") {
    return {
      ...base,
      dawn: {
        isWitch: player.everWitch,
        submitted: room.dawnVotes.has(seat.id),
        accepted: player.everWitch,
        deadline: room.dawnDeadline,
      },
    };
  }
  if (game.phase === "night" && game.night) {
    const vote = room.nightVotes.get(seat.id) ?? {};
    return {
      ...base,
      night: {
        isWitch: player.everWitch,
        isConstable: game.constableId === seat.id,
        canConfess: player.alive && !game.night.confessions.includes(seat.id),
        canWilliam: player.alive && effectiveRole(game, seat.id) === "william-phipps" && !player.used.william,
        williamUsed: Boolean(player.used.william),
        submitted: room.nightVotes.has(seat.id),
        targetId: vote.targetId ?? null,
        hammerTargetId: vote.hammerTargetId ?? null,
        confess: Boolean(vote.confess),
        useWilliam: Boolean(vote.useWilliam),
        required: nightRequired(room),
        deadline: room.nightDeadline,
      },
    };
  }
  return base;
}

function sync(room) {
  const pub = publicRoom(room);
  broadcast(room, { type: "room", room: pub });
  if (!room.game) return;
  for (const seat of room.seats) {
    send(seat.ws, {
      type: "projection",
      projection: project(room.game, seat.id),
      private: privateState(room, seat),
      room: pub,
    });
  }
  scheduleBots(room);
}

function clearTurnTimer(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = null;
}

function armTurnTimer(room) {
  clearTurnTimer(room);
  if (room.phase !== "playing" || !room.game || room.game.phase !== "action" || room.game.winner) return;
  const actorId = room.game.currentPlayerId;
  if (!seatOf(room, actorId)) return;
  room.turnDeadline = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => {
    if (room.phase !== "playing" || !room.game || room.game.phase !== "action" || room.game.currentPlayerId !== actorId) return;
    log("turn timeout", room.code, actorId);
    autoTakeTurn(room, "turn-timeout");
  }, TURN_MS + 500);
}

function autoTakeTurn(room, reason) {
  if (room.phase !== "playing" || !room.game || room.game.phase !== "action" || room.game.winner) return;
  const actorId = room.game.currentPlayerId;
  const seat = seatOf(room, actorId);
  if (!seat) return;
  const first = room.game.turn.actionTaken ? endTurn(room.game) : drawTwo(room.game);
  if (!applyResult(room, first, null)) return;
  if (room.game.phase === "action" && room.game.turn.actionTaken && room.game.currentPlayerId === actorId) {
    const second = endTurn(room.game);
    applyResult(room, second, null);
  }
  log("auto turn", room.code, actorId, reason, seat.auto ? "auto-seat" : "timer");
}

function botSeat(room, id) {
  const seat = seatOf(room, id);
  return seat?.bot ? seat : null;
}

function pendingBotVotes(room) {
  if (!room.game) return [];
  if (room.phase === "dawn") {
    return room.game.players
      .filter((p) => p.alive && p.everWitch && botSeat(room, p.id) && !room.dawnVotes.has(p.id))
      .map((p) => p.id);
  }
  if (room.phase === "night") {
    return nightRequired(room).filter((id) => botSeat(room, id) && !room.nightVotes.has(id));
  }
  return [];
}

function botTurnSeat(room) {
  if (room.phase !== "playing" || !room.game || room.game.phase !== "action" || room.game.winner) return null;
  return botSeat(room, room.game.currentPlayerId);
}

function hasBotWork(room) {
  return pendingBotVotes(room).length > 0 || Boolean(botTurnSeat(room));
}

function scheduleBots(room) {
  clearTimeout(room.botTimer);
  room.botTimer = null;
  if (!hasBotWork(room)) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    runBotStep(room);
  }, 350);
}

function runBotStep(room) {
  if (!room.game || room.game.winner) return;
  if (room.phase === "dawn") {
    const pending = pendingBotVotes(room);
    for (const id of pending) {
      const alive = room.game.players.filter((p) => p.alive);
      const target = alive[Math.floor(Math.random() * alive.length)] ?? room.game.players[id];
      room.dawnVotes.set(id, target.id);
      log("bot dawn vote", room.code, id, "->", target.id);
    }
    const witches = aliveWitches(room.game);
    if (witches.length && witches.every((w) => room.dawnVotes.has(w.id))) finalizeDawn(room);
    else sync(room);
    return;
  }
  if (room.phase === "night") {
    const pending = pendingBotVotes(room);
    for (const id of pending) {
      const player = room.game.players[id];
      if (!player) continue;
      const vote = room.nightVotes.get(id) ?? {};
      if (player.everWitch) {
        const alive = room.game.players.filter((p) => p.alive && p.id !== id);
        const target = alive[Math.floor(Math.random() * alive.length)] ?? player;
        vote.targetId = target.id;
      }
      if (room.game.constableId === id) vote.hammerTargetId = null;
      room.nightVotes.set(id, vote);
      log("bot night vote", room.code, id, vote);
    }
    const required = nightRequired(room);
    if (required.every((id) => room.nightVotes.has(id))) finalizeNight(room);
    else sync(room);
    return;
  }
  if (botTurnSeat(room)) {
    if (botPlay(room)) return;
    autoTakeTurn(room, "bot");
  }
}

function botPlay(room) {
  const game = room.game;
  const actor = game.players[game.currentPlayerId];
  if (!actor) return false;
  const others = game.players.filter((p) => p.alive && p.id !== actor.id);
  if (!others.length) return false;
  const red = actor.hand.filter((id) => CARD_CATALOG[id]?.color === "red");
  if (!red.length) return false;
  const cardId = red[Math.floor(Math.random() * red.length)];
  const target = others[Math.floor(Math.random() * others.length)];
  if (!canPlayCard(game, actor.id, cardId, target.id).ok) return false;
  const result = playCard(game, { actorId: actor.id, cardId, targetId: target.id });
  if (!applyResult(room, result, actor.id)) return false;
  log("bot play", room.code, actor.id, cardId, "->", target.id);
  const current = room.game.currentPlayerId;
  if (room.game.phase === "action" && !room.game.winner && current === actor.id && room.game.turn.actionTaken) {
    applyResult(room, endTurn(room.game), actor.id);
  }
  return true;
}

function addBot(room, seatId) {
  if (room.phase !== "lobby") return sendError(seatOf(room, seatId)?.ws, "对局已开始，不能加机器人", "not-lobby");
  if (seatId !== room.hostSeat) return sendError(seatOf(room, seatId)?.ws, "只有房主可以加机器人", "not-host");
  if (room.seats.length >= 12) return sendError(seatOf(room, seatId)?.ws, "房间已满（12 人）", "room-full");
  const id = Array.from({ length: 12 }, (_, i) => i).find((i) => !room.seats.some((s) => s.id === i));
  if (id === undefined) return sendError(seatOf(room, seatId)?.ws, "房间已满", "room-full");
  let n = 1;
  while (room.seats.some((s) => s.name === "机器人" + n)) n += 1;
  const seat = {
    id,
    name: "机器人" + n,
    tokenHash: hashToken(newToken()),
    ready: true,
    connected: true,
    bot: true,
    joinedAt: Date.now(),
  };
  room.seats.push(seat);
  log("bot added", room.code, seat.name, id);
  sync(room);
}

function setPhase(room, phase) {
  room.phase = phase;
  if (phase !== "playing") clearTurnTimer(room);
  if (room.phase !== "night") {
    room.nightVotes = new Map();
    room.nightDeadline = null;
    clearTimeout(room.nightTimer);
    room.nightTimer = null;
  }
  if (room.phase !== "dawn") {
    room.dawnVotes = new Map();
    room.dawnDeadline = null;
    clearTimeout(room.dawnTimer);
    room.dawnTimer = null;
  }
}

function finishIfOver(room) {
  if (room.game?.winner) {
    setPhase(room, "over");
    room.finishedAt = Date.now();
    return true;
  }
  return false;
}

function applyResult(room, result, actorSeat = null) {
  if (!result.ok) {
    if (actorSeat !== null) sendError(seatOf(room, actorSeat)?.ws, result.reason || "操作失败", result.reason);
    return false;
  }
  room.game = result.state;
  if (result.events?.length) {
    broadcast(room, { type: "events", events: result.events });
  }
  if (room.game.phase === "night") {
    setPhase(room, "night");
    room.nightVotes = new Map();
    room.nightDeadline = Date.now() + NIGHT_MS;
    room.nightTimer = setTimeout(() => {
      if (room.phase === "night") finalizeNight(room, true);
    }, NIGHT_MS + 750);
    log("night started", room.code);
  } else if (!finishIfOver(room)) {
    setPhase(room, "playing");
  }
  armTurnTimer(room);
  sync(room);
  return true;
}

function initRoom(room, ws, seat, token) {
  room.seats.push(seat);
  sockets.set(ws, { code: room.code, seatId: seat.id });
  ws.meta = { code: room.code, seatId: seat.id };
  seat.ws = ws;
  seat.connected = true;
  send(ws, { type: "welcome", code: room.code, seatId: seat.id, token, avatars: avatarsOf(room) });
  sync(room);
}

function createRoom(ws, name, configInput) {
  leaveRoom(ws);
  const code = newCode();
  const token = newToken();
  const seat = {
    id: 0,
    name: safeName(name),
    tokenHash: hashToken(token),
    ready: true,
    connected: true,
    ws,
    joinedAt: Date.now(),
  };
  const room = {
    code,
    hostSeat: 0,
    phase: "lobby",
    seats: [],
    game: null,
    config: {},
    seenCommands: new Set(),
    dawnVotes: new Map(),
    nightVotes: new Map(),
    turnTimer: null,
    turnDeadline: null,
    autoTimers: new Map(),
    botTimer: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  rooms.set(code, room);
  if (configInput && typeof configInput === "object") {
    room.config = {
      witchCount: Number.isFinite(configInput.witchCount) ? configInput.witchCount : undefined,
      identityCardsPerPlayer: Number.isFinite(configInput.identityCardsPerPlayer) ? configInput.identityCardsPerPlayer : undefined,
    };
  }
  initRoom(room, ws, seat, token);
  log("room created", code, seat.name);
}

function findSeatByToken(room, token) {
  if (!token) return null;
  const hash = hashToken(token);
  return room.seats.find((s) => s.tokenHash === hash) ?? null;
}

function joinRoom(ws, code, name, token) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) return sendError(ws, "房间不存在或已结束", "room-not-found");
  if (ws.meta) leaveRoom(ws);
  const existing = findSeatByToken(room, token);
  if (existing) {
    if (existing.ws && existing.ws !== ws) {
      try { existing.ws.close(4001, "replaced"); } catch {}
    }
    sockets.set(ws, { code: room.code, seatId: existing.id });
    ws.meta = { code: room.code, seatId: existing.id };
    existing.ws = ws;
    existing.connected = true;
    markSeatConnected(room, existing);
    if (name) {
      const renamed = applySeatName(room, existing, name);
      if (renamed) broadcastRename(room, renamed.before, renamed.after);
    }
    send(ws, {
      type: "welcome",
      code: room.code,
      seatId: existing.id,
      token,
      reconnected: true,
      avatars: avatarsOf(room),
    });
    sync(room);
    return;
  }
  if (room.phase !== "lobby") return sendError(ws, "对局已开始，无法以新玩家加入", "game-in-progress");
  if (room.seats.length >= 12) return sendError(ws, "房间已满（12 人）", "room-full");
  const id = Array.from({ length: 12 }, (_, i) => i).find((i) => !room.seats.some((s) => s.id === i));
  if (id === undefined) return sendError(ws, "房间已满", "room-full");
  const fresh = newToken();
  const seat = {
    id,
    name: safeName(name),
    tokenHash: hashToken(fresh),
    ready: false,
    connected: true,
    ws,
    joinedAt: Date.now(),
  };
  initRoom(room, ws, seat, fresh);
  log("room joined", room.code, seat.name, id);
}

function markSeatConnected(room, seat) {
  clearTimeout(room.autoTimers.get(seat.id));
  room.autoTimers.delete(seat.id);
  seat.auto = false;
  seat.disconnectedAt = null;
}

function scheduleAuto(room, seat) {
  clearTimeout(room.autoTimers.get(seat.id));
  seat.auto = false;
  seat.disconnectedAt = Date.now();
  const timer = setTimeout(() => {
    room.autoTimers.delete(seat.id);
    if (seat.connected) return;
    seat.auto = true;
    log("seat auto", room.code, seat.id);
    sync(room);
    if (room.phase === "playing" && room.game?.phase === "action" && room.game.currentPlayerId === seat.id) {
      autoTakeTurn(room, "disconnect-auto");
    }
  }, GRACE_MS);
  room.autoTimers.set(seat.id, timer);
}

function leaveRoom(ws) {
  const meta = sockets.get(ws);
  if (!meta) return;
  sockets.delete(ws);
  const room = rooms.get(meta.code);
  if (!room) return;
  const seat = seatOf(room, meta.seatId);
  if (!seat) return;
  // 重连时旧 socket 的 close 事件晚到，不能把已经挂到新 socket 上的座位踢掉。
  if (seat.ws && seat.ws !== ws) return;
  seat.connected = false;
  seat.ws = null;
  if (room.phase === "lobby") {
    room.seats = room.seats.filter((s) => s.id !== seat.id);
    const humans = room.seats.filter((s) => !s.bot);
    if (humans.length === 0) {
      cleanupRoom(room);
      return;
    }
    if (room.hostSeat === seat.id) room.hostSeat = (humans.find((s) => s.connected) ?? humans[0]).id;
  } else {
    scheduleAuto(room, seat);
    if (room.hostSeat === seat.id) {
      room.hostSeat = room.seats.find((s) => s.connected && !s.bot)?.id ?? room.seats.find((s) => !s.bot)?.id ?? room.seats[0]?.id ?? 0;
    }
  }
  sync(room);
}

function cleanupRoom(room) {
  clearTimeout(room.nightTimer);
  clearTimeout(room.dawnTimer);
  clearTurnTimer(room);
  clearTimeout(room.botTimer);
  room.botTimer = null;
  for (const timer of room.autoTimers?.values?.() ?? []) clearTimeout(timer);
  room.autoTimers?.clear?.();
  rooms.delete(room.code);
  for (const seat of room.seats) {
    if (seat.ws) {
      sockets.delete(seat.ws);
      try { seat.ws.close(1001, "room-closed"); } catch {}
    }
  }
}

function normalizeSeatIds(room) {
  const host = room.seats.find((s) => s.id === room.hostSeat) ?? room.seats[0];
  const ordered = room.seats.slice().sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id - b.id);
  ordered.forEach((seat, index) => { seat.id = index; });
  room.seats = ordered;
  room.hostSeat = host ? host.id : 0;
  for (const seat of ordered) {
    if (!seat.ws) continue;
    seat.ws.meta = { code: room.code, seatId: seat.id };
    sockets.set(seat.ws, { code: room.code, seatId: seat.id });
  }
}

function startGameFromLobby(room, seatId) {
  if (room.phase !== "lobby") return sendError(seatOf(room, seatId)?.ws, "对局已经开始", "not-lobby");
  if (seatId !== room.hostSeat) return sendError(seatOf(room, seatId)?.ws, "只有房主可以开局", "not-host");
  if (room.seats.length < 4) return sendError(seatOf(room, seatId)?.ws, "至少需要 4 人", "too-few");
  if (room.seats.length > 12) return sendError(seatOf(room, seatId)?.ws, "最多 12 人", "too-many");
  if (!room.seats.every((s) => s.ready)) return sendError(seatOf(room, seatId)?.ws, "还有玩家未准备", "not-ready");
  if (!room.seats.every((s) => s.connected)) return sendError(seatOf(room, seatId)?.ws, "还有玩家掉线", "not-connected");
  try {
    resolveConfig({ playerCount: room.seats.length, ...room.config });
  } catch (error) {
    return sendError(seatOf(room, seatId)?.ws, String(error.message || error), "invalid-config");
  }
  normalizeSeatIds(room);
  try {
    room.game = createGame(
      { playerCount: room.seats.length, ...room.config },
      {
        names: room.seats.map((s) => s.name),
        autoStart: false,
        seed: randomBytes(4).readUInt32LE(0),
      },
    );
  } catch (error) {
    return sendError(seatOf(room, seatId)?.ws, String(error.message || error), "start-failed");
  }
  room.config = { ...room.game.config };
  room.startedAt = Date.now();
  setPhase(room, "dawn");
  room.dawnVotes = new Map();
  room.dawnDeadline = Date.now() + DAWN_MS;
  room.dawnTimer = setTimeout(() => finalizeDawn(room, true), DAWN_MS + 500);
  broadcast(room, { type: "notice", message: "身份卡已发，黎明开始。" });
  sync(room);
  log("game started", room.code, room.seats.length);
}

function finalizeDawn(room, timedOut = false) {
  if (!room.game || room.game.phase !== "dawn") return;
  const witches = aliveWitches(room.game);
  if (!witches.length) return;
  const counts = new Map();
  for (const id of room.dawnVotes.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
  let target = null;
  for (const [id, n] of counts) if (target === null || n > (counts.get(target) ?? 0)) target = id;
  if (target === null || timedOut) {
    const chosen = room.dawnVotes.values().next().value;
    target = Number.isInteger(chosen) ? chosen : witches[0].id;
  }
  const player = room.game.players[target];
  if (!player || !player.alive) target = witches[0].id;
  try {
    room.game = startGame(room.game, target);
    setPhase(room, "playing");
    armTurnTimer(room);
    broadcast(room, { type: "notice", message: "黎明结束，黑猫已放下。" });
    sync(room);
    log("dawn resolved", room.code, "blackcat", target);
  } catch (error) {
    log("dawn failed", error);
  }
}

function submitDawn(room, seatId, targetId) {
  if (!room.game || room.game.phase !== "dawn") return sendError(seatOf(room, seatId)?.ws, "当前不是黎明", "not-dawn");
  const player = room.game.players[seatId];
  if (!player || !player.everWitch) return sendError(seatOf(room, seatId)?.ws, "你不是女巫", "not-witch");
  if (!Number.isInteger(targetId) || !room.game.players[targetId]?.alive) return sendError(seatOf(room, seatId)?.ws, "目标无效", "bad-target");
  room.dawnVotes.set(seatId, targetId);
  const witches = aliveWitches(room.game);
  if (witches.every((w) => room.dawnVotes.has(w.id))) finalizeDawn(room);
  else sync(room);
}

function submitNight(room, seatId, payload) {
  if (!room.game || room.game.phase !== "night") return sendError(seatOf(room, seatId)?.ws, "当前不是夜晚", "not-night");
  const player = room.game.players[seatId];
  if (!player?.alive) return sendError(seatOf(room, seatId)?.ws, "你已死亡", "dead");
  const vote = room.nightVotes.get(seatId) ?? {};
  if (player.everWitch) {
    if (!Number.isInteger(payload.targetId)) return sendError(seatOf(room, seatId)?.ws, "请选择夜杀目标", "target-required");
    if (!room.game.players[payload.targetId]?.alive) return sendError(seatOf(room, seatId)?.ws, "目标无效", "bad-target");
    vote.targetId = payload.targetId;
  }
  if (room.game.constableId === seatId) {
    if (payload.hammerTargetId === null || payload.hammerTargetId === undefined) vote.hammerTargetId = null;
    else if (!Number.isInteger(payload.hammerTargetId) || !room.game.players[payload.hammerTargetId]?.alive) return sendError(seatOf(room, seatId)?.ws, "木槌目标无效", "bad-hammer");
    else if (payload.hammerTargetId === seatId) return sendError(seatOf(room, seatId)?.ws, "治安官不能锤自己", "hammer-self");
    else vote.hammerTargetId = payload.hammerTargetId;
  }
  if (payload.useWilliam) {
    if (effectiveRole(room.game, seatId) !== "william-phipps") return sendError(seatOf(room, seatId)?.ws, "你不是威廉·菲普斯", "not-william");
    if (player.used.william) return sendError(seatOf(room, seatId)?.ws, "威廉能力本局已用过", "william-used");
    if (payload.confess) return sendError(seatOf(room, seatId)?.ws, "自首与威廉能力只能选一个", "confess-and-william");
    vote.useWilliam = true;
  }
  if (payload.confess) vote.confess = true;
  room.nightVotes.set(seatId, vote);
  const required = nightRequired(room);
  if (required.every((id) => room.nightVotes.has(id))) finalizeNight(room);
  else sync(room);
}

function finalizeNight(room, timedOut = false) {
  if (!room.game || room.game.phase !== "night" || !room.game.night) return;
  clearTimeout(room.nightTimer);
  room.nightTimer = null;
  const witches = aliveWitches(room.game);
  const counts = new Map();
  for (const id of witches.map((w) => w.id)) {
    const vote = room.nightVotes.get(id);
    if (vote?.targetId !== undefined && vote.targetId !== null) counts.set(vote.targetId, (counts.get(vote.targetId) ?? 0) + 1);
  }
  let targetId = null;
  for (const [id, n] of counts) if (targetId === null || n > (counts.get(targetId) ?? 0)) targetId = id;
  if (targetId === null) targetId = defaultNightChoice(room.game).targetId;
  const constableVote = room.game.constableId === null ? null : room.nightVotes.get(room.game.constableId);
  let hammerTargetId = constableVote?.hammerTargetId ?? null;
  if (hammerTargetId === room.game.constableId) hammerTargetId = null;
  const confessions = room.seats
    .map((s) => s.id)
    .filter((id) => room.nightVotes.get(id)?.confess && room.game.players[id]?.alive);
  const silentConfessions = room.seats
    .map((s) => s.id)
    .filter((id) => room.nightVotes.get(id)?.useWilliam && room.game.players[id]?.alive);
  const result = resolveNight(room.game, { targetId, hammerTargetId, confessions, silentConfessions });
  if (!result.ok) {
    log("night resolve failed", result.reason);
    return;
  }
  room.game = result.state;
  broadcast(room, { type: "events", events: result.events });
  if (!finishIfOver(room)) setPhase(room, "playing");
  armTurnTimer(room);
  sync(room);
  log("night resolved", room.code, { targetId, hammerTargetId, confessions, silentConfessions, timedOut });
}

function handleAction(room, seatId, action, commandId) {
  if (!room.game) return;
  if (commandId) {
    if (room.seenCommands.has(commandId)) return;
    room.seenCommands.add(commandId);
    if (room.seenCommands.size > 500) {
      const first = room.seenCommands.values().next().value;
      room.seenCommands.delete(first);
    }
  }
  const seat = seatOf(room, seatId);
  if (!seat) return;
  if (room.phase === "over") return sendError(seat.ws, "对局已结束", "game-over");
  if (action?.kind === "night") return submitNight(room, seatId, action);
  if (action?.kind === "dawn") return submitDawn(room, seatId, action.targetId);
  if (room.phase !== "playing" || room.game.phase !== "action") return sendError(seat.ws, "当前不能行动", "not-action-phase");
  if (room.game.currentPlayerId !== seatId) return sendError(seat.ws, "还没轮到你", "not-your-turn");
  let result;
  if (action?.kind === "draw") result = drawTwo(room.game);
  else if (action?.kind === "play") result = playCard(room.game, { actorId: seatId, ...action.play });
  else if (action?.kind === "end") result = endTurn(room.game);
  else if (action?.kind === "samuel") result = samuelTake(room.game, seatId, action.cardIds ?? []);
  else if (action?.kind === "tituba") result = titubaReorder(room.game, seatId, action.order ?? []);
  else return sendError(seat.ws, "未知操作", "unknown-action");
  applyResult(room, result, seatId);
}

function handleMessage(ws, raw) {
  let message;
  try { message = JSON.parse(raw.toString()); } catch { return sendError(ws, "消息不是合法 JSON", "bad-json"); }
  const type = message?.type;
  if (type === "ping") return send(ws, { type: "pong", t: Date.now() });
  if (type === "create") return createRoom(ws, message.name, message.config);
  if (type === "join") return joinRoom(ws, message.code, message.name, message.token);
  const meta = sockets.get(ws);
  if (!meta) return sendError(ws, "尚未加入房间", "no-room");
  const room = rooms.get(meta.code);
  if (!room) return sendError(ws, "房间不存在", "room-not-found");
  const seat = seatOf(room, meta.seatId);
  if (!seat) return sendError(ws, "座位不存在", "no-seat");
  room.updatedAt = Date.now();
  if (type === "profile") return handleProfile(room, seat, message);
  if (type === "ready") {
    if (room.phase !== "lobby") return sendError(ws, "对局已开始", "not-lobby");
    seat.ready = Boolean(message.ready);
    return sync(room);
  }
  if (type === "config") {
    if (room.phase !== "lobby") return sendError(ws, "对局已开始", "not-lobby");
    if (seat.id !== room.hostSeat) return sendError(ws, "只有房主可以改配置", "not-host");
    const nextConfig = {};
    if (message.witchCount !== undefined && message.witchCount !== null && message.witchCount !== "") nextConfig.witchCount = Number(message.witchCount);
    if (message.identityCardsPerPlayer !== undefined && message.identityCardsPerPlayer !== null && message.identityCardsPerPlayer !== "") nextConfig.identityCardsPerPlayer = Number(message.identityCardsPerPlayer);
    try {
      resolveConfig({ playerCount: room.seats.length, ...nextConfig });
    } catch (error) {
      return sendError(ws, String(error.message || error), "invalid-config");
    }
    room.config = nextConfig;
    return sync(room);
  }
  if (type === "kick") {
    if (room.phase !== "lobby") return sendError(ws, "对局已开始，不能踢人", "not-lobby");
    if (seat.id !== room.hostSeat) return sendError(ws, "只有房主可以踢人", "not-host");
    const targetId = Number(message.seatId);
    if (!Number.isInteger(targetId) || targetId === seat.id) return sendError(ws, "目标无效", "bad-target");
    const target = seatOf(room, targetId);
    if (!target) return sendError(ws, "座位不存在", "no-seat");
    room.seats = room.seats.filter((s) => s.id !== targetId);
    if (target.ws) {
      send(target.ws, { type: "error", message: "你被房主移出房间", reason: "kicked" });
      try { target.ws.close(4003, "kicked"); } catch {}
    }
    sync(room);
    return;
  }
  if (type === "add-bot") return addBot(room, seat.id);
  if (type === "start") return startGameFromLobby(room, seat.id);
  if (type === "action") return handleAction(room, seat.id, message.action, message.commandId);
  if (type === "chat") {
    const text = String(message.text ?? "").slice(0, 200).trim();
    if (text) broadcast(room, { type: "chat", seatId: seat.id, name: seat.name, text, at: Date.now() });
    return;
  }
  if (type === "leave") return leaveRoom(ws);
  sendError(ws, "未知消息类型", "unknown-message");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { res.writeHead(400).end("bad request"); return; }
  if (pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
    return;
  }
  if (pathname === "/api/rooms") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([...rooms.values()].map(publicRoom)));
    return;
  }
  if (pathname.startsWith("/api/rooms/")) {
    const room = rooms.get(pathname.slice("/api/rooms/".length).toUpperCase());
    if (!room) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(publicRoom(room)));
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const base = pathname.startsWith("/assets/") ? ROOT : WEB;
  const filePath = normalize(join(base, pathname));
  if (!filePath.startsWith(base + "\\") && !filePath.startsWith(base + "/")) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) throw new Error("directory");
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": pathname.startsWith("/assets/") ? "public, max-age=86400" : "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}

const httpServer = createServer((req, res) => {
  serveStatic(req, res).catch((error) => {
    log("http error", error);
    if (!res.headersSent) res.writeHead(500);
    res.end("internal error");
  });
});

const wss = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://x");
  if (pathname !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", (raw) => {
    try { handleMessage(ws, raw); }
    catch (error) {
      log("message error", error);
      sendError(ws, "服务器处理失败", "server-error");
    }
  });
  ws.on("close", () => leaveRoom(ws));
  ws.on("error", (error) => log("ws error", error.message));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.updatedAt > ROOM_TTL_MS) {
      log("room expired", room.code);
      cleanupRoom(room);
    }
  }
}, 30000).unref();

httpServer.listen(PORT, HOST, () => {
  log("salem server listening", "http://" + HOST + ":" + PORT, "web", WEB);
});

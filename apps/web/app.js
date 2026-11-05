import {
  AVATAR_BUDGET_BYTES,
  AVATAR_DOWNSCALED_TIER,
  AVATAR_REGULAR_TIER,
  budgetVerdict,
  encodingCandidates,
  estimateDataUrlBytes,
  isTargetAvatarDataUrl,
  squareCropRect,
} from "./avatar-normalize.js";
import { cleanName, createProfileStore, initialOf } from "./profile-store.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = {
  ws: null,
  open: false,
  cards: new Map(),
  cardsReady: false,
  room: null,
  projection: null,
  private: null,
  seatId: null,
  pending: null,
  modalCard: null,
  chats: [],
  nightKey: null,
  turnLabel: "",
  nightChoice: { targetId: null, hammerTargetId: null, confess: false, useWilliam: false },
  power: null,
  samuelPick: [],
  titubaOrder: null,
  curseOptions: [],
  cursePick: 0,
  alibiOptions: [],
  alibiPick: [],
  dawnKey: null,
  dawnTarget: null,
  toastTimer: null,
  reconnectTimer: null,
  leaving: false,
  autoJoined: false,
  sent: [],
  avatars: {},
  quotaWarned: false,
};
// 调试入口：浏览器控制台与联调脚本可直接读当前状态。
globalThis.__salem = S;

const PHASE_LABEL = {
  lobby: "大厅",
  dawn: "黎明",
  action: "白天",
  playing: "白天",
  night: "夜晚",
  gameOver: "结束",
  over: "结束",
};

const TRIAL_LABEL = { witch: "女巫", constable: "治安官", townspeople: "平民" };

function loadSession() {
  try {
    const raw = sessionStorage.getItem("salem.session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(data) {
  try { sessionStorage.setItem("salem.session", JSON.stringify(data)); } catch { /* ignore */ }
}

function clearSession() {
  try { sessionStorage.removeItem("salem.session"); } catch { /* ignore */ }
}

function toast(text, ok = false) {
  const el = $("toast");
  el.textContent = text;
  el.className = "toast" + (ok ? " ok" : "");
  el.hidden = false;
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function card(id) {
  return S.cards.get(id) ?? { id, name: id, color: "none", typeLabel: "", points: 0, text: "", image: "" };
}

function roleName(id) {
  if (!id || id === "none") return "无角色";
  return card(id).name;
}

function seatName(id) {
  const fromRoom = S.room?.seats?.find((s) => s.id === id);
  if (fromRoom) return fromRoom.name;
  const fromProjection = S.projection?.seats?.find((s) => s.id === id);
  return fromProjection?.name ?? "玩家 " + id;
}

// 头像位内容：这个座位有头像就给圆形 <img>，没有就回落到昵称首字。
// 每次重绘都按 S.avatars 现算、不缓存 <img> 节点：设头像、换头像、移除头像
// 都在下一次 render 的同一帧里对全部展示面生效，不会留下旧图或空位。
function avatarInner(seatId, name) {
  const dataUrl = S.avatars?.[seatId];
  if (typeof dataUrl === "string" && dataUrl) {
    return '<img src="' + esc(dataUrl) + '" alt="" />';
  }
  return esc(initialOf(name));
}

function isSelf(id) {
  return id === S.seatId;
}

function selfSeat() {
  return S.room?.seats?.find((s) => s.id === S.seatId) ?? null;
}

function isHost() {
  return S.room?.hostSeat === S.seatId;
}

function myTurn() {
  return S.projection?.phase === "action" && S.projection.currentPlayerId === S.seatId;
}

function connect() {
  if (S.ws && (S.ws.readyState === WebSocket.OPEN || S.ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(proto + "//" + location.host + "/ws");
  S.ws = ws;
  ws.addEventListener("open", () => {
    S.open = true;
    S.autoJoined = false;
    // 新连接 = 新的补传机会；同一次连接里 maybeReupload 只会发一次。
    profileStore.beginConnection();
    const saved = loadSession();
    if (saved?.code && saved?.token && !S.room) {
      send({ type: "join", code: saved.code, token: saved.token });
      S.autoJoined = true;
    }
  });
  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handle(msg);
  });
  ws.addEventListener("close", () => {
    S.open = false;
    S.ws = null;
    if (S.room && !S.leaving) {
      toast("连接断开，正在重连…");
      clearTimeout(S.reconnectTimer);
      S.reconnectTimer = setTimeout(connect, 1500);
    }
  });
  ws.addEventListener("error", () => {
    if (!S.room) $("landingError").textContent = "无法连接服务器，请确认服务已启动。";
  });
}

function send(message) {
  if (!S.ws || S.ws.readyState !== WebSocket.OPEN) {
    toast("尚未连接服务器，请稍候");
    return false;
  }
  S.sent.push(message);
  if (S.sent.length > 50) S.sent.shift();
  S.ws.send(JSON.stringify(message));
  return true;
}

function commandId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function act(action) {
  send({ type: "action", commandId: commandId(), action });
}

// 本地存储包一层：读失败按「没写过」处理；写失败保持抛出，让 profile-store 判定降级。
const browserStorage = {
  getItem(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    localStorage.setItem(key, value);
  },
  removeItem(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

const profileStore = createProfileStore(browserStorage, { send: (message) => send(message) });

function handle(msg) {
  switch (msg.type) {
    case "welcome":
      S.seatId = msg.seatId;
      saveSession({ code: msg.code, token: msg.token, seatId: msg.seatId });
      S.avatars = msg.avatars && typeof msg.avatars === "object" ? { ...msg.avatars } : {};
      // 服务端没有自己的头像、本机却存着：连上后补一次，重连亦然（服务端同值幂等）。
      profileStore.maybeReupload({ avatars: S.avatars, seatId: S.seatId });
      break;
    case "avatar":
      if (!S.avatars) S.avatars = {};
      if (msg.dataUrl) S.avatars[msg.seatId] = msg.dataUrl;
      else delete S.avatars[msg.seatId];
      // 头像只是一个人的属性，服务端不 sync 房间，得自己重绘，
      // 这样七处展示面（含移除后的回落）在同一帧里一起换掉。
      render();
      break;
    case "room":
      S.room = msg.room;
      render();
      break;
    case "projection":
      S.projection = msg.projection;
      S.private = msg.private;
      if (msg.room) S.room = msg.room;
      render();
      break;
    case "events":
      // projection already carries the full log; events are a prompt to refresh nothing.
      break;
    case "notice":
      if (msg.message) toast(msg.message, true);
      break;
    case "chat":
      S.chats.push(msg);
      if (!S.chats.length || S.chats.length > 60) S.chats = S.chats.slice(-60);
      renderLog();
      if ($("logDrawer").hidden) toast(msg.name + "：" + msg.text);
      break;
    case "error":
      if (msg.reason === "room-not-found" || msg.reason === "no-seat") {
        clearSession();
        S.room = null;
        S.projection = null;
        S.private = null;
        S.seatId = null;
        render();
      }
      toast(msg.message || "操作失败");
      break;
    case "pong":
      break;
    default:
      break;
  }
}

function showScreen(name) {
  for (const id of ["landing", "lobby", "game"]) $(id).hidden = id !== name;
}

function render() {
  if (!S.room) {
    showScreen("landing");
    return;
  }
  if (S.room.phase === "lobby") {
    showScreen("lobby");
    renderLobby();
  } else {
    showScreen("game");
    renderGame();
  }
  renderOverlays();
}

function renderLobby() {
  const room = S.room;
  $("roomCode").textContent = room.code;
  $("seatCount").textContent = room.seats.length + "/" + room.maxPlayers;
  $("hostHint").textContent = isHost() ? "你是房主" : "等待房主开始";
  const addBot = $("addBotBtn");
  addBot.hidden = !isHost();
  addBot.disabled = room.seats.length >= room.maxPlayers;
  addBot.textContent = room.seats.length >= room.maxPlayers ? "已满" : "＋ 机器人";
  const seats = room.seats.map((seat) => {
    const tags = [];
    if (seat.id === room.hostSeat) tags.push("房主");
    if (seat.id === S.seatId) tags.push("你");
    if (seat.bot) tags.push("机器人");
    const isMe = seat.id === S.seatId;
    const kick = isHost() && seat.bot
      ? '<button class="seat-kick" data-kick="' + seat.id + '" title="移除机器人">×</button>'
      : "";
    const profileEntry = isMe ? ' data-profile="self" role="button" tabindex="0" title="编辑个人资料"' : "";
    return '<div class="lobby-seat ' + (seat.ready ? "ready " : "") + (seat.connected ? "" : "offline") + '"' + profileEntry + ">" +
      '<div class="avatar">' + avatarInner(seat.id, seat.name) + "</div>" +
      '<div style="min-width:0"><div class="seat-name">' + esc(seat.name) + "</div>" +
      '<div class="seat-sub">' + (tags.join(" · ") || "玩家") + (seat.connected ? "" : " · 离线") + (seat.ready ? " · 已准备" : " · 未准备") + "</div></div>" + kick + "</div>";
  }).join("");
  $("lobbySeats").innerHTML = seats || '<p class="muted">等待玩家加入…</p>';

  const self = selfSeat();
  $("readyBtn").textContent = self?.ready ? "取消准备" : "准备";
  $("readyBtn").disabled = !self;
  $("startBtn").hidden = !isHost();
  $("startBtn").disabled = !room.startable;
  $("startBtn").textContent = room.seats.length < 4 ? "至少 4 人" : (room.startable ? "开始游戏" : "等待全部准备");

  const w = $("witchCount");
  const c = $("cardsPerPlayer");
  const config = room.config ?? {};
  const defaults = room.defaults ?? {};
  if (document.activeElement !== w && (config.witchCount ?? defaults.witchCount) != null) w.value = config.witchCount ?? defaults.witchCount;
  if (document.activeElement !== c && (config.identityCardsPerPlayer ?? defaults.identityCardsPerPlayer) != null) c.value = config.identityCardsPerPlayer ?? defaults.identityCardsPerPlayer;
  w.disabled = !isHost();
  c.disabled = !isHost();
  $("applyConfig").disabled = !isHost();
  const uneven = defaults && defaults.identityCardTotal && defaults.identityCardTotal % room.seats.length !== 0;
  $("configHint").textContent = defaults
    ? "当前 " + room.seats.length + " 人默认：女巫 " + defaults.witchCount +
      "，身份卡共 " + (defaults.identityCardTotal ?? room.seats.length * defaults.identityCardsPerPlayer) +
      " 张（每人 " + defaults.identityCardsPerPlayer + " 张" + (uneven ? "，其中 1 人少 1 张" : "") + "）。"
    : "人数会决定默认配比。";
}

function trialChips(player, compact = false) {
  const trials = player.trials ?? [];
  if (!trials.length) return '<span class="muted">无身份卡</span>';
  return trials.map((t) => {
    if (!t.revealed) return '<span class="trial-chip">?</span>';
    const kind = t.kind ?? "townspeople";
    return '<span class="trial-chip revealed ' + (kind === "witch" ? "witch" : "") + '">' + (TRIAL_LABEL[kind] ?? kind) + "</span>";
  }).join("");
}

function miniCards(player) {
  const parts = [];
  for (const id of player.blue ?? []) parts.push('<span class="mini blue">' + esc(card(id).name) + "</span>");
  for (const id of player.green ?? []) parts.push('<span class="mini green">' + esc(card(id).name) + "</span>");
  return parts.join("");
}

function selectableSeat(id) {
  return Boolean(S.pending) && !isSelf(id) && S.projection?.seats?.find((p) => p.id === id)?.alive;
}

function renderGame() {
  const p = S.projection;
  if (!p) {
    $("opponents").innerHTML = "";
    $("hand").innerHTML = "";
    $("selfPanel").innerHTML = "";
    $("actionBar").innerHTML = "";
    $("centerHint").textContent = "正在同步对局…";
    return;
  }
  const my = p.self;
  const opponents = p.seats.filter((s) => s.id !== S.seatId);
  $("opponents").innerHTML = opponents.map((player) => {
    const classes = ["seat-card"];
    if (player.alive === false) classes.push("dead");
    if (selectableSeat(player.id)) classes.push("selectable");
    if (p.currentPlayerId === player.id) classes.push("me");
    return '<button class="' + classes.join(" ") + '" data-seat="' + player.id + '">' +
      '<div class="avatar">' + avatarInner(player.id, player.name) + "</div>" +
      '<div class="seat-name">' + esc(player.name) + "</div>" +
      '<div class="seat-meta"><span>手牌 <b>' + player.handCount + "</b></span><span>指控 <b>" + player.accusations + "</b></span></div>" +
      '<div class="trial-dots">' + (player.trials ?? []).map((t) => '<span class="dot ' + (t.revealed ? (t.kind === "witch" ? "witch" : t.kind === "constable" ? "constable" : "on") : "") + '"></span>').join("") + "</div>" +
      (miniCards(player) ? '<div class="mini-cards">' + miniCards(player) + "</div>" : "") +
      (player.everWitch === true ? '<div class="seat-sub" style="color:#d4574b">曾为女巫</div>' : "") +
      "</button>";
  }).join("");

  $("selfPanel").innerHTML =
    '<div class="avatar">' + avatarInner(S.seatId, seatName(S.seatId)) + "</div>" +
    '<div class="self-main"><div class="self-name">' + esc(seatName(S.seatId)) + " · 你</div>" +
    '<div class="self-role">' + esc(roleName(my.role)) + (my.alive ? "" : " · 已死亡") + " · 指控 " + (my.accusations?.length ?? 0) + " 点</div></div>" +
    '<div class="self-trials">' + trialChips({ trials: my.trials }) + "</div>";

  $("hand").innerHTML = (my.hand ?? []).map((id) => {
    const c = card(id);
    return '<button class="card ' + c.color + '" data-card="' + esc(id) + '" title="' + esc(c.name) + '">' +
      (c.image ? '<img src="/' + esc(c.image) + '" alt="" loading="lazy" />' : "") +
      (c.points ? '<span class="pts">' + c.points + "</span>" : "") +
      '<span class="label">' + esc(c.name) + "</span></button>";
  }).join("") || '<p class="muted">手牌为空</p>';

  $("deckCount").textContent = p.deckCount;
  $("discardCount").textContent = p.discardCount;
  $("phaseText").textContent = PHASE_LABEL[p.phase] ?? p.phase;
  const turnName = p.currentPlayerId === S.seatId ? "你" : seatName(p.currentPlayerId);
  S.turnLabel = p.phase === "action" ? "轮到 " + turnName : (PHASE_LABEL[p.phase] ?? p.phase);
  $("turnBadge").textContent = S.turnLabel;

  let hint = "";
  if (p.phase === "action") {
    if (myTurn()) hint = p.actionTaken ? "本回合已行动，结束回合交给下一位。" : "打出一张牌，或抽两张并结束回合。";
    else hint = "等待 " + turnName + " 行动…";
  } else if (p.phase === "night") hint = "夜晚结算中…";
  else if (p.phase === "dawn") hint = "黎明：女巫正在放置黑猫…";
  else if (p.phase === "gameOver") hint = "对局结束";
  $("centerHint").textContent = hint;

  if (p.phase === "action" && myTurn()) {
    if (p.actionTaken) {
      $("actionBar").innerHTML = '<button class="btn primary" data-act="end">结束回合</button>';
    } else {
      const extra = [];
      if (my.role === "samuel-parris" && (my.used?.samuel ?? 0) < 2 &&
          (p.discard ?? []).some((id) => card(id).color !== "black")) {
        extra.push('<button class="btn gold" data-act="samuel">萨缪尔：从弃牌堆拿牌</button>');
      }
      if (my.role === "tituba" && !my.used?.tituba && (p.deckOrder?.length ?? 0) > 1) {
        extra.push('<button class="btn gold" data-act="tituba">蒂图巴：重排牌堆</button>');
      }
      $("actionBar").innerHTML = '<button class="btn gold" data-act="draw">抽 2 张并结束</button>' + extra.join("");
    }
  } else {
    $("actionBar").innerHTML = "";
  }

  renderTargetBanner();
  renderLog();
}

function openPower(kind) {
  if (!myTurn()) { toast("还没轮到你"); return; }
  if (kind === "samuel") {
    S.power = "samuel";
    S.samuelPick = [];
  } else if (kind === "tituba") {
    if (!(S.projection?.deckOrder?.length > 1)) { toast("现在不能重排牌堆"); return; }
    S.power = "tituba";
    S.titubaOrder = S.projection.deckOrder.slice();
  } else {
    return;
  }
  $("powerOverlay").hidden = false;
  renderPower();
}

function closePower() {
  S.power = null;
  S.samuelPick = [];
  S.titubaOrder = null;
  S.curseOptions = [];
  S.cursePick = 0;
  S.alibiOptions = [];
  S.alibiPick = [];
  $("powerOverlay").hidden = true;
}

function openAlibi(target) {
  S.power = "alibi";
  S.alibiOptions = (target?.accusationsCards ?? []).slice();
  // 默认按规则选：最多 3 张指控；没有指控则选 1 张证据。
  const accusations = S.alibiOptions.map((c, i) => ({ c, i })).filter((x) => x.c === "accusation").slice(0, 3).map((x) => x.i);
  if (accusations.length) S.alibiPick = accusations;
  else {
    const evidence = S.alibiOptions.indexOf("evidence");
    S.alibiPick = evidence >= 0 ? [evidence] : [];
  }
  $("powerOverlay").hidden = false;
  renderPower();
}

function renderPower() {
  if (!S.power) return;
  const list = $("powerList");
  const confirm = $("powerConfirm");
  if (S.power === "samuel") {
    const discard = S.projection?.discard ?? [];
    $("powerKicker").textContent = "角色能力";
    $("powerTitle").textContent = "塞缪尔·帕里斯";
    $("powerText").textContent = "从弃牌堆选择至多 2 张非黑牌；确认后本回合结束。";
    if (!discard.length) {
      list.innerHTML = '<div class="power-empty">弃牌堆为空</div>';
    } else {
      list.innerHTML = discard.map((id, index) => {
        const c = card(id);
        const black = c.color === "black";
        const picked = S.samuelPick.includes(index);
        return '<button class="power-row ' + (picked ? "selected" : "") + (black ? " disabled" : "") +
          '" data-samuel="' + index + '"' + (black ? " disabled" : "") + '>' +
          '<span class="power-name">' + esc(c.name) + "</span>" +
          '<span class="power-tag">' + (black ? "黑牌不可拿" : esc(c.typeLabel || "")) + "</span></button>";
      }).join("");
    }
    confirm.textContent = "拿走 " + S.samuelPick.length + " 张并结束回合";
    confirm.disabled = S.samuelPick.length === 0;
    return;
  }
  if (S.power === "alibi") {
    $("powerKicker").textContent = "辩护";
    $("powerTitle").textContent = "选择要弃掉的红卡";
    $("powerText").textContent = "最多 3 张指控，或单独 1 张证据；两类不能混选。";
    if (!S.alibiOptions.length) {
      list.innerHTML = '<div class="power-empty">目标面前没有红卡</div>';
    } else {
      list.innerHTML = S.alibiOptions.map((id, index) => {
        const c = card(id);
        const picked = S.alibiPick.includes(index);
        return '<button class="power-row ' + (picked ? "selected" : "") +
          '" data-alibi="' + index + '"><span class="power-name">' + esc(c.name) +
          '</span><span class="power-tag">' + (c.points ?? 0) + " 点</span></button>";
      }).join("");
    }
    confirm.textContent = "弃掉 " + S.alibiPick.length + " 张";
    confirm.disabled = S.alibiPick.length === 0;
    return;
  }
  if (S.power === "curse") {
    $("powerKicker").textContent = "诅咒";
    $("powerTitle").textContent = "选择弃掉的蓝卡";
    $("powerText").textContent = "目标面前有多张蓝卡；选择一张弃掉。";
    list.innerHTML = S.curseOptions.map((id, index) => {
      const c = card(id);
      return '<button class="power-row ' + (S.cursePick === index ? "selected" : "") +
        '" data-curse="' + index + '"><span class="power-name">' + esc(c.name) +
        '</span><span class="power-tag">' + esc(c.typeLabel || "") + "</span></button>";
    }).join("");
    confirm.textContent = "弃掉这张蓝卡";
    confirm.disabled = S.curseOptions.length === 0;
    return;
  }
  const order = S.titubaOrder ?? [];
  $("powerKicker").textContent = "角色能力";
  $("powerTitle").textContent = "蒂图巴";
  $("powerText").textContent = "牌堆从上到下排列；确认后本局能力用掉。";
  list.innerHTML = order.map((id, index) => {
    const c = card(id);
    return '<div class="power-row">' +
      '<span class="power-tag">' + (index + 1) + "</span>" +
      '<span class="power-name">' + esc(c.name) + "</span>" +
      '<button class="move" data-tituba="' + index + '" data-dir="-1"' + (index === 0 ? " disabled" : "") + '>↑</button>' +
      '<button class="move" data-tituba="' + index + '" data-dir="1"' + (index === order.length - 1 ? " disabled" : "") + '>↓</button>' +
      "</div>";
  }).join("");
  confirm.textContent = "确认牌堆顺序";
  confirm.disabled = order.length < 2;
}

function renderTargetBanner() {
  const banner = $("targetBanner");
  if (!S.pending) {
    banner.hidden = true;
    return;
  }
  const c = card(S.pending.cardId);
  banner.hidden = false;
  if (S.pending.stage === "source") $("targetText").textContent = "「" + c.name + "」：先选来源玩家";
  else if (S.pending.sourceId != null) $("targetText").textContent = "来源 " + seatName(S.pending.sourceId) + "，再选目标";
  else $("targetText").textContent = "「" + c.name + "」：选择目标玩家";
}

function renderLog() {
  const lines = [];
  const log = S.projection?.log ?? [];
  for (const e of log.slice(-100)) lines.push('<div class="log-line">' + formatEvent(e) + "</div>");
  for (const c of S.chats.slice(-30)) lines.push('<div class="log-line">💬 <b>' + esc(c.name) + "</b>：" + esc(c.text) + "</div>");
  $("logList").innerHTML = lines.join("") || '<p class="muted">还没有事件。</p>';
  $("logList").scrollTop = $("logList").scrollHeight;
}

function formatEvent(e) {
  const n = (id) => "<b>" + esc(seatName(id)) + "</b>";
  const cn = (id) => '<span class="gold">「' + esc(card(id).name) + "」</span>";
  switch (e.type) {
    case "gameStarted": return "对局开始，先手 " + n(e.firstPlayerId) + "。";
    case "blackCatPlaced": return "黑猫被放到了 " + n(e.targetId) + " 面前。";
    case "turnStarted": return "轮到 " + n(e.playerId) + "。";
    case "turnEnded": return n(e.playerId) + " 结束回合。";
    case "stocksSkipped": return n(e.playerId) + " 被拘留，跳过回合（剩余 " + e.remaining + "）。";
    case "cardDrawn": return n(e.playerId) + " 抽了 " + e.count + " 张牌。";
    case "deckReshuffled": return "弃牌堆洗回牌堆（" + e.count + " 张）。";
    case "cardPlayed": {
      let text = n(e.actorId) + " 打出 " + cn(e.cardId);
      if (e.sourceId != null) text += "，来源 " + n(e.sourceId);
      if (e.targetId != null) text += " → " + n(e.targetId);
      if (e.asWitness) text += "（作为目击）";
      return text + "。";
    }
    case "cardNullified": return cn(e.cardId) + " 被莎拉·古德免疫，立刻丢弃。";
    case "accusationAdded": return n(e.targetId) + " 面前 +" + e.points + " 点（" + esc(card(e.cardId).name) + "），共 " + e.total + " 点。";
    case "accusationsDiscarded": return n(e.playerId) + " 弃掉 " + e.count + " 张指控。";
    case "trialRevealed": return n(e.playerId) + " 翻开一张身份卡：" + (TRIAL_LABEL[e.kind] ?? e.kind) + "（" + esc(e.cause) + "）。";
    case "playerDied": return '<span class="red">' + n(e.playerId) + " 死亡（" + esc(e.cause) + "）。</span>";
    case "handDiscarded": return n(e.playerId) + " 弃掉 " + e.count + " 张手牌。";
    case "handTransferred": return n(e.fromId) + " 的 " + e.count + " 张手牌交给 " + n(e.toId) + "。";
    case "blueAttached": return n(e.playerId) + " 面前放置 " + cn(e.cardId) + "。";
    case "blueDiscarded": return n(e.playerId) + " 弃掉蓝卡 " + cn(e.cardId) + "。";
    case "frontMoved": return n(e.fromId) + " 面前所有牌移到 " + n(e.toId) + "（红 " + e.red + " / 蓝 " + e.blue + " / 绿 " + e.green + "）。";
    case "matchmakerBroke": return '<span class="red">情侣连锁：' + e.playerIds.map(n).join("、") + " 同死。</span>";
    case "powerUsed": return n(e.playerId) + " 使用能力：" + esc(e.power) + "。";
    case "conspiracyStarted": return n(e.drawerId) + " 抽到传染，全体换牌。";
    case "conspiracySwap": return n(e.fromId) + " 从左邻 " + n(e.toId) + " 取一张身份卡查看后洗回。";
    case "nightStarted": return '<span class="gold">夜晚降临。</span>';
    case "confession": return n(e.playerId) + " 自首" + (e.revealed ? "，翻开一张身份卡。" : "。");
    case "nightResolved": return "夜晚结束：" + n(e.targetId) + (e.saved ? " 被救下" : '<span class="red"> 被杀</span>') + "（" + esc(e.cause) + "）。";
    case "winner": return '<span class="gold">对局结束：' + (e.winner === "town" ? "平民胜利" : e.winner === "witches" ? "女巫胜利" : "结束") + " —— " + esc(e.reason) + "。</span>";
    case "notice": return esc(e.text);
    default: return esc(e.type);
  }
}

function renderOverlays() {
  const p = S.projection;
  const phase = p?.phase;
  $("nightOverlay").hidden = phase !== "night";
  $("dawnOverlay").hidden = phase !== "dawn";
  $("overOverlay").hidden = phase !== "gameOver";
  $("chatBar").hidden = !(S.room && S.room.phase !== "lobby" && phase !== "gameOver");
  if (phase === "night") renderNight();
  if (phase === "dawn") renderDawn();
  if (phase === "gameOver") renderOver();
  updateTimers();
}

function renderNight() {
  const info = S.private?.night;
  if (!info) return;
  const key = String(info.deadline ?? "night");
  if (S.nightKey !== key) {
    S.nightKey = key;
    S.nightChoice = {
      targetId: info.targetId ?? null,
      hammerTargetId: info.hammerTargetId ?? null,
      confess: Boolean(info.confess),
      useWilliam: Boolean(info.useWilliam),
    };
  }
  const roles = [];
  if (info.isWitch) roles.push("女巫：选择夜杀目标");
  if (info.isConstable) roles.push("治安官：可用木槌赦免一人");
  if (!roles.length) roles.push("你不是夜晚行动者");
  $("nightPrompt").textContent = roles.join("；") + "。";

  $("nightKillBlock").hidden = !info.isWitch;
  if (info.isWitch) {
    $("nightTargets").innerHTML = (S.projection?.seats ?? []).filter((s) => s.alive).map((s) =>
      '<button class="pick ' + (S.nightChoice.targetId === s.id ? "selected" : "") + '" data-night-target="' + s.id + '">' +
      '<span class="avatar">' + avatarInner(s.id, s.name) + "</span><span>" + esc(s.name) + "</span></button>").join("");
  }
  $("nightHammerBlock").hidden = !info.isConstable;
  if (info.isConstable) {
    const options = (S.projection?.seats ?? []).filter((s) => s.alive && s.id !== S.seatId);
    $("nightHammer").innerHTML =
      '<button class="pick ' + (S.nightChoice.hammerTargetId == null ? "selected" : "") + '" data-hammer="none">不使用木槌</button>' +
      options.map((s) => '<button class="pick ' + (S.nightChoice.hammerTargetId === s.id ? "selected" : "") + '" data-hammer="' + s.id + '">' +
        '<span class="avatar">' + avatarInner(s.id, s.name) + "</span><span>" + esc(s.name) + "</span></button>").join("");
  }
  $("nightConfessBlock").hidden = !info.canConfess;
  $("confessCheck").checked = S.nightChoice.confess;
  $("nightWilliamBlock").hidden = !info.canWilliam;
  $("williamCheck").checked = S.nightChoice.useWilliam;
  const mustAct = info.isWitch || info.isConstable || info.canConfess || info.canWilliam;
  $("submitNight").hidden = !mustAct;
  $("submitNight").disabled = Boolean(info.submitted);
  $("nightWaiting").hidden = !info.submitted;
  if (info.submitted) $("nightWaiting").textContent = "已提交，等待其他玩家……";
}

function renderDawn() {
  const info = S.private?.dawn;
  if (!info) return;
  const key = String(info.deadline ?? "dawn");
  if (S.dawnKey !== key) {
    S.dawnKey = key;
    S.dawnTarget = null;
  }
  $("dawnPrompt").textContent = info.isWitch ? "你是女巫：选择把黑猫放到谁面前。" : "等待女巫放置黑猫……";
  $("dawnBlock").hidden = !info.isWitch;
  $("submitDawn").hidden = !info.isWitch;
  $("submitDawn").disabled = Boolean(info.submitted);
  $("dawnWaiting").hidden = !info.submitted;
  if (info.submitted) $("dawnWaiting").textContent = "已选择，等待其他女巫……";
  if (info.isWitch) {
    $("dawnTargets").innerHTML = (S.projection?.seats ?? []).filter((s) => s.alive).map((s) =>
      '<button class="pick ' + (S.dawnTarget === s.id ? "selected" : "") + '" data-dawn-target="' + s.id + '">' +
      '<span class="avatar">' + avatarInner(s.id, s.name) + "</span><span>" + esc(s.name) + (s.id === S.seatId ? "（你）" : "") + "</span></button>").join("");
  }
}

function renderOver() {
  const p = S.projection;
  $("overTitle").textContent = p?.winner === "town" ? "平民胜利" : p?.winner === "witches" ? "女巫胜利" : "对局结束";
  $("overReason").textContent = p?.winnerReason ?? "";
  $("overRoles").innerHTML = (p?.seats ?? []).map((s) => {
    const kindClass = s.everWitch === true ? "witch" : "";
    return '<div class="over-role ' + kindClass + '">' +
      '<div class="over-name"><span class="avatar">' + avatarInner(s.id, s.name) + "</span>" +
      "<b>" + esc(s.name) + (s.id === S.seatId ? "（你）" : "") + "</b></div>" +
      esc(roleName(s.role)) + " · " + (s.alive ? "存活" : "死亡") + "<br />" + trialChips(s) + "</div>";
  }).join("");
}

function updateTimers() {
  const p = S.private;
  const now = Date.now();
  const seconds = (deadline) => Math.max(0, Math.ceil((Number(deadline) - now) / 1000));
  const myTurnNow = S.projection?.phase === "action" && S.projection.currentPlayerId === S.seatId;
  const actionLeft = myTurnNow && p?.turnDeadline ? seconds(p.turnDeadline) : null;
  $("turnBadge").textContent = S.turnLabel + (actionLeft !== null ? " · " + actionLeft + "s" : "");
  if (p?.dawn?.deadline) $("dawnTimer").textContent = seconds(p.dawn.deadline) + "s";
  if (p?.night?.deadline) $("nightTimer").textContent = seconds(p.night.deadline) + "s";
}

function openCardModal(cardId) {
  const c = card(cardId);
  S.modalCard = cardId;
  $("detailImage").src = c.image ? "/" + c.image : "";
  $("detailImage").alt = c.name;
  $("detailKicker").textContent = [c.typeLabel, c.points ? c.points + " 点" : ""].filter(Boolean).join(" · ");
  $("detailTitle").textContent = c.name;
  $("detailText").textContent = c.text || "（无文字）";
  const mine = myTurn() && S.projection?.self?.hand?.includes(cardId);
  $("playCardBtn").disabled = !mine;
  $("playWitnessBtn").hidden = !(mine && cardId === "alibi" && S.projection?.self?.role === "will-griggs");
  $("playWitnessBtn").disabled = !mine;
  const canAbigail = mine && S.projection?.self?.role === "abigail-williams" && (S.projection?.self?.accusations?.length ?? 0) > 0;
  $("playAbigailBtn").hidden = !canAbigail;
  $("playAbigailBtn").disabled = !canAbigail;
  $("cardModal").hidden = false;
}

function closeModal() {
  $("cardModal").hidden = true;
  S.modalCard = null;
}

// ---------- 个人资料弹层 ----------

let profileDraft = null;

function openProfileEntry() {
  return selfSeat()?.name ?? ($("nameInput").value.trim() || profileStore.readName() || "");
}

function openProfile() {
  const name0 = openProfileEntry();
  const avatar0 = S.avatars?.[S.seatId] ?? profileStore.readAvatar();
  profileDraft = { name0, avatar0, avatar: avatar0 };
  $("profileName").value = name0;
  $("profileHint").textContent = "";
  renderProfilePreview();
  $("profileModal").hidden = false;
  $("profileName").focus();
}

function closeProfile() {
  $("profileModal").hidden = true;
  // 未保存关闭：丢掉草稿，服务端与本机都保持原样。
  profileDraft = null;
  $("profileFile").value = "";
  $("profileHint").textContent = "";
}

function renderProfilePreview() {
  const box = $("profileAvatar");
  const avatar = profileDraft?.avatar ?? null;
  if (avatar) {
    box.innerHTML = '<img src="' + esc(avatar) + '" alt="" />';
    return;
  }
  box.textContent = initialOf(cleanName($("profileName").value));
}

function warnQuotaOnce() {
  if (S.quotaWarned) return;
  S.quotaWarned = true;
  toast("本机存不下这张图，这次先不带头像");
}

function saveProfile() {
  const draft = profileDraft;
  if (!draft) return;
  const name = cleanName($("profileName").value);
  const nameChanged = cleanName(draft.name0) !== name;
  const avatarChanged = draft.avatar !== draft.avatar0;
  const payload = { type: "profile" };
  let quotaDegraded = false;

  if (nameChanged) {
    const written = profileStore.writeName(name);
    quotaDegraded = quotaDegraded || written.degraded;
    payload.name = name;
  }

  if (avatarChanged) {
    if (draft.avatar === null) {
      profileStore.removeAvatar();
      payload.avatar = null;
    } else {
      const written = profileStore.writeAvatar(draft.avatar);
      if (written.ok) {
        payload.avatar = draft.avatar;
      } else if (written.degraded) {
        // 配额失败：降级为「本次无头像」，改名照旧；旧图一并清掉，免得下次又被补传。
        quotaDegraded = true;
        profileStore.removeAvatar();
      } else {
        $("profileHint").textContent = "这张图片存不下来，点「选择图片」再试一次。";
        return;
      }
    }
  }

  if (quotaDegraded) warnQuotaOnce();

  const hasChanges = payload.name !== undefined || payload.avatar !== undefined;
  if (!hasChanges) {
    closeProfile();
    return;
  }

  const canSend = Boolean(S.room) && S.seatId !== null && S.seatId !== undefined;
  if (!canSend) {
    $("nameInput").value = name;
    closeProfile();
    toast("已存在本机，进房后自动带上", true);
    return;
  }

  if (!send(payload)) return;
  if (payload.avatar === null) delete S.avatars[S.seatId];
  else if (payload.avatar !== undefined) S.avatars[S.seatId] = payload.avatar;
  $("nameInput").value = name;
  closeProfile();
  toast("个人资料已更新", true);
}

// 图片处理：格式拒收 → 解码（优先 createImageBitmap）→ 方形裁切 → 两档编码与体积预算。

function containsAscii(bytes, text) {
  const codes = Array.from(text, (ch) => ch.charCodeAt(0));
  outer: for (let i = 0; i + codes.length <= bytes.length; i += 1) {
    for (let j = 0; j < codes.length; j += 1) {
      if (bytes[i + j] !== codes[j]) continue outer;
    }
    return true;
  }
  return false;
}

function isAnimatedBytes(bytes) {
  if (bytes.length >= 6) {
    const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    if (head === "GIF87a" || head === "GIF89a") return true;
  }
  // APNG 的 acTL、动图 WebP 的 ANIM/ANMF 块都出现在文件头部附近。
  return containsAscii(bytes, "acTL") || containsAscii(bytes, "ANIM") || containsAscii(bytes, "ANMF");
}

function exifOrientation(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4) return 1;
  if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(offset + 2, false);
    if (length < 2 || offset + 2 + length > view.byteLength) break;
    if (marker === 0xe1 && offset + 10 <= view.byteLength) {
      let isExif = true;
      for (let i = 0; i < 6; i += 1) {
        if (view.getUint8(offset + 4 + i) !== "Exif\0\0".charCodeAt(i)) isExif = false;
      }
      if (isExif) return readTiffOrientation(view, offset + 10);
    }
    offset += 2 + length;
  }
  return 1;
}

function readTiffOrientation(view, start) {
  if (start + 8 > view.byteLength) return 1;
  const first = view.getUint8(start);
  const second = view.getUint8(start + 1);
  const little = first === 0x49 && second === 0x49;
  const big = first === 0x4d && second === 0x4d;
  if (!little && !big) return 1;
  const get16 = (at) => view.getUint16(at, little);
  const ifd = start + view.getUint32(start + 4, little);
  if (ifd + 2 > view.byteLength) return 1;
  const count = get16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    if (get16(entry) === 0x0112) {
      const value = get16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** EXIF 方向对应的绘制变换：把原图坐标映射到「已摆正」的方向。 */
function orientationMatrix(orientation, width, height) {
  switch (orientation) {
    case 2: return { a: -1, b: 0, c: 0, d: 1, e: width, f: 0 };
    case 3: return { a: -1, b: 0, c: 0, d: -1, e: width, f: height };
    case 4: return { a: 1, b: 0, c: 0, d: -1, e: 0, f: height };
    case 5: return { a: 0, b: 1, c: 1, d: 0, e: 0, f: 0 };
    case 6: return { a: 0, b: 1, c: -1, d: 0, e: height, f: 0 };
    case 7: return { a: 0, b: -1, c: -1, d: 0, e: height, f: width };
    case 8: return { a: 0, b: -1, c: 1, d: 0, e: 0, f: width };
    default: return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
}

function multiplyMatrix(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

async function decodeAvatarSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        orientation: 1,
        naturalWidth: bitmap.width,
        naturalHeight: bitmap.height,
        release: () => bitmap.close?.(),
      };
    } catch {
      // 浏览器不认这个选项或这次解码失败：回退到 Image 元素自己摆正。
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    const orientation = file.type === "image/jpeg" ? exifOrientation(await file.slice(0, 256 * 1024).arrayBuffer()) : 1;
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    const swapped = orientation >= 5;
    return {
      source: image,
      width: swapped ? naturalHeight : naturalWidth,
      height: swapped ? naturalWidth : naturalHeight,
      orientation,
      naturalWidth,
      naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function encodeAvatarCanvas(canvas, tier) {
  let over = false;
  for (const candidate of encodingCandidates(tier)) {
    const dataUrl = candidate.quality === undefined
      ? canvas.toDataURL(candidate.mime)
      : canvas.toDataURL(candidate.mime, candidate.quality);
    // canvas 对不支持的格式会静默回退 PNG，所以按返回串前缀确认，而不是按请求的 mime。
    if (!isTargetAvatarDataUrl(dataUrl)) continue;
    const verdict = budgetVerdict(estimateDataUrlBytes(dataUrl), AVATAR_BUDGET_BYTES);
    if (!verdict.over) return { ok: true, dataUrl };
    over = true;
  }
  return { ok: false, over };
}

function renderAvatarTier(decoded, tier) {
  const crop = squareCropRect(decoded.width, decoded.height);
  if (!crop.size) return { ok: false, over: false };
  const canvas = document.createElement("canvas");
  canvas.width = tier.edge;
  canvas.height = tier.edge;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, over: false };
  const scale = tier.edge / crop.size;
  const cropMatrix = { a: scale, b: 0, c: 0, d: scale, e: -crop.sx * scale, f: -crop.sy * scale };
  const base = orientationMatrix(decoded.orientation, decoded.naturalWidth, decoded.naturalHeight);
  const matrix = multiplyMatrix(cropMatrix, base);
  ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(decoded.source, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return encodeAvatarCanvas(canvas, tier);
}

async function prepareAvatarFile(file) {
  if (!file.type || !file.type.startsWith("image/")) {
    return { ok: false, message: "这不是图片文件。" };
  }
  if (file.type === "image/svg+xml") {
    return { ok: false, message: "不支持 SVG，换一张照片试试。" };
  }
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  if (file.type === "image/gif" || isAnimatedBytes(head)) {
    return { ok: false, message: "不支持动图，换一张静态图片。" };
  }
  let decoded;
  try {
    decoded = await decodeAvatarSource(file);
  } catch {
    return { ok: false, message: "这张图片格式无法读取，试试截图后再选。" };
  }
  try {
    const regular = renderAvatarTier(decoded, AVATAR_REGULAR_TIER);
    if (regular.ok) return regular;
    if (!regular.over) return { ok: false, message: "这张图片格式无法读取，试试截图后再选。" };
    const downscaled = renderAvatarTier(decoded, AVATAR_DOWNSCALED_TIER);
    if (downscaled.ok) return downscaled;
    return { ok: false, message: "这张图片太大了，换一张小一点的图。" };
  } finally {
    decoded.release();
  }
}

async function onProfileFileChange(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  $("profileHint").textContent = "正在处理图片…";
  const result = await prepareAvatarFile(file);
  if (!profileDraft) return;
  if (!result.ok) {
    $("profileHint").textContent = result.message;
    return;
  }
  profileDraft.avatar = result.dataUrl;
  renderProfilePreview();
  $("profileHint").textContent = "已选好新头像，点「保存」才会同步。";
}


function beginPlay(cardId, asWitness = false, useAbigail = false) {
  if (!myTurn()) { toast("还没轮到你"); return; }
  const c = card(cardId);
  if (c.target === "two") {
    S.pending = { cardId, asWitness, useAbigail, stage: "source" };
    closeModal();
    renderTargetBanner();
    return;
  }
  if (c.target === "other") {
    S.pending = { cardId, asWitness, useAbigail, stage: "target" };
    closeModal();
    renderTargetBanner();
    return;
  }
  sendPlay(cardId, undefined, undefined, asWitness, useAbigail);
}

function sendPlay(cardId, targetId, sourceId, asWitness, useAbigail = false, blueCardId, discardIndexes) {
  const play = { cardId, targetId, sourceId, asWitness: Boolean(asWitness), useAbigail: Boolean(useAbigail) };
  if (blueCardId) play.blueCardId = blueCardId;
  if (discardIndexes?.length) play.discardIndexes = discardIndexes.slice();
  act({ kind: "play", play });
  S.pending = null;
  closeModal();
  renderTargetBanner();
}

function onSeatClick(id) {
  if (!S.pending) return;
  const c = card(S.pending.cardId);
  if (S.pending.stage === "source") {
    if (id === S.seatId) { toast("来源不能是自己"); return; }
    S.pending.sourceId = id;
    S.pending.stage = "target";
    renderTargetBanner();
    return;
  }
  if (id === S.seatId) { toast("目标不能是自己"); return; }
  if (S.pending.sourceId === id) { toast("目标不能与来源相同"); return; }
  if (S.pending.cardId === "curse") {
    const target = S.projection?.seats?.find((seat) => seat.id === id);
    const blue = target?.blue ?? [];
    if (blue.length > 1) {
      S.pending.targetId = id;
      S.power = "curse";
      S.curseOptions = blue.slice();
      S.cursePick = 0;
      $("powerOverlay").hidden = false;
      renderPower();
      return;
    }
  }
  if (S.pending.cardId === "alibi" && !S.pending.asWitness) {
    const target = S.projection?.seats?.find((seat) => seat.id === id);
    if ((target?.accusationsCards?.length ?? 0) > 0) {
      S.pending.targetId = id;
      openAlibi(target);
      return;
    }
  }
  sendPlay(S.pending.cardId, id, S.pending.sourceId, S.pending.asWitness, S.pending.useAbigail);
}

function submitNight() {
  const info = S.private?.night;
  if (!info) return;
  if (S.nightChoice.confess && S.nightChoice.useWilliam) { toast("自首与威廉能力只能选一个"); return; }
  const payload = { kind: "night", confess: Boolean(S.nightChoice.confess), useWilliam: Boolean(S.nightChoice.useWilliam) };
  if (info.isWitch) {
    if (!Number.isInteger(S.nightChoice.targetId)) { toast("请选择夜杀目标"); return; }
    payload.targetId = S.nightChoice.targetId;
  }
  if (info.isConstable) payload.hammerTargetId = S.nightChoice.hammerTargetId;
  act(payload);
}

function submitDawn() {
  if (!Number.isInteger(S.dawnTarget)) { toast("请选择黑猫目标"); return; }
  act({ kind: "dawn", targetId: S.dawnTarget });
}

function leaveToLanding() {
  S.leaving = true;
  if (S.ws && S.ws.readyState === WebSocket.OPEN && S.room) send({ type: "leave" });
  clearSession();
  S.room = null;
  S.projection = null;
  S.private = null;
  S.seatId = null;
  S.pending = null;
  S.nightKey = null;
  S.dawnKey = null;
  S.avatars = {};
  closeModal();
  closeProfile();
  render();
  setTimeout(() => { S.leaving = false; }, 300);
}

function copyInvite() {
  if (!S.room) return;
  const url = location.origin + "/?code=" + S.room.code;
  const done = () => toast("邀请链接已复制", true);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => toast(url));
  else toast(url);
}

function bind() {
  $("createBtn").addEventListener("click", () => {
    const raw = $("nameInput").value.trim();
    if (!raw) { $("landingError").textContent = "请先填一个昵称。"; return; }
    $("landingError").textContent = "";
    const name = cleanName(raw);
    profileStore.writeName(name);
    S.leaving = false;
    send({ type: "create", name });
  });
  $("joinBtn").addEventListener("click", () => {
    const raw = $("nameInput").value.trim();
    const code = $("codeInput").value.trim().toUpperCase();
    if (!raw) { $("landingError").textContent = "请先填一个昵称。"; return; }
    if (code.length !== 6) { $("landingError").textContent = "房码是 6 位。"; return; }
    $("landingError").textContent = "";
    const name = cleanName(raw);
    profileStore.writeName(name);
    S.leaving = false;
    send({ type: "join", code, name });
  });
  $("codeInput").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });
  $("leaveLobby").addEventListener("click", leaveToLanding);
  $("copyLink").addEventListener("click", copyInvite);
  $("readyBtn").addEventListener("click", () => {
    const self = selfSeat();
    if (self) send({ type: "ready", ready: !self.ready });
  });
  $("addBotBtn").addEventListener("click", () => send({ type: "add-bot" }));
  $("lobbySeats").addEventListener("click", (event) => {
    const kick = event.target.closest("[data-kick]");
    if (kick) {
      if (isHost()) send({ type: "kick", seatId: Number(kick.dataset.kick) });
      return;
    }
    if (event.target.closest("[data-profile]")) openProfile();
  });
  $("lobbySeats").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!event.target.closest("[data-profile]")) return;
    event.preventDefault();
    openProfile();
  });
  $("startBtn").addEventListener("click", () => send({ type: "start" }));
  $("applyConfig").addEventListener("click", () => {
    const witchCount = Number($("witchCount").value);
    const identityCardsPerPlayer = Number($("cardsPerPlayer").value);
    const defaults = S.projection?.room?.defaults ?? S.room?.defaults ?? {};
    const message = { type: "config" };
    // 未改动的项不要回传：9 人默认 35 张不能被“每人 4 张”覆盖成 36 张。
    if (witchCount !== defaults.witchCount) message.witchCount = witchCount;
    if (identityCardsPerPlayer !== defaults.identityCardsPerPlayer) message.identityCardsPerPlayer = identityCardsPerPlayer;
    send(message);
  });
  $("logBtn").addEventListener("click", () => {
    $("logDrawer").hidden = false;
    renderLog();
  });
  $("closeLog").addEventListener("click", () => { $("logDrawer").hidden = true; });
  $("opponents").addEventListener("click", (event) => {
    const button = event.target.closest("[data-seat]");
    if (button) onSeatClick(Number(button.dataset.seat));
  });
  $("hand").addEventListener("click", (event) => {
    const button = event.target.closest("[data-card]");
    if (button) openCardModal(button.dataset.card);
  });
  $("actionBar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    if (button.dataset.act === "draw") act({ kind: "draw" });
    if (button.dataset.act === "end") act({ kind: "end" });
    if (button.dataset.act === "samuel") openPower("samuel");
    if (button.dataset.act === "tituba") openPower("tituba");
  });
  $("powerList").addEventListener("click", (event) => {
    const alibi = event.target.closest("[data-alibi]");
    if (alibi) {
      const index = Number(alibi.dataset.alibi);
      const kind = S.alibiOptions[index];
      if (kind === "evidence") {
        S.alibiPick = S.alibiPick.includes(index) ? [] : [index];
      } else {
        S.alibiPick = S.alibiPick.filter((i) => S.alibiOptions[i] !== "evidence");
        const at = S.alibiPick.indexOf(index);
        if (at >= 0) S.alibiPick.splice(at, 1);
        else if (S.alibiPick.length < 3) S.alibiPick.push(index);
        else toast("最多弃 3 张指控");
      }
      renderPower();
      return;
    }
    const curse = event.target.closest("[data-curse]");
    if (curse) {
      S.cursePick = Number(curse.dataset.curse);
      renderPower();
      return;
    }
    const samuel = event.target.closest("[data-samuel]");
    if (samuel && !samuel.disabled) {
      const index = Number(samuel.dataset.samuel);
      const at = S.samuelPick.indexOf(index);
      if (at >= 0) S.samuelPick.splice(at, 1);
      else if (S.samuelPick.length < 2) S.samuelPick.push(index);
      else toast("最多拿 2 张");
      renderPower();
      return;
    }
    const move = event.target.closest("[data-tituba]");
    if (move && !move.disabled && S.titubaOrder) {
      const index = Number(move.dataset.tituba);
      const to = index + Number(move.dataset.dir);
      if (to < 0 || to >= S.titubaOrder.length) return;
      const next = S.titubaOrder.slice();
      [next[index], next[to]] = [next[to], next[index]];
      S.titubaOrder = next;
      renderPower();
    }
  });
  $("powerConfirm").addEventListener("click", () => {
    if (S.power === "alibi") {
      if (!S.pending || !S.alibiPick.length) return;
      const pending = S.pending;
      const indexes = S.alibiPick.slice();
      closePower();
      sendPlay(pending.cardId, pending.targetId, pending.sourceId, pending.asWitness, pending.useAbigail, undefined, indexes);
      return;
    }
    if (S.power === "curse") {
      if (!S.curseOptions.length || !S.pending) return;
      const blueCardId = S.curseOptions[S.cursePick];
      const pending = S.pending;
      closePower();
      sendPlay(pending.cardId, pending.targetId, pending.sourceId, pending.asWitness, pending.useAbigail, blueCardId);
      return;
    }
    if (S.power === "samuel") {
      if (!S.samuelPick.length) return;
      const discard = S.projection?.discard ?? [];
      const cardIds = S.samuelPick.slice().sort((a, b) => a - b).map((i) => discard[i]);
      act({ kind: "samuel", cardIds });
      closePower();
    } else if (S.power === "tituba") {
      if ((S.titubaOrder?.length ?? 0) < 2) return;
      act({ kind: "tituba", order: S.titubaOrder.slice() });
      closePower();
    }
  });
  document.querySelectorAll("[data-close-power]").forEach((el) => el.addEventListener("click", closePower));
  $("cancelTarget").addEventListener("click", () => {
    S.pending = null;
    renderTargetBanner();
  });
  $("playCardBtn").addEventListener("click", () => {
    if (S.modalCard) beginPlay(S.modalCard, false);
  });
  $("playWitnessBtn").addEventListener("click", () => {
    if (S.modalCard) beginPlay(S.modalCard, true);
  });
  $("playAbigailBtn").addEventListener("click", () => {
    if (S.modalCard) beginPlay(S.modalCard, false, true);
  });
  document.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeModal));
  $("openProfileLanding").addEventListener("click", openProfile);
  $("selfPanel").addEventListener("click", openProfile);
  $("selfPanel").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openProfile();
  });
  $("profilePick").addEventListener("click", () => $("profileFile").click());
  $("profileFile").addEventListener("change", onProfileFileChange);
  $("profileRemove").addEventListener("click", () => {
    if (!profileDraft) return;
    profileDraft.avatar = null;
    renderProfilePreview();
    $("profileHint").textContent = "点「保存」后移除头像。";
  });
  $("profileSave").addEventListener("click", saveProfile);
  $("profileName").addEventListener("input", renderProfilePreview);
  document.querySelectorAll("[data-close-profile]").forEach((el) => el.addEventListener("click", closeProfile));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("profileModal").hidden) closeProfile();
  });
  $("nightTargets").addEventListener("click", (event) => {
    const button = event.target.closest("[data-night-target]");
    if (!button) return;
    S.nightChoice.targetId = Number(button.dataset.nightTarget);
    renderNight();
  });
  $("nightHammer").addEventListener("click", (event) => {
    const button = event.target.closest("[data-hammer]");
    if (!button) return;
    S.nightChoice.hammerTargetId = button.dataset.hammer === "none" ? null : Number(button.dataset.hammer);
    renderNight();
  });
  $("williamCheck").addEventListener("change", (event) => {
    S.nightChoice.useWilliam = event.target.checked;
    if (event.target.checked) {
      S.nightChoice.confess = false;
      $("confessCheck").checked = false;
    }
  });
  $("confessCheck").addEventListener("change", (event) => {
    S.nightChoice.confess = event.target.checked;
    if (event.target.checked) {
      S.nightChoice.useWilliam = false;
      $("williamCheck").checked = false;
    }
  });
  $("submitNight").addEventListener("click", submitNight);
  $("dawnTargets").addEventListener("click", (event) => {
    const button = event.target.closest("[data-dawn-target]");
    if (!button) return;
    S.dawnTarget = Number(button.dataset.dawnTarget);
    renderDawn();
  });
  $("submitDawn").addEventListener("click", submitDawn);
  $("backLobby").addEventListener("click", leaveToLanding);
  $("chatBar").addEventListener("submit", (event) => event.preventDefault());
  $("chatSend").addEventListener("click", () => {
    const text = $("chatInput").value.trim();
    if (!text) return;
    if (send({ type: "chat", text })) $("chatInput").value = "";
  });
  $("chatInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); $("chatSend").click(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !S.open) connect();
  });
}

async function boot() {
  bind();
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get("code") ?? "").toUpperCase();
  if (urlCode) $("codeInput").value = urlCode.slice(0, 6);
  $("nameInput").value = profileStore.readName();
  try {
    const res = await fetch("/assets/cards/cards.zh.json", { cache: "force-cache" });
    const data = await res.json();
    for (const c of data.cards) S.cards.set(c.id, c);
    S.cardsReady = true;
  } catch (error) {
    toast("卡牌数据加载失败");
  }
  connect();
  setInterval(updateTimers, 500);
  render();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
}

boot();

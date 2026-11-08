import {
  KICKED_MESSAGE,
  RECONNECT_DELAY_MS,
  REPLACED_MESSAGE,
  ROOM_GONE_MESSAGE,
  closeOutcome,
  errorOutcome,
  rejoinPlan,
} from "./reconnect.js";
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
import { seatRoleView, trialLabel, trialFaceCardId, trialTone, TRIAL_BACK_IMAGE } from "./table-view.js";
import { phaseLabel, dealProgress, dealCountText, canEnterDawn, dealSeatStatus, ackSummary } from "./deal-view.js";
import { slotView, canDecline, revealWaitText, actionsLocked, revealLogText, revealBannerText, revealHeading, revealWaitModel, revealSubmitLabel, toggleRevealPick, canSubmitReveal } from "./reveal-view.js";
import {
  CONSPIRACY_SWAP_PHASES,
  canSubmitConspiracy,
  conspiracyClockText,
  conspiracyClockWarn,
  conspiracyHeading,
  conspiracyNote,
  conspiracySlots,
  conspiracyStage,
  conspiracyWaitText,
  leftOfSeat,
} from "./conspiracy-view.js";
import {
  armSkip,
  cycleMotionLevel,
  enqueue,
  getMotionLevel,
  initMotion,
  isBlocked,
  motionCardEnter,
  motionDenied,
  motionLabel,
  motionPress,
  motionTimerWarn,
  motionToast,
  resetMotion,
  startBlock,
} from "./motion.js";
import { patchKeyed } from "./render-patch.js";
import { haptic, initAudio, playSfx, setAudioLevel, setAudioPhase, unlockAudio } from "./audio.js";
import { applyDrawerModel, setDrawerOpen } from "./drawer-shell.js";

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
  avatars: new Map(),
  avatarUrls: new Map(),
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
  deal: null,
  revealWait: null,
  revealPick: null,
  // 自动代翻的收尾：抽屉在屏上多留一会儿，说清「不是你自己选的」。
  revealAfterglowUntil: 0,
  revealAfterglowTimer: null,
  conspiracyPick: null,
  conspiracyShown: null,
  conspiracyStep: null,
  dealFlipped: new Set(),
  dealKey: null,
  toastTimer: null,
  reconnectTimer: null,
  leaving: false,
  rejoining: false,
  roomGone: false,
  queued: null,
  sent: [],
  avatars: new Map(),
  flipSeen: new Map(),
  seenLog: null,
  revealQueue: [],
  revealTimer: null,
  revealDelay: null,
  lastPhase: null,
  suppressPhaseEntrance: false,
  phaseTimer: null,
  deathShowing: false,
  deathTimer: null,
  overShown: false,
  overTimers: [],
  quotaWarned: false,
  audioPhase: null,
  timerWarnKey: null,
};
// 调试入口：浏览器控制台与联调脚本可直接读当前状态。
globalThis.__salem = S;

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
  motionToast(el, ok);
  if (!ok) motionDenied(el);
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function card(id) {
  return S.cards.get(id) ?? { id, name: id, color: "none", typeLabel: "", points: 0, text: "", image: "" };
}

/** 角色卡名：只认卡牌资源里的名字，没加载或没有角色就返回 null，交给调用方兜底。 */
function roleCardName(id) {
  if (!id || id === "none") return null;
  return S.cards.get(id)?.name ?? null;
}

function roleName(id) {
  return roleCardName(id) ?? (id && id !== "none" ? id : "无角色");
}

/** 角色卡的技能文案：只认 cards.zh.json 里角色条目的 text，取不到就是空串。 */
function roleAbility(id) {
  if (!id || id === "none") return "";
  return S.cards.get(id)?.text ?? "";
}

/** 角色卡牌面资源的站内路径；取不到就是空串，由调用方退回纯文字面板。 */
function roleImage(id) {
  if (!id || id === "none") return "";
  const image = S.cards.get(id)?.image ?? "";
  return image ? "/" + image : "";
}

/** 自己面板上的技能行：没有角色或没有文案时整行不出，避免留白。 */
function selfAbilityLine(role) {
  const text = roleAbility(role);
  if (!text) return "";
  return '<div class="self-ability">' + esc(text) + "</div>";
}

/** 座位信息：对外投影优先（带 role / alive / trials），退回房间座位表。 */
function seatInfo(id) {
  return S.projection?.seats?.find((s) => s.id === id) ?? S.room?.seats?.find((s) => s.id === id) ?? null;
}

/** 角色卡弹窗底部的状态行：存活、指控点数、身份卡揭示进度。 */
function seatMetaText(seat, seatId) {
  if (!seat) return "";
  const parts = [];
  if (seatId === S.seatId) parts.push("你");
  parts.push(seat.alive === false ? "已死亡" : "存活");
  const accusations = Array.isArray(seat.accusations) ? seat.accusations.length : (seat.accusations ?? 0);
  if (accusations) parts.push("指控 " + accusations + " 点");
  const trials = seat.trials ?? [];
  if (trials.length) {
    const revealed = trials.filter((t) => t.revealed === true).length;
    parts.push("身份卡 已揭示 " + revealed + " / " + trials.length);
  }
  return parts.join(" · ");
}

function seatName(id) {
  const fromRoom = S.room?.seats?.find((s) => s.id === id);
  if (fromRoom) return fromRoom.name;
  const fromProjection = S.projection?.seats?.find((s) => s.id === id);
  return fromProjection?.name ?? "玩家 " + id;
}

/** data URL → Blob；解析不出来返回 null，由调用方退回 data URL 直出。 */
function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const mime = dataUrl.slice(5, comma).split(";")[0] || "application/octet-stream";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * 头像的可用地址。头像表存 data URL，若每次全量重绘都把它写进 innerHTML，
 * 12 人房每同步一次都要重新解析几百 KB 字符串；这里按座位缓存成 blob: 地址，
 * 重绘只写一小段 URL。拿不到 createObjectURL 时原样用 data URL，行为不变。
 */
function avatarSrc(seatId) {
  const dataUrl = S.avatars.get(seatId);
  if (!dataUrl) return null;
  const cached = S.avatarUrls.get(seatId);
  if (cached && cached.dataUrl === dataUrl) return cached.src;
  let src = dataUrl;
  try {
    const blob = dataUrlToBlob(dataUrl);
    if (blob && typeof URL.createObjectURL === "function") src = URL.createObjectURL(blob);
  } catch { /* 退回 data URL */ }
  releaseAvatar(seatId);
  S.avatarUrls.set(seatId, { dataUrl, src });
  return src;
}

/** 释放某个座位的 blob 地址（换了头像或移除头像时）。 */
function releaseAvatar(seatId) {
  const cached = S.avatarUrls.get(seatId);
  if (!cached) return;
  S.avatarUrls.delete(seatId);
  if (cached.src.startsWith("blob:")) URL.revokeObjectURL(cached.src);
}

/** 全量替换头像表（welcome）：旧 blob 地址全部释放，重绘时按需重建。 */
function resetAvatars(avatars) {
  for (const seatId of [...S.avatarUrls.keys()]) releaseAvatar(seatId);
  S.avatars = new Map(Object.entries(avatars ?? {}).map(([id, url]) => [Number(id), url]));
}

/** 单座位头像写入（avatar 消息）；dataUrl 为空表示移除。 */
function setAvatar(seatId, dataUrl) {
  releaseAvatar(seatId);
  if (dataUrl) S.avatars.set(seatId, dataUrl);
  else S.avatars.delete(seatId);
}

/**
 * 所有显示玩家的位置共用这一个头像牌：有头像放图，没有回落昵称首字。
 * 尺寸仍由各处的 .avatar 规则决定，这里只管内容。
 */
function avatarChip(seatId, name) {
  const src = avatarSrc(seatId);
  if (!src) return '<span class="avatar">' + esc(initialOf(name)) + "</span>";
  return '<span class="avatar has-image"><img src="' + esc(src) + '" alt="" /></span>';
}

/** 直接渲染一张 data URL 的 <img>：头像弹层预览用，不经过按座位的 blob 缓存。 */
function avatarImgHtml(dataUrl) {
  return '<img src="' + esc(dataUrl) + '" alt="" />';
}

// 本机的头像是服务端回显之外的乐观更新：弹层里显示的就是马上要发出去的那张图。
function applyLocalAvatar(seatId, dataUrl) {
  setAvatar(seatId, dataUrl);
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

/** 挂起揭示期谁都动不了：选择者要选位置，其他人等；规则层同样会拒（reveal-pending）。 */
function revealLocked() {
  return actionsLocked({ pendingReveal: S.projection?.pendingReveal, revealWait: S.revealWait });
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
    // 连上之后先把玩家刚点的动作发出去（房间失效后点「重新开房」时 socket 可能还断着）。
    if (S.queued) {
      const queued = S.queued;
      S.queued = null;
      S.rejoining = false;
      send(queued);
      return;
    }
    const saved = loadSession();
    if (saved?.code && saved?.token && !S.room) {
      send({ type: "join", code: saved.code, token: saved.token });
      S.autoJoined = true;
      return;
    }
    // 断线重连也要补发 join：S.room 里留着的是旧房间，不能拿它当守卫，
    // 否则新 socket 连上了却没有房间，页面就一直停在旧房间里空转。
    const plan = rejoinPlan({ session: saved, leaving: S.leaving, roomGone: S.roomGone });
    if (!plan) return;
    S.rejoining = true;
    send({ type: "join", code: plan.code, token: plan.token });
  });
  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handle(msg);
  });
  ws.addEventListener("close", (event) => {
    S.open = false;
    S.ws = null;
    const outcome = closeOutcome({ code: event.code, inRoom: Boolean(S.room), leaving: S.leaving, roomGone: S.roomGone });
    // 被顶号：房间还在、存档还归这页所有，只是不该再抢连接——重连会把对方顶掉，两页互踢。
    if (outcome === "replaced") {
      clearTimeout(S.reconnectTimer);
      toast(REPLACED_MESSAGE);
      return;
    }
    // 被踢：座位已经删了，重连会拿旧 token 换一个新座位，等于踢不掉。
    if (outcome === "kicked") {
      clearTimeout(S.reconnectTimer);
      resetRoomState();
      $("landingError").textContent = KICKED_MESSAGE;
      return;
    }
    // 房间被回收：重连再补 join 也只会拿到 room-not-found，直接进终态。
    if (outcome === "room-closed") {
      enterRoomGone();
      return;
    }
    if (outcome !== "reconnect") return;
    toast("连接断开，正在重连…");
    clearTimeout(S.reconnectTimer);
    S.reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  });
  ws.addEventListener("error", () => {
    // 终态文案优先：房间已失效的提示不能被后续连不上的兜底文案盖掉。
    if (!S.room && !S.roomGone) $("landingError").textContent = "无法连接服务器，请确认服务已启动。";
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
  if (isBlocked()) return;
  send({ type: "action", commandId: commandId(), action });
}

// 座位表结构变了（开局重编号、座位被移出）：服务端把「我的座位号 + 整张头像」挂在同一条消息上发下来。
// 客户端按座位号取人、取头像，所以这两样必须一起换，不能只改一样。
function adoptIdentity(seatId, avatars) {
  S.seatId = seatId;
  resetAvatars(avatars);
}

function adoptResync(resync) {
  adoptIdentity(resync.seatId, resync.avatars);
  const session = loadSession();
  if (session) saveSession({ ...session, seatId: resync.seatId });
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
  if (msg.resync) adoptResync(msg.resync);
  switch (msg.type) {
    case "welcome":
      adoptIdentity(msg.seatId, msg.avatars);
      S.rejoining = false;
      saveSession({ code: msg.code, token: msg.token, seatId: msg.seatId });
      // 服务端没有自己的头像、本机却存着：连上后补一次，重连亦然（服务端同值幂等）。
      profileStore.maybeReupload({ avatars: msg.avatars ?? {}, seatId: msg.seatId });
      render();
      break;
    case "avatar":
      setAvatar(Number(msg.seatId), msg.dataUrl);
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
      S.deal = msg.deal ?? null;
      // 挂起揭示的公开信号在消息顶层：选择者另有 projection.pendingReveal，其他人只有这一条。
      S.revealWait = msg.revealWait ?? null;
      if (msg.room) S.room = msg.room;
      // 翻身份卡是全桌可见的公开事件：投影一到就把新增的那几条挑出来，不等玩家自己开日志。
      // 必须先认领（并在 auto 时 arm 收尾窗口）再 render：否则挂起态消失的那条投影会先把抽屉关掉，
      // 900ms 的收尾说明永远看不见（#69）。
      announceReveals();
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
    case "error": {
      const outcome = errorOutcome({ reason: msg.reason, rejoining: S.rejoining });
      // 补发 join 撞上房间不存在：服务端重启把房间清掉了，进终态，不再重连。
      if (outcome === "room-gone") {
        enterRoomGone();
        break;
      }
      // 玩家手输房码撞上房间不存在：保持落地页原有提示，不进终态。
      if (outcome === "join-failed") resetRoomState();
      toast(msg.message || "操作失败");
      break;
    }
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
      avatarChip(seat.id, seat.name) +
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
  $("offlineBadge").hidden = room.offline !== true;
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
    return '<span class="trial-chip revealed ' + trialTone(kind) + '">' + esc(trialLabel(kind)) + "</span>";
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

/** 自己那排身份卡：横向卡片条；未揭示只给牌背，揭示后给牌面与和座位点阵同色的角标。 */
function trialStrip(trials, seatId) {
  const list = trials ?? [];
  if (!list.length) return '<span class="muted">无身份卡</span>';
  const known = seatId == null ? Number.POSITIVE_INFINITY : (S.flipSeen.get(seatId) ?? 0);
  let revealedCount = 0;
  const html = list.map((t, i) => {
    const revealed = t.revealed === true;
    const kind = t.kind ?? "townspeople";
    const face = card(trialFaceCardId(kind));
    const back = TRIAL_BACK_IMAGE;
    const front = revealed ? face.image : "";
    const tone = trialTone(kind);
    const label = revealed ? face.name : "身份卡（未揭示）";
    // 只有这次渲染第一次见到的已揭示卡才翻：否则每次重绘整排都会重播一遍。
    const fresh = revealed && revealedCount >= known;
    if (revealed) revealedCount += 1;
    return '<button type="button" class="trial-card' + (revealed ? " revealed" : "") +
      (fresh ? " flip-in" : "") + '" data-trial="' + i +
      '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
      '<span class="trial-inner">' +
      (back ? '<span class="trial-face trial-back"><img src="/' + esc(back) + '" alt="" loading="lazy" draggable="false" /></span>' : "") +
      (front ? '<span class="trial-face trial-front"><img src="/' + esc(front) + '" alt="" loading="lazy" draggable="false" /></span>' : "") +
      "</span>" +
      (revealed ? '<span class="trial-tone ' + tone + '"></span>' : "") +
      "</button>";
  }).join("");
  if (seatId != null) S.flipSeen.set(seatId, revealedCount);
  return html;
}

/** 点自己的身份卡打开现有详情浮层：牌面按类型映射到女巫、警长、平民三张资源。 */
function openTrialModal(index) {
  const trial = S.projection?.self?.trials?.[index];
  if (!trial) return;
  openCardModal(trialFaceCardId(trial.kind ?? "townspeople"));
}

/** 角色卡信息面：自己与别人都能点开看技能效果，只读，不改对局状态。 */
function openRoleInfo(seatId) {
  const seat = seatInfo(seatId);
  const role = seat?.role ?? "none";
  const image = roleImage(role);
  const box = $("roleImage");
  if (image) {
    box.src = image;
    box.hidden = false;
  } else {
    box.removeAttribute("src");
    box.hidden = true;
  }
  $("roleKicker").textContent = seatId === S.seatId ? "你的角色卡" : (seat?.name ? seat.name + " 的角色卡" : "角色卡");
  $("roleTitle").textContent = roleName(role);
  $("roleText").textContent = roleAbility(role) || "这张角色卡没有可查看的技能文案。";
  $("roleMeta").textContent = seatMetaText(seat, seatId);
  const modal = $("roleModal");
  modal.hidden = false;
  modal.querySelector(".modal-close")?.focus();
}

function closeRoleInfo() {
  $("roleModal").hidden = true;
}

function dealSeatRow(seat) {
  const role = dealSeatStatus(seat, roleCardName);
  const backs = Array.from({ length: (seat.trials ?? []).length }, () => '<span class="deal-back"></span>').join("");
  const acked = (S.deal?.acked ?? []).includes(seat.id);
  return '<div class="deal-seat' + (seat.alive === false ? " dead" : "") + '">' +
    avatarChip(seat.id, seat.name) +
    '<div class="deal-seat-main"><div class="deal-seat-name">' + esc(seat.name) + "</div>" +
    '<div class="deal-seat-role">' + esc(role) + "</div></div>" +
    '<div class="deal-seat-backs" title="' + backs.length + ' 张身份卡">' + backs + "</div>" +
    '<div class="deal-seat-ack">' + (acked ? "已确认" : "未确认") + "</div></div>";
}

/** 发牌确认屏：选角 → 逐张翻自己的牌 → 进入黎明；其他人只给牌背与张数。 */
function renderDeal() {
  const p = S.projection;
  const my = p?.self;
  if (!p || !my) return;
  const me = p.seats.find((s) => s.id === S.seatId);
  const key = String(S.deal?.deadline ?? "deal");
  if (S.dealKey !== key) {
    S.dealKey = key;
    S.dealFlipped = new Set();
  }

  const roleChosen = Boolean(me?.roleChosen);
  const chosenId = me?.role ?? my.role;
  const options = me?.roleOptions ?? [];
  const rolesBlock = $("dealRolesBlock");
  if (roleChosen && chosenId && chosenId !== "none") {
    const picked = card(chosenId);
    rolesBlock.hidden = false;
    $("dealRoles").className = "deal-roles single";
    $("dealRolesTitle").textContent = "你的角色";
    $("dealRoles").innerHTML = '<div class="deal-role chosen" aria-label="已选定 ' + esc(roleName(chosenId)) + '">' +
      (picked.image ? '<img src="/' + esc(picked.image) + '" alt="" draggable="false" />' : "") +
      '<span class="deal-role-name">' + esc(roleName(chosenId)) + "</span>" +
      '<span class="deal-role-tag">已选定</span></div>';
  } else if (options.length) {
    rolesBlock.hidden = false;
    $("dealRoles").className = "deal-roles";
    $("dealRolesTitle").textContent = "选择你的角色（选定后不可更改）";
    $("dealRoles").innerHTML = options.map((id) => {
      const option = card(id);
      return '<button type="button" class="deal-role" data-role="' + esc(id) + '">' +
        (option.image ? '<img src="/' + esc(option.image) + '" alt="" draggable="false" />' : "") +
        '<span class="deal-role-name">' + esc(roleName(id)) + "</span></button>";
    }).join("");
  } else {
    rolesBlock.hidden = true;
    $("dealRoles").innerHTML = "";
  }

  const progress = dealProgress(my.trials, S.dealFlipped);
  $("dealCount").textContent = dealCountText(progress);
  $("dealCards").innerHTML = (my.trials ?? []).map((t, i) => {
    const seen = t.revealed === true || S.dealFlipped.has(i);
    const face = card(trialFaceCardId(t.kind ?? "townspeople"));
    const image = seen ? face.image : TRIAL_BACK_IMAGE;
    const label = seen ? face.name : "身份卡（未翻开）";
    return '<button type="button" class="deal-card' + (seen ? " flipped" : "") + '" data-deal-card="' + i +
      '" aria-pressed="' + (seen ? "true" : "false") + '" aria-label="' + esc(label) + '">' +
      (image ? '<img src="/' + esc(image) + '" alt="" draggable="false" />' : "") +
      '<span class="deal-card-cap">' + (seen ? esc(face.name) : "点开") + "</span></button>";
  }).join("");

  $("dealSeats").innerHTML = p.seats.filter((s) => s.id !== S.seatId).map(dealSeatRow).join("");

  const acknowledged = Boolean(S.private?.acknowledged);
  const ready = canEnterDawn({
    seen: progress.seen,
    total: progress.total,
    roleChosen,
    acknowledged,
  });
  const ackBtn = $("dealAckBtn");
  ackBtn.disabled = acknowledged || !ready;
  ackBtn.textContent = acknowledged ? "已确认" : "进入黎明";
  $("dealWaiting").hidden = !acknowledged;
  $("dealWaiting").textContent = acknowledged
    ? "已确认，" + ackSummary(S.deal, p.seats.length) + "，等待其他玩家…"
    : "";
  $("dealPrompt").textContent = !roleChosen
    ? "先在下面选一个角色，选定后不可更改。"
    : progress.allSeen
      ? "身份卡都看过了，进入黎明。"
      : "逐张点开你的身份卡。";
}

// 手牌是第一块 keyed patch：同一张牌跨 projection 复用节点，
// 只有新入手的卡播一次入场，旧卡与重绘不再重播。
function renderHand(ids, locked) {
  const hand = $("hand");
  const seen = new Map();
  const items = (ids ?? []).map((id) => {
    const nth = (seen.get(id) ?? 0) + 1;
    seen.set(id, nth);
    return { id, key: id + ":" + nth };
  });
  if (!items.length) {
    hand.innerHTML = '<p class="muted">手牌为空</p>';
    return;
  }
  if (!hand.querySelector("[data-key]")) hand.innerHTML = "";
  const { entered } = patchKeyed(hand, items, {
    keyOf: (item) => item.key,
    create: (item) => {
      const c = card(item.id);
      const el = document.createElement("button");
      el.className = "card " + c.color;
      el.dataset.card = item.id;
      el.title = c.name;
      el.innerHTML =
        (c.image ? '<img src="/' + esc(c.image) + '" alt="" loading="lazy" />' : "") +
        (c.points ? '<span class="pts">' + c.points + "</span>" : "") +
        '<span class="label">' + esc(c.name) + "</span>";
      return el;
    },
    update: (el, item) => {
      const c = card(item.id);
      el.disabled = locked;
      el.className = "card " + c.color;
      el.title = c.name;
    },
  });
  enqueue(entered.map((el) => ({ type: "enter", el })));
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
  if (p.phase !== S.audioPhase) {
    S.audioPhase = p.phase;
    setAudioPhase(p.phase);
    if (p.phase === "dawn") playSfx("sfx.phase.dawn");
  }
  const my = p.self;
  // 传染阶段也锁手牌：这一段只能选身份卡，手牌点开只会给出「打出去」的错觉。
  const locked = revealLocked() || p.phase === "conspiracy";
  const opponents = p.seats.filter((s) => s.id !== S.seatId);
  $("opponents").innerHTML = opponents.map((player) => {
    const classes = ["seat-card"];
    if (player.alive === false) classes.push("dead");
    if (selectableSeat(player.id)) classes.push("selectable");
    if (p.currentPlayerId === player.id) classes.push("me");
    const role = seatRoleView(player, roleCardName);
    const roleText = p.phase === "deal" ? dealSeatStatus(player, roleCardName) : role.compact;
    return '<button class="' + classes.join(" ") + '" data-seat="' + player.id + '">' +
      avatarChip(player.id, player.name) +
      '<div class="seat-name">' + esc(player.name) + "</div>" +
      '<div class="seat-role" title="' + esc(role.full) + '">' + esc(roleText) + "</div>" +
      '<div class="seat-meta"><span>手牌 <b>' + player.handCount + "</b></span><span>指控 <b>" + player.accusations + "</b></span></div>" +
      '<div class="trial-dots">' + (player.trials ?? []).map((t) => '<span class="dot ' + (t.revealed ? trialTone(t.kind) : "") + '"></span>').join("") + "</div>" +
      (miniCards(player) ? '<div class="mini-cards">' + miniCards(player) + "</div>" : "") +
      "</button>";
  }).join("");

  $("selfPanel").innerHTML =
    avatarChip(S.seatId, seatName(S.seatId)) +
    '<div class="self-main"><div class="self-name">' + esc(seatName(S.seatId)) + " · 你</div>" +
    '<div class="self-role">' + esc(roleName(my.role)) + (my.alive ? "" : " · 已死亡") + " · 指控 " + (my.accusations?.length ?? 0) + " 点</div>" +
    selfAbilityLine(my.role) + "</div>" +
    '<div class="self-trials trial-strip">' + trialStrip(my.trials, S.seatId) + "</div>";

  renderHand(my.hand ?? [], locked);

  $("deckCount").textContent = p.deckCount;
  $("discardCount").textContent = p.discardCount;
  $("phaseText").textContent = phaseLabel(p.phase);
  const turnName = p.currentPlayerId === S.seatId ? "你" : seatName(p.currentPlayerId);
  S.turnLabel = p.phase === "action" ? "轮到 " + turnName : phaseLabel(p.phase);
  $("turnBadge").textContent = S.turnLabel;

  let hint = "";
  if (p.phase === "action") {
    if (myTurn()) hint = p.actionTaken ? "本回合已行动，结束回合交给下一位。" : "打出一张牌，或抽两张并结束回合。";
    else hint = "等待 " + turnName + " 行动…";
  } else if (p.phase === "deal") hint = "发牌确认：看完自己的身份卡再进入黎明。";
  else if (p.phase === "night") hint = "夜晚结算中…";
  else if (p.phase === "conspiracy") hint = "传染：黑猫翻开一张，然后全员同时从左邻取一张。";
  else if (p.phase === "dawn") hint = "黎明：女巫正在放置黑猫…";
  else if (p.phase === "gameOver") hint = "对局结束";
  $("centerHint").textContent = hint;

  if (p.phase === "action" && locked) {
    // 挂起揭示期抽牌 / 出牌 / 结束回合都会被规则层拒（reveal-pending），按钮先禁掉。
    $("actionBar").innerHTML = '<button class="btn primary" data-act="end" disabled>结束回合</button>' +
      '<button class="btn gold" data-act="draw" disabled>抽 2 张并结束</button>';
  } else if (p.phase === "action" && myTurn()) {
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

  renderRevealDrawer();
  renderTargetBanner();
  renderConspiracy();
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

/**
 * 挂起揭示的底部抽屉：三种起因（指控 / 诅咒 / 嫁祸）共用一条 UI，壳与传染同一套槽位。
 * 两步选定——先点位置、再点「选定」；`canDecline` 时露出「放弃」；已提交与旁观走等待槽位。
 * 时钟读回合剩余（`S.private.turnDeadline`）：揭示挂在当前回合上，不另起 20 秒。
 */
/** 压暗层与目标座位描边：只在抽屉开着时挂，关掉时连类一起清干净。 */
function setRevealStage(open, targetId = null) {
  $("revealVeil")?.classList.toggle("on", open === true);
  for (const el of document.querySelectorAll("#opponents [data-seat]")) {
    const on = open === true && targetId !== null && Number(el.dataset.seat) === targetId;
    el.classList.toggle("reveal-target", on);
  }
}
/** 自动代翻后抽屉停留多久：动效三档只影响过渡，这段停留要够读完一句话。 */
const REVEAL_AFTERGLOW_TEXT = "超时或托管，自动取了第一个位置。";

function revealAfterglowMs() {
  return getMotionLevel() === "reduced" ? 700 : 900;
}

function armRevealAfterglow() {
  if (S.revealAfterglowTimer) clearTimeout(S.revealAfterglowTimer);
  S.revealAfterglowUntil = performance.now() + revealAfterglowMs();
  S.revealAfterglowTimer = setTimeout(() => {
    S.revealAfterglowUntil = 0;
    S.revealAfterglowTimer = null;
    renderRevealDrawer();
  }, revealAfterglowMs());
}

function renderRevealDrawer() {
  const bar = $("revealDrawer");
  // 传染阶段独占「要你选点什么」的位置：两条抽屉同时出现会让人不知道该点哪一个。
  if (S.projection?.phase === "conspiracy") {
    setDrawerOpen(bar, false);
    setRevealStage(false);
    S.revealPick = null;
    return;
  }
  const view = S.projection?.pendingReveal ?? null;
  if (!view && S.revealAfterglowUntil > performance.now()) {
    // 收尾态：收掉选择指令、卡片与按钮，只留一句说明并让点击穿透回牌桌。
    const note = bar.querySelector('[data-slot="note"]');
    if (note) note.textContent = REVEAL_AFTERGLOW_TEXT;
    const sub = bar.querySelector('[data-slot="sub"]');
    if (sub) sub.textContent = "已自动翻开一张，等待结算。";
    const cards = bar.querySelector('[data-slot="cards"]');
    if (cards) cards.hidden = true;
    const submit = bar.querySelector('[data-slot="submit"]');
    if (submit) {
      submit.textContent = "等待结算";
      submit.disabled = true;
    }
    const decline = bar.querySelector('[data-slot="decline"]');
    if (decline) decline.hidden = true;
    bar.style.pointerEvents = "none";
    setRevealStage(false);
    return;
  }
  bar.style.pointerEvents = "";
  if (!view) {
    const wait = revealWaitModel(S.revealWait, { nameOf: seatName });
    if (!wait) {
      setDrawerOpen(bar, false);
      setRevealStage(false);
      S.revealPick = null;
      return;
    }
    applyDrawerModel(bar, {
      kicker: wait.kicker,
      title: wait.title,
      sub: wait.sub,
      cardsHtml: "",
      cardsHidden: true,
      waiting: true,
      waitText: wait.waitText,
      note: wait.note,
      declineVisible: false,
      submitLabel: "选定",
      submitDisabled: true,
    });
    setDrawerOpen(bar, true);
    setRevealStage(true, null);
    updateRevealClock();
    return;
  }
  // 服务端已经记下选择就收掉卡片，只留等待环——避免同一张被提交两遍。
  const submitted = Number.isInteger(view.pick);
  if (submitted) S.revealPick = view.pick;
  const picked = submitted ? view.pick : S.revealPick;
  // 点数与门槛已经在 view 里（#68：锁在挂起态，视图期不重算），不再从等待视图借。
  const heading = revealHeading(view, { nameOf: seatName });
  const trials = S.projection.seats.find((seat) => seat.id === view.targetId)?.trials ?? [];
  const cardsHtml = slotView(view.slots).map((slot) => {
    const trial = trials[slot.index];
    const face = slot.revealed ? card(trialFaceCardId(trial?.kind ?? "townspeople")) : null;
    const image = face && face.image ? face.image : TRIAL_BACK_IMAGE;
    const caption = slot.revealed ? (face?.name ?? "身份卡") : "#" + (slot.index + 1);
    const on = slot.index === picked;
    const disabled = slot.disabled || submitted;
    return '<button type="button" class="conspiracy-card' +
      (slot.revealed ? " revealed " + trialTone(trial?.kind) : "") +
      (on ? " picked" : "") + '" data-reveal-index="' + slot.index + '"' +
      (disabled ? " disabled" : "") + ' aria-pressed="' + (on ? "true" : "false") +
      '" aria-label="' + esc(caption) + '">' +
      (image ? '<img src="/' + esc(image) + '" alt="" loading="lazy" draggable="false" />' : "") +
      '<span class="conspiracy-slot">' + esc(caption) + "</span>" +
      (slot.revealed ? '<span class="conspiracy-tag">已揭示</span>' : "") +
      "</button>";
  }).join("");
  applyDrawerModel(bar, {
    kicker: heading.kicker,
    title: heading.title,
    // 交出去之后就别再教人怎么选了：写着「选定前可以改」而按钮已经不能点是自相矛盾。
    sub: submitted ? "已提交，等待结算。" : heading.sub,
    cardsHtml,
    cardsHidden: submitted,
    waiting: submitted,
    waitText: "已提交，等待结算",
    note: submitted ? "" : heading.note,
    declineVisible: !submitted && canDecline(view),
    submitLabel: submitted ? "已提交" : revealSubmitLabel(picked),
    submitDisabled: !canSubmitReveal(view, picked),
  });
  setDrawerOpen(bar, true);
  setRevealStage(true, view.targetId);
  updateRevealClock();
}

/** 时钟只写两个槽：每 500ms 跑一次，不重写整份内容。没有回合时限（线下模式）就整块隐藏。 */
function updateRevealClock() {
  const bar = $("revealDrawer");
  if (!bar || bar.hidden) return;
  const deadline = S.private?.turnDeadline ?? null;
  const left = deadline ? deadline - Date.now() : null;
  applyDrawerModel(bar, {
    clockText: left === null ? "" : Math.max(0, Math.ceil(left / 1000)) + " 秒",
    clockWarn: left !== null && left <= 5000,
  });
}

/**
 * 传染阶段：抽屉式面板顶在下半屏。`cat` 步只有黑猫持有者能选，`pick` 步全员同时选左邻；
 * 候选位置号与已揭示状态都由服务端给（`projection.conspiracy`），客户端不推断谁能选。
 * 与挂起揭示条、出牌目标横幅互斥：同一时刻只该有一种「等你去选点什么」的东西。
 */
function renderConspiracy() {
  const bar = $("conspiracyBar");
  const view = S.projection?.phase === "conspiracy" ? (S.projection?.conspiracy ?? null) : null;
  if (!view) {
    setDrawerOpen(bar, false);
    S.conspiracyPick = null;
    S.conspiracyStep = null;
    if (S.conspiracyShown !== null) leaveConspiracyStage();
    S.conspiracyShown = null;
    return;
  }
  // 换步就清选中：cat 与 pick 选的是两排不同位置号，串过去会把上一步的索引提交这一
  // 步。
  if (S.conspiracyStep !== view.step) {
    S.conspiracyStep = view.step;
    S.conspiracyPick = null;
  }
  // 拍 1–2 只在第一次见到阶段时演；拍 4 只在换步时给一次存在感。每帧重绘不能重播。
  const stage = conspiracyStage(view, S.conspiracyShown);
  if (stage.enter) enterConspiracyStage();
  else if (stage.stepChanged) playConspiracyStep();
  S.conspiracyShown = stage.step;
  const heading = conspiracyHeading(view, {
    nameOf: seatName,
    seatId: S.seatId,
    playerCount: S.projection?.seats?.length ?? 0,
  });
  // 内容照旧，只是不再自己摸 DOM：全部交给共享壳的槽位写入。
  const cardsHtml = conspiracySlots(view).map((slot) => {
    const picked = slot.index === S.conspiracyPick;
    const caption = "#" + (slot.index + 1);
    const disabled = !slot.selectable || view.submitted;
    return '<button type="button" class="conspiracy-card' + (slot.revealed ? " revealed" : "") +
      (picked ? " picked" : "") + '" data-conspiracy-index="' + slot.index + '"' +
      (disabled ? " disabled" : "") + ' aria-pressed="' + (picked ? "true" : "false") +
      '" aria-label="' + esc(caption) + '">' +
      (TRIAL_BACK_IMAGE ? '<img src="/' + esc(TRIAL_BACK_IMAGE) + '" alt="" loading="lazy" draggable="false" />' : "") +
      '<span class="conspiracy-slot">' + esc(caption) + "</span>" +
      (slot.revealed ? '<span class="conspiracy-tag">已揭示</span>' : "") +
      "</button>";
  }).join("");
  applyDrawerModel(bar, {
    title: heading.title,
    sub: heading.sub,
    cardsHtml,
    cardsHidden: view.submitted,
    waiting: view.submitted,
    waitText: conspiracyWaitText(view),
    note: conspiracyNote(view, S.conspiracyPick),
    submitLabel: Number.isInteger(S.conspiracyPick)
      ? "选定（第 " + (S.conspiracyPick + 1) + " 张）"
      : "选定",
    submitDisabled: !canSubmitConspiracy(view, S.conspiracyPick),
  });
  setDrawerOpen(bar, true);
  updateConspiracyClock();
}

/** 倒计时只在面板开着时更新；线下模式与阶段刚起没有 deadline，整块隐藏而不是显示 0 秒。 */
function updateConspiracyClock() {
  const bar = $("conspiracyBar");
  if (bar.hidden) return;
  const deadline = S.room?.conspiracyDeadline ?? null;
  const now = Date.now();
  // 只写时钟两个槽，其余槽位不动——每 500ms 跑一次，别把整份内容重写。
  applyDrawerModel(bar, {
    clockText: conspiracyClockText(deadline, now),
    clockWarn: conspiracyClockWarn(deadline, now),
  });
}

/**
 * 拍 1–2：抽到即弃 500 + 阶段转场 260。压暗与印章同时起，20 秒计时不被演出推迟。
 * 抽到的那张在服务端已经弃掉，这里不做「翻开」——它不是揭示，是废弃。
 */
function enterConspiracyStage() {
  $("conspiracyVeil")?.classList.add("on");
  $("conspiracySeal")?.classList.add("on");
  playSfx("sfx.conspiracy.start");
  haptic("long");
}

/** 拍 9：阶段结束把压暗、印章与残留的换牌层一起收掉。 */
function leaveConspiracyStage() {
  $("conspiracyVeil")?.classList.remove("on");
  $("conspiracySeal")?.classList.remove("on");
  const host = $("conspiracySwap");
  if (host) host.innerHTML = "";
}

/** 拍 4：只是计数文字在变，给面板一次 150ms 的存在感。 */
function playConspiracyStep() {
  const bar = $("conspiracyBar");
  if (bar && !bar.hidden) motionCardEnter(bar);
}

/**
 * 拍 5–7：换牌三拍（卷起 200 / 交换 450 / 落位 250）。
 * 12 人局也只演自己这一对：日志里本来只有本人相关的 conspiracySwap，
 * 别人的牌面与位置一概不出现（#60 的私密边界）。
 */
function playConspiracySwap() {
  const host = $("conspiracySwap");
  const level = getMotionLevel();
  if (!host || level === "off") return;
  const speed = level === "reduced" ? 0.34 : 1;
  const curl = Math.max(60, Math.round(CONSPIRACY_SWAP_PHASES.curl * speed));
  const fly = Math.max(90, Math.round(CONSPIRACY_SWAP_PHASES.fly * speed));
  const drop = Math.max(60, Math.round(CONSPIRACY_SWAP_PHASES.drop * speed));
  host.innerHTML =
    '<span class="conspiracy-swap-card" data-swap="out"></span>' +
    '<span class="conspiracy-swap-card" data-swap="in"></span>';
  const out = host.querySelector('[data-swap="out"]');
  const incoming = host.querySelector('[data-swap="in"]');
  if (!out || !incoming) return;
  out.style.cssText = "position:absolute;left:calc(50% - 96px);top:42%;";
  incoming.style.cssText = "position:absolute;left:calc(50% + 40px);top:42%;";
  playSfx("sfx.reveal.flip");
  haptic("short");
  setTimeout(() => {
    out.style.transition = "transform " + fly + "ms cubic-bezier(.2,.7,.3,1)";
    incoming.style.transition = "transform " + fly + "ms cubic-bezier(.2,.7,.3,1)";
    out.style.transform = "translateX(136px) rotate(-7deg)";
    incoming.style.transform = "translateX(-136px) rotate(7deg)";
  }, curl);
  setTimeout(() => {
    out.style.transition = "opacity " + drop + "ms ease-in";
    incoming.style.transition = "opacity " + drop + "ms ease-in";
    out.style.opacity = "0";
    incoming.style.opacity = "0";
  }, curl + fly);
  setTimeout(() => {
    host.innerHTML = "";
  }, curl + fly + drop + 80);
}

function renderTargetBanner() {
  const banner = $("targetBanner");
  // 传染阶段不该还有出牌的待选目标：这时候留着来源/目标提示只会误导。
  if (!S.pending || S.projection?.phase === "conspiracy") {
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
    case "roleChosen": return n(e.playerId) + " 选了 " + esc(roleName(e.role)) + "。";
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
    case "trialRevealed": return esc(revealLogText(e, { nameOf: seatName, label: trialLabel }));
    case "playerDied": return '<span class="red">' + n(e.playerId) + " 死亡（" + esc(e.cause) + "）。</span>";
    case "handDiscarded": return n(e.playerId) + " 弃掉 " + e.count + " 张手牌。";
    case "handTransferred": return n(e.fromId) + " 的 " + e.count + " 张手牌交给 " + n(e.toId) + "。";
    case "blueAttached": return n(e.playerId) + " 面前放置 " + cn(e.cardId) + "。";
    case "blueDiscarded": return n(e.playerId) + " 弃掉蓝卡 " + cn(e.cardId) + "。";
    case "frontMoved": return n(e.fromId) + " 面前所有牌移到 " + n(e.toId) + "（红 " + e.red + " / 蓝 " + e.blue + " / 绿 " + e.green + "）。";
    case "matchmakerBroke": return '<span class="red">情侣连锁：' + e.playerIds.map(n).join("、") + " 同死。</span>";
    case "powerUsed": return n(e.playerId) + " 使用能力：" + esc(e.power) + "。";
    case "conspiracyStarted": return n(e.drawerId) + " 抽到传染，全体换牌。";
    case "conspiracySwap": return n(e.fromId) + " 从左邻 " + n(e.toId) + " 取走一张身份卡。";
    case "nightStarted": return '<span class="gold">夜晚降临。</span>';
    case "confession": return n(e.playerId) + " 自首" + (e.revealed ? "，翻开一张身份卡。" : "。");
    case "nightResolved": return "夜晚结束：" + n(e.targetId) + (e.saved ? " 被救下" : '<span class="red"> 被杀</span>') + "（" + esc(e.cause) + "）。";
    case "winner": return '<span class="gold">对局结束：' + (e.winner === "town" ? "平民胜利" : e.winner === "witches" ? "女巫胜利" : "结束") + " —— " + esc(e.reason) + "。</span>";
    case "notice": return esc(e.text);
    default: return esc(e.type);
  }
}

/** 翻牌先转 600ms，横幅再按 300 入 / 600 停 / 180 出；单条总占位 1080ms。 */
const REVEAL_FLIP_MS = 600;
const REVEAL_BANNER_MS = 1080;
const REVEAL_BANNER_REDUCED_MS = 920;
const REVEAL_QUEUE_MAX = 3;
const DEATH_MS = 1200;
const DEATH_REDUCED_MS = 400;

/** 终局四段：幕落 240 → 胜负 400 → 原因 300 → 座位表 280，总 1220ms。 */
const OVER_STEPS_FULL = [["1", 0], ["2", 240], ["3", 640], ["4", 940]];
/** 减弱档只压透明度，四段各自缩短；总 640ms，仍保留因果顺序。 */
const OVER_STEPS_REDUCED = [["1", 0], ["2", 180], ["3", 420], ["4", 640]];

/** 指控成立：420ms 金色脉冲，最多 3 席同时；减弱档 180ms 仅透明度。 */
const ACCUSE_UPHELD_MS = 420;
const ACCUSE_UPHELD_REDUCED_MS = 180;
const ACCUSE_UPHELD_MAX = 3;

/**
 * 翻身份卡是公开事件，规则层已经把它写进 `state.log`（trialRevealed），全桌都在同一条投影里。
 * 这里只做一件事：把本次投影新增的那几条挑出来，排队播给所有人看。
 * 首次进入或换局（日志变短）一律当作已读，免得一进房间就把历史重放一遍。
 * 同一条投影里超过 3 条揭示只合并展示前 3 条；多出的写进日志，不再逐条排队。
 * 死亡也在同一条投影里合并成一次公开演出，绝不 per-seat。
 */
function announceReveals() {
  const log = S.projection?.log ?? [];
  if (S.seenLog === null || log.length < S.seenLog) {
    S.seenLog = log.length;
    return;
  }
  const fresh = log.slice(S.seenLog);
  const reveals = fresh.filter((event) => event?.type === "trialRevealed");
  const accusations = fresh.filter((event) => event?.type === "trialRevealed" && event.cause === "accusation");
  const deaths = fresh.filter((event) => event?.type === "playerDied" || event?.type === "matchmakerBroke");
  const swaps = fresh.filter((event) => event?.type === "conspiracySwap");
  S.seenLog = log.length;

  if (accusations.length) showAccuseUpheld(accusations);
  if (reveals.length) {
    S.revealQueue.push(...reveals.slice(0, REVEAL_QUEUE_MAX));
    if (reveals.length > REVEAL_QUEUE_MAX) {
      toast("同时揭示 " + reveals.length + " 条，已合并展示前 " + REVEAL_QUEUE_MAX + " 条");
    }
    scheduleNextReveal();
  }
  if (deaths.length) showDeath(deaths);
  if (swaps.length) playConspiracySwap();
  // 超时/托管代翻：抽屉不立刻消失，留一会儿把话说完。
  if (reveals.some((event) => event.auto === true)) armRevealAfterglow();
}

/**
 * 指控成立是「公开的坐实瞬间」，不是新的阻塞：只给被坐实的座位加一圈金色脉冲，
 * 与同批的翻牌并行。trialRevealed.cause === "accusation" 本身已经证明越过了服务端阈值，
 * 客户端不再重复推导 threshold，避免把规则常量抄进 UI。
 */
function showAccuseUpheld(events) {
  const ids = [...new Set(events.map((event) => Number(event.playerId)).filter(Number.isInteger))];
  if (!ids.length) return;
  if (ids.length > ACCUSE_UPHELD_MAX) {
    toast("另有 " + (ids.length - ACCUSE_UPHELD_MAX) + " 人被指控，已合并展示");
  }
  const level = getMotionLevel();
  if (level === "off") return;
  const shown = ids.slice(0, ACCUSE_UPHELD_MAX);
  const ms = level === "reduced" ? ACCUSE_UPHELD_REDUCED_MS : ACCUSE_UPHELD_MS;
  for (const id of shown) {
    const seat = id === S.seatId
      ? $("selfPanel")
      : document.querySelector('#opponents .seat-card[data-seat="' + id + '"]');
    if (!seat) continue;
    seat.classList.remove("accuse-upheld");
    // 同一帧里重放同一个 class 不会重新触发动画，先读一次布局再挂。
    void seat.offsetWidth;
    seat.classList.add("accuse-upheld");
    setTimeout(() => seat.classList.remove("accuse-upheld"), ms + 40);
  }
}

function scheduleNextReveal() {
  if (S.revealDelay || S.revealTimer || !S.revealQueue.length) return;
  const level = getMotionLevel();
  const delay = level === "reduced" ? 200 : level === "off" ? 0 : REVEAL_FLIP_MS;
  S.revealDelay = setTimeout(() => {
    S.revealDelay = null;
    showNextReveal();
  }, delay);
}

function showNextReveal() {
  clearTimeout(S.revealDelay);
  S.revealDelay = null;
  const event = S.revealQueue.shift();
  if (!event) {
    S.revealTimer = null;
    return;
  }
  playSfx("sfx.reveal.flip");
  const view = revealBannerText(event, { nameOf: seatName, label: trialLabel });
  const face = card(trialFaceCardId(event.kind ?? "townspeople"));
  const image = $("revealBannerImage");
  if (face.image) {
    image.src = "/" + face.image;
    image.hidden = false;
  } else {
    image.removeAttribute("src");
    image.hidden = true;
  }
  $("revealBanner").dataset.card = trialFaceCardId(event.kind ?? "townspeople");
  $("revealBannerKicker").textContent = view.kicker;
  $("revealBannerTitle").textContent = view.title;
  $("revealBanner").hidden = false;
  const ms = getMotionLevel() === "reduced" ? REVEAL_BANNER_REDUCED_MS : REVEAL_BANNER_MS;
  S.revealTimer = setTimeout(() => {
    $("revealBanner").hidden = true;
    S.revealTimer = null;
    if (S.revealQueue.length) scheduleNextReveal();
  }, ms);
}

function deathEntries(events) {
  const entries = new Map();
  for (const event of events) {
    if (event.type === "playerDied" && event.playerId != null) {
      entries.set(Number(event.playerId), event.cause ? String(event.cause) : "死亡");
    }
    if (event.type === "matchmakerBroke" && Array.isArray(event.playerIds)) {
      for (const id of event.playerIds) entries.set(Number(id), "情侣连锁");
    }
  }
  return [...entries].map(([id, cause]) => ({ id, cause }));
}

function showDeath(events) {
  const entries = deathEntries(events);
  if (!entries.length) return;
  const selfDead = entries.some((entry) => entry.id === S.seatId);
  $("deathKicker").textContent = selfDead ? "YOU DIED" : "DEATH";
  $("deathTitle").textContent = entries.length === 1
    ? seatName(entries[0].id) + " 死亡"
    : entries.length + " 人离场";
  $("deathText").textContent = entries.map((entry) => seatName(entry.id) + " · " + entry.cause).join("；");
  $("deathOverlay").dataset.self = selfDead ? "1" : "0";
  $("deathOverlay").hidden = false;
  $("deathOverlay").classList.add("show");
  S.deathShowing = true;
  playSfx("sfx.life.death");

  const level = getMotionLevel();
  const duration = level === "reduced" ? DEATH_REDUCED_MS : DEATH_MS;
  const deadline = Number(S.private?.turnDeadline ?? 0);
  const remaining = deadline ? deadline - Date.now() : Infinity;
  // 截止保护：剩下的时间不够演出 + 500ms 缓冲，就不再 gate 输入，只静态呈现。
  let gated = false;
  if (level !== "off" && remaining > duration + 500) {
    gated = startBlock("fx.life.death", { duration, reducedMax: DEATH_REDUCED_MS });
  }
  clearTimeout(S.deathTimer);
  if (!gated) {
    S.deathTimer = setTimeout(hideDeath, level === "off" ? 700 : duration);
  }
}

function hideDeath() {
  clearTimeout(S.deathTimer);
  S.deathTimer = null;
  S.deathShowing = false;
  $("deathOverlay").hidden = true;
  $("deathOverlay").classList.remove("show");
}

function setOverlayVisibility(phase) {
  $("dealOverlay").hidden = phase !== "deal";
  $("nightOverlay").hidden = phase !== "night";
  $("dawnOverlay").hidden = phase !== "dawn";
  $("overOverlay").hidden = phase !== "gameOver";
}

/** 夜晚入场：600ms 压暗 + 星幕升起；skip 时直接落到终态，不 gate 任何服务端状态。 */
function startNightEntrance() {
  const el = $("nightOverlay");
  el.classList.remove("entering", "settled");
  el.classList.add("entering");
  const gated = startBlock("fx.phase.night", { duration: 600, reducedMax: 200, cap: 900 });
  if (!gated) el.classList.remove("entering");
}

/** 夜晚 → 黎明：375ms 两层交叉淡入，不做全屏拉幕，也不换页。 */
function startDawnCrossfade() {
  const night = $("nightOverlay");
  const dawn = $("dawnOverlay");
  clearTimeout(S.phaseTimer);
  night.hidden = false;
  dawn.hidden = false;
  night.classList.add("leaving");
  dawn.classList.add("entering");
  S.phaseTimer = setTimeout(() => {
    S.phaseTimer = null;
    if (S.lastPhase === "dawn") {
      night.hidden = true;
      night.classList.remove("leaving");
      dawn.classList.remove("entering");
    }
  }, 375);
}

function renderOverlays() {
  const p = S.projection;
  const phase = p?.phase;
  const suppressNow = S.suppressPhaseEntrance;
  if (phase !== S.lastPhase) {
    const previous = S.lastPhase;
    const suppress = S.suppressPhaseEntrance;
    S.suppressPhaseEntrance = false;
    S.lastPhase = phase;
    // 重连/被踢回来的第一帧只落静态终态，不把夜晚入场或黎明交叉重播一遍。
    if (suppress) {
      setOverlayVisibility(phase);
    } else if (phase === "dawn" && previous === "night") startDawnCrossfade();
    else setOverlayVisibility(phase);
    if (!suppress && phase === "night") startNightEntrance();
  }
  if (phase !== "gameOver" && S.overShown) {
    // 新一局开始：终局序列的幂等标记与计时器一起清掉，下一局还能完整播一次。
    S.overShown = false;
    clearOverTimers();
    $("overOverlay").classList.remove("entering");
    $("overOverlay").dataset.stage = "0";
  }
  $("chatBar").hidden = !(S.room && S.room.phase !== "lobby" && phase !== "gameOver");
  if (phase === "deal") renderDeal();
  if (phase === "night") renderNight();
  if (phase === "dawn") renderDawn();
  if (phase === "gameOver") renderOver(suppressNow);
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
  if (info.isConstable) roles.push("警长：可用木槌赦免一人");
  if (!roles.length) roles.push("你不是夜晚行动者");
  $("nightPrompt").textContent = roles.join("；") + "。";

  $("nightKillBlock").hidden = !info.isWitch;
  if (info.isWitch) {
    $("nightTargets").innerHTML = (S.projection?.seats ?? []).filter((s) => s.alive).map((s) =>
      '<button class="pick ' + (S.nightChoice.targetId === s.id ? "selected" : "") + '" data-night-target="' + s.id + '">' +
      avatarChip(s.id, s.name) + "<span>" + esc(s.name) + "</span></button>").join("");
  }
  $("nightHammerBlock").hidden = !info.isConstable;
  if (info.isConstable) {
    const options = (S.projection?.seats ?? []).filter((s) => s.alive && s.id !== S.seatId);
    $("nightHammer").innerHTML =
      '<button class="pick ' + (S.nightChoice.hammerTargetId == null ? "selected" : "") + '" data-hammer="none">不使用木槌</button>' +
      options.map((s) => '<button class="pick ' + (S.nightChoice.hammerTargetId === s.id ? "selected" : "") + '" data-hammer="' + s.id + '">' +
        avatarChip(s.id, s.name) + "<span>" + esc(s.name) + "</span></button>").join("");
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
      avatarChip(s.id, s.name) + "<span>" + esc(s.name) + (s.id === S.seatId ? "（你）" : "") + "</span></button>").join("");
  }
}

function clearOverTimers() {
  for (const timer of S.overTimers) clearTimeout(timer);
  S.overTimers = [];
}

function finishOverSequence() {
  clearOverTimers();
  const el = $("overOverlay");
  el.dataset.stage = "4";
  el.classList.remove("entering");
}

/**
 * 终局不新增 block、也没有跳过按钮：四段只是把「谁赢 / 为什么 / 都有谁」按因果顺序放下，
 * 播放中任意点击直接落终态，按钮始终可点。重连首帧与 off 档直接落终态，不重播。
 */
function renderOver(suppress = false) {
  const p = S.projection;
  $("overTitle").textContent = p?.winner === "town" ? "平民胜利" : p?.winner === "witches" ? "女巫胜利" : "对局结束";
  $("overReason").textContent = p?.winnerReason ?? "";
  $("overRoles").innerHTML = (p?.seats ?? []).map((s) => {
    // 第 15 版规则不公开某人过去的女巫身份，这里也不留任何暗示性标记。
    return '<div class="over-role"><div class="over-head">' + avatarChip(s.id, s.name) +
      "<b>" + esc(s.name) + (s.id === S.seatId ? "（你）" : "") + "</b></div>" +
      '<div class="over-meta">' + esc(roleName(s.role)) + " · " + (s.alive ? "存活" : "死亡") + "</div>" +
      trialChips(s) + "</div>";
  }).join("");

  const el = $("overOverlay");
  if (S.overShown) {
    el.dataset.stage = "4";
    return;
  }
  S.overShown = true;
  el.dataset.stage = "0";
  if (suppress || getMotionLevel() === "off") {
    finishOverSequence();
    return;
  }
  el.classList.remove("entering");
  void el.offsetWidth;
  el.classList.add("entering");
  const steps = getMotionLevel() === "reduced" ? OVER_STEPS_REDUCED : OVER_STEPS_FULL;
  for (const [stage, delay] of steps) {
    S.overTimers.push(setTimeout(() => {
      if (!S.overShown) return;
      el.dataset.stage = stage;
      if (stage === "4") finishOverSequence();
    }, delay));
  }
}

function updateTimers() {
  const p = S.private;
  const now = Date.now();
  const seconds = (deadline) => Math.max(0, Math.ceil((Number(deadline) - now) / 1000));
  // 线下模式没有截止时间：deadline 一律为 null，所有计时位改成「不限时」，不留上一局的残值。
  // 房间元信息在 S.room 上（projection 消息只带 projection 本体，room 另存一份）。
  const offline = (S.projection?.room ?? S.room)?.offline === true;
  if (offline) {
    $("turnBadge").textContent = S.turnLabel + " · 不限时";
    motionTimerWarn($("turnBadge"), false);
    S.timerWarnKey = null;
    for (const id of ["dealTimer", "dawnTimer", "nightTimer"]) $(id).textContent = "不限时";
    updateConspiracyClock();
    updateRevealClock();
    return;
  }
  const myTurnNow = S.projection?.phase === "action" && S.projection.currentPlayerId === S.seatId;
  const actionLeft = myTurnNow && p?.turnDeadline ? seconds(p.turnDeadline) : null;
  $("turnBadge").textContent = S.turnLabel + (actionLeft !== null ? " · " + actionLeft + "s" : "");
  const warn = actionLeft !== null && actionLeft <= 10;
  motionTimerWarn($("turnBadge"), warn);
  if (warn) {
    const key = String(p?.turnDeadline ?? "");
    if (S.timerWarnKey !== key) {
      S.timerWarnKey = key;
      playSfx("sfx.timer.warn");
    }
  } else {
    S.timerWarnKey = null;
  }
  if (S.deal?.deadline) $("dealTimer").textContent = seconds(S.deal.deadline) + "s";
  if (p?.dawn?.deadline) $("dawnTimer").textContent = seconds(p.dawn.deadline) + "s";
  if (p?.night?.deadline) $("nightTimer").textContent = seconds(p.night.deadline) + "s";
  updateConspiracyClock();
  updateRevealClock();
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

function loadProfileEntry() {
  return selfSeat()?.name ?? ($("nameInput").value.trim() || profileStore.readName() || "");
}

function openProfile() {
  // 开局后不再改昵称与头像：中途改名会让座位表、日志与别人的印象全部对不上。
  if (S.room && S.room.phase !== "lobby") {
    toast("对局进行中不能改昵称与头像");
    return;
  }
  const name0 = loadProfileEntry();
  const stored = S.avatars instanceof Map ? S.avatars.get(S.seatId) : S.avatars?.[S.seatId];
  const avatar0 = stored ?? profileStore.readAvatar();
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
    box.innerHTML = avatarImgHtml(avatar);
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
  if (payload.avatar !== undefined) applyLocalAvatar(S.seatId, payload.avatar);
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

async function decodeAvatarSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
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
    // <img> 与 createImageBitmap 一样按图片自带方向摆正（现代浏览器都会），
    // 所以这里不再自己读 EXIF 方向：再转一次会把竖拍照片转两遍。
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    return {
      source: image,
      width: naturalWidth,
      height: naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function encodeAvatarCanvas(canvas, tier) {
  let over = false;
  let pngOnly = false;
  for (const candidate of encodingCandidates(tier)) {
    const dataUrl = candidate.quality === undefined
      ? canvas.toDataURL(candidate.mime)
      : canvas.toDataURL(candidate.mime, candidate.quality);
    // canvas 对不支持的格式会静默回退 PNG，所以按返回串前缀确认，而不是按请求的 mime。
    // 服务端只收 WebP / JPEG（规格明确不接受 PNG），拿到 PNG 就说明这个候选作废；
    // 但如果浏览器对每种格式都只给 PNG，得给玩家一句准确的提示，而不是笼统的「读不出来」。
    if (!isTargetAvatarDataUrl(dataUrl)) {
      if (dataUrl.startsWith("data:image/png")) pngOnly = true;
      continue;
    }
    const verdict = budgetVerdict(estimateDataUrlBytes(dataUrl), AVATAR_BUDGET_BYTES);
    if (!verdict.over) return { ok: true, dataUrl };
    over = true;
  }
  return { ok: false, over, pngOnly };
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
  ctx.setTransform(scale, 0, 0, scale, -crop.sx * scale, -crop.sy * scale);
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
    const downscaled = regular.over ? renderAvatarTier(decoded, AVATAR_DOWNSCALED_TIER) : regular;
    if (downscaled.ok) return downscaled;
    if (downscaled.over) return { ok: false, message: "这张图片太大了，换一张小一点的图。" };
    if (downscaled.pngOnly || regular.pngOnly) {
      return { ok: false, message: "这个浏览器存不出可用的头像格式，换一张图或者换个浏览器试试。" };
    }
    return { ok: false, message: "这张图片格式无法读取，试试截图后再选。" };
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
  if (revealLocked()) { toast("先等这次揭示选完位置"); return; }
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
  if (!isBlocked()) playSfx("sfx.card.play");
  const play = { cardId, targetId, sourceId, asWitness: Boolean(asWitness), useAbigail: Boolean(useAbigail) };
  if (blueCardId) play.blueCardId = blueCardId;
  if (discardIndexes?.length) play.discardIndexes = discardIndexes.slice();
  act({ kind: "play", play });
  S.pending = null;
  closeModal();
  renderTargetBanner();
}

function onSeatClick(id) {
  if (!S.pending) {
    openRoleInfo(id);
    return;
  }
  if (revealLocked()) return;
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

// 房间状态归零：终态、主动离开、被踢共用这一份。存档、房间/投影/私密、座位与
// 抬手挂着的面板状态一起清掉，然后回落地页。
function resetRoomState() {
  clearSession();
  resetAvatars(null);
  S.room = null;
  S.projection = null;
  S.private = null;
  S.seatId = null;
  S.pending = null;
  S.nightKey = null;
  S.dawnKey = null;
  S.deal = null;
  S.dealFlipped = new Set();
  S.dealKey = null;
  S.conspiracyPick = null;
  S.conspiracyShown = null;
  S.conspiracyStep = null;
  $("conspiracyBar").hidden = true;
  leaveConspiracyStage();
  S.revealAfterglowUntil = 0;
  if (S.revealAfterglowTimer) {
    clearTimeout(S.revealAfterglowTimer);
    S.revealAfterglowTimer = null;
  }
  S.seenLog = null;
  S.revealQueue = [];
  S.flipSeen.clear();
  if (S.revealTimer) {
    clearTimeout(S.revealTimer);
    S.revealTimer = null;
  }
  if (S.revealDelay) {
    clearTimeout(S.revealDelay);
    S.revealDelay = null;
  }
  clearTimeout(S.phaseTimer);
  S.phaseTimer = null;
  S.lastPhase = null;
  S.suppressPhaseEntrance = true;
  S.overShown = false;
  clearOverTimers();
  hideDeath();
  $("revealBanner").hidden = true;
  closeModal();
  closeProfile();
  closeRoleInfo();
  render();
}

// 房间级终态：房间已经不存在（服务端重启、房间过期、被回收），重连也回不去这个房间。
// 停止重连、清掉存档、回落地页，并在房码错误提示的位置给出提示与重新开房入口。
function enterRoomGone() {
  S.roomGone = true;
  S.rejoining = false;
  S.queued = null;
  clearTimeout(S.reconnectTimer);
  resetRoomState();
  showRoomGonePrompt();
}

function showRoomGonePrompt() {
  const input = $("nameInput");
  if (!input.value) input.value = localStorage.getItem("salem.name") || "";
  $("landingError").textContent = ROOM_GONE_MESSAGE;
  $("reopenBtn").hidden = false;
}

function hideRoomGonePrompt() {
  $("landingError").textContent = "";
  $("reopenBtn").hidden = true;
}

// 落地页的提交出口：开房、加入、以及终态提示下的「重新开房」都从这里走。
// 复位「离开/重连中/终态」三个标记与昵称存档，socket 就绪就发、没就绪就排队等连上。
function landingSubmit(message) {
  hideRoomGonePrompt();
  localStorage.setItem("salem.name", message.name);
  S.leaving = false;
  S.rejoining = false;
  S.roomGone = false;
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    send(message);
    return;
  }
  // socket 还断着：连上之后立刻把这句发出去，别让入口点了没反应。
  S.queued = message;
  connect();
}

// 开新房：落地页的「创建房间」与终态提示下的「重新开房」共用这一条路径。
// 线下模式（面对面打牌）在建房时勾选，勾了就整套流程都不设倒计时。
function createRoom(name) {
  const offline = $("offlineMode")?.checked === true;
  landingSubmit({ type: "create", name, config: { offline } });
}

function leaveToLanding() {
  S.leaving = true;
  if (S.ws && S.ws.readyState === WebSocket.OPEN && S.room) send({ type: "leave" });
  resetRoomState();
  setTimeout(() => { S.leaving = false; }, 300);
}

function copyInvite() {
  if (!S.room) return;
  const url = location.origin + "/?code=" + S.room.code;
  const done = () => toast("邀请链接已复制", true);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => toast(url));
  else toast(url);
}

function syncMotionButton() {
  const btn = $("motionToggle");
  if (!btn) return;
  const level = getMotionLevel();
  const label = motionLabel(level);
  btn.dataset.level = level;
  btn.title = "动效：" + label + "（点击切换）";
  btn.setAttribute("aria-label", "动效：" + label + "，点击切换");
}

function bind() {
  const motionToggle = $("motionToggle");
  if (motionToggle) {
    motionToggle.addEventListener("click", () => {
      cycleMotionLevel();
      syncMotionButton();
    });
  }
  window.addEventListener("motion:level", () => {
    syncMotionButton();
    setAudioLevel(getMotionLevel());
  });
  // block 结束（超时或用户跳过）时把演出落到终态；调度器只发事件，不碰游戏状态。
  window.addEventListener("motion:blockend", (event) => {
    if (event.detail?.eventId === "fx.phase.night") $("nightOverlay").classList.remove("entering");
    if (event.detail?.eventId === "fx.life.death") hideDeath();
  });
  // 首次真实手势里同步解锁音频；pointerdown 覆盖鼠标/触摸，其余是 iOS 的保险。
  for (const type of ["touchend", "click", "keydown"]) {
    document.addEventListener(type, unlockAudio, true);
  }
  document.addEventListener("pointerdown", (event) => {
    unlockAudio();
    const target = event.target.closest?.("button, .card, .seat-card");
    if (target && !target.disabled) {
      motionPress(target);
      playSfx("sfx.ui.tap");
    }
  }, true);
  $("createBtn").addEventListener("click", () => {
    const raw = $("nameInput").value.trim();
    if (!raw) { $("landingError").textContent = "请先填一个昵称。"; return; }
    $("landingError").textContent = "";
    const name = cleanName(raw);
    profileStore.writeName(name);
    createRoom(name);
  });
  $("reopenBtn").addEventListener("click", () => {
    hideRoomGonePrompt();
    const entered = $("nameInput").value.trim() || localStorage.getItem("salem.name") || "";
    const name = cleanName(entered);
    $("nameInput").value = name;
    if (!entered) { $("landingError").textContent = "请先填一个昵称。"; $("nameInput").focus(); return; }
    profileStore.writeName(name);
    createRoom(name);
  });
  $("joinBtn").addEventListener("click", () => {
    const raw = $("nameInput").value.trim();
    const code = $("codeInput").value.trim().toUpperCase();
    if (!raw) { $("landingError").textContent = "请先填一个昵称。"; return; }
    if (code.length !== 6) { $("landingError").textContent = "房码是 6 位。"; return; }
    $("landingError").textContent = "";
    const name = cleanName(raw);
    profileStore.writeName(name);
    landingSubmit({ type: "join", code, name });
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
  $("dealCards").addEventListener("click", (event) => {
    const el = event.target.closest("[data-deal-card]");
    if (!el) return;
    S.dealFlipped.add(Number(el.dataset.dealCard));
    renderDeal();
  });
  $("dealRoles").addEventListener("click", (event) => {
    const el = event.target.closest("[data-role]");
    if (!el) return;
    act({ kind: "chooseRole", roleId: el.dataset.role });
  });
  $("dealAckBtn").addEventListener("click", () => {
    if ($("dealAckBtn").disabled) return;
    act({ kind: "dealAck" });
  });
  $("selfPanel").addEventListener("click", (event) => {
    const el = event.target.closest("[data-trial]");
    if (el) {
      openTrialModal(Number(el.dataset.trial));
      return;
    }
    openRoleInfo(S.seatId);
  });
  // 两步选定：点位置只改选中态，提交走「选定」；再点同一张就取消。
  $("revealDrawer").addEventListener("click", (event) => {
    const decline = event.target.closest('[data-slot="decline"]');
    if (decline) { act({ kind: "decline" }); return; }
    const slot = event.target.closest("[data-reveal-index]");
    if (slot && !slot.disabled) {
      const index = Number(slot.dataset.revealIndex);
      if (Number.isInteger(index)) {
        S.revealPick = toggleRevealPick(S.revealPick, index);
        renderRevealDrawer();
      }
      return;
    }
    if (event.target.closest("#revealSubmit")) {
      const view = S.projection?.pendingReveal ?? null;
      if (!canSubmitReveal(view, S.revealPick)) return;
      act({ kind: "reveal", trialIndex: S.revealPick });
    }
  });
  $("conspiracyCards").addEventListener("click", (event) => {
    const card = event.target.closest("[data-conspiracy-index]");
    if (!card || card.disabled) return;
    const index = Number(card.dataset.conspiracyIndex);
    if (!Number.isInteger(index)) return;
    // 再点一次同一张就取消：提交前允许改主意，不用先取消再选。
    S.conspiracyPick = S.conspiracyPick === index ? null : index;
    renderConspiracy();
  });
  $("conspiracySubmit").addEventListener("click", () => {
    const view = S.projection?.conspiracy ?? null;
    if (!canSubmitConspiracy(view, S.conspiracyPick)) return;
    act({ kind: "conspiracyPick", trialIndex: S.conspiracyPick });
  });
  $("opponents").addEventListener("click", (event) => {
    const button = event.target.closest("[data-seat]");
    if (button) onSeatClick(Number(button.dataset.seat));
  });
  $("hand").addEventListener("click", (event) => {
    const button = event.target.closest("[data-card]");
    if (button) openCardModal(button.dataset.card);
  });
  // 横幅是纯展示层（CSS pointer-events:none），不挡选牌/出牌；到点由定时器收起。
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
  $("selfPanel").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openRoleInfo(S.seatId);
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
  document.querySelectorAll("[data-close-role]").forEach((el) => el.addEventListener("click", closeRoleInfo));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("profileModal").hidden) closeProfile();
    if (!$("roleModal").hidden) closeRoleInfo();
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
  $("overOverlay").addEventListener("pointerdown", (event) => {
    if (event.target.closest("#backLobby")) return;
    if ($("overOverlay").dataset.stage !== "4") finishOverSequence();
  });
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

function syncViewportHeight() {
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : window.innerHeight;
  if (!Number.isFinite(height) || height <= 0) return;
  document.documentElement.style.setProperty("--app-vh", Math.round(height) + "px");
}

async function boot() {
  syncViewportHeight();
  window.addEventListener("resize", syncViewportHeight);
  window.visualViewport?.addEventListener("resize", syncViewportHeight);
  window.visualViewport?.addEventListener("scroll", syncViewportHeight);
  initMotion();
  initAudio(getMotionLevel());
  armSkip();
  syncMotionButton();
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

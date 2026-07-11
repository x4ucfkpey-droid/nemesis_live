/* NEMESIS LIVE — 状態・永続化・共通ユーティリティ */
"use strict";

const KEY = "nemesis_live_v1";

const DEFAULT_STATE = () => ({
  version: 1,
  settings: { email: "", handsPerHour: 25, currency: "¥", defaultVenue: "", defaultSb: 100, defaultBb: 200, heroLabel: "Hero", nemesisUrl: "http://localhost:8000", lastBackupAt: 0 },
  venues: [],
  players: [],   // {id,name,venues:[],type:[],look:[],notes,createdAt,lastSeenAt,seenCount}
  sessions: [],  // {id,startAt,endAt,venue,sb,bb,tableSize,buyins:[{amt,at}],cashout,notes,roster:[pid]}
  hands: []      // 設計書 §4 参照
});

let S = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATE();
    const s = JSON.parse(raw);
    // 前方互換: 欠けたキーをデフォルトで補完
    const d = DEFAULT_STATE();
    for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
    for (const k of Object.keys(d.settings)) if (s.settings[k] === undefined) s.settings[k] = d.settings[k];
    return s;
  } catch (e) {
    console.error("load失敗", e);
    return DEFAULT_STATE();
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { alert("保存に失敗しました(容量超過の可能性)。設定→バックアップからデータを退避してください。"); }
}

function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ---- 検索ヘルパ ---- */
function playerById(id) { return S.players.find(p => p.id === id) || null; }
function sessionById(id) { return S.sessions.find(s => s.id === id) || null; }
function handById(id) { return S.hands.find(h => h.id === id) || null; }
function handsOfSession(sid) { return S.hands.filter(h => h.sessionId === sid); }
function activeSession() { return S.sessions.find(s => !s.endAt) || null; }
function sessionProfit(s) {
  const inTotal = (s.buyins || []).reduce((a, b) => a + (+b.amt || 0), 0);
  return (s.cashout == null ? 0 : +s.cashout) - inTotal - (+s.expense || 0); // 経費(時間チャージ等)控除
}
function sessionHours(s) {
  const end = s.endAt || Date.now();
  return Math.max(0, (end - s.startAt) / 3600000);
}

/* ---- 表示ユーティリティ ---- */
function fmtMoney(v, signed) {
  if (v == null || isNaN(v)) return "—";
  const cur = S.settings.currency != null ? S.settings.currency : "¥"; // 空文字=記号なし を許可
  const sign = v < 0 ? "-" : (signed && v > 0 ? "+" : "");
  return sign + cur + Math.round(Math.abs(v)).toLocaleString();
}
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDur(ms) {
  const h = Math.floor(ms / 3600000), m = Math.round(ms % 3600000 / 60000);
  return h ? `${h}時間${m}分` : `${m}分`;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---- カード表現: "As","Td" 等。スート s/h/d/c ---- */
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["s", "h", "d", "c"];
const SUIT_GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_COLOR = { s: "var(--ink)", h: "var(--red)", d: "#3f6bb0", c: "#2f9e63" };
function cardHTML(c, big) {
  if (!c) return `<span class="cardv empty ${big ? "big" : ""}">?</span>`;
  const r = c[0] === "T" ? "10" : c[0], s = c[1];
  return `<span class="cardv ${big ? "big" : ""}" style="color:${SUIT_COLOR[s]}">${r}${SUIT_GLYPH[s]}</span>`;
}

/* ---- タグ定義 ---- */
const HAND_TAGS = ["要復習", "ブラフ成功", "ブラフ失敗", "ブラフキャッチ", "薄いバリュー", "クーラー", "バッドビート", "ミスった?"];
const LOOK_TAGS = ["20代", "30代", "40代", "50代", "60代+", "男性", "女性", "メガネ", "帽子", "ヒゲ", "長髪", "短髪", "金髪/染髪", "スキンヘッド", "細身", "がっしり", "大柄", "小柄", "スーツ", "派手な服", "パーカー", "イヤホン", "サングラス", "タトゥー"];
const TYPE_TAGS = ["NIT", "TAG", "LAG", "ステーション", "マニアック", "パッシブ", "トリッキー", "初心者", "常連", "うまい", "不明"];

/* ---- バックアップ ---- */
function exportJSON() { return JSON.stringify(S, null, 1); }
function importJSON(text) {
  const s = JSON.parse(text);
  if (!s || s.version !== 1 || !Array.isArray(s.sessions)) throw new Error("形式が不正です");
  S = s; save();
}

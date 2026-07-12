/* NEMESIS LIVE — ルーター・初期化 */
"use strict";

const VIEWS = {
  home: () => viewHome(),
  rec: () => viewRec(),
  hand: () => viewHand(),
  session: p => viewSession(p),
  handDetail: p => viewHandDetail(p),
  players: () => viewPlayers(),
  player: p => viewPlayer(p),
  playerEdit: () => viewPlayerEdit(),
  stats: () => viewStats(),
  hands: () => viewHands(),
  review: () => viewReview(),
  more: () => viewMore()
};
const NAV = [
  { view: "home", label: "ホーム", icon: "◆" },
  { view: "rec", label: "記録", icon: "●" },
  { view: "players", label: "プレイヤー", icon: "◉" },
  { view: "stats", label: "スタッツ", icon: "▤" },
  { view: "review", label: "レビュー", icon: "◈" },
  { view: "more", label: "その他", icon: "≡" }
];
const NAV_OF = { session: "home", handDetail: "rec", hand: "rec", player: "players", playerEdit: "players", hands: "stats" };

let route = { view: "home", param: null };
const NAV_STACK = []; // 「← 戻る」用の履歴(レコーダー画面は積まない)

function go(view, param) {
  if (route.view !== "hand" && !(route.view === view && route.param === (param || null))) {
    NAV_STACK.push({ ...route });
    if (NAV_STACK.length > 30) NAV_STACK.shift();
  }
  route = { view, param: param || null };
  renderApp();
  window.scrollTo(0, 0);
}

function goBack(fbView, fbParam) {
  let prev = NAV_STACK.pop();
  while (prev && (prev.view === "hand" || (prev.view === route.view && prev.param === route.param)))
    prev = NAV_STACK.pop();
  if (prev) { route = prev; renderApp(); window.scrollTo(0, 0); }
  else go(fbView || "home", fbParam);
}

function renderApp() {
  const fn = VIEWS[route.view] || VIEWS.home;
  document.getElementById("view").innerHTML = fn(route.param);
  const cur = NAV_OF[route.view] || route.view;
  document.getElementById("nav").innerHTML = NAV.map(n =>
    `<button class="nav-btn ${cur === n.view ? "on" : ""}" onclick="go('${n.view}')">
      <span class="nav-ic">${n.icon}</span>${n.label}</button>`).join("");
  // レビュータブ表示中のみポーリング稼働(離脱で停止)
  if (typeof reviewOnRoute === "function") reviewOnRoute(route.view);
  // 記録中はタイマー表示更新のため定期再描画(recタブ表示中のみ)
}

// 進行中セッションの経過時間表示を1分ごとに更新(入力中はスキップ=打ちかけのメモを消さない)
setInterval(() => {
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) return;
  if ((route.view === "rec" || route.view === "home") && activeSession() && !document.getElementById("sheetOv")) renderApp();
}, 60000);

window.addEventListener("DOMContentLoaded", () => {
  // 自己検知(S11): review.js が未ロードなら sw.js の ASSETS/CACHE版を疑う
  if (typeof REVIEW_JS_LOADED === "undefined")
    console.warn("review.js未ロード(sw.js ASSETSとCACHE版を確認)");
  renderApp();
  if ("serviceWorker" in navigator && location.protocol === "https:")
    navigator.serviceWorker.register("sw.js").catch(() => {});
  // 永続ストレージ要求: OSの容量圧迫時にサイトデータが消される優先度を下げる
  if (navigator.storage && navigator.storage.persist)
    navigator.storage.persist().catch(() => {});
  // 起動時に未送信レビューを再送(圏外復帰は online イベントでも)
  if (typeof reviewFlush === "function") reviewFlush();
});
window.addEventListener("online", () => { if (typeof reviewFlush === "function") reviewFlush(); });

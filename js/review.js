/* NEMESIS LIVE — ハンドレビュー(非同期送信 + ポーリング取得)
   DESIGN_hand_review.md §4/§3 準拠。素のグローバル関数方式。
   送信: 保存完了時/起動時/onlineイベント/手動 → /api/review/submit(X-Review-Token)
   取得: レビュータブ可視中のみ25秒間隔で /api/review/status → done を /api/review/get */
"use strict";

const REVIEW_JS_LOADED = true; // app.js 初期化での自己検知用(§4-4/S11)

/* ---- 共通: POST(JSON, トークン付き, 10sタイムアウト) ---- */
function _reviewBase() { return (S.settings.nemesisUrl || "").replace(/\/+$/, ""); }

async function _reviewPost(path, body, timeoutMs) {
  const base = _reviewBase();
  if (!base) throw new Error("no_base");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 10000);
  try {
    return await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Review-Token": S.settings.reviewToken || "" },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
  } catch (err) {
    console.warn("review fetch失敗 — nemesisUrl/CORS許可リスト(allowed_origins)を確認: " + err);
    throw err;
  } finally { clearTimeout(timer); }
}

/* ---- 状態ヘルパ ---- */
function _reviewEnsure() {
  if (!S.reviewQueue) S.reviewQueue = [];
  if (!S.reviews) S.reviews = {};
}
function _reviewQueueRemove(hid) { S.reviewQueue = (S.reviewQueue || []).filter(q => q.hid !== hid); }
function _reviewBumpTries(hid) {
  const it = (S.reviewQueue || []).find(q => q.hid === hid);
  if (!it) return;
  it.tries = (it.tries || 0) + 1;
  if (it.tries > 10) _reviewGiveUp(hid, "再送上限(10回)を超えました"); // 恒久失敗としてキューから除去
}
/* 送信を諦めてキューから除去 → 「送信失敗」バッジ表示へ */
function _reviewGiveUp(hid, reason) {
  _reviewQueueRemove(hid);
  S.reviews[hid] = { status: "failed", reason: reason || "", fetched: Date.now() };
}
/* 恒久拒否が明らかな rejected 理由(再送しても通らない) */
function _reviewRejectPermanent(reason) {
  const r = String(reason || "");
  return r.includes("Hero手札なし") || r.includes("ハンドとして解釈できない");
}

/* 結果キャッシュのLRU破棄(直近100件保持・localStorage容量保護)。
   対象は確定エントリ(done/unsupported/error/rejected/failed)のみ —
   未確定(queued/solving/unknown)を消すとポーリング追跡が静かに落ちるため除外 */
const _REVIEW_FINAL = { done: 1, unsupported: 1, error: 1, rejected: 1, failed: 1 };
function _reviewLruTrim() {
  const ids = Object.keys(S.reviews || {}).filter(id => _REVIEW_FINAL[S.reviews[id].status]);
  if (ids.length <= 100) return;
  ids.sort((a, b) => (S.reviews[a].fetched || 0) - (S.reviews[b].fetched || 0));
  for (const id of ids.slice(0, ids.length - 100)) delete S.reviews[id];
}

let _reviewTokenToasted = false; // 403は1セッション1回だけトースト
function _reviewToken403() {
  if (_reviewTokenToasted) return;
  _reviewTokenToasted = true;
  if (typeof toast === "function") toast("reviewToken不一致(設定→reviewTokenを確認してください)");
}

/* ---- キュー投入。force=true は編集済みハンドの再レビュー(PC側のdone済みIDを上書き再キュー) ---- */
function reviewEnqueue(hid, force) {
  if (!hid) return;
  _reviewEnsure();
  const ex = S.reviewQueue.find(q => q.hid === hid);
  if (ex) { // 二重投入防止(force昇格のみ反映)
    if (force && !ex.force) { ex.force = true; save(); }
    reviewFlush();
    return;
  }
  if (S.reviews[hid]) {
    if (!force) return; // 既に結果ありは積まない
    delete S.reviews[hid];
  }
  S.reviewQueue.push({ hid, ts: Date.now(), tries: 0, force: !!force });
  save();
  reviewFlush(); // 非同期発火(await しない)
}

/* ---- 送信(キューを順に submit) ---- */
let _reviewFlushing = false;
async function reviewFlush() {
  _reviewEnsure();
  if (_reviewFlushing) return;
  if (!navigator.onLine || !_reviewBase()) return;
  if (!S.reviewQueue.length) return;
  _reviewFlushing = true;
  let changed = false;
  try {
    for (const item of S.reviewQueue.slice()) {
      const hand = handById(item.hid);
      if (!hand) { _reviewQueueRemove(item.hid); changed = true; continue; }
      const text = handToGG(hand);
      if (!text) { _reviewQueueRemove(item.hid); changed = true; continue; } // 不完全ハンドは送れない

      let res;
      const body = item.force ? { hh_text: text, force: true } : { hh_text: text };
      try { res = await _reviewPost("/api/review/submit", body, 10000); }
      catch (e) { _reviewBumpTries(item.hid); changed = true; continue; } // ネット/timeout → 残留

      if (res.status === 403) { _reviewToken403(); _reviewBumpTries(item.hid); changed = true; continue; }
      if (!res.ok) { _reviewBumpTries(item.hid); changed = true; continue; }

      let data;
      try { data = await res.json(); } catch (e) { _reviewBumpTries(item.hid); changed = true; continue; }
      if (data.error) { _reviewBumpTries(item.hid); changed = true; continue; }

      const acc = (data.accepted || []).find(a => a.id === item.hid) || (data.accepted || [])[0];
      if (acc) {
        S.reviews[item.hid] = Object.assign({}, S.reviews[item.hid], {
          status: acc.status || "queued", queue_pos: acc.queue_pos, eta_s: acc.eta_s, fetched: Date.now()
        });
        _reviewQueueRemove(item.hid);
        changed = true;
      } else {
        const rj = (data.rejected || []).find(r => r.id === item.hid);
        if (rj && _reviewRejectPermanent(rj.reason)) {
          _reviewGiveUp(item.hid, rj.reason); // 恒久拒否は再送しても通らない → 即除去+failed
        } else {
          if (rj) S.reviews[item.hid] = { status: "rejected", reason: rj.reason, fetched: Date.now() };
          _reviewBumpTries(item.hid); // rejected/HTTPエラーは tries++ で残留(§4-3)。上限超えでfailed化
        }
        changed = true;
      }
    }
    if (changed) { _reviewLruTrim(); save(); _reviewRerender(); }
  } finally { _reviewFlushing = false; }
}

/* ---- ポーリング(レビュータブ可視中のみ) ---- */
let _reviewTimer = null;
const _reviewPollFails = {}; // hid -> 連続 fetch 失敗回数(6回で「PC応答なし」)

function _reviewMarkFail(id) {
  _reviewPollFails[id] = (_reviewPollFails[id] || 0) + 1;
  if (_reviewPollFails[id] >= 6 && S.reviews && S.reviews[id]) S.reviews[id].noResponse = true;
}
function _reviewClearFail(id) {
  delete _reviewPollFails[id];
  if (S.reviews && S.reviews[id]) delete S.reviews[id].noResponse;
}

let _reviewPolling = false;
async function reviewPoll() {
  _reviewEnsure();
  if (_reviewPolling) return; // 再入防止(done大量時に25s間隔を超過しても多重実行しない)
  if (document.hidden) return;
  if (!navigator.onLine || !_reviewBase()) return;
  _reviewPolling = true;
  try {
    await _reviewPollInner();
  } finally { _reviewPolling = false; }
}
async function _reviewPollInner() {
  let changed = false;
  // 1) 未確定(queued/solving/unknown)の status 照会
  const pending = Object.keys(S.reviews).filter(id => {
    const st = S.reviews[id].status;
    return st === "queued" || st === "solving" || st === "unknown";
  });
  if (pending.length) {
    let res = null;
    try { res = await _reviewPost("/api/review/status", { ids: pending }, 10000); }
    catch (e) { for (const id of pending) _reviewMarkFail(id); changed = true; }
    if (res) {
      if (res.status === 403) { _reviewToken403(); for (const id of pending) _reviewMarkFail(id); changed = true; }
      else if (res.ok) {
        let data = null;
        try { data = await res.json(); } catch (e) {}
        for (const rv of (data && data.reviews) || []) {
          const cur = S.reviews[rv.id] || {};
          S.reviews[rv.id] = Object.assign({}, cur, {
            status: rv.status, queue_pos: rv.queue_pos, eta_s: rv.eta_s,
            summary: rv.summary || cur.summary, finished: rv.finished || cur.finished, fetched: Date.now()
          });
          _reviewClearFail(rv.id);
          changed = true;
        }
      } else { for (const id of pending) _reviewMarkFail(id); changed = true; }
    }
  }

  // 2) done で本文未取得 → get(unsupported/error も本文取得して確定表示)
  const needBody = Object.keys(S.reviews).filter(id => {
    const r = S.reviews[id];
    return (r.status === "done" || r.status === "unsupported" || r.status === "error") && !r.body;
  });
  for (const id of needBody) {
    let res = null;
    try { res = await _reviewPost("/api/review/get", { id }, 10000); }
    catch (e) { _reviewMarkFail(id); changed = true; continue; }
    if (res.status === 403) { _reviewToken403(); _reviewMarkFail(id); changed = true; continue; }
    if (!res.ok) { _reviewMarkFail(id); changed = true; continue; }
    let data = null;
    try { data = await res.json(); } catch (e) { continue; }
    if (!data) continue;
    if (data.status === "done" || data.status === "unsupported" || data.status === "error") {
      S.reviews[id] = Object.assign({}, S.reviews[id], {
        body: data, status: data.status, summary: data.summary || (S.reviews[id] || {}).summary,
        finished: data.finished, fetched: Date.now()
      });
      _reviewClearFail(id);
      changed = true;
    } else {
      // まだ未確定(status/queue_pos)だった → 状態のみ更新
      S.reviews[id] = Object.assign({}, S.reviews[id], {
        status: data.status, queue_pos: data.queue_pos, eta_s: data.eta_s, fetched: Date.now()
      });
      changed = true;
    }
  }

  if (changed) { _reviewLruTrim(); save(); _reviewRerender(); }
}

function reviewPollStart() {
  if (_reviewTimer) return; // 二重起動防止(renderApp が何度呼ばれても1本)
  reviewPoll();
  _reviewTimer = setInterval(reviewPoll, 25000);
}
function reviewPollStop() {
  if (_reviewTimer) { clearInterval(_reviewTimer); _reviewTimer = null; }
}
/* renderApp から毎描画で呼ばれる: レビュータブ表示中だけタイマー稼働 */
function reviewOnRoute(view) {
  if (view === "review") reviewPollStart();
  else reviewPollStop();
}
/* タブ非表示(バックグラウンド)ではポーリング停止・復帰で再開 */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) reviewPollStop();
  else if (typeof route !== "undefined" && route.view === "review") reviewPollStart();
});

function _reviewRerender() {
  if (typeof route !== "undefined" && route.view === "review" && typeof renderApp === "function") renderApp();
}

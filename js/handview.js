/* NEMESIS LIVE — ハンド詳細の日本語リプレイ表示
   保存済みハンド(recorder.js recSave の hand オブジェクト)から読みやすい再生ビューを組み立てる。
   額の集計は gtolink.js / export.js と同じ規約:
     - acts の amt は bet/raise = そのストリートの合計投入額(raise-to)、call = 追加投入額
     - BBアンティは死に金(ポットには入るがストリートのベット額には数えない)
   表示のみの追加であり、セマンティクス(サイドポット・未コール返却・精算)は一切変更しない。 */
"use strict";

/* GG形式テキストの展開状態(review.js の _reviewOpen と同じ方式) */
const _ggOpen = {};
function ggToggle(hid) { _ggOpen[hid] = !_ggOpen[hid]; renderApp(); }

/* ---- 表示ヘルパ ---- */
function _hvBB(amt, bb) {
  if (!bb || amt == null || isNaN(amt)) return "";
  const v = Math.abs(amt) / bb;
  const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return (amt < 0 ? "-" : "") + r + "bb";
}
/* 「¥1,200 (6bb)」形式 */
function _hvAmt(amt, bb) {
  return `${fmtMoney(amt)} <span class="mut" style="font-size:11px">(${_hvBB(amt, bb)})</span>`;
}
function _hvCards(cards, big) {
  return (cards || []).filter(Boolean).map(c => cardHTML(c, big)).join("");
}
/* 座席に登録プレイヤーが居れば名前。ヒーローは null(ポジションのみ強調表示) */
function _hvPlayerName(hand, pos) {
  if (pos === hand.heroPos) return null;
  const pid = hand.seatMap && hand.seatMap[pos];
  const p = pid ? playerById(pid) : null;
  return p ? p.name : null;
}

const _HV_ACT_LABEL = { fold: "フォールド", check: "チェック", call: "コール", bet: "ベット", raise: "レイズ" };
const _HV_ACT_COLOR = { fold: "var(--mut)", check: "var(--ink)", call: "#5ecb96", bet: "#ef6a75", raise: "#ef6a75" };

/* ---- 集計: ハンドを再生してストリートごとの行データを作る ---- */
/* 返り値 {streets:[{key,label,cards,potStart,rows:[...]}], potStart..., participants, potEnd} */
function handReplayData(hand) {
  const bb = hand.bb || 1;
  const positions = POS_BY_SIZE[hand.tableSize] || [];
  const stk = pos => (hand.stacks && hand.stacks[pos] != null) ? hand.stacks[pos] : 100 * bb;
  const put = {}, tot = {};            // put=当該ストリート投入 / tot=ハンド累計投入
  let pot = 0;
  const room = pos => Math.max(0, stk(pos) - (tot[pos] || 0));
  const addBy = (pos, amt) => { const a = Math.max(0, Math.min(amt, room(pos))); pot += a; put[pos] = (put[pos] || 0) + a; tot[pos] = (tot[pos] || 0) + a; return a; };
  const addTo = (pos, total) => addBy(pos, total - (put[pos] || 0));
  const isAllin = pos => (tot[pos] || 0) >= stk(pos) - 1e-9;

  // 死に金(BBアンティ)→ ブラインド → ストラドル(engine.js のコンストラクタと同順)
  if (hand.ante > 0) { const a = Math.min(hand.ante, room("BB")); pot += a; tot.BB = (tot.BB || 0) + a; }
  addBy("SB", hand.sb);
  addBy("BB", hand.bb);
  if (hand.straddlePos) addBy(hand.straddlePos, hand.bb * 2);

  const st = hand.streets || {};
  const defs = [
    { key: "preflop", label: "プリフロップ", acts: (st.preflop && st.preflop.acts) || [], newCards: [] },
    { key: "flop", label: "フロップ", acts: (st.flop && st.flop.acts) || [], newCards: (st.flop && st.flop.cards) || null },
    { key: "turn", label: "ターン", acts: (st.turn && st.turn.acts) || [], newCards: (st.turn && st.turn.card) ? [st.turn.card] : null },
    { key: "river", label: "リバー", acts: (st.river && st.river.acts) || [], newCards: (st.river && st.river.card) ? [st.river.card] : null }
  ];
  const board = [];
  const out = [];
  for (const d of defs) {
    if (d.key !== "preflop") {
      if (!d.newCards) break;              // 未到達ストリート
      for (const k of Object.keys(put)) put[k] = 0;  // ストリート跨ぎでベット額リセット
      board.push(...d.newCards);
    }
    const potStart = pot;
    const rows = [];
    for (const a of d.acts) {
      let amt = null;
      if (a.act === "call") amt = addBy(a.pos, a.amt || 0);
      else if (a.act === "bet" || a.act === "raise") { addTo(a.pos, a.amt || 0); amt = a.amt || 0; }
      rows.push({
        pos: a.pos, act: a.act, amt, auto: !!a.auto,
        allin: (a.act === "call" || a.act === "bet" || a.act === "raise") && isAllin(a.pos),
        potAfter: pot
      });
    }
    out.push({ key: d.key, label: d.label, board: board.slice(), newCards: d.newCards || [], potStart, rows });
  }

  // プリフロップで降りなかった面子(実効スタック算出用)
  const foldedPre = new Set(((st.preflop && st.preflop.acts) || []).filter(a => a.act === "fold").map(a => a.pos));
  const participants = positions.filter(p => !foldedPre.has(p));
  let eff = null;
  if (hand.heroPos) {
    const others = (participants.includes(hand.heroPos) ? participants : positions).filter(p => p !== hand.heroPos);
    if (others.length) eff = Math.min(stk(hand.heroPos), Math.max(...others.map(stk)));
    else eff = stk(hand.heroPos);
  }
  return { streets: out, participants, eff, potRaw: pot, bb };
}

/* ---- 1アクション行 ---- */
function _hvRow(hand, r, bb) {
  const hero = r.pos === hand.heroPos;
  const nm = _hvPlayerName(hand, r.pos);
  const label = r.allin ? (r.act === "call" ? "コール(オールイン)" : "オールイン") : _HV_ACT_LABEL[r.act] || r.act;
  const color = r.allin ? "#e0a13b" : (_HV_ACT_COLOR[r.act] || "var(--ink)");
  const amtCell = r.amt != null && r.amt > 0
    ? `${r.act === "raise" && !r.allin ? '<span class="mut" style="font-size:11px">to </span>' : ""}${_hvAmt(r.amt, bb)}`
    : "";
  return `<div style="display:grid;grid-template-columns:74px 1fr auto;gap:6px;align-items:baseline;
      padding:6px 8px;border-radius:6px;margin:2px 0;${hero ? "background:#1e1418;box-shadow:inset 2px 0 0 var(--red)" : ""}">
    <div style="min-width:0">
      <b style="font-size:13px;${hero ? "color:#ef6a75" : ""}">${esc(r.pos)}</b>
      ${hero ? '<span style="font-size:9px;color:var(--red);margin-left:3px;vertical-align:1px">YOU</span>' : ""}
      ${nm ? `<div style="font-size:10px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nm)}</div>` : ""}
    </div>
    <div style="color:${color};font-size:13px;${hero ? "font-weight:700" : ""}">${label}${r.auto ? '<span class="mut" style="font-size:10px"> ※自動</span>' : ""}</div>
    <div style="text-align:right;white-space:nowrap;font-size:13px">${amtCell}</div>
  </div>`;
}

/* ---- 本体: ハンド詳細に差し込むリプレイHTML ---- */
function handReplayHTML(hand) {
  if (!hand || !hand.streets) return "";
  const bb = hand.bb || 1;
  const D = handReplayData(hand);
  let h = `<div class="card">`;

  // ヘッダー: ハンド・ポジション・実効スタック
  h += `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <div>${hand.heroCards ? _hvCards(hand.heroCards, true) : '<span class="mut">カード未入力</span>'}</div>
    <div style="line-height:1.4">
      <div style="font-weight:800;font-size:15px">${esc(hand.heroPos || "—")}</div>
      <div class="mut" style="font-size:11px">${hand.tableSize}max・${fmtMoney(hand.sb)}/${fmtMoney(hand.bb)}${hand.ante > 0 ? `(ante ${fmtMoney(hand.ante)})` : ""}${hand.straddlePos ? `・straddle ${esc(hand.straddlePos)}` : ""}</div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div class="mut" style="font-size:11px">実効スタック</div>
      <div style="font-weight:700">${D.eff != null ? _hvBB(D.eff, bb) : "—"}</div>
    </div>
  </div>`;

  // ストリート
  for (const s of D.streets) {
    h += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 4px;padding-top:10px;border-top:1px solid var(--line)">
      <span style="font-weight:800;font-size:12.5px;letter-spacing:.06em">${s.label}</span>
      ${s.board.length ? `<span style="display:flex;gap:3px">${_hvCards(s.board)}</span>` : ""}
      <span class="mut" style="margin-left:auto;font-size:11px;white-space:nowrap">ポット ${fmtMoney(s.potStart)} (${_hvBB(s.potStart, bb)})</span>
    </div>`;
    h += s.rows.length ? s.rows.map(r => _hvRow(hand, r, bb)).join("")
      : `<div class="mut" style="font-size:12px;padding:4px 8px">アクションなし(オールイン後のランアウト)</div>`;
  }

  // 結果
  h += `<div style="margin:14px 0 4px;padding-top:10px;border-top:1px solid var(--line);font-weight:800;font-size:12.5px;letter-spacing:.06em">結果</div>`;
  if (hand.complete === false) {
    h += `<div class="note" style="margin-top:0">途中保存のハンドです(精算未確定・GG出力対象外)。</div>`;
  }
  if (hand.uncalled && hand.uncalled.amt > 0)
    h += `<div style="font-size:13px;padding:4px 8px">未コール分 ${_hvAmt(hand.uncalled.amt, bb)} を <b>${esc(hand.uncalled.pos)}</b> に返却</div>`;

  const shows = hand.shows || {};
  const showPos = Object.keys(shows).filter(p => shows[p] && shows[p][0] && shows[p][1]);
  if (showPos.length) {
    h += `<div class="mut" style="font-size:11px;margin:8px 0 2px;padding:0 8px">ショーダウンで見えた手</div>`;
    for (const pos of showPos) {
      const nm = _hvPlayerName(hand, pos);
      h += `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:13px">
        <b style="${pos === hand.heroPos ? "color:#ef6a75" : ""}">${esc(pos)}</b>
        ${nm ? `<span class="mut" style="font-size:11px">${esc(nm)}</span>` : ""}
        <span style="margin-left:auto;display:flex;gap:3px">${_hvCards(shows[pos])}</span></div>`;
    }
  }
  if ((hand.winners || []).length) {
    h += `<div class="mut" style="font-size:11px;margin:8px 0 2px;padding:0 8px">獲得</div>`;
    for (const w of hand.winners) {
      const nm = _hvPlayerName(hand, w.pos);
      h += `<div style="display:flex;align-items:baseline;gap:8px;padding:4px 8px;font-size:13px">
        <b style="${w.pos === hand.heroPos ? "color:#ef6a75" : ""}">${esc(w.pos)}</b>
        ${nm ? `<span class="mut" style="font-size:11px">${esc(nm)}</span>` : ""}
        <span style="margin-left:auto;white-space:nowrap">${_hvAmt(w.amt || 0, bb)}</span></div>`;
    }
  }
  h += `<div style="display:flex;justify-content:space-between;padding:6px 8px;font-size:12px;color:var(--mut);border-top:1px solid var(--line);margin-top:8px">
      <span>総ポット</span><span>${fmtMoney(hand.potTotal || 0)} (${_hvBB(hand.potTotal || 0, bb)})</span></div>
    <div style="display:flex;justify-content:space-between;padding:0 8px 6px;font-size:12px;color:var(--mut)">
      <span>レーキ</span><span>${fmtMoney(hand.rake || 0)}</span></div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:8px;border-radius:8px;background:#0d0f14">
      <span style="font-size:12px;color:var(--mut)">ヒーロー収支</span>
      <span style="font-size:19px;font-weight:800;color:${(hand.heroNet || 0) >= 0 ? "#2f9e63" : "var(--red)"}">
        ${fmtMoney(hand.heroNet, true)} <span style="font-size:12px;font-weight:400">(${_hvBB(hand.heroNet || 0, bb)})</span></span></div>`;

  h += `</div>`;
  return h;
}

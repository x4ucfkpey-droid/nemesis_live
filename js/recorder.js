/* NEMESIS LIVE — ハンドレコーダー画面
   engine.js のHandEngineを操作するUI。phase: setup/action は同一画面、settle は精算画面。 */
"use strict";

let REC = null;

function startHand(sessionId) {
  const sess = sessionById(sessionId);
  if (!sess) return;
  const last = handsOfSession(sessionId).slice(-1)[0];
  const tableSize = (last && last.tableSize) || sess.tableSize || 9;
  const posList = POS_BY_SIZE[tableSize];
  const defStack = sess.bb * 100;
  const stacks = {}, seatMap = {};
  let heroPos = null;
  if (last && last.tableSize === tableSize) {
    // ボタンが1つ進む=全員のポジションがリスト上で1つ手前に回転(同卓継続の前提。
    // 例: BTN→CO, SB→BTN, UTG→BB。違ったらチップのタップで修正できる)
    const rot = p => posList[(posList.indexOf(p) - 1 + posList.length) % posList.length];
    if (last.heroPos && posList.includes(last.heroPos)) heroPos = rot(last.heroPos);
    for (const pos of posList) {
      const from = posList[(posList.indexOf(pos) + 1) % posList.length]; // rot(from)===pos
      stacks[pos] = (last.stacks && last.stacks[from]) || defStack;
    }
    for (const [pos, pid] of Object.entries(last.seatMap || {}))
      if (posList.includes(pos)) seatMap[rot(pos)] = pid;
  } else {
    for (const pos of posList) stacks[pos] = defStack;
  }
  REC = {
    sessionId, ts: Date.now(),
    tableSize, sb: sess.sb, bb: sess.bb, ante: sess.ante || 0, straddle: false,
    rakePct: sess.rakePct || 0, rakeCap: sess.rakeCap || 0,
    heroPos, heroCards: null, seatMap, note: "", tags: [],
    shows: {}, winners: [], rake: 0, phase: "action", sel: null,
    eng: new HandEngine({ tableSize, sb: sess.sb, bb: sess.bb, ante: sess.ante || 0, stacks })
  };
  go("hand");
}

function recRebuild() {
  // アクション入力前のみ: 卓サイズ/ストラドル変更でエンジン再構築
  const stacks = {};
  for (const pos of POS_BY_SIZE[REC.tableSize]) stacks[pos] = (REC.eng.p[pos] && REC.eng.p[pos].stack) || REC.bb * 100;
  // ストラドラー=最初に行動する非ブラインド(UTGが無い卓でも先頭ポジション)。HUは無し
  const straddler = REC.straddle && REC.tableSize > 2 ? preflopOrder(REC.tableSize)[0] : null;
  REC.eng = new HandEngine({ tableSize: REC.tableSize, sb: REC.sb, bb: REC.bb, ante: REC.ante, stacks, straddlePos: straddler });
  if (REC.heroPos && !POS_BY_SIZE[REC.tableSize].includes(REC.heroPos)) REC.heroPos = null;
  REC.sel = null;
  renderApp();
}
function recActed() { return ["preflop", "flop", "turn", "river"].some(s => REC.eng.acts[s].some(a => !a.auto)); }

function recSetSize(n) { if (recActed()) { toast("アクション入力後は変更できません"); return; } REC.tableSize = n; recRebuild(); }
function recToggleStraddle() { if (recActed()) { toast("アクション入力後は変更できません"); return; } REC.straddle = !REC.straddle; recRebuild(); }
function recSetHeroPos(pos) { REC.heroPos = pos; renderApp(); }

async function recPickHeroCards() {
  const used = recUsedCards(REC.heroCards || []);
  const c = await pickCards(2, used, "ヒーローのハンド", []);
  if (c) { REC.heroCards = c; renderApp(); }
}
function recUsedCards(except) {
  const ex = new Set(except || []);
  const used = [];
  const b = REC.eng.board;
  for (const c of [...(REC.heroCards || []), ...(b.flop || []), b.turn, b.river]) if (c && !ex.has(c)) used.push(c);
  for (const pos of Object.keys(REC.shows)) for (const c of REC.shows[pos] || []) if (c && !ex.has(c)) used.push(c);
  return used;
}

async function recEditStack(pos) {
  const v = await numpad({ title: `${pos} スタック`, init: REC.eng.p[pos].stack, quick: [{ label: "50bb", amt: 50 * REC.bb }, { label: "100bb", amt: 100 * REC.bb }, { label: "150bb", amt: 150 * REC.bb }, { label: "200bb", amt: 200 * REC.bb }] });
  if (v != null && v > 0) { REC.eng.p[pos].stack = v; renderApp(); }
}

async function recAssignPlayer(pos) {
  const sess = sessionById(REC.sessionId);
  const roster = (sess.roster || []).map(playerById).filter(Boolean);
  const others = S.players.filter(p => !(sess.roster || []).includes(p.id))
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0)).slice(0, 20);
  const cur = REC.seatMap[pos];
  const item = p => `<button class="list-item" onclick="closeSheet('${p.id}')">${esc(p.name)} ${cur === p.id ? "✓" : ""}<span class="mut" style="float:right">${p.lastSeenAt ? fmtDate(p.lastSeenAt) : ""}</span></button>`;
  const r = await openSheet(`
    <div class="sh-title">${pos} のプレイヤー</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input id="npNew" class="inp" placeholder="新規プレイヤー名" style="flex:1">
      <button class="btn primary" onclick="closeSheet('__new__')">追加</button>
    </div>
    ${cur ? `<button class="list-item" onclick="closeSheet('__clear__')">割当を解除</button>` : ""}
    ${roster.length ? `<div class="lbl">今日の同卓者</div>` + roster.map(item).join("") : ""}
    ${others.length ? `<div class="lbl">最近のプレイヤー</div>` + others.map(item).join("") : ""}`);
  if (!r) return;
  if (r === "__clear__") { delete REC.seatMap[pos]; renderApp(); return; }
  let pid = r;
  if (r === "__new__") {
    const nameEl = document.getElementById("npNew");
    const name = nameEl && nameEl.value.trim();
    if (!name) return;
    pid = addPlayer(name, sess.venue);
  }
  // 同一プレイヤーの重複割当を防止(回転引継ぎ後に別席へ再割当てするケース)
  for (const k of Object.keys(REC.seatMap)) if (REC.seatMap[k] === pid) delete REC.seatMap[k];
  REC.seatMap[pos] = pid;
  if (!sess.roster) sess.roster = [];
  if (!sess.roster.includes(pid)) { sess.roster.push(pid); save(); }
  renderApp();
}

/* ---- アクション入力 ---- */
function recSelect(pos) { REC.sel = pos; renderApp(); }

function recAct(act) {
  const pos = REC.sel || REC.eng.current();
  if (!pos) return;
  if (act === "fold" || act === "check" || act === "call") {
    const st = REC.eng.act(pos, act);
    REC.sel = null;
    recAfterAct(st);
  }
}
async function recBet(kind) {
  const eng = REC.eng;
  const pos = REC.sel || eng.current();
  if (!pos) return;
  const pl = eng.p[pos];
  const pot = eng.pot, toCall = eng.toCall(pos), cur = eng.curBet;
  const remain = pl.stack - pl.totalPut;
  const allin = pl.streetPut + remain;
  let quick = [];
  if (kind === "bet") {
    quick = [[33, .33], [50, .5], [66, .66], [75, .75], [100, 1], [125, 1.25]]
      .map(([l, f]) => ({ label: l + "%", amt: Math.min(Math.round(pot * f), allin) }));
  } else {
    if (eng.street === "preflop" && cur <= eng.bb * 2 + 1e-9) {
      quick = [[2, "2x"], [2.5, "2.5x"], [3, "3x"], [4, "4x"]].map(([m, l]) => ({ label: l, amt: Math.min(Math.round(cur * m), allin) }));
    } else {
      const potRaise = Math.round(cur * 2 + pot - pl.streetPut + toCall * 0); // 簡易pot raise-to
      quick = [{ label: "2.2x", amt: Math.min(Math.round(cur * 2.2), allin) }, { label: "2.5x", amt: Math.min(Math.round(cur * 2.5), allin) }, { label: "3x", amt: Math.min(Math.round(cur * 3), allin) }, { label: "pot", amt: Math.min(potRaise, allin) }];
    }
  }
  quick.push({ label: "All-in", amt: allin });
  const title = kind === "bet" ? `${pos} ベット額` : `${pos} レイズ額(to)`;
  const v = await numpad({ title, quick, max: allin });
  if (v == null || v <= 0) return;
  const st = REC.eng.act(pos, kind, v);
  REC.sel = null;
  recAfterAct(st);
}

function recAfterAct(status) {
  renderApp();
  if (status === "street_done") setTimeout(recBoardInput, 120);
  else if (status === "hand_done_fold" || status === "hand_done_showdown") recEnterSettle();
}

/* 精算画面へ。レーキ自動計算(ノーフロップ・ノードロップ: フロップ前終了は徴収なし) */
function recEnterSettle() {
  REC.phase = "settle";
  if (REC.rakePct > 0 && REC.eng.board.flop) {
    let r = Math.round(REC.eng.pot * REC.rakePct / 100);
    if (REC.rakeCap > 0) r = Math.min(r, REC.rakeCap);
    REC.rake = r;
  }
  recAutoWinner();
  recRedistribute();
  renderApp();
}

async function recBoardInput() {
  const eng = REC.eng;
  const n = eng.street === "preflop" ? 3 : 1;
  const label = eng.street === "preflop" ? "フロップ" : eng.street === "flop" ? "ターン" : "リバー";
  const cards = await pickCards(n, recUsedCards(), label + "のカード", []);
  if (!cards) return; // キャンセル時はボタンから再入力可能
  recAfterAct(eng.nextStreet(cards));
}

function recUndo() {
  if (REC.phase === "settle") { REC.phase = "action"; REC.winners = []; renderApp(); return; }
  if (REC.eng.undo()) renderApp(); else toast("これ以上戻れません");
}

/* ---- 精算 ---- */
function recAutoWinner() {
  const act = REC.eng.activePlayers();
  if (act.length === 1) {
    const settle = REC.eng.settle(null, REC.rake);
    REC.winners = settle.winners;
  }
}
function recRedistribute() {
  // レーキ・未コール控除後を等分。端数は最後の勝者に寄せて合計=potNetを保証
  const u = REC.eng.uncalled();
  const potNet = Math.max(0, REC.eng.pot - (u ? u.amt : 0) - (REC.rake || 0));
  const k = REC.winners.length;
  if (!k) return;
  const share = Math.floor(potNet / k);
  REC.winners.forEach((w, i) => w.amt = i === k - 1 ? potNet - share * (k - 1) : share);
}
function recToggleWinner(pos) {
  const i = REC.winners.findIndex(w => w.pos === pos);
  if (i >= 0) REC.winners.splice(i, 1); else REC.winners.push({ pos, amt: 0 });
  recRedistribute();
  renderApp();
}
async function recEditWinAmt(pos) {
  const w = REC.winners.find(x => x.pos === pos);
  if (!w) return;
  const v = await numpad({ title: `${pos} の獲得額`, init: w.amt });
  if (v != null) { w.amt = v; renderApp(); }
}
async function recEditRake() {
  const v = await numpad({ title: "レーキ", init: REC.rake, quick: [{ label: "なし", amt: 0 }] });
  if (v != null) { REC.rake = v; recRedistribute(); renderApp(); }
}
async function recPickShow(pos) {
  const c = await pickCards(2, recUsedCards(REC.shows[pos] || []), `${pos} のショーダウンハンド`, []);
  if (c) { REC.shows[pos] = c; renderApp(); }
}
function recClearShow(pos) { delete REC.shows[pos]; renderApp(); }
function recToggleTag(i) {
  const t = HAND_TAGS[i], ix = REC.tags.indexOf(t);
  if (ix >= 0) REC.tags.splice(ix, 1); else REC.tags.push(t);
  renderApp();
}

function recSave(complete) {
  if (!REC.heroPos) { toast("ヒーローのポジションを選んでください"); return false; }
  if (!REC.heroCards) { toast("ヒーローのハンドを入力してください"); return false; }
  if (complete && !REC.winners.length) { toast("勝者を選んでください"); return false; }
  const eng = REC.eng;
  const u = eng.uncalled();
  // ヒーロー収支 = 獲得 + 未コール払戻 - 投入
  let heroNet = -eng.p[REC.heroPos].totalPut;
  for (const w of REC.winners) if (w.pos === REC.heroPos) heroNet += w.amt;
  if (u && u.pos === REC.heroPos) heroNet += u.amt;
  // ヒーローのショーダウン手は自動でshowsへ(ショーダウン到達時)
  const wentToShowdown = eng.status() === "hand_done_showdown" || Object.keys(REC.shows).length > 0;
  if (wentToShowdown && !eng.p[REC.heroPos].folded && REC.heroCards && complete)
    REC.shows[REC.heroPos] = REC.heroCards;
  const hand = {
    id: "LP" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    sessionId: REC.sessionId, ts: REC.ts,
    tableSize: REC.tableSize, sb: REC.sb, bb: REC.bb, ante: REC.ante || 0,
    straddlePos: REC.eng.straddlePos || null,
    heroPos: REC.heroPos, heroCards: REC.heroCards,
    stacks: Object.fromEntries(POS_BY_SIZE[REC.tableSize].map(p => [p, eng.p[p].stack])),
    seatMap: { ...REC.seatMap },
    streets: {
      preflop: { acts: eng.acts.preflop },
      flop: eng.board.flop ? { cards: eng.board.flop, acts: eng.acts.flop } : null,
      turn: eng.board.turn ? { card: eng.board.turn, acts: eng.acts.turn } : null,
      river: eng.board.river ? { card: eng.board.river, acts: eng.acts.river } : null
    },
    shows: { ...REC.shows }, winners: REC.winners.slice(), rake: REC.rake || 0,
    potTotal: eng.pot, uncalled: u, wentToShowdown, complete: !!complete,
    heroNet, note: REC.note || "", tags: (REC.tags || []).slice()
  };
  S.hands.push(hand);
  // 同卓プレイヤーの対面記録を更新
  for (const pid of Object.values(REC.seatMap)) {
    const p = playerById(pid);
    if (p) { p.lastSeenAt = Date.now(); p.seenCount = (p.seenCount || 0) + 1; }
  }
  save();
  toast(complete ? "ハンドを保存しました" : "途中保存しました(出力対象外)");
  REC = null;
  go("rec");
  return true;
}

function recSaveNext() {
  const sid = REC.sessionId;
  if (recSave(true)) startHand(sid);
}

async function recCancel() {
  if (recActed() && !(await confirmDlg("このハンドを破棄しますか?", "破棄"))) return;
  REC = null;
  go("rec");
}

/* ---- 描画 ---- */
function viewHand() {
  if (!REC) return `<div class="wrap"><div class="mut">セッションがありません</div></div>`;
  const eng = REC.eng;
  const b = eng.board;
  const boardHtml = [...(b.flop || []), b.turn, b.river].filter(Boolean).map(c => cardHTML(c, true)).join("") || `<span class="mut">プリフロップ</span>`;
  const stLabel = { preflop: "プリフロップ", flop: "フロップ", turn: "ターン", river: "リバー" }[eng.street];

  let h = `<div class="rec-top">
    <button class="btn sm" onclick="recCancel()">✕ 中止</button>
    <div class="rec-pot">POT <b>${fmtMoney(eng.pot)}</b></div>
    <button class="btn sm" onclick="recUndo()">↶ 戻す</button>
  </div>
  <div class="card" style="text-align:center">
    <div class="lbl">${stLabel}</div>
    <div class="board">${boardHtml}</div>
  </div>`;

  // ヒーロー設定
  h += `<div class="card"><div class="lbl">ヒーロー</div>
    <div class="chips">${POS_BY_SIZE[REC.tableSize].map(p =>
      `<button class="chip ${REC.heroPos === p ? "on" : ""}" onclick="recSetHeroPos('${p}')">${p}</button>`).join("")}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
      <button class="btn" onclick="recPickHeroCards()">${REC.heroCards ? cardHTML(REC.heroCards[0], true) + cardHTML(REC.heroCards[1], true) : "ハンドを入力"}</button>
      ${!recActed() ? `${REC.tableSize > 2 ? `<button class="btn sm ${REC.straddle ? "primary" : ""}" onclick="recToggleStraddle()">ストラドル</button>` : ""}
      <select class="inp sm" onchange="recSetSize(+this.value)">${[9, 8, 7, 6, 5, 4, 3, 2].map(n => `<option value="${n}" ${REC.tableSize === n ? "selected" : ""}>${n}人</option>`).join("")}</select>` : ""}
    </div></div>`;

  if (REC.phase === "settle") return h + viewSettle();

  // アクションパネル
  const sel = REC.sel || eng.current();
  h += `<div class="card"><div class="lbl">アクション — 手番: <b style="color:var(--ink)">${eng.current() || "—"}</b></div>
    <div class="pos-strip">`;
  for (const pos of POS_BY_SIZE[REC.tableSize]) {
    const pl = eng.p[pos];
    const inQ = eng.queue.includes(pos);
    const cls = pl.folded ? "dead" : pl.allin ? "allin" : inQ ? (pos === sel ? "sel" : "live") : "done";
    const pid = REC.seatMap[pos];
    const pname = pid ? (playerById(pid) || {}).name : "";
    h += `<div class="pos-cell ${cls}">
      <button class="pos-btn" ${inQ ? `onclick="recSelect('${pos}')"` : "disabled"}>${pos}${pos === REC.heroPos ? "★" : ""}</button>
      <div class="pos-put">${pl.streetPut ? fmtMoney(pl.streetPut) : pl.folded ? "fold" : pl.allin ? "全" : ""}</div>
      <button class="pos-name" onclick="recAssignPlayer('${pos}')">${pname ? esc(pname.slice(0, 6)) : "＋"}</button>
      <button class="pos-stack" onclick="recEditStack('${pos}')">${Math.round((pl.stack - pl.totalPut) / REC.bb)}bb</button>
    </div>`;
  }
  h += `</div>`;
  if (sel) {
    const toCall = eng.toCall(sel);
    h += `<div class="act-row">
      <button class="btn act fold" onclick="recAct('fold')">フォールド</button>
      ${toCall > 0
        ? `<button class="btn act call" onclick="recAct('call')">コール<br><span class="mut">${fmtMoney(Math.min(toCall, eng.p[sel].stack - eng.p[sel].totalPut))}</span></button>
           <button class="btn act raise" onclick="recBet('raise')">レイズ</button>`
        : `<button class="btn act call" onclick="recAct('check')">チェック</button>
           <button class="btn act raise" onclick="recBet('bet')">ベット</button>`}
    </div>`;
  }
  if (eng._undoStack.length) h += `<button class="btn" style="width:100%;margin-top:8px;color:var(--mut)" onclick="recUndo()">↶ 直前のアクションを戻す</button>`;
  h += `<div class="note" style="margin-top:6px">各ポジションの下: 青い名前=プレイヤー割当 / bb数=スタック編集(タップ)</div>`;
  h += `</div>`;

  // アクション履歴
  const hist = [];
  for (const skey of ["preflop", "flop", "turn", "river"])
    for (const a of eng.acts[skey])
      if (!a.auto) hist.push(`${a.pos} ${({ fold: "F", check: "X", call: "C", bet: "B", raise: "R" })[a.act]}${a.amt ? " " + Math.round(a.amt).toLocaleString() : ""}`);
  if (hist.length) h += `<div class="card"><div class="lbl">履歴</div><div class="mut" style="font-size:12px;line-height:1.8">${hist.join(" → ")}</div></div>`;
  if (eng.status() === "street_done") h += `<div class="card"><button class="btn primary" style="width:100%" onclick="recBoardInput()">ボードカードを入力</button></div>`;
  h += `<div class="card"><button class="btn" style="width:100%" onclick="recEnterSettle()">ここで終了して精算へ</button></div>`;
  return h;
}

function viewSettle() {
  const eng = REC.eng;
  const act = eng.activePlayers();
  const u = eng.uncalled();
  const potNet = Math.max(0, eng.pot - (u ? u.amt : 0) - (REC.rake || 0));
  let h = `<div class="card"><div class="lbl">精算 — ポット ${fmtMoney(eng.pot)}${u ? ` (未コール${fmtMoney(u.amt)}は${u.pos}へ返却)` : ""}</div>
    <div class="lbl">勝者(タップで選択・金額タップで修正)</div>
    <div class="chips">`;
  for (const pos of act) {
    const w = REC.winners.find(x => x.pos === pos);
    h += `<button class="chip big ${w ? "on" : ""}" onclick="recToggleWinner('${pos}')">${pos}${pos === REC.heroPos ? "★" : ""}</button>`;
    if (w) h += `<button class="chip" onclick="recEditWinAmt('${pos}')">${fmtMoney(w.amt)}</button>`;
  }
  h += `</div>
    <button class="btn sm" style="margin-top:8px" onclick="recEditRake()">レーキ: ${fmtMoney(REC.rake || 0)}${REC.rakePct > 0 ? ` (${REC.rakePct}%自動・タップで修正)` : ""}</button>
    <div class="note">分配額はレーキ・未コール分を引いた ${fmtMoney(potNet)} を等分(タップで個別修正可)</div>
  </div>`;
  // ショーダウン
  if (act.length > 1) {
    h += `<div class="card"><div class="lbl">ショーダウン(見せた手・任意)</div>`;
    for (const pos of act) {
      if (pos === REC.heroPos) { h += `<div class="sd-row"><b>${pos}★</b> ${REC.heroCards ? cardHTML(REC.heroCards[0]) + cardHTML(REC.heroCards[1]) : ""} <span class="mut">自動記録</span></div>`; continue; }
      const s = REC.shows[pos];
      h += `<div class="sd-row"><b>${pos}</b> ${s ? cardHTML(s[0]) + cardHTML(s[1]) + ` <button class="btn sm" onclick="recClearShow('${pos}')">✕</button>` : `<button class="btn sm" onclick="recPickShow('${pos}')">カード入力</button>`}</div>`;
    }
    h += `</div>`;
  }
  h += `<div class="card">
    <div class="lbl">タグ(任意・後でハンド一覧から抽出できます)</div>
    <div class="chips sm" style="margin-bottom:10px">${HAND_TAGS.map((t, i) => `<button class="chip ${REC.tags.includes(t) ? "on" : ""}" onclick="recToggleTag(${i})">${t}</button>`).join("")}</div>
    <input class="inp" id="recNote" placeholder="メモ(任意: 相手の様子・自分の読みなど)" value="${esc(REC.note)}" onchange="REC.note=this.value">
    <div class="row2" style="margin-top:10px">
      <button class="btn" onclick="recSave(false)">途中保存</button>
      <button class="btn primary" onclick="recSave(true)">保存する</button>
    </div>
    <button class="btn primary cta" style="margin:8px 0 0" onclick="recSaveNext()">保存して次のハンドへ</button>
  </div>`;
  return h;
}

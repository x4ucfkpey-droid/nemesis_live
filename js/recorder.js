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
  // 全員のデフォルトスタック=セッションの初回バイイン額(未入力時のみ100bb)
  const defStack = (sess.buyins && sess.buyins[0] && +sess.buyins[0].amt) || sess.bb * 100;
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
    pendingBoard: { flop: null, turn: null, river: null }, // B: ボード先行入力
    layerWinners: null, manualWin: false, editing: null,   // B1/B2/C
    eng: new HandEngine({ tableSize, sb: sess.sb, bb: sess.bb, ante: sess.ante || 0, stacks })
  };
  // A: 席順(sess.seating)があれば従来の全体回転を置換 — heroPosを1つ進めて自動再割当
  if (seatingActive(sess) && REC.heroPos) recApplySeating(REC.heroPos);
  go("hand");
}

/* ---- A: セッション席順からの自動ポジション割当 ---- */
/* 時計回りの物理席順に対応するポジション列(ディール順: SB→BB→UTG→…→BTN) */
function clockwisePositions(n) {
  if (n === 2) return ["SB", "BB"];
  const all = POS_BY_SIZE[n];
  return ["SB", "BB"].concat(all.filter(p => p !== "SB" && p !== "BB"));
}
/* 着席中(非離席)エントリを席順で返す。seating未設定/HERO無し/2人未満は null(=従来動作) */
function seatingActive(sess) {
  if (!sess || !Array.isArray(sess.seating)) return null;
  const so = sess.sitout || {};
  const act = sess.seating.filter(e => e === "HERO" || !so[e]);
  if (act.indexOf("HERO") < 0 || act.length < 2) return null;
  return act;
}
/* heroPos選択を起点に、席順のHEROから時計回りへ全ポジションを対応付けて seatMap を自動構築。
   卓サイズもアクティブ人数から自動設定(アクション入力後はサイズ変更不可=適用不可でfalse)。
   falseを返したら従来の手動割当のまま。 */
function recApplySeating(desiredPos) {
  const sess = sessionById(REC.sessionId);
  const act = seatingActive(sess);
  if (!act || act.length > 9) return false;
  const n = act.length;
  if (REC.tableSize !== n) {
    if (recActed()) return false;
    // 旧サイズのポジションを末尾(BB)基準で新サイズへ写像してから再構築
    if (desiredPos) {
      const oldList = POS_BY_SIZE[REC.tableSize], newList = POS_BY_SIZE[n];
      const fromEnd = oldList.length - 1 - oldList.indexOf(desiredPos);
      desiredPos = newList[newList.length - 1 - Math.min(Math.max(fromEnd, 0), newList.length - 1)];
    }
    REC.tableSize = n;
    recRebuildEngine();
  }
  const posList = POS_BY_SIZE[REC.tableSize];
  const heroPos = desiredPos && posList.includes(desiredPos) ? desiredPos
    : (REC.heroPos && posList.includes(REC.heroPos) ? REC.heroPos : "BB");
  const cw = clockwisePositions(REC.tableSize);
  const ci = cw.indexOf(heroPos), hi = act.indexOf("HERO");
  REC.seatMap = {};
  for (let k = 1; k < act.length; k++) {
    const pid = act[(hi + k) % act.length];
    if (pid !== "HERO") REC.seatMap[cw[(ci + k) % cw.length]] = pid;
  }
  REC.heroPos = heroPos;
  return true;
}

function recRebuildEngine() {
  // アクション入力前のみ: 卓サイズ/ストラドル変更でエンジン再構築(描画なし)
  const stacks = {};
  for (const pos of POS_BY_SIZE[REC.tableSize]) stacks[pos] = (REC.eng.p[pos] && REC.eng.p[pos].stack) || REC.bb * 100;
  // ストラドラー=最初に行動する非ブラインド(UTGが無い卓でも先頭ポジション)。HUは無し
  const straddler = REC.straddle && REC.tableSize > 2 ? preflopOrder(REC.tableSize)[0] : null;
  REC.eng = new HandEngine({ tableSize: REC.tableSize, sb: REC.sb, bb: REC.bb, ante: REC.ante, stacks, straddlePos: straddler });
  if (REC.heroPos && !POS_BY_SIZE[REC.tableSize].includes(REC.heroPos)) REC.heroPos = null;
  REC.sel = null;
}
function recRebuild() { recRebuildEngine(); renderApp(); }
function recActed() { return ["preflop", "flop", "turn", "river"].some(s => REC.eng.acts[s].some(a => !a.auto)); }

function recSetSize(n) { if (recActed()) { toast("アクション入力後は変更できません"); return; } REC.tableSize = n; recRebuild(); }
function recToggleStraddle() { if (recActed()) { toast("アクション入力後は変更できません"); return; } REC.straddle = !REC.straddle; recRebuild(); }
function recSetHeroPos(pos) {
  // A: 席順があればヒーロー起点で卓サイズ+seatMapを自動割当(不可なら従来=手動)
  if (!recApplySeating(pos)) REC.heroPos = pos;
  renderApp();
}

async function recPickHeroCards() {
  const used = recUsedCards(REC.heroCards || []);
  const c = await pickCards(2, used, "ヒーローのハンド", []);
  if (c) { REC.heroCards = c; renderApp(); }
}
function recUsedCards(except) {
  const ex = new Set(except || []);
  const used = [];
  const b = REC.eng.board;
  const pb = REC.pendingBoard || {};
  for (const c of [...(REC.heroCards || []), ...(b.flop || []), b.turn, b.river, ...(pb.flop || []), pb.turn, pb.river])
    if (c && !ex.has(c)) used.push(c);
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
  if (status === "street_done") {
    // B: 先行入力済みボードがあればプロンプトを出さず自動消費
    if (!recConsumePending()) setTimeout(recBoardInput, 120);
  }
  else if (status === "hand_done_fold" || status === "hand_done_showdown") recEnterSettle();
}

/* B: street_done時、pendingBoardに該当ストリートのカードがあれば自動で nextStreet に消費 */
function recConsumePending() {
  const eng = REC.eng;
  const pb = REC.pendingBoard;
  if (!pb) return false;
  const next = eng.street === "preflop" ? "flop" : eng.street === "flop" ? "turn" : eng.street === "turn" ? "river" : null;
  if (!next) return false;
  let cards = null;
  if (next === "flop") { if (pb.flop && pb.flop.length === 3) { cards = pb.flop; pb.flop = null; } }
  else if (pb[next]) { cards = [pb[next]]; pb[next] = null; }
  if (!cards) return false;
  recAfterAct(eng.nextStreet(cards));
  return true;
}

/* B: 先行入力UI(常時表示のボード行)。engine投入済みは表示のみ(訂正不可)、未投入はタップで入力/訂正 */
function recPendingBoardCard() {
  if (!REC.pendingBoard) REC.pendingBoard = { flop: null, turn: null, river: null };
  const b = REC.eng.board, pb = REC.pendingBoard;
  const slot = (label, engCards, pending, street) => {
    const locked = engCards && engCards.length;
    const cards = locked ? engCards : pending;
    const inner = cards && cards.length ? cards.map(c => cardHTML(c)).join("") : `<span class="mut">${label}</span>`;
    return `<button class="btn sm" style="min-height:38px" ${locked ? "disabled" : `onclick="recPickPending('${street}')"`}>${inner}</button>`;
  };
  return `<div class="card"><div class="lbl">ボード先行入力(アクションと独立・タップで入力/訂正)</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${slot("フロップ", b.flop, pb.flop, "flop")}
      ${slot("ターン", b.turn ? [b.turn] : null, pb.turn ? [pb.turn] : null, "turn")}
      ${slot("リバー", b.river ? [b.river] : null, pb.river ? [pb.river] : null, "river")}
    </div></div>`;
}
async function recPickPending(street) {
  if (!REC.pendingBoard) REC.pendingBoard = { flop: null, turn: null, river: null };
  const pb = REC.pendingBoard;
  const n = street === "flop" ? 3 : 1;
  const except = street === "flop" ? (pb.flop || []) : (pb[street] ? [pb[street]] : []);
  const label = { flop: "フロップ", turn: "ターン", river: "リバー" }[street];
  const c = await pickCards(n, recUsedCards(except), label + "(先行入力)", []);
  if (!c) return;
  if (street === "flop") pb.flop = c; else pb[street] = c[0];
  renderApp();
  // 既にストリート完了で待機中なら即消費
  if (REC.phase === "action" && REC.eng.status() === "street_done") recConsumePending();
}

/* 精算画面へ。レーキ自動計算(ノーフロップ・ノードロップ: フロップ前終了は徴収なし) */
function recEnterSettle() {
  REC.phase = "settle";
  REC.layerWinners = null;
  REC.manualWin = false;
  if (REC.rakePct > 0 && REC.eng.board.flop) {
    const u = REC.eng.uncalled();
    // B3: 未コール分(返還されるベット)はレーキ対象外
    let r = Math.round((REC.eng.pot - (u ? u.amt : 0)) * REC.rakePct / 100);
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
  if (REC.phase === "settle") { REC.phase = "action"; REC.winners = []; REC.layerWinners = null; REC.manualWin = false; renderApp(); return; }
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
  // B2: 手動修正額は保持(明示的な「再計算」ボタンでのみ等分し直し)
  if (REC.manualWin) return;
  const u = REC.eng.uncalled();
  const rake = REC.rake || 0;
  const pots = computePots(REC.eng);
  if (pots.length <= 1) {
    // 単一ポット: レーキ・未コール控除後を等分。端数は最後の勝者に寄せて合計=potNetを保証
    const potNet = Math.max(0, REC.eng.pot - (u ? u.amt : 0) - rake);
    const k = REC.winners.length;
    if (!k) return;
    const share = Math.floor(potNet / k);
    REC.winners.forEach((w, i) => w.amt = i === k - 1 ? potNet - share * (k - 1) : share);
    return;
  }
  // B1: 複数層 — 層ごとに勝者(layerWinners)へ等分し、REC.winners は合算で構築。
  // レーキはメインポットから控除(超過分は次層へ)
  if (!REC.layerWinners || REC.layerWinners.length !== pots.length)
    REC.layerWinners = pots.map(p => REC.winners.map(w => w.pos).filter(x => p.eligible.includes(x)));
  let rakeLeft = rake;
  const totals = {};
  pots.forEach((p, i) => {
    const take = Math.min(rakeLeft, p.amt);
    rakeLeft -= take;
    const net = p.amt - take;
    const ws = (REC.layerWinners[i] || []).filter(x => p.eligible.includes(x));
    if (!ws.length || net <= 0) return; // 未指定層はUIで赤ハイライト(保存時に必須チェック)
    const share = Math.floor(net / ws.length);
    ws.forEach((pos, j) => totals[pos] = (totals[pos] || 0) + (j === ws.length - 1 ? net - share * (ws.length - 1) : share));
  });
  REC.winners = Object.keys(totals).map(pos => ({ pos, amt: totals[pos] }));
}
function recToggleWinner(pos) {
  const i = REC.winners.findIndex(w => w.pos === pos);
  if (i >= 0) REC.winners.splice(i, 1); else REC.winners.push({ pos, amt: 0 });
  REC.layerWinners = null; // 層既定(グローバル勝者∩eligible)を再構成
  // 勝者「集合」の変更は金額の個別編集(recEditWinAmt)とは別概念 — 手動額保持を解除して再分配
  // (レビュー指摘: 保持のままだと編集復元後のトグルで amt=0 勝者が黙って残り収支が壊れる)
  REC.manualWin = false;
  recRedistribute();
  renderApp();
}
function recToggleLayerWinner(li, pos) {
  if (!REC.layerWinners) return;
  const sel = REC.layerWinners[li] || (REC.layerWinners[li] = []);
  const i = sel.indexOf(pos);
  if (i >= 0) sel.splice(i, 1); else sel.push(pos);
  REC.manualWin = false;               // 同上: 集合変更は再分配を優先
  recRedistribute();
  renderApp();
}
async function recEditWinAmt(pos) {
  const w = REC.winners.find(x => x.pos === pos);
  if (!w) return;
  const v = await numpad({ title: `${pos} の獲得額`, init: w.amt });
  if (v != null) { w.amt = v; REC.manualWin = true; renderApp(); } // B2: 以後は手動額を保持
}
function recRecalcWinners() {
  REC.manualWin = false;
  recRedistribute();
  renderApp();
  toast("等分し直しました");
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
  // B1: サイドポットがある場合、勝者未指定の層があれば保存不可
  if (complete) {
    const pots = computePots(eng);
    if (pots.length > 1) {
      const lw = REC.layerWinners || [];
      if (!REC.manualWin) // 手動額指定時は層選択を強制しない(合計はユーザー責任)
        for (let i = 0; i < pots.length; i++)
          if (!(lw[i] || []).some(p => pots[i].eligible.includes(p))) {
            toast(`${i === 0 ? "メインポット" : "サイドポット" + i}の勝者を選んでください`); return false;
          }
    }
  }
  const u = eng.uncalled();
  // ヒーロー収支 = 獲得 + 未コール払戻 - 投入
  let heroNet = -eng.p[REC.heroPos].totalPut;
  for (const w of REC.winners) if (w.pos === REC.heroPos) heroNet += w.amt;
  if (u && u.pos === REC.heroPos) heroNet += u.amt;
  // ヒーローのショーダウン手は自動でshowsへ(ショーダウン到達時)
  const wentToShowdown = eng.status() === "hand_done_showdown" || Object.keys(REC.shows).length > 0;
  if (wentToShowdown && !eng.p[REC.heroPos].folded && REC.heroCards && complete)
    REC.shows[REC.heroPos] = REC.heroCards;
  const editing = REC.editing || null; // C: 後編集は同じidを上書き
  const hand = {
    id: editing ? editing.id : "LP" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    sessionId: REC.sessionId, ts: editing ? editing.ts : REC.ts,
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
    potTotal: Math.max(0, eng.pot - (u ? u.amt : 0)), // B7: GGのTotal pot慣習=未コール分を除く
    uncalled: u, wentToShowdown, complete: !!complete,
    heroNet, note: REC.note || "", tags: (REC.tags || []).slice()
  };
  if (editing) {
    hand.editedAt = Date.now();
    const ix = S.hands.findIndex(x => x.id === editing.id);
    if (ix >= 0) S.hands[ix] = hand; else S.hands.push(hand);
  } else {
    S.hands.push(hand);
  }
  // 同卓プレイヤーの対面記録を更新 + seatMap→rosterの自動push(維持)
  const sess = sessionById(REC.sessionId);
  for (const pid of Object.values(REC.seatMap)) {
    const p = playerById(pid);
    if (p) { p.lastSeenAt = Date.now(); p.seenCount = (p.seenCount || 0) + 1; }
    if (sess) {
      if (!sess.roster) sess.roster = [];
      if (!sess.roster.includes(pid)) sess.roster.push(pid);
    }
  }
  save();
  // 完了ハンドは自動でレビュー送信キューへ(reviewAuto ON時。§4-3)
  // C: 編集保存は旧レビューを破棄しforce付きで再投入(PC側はforce対応済み)
  if (hand.complete !== false && typeof reviewEnqueue === "function") {
    if (editing) { if (S.reviews) delete S.reviews[hand.id]; reviewEnqueue(hand.id, true); }
    else if (S.settings.reviewAuto) reviewEnqueue(hand.id);
  }
  toast(editing ? "ハンドを更新しました" : complete ? "ハンドを保存しました" : "途中保存しました(出力対象外)");
  REC = null;
  if (editing) go("handDetail", hand.id); else go("rec");
  return true;
}

function recSaveNext() {
  const sid = REC.sessionId;
  if (recSave(true)) startHand(sid);
}

/* C: ハンド後編集 — 保存済みhandからRECを復元してレコーダーを開く。
   録画時と同一エンジンで非autoアクションを順に再生(auto foldはエンジンが再生成)するため決定的。
   途中保存ハンドは同じ導線で「続きから記録」になる。 */
function editHand(hid) {
  const hd = handById(hid);
  if (!hd) return;
  const sess = sessionById(hd.sessionId);
  try {
    const eng = new HandEngine({
      tableSize: hd.tableSize, sb: hd.sb, bb: hd.bb, ante: hd.ante || 0,
      straddlePos: hd.straddlePos || null, stacks: { ...(hd.stacks || {}) }
    });
    const replay = acts => { for (const a of (acts || [])) if (!a.auto) eng.act(a.pos, a.act, a.amt); };
    const st = hd.streets || {};
    replay(st.preflop && st.preflop.acts);
    for (const key of ["flop", "turn", "river"]) {
      const sd = st[key];
      if (!sd) break;
      const cards = key === "flop" ? sd.cards : (sd.card ? [sd.card] : null);
      if (!cards || cards.filter(Boolean).length !== (key === "flop" ? 3 : 1)) break;
      if (eng.status() !== "street_done") throw new Error("replay不整合: " + key + "手前で " + eng.status());
      eng.nextStreet(cards);
      replay(sd.acts);
    }
    const status = eng.status();
    REC = {
      sessionId: hd.sessionId, ts: hd.ts,
      tableSize: hd.tableSize, sb: hd.sb, bb: hd.bb, ante: hd.ante || 0,
      straddle: !!hd.straddlePos,
      rakePct: (sess && sess.rakePct) || 0, rakeCap: (sess && sess.rakeCap) || 0,
      heroPos: hd.heroPos || null, heroCards: hd.heroCards ? hd.heroCards.slice() : null,
      seatMap: { ...(hd.seatMap || {}) },
      note: hd.note || "", tags: (hd.tags || []).slice(),
      shows: JSON.parse(JSON.stringify(hd.shows || {})),
      winners: (hd.winners || []).map(w => ({ pos: w.pos, amt: w.amt })),
      rake: hd.rake || 0,
      phase: (status === "hand_done_fold" || status === "hand_done_showdown") ? "settle" : "action",
      sel: null,
      pendingBoard: { flop: null, turn: null, river: null },
      layerWinners: null,
      manualWin: (hd.winners || []).length > 0, // 復元した獲得額を保持(「再計算」で等分し直し可)
      editing: { id: hd.id, ts: hd.ts },
      eng
    };
    go("hand");
  } catch (e) {
    console.warn("editHand replay失敗", e);
    toast("このハンドは再編集できません(録り直しを推奨)");
  }
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

  // B: ボード先行入力(アクションと独立に配られた順で入力できる)
  h += recPendingBoardCard();

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
  const pots = computePots(eng);
  const potNet = Math.max(0, eng.pot - (u ? u.amt : 0) - (REC.rake || 0));
  let h = `<div class="card"><div class="lbl">精算 — ポット ${fmtMoney(eng.pot)}${u ? ` (未コール${fmtMoney(u.amt)}は${u.pos}へ返却)` : ""}</div>`;
  if (eng.status() === "playing")
    h += `<div class="note" style="color:#e0a13b">アクション未完了のまま精算: 係争中のベットは返還扱いになります</div>`;
  if (pots.length <= 1) {
    h += `<div class="lbl">勝者(タップで選択・金額タップで修正)</div><div class="chips">`;
    for (const pos of act) {
      const w = REC.winners.find(x => x.pos === pos);
      h += `<button class="chip big ${w ? "on" : ""}" onclick="recToggleWinner('${pos}')">${pos}${pos === REC.heroPos ? "★" : ""}</button>`;
      if (w) h += `<button class="chip" onclick="recEditWinAmt('${pos}')">${fmtMoney(w.amt)}</button>`;
    }
    h += `</div>`;
  } else {
    // B1: サイドポットあり — 層ごとに勝者を選択(既定=グローバル勝者∩eligible)
    if (!REC.layerWinners || REC.layerWinners.length !== pots.length)
      REC.layerWinners = pots.map(p => REC.winners.map(w => w.pos).filter(x => p.eligible.includes(x)));
    pots.forEach((p, i) => {
      const sel = REC.layerWinners[i] || [];
      const need = !sel.some(x => p.eligible.includes(x));
      h += `<div class="lbl" style="margin-top:8px${need ? ";color:var(--red)" : ""}">${i === 0 ? "メインポット" : "サイドポット" + i} ${fmtMoney(p.amt)}${need ? " — 勝者を選んでください" : ""}</div><div class="chips">`;
      for (const pos of p.eligible)
        h += `<button class="chip big ${sel.includes(pos) ? "on" : ""}"${need ? ' style="border-color:var(--red)"' : ""} onclick="recToggleLayerWinner(${i},'${pos}')">${pos}${pos === REC.heroPos ? "★" : ""}</button>`;
      h += `</div>`;
    });
    if (REC.winners.length) {
      h += `<div class="lbl" style="margin-top:8px">獲得合計(金額タップで手動修正)</div><div class="chips">`;
      for (const w of REC.winners)
        h += `<button class="chip" onclick="recEditWinAmt('${w.pos}')">${w.pos} ${fmtMoney(w.amt)}</button>`;
      h += `</div>`;
    }
  }
  if (REC.manualWin)
    h += `<div class="note" style="color:#e0a13b">手動額を保持しています(勝者・レーキを変えても再分配しません)</div>
      <button class="btn sm" style="margin-top:6px" onclick="recRecalcWinners()">再計算(等分し直し)</button>`;
  h += `<button class="btn sm" style="margin-top:8px" onclick="recEditRake()">レーキ: ${fmtMoney(REC.rake || 0)}${REC.rakePct > 0 ? ` (${REC.rakePct}%自動・タップで修正)` : ""}</button>
    <div class="note">分配額はレーキ・未コール分を引いた ${fmtMoney(potNet)} を${pots.length > 1 ? "ポット層ごとに" : ""}等分(タップで個別修正可)</div>
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

/* NEMESIS LIVE — 集計エンジン
   セッション系(正確)とハンド系(記録HHのみ=選択バイアスあり)を分けて算出する。 */
"use strict";

/* ---- 期間フィルタ ---- */
const PERIODS = [
  { key: "today", label: "今日" }, { key: "7d", label: "7日" }, { key: "30d", label: "30日" },
  { key: "year", label: "今年" }, { key: "all", label: "全期間" }
];
function periodRange(key) {
  const now = Date.now();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  if (key === "today") return [d0.getTime(), now];
  if (key === "7d") return [now - 7 * 864e5, now];
  if (key === "30d") return [now - 30 * 864e5, now];
  if (key === "year") { const y = new Date(d0.getFullYear(), 0, 1); return [y.getTime(), now]; }
  return [0, now];
}

/* ---- セッション集計 ---- */
function sessionStats(sessions) {
  const done = sessions.filter(s => s.endAt);
  let profit = 0, hours = 0, wins = 0, bbTotal = 0;
  let peak = 0, cum = 0, maxDD = 0;
  const sorted = done.slice().sort((a, b) => a.startAt - b.startAt);
  for (const s of sorted) {
    const p = sessionProfit(s);
    profit += p; hours += sessionHours(s);
    if (p > 0) wins++;
    if (s.bb) bbTotal += p / s.bb;
    cum += p; peak = Math.max(peak, cum); maxDD = Math.max(maxDD, peak - cum);
  }
  const hph = S.settings.handsPerHour || 25;
  return {
    n: done.length, profit, hours,
    hourly: hours > 0 ? profit / hours : null,
    bbPerH: hours > 0 ? bbTotal / hours : null,
    bbPer100: hours > 0 ? bbTotal / (hours * hph) * 100 : null,
    winRate: done.length ? wins / done.length * 100 : null,
    avg: done.length ? profit / done.length : null,
    maxDD
  };
}

function cumulativeSeries(sessions) {
  const done = sessions.filter(s => s.endAt).sort((a, b) => a.startAt - b.startAt);
  let cum = 0;
  return done.map(s => { cum += sessionProfit(s); return { t: s.startAt, v: cum, s }; });
}

function groupProfit(sessions, keyFn) {
  const m = new Map();
  for (const s of sessions.filter(x => x.endAt)) {
    const k = keyFn(s);
    if (!m.has(k)) m.set(k, { n: 0, profit: 0, hours: 0 });
    const g = m.get(k);
    g.n++; g.profit += sessionProfit(s); g.hours += sessionHours(s);
  }
  return m;
}

/* ---- ハンド集計 ----
   各ハンドの登場者(hero + seatMapで登録済みの相手)ごとに頻度カウントを積む。 */
function _newFreq() {
  return { hands: 0, vpip: 0, pfr: 0, b3_opp: 0, b3: 0, cbet_opp: 0, cbet: 0,
           fcb_opp: 0, fcb: 0, sawFlop: 0, wtsd: 0, wsd_n: 0, wsd_w: 0, wwsf: 0,
           pf_agg: 0, pf_pas: 0, af_b: 0, af_c: 0, af_f: 0, af_x: 0, af_r: 0 };
}

/* hand内の1プレイヤー(pos)の頻度を acc に加算 */
function _accumulate(acc, hand, pos) {
  const st = hand.streets;
  const pre = st.preflop.acts;
  acc.hands++;
  // --- preflop ---
  let raises = 0, vpip = false, pfr = false, b3opp = false, b3 = false;
  for (const a of pre) {
    if (a.pos === pos) {
      if (a.act === "call" || a.act === "bet" || a.act === "raise") vpip = true;
      if (a.act === "raise" || a.act === "bet") pfr = true;
      if (raises === 1) { b3opp = true; if (a.act === "raise") b3 = true; }
    }
    if (a.act === "raise" || a.act === "bet") raises++;
  }
  if (vpip) acc.vpip++;
  if (pfr) acc.pfr++;
  if (b3opp) { acc.b3_opp++; if (b3) acc.b3++; }
  // --- 最後のプリフロップアグレッサー ---
  let pfa = null;
  for (const a of pre) if (a.act === "raise" || a.act === "bet") pfa = a.pos;
  // フォールド済み判定ヘルパ
  const foldedPre = pre.some(a => a.pos === pos && a.act === "fold");
  // フロップ時点でアクティブか: フロップが配られ、preflopでfoldしていない
  const activeAtFlop = !!(st.flop && st.flop.cards && !foldedPre);
  if (activeAtFlop) acc.sawFlop++;
  // --- c-bet(フロップ) ---
  if (activeAtFlop && st.flop.acts) {
    if (pfa === pos) {
      // 自分の手番までにベットが入っていなければc-bet機会
      let betBefore = false, acted = false, didBet = false;
      for (const a of st.flop.acts) {
        if (a.pos === pos) { acted = true; didBet = (a.act === "bet"); break; }
        if (a.act === "bet" || a.act === "raise") { betBefore = true; break; }
      }
      if (acted && !betBefore) { acc.cbet_opp++; if (didBet) acc.cbet++; }
    } else if (pfa) {
      // fold to c-bet: pfaがフロップでベットし、その後に自分が行動
      let pfaBet = false;
      for (const a of st.flop.acts) {
        if (a.pos === pfa && a.act === "bet") { pfaBet = true; continue; }
        if (pfaBet && a.pos === pos) { acc.fcb_opp++; if (a.act === "fold") acc.fcb++; break; }
        if (pfaBet && (a.act === "raise")) break; // 間にレイズが入ったら純粋なfold-to-cbetでない
      }
    }
  }
  // --- ポストフロップAFq ---
  let foldedAt = foldedPre ? "preflop" : null;
  for (const skey of ["flop", "turn", "river"]) {
    const sd = st[skey];
    if (!sd || !sd.acts || foldedAt) break;
    for (const a of sd.acts) {
      if (a.pos !== pos) continue;
      if (a.act === "bet") acc.af_b++;
      else if (a.act === "raise") acc.af_r++;
      else if (a.act === "call") acc.af_c++;
      else if (a.act === "check") acc.af_x++;
      else if (a.act === "fold") { acc.af_f++; foldedAt = skey; }
    }
  }
  // --- ショーダウン系 ---
  const winners = hand.winners || [];
  const won = winners.some(w => w.pos === pos);
  const reachedSD = hand.wentToShowdown && !foldedAt;
  if (activeAtFlop) {
    if (reachedSD) { acc.wtsd++; acc.wsd_n++; if (won) acc.wsd_w++; }
    if (won) acc.wwsf++;
  }
}

function pct(num, den) { return den > 0 ? Math.round(num / den * 1000) / 10 : null; }

function freqReport(acc) {
  const afqDen = acc.af_b + acc.af_r + acc.af_c + acc.af_f;
  return {
    hands: acc.hands,
    vpip: pct(acc.vpip, acc.hands), pfr: pct(acc.pfr, acc.hands),
    bet3: pct(acc.b3, acc.b3_opp), bet3_n: acc.b3_opp,
    cbet: pct(acc.cbet, acc.cbet_opp), cbet_n: acc.cbet_opp,
    fcb: pct(acc.fcb, acc.fcb_opp), fcb_n: acc.fcb_opp,
    wtsd: pct(acc.wtsd, acc.sawFlop), wtsd_n: acc.sawFlop,
    wsd: pct(acc.wsd_w, acc.wsd_n), wsd_n: acc.wsd_n,
    wwsf: pct(acc.wwsf, acc.sawFlop),
    afq: pct(acc.af_b + acc.af_r, afqDen), afq_n: afqDen
  };
}

/* ヒーロー頻度(hands配列から) */
function heroFreq(hands) {
  const acc = _newFreq();
  for (const h of hands) if (h.heroPos) _accumulate(acc, h, h.heroPos);
  return freqReport(acc);
}

/* プレイヤー別頻度: pid → report */
function playerFreq(hands, pid) {
  const acc = _newFreq();
  const list = [];
  for (const h of hands) {
    const pos = Object.keys(h.seatMap || {}).find(k => h.seatMap[k] === pid);
    if (!pos) continue;
    _accumulate(acc, h, pos);
    list.push({ hand: h, pos });
  }
  return { report: freqReport(acc), appearances: list };
}

/* ポジション別ヒーロー収支 */
function heroByPosition(hands) {
  const m = new Map();
  for (const h of hands) {
    if (!h.heroPos) continue;
    if (!m.has(h.heroPos)) m.set(h.heroPos, { n: 0, net: 0 });
    const g = m.get(h.heroPos);
    g.n++; g.net += (h.heroNet || 0);
  }
  return m;
}

/* フィルタ済みハンド取得 */
function filterHands(opts) {
  opts = opts || {};
  let hs = S.hands.slice();
  if (opts.from != null) hs = hs.filter(h => h.ts >= opts.from && h.ts <= (opts.to || Date.now()));
  if (opts.venue) hs = hs.filter(h => { const s = sessionById(h.sessionId); return s && s.venue === opts.venue; });
  if (opts.playerId) hs = hs.filter(h => Object.values(h.seatMap || {}).includes(opts.playerId));
  if (opts.sessionId) hs = hs.filter(h => h.sessionId === opts.sessionId);
  return hs.sort((a, b) => b.ts - a.ts);
}

/* NEMESIS LIVE — GG PokerCraft互換HHテキスト生成
   C:\GTO\orchestration\hh_service.py のパーサーregexに準拠(DESIGN.md §3)。 */
"use strict";

function _sanitizeName(n) { return String(n || "").trim().replace(/\s+/g, "_") || "Player"; }

function _playerNameFor(hand, pos) {
  if (pos === hand.heroPos) return "Hero";
  const pid = hand.seatMap && hand.seatMap[pos];
  if (pid) { const p = playerById(pid); if (p) return _sanitizeName(p.name); }
  return "V_" + pos.replace("+", ""); // 未登録は匿名ポジション名
}

/* 座席: SB=1から時計回り。BTNは最終席(HUはSB=BTN=席1) */
function _seatOrder(size) {
  const all = POS_BY_SIZE[size];
  if (size === 2) return ["SB", "BB"];
  return ["SB", "BB"].concat(all.filter(p => p !== "SB" && p !== "BB"));
}

function _fmtAmt(v) {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

function _ts(ts) {
  const d = new Date(ts), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* 1ハンド → GG互換テキスト。不完全なハンド(ヒーローカード無し等)はnull */
function handToGG(hand) {
  if (!hand.heroCards || !hand.heroCards[0] || !hand.heroCards[1]) return null;
  const sess = sessionById(hand.sessionId);
  const venue = _sanitizeName((sess && sess.venue) || "Live").replace(/'/g, "");
  const size = hand.tableSize;
  const order = _seatOrder(size);
  const seatNo = {}; order.forEach((pos, i) => seatNo[pos] = i + 1);
  const btnPos = size === 2 ? "SB" : "BTN";
  const name = pos => _playerNameFor(hand, pos);
  const L = [];
  // BBアンティはGG形式どおりヘッダー ($sb/$bb($ante)) に載せる(hh_service._HEADのante欄で読まれる)
  const anteStr = hand.ante > 0 ? `($${_fmtAmt(hand.ante)})` : "";
  L.push(`Poker Hand #${hand.id}: Hold'em No Limit ($${_fmtAmt(hand.sb)}/$${_fmtAmt(hand.bb)}${anteStr}) - ${_ts(hand.ts)}`);
  L.push(`Table '${venue}' ${size}-max Seat #${seatNo[btnPos]} is the button`);
  for (const pos of order)
    L.push(`Seat ${seatNo[pos]}: ${name(pos)} ($${_fmtAmt((hand.stacks && hand.stacks[pos]) || 100 * hand.bb)} in chips)`);
  if (hand.ante > 0) L.push(`${name("BB")}: posts the ante $${_fmtAmt(hand.ante)}`);
  L.push(`${name("SB")}: posts small blind $${_fmtAmt(hand.sb)}`);
  L.push(`${name("BB")}: posts big blind $${_fmtAmt(hand.bb)}`);
  if (hand.straddlePos) L.push(`${name(hand.straddlePos)}: posts straddle $${_fmtAmt(hand.bb * 2)}`);
  L.push(`*** HOLE CARDS ***`);
  L.push(`Dealt to Hero [${hand.heroCards[0]} ${hand.heroCards[1]}]`);

  const writeActs = (acts, startBet) => {
    let curBet = startBet;
    for (const a of acts) {
      if (a.act === "fold") L.push(`${name(a.pos)}: folds`);
      else if (a.act === "check") L.push(`${name(a.pos)}: checks`);
      else if (a.act === "call") L.push(`${name(a.pos)}: calls $${_fmtAmt(a.amt || 0)}`);
      else if (a.act === "bet") { L.push(`${name(a.pos)}: bets $${_fmtAmt(a.amt)}`); curBet = a.amt; }
      else if (a.act === "raise") {
        const delta = Math.max(0, a.amt - curBet);
        L.push(`${name(a.pos)}: raises $${_fmtAmt(delta)} to $${_fmtAmt(a.amt)}`);
        curBet = a.amt;
      }
    }
  };
  const st = hand.streets;
  writeActs(st.preflop.acts, hand.straddlePos ? hand.bb * 2 : hand.bb);
  const b = [];
  if (st.flop && st.flop.cards) {
    b.push(...st.flop.cards);
    L.push(`*** FLOP *** [${st.flop.cards.join(" ")}]`);
    writeActs(st.flop.acts, 0);
  }
  if (st.turn && st.turn.card) {
    L.push(`*** TURN *** [${b.join(" ")}] [${st.turn.card}]`);
    b.push(st.turn.card);
    writeActs(st.turn.acts, 0);
  }
  if (st.river && st.river.card) {
    L.push(`*** RIVER *** [${b.join(" ")}] [${st.river.card}]`);
    b.push(st.river.card);
    writeActs(st.river.acts, 0);
  }
  if (hand.uncalled && hand.uncalled.amt > 0)
    L.push(`Uncalled bet ($${_fmtAmt(hand.uncalled.amt)}) returned to ${name(hand.uncalled.pos)}`);
  const shows = hand.shows || {};
  const showPos = Object.keys(shows).filter(p => shows[p] && shows[p][0] && shows[p][1]);
  if (showPos.length) {
    L.push(`*** SHOWDOWN ***`);
    for (const pos of showPos) L.push(`${name(pos)}: shows [${shows[pos][0]} ${shows[pos][1]}]`);
  }
  for (const w of (hand.winners || []))
    L.push(`${name(w.pos)} collected $${_fmtAmt(w.amt)} from pot`);
  L.push(`*** SUMMARY ***`);
  L.push(`Total pot $${_fmtAmt(hand.potTotal || 0)} | Rake $${_fmtAmt(hand.rake || 0)}`);
  if (b.length) L.push(`Board [${b.join(" ")}]`);
  return L.join("\n");
}

/* 期間内ハンド→テキスト連結。返り値 {text, count, skipped} */
function buildExport(fromTs, toTs, opts) {
  opts = opts || {};
  let hands = S.hands.filter(h => h.ts >= fromTs && h.ts <= toTs && h.complete !== false);
  if (opts.playerId) hands = hands.filter(h => Object.values(h.seatMap || {}).includes(opts.playerId));
  if (opts.venue) hands = hands.filter(h => { const s = sessionById(h.sessionId); return s && s.venue === opts.venue; });
  hands.sort((a, b) => a.ts - b.ts);
  const parts = [];
  let skipped = 0;
  for (const h of hands) {
    const t = handToGG(h);
    if (t) parts.push(t); else skipped++;
  }
  return { text: parts.join("\n\n") + (parts.length ? "\n" : ""), count: parts.length, skipped };
}

function exportFileName(fromTs, toTs) {
  const f = ts => { const d = new Date(ts), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`; };
  return `NEMESIS-LIVE_${f(fromTs)}-${f(toTs)}.txt`;
}

/* 共有シート(iOSで最良の導線: メール/OneDrive/AirDrop/Filesへ) */
async function shareHH(text, filename) {
  const file = new File([text], filename, { type: "text/plain" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return "shared"; }
    catch (e) { if (e.name === "AbortError") return "cancel"; }
  }
  downloadText(text, filename);
  return "downloaded";
}

function downloadText(text, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* メール下書き(添付不可のため本文貼付。iOSのmailto実効上限は約2,000字のため
   数ハンド分までに制限し、超える場合は共有シート(ファイル添付)を案内する) */
function mailtoHH(text, filename) {
  const to = S.settings.email || "";
  const subj = encodeURIComponent(`[NEMESIS LIVE] ${filename}`);
  if (text.length > 1800) return null;
  const body = encodeURIComponent(text);
  return `mailto:${to}?subject=${subj}&body=${body}`;
}

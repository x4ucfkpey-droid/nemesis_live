/* NEMESIS LIVE — GTOディープリンク生成
   記録ハンドをNEMESISナビゲーター(app.html)のディープリンクに変換する。
   ポジション写像はNEMESIS本体と同一基準(preflop_service.MAP96: 後ろの人数基準)。
   対応: 2人フロップのSRP/3bet/4betのみ(NEMESIS本体の制約と同じ)。 */
"use strict";

const MAP96 = { "UTG": "UTG", "UTG+1": "UTG", "UTG+2": "UTG", "LJ": "UTG", "HJ": "MP",
                "CO": "CO", "BTN": "BTN", "SB": "SB", "BB": "BB" };
const POST_ORDER6 = ["SB", "BB", "UTG", "MP", "CO", "BTN"]; // 早い(OOP)→遅い(IP)

/* hand → {url} または {reason}(非対応理由) */
function gtoLinkForHand(hand) {
  const st = hand.streets;
  if (!st.flop || !st.flop.cards) return { reason: "フロップ以降がない(ナビゲーターはポストフロップ専用)" };
  const pre = st.preflop.acts;
  const raises = pre.filter(a => a.act === "raise" || a.act === "bet").length;
  const kind = { 1: "SRP", 2: "3bet", 3: "4bet" }[raises];
  if (!kind) return { reason: raises === 0 ? "リンプポットは非対応" : "5bet+ポットは非対応" };
  // フロップ参加者(プリフロップで降りていない全員)
  const folded = new Set(pre.filter(a => a.act === "fold").map(a => a.pos));
  const active = POS_BY_SIZE[hand.tableSize].filter(p => !folded.has(p));
  if (active.length !== 2) return { reason: `${active.length}人フロップ(2人のみ対応)` };
  // 6max写像と役割
  const m0 = MAP96[active[0]], m1 = MAP96[active[1]];
  if (m0 === m1) return { reason: `${active[0]}と${active[1]}は同じ6max座席(${m0})に写像され区別不能` };
  const oop = POST_ORDER6.indexOf(m0) < POST_ORDER6.indexOf(m1) ? m0 : m1;
  const ip = oop === m0 ? m1 : m0;
  const mu = `${kind}_${oop}_${ip}`;
  // 実効スタック(bb)
  const stk = Math.round(Math.min(...active.map(p => (hand.stacks && hand.stacks[p]) || 100 * hand.bb)) / hand.bb);
  // hero
  let hero = "";
  if (hand.heroPos === active[0] || hand.heroPos === active[1])
    hero = MAP96[hand.heroPos] === ip ? "ip" : "oop";
  // ---- ライン構築(ポット進行を再現してベットpot%とレイズto(bb)を出す) ----
  const put = {};          // 現ストリートの投入額
  let pot = 0;
  const add = (pos, total) => { pot += total - (put[pos] || 0); put[pos] = total; };
  // ブラインド+アンティ(死に金はポットにのみ加算)
  if (hand.ante > 0) pot += hand.ante;
  add("SB", Math.min(hand.sb, (hand.stacks && hand.stacks.SB) || 1e18));
  add("BB", Math.min(hand.bb, (hand.stacks && hand.stacks.BB) || 1e18));
  if (hand.straddlePos) add(hand.straddlePos, hand.bb * 2);
  const streetLine = (acts, isPair) => {
    const toks = [];
    for (const a of acts) {
      const before = pot;
      if (a.act === "call") { pot += a.amt || 0; put[a.pos] = (put[a.pos] || 0) + (a.amt || 0); }
      else if (a.act === "bet" || a.act === "raise") add(a.pos, a.amt || 0);
      if (!isPair) continue; // プリフロップはポット進行のみ(ラインはフロップ以降)
      if (a.act === "check") toks.push("X");
      else if (a.act === "fold") toks.push("F");
      else if (a.act === "call") toks.push("C");
      else if (a.act === "bet") toks.push("B" + Math.max(1, Math.round((a.amt || 0) / before * 100)));
      else if (a.act === "raise") toks.push("R" + Math.round((a.amt || 0) / hand.bb * 10) / 10);
    }
    return toks;
  };
  streetLine(pre, false);                       // ポット進行のみ
  const resetStreet = () => { for (const k of Object.keys(put)) put[k] = 0; };
  const parts = [];
  resetStreet();
  parts.push(streetLine(st.flop.acts || [], true).join(","));
  if (st.turn && st.turn.card) { resetStreet(); parts.push(st.turn.card + ":" + streetLine(st.turn.acts || [], true).join(",")); }
  if (st.river && st.river.card) { resetStreet(); parts.push(st.river.card + ":" + streetLine(st.river.acts || [], true).join(",")); }
  const line = parts.filter(p => p && p !== ":").join("/");
  const base = (S.settings.nemesisUrl || "http://localhost:8000").replace(/\/+$/, "");
  const anteBB = hand.ante > 0 ? Math.round(hand.ante / hand.bb * 10) / 10 : 0;
  const url = `${base}/?dl=1&mu=${mu}&b=${st.flop.cards.join("")}&stk=${stk}` +
    (anteBB > 0 ? `&ante=${anteBB}` : "") +
    (hero ? `&hero=${hero}` : "") +
    (hand.heroCards ? `&hc=${hand.heroCards.join("")}` : "") +
    (line ? `&line=${encodeURIComponent(line)}` : "");
  return { url, mu, stk };
}

async function copyGtoLink(hid) {
  const r = gtoLinkForHand(handById(hid));
  if (!r.url) { toast(r.reason); return; }
  try { await navigator.clipboard.writeText(r.url); toast("リンクをコピーしました(PCのNEMESISで開けます)"); }
  catch (e) { prompt("コピーしてください:", r.url); }
}
function openGtoLink(hid) {
  const r = gtoLinkForHand(handById(hid));
  if (!r.url) { toast(r.reason); return; }
  window.open(r.url, "_blank");
}

/* NEMESIS LIVE — 画面群(ホーム/記録/プレイヤー/スタッツ/その他) */
"use strict";

/* ============ ホーム ============ */
function viewHome() {
  const st = sessionStats(S.sessions);
  const series = cumulativeSeries(S.sessions);
  const act = activeSession();
  let h = "";
  if (act) {
    h += `<div class="card hot" onclick="go('rec')">
      <div class="lbl">セッション進行中 — ${esc(act.venue || "")}</div>
      <div class="big">${fmtDur(Date.now() - act.startAt)} / ${handsOfSession(act.id).length}ハンド記録</div>
      <div class="mut" style="font-size:12px">タップして記録画面へ</div></div>`;
  } else {
    h += `<button class="btn primary cta" onclick="go('rec')">セッションを開始</button>`;
  }
  h += backupWarnCard();
  h += `<div class="card"><div class="lbl">バンクロール推移</div>${profitSVG(series, 340, 130)}</div>`;
  h += `<div class="kpi-grid">
    ${kpi("総収支", fmtMoney(st.profit, true), st.profit >= 0)}
    ${kpi("時給", st.hourly != null ? fmtMoney(st.hourly, true) + "/h" : "—", (st.hourly || 0) >= 0)}
    ${kpi("セッション", st.n + "回 / " + Math.round(st.hours) + "h")}
    ${kpi("勝率", st.winRate != null ? st.winRate.toFixed(0) + "%" : "—")}
  </div>`;
  const recent = S.sessions.filter(s => s.endAt).sort((a, b) => b.startAt - a.startAt).slice(0, 6);
  if (recent.length) {
    h += `<div class="card"><div class="lbl">最近のセッション</div>`;
    for (const s of recent) h += sessionRow(s);
    h += `</div>`;
  }
  if (!S.sessions.length) h += `<div class="card"><div class="note">まだ記録がありません。「セッションを開始」からライブセッションの収支とハンドを記録しましょう。記録したHHは「その他」タブからGG互換テキストで出力し、NEMESISで解析できます。</div></div>`;
  return h;
}
/* バックアップ督促: 未実施で20ハンド超、または前回から14日超 */
function backupWarnCard() {
  if (!S.hands.length && !S.sessions.length) return "";
  const last = S.settings.lastBackupAt || 0;
  const stale = last ? (Date.now() - last > 14 * 864e5) : (S.hands.length >= 20);
  if (!stale) return "";
  return `<div class="card" style="border-color:#7a5a20">
    <div class="lbl" style="color:#e0a13b">⚠ バックアップ推奨</div>
    <div class="note" style="margin-top:0">データは端末内のみに保存されています(iOSは容量圧迫時にサイトデータを消すことがあります)。
    ${last ? `最終バックアップから${Math.floor((Date.now() - last) / 864e5)}日経過。` : "まだ一度もバックアップしていません。"}</div>
    <button class="btn sm" style="margin-top:8px" onclick="doBackup()">今すぐバックアップ(共有)</button>
  </div>`;
}
function kpi(label, val, good) {
  return `<div class="card kpi"><div class="lbl">${label}</div><div class="big" style="${good === false ? "color:var(--red)" : good === true ? "color:#2f9e63" : ""}">${val}</div></div>`;
}
function sessionRow(s) {
  const p = sessionProfit(s);
  return `<button class="list-item" onclick="go('session','${s.id}')">
    <span>${fmtDate(s.startAt)} ${esc(s.venue || "")} <span class="mut">${s.sb}/${s.bb}</span></span>
    <span style="float:right;color:${p >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(p, true)}</span></button>`;
}

/* ============ 記録(セッション) ============ */
function viewRec() {
  const act = activeSession();
  if (!act) return viewSessionStart();
  const hands = handsOfSession(act.id).sort((a, b) => b.ts - a.ts);
  const buyTotal = act.buyins.reduce((a, b) => a + b.amt, 0);
  let h = `<div class="card">
    <div class="lbl">${esc(act.venue || "セッション")} — ${act.sb}/${act.bb}${act.ante ? `(${act.ante})` : ""} ${act.tableSize}max${act.rakePct ? ` · レーキ${act.rakePct}%${act.rakeCap ? ` cap${act.rakeCap}` : ""}` : ""}</div>
    <div class="big">${fmtDur(Date.now() - act.startAt)}</div>
    <div class="mut" style="font-size:12px;margin-top:4px">バイイン合計 ${fmtMoney(buyTotal)} (${act.bb ? Math.round(buyTotal / act.bb) : "—"}bb) / ${hands.length}ハンド記録</div>
    <div class="row2" style="margin-top:10px">
      <button class="btn" onclick="addBuyin()">追加バイイン</button>
      <button class="btn" onclick="buyinsSheet()">内訳・修正</button>
    </div>
    <div class="row2" style="margin-top:8px">
      <button class="btn" onclick="editExpense()">経費: ${fmtMoney(act.expense || 0)}</button>
      <button class="btn danger" onclick="endSession()">終了(精算)</button>
    </div>
    <button class="btn" style="width:100%;margin-top:8px" onclick="editCurStack()">現在スタック${act.curStack != null ? `: ${fmtMoney(act.curStack)}` : "を入力(暫定収支)"}</button>
    ${act.curStack != null ? (() => { const pv = act.curStack - buyTotal - (act.expense || 0); return `<div class="mut" style="font-size:12px;margin-top:6px">暫定収支(現在スタック基準): <b style="color:${pv >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(pv, true)}</b></div>`; })() : ""}
    </div>`;
  h += `<button class="btn primary cta" onclick="startHand('${act.id}')">＋ 新しいハンドを記録</button>`;
  h += seatingCard(act);
  h += rosterReadsCard(act);
  if (hands.length) {
    h += `<div class="card"><div class="lbl">このセッションのハンド</div>`;
    for (const hd of hands) h += handRow(hd);
    h += `</div>`;
  }
  h += `<div class="card"><div class="lbl">セッションメモ</div>
    <textarea class="inp" rows="2" onchange="activeSession().notes=this.value;save()" placeholder="卓の雰囲気・気分など">${esc(act.notes || "")}</textarea></div>`;
  return h;
}
function handRow(hd) {
  const cards = hd.heroCards ? cardHTML(hd.heroCards[0]) + cardHTML(hd.heroCards[1]) : "";
  const net = hd.heroNet || 0;
  return `<button class="list-item" onclick="go('handDetail','${hd.id}')">
    <span>${new Date(hd.ts).toTimeString().slice(0, 5)} <b>${hd.heroPos}</b> ${cards} ${hd.complete === false ? '<span class="mut">(途中)</span>' : ""}</span>
    <span style="float:right;color:${net >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(net, true)}</span></button>`;
}

const RAKE_PRESETS = [0, 3, 5, 10]; // よくあるポットレーキ%
function viewSessionStart() {
  const st = S.settings;
  const last = S.sessions.slice().sort((a, b) => b.startAt - a.startAt)[0];
  const dv = (last && last.venue) || st.defaultVenue || "";
  const dsb = (last && last.sb) || st.defaultSb, dbb = (last && last.bb) || st.defaultBb;
  const dbuy = (last && last.buyins && last.buyins[0] && last.buyins[0].amt) || dbb * 100;
  const dante = (last && last.ante) || 0;
  const drakePct = (last && last.rakePct) || 0, drakeCap = (last && last.rakeCap) || 0;
  const rakeCustom = !RAKE_PRESETS.includes(drakePct);
  return `<div class="card"><div class="lbl">セッション開始</div>
    <label class="f-lbl">会場</label>
    <input class="inp" id="ssVenue" list="venueList" value="${esc(dv)}" placeholder="例: AKIBA GUILD">
    <datalist id="venueList">${S.venues.map(v => `<option value="${esc(v)}">`).join("")}</datalist>
    <div class="row2">
      <div><label class="f-lbl">SB</label><input class="inp" id="ssSb" type="number" value="${dsb}"></div>
      <div><label class="f-lbl">BB</label><input class="inp" id="ssBb" type="number" value="${dbb}"></div>
    </div>
    <div class="row2">
      <div><label class="f-lbl">アンティ</label>
        <select class="inp" id="ssAnteMode" onchange="document.getElementById('ssAnteWrap').style.visibility=this.value==='bb'?'visible':'hidden'">
          <option value="none" ${dante ? "" : "selected"}>なし</option>
          <option value="bb" ${dante ? "selected" : ""}>BBアンティ</option>
        </select></div>
      <div id="ssAnteWrap" style="visibility:${dante ? "visible" : "hidden"}"><label class="f-lbl">アンティ額</label>
        <input class="inp" id="ssAnteAmt" type="number" value="${dante || dbb}"></div>
    </div>
    <div class="row2">
      <div><label class="f-lbl">レーキ</label>
        <select class="inp" id="ssRakePct" onchange="document.getElementById('ssRakeCustomWrap').style.display=this.value==='custom'?'':'none'">
          ${RAKE_PRESETS.map(p => `<option value="${p}" ${!rakeCustom && drakePct === p ? "selected" : ""}>${p === 0 ? "なし" : "ポット" + p + "%"}</option>`).join("")}
          <option value="custom" ${rakeCustom ? "selected" : ""}>カスタム%</option>
        </select></div>
      <div><label class="f-lbl">キャップ(0=なし)</label><input class="inp" id="ssRakeCap" type="number" value="${drakeCap}"></div>
    </div>
    <div id="ssRakeCustomWrap" style="${rakeCustom ? "" : "display:none"}">
      <label class="f-lbl">カスタムレーキ%</label>
      <input class="inp" id="ssRakeCustom" type="number" step="0.5" value="${rakeCustom ? drakePct : 5}">
    </div>
    <div class="row2">
      <div><label class="f-lbl">卓人数</label><select class="inp" id="ssSize">${[9, 8, 7, 6, 5, 4, 3, 2].map(n => `<option value="${n}" ${((last && last.tableSize) || 9) === n ? "selected" : ""}>${n}人</option>`).join("")}</select></div>
      <div><label class="f-lbl">バイイン(チップ額)</label><input class="inp" id="ssBuy" type="number" value="${dbuy}"></div>
    </div>
    <button class="btn primary" style="width:100%;margin-top:12px" onclick="doStartSession()">開始する</button>
  </div>`;
}
function doStartSession() {
  const venue = document.getElementById("ssVenue").value.trim();
  const sb = +document.getElementById("ssSb").value, bb = +document.getElementById("ssBb").value;
  const size = +document.getElementById("ssSize").value;
  const buy = +document.getElementById("ssBuy").value;
  if (!bb || bb <= 0) { toast("ブラインドを入力してください"); return; }
  const ante = document.getElementById("ssAnteMode").value === "bb" ? (+document.getElementById("ssAnteAmt").value || 0) : 0;
  const rpSel = document.getElementById("ssRakePct").value;
  const rakePct = rpSel === "custom" ? (+document.getElementById("ssRakeCustom").value || 0) : +rpSel;
  const rakeCap = +document.getElementById("ssRakeCap").value || 0;
  if (venue && !S.venues.includes(venue)) S.venues.push(venue);
  S.sessions.push({ id: uid("s"), startAt: Date.now(), endAt: null, venue, sb, bb, ante, rakePct, rakeCap,
    tableSize: size, buyins: buy > 0 ? [{ amt: buy, at: Date.now() }] : [], cashout: null, notes: "", roster: [],
    seating: ["HERO"], sitout: {}, curStack: null });
  save(); renderApp();
}
async function addBuyin() {
  const act = activeSession(); if (!act) return;
  // 追加バイインはチップ額で入力(クイックはbb換算の目安)
  const v = await numpad({ title: "追加バイイン(チップ額)", quick: [{ label: "50bb", amt: act.bb * 50 }, { label: "100bb", amt: act.bb * 100 }, { label: "150bb", amt: act.bb * 150 }] });
  if (v) { act.buyins.push({ amt: v, at: Date.now() }); save(); renderApp(); toast(`${fmtMoney(v)} 追加しました`); }
}

/* バイイン内訳の閲覧・修正・取り消し */
function buyinsSheet() {
  const act = activeSession(); if (!act) return;
  const rows = act.buyins.map((b, i) =>
    `<div class="sd-row"><span style="flex:1">${fmtDateTime(b.at)}</span>
      <button class="btn sm" onclick="buyinEdit(${i})">${fmtMoney(b.amt)}</button>
      <button class="btn sm danger" onclick="buyinDel(${i})">✕</button></div>`).join("");
  const total = act.buyins.reduce((a, b) => a + b.amt, 0);
  openSheet(`<div class="sh-title">バイイン内訳 — 合計 ${fmtMoney(total)}</div>
    ${rows || '<div class="note">バイインがありません</div>'}
    <div class="note">金額タップで修正・✕で取り消し</div>
    <button class="btn" style="width:100%;margin-top:10px" onclick="closeSheet(null)">閉じる</button>`);
}
async function buyinEdit(i) {
  const act = activeSession(); if (!act) return;
  closeSheet(null);
  const v = await numpad({ title: "バイイン修正(チップ額)", init: act.buyins[i].amt });
  if (v != null && v > 0) { act.buyins[i].amt = v; save(); }
  renderApp(); buyinsSheet();
}
function buyinDel(i) {
  const act = activeSession(); if (!act) return;
  act.buyins.splice(i, 1); save(); renderApp(); buyinsSheet();
}
/* ---- A: 同卓メンバー(席順・時計回り)パネル ---- */
function seatingCard(sess) {
  if (!Array.isArray(sess.seating)) sess.seating = ["HERO"];
  if (!sess.seating.includes("HERO")) sess.seating.unshift("HERO");
  if (!sess.sitout) sess.sitout = {};
  const so = sess.sitout;
  const rows = sess.seating.map((e, i) => {
    const isHero = e === "HERO";
    const p = isHero ? null : playerById(e);
    const name = isHero ? "ヒーロー(自分)" : (p ? p.name : "(削除済みプレイヤー)");
    const out = !isHero && so[e];
    return `<div class="sd-row" style="${out ? "opacity:.4" : ""}">
      <button class="btn sm" onclick="seatingMove('${sess.id}',${i},-1)" ${i === 0 ? "disabled" : ""}>↑</button>
      <button class="btn sm" onclick="seatingMove('${sess.id}',${i},1)" ${i === sess.seating.length - 1 ? "disabled" : ""}>↓</button>
      <button style="flex:1;text-align:left;border:0;background:transparent;color:${isHero ? "var(--red)" : "var(--ink)"};font-family:inherit;font-size:14px;padding:6px 2px" ${isHero ? "disabled" : `onclick="seatingToggleSit('${sess.id}',${i})"`}>${isHero ? "★ " : ""}${esc(name)}${out ? ' <span class="mut">(離席)</span>' : ""}</button>
      ${isHero ? "" : `<button class="btn sm danger" onclick="seatingRemove('${sess.id}',${i})">✕</button>`}
    </div>`;
  }).join("");
  const active = sess.seating.filter(e => e === "HERO" || !so[e]).length;
  return `<div class="card"><div class="lbl">同卓メンバー(席順・時計回り) — 着席${active}人</div>
    ${rows}
    <button class="btn" style="width:100%;margin-top:8px" onclick="seatingAdd('${sess.id}')">＋ メンバー追加</button>
    <div class="note">名前タップ=離席⇔着席。↑↓で席順(時計回り)を調整。ハンド記録でヒーローのポジションを選ぶと、着席人数から卓サイズと全員のポジションを自動割当します(2人未満のときは従来の手動割当)。</div>
  </div>`;
}
async function seatingAdd(sid) {
  const sess = sessionById(sid); if (!sess) return;
  if (!Array.isArray(sess.seating)) sess.seating = ["HERO"];
  const seated = new Set(sess.seating);
  const roster = (sess.roster || []).filter(pid => !seated.has(pid)).map(playerById).filter(Boolean);
  const others = S.players.filter(p => !seated.has(p.id) && !(sess.roster || []).includes(p.id))
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0)).slice(0, 20);
  const item = p => `<button class="list-item" onclick="closeSheet('${p.id}')">${esc(p.name)}<span class="mut" style="float:right">${p.lastSeenAt ? fmtDate(p.lastSeenAt) : ""}</span></button>`;
  const r = await openSheet(`
    <div class="sh-title">メンバー追加(席順の末尾に入ります)</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input id="stNew" class="inp" placeholder="新規プレイヤー名" style="flex:1">
      <button class="btn primary" onclick="closeSheet('__new__')">追加</button>
    </div>
    ${roster.length ? `<div class="lbl">今日の同卓者</div>` + roster.map(item).join("") : ""}
    ${others.length ? `<div class="lbl">最近のプレイヤー</div>` + others.map(item).join("") : ""}`);
  if (!r) return;
  let pid = r;
  if (r === "__new__") {
    const el = document.getElementById("stNew");
    const name = el && el.value.trim();
    if (!name) return;
    pid = addPlayer(name, sess.venue);
  }
  if (!sess.seating.includes(pid)) sess.seating.push(pid);
  if (!sess.roster) sess.roster = [];
  if (!sess.roster.includes(pid)) sess.roster.push(pid);
  save(); renderApp();
}
function seatingMove(sid, i, dir) {
  const sess = sessionById(sid); if (!sess || !sess.seating) return;
  const j = i + dir;
  if (j < 0 || j >= sess.seating.length) return;
  const t = sess.seating[i]; sess.seating[i] = sess.seating[j]; sess.seating[j] = t;
  save(); renderApp();
}
function seatingToggleSit(sid, i) {
  const sess = sessionById(sid); if (!sess || !sess.seating) return;
  const e = sess.seating[i];
  if (!e || e === "HERO") return;
  if (!sess.sitout) sess.sitout = {};
  if (sess.sitout[e]) delete sess.sitout[e]; else sess.sitout[e] = true;
  save(); renderApp();
}
function seatingRemove(sid, i) {
  const sess = sessionById(sid); if (!sess || !sess.seating) return;
  if (sess.seating[i] === "HERO") return;
  const pid = sess.seating.splice(i, 1)[0];
  if (sess.sitout) delete sess.sitout[pid];
  save(); renderApp();
}

/* E: ライブ中の暫定収支確認用の現在スタック入力(任意) */
async function editCurStack() {
  const act = activeSession(); if (!act) return;
  const v = await numpad({ title: "現在スタック(暫定収支の確認用)", init: act.curStack != null ? act.curStack : "", quick: [{ label: "100bb", amt: act.bb * 100 }, { label: "150bb", amt: act.bb * 150 }, { label: "200bb", amt: act.bb * 200 }] });
  if (v != null) { act.curStack = v; save(); renderApp(); }
}

/* 同卓者のトップリードを卓上で即参照(n>=4のプレイヤーのみ)。
   rosterに加え、このセッションのハンドに登場した相手も自動収集する */
function rosterReadsCard(act) {
  const pids = new Set(act.roster || []);
  for (const hd of handsOfSession(act.id))
    for (const pid of Object.values(hd.seatMap || {})) pids.add(pid);
  const items = [];
  for (const pid of pids) {
    const p = playerById(pid);
    if (!p) continue;
    const { report } = playerFreq(S.hands, pid);
    const reads = playerReads(report);
    if (!reads.length) continue;
    items.push({ p, top: reads[0], type: autoPlayerType(report) });
  }
  if (!items.length) return "";
  let h = `<div class="card"><div class="lbl">同卓者リード(実測・タップで詳細)</div>`;
  for (const it of items.slice(0, 8))
    h += `<button class="list-item" onclick="go('player','${it.p.id}')">
      <span><b>${esc(it.p.name)}</b>${it.type ? ` <span class="chip on ro" style="font-size:10px;padding:1px 7px">${it.type}</span>` : ""}<br>
      <span class="mut" style="font-size:11px">${esc(it.top.leak)} → ${esc(it.top.exploit.slice(0, 28))}…</span></span></button>`;
  h += `</div>`;
  return h;
}

async function editExpense() {
  const act = activeSession(); if (!act) return;
  const v = await numpad({ title: "経費(時間チャージ・ドリンク等)", init: act.expense || 0, quick: [{ label: "なし", amt: 0 }] });
  if (v != null) { act.expense = v; save(); renderApp(); }
}

async function endSession() {
  const act = activeSession(); if (!act) return;
  const v = await numpad({ title: "終了スタック(cash-out)", quick: [{ label: "0", amt: 0 }] });
  if (v == null) return;
  act.cashout = v; act.endAt = Date.now();
  save();
  const p = sessionProfit(act);
  toast(`お疲れさまでした ${fmtMoney(p, true)}`);
  go("home");
}

/* ============ セッション詳細 ============ */
function viewSession(sid) {
  const s = sessionById(sid);
  if (!s) return backBar("home") + `<div class="mut">見つかりません(削除済み)</div>`;
  const p = sessionProfit(s);
  const hands = handsOfSession(sid).sort((a, b) => b.ts - a.ts);
  const hrs = sessionHours(s);
  let h = backBar("home");
  h += `<div class="card">
    <div class="lbl">${fmtDateTime(s.startAt)} — ${esc(s.venue || "")}</div>
    <div class="big" style="color:${p >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(p, true)}</div>
    <div class="mut" style="font-size:12px;margin-top:4px">${s.sb}/${s.bb} · ${fmtDur((s.endAt || Date.now()) - s.startAt)} · ${hrs > 0 ? fmtMoney(p / hrs, true) + "/h" : ""} · バイイン${fmtMoney(s.buyins.reduce((a, b) => a + b.amt, 0))} → ${fmtMoney(s.cashout)}${s.expense ? ` · 経費${fmtMoney(s.expense)}` : ""}
      <button class="btn sm" style="margin-left:6px" onclick="sessExpense('${s.id}')">経費修正</button></div>
    ${hands.length ? (() => { const hn = hands.reduce((a, h2) => a + (h2.heroNet || 0), 0); return `<div class="mut" style="font-size:12px;margin-top:4px">記録ハンド収支合計 <b style="color:${hn >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(hn, true)}</b> <span style="font-size:11px">(参考値。セッション収支との差=未記録ハンド分)</span></div>`; })() : ""}
    ${s.notes ? `<div class="note">${esc(s.notes)}</div>` : ""}
    <button class="btn sm danger" style="margin-top:10px" onclick="delSession('${s.id}')">セッション削除</button>
  </div>`;
  if (hands.length) {
    h += `<div class="card"><div class="lbl">ハンド(${hands.length})</div>`;
    for (const hd of hands) h += handRow(hd);
    h += `</div>`;
  }
  return h;
}
async function sessExpense(sid) {
  const s = sessionById(sid); if (!s) return;
  const v = await numpad({ title: "経費(時間チャージ・ドリンク等)", init: s.expense || 0, quick: [{ label: "なし", amt: 0 }] });
  if (v != null) { s.expense = v; save(); renderApp(); }
}
async function delSession(sid) {
  if (!(await confirmDlg("セッションと記録ハンドを削除しますか?", "削除"))) return;
  S.sessions = S.sessions.filter(s => s.id !== sid);
  S.hands = S.hands.filter(h => h.sessionId !== sid);
  save(); go("home");
}

/* ============ ハンド詳細 ============ */
function viewHandDetail(hid) {
  const hd = handById(hid);
  if (!hd) return backBar("rec") + `<div class="mut">見つかりません(削除済み)</div>`;
  const gg = handToGG(hd);
  let h = backBar("rec");
  h += `<div class="card">
    <div class="lbl">${fmtDateTime(hd.ts)} — ${hd.heroPos} ${hd.heroCards ? cardHTML(hd.heroCards[0], true) + cardHTML(hd.heroCards[1], true) : ""}</div>
    <div class="big" style="color:${(hd.heroNet || 0) >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(hd.heroNet, true)}</div>
    ${hd.note ? `<div class="note">${esc(hd.note)}</div>` : ""}
    <div class="chips sm" style="margin-top:8px">${HAND_TAGS.map((t, i) => `<button class="chip ${(hd.tags || []).includes(t) ? "on" : ""}" onclick="hdToggleTag('${hd.id}',${i})">${t}</button>`).join("")}</div>
    <button class="btn" style="width:100%;margin-top:10px" onclick="editHand('${hd.id}')">${hd.complete === false ? "続きから記録(編集)" : "このハンドを編集"}</button>
    ${hd.editedAt ? `<div class="mut" style="font-size:11px;margin-top:4px">編集済み: ${fmtDateTime(hd.editedAt)}</div>` : ""}
  </div>`;
  // 日本語リプレイ(handview.js)。GG形式テキストより上に既定表示
  h += handReplayHTML(hd);
  // GTOディープリンク(NEMESISナビゲーターで局面再現)
  const gl = gtoLinkForHand(hd);
  if (gl.url) {
    h += `<div class="card"><div class="lbl">NEMESIS<span style="color:var(--red)">.</span> で局面を再現</div>
      <div class="mut" style="font-size:12px;margin-bottom:8px">${gl.mu}・${gl.stk}bb — ソルバーで実ラインを自動再生します</div>
      <div class="row2">
        <button class="btn primary" onclick="openGtoLink('${hd.id}')">開く</button>
        <button class="btn" onclick="copyGtoLink('${hd.id}')">リンクをコピー</button>
      </div>
      <div class="note">PCでNEMESISサーバー(port 8000)を起動しておくこと。iPhoneからは設定のNEMESIS URLをPCのLANアドレス(例: http://192.168.1.10:8000)にすると同一Wi-Fiで開けます。</div></div>`;
  } else {
    h += `<div class="card"><div class="lbl">NEMESIS<span style="color:var(--red)">.</span> で局面を再現</div>
      <div class="note">この局面は非対応: ${esc(gl.reason)}</div></div>`;
  }
  if (gg) {
    const open = !!_ggOpen[hd.id];
    h += `<div class="card" style="padding:9px">
      <button class="btn sm" style="width:100%;text-align:left" onclick="ggToggle('${hd.id}')">${open ? "▼" : "▶"} GG形式テキストを${open ? "隠す" : "表示"}</button>
      ${open ? `<pre class="hh-pre" style="margin-top:9px">${esc(gg)}</pre>
        <button class="btn sm" onclick="shareHH(handToGG(handById('${hd.id}')), '${hd.id}.txt')">このハンドを共有</button>` : ""}
    </div>`;
  } else h += `<div class="card"><div class="note">途中保存のハンドです(GG出力対象外)。</div></div>`;
  h += `<div class="card"><button class="btn danger" style="width:100%" onclick="delHand('${hd.id}')">このハンドを削除</button></div>`;
  return h;
}
function hdToggleTag(hid, i) {
  const hd = handById(hid); if (!hd) return;
  hd.tags = hd.tags || [];
  const t = HAND_TAGS[i], ix = hd.tags.indexOf(t);
  if (ix >= 0) hd.tags.splice(ix, 1); else hd.tags.push(t);
  save(); renderApp();
}
async function delHand(hid) {
  if (!(await confirmDlg("このハンドを削除しますか?", "削除"))) return;
  S.hands = S.hands.filter(h => h.id !== hid);
  save(); go("rec");
}

/* ============ プレイヤー ============ */
const PL_FLT = { q: "", look: [], type: [], venue: null };
function addPlayer(name, venue) {
  const p = { id: uid("p"), name, venues: venue ? [venue] : [], type: [], look: [], notes: "", createdAt: Date.now(), lastSeenAt: Date.now(), seenCount: 0 };
  S.players.push(p); save();
  return p.id;
}
function viewPlayers() {
  let list = S.players.slice();
  if (PL_FLT.q) { const q = PL_FLT.q.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q) || (p.notes || "").toLowerCase().includes(q)); }
  for (const t of PL_FLT.look) list = list.filter(p => (p.look || []).includes(t));
  for (const t of PL_FLT.type) list = list.filter(p => (p.type || []).includes(t));
  if (PL_FLT.venue) list = list.filter(p => (p.venues || []).includes(PL_FLT.venue));
  list.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  let h = `<div class="card">
    <div style="display:flex;gap:8px">
      <input class="inp" placeholder="名前・メモで検索" value="${esc(PL_FLT.q)}" oninput="PL_FLT.q=this.value;renderApp()" style="flex:1">
      <button class="btn primary" onclick="editPlayer(null)">＋新規</button>
    </div>
    <div class="lbl" style="margin-top:10px">外見で絞り込み(対面時の想起用)</div>
    ${chipRow(LOOK_TAGS, PL_FLT.look, "plToggleLook", "sm")}
    <div class="lbl" style="margin-top:6px">タイプ</div>
    ${chipRow(TYPE_TAGS, PL_FLT.type, "plToggleType", "sm")}
    ${S.venues.length ? `<div class="lbl" style="margin-top:6px">会場</div><div class="chips sm">${S.venues.map((v, i) => `<button class="chip ${PL_FLT.venue === v ? "on" : ""}" onclick="plSetVenue(${i})">${esc(v)}</button>`).join("")}</div>` : ""}
  </div>`;
  h += `<div class="card"><div class="lbl">${list.length}人</div>`;
  for (const p of list) {
    const tags = [...(p.type || []).slice(0, 2), ...(p.look || []).slice(0, 3)].join("・");
    h += `<button class="list-item" onclick="go('player','${p.id}')">
      <span><b>${esc(p.name)}</b> <span class="mut" style="font-size:11px">${esc(tags)}</span></span>
      <span style="float:right" class="mut">${p.lastSeenAt ? fmtDate(p.lastSeenAt) : ""}</span></button>`;
  }
  if (!list.length) h += `<div class="note">該当なし。ハンド記録中に座席へ割り当てるか「＋新規」で登録できます。</div>`;
  h += `</div>`;
  return h;
}
function plToggleLook(t) { const i = PL_FLT.look.indexOf(t); if (i >= 0) PL_FLT.look.splice(i, 1); else PL_FLT.look.push(t); renderApp(); }
function plToggleType(t) { const i = PL_FLT.type.indexOf(t); if (i >= 0) PL_FLT.type.splice(i, 1); else PL_FLT.type.push(t); renderApp(); }
function plSetVenue(i) { const v = S.venues[i]; PL_FLT.venue = PL_FLT.venue === v ? null : v; renderApp(); }

function viewPlayer(pid) {
  const p = playerById(pid);
  if (!p) return backBar("players") + `<div class="mut">見つかりません(削除済み)</div>`;
  const { report, appearances } = playerFreq(S.hands, pid);
  let h = backBar("players");
  h += `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="big">${esc(p.name)}</div>
      <button class="btn sm" onclick="editPlayer('${p.id}')">編集</button>
    </div>
    <div class="chips sm" style="margin-top:6px">${[...(p.type || []), ...(p.look || [])].map(t => `<span class="chip on ro">${esc(t)}</span>`).join("")}</div>
    <div class="mut" style="font-size:12px;margin-top:6px">${(p.venues || []).map(esc).join("・")} · 対面${p.seenCount || 0}ハンド · 最終 ${p.lastSeenAt ? fmtDate(p.lastSeenAt) : "—"}</div>
    ${p.notes ? `<div class="note">${esc(p.notes)}</div>` : ""}
  </div>`;
  // エクスプロイト・リード(この相手のリーク→突き方)
  const reads = playerReads(report);
  const autoType = autoPlayerType(report);
  h += `<div class="card"><div class="lbl">エクスプロイト・リード ${autoType ? `<span class="chip on ro" style="float:right;font-size:11px;padding:2px 9px">推定: ${autoType}</span>` : ""}</div>`;
  if (reads.length) {
    const dot = s => s >= 3 ? "var(--red)" : s >= 2 ? "#e0a13b" : "var(--mut)";
    for (const rd of reads) {
      h += `<div class="read-row">
        <div class="read-head"><span class="read-dot" style="background:${dot(rd.sev)}"></span><b>${esc(rd.leak)}</b>
          <span class="read-conf">${rd.conf}·n${rd.n}</span></div>
        <div class="read-ex">${esc(rd.exploit)}</div></div>`;
    }
    h += `<div class="note">頻度からの自動リード。信頼度=標本数の目安(参考&lt;12≤暫定&lt;30≤有効)。ライブは標本が小さいため過信しないこと。</div>`;
  } else {
    h += `<div class="note">まだリードを出すデータが足りません(各指標n≥4で表示)。この相手との記録が増えると自動で出ます。</div>`;
  }
  h += `</div>`;
  h += `<div class="card"><div class="lbl">実測スタッツ(記録ハンドより・n=${report.hands})</div>${freqTable(report)}
    <div class="note">記録したハンドのみの集計(選択バイアスあり)。目安として利用。</div></div>`;
  if (appearances.length) {
    h += `<div class="card"><div class="lbl">対戦ハンド</div>`;
    for (const a of appearances.sort((x, y) => y.hand.ts - x.hand.ts).slice(0, 30)) {
      const shown = a.hand.shows && a.hand.shows[a.pos];
      h += `<button class="list-item" onclick="go('handDetail','${a.hand.id}')">
        <span>${fmtDate(a.hand.ts)} <b>${a.pos}</b> ${shown ? cardHTML(shown[0]) + cardHTML(shown[1]) : '<span class="mut">非公開</span>'}</span>
        <span style="float:right" class="mut">vs ${a.hand.heroPos}</span></button>`;
    }
    h += `</div>`;
  }
  return h;
}

let _plEdit = null;
function editPlayer(pid) {
  // 新規はアクティブセッションの会場をデフォルト付与
  const act = activeSession();
  _plEdit = pid ? JSON.parse(JSON.stringify(playerById(pid)))
    : { id: null, name: "", venues: act && act.venue ? [act.venue] : [], type: [], look: [], notes: "" };
  go("playerEdit", pid);
}
function viewPlayerEdit() {
  const p = _plEdit;
  if (!p) return "";
  return `${backBar(p.id ? "player" : "players", p.id)}
  <div class="card">
    <label class="f-lbl">名前(ポーカーネーム)</label>
    <input class="inp" value="${esc(p.name)}" oninput="_plEdit.name=this.value">
    <label class="f-lbl">外見タグ(次回対面時に思い出すための特徴)</label>
    ${chipRow(LOOK_TAGS, p.look, "peToggleLook")}
    <label class="f-lbl">プレイタイプ</label>
    ${chipRow(TYPE_TAGS, p.type, "peToggleType")}
    <label class="f-lbl">会場</label>
    <div class="chips">${S.venues.map((v, i) => `<button class="chip ${p.venues.includes(v) ? "on" : ""}" onclick="peToggleVenueIdx(${i})">${esc(v)}</button>`).join("")}</div>
    <label class="f-lbl">メモ(癖・テル・注目ハンドなど)</label>
    <textarea class="inp" rows="3" oninput="_plEdit.notes=this.value">${esc(p.notes || "")}</textarea>
    <div class="row2" style="margin-top:12px">
      ${p.id ? `<button class="btn danger" onclick="delPlayer('${p.id}')">削除</button>` : `<button class="btn" onclick="go('players')">キャンセル</button>`}
      <button class="btn primary" onclick="savePlayer()">保存</button>
    </div>
  </div>`;
}
function peToggleLook(t) { const a = _plEdit.look; const i = a.indexOf(t); if (i >= 0) a.splice(i, 1); else a.push(t); renderApp(); }
function peToggleType(t) { const a = _plEdit.type; const i = a.indexOf(t); if (i >= 0) a.splice(i, 1); else a.push(t); renderApp(); }
function peToggleVenueIdx(idx) { const t = S.venues[idx]; const a = _plEdit.venues; const i = a.indexOf(t); if (i >= 0) a.splice(i, 1); else a.push(t); renderApp(); }
function savePlayer() {
  const p = _plEdit;
  if (!p.name.trim()) { toast("名前を入力してください"); return; }
  if (p.id) {
    const orig = playerById(p.id);
    Object.assign(orig, { name: p.name.trim(), look: p.look, type: p.type, venues: p.venues, notes: p.notes });
  } else {
    p.id = uid("p"); p.createdAt = Date.now(); p.seenCount = 0;
    S.players.push(p);
  }
  save(); go("player", p.id);
}
async function delPlayer(pid) {
  if (!(await confirmDlg("このプレイヤーを削除しますか?(ハンド記録の割当も解除)", "削除"))) return;
  S.players = S.players.filter(p => p.id !== pid);
  for (const h of S.hands) for (const k of Object.keys(h.seatMap || {})) if (h.seatMap[k] === pid) delete h.seatMap[k];
  for (const s of S.sessions) if (s.roster) s.roster = s.roster.filter(x => x !== pid);
  save(); go("players");
}

/* ============ ハンド一覧(アプリ内HHブラウズ) ============ */
const HFLT = { period: "30d", playerId: "", tag: "" };
function hfSetTag(i) { const t = i < 0 ? "" : HAND_TAGS[i]; HFLT.tag = HFLT.tag === t ? "" : t; renderApp(); }
function handRowFull(hd) {
  const cards = hd.heroCards ? cardHTML(hd.heroCards[0]) + cardHTML(hd.heroCards[1]) : "";
  const net = hd.heroNet || 0;
  const d = new Date(hd.ts);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const vs = Object.values(hd.seatMap || {}).map(pid => (playerById(pid) || {}).name).filter(Boolean).slice(0, 2).join("・");
  const tags = (hd.tags || []).length ? ` <span style="font-size:10px;color:#e0a13b">#${hd.tags.join(" #")}</span>` : "";
  return `<button class="list-item" onclick="go('handDetail','${hd.id}')">
    <span>${fmtDate(hd.ts)} ${time} <b>${hd.heroPos || "—"}</b> ${cards}${hd.complete === false ? ' <span class="mut">(途中)</span>' : ""}${vs ? ` <span class="mut" style="font-size:11px">vs ${esc(vs)}</span>` : ""}${tags}</span>
    <span style="float:right;color:${net >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(net, true)}</span></button>`;
}
function viewHands() {
  const [from, to] = periodRange(HFLT.period);
  let hs = filterHands({ from, to, playerId: HFLT.playerId || null });
  if (HFLT.tag) hs = hs.filter(h2 => (h2.tags || []).includes(HFLT.tag));
  const net = hs.reduce((a, h2) => a + (h2.heroNet || 0), 0);
  const players = S.players.slice().sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  let h = backBar("stats");
  h += `<div class="card">
    <div class="lbl">ハンド一覧</div>
    <div class="chips">${PERIODS.map(p => `<button class="chip ${HFLT.period === p.key ? "on" : ""}" onclick="HFLT.period='${p.key}';renderApp()">${p.label}</button>`).join("")}</div>
    <select class="inp" style="margin-top:8px" onchange="HFLT.playerId=this.value;renderApp()">
      <option value="">相手: 全員</option>
      ${players.map(p => `<option value="${p.id}" ${HFLT.playerId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
    </select>
    <div class="chips sm" style="margin-top:8px">${HAND_TAGS.map((t, i) => `<button class="chip ${HFLT.tag === t ? "on" : ""}" onclick="hfSetTag(${i})">${t}</button>`).join("")}</div>
    <div class="mut" style="font-size:12px;margin-top:8px">${hs.length}ハンド · 合計 <b style="color:${net >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(net, true)}</b></div>
    <div class="note">合計は記録ハンドのみの参考値(セッション収支とは一致しません)</div>
  </div>`;
  const LIMIT = 100;
  h += `<div class="card">`;
  for (const hd of hs.slice(0, LIMIT)) h += handRowFull(hd);
  if (!hs.length) h += `<div class="note">該当するハンドがありません。ハンド詳細(HHテキスト・GTOリンク)は各行のタップで開きます。</div>`;
  if (hs.length > LIMIT) h += `<div class="note">最新${LIMIT}件を表示(全${hs.length}件)。期間や相手で絞ってください。</div>`;
  h += `</div>`;
  return h;
}

/* ============ スタッツ ============ */
const FLT = { period: "30d", venue: null };
function stSetVenue(i) { const v = S.venues[i]; FLT.venue = FLT.venue === v ? null : v; renderApp(); }
function freqTable(r) {
  const row = (l, v, n) => `<tr><td>${l}</td><td class="big">${v == null ? "—" : v + "%"}</td><td class="mut">${n != null ? "(" + n + ")" : ""}</td></tr>`;
  return `<table>
    ${row("VPIP", r.vpip, r.hands)}${row("PFR", r.pfr, r.hands)}${row("3bet", r.bet3, r.bet3_n)}
    ${row("フロップc-bet", r.cbet, r.cbet_n)}${row("fold to c-bet", r.fcb, r.fcb_n)}
    ${row("WTSD", r.wtsd, r.wtsd_n)}${row("W$SD", r.wsd, r.wsd_n)}${row("WWSF", r.wwsf, r.wtsd_n)}
    ${row("AFq(ポストフロップ)", r.afq, r.afq_n)}
  </table>`;
}
function viewStats() {
  const [from, to] = periodRange(FLT.period);
  let sessions = S.sessions.filter(s => s.startAt >= from && s.startAt <= to);
  if (FLT.venue) sessions = sessions.filter(s => s.venue === FLT.venue);
  const hands = filterHands({ from, to, venue: FLT.venue });
  const st = sessionStats(sessions);
  let h = `<button class="btn" style="width:100%;margin-bottom:11px" onclick="go('hands')">ハンド一覧を見る(期間・相手フィルタ) →</button>`;
  h += `<div class="card">
    <div class="chips">${PERIODS.map(p => `<button class="chip ${FLT.period === p.key ? "on" : ""}" onclick="FLT.period='${p.key}';renderApp()">${p.label}</button>`).join("")}</div>
    ${S.venues.length ? `<div class="chips sm" style="margin-top:6px">${S.venues.map((v, i) => `<button class="chip ${FLT.venue === v ? "on" : ""}" onclick="stSetVenue(${i})">${esc(v)}</button>`).join("")}</div>` : ""}
  </div>`;
  h += `<div class="kpi-grid">
    ${kpi("収支", fmtMoney(st.profit, true), st.profit >= 0)}
    ${kpi("時給", st.hourly != null ? fmtMoney(st.hourly, true) : "—", (st.hourly || 0) >= 0)}
    ${kpi("bb/h", st.bbPerH != null ? st.bbPerH.toFixed(1) : "—")}
    ${kpi("bb/100(推定)", st.bbPer100 != null ? st.bbPer100.toFixed(1) : "—")}
    ${kpi("勝率", st.winRate != null ? st.winRate.toFixed(0) + "%" : "—")}
    ${kpi("最大DD", fmtMoney(-st.maxDD))}
  </div>`;
  h += `<div class="card"><div class="lbl">収支推移</div>${profitSVG(cumulativeSeries(sessions), 340, 120)}</div>`;
  // グループ別
  const byVenue = groupProfit(sessions, s => s.venue || "—");
  const byStake = groupProfit(sessions, s => `${s.sb}/${s.bb}`);
  const byMonth = groupProfit(sessions, s => { const d = new Date(s.startAt); return `${d.getFullYear()}/${d.getMonth() + 1}`; });
  const gtable = (m, label) => {
    if (!m.size) return "";
    let t = `<div class="card"><div class="lbl">${label}</div><table><tr><th></th><th>回</th><th>時間</th><th>収支</th><th>時給</th></tr>`;
    for (const [k, g] of [...m.entries()].sort((a, b) => b[1].profit - a[1].profit))
      t += `<tr><td>${esc(k)}</td><td>${g.n}</td><td>${Math.round(g.hours)}h</td><td style="color:${g.profit >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(g.profit, true)}</td><td>${g.hours > 0 ? fmtMoney(g.profit / g.hours, true) : "—"}</td></tr>`;
    return t + `</table></div>`;
  };
  h += gtable(byMonth, "月別") + gtable(byVenue, "会場別") + gtable(byStake, "ステークス別");
  // ハンド指標
  h += `<div class="card"><div class="lbl">ヒーロー頻度(記録ハンド ${hands.length}件より)</div>${freqTable(heroFreq(hands))}
    <div class="note">HHは全ハンドではなく選択的に記録されるため、頻度は実際と乖離し得ます(印象的なハンドに偏る)。厳密な自己分析はNEMESISへの出力後に。</div></div>`;
  const byPos = heroByPosition(hands);
  if (byPos.size) {
    h += `<div class="card"><div class="lbl">ポジション別(記録ハンド)</div><table><tr><th></th><th>n</th><th>収支</th></tr>`;
    for (const pos of POS_BY_SIZE[9].slice().reverse()) {
      const g = [...byPos.entries()].find(e => e[0] === pos);
      if (!g) continue;
      h += `<tr><td>${pos}</td><td>${g[1].n}</td><td style="color:${g[1].net >= 0 ? "#2f9e63" : "var(--red)"}">${fmtMoney(g[1].net, true)}</td></tr>`;
    }
    h += `</table><div class="note">記録ハンドのみの参考値(セッション収支とは一致しません)</div></div>`;
  }
  return h;
}

/* ============ その他(出力・設定) ============ */
const EXP = { period: "7d", from: "", to: "" };
function expRange() {
  if (EXP.period === "custom") {
    const f = EXP.from ? new Date(EXP.from + "T00:00:00").getTime() : 0;
    const t = EXP.to ? new Date(EXP.to + "T23:59:59").getTime() : Date.now();
    return [f, t];
  }
  return periodRange(EXP.period);
}
function viewMore() {
  const [from, to] = expRange();
  const prev = buildExport(from, to);
  let h = `<div class="card">
    <div class="lbl">HH出力 → NEMESIS連携</div>
    <div class="chips">${PERIODS.map(p => `<button class="chip ${EXP.period === p.key ? "on" : ""}" onclick="EXP.period='${p.key}';renderApp()">${p.label}</button>`).join("")}
      <button class="chip ${EXP.period === "custom" ? "on" : ""}" onclick="EXP.period='custom';renderApp()">期間指定</button></div>
    ${EXP.period === "custom" ? `<div class="row2" style="margin-top:8px">
      <input class="inp" type="date" value="${EXP.from}" onchange="EXP.from=this.value;renderApp()">
      <input class="inp" type="date" value="${EXP.to}" onchange="EXP.to=this.value;renderApp()">
    </div>` : ""}
    <div class="big" style="margin:10px 0 4px">${prev.count}ハンド</div>
    ${prev.skipped ? `<div class="mut" style="font-size:12px">(途中保存${prev.skipped}件は対象外)</div>` : ""}
    <div class="row2" style="margin-top:10px">
      <button class="btn primary" onclick="doShare()" ${prev.count ? "" : "disabled"}>共有(メール/OneDrive)</button>
      <button class="btn" onclick="doDownload()" ${prev.count ? "" : "disabled"}>ファイル保存</button>
    </div>
    <button class="btn" style="width:100%;margin-top:8px" onclick="doMailto()" ${prev.count ? "" : "disabled"}>メール下書き(本文貼付)</button>
    <div class="note">出力はGG PokerCraft互換テキスト。PCの <b>C:\\GTO\\history\\live\\</b> に保存すると、NEMESISの /hh(母集団分析・プリフロップ採点・エクスプロイト投入)がそのまま解析します。</div>
  </div>`;
  h += `<div class="card"><div class="lbl">設定</div>
    <label class="f-lbl">送信先メールアドレス</label>
    <input class="inp" type="email" value="${esc(S.settings.email)}" onchange="S.settings.email=this.value;save()" placeholder="you@example.com">
    <div class="row2">
      <div><label class="f-lbl">推定ハンド/時(bb/100用)</label><input class="inp" type="number" value="${S.settings.handsPerHour}" onchange="S.settings.handsPerHour=+this.value||25;save()"></div>
      <div><label class="f-lbl">通貨記号(空欄=なし)</label><input class="inp" value="${esc(S.settings.currency)}" placeholder="なし" onchange="S.settings.currency=this.value.trim();save();renderApp()"></div>
    </div>
    <div class="row2">
      <div><label class="f-lbl">デフォルトSB</label><input class="inp" type="number" value="${S.settings.defaultSb}" onchange="S.settings.defaultSb=+this.value;save()"></div>
      <div><label class="f-lbl">デフォルトBB</label><input class="inp" type="number" value="${S.settings.defaultBb}" onchange="S.settings.defaultBb=+this.value;save()"></div>
    </div>
    <label class="f-lbl">NEMESIS URL(GTOディープリンク先・レビュー送信先)</label>
    <input class="inp" value="${esc(S.settings.nemesisUrl || "http://localhost:8000")}" onchange="S.settings.nemesisUrl=this.value;save()" placeholder="http://192.168.1.10:8000">
    <label class="f-lbl">レビュートークン(reviewToken)</label>
    <input class="inp" value="${esc(S.settings.reviewToken || "")}" onchange="S.settings.reviewToken=this.value.trim();save()" placeholder="PCの data/review/config.json の token">
    <label class="f-lbl" style="display:flex;align-items:center;gap:8px;margin-top:12px">
      <input type="checkbox" ${S.settings.reviewAuto ? "checked" : ""} onchange="S.settings.reviewAuto=this.checked;save()" style="width:auto;min-height:0">
      ハンド保存時にレビューを自動送信
    </label>
    <div class="note">レビュー機能はPCのNEMESIS(webapp/server.py)が稼働している時のみ動作します。トークンはPC起動時に自動生成され config.json に記録されます。</div>
  </div>`;
  h += `<div class="card"><div class="lbl">バックアップ${S.settings.lastBackupAt ? ` <span class="mut" style="font-weight:400">(前回: ${fmtDate(S.settings.lastBackupAt)})</span>` : ""}</div>
    <div class="row2">
      <button class="btn" onclick="doBackup()">JSONエクスポート(共有)</button>
      <button class="btn" onclick="document.getElementById('impFile').click()">JSONインポート</button>
    </div>
    <input type="file" id="impFile" accept=".json" style="display:none" onchange="doImport(this)">
    <div class="note">データは端末内(ブラウザ)のみに保存されます。機種変更前に必ずエクスポートしてください。定期的なバックアップを推奨(14日超で通知)。</div>
  </div>`;
  h += `<div class="card">
    <div class="lbl">NEMESIS<span style="color:var(--red)">.</span> LIVE</div>
    <div class="note">v1.0 — ライブポーカーHH記録。姉妹アプリ NEMESIS(GTOエクスプロイトナビゲーター)と連携。</div>
    <button class="btn sm danger" style="margin-top:8px" onclick="wipeAll()">全データ削除</button>
  </div>`;
  return h;
}
async function doShare() {
  const [f, t] = expRange();
  const e = buildExport(f, t);
  const r = await shareHH(e.text, exportFileName(f, t));
  if (r === "shared") toast("共有しました");
  else if (r === "downloaded") toast("ダウンロードしました(共有シート非対応環境)");
}
function doDownload() {
  const [f, t] = expRange();
  const e = buildExport(f, t);
  downloadText(e.text, exportFileName(f, t));
}
function doMailto() {
  const [f, t] = expRange();
  const e = buildExport(f, t);
  const url = mailtoHH(e.text, exportFileName(f, t));
  if (!url) { toast("メール本文には長すぎます(数ハンドまで)。「共有」からファイル添付してください"); return; }
  location.href = url;
}
async function doBackup() {
  const f = ts => { const d = new Date(ts), p2 = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`; };
  const r = await shareHH(exportJSON(), `nemesis-live-backup_${f(Date.now())}.json`);
  if (r === "cancel") return;
  S.settings.lastBackupAt = Date.now();
  save(); renderApp();
  toast(r === "shared" ? "バックアップを共有しました" : "バックアップをダウンロードしました");
}
function doImport(inp) {
  const file = inp.files && inp.files[0];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try { importJSON(rd.result); toast("インポートしました"); renderApp(); }
    catch (e) { toast("読み込み失敗: " + e.message); }
  };
  rd.readAsText(file);
  inp.value = "";
}
async function wipeAll() {
  if (!(await confirmDlg("全データを削除しますか?この操作は取り消せません。", "全削除"))) return;
  localStorage.removeItem(KEY);
  location.reload();
}

function backBar(view, param) {
  // 履歴があれば来た画面へ、無ければフォールバック先へ
  return `<button class="btn sm" style="margin-bottom:10px" onclick="goBack('${view}'${param ? `,'${param}'` : ""})">← 戻る</button>`;
}

/* ============ ハンドレビュー(NEMESISのGTO採点) ============ */
const _reviewOpen = {}; // 展開中のhid
function reviewToggle(hid) { _reviewOpen[hid] = !_reviewOpen[hid]; renderApp(); }

/* 完了ハンドで結果も送信待ちも無いもの(直近50) */
function reviewUnsentHands() {
  const q = new Set((S.reviewQueue || []).map(x => x.hid));
  const rv = S.reviews || {};
  return S.hands.slice().sort((a, b) => b.ts - a.ts).slice(0, 50)
    .filter(h => h.complete !== false && !q.has(h.id) && !rv[h.id] && handToGG(h));
}

/* 「未送信を送る」: 未送信ハンドをキューに積んで送信 */
function reviewSendUnsent() {
  if (!S.reviewQueue) S.reviewQueue = [];
  const missing = reviewUnsentHands();
  for (const h of missing)
    if (!S.reviewQueue.some(q => q.hid === h.id)) S.reviewQueue.push({ hid: h.id, ts: Date.now(), tries: 0 });
  if (missing.length) save();
  if (!S.reviewQueue.length) { toast("未送信はありません"); return; }
  if (!navigator.onLine) { toast("オフラインです。オンライン復帰時に自動再送します"); renderApp(); return; }
  if (!(S.settings.nemesisUrl || "").trim()) { toast("設定にNEMESIS URLを入力してください"); return; }
  toast("送信中…");
  reviewFlush();
  renderApp();
}

function _reviewBoardHTML(hd) {
  const st = hd.streets || {};
  const b = [];
  if (st.flop && st.flop.cards) b.push(...st.flop.cards);
  if (st.turn && st.turn.card) b.push(st.turn.card);
  if (st.river && st.river.card) b.push(st.river.card);
  return b.map(c => cardHTML(c)).join("");
}

/* 状態バッジ(未送信/送信待ち/待機/解析中/完了/対象外/エラー/PC応答なし) */
function reviewBadge(hd, r, inQueue) {
  const b = (txt, color) => `<span style="font-size:11px;color:${color}">${esc(txt)}</span>`;
  if (r && r.noResponse) return b("PC応答なし", "#e0a13b");
  if (r) {
    if (r.status === "done" && r.summary) {
      const s = r.summary, bl = s.blunder || 0;
      return `<span style="font-size:11px">✓${s.best || 0} ○${s.ok || 0} <b style="color:${bl > 0 ? "var(--red)" : "var(--mut)"}">✗${bl}</b></span>`;
    }
    if (r.status === "done") return b("完了", "var(--green)");
    if (r.status === "unsupported") return b("対象外", "var(--mut)");
    if (r.status === "error") return b("エラー", "var(--red)");
    if (r.status === "failed") return b("送信失敗", "var(--red)");
    if (r.status === "rejected") return b("受付拒否", "var(--red)");
    if (r.status === "solving") return b("解析中" + (r.eta_s != null ? `(~${Math.round(r.eta_s)}s)` : ""), "var(--blue)");
    if (r.status === "queued") return b("待機" + (r.queue_pos != null ? `(${r.queue_pos}番)` : ""), "var(--blue)");
    if (r.status === "unknown") return b("不明", "var(--mut)");
  }
  if (inQueue) return b("送信待ち" + (inQueue.tries ? `(再${inQueue.tries})` : ""), "var(--mut)");
  if (hd.complete === false) return b("(途中)", "var(--mut)");
  return b("未送信", "var(--mut)");
}

/* 再レビュー: 結果キャッシュを破棄して再送(サーバーはerror済みIDの再キューを受付) */
function reviewRetry(hid) {
  if (S.reviews) delete S.reviews[hid];
  reviewEnqueue(hid);
  toast("再送信しました");
  renderApp();
}
function _reviewRetryBtn(hid) {
  return `<button class="btn sm" style="margin-top:8px" onclick="event.stopPropagation();reviewRetry('${hid}')">再レビュー</button>`;
}

/* 展開時の本文 */
function reviewDetail(hd, r) {
  if (!r) return `<div class="note">まだ送信されていません。上部「未送信を送る」で送信できます。</div>`;
  if (r.noResponse) return `<div class="note">PCから応答がありません。NEMESISサーバー(PC)が起動しているか、設定のURL/reviewTokenをご確認ください。</div>`;
  if (r.status === "failed") return `<div class="note">送信に失敗しました${r.reason ? `: ${esc(r.reason)}` : ""}。</div>` + _reviewRetryBtn(hd.id);
  if (r.status === "rejected") return `<div class="note">受付が拒否されました${r.reason ? `: ${esc(r.reason)}` : ""}。</div>`;
  if (r.status === "queued") return `<div class="note">PCの処理待ち${r.queue_pos != null ? `(${r.queue_pos}番目)` : ""}${r.eta_s != null ? ` · 目安${Math.round(r.eta_s)}秒` : ""}。レビュータブを開いたまま少しお待ちください。</div>`;
  if (r.status === "solving") return `<div class="note">解析中${r.eta_s != null ? `(残り目安${Math.round(r.eta_s)}秒)` : ""}。</div>`;
  const body = r.body;
  if (!body) {
    if (r.status === "error") return `<div class="note">解析エラー: ${esc(r.error || "不明")}</div>` + _reviewRetryBtn(hd.id);
    return `<div class="note">結果を取得中…</div>`;
  }
  if (body.status === "unsupported") return `<div class="note">レビュー対象外: ${esc(body.unsupported_reason || "チャート外・多人数・5bet+・ストラドル等")}</div>`;
  if (body.status === "error") return `<div class="note">解析エラー: ${esc(body.error || "不明")}</div>` + _reviewRetryBtn(hd.id);

  let h = "";
  const s = body.summary;
  if (s) h += `<div style="font-size:12px;margin-bottom:8px">${esc(s.headline || "")} <span class="mut">(best ${s.best || 0} / ok ${s.ok || 0} / <b style="color:${(s.blunder || 0) > 0 ? "var(--red)" : "inherit"}">blunder ${s.blunder || 0}</b>)</span></div>`;
  const vcolor = v => v === "best" ? "var(--green)" : v === "blunder" ? "var(--red)" : "var(--mut)";
  const decRow = d => {
    let x = `<div class="read-row"><div class="read-head"><span class="read-dot" style="background:${vcolor(d.verdict)}"></span><span>${esc(d.text || "")}</span></div>`;
    if (d.why) x += `<div class="read-ex">なぜ: ${esc(d.why)}</div>`;
    if (d.exploit) x += `<div class="read-ex">相手タイプ別: ${esc(d.exploit)}</div>`;
    return x + `</div>`;
  };
  if (body.preflop && body.preflop.length) {
    h += `<div class="lbl" style="margin-top:6px">プリフロップ</div>`;
    for (const d of body.preflop) h += decRow(d);
  }
  if (body.postflop && body.postflop.length) {
    h += `<div class="lbl" style="margin-top:6px">ポストフロップ</div>`;
    for (const d of body.postflop) h += decRow(d);
  }
  if (body.stop) h += `<div class="note" style="color:#e0a13b">${esc(body.stop)}</div>`;
  if (body.disclaimer) h += `<div class="note" style="margin-top:8px">${esc(body.disclaimer)}</div>`;
  const link = gtoLinkForHand(hd);
  if (link && link.url) h += `<a class="btn sm" style="display:inline-block;margin-top:8px;text-decoration:none" href="${esc(link.url)}" target="_blank" rel="noopener">NEMESISで開く →</a>`;
  return h;
}

function reviewRow(hd) {
  const cards = hd.heroCards ? cardHTML(hd.heroCards[0]) + cardHTML(hd.heroCards[1]) : "";
  const board = _reviewBoardHTML(hd);
  const r = (S.reviews || {})[hd.id];
  const inQueue = (S.reviewQueue || []).find(q => q.hid === hd.id);
  const time = `${String(new Date(hd.ts).getHours()).padStart(2, "0")}:${String(new Date(hd.ts).getMinutes()).padStart(2, "0")}`;
  let out = `<button class="list-item" onclick="reviewToggle('${hd.id}')">
    <span>${fmtDate(hd.ts)} ${time} <b>${hd.heroPos || "—"}</b> ${cards}${board ? ` <span class="mut">${board}</span>` : ""}</span>
    <span style="float:right">${reviewBadge(hd, r, inQueue)}</span></button>`;
  if (_reviewOpen[hd.id]) out += `<div style="padding:2px 4px 12px">${reviewDetail(hd, r)}</div>`;
  return out;
}

function viewReview() {
  if (!S.reviewQueue) S.reviewQueue = [];
  if (!S.reviews) S.reviews = {};
  const unsent = S.reviewQueue.length + reviewUnsentHands().length;
  let h = `<div class="card">
    <div class="lbl">ハンドレビュー — NEMESISのGTO採点</div>
    <div class="row2">
      <button class="btn primary" onclick="reviewSendUnsent()">未送信を送る${unsent ? ` (${unsent})` : ""}</button>
      <button class="btn" onclick="reviewPoll()">結果を更新</button>
    </div>
    <div class="note">保存した完了ハンドをPCのNEMESISが数分で採点します。このタブを開いている間、結果を自動取得します(25秒間隔)。PC URL・reviewTokenは「その他」→設定で。</div>
  </div>`;
  const hands = S.hands.slice().sort((a, b) => b.ts - a.ts).slice(0, 50);
  if (!hands.length) { h += `<div class="card"><div class="note">まだ記録ハンドがありません。記録タブでハンドを保存すると、ここでレビューを受け取れます。</div></div>`; return h; }
  h += `<div class="card">`;
  for (const hd of hands) h += reviewRow(hd);
  h += `</div>`;
  return h;
}

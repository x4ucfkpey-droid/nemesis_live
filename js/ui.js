/* NEMESIS LIVE — 共通UI部品(ボトムシート/カードピッカー/テンキー/トースト) */
"use strict";

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("on"));
  setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }, 1800);
}

/* ボトムシート。closeSheet()かresolveで閉じる。ネスト不可(1枚のみ) */
let _sheetResolve = null;
function openSheet(html, opts) {
  closeSheet(null);
  return new Promise(resolve => {
    _sheetResolve = resolve;
    const ov = document.createElement("div");
    ov.className = "sheet-ov"; ov.id = "sheetOv";
    ov.innerHTML = `<div class="sheet">${html}</div>`;
    ov.addEventListener("click", e => { if (e.target === ov && !(opts && opts.modal)) closeSheet(null); });
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("on"));
  });
}
function closeSheet(result) {
  const ov = document.getElementById("sheetOv");
  if (ov) { ov.classList.remove("on"); setTimeout(() => ov.remove(), 200); }
  if (_sheetResolve) { const r = _sheetResolve; _sheetResolve = null; r(result); }
}

async function confirmDlg(msg, okLabel) {
  const r = await openSheet(`
    <div class="sh-title">${esc(msg)}</div>
    <div class="row2">
      <button class="btn" onclick="closeSheet(false)">キャンセル</button>
      <button class="btn danger" onclick="closeSheet(true)">${esc(okLabel || "OK")}</button>
    </div>`);
  return !!r;
}

/* ---- カードピッカー ----
   n枚選択。used=使用済みカードSet。titleとpre(初期選択)対応。
   結果: ["As","Kd",...] または null(キャンセル) */
let _cp = null;
function pickCards(n, used, title, pre) {
  _cp = { n, used: new Set(used || []), sel: (pre || []).slice(), rank: null };
  const html = `
    <div class="sh-title">${esc(title || "カード選択")} <span class="mut" id="cpProg"></span></div>
    <div id="cpSel" class="cp-sel"></div>
    <div id="cpGrid"></div>
    <div class="row2" style="margin-top:10px">
      <button class="btn" onclick="closeSheet(null)">キャンセル</button>
      <button class="btn primary" id="cpOk" onclick="cpDone()" disabled>決定</button>
    </div>`;
  const p = openSheet(html, { modal: true });
  cpRender();
  return p;
}
function cpRender() {
  const g = document.getElementById("cpGrid");
  if (!g) return;
  const selSet = new Set(_cp.sel);
  let h = `<div class="cp-ranks">`;
  for (const r of RANKS) {
    const cnt = SUITS.filter(s => !_cp.used.has(r + s) && !selSet.has(r + s)).length;
    h += `<button class="cp-r ${_cp.rank === r ? "on" : ""}" ${cnt ? "" : "disabled"} onclick="cpRank('${r}')">${r === "T" ? "10" : r}</button>`;
  }
  h += `</div><div class="cp-suits">`;
  for (const s of SUITS) {
    const c = _cp.rank ? _cp.rank + s : null;
    const dis = !c || _cp.used.has(c) || selSet.has(c);
    h += `<button class="cp-s" style="color:${SUIT_COLOR[s]}" ${dis ? "disabled" : ""} onclick="cpSuit('${s}')">${SUIT_GLYPH[s]}</button>`;
  }
  h += `</div>`;
  g.innerHTML = h;
  document.getElementById("cpSel").innerHTML =
    _cp.sel.map((c, i) => `<button class="cp-card" onclick="cpRemove(${i})">${cardHTML(c, true)}</button>`).join("") +
    Array(Math.max(0, _cp.n - _cp.sel.length)).fill(`<span class="cp-card">${cardHTML(null, true)}</span>`).join("");
  document.getElementById("cpProg").textContent = `${_cp.sel.length}/${_cp.n}`;
  document.getElementById("cpOk").disabled = _cp.sel.length !== _cp.n;
}
function cpRank(r) { _cp.rank = r; cpRender(); }
function cpSuit(s) {
  if (!_cp.rank) return;
  const c = _cp.rank + s;
  if (_cp.sel.length >= _cp.n) return;
  _cp.sel.push(c); _cp.rank = null; cpRender();
  if (_cp.sel.length === _cp.n) document.getElementById("cpOk").focus();
}
function cpRemove(i) { _cp.sel.splice(i, 1); cpRender(); }
function cpDone() { if (_cp.sel.length === _cp.n) closeSheet(_cp.sel.slice()); }

/* ---- 金額テンキー ----
   opts: {title, quick:[{label,amt}], init, max} → Promise<number|null> */
let _np = null;
function numpad(opts) {
  _np = { v: opts.init != null ? String(opts.init) : "", max: opts.max };
  const quicks = (opts.quick || []).map(q =>
    `<button class="btn qk" onclick="npPick(${q.amt})">${esc(q.label)}<br><span class="mut">${Math.round(q.amt).toLocaleString()}</span></button>`).join("");
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "00", "0", "⌫"];
  const html = `
    <div class="sh-title">${esc(opts.title || "金額")}</div>
    ${quicks ? `<div class="qk-row">${quicks}</div>` : ""}
    <div class="np-disp" id="npDisp">0</div>
    <div class="np-grid">${keys.map(k => `<button class="np-k" onclick="npKey('${k}')">${k}</button>`).join("")}</div>
    <div class="row2" style="margin-top:10px">
      <button class="btn" onclick="closeSheet(null)">キャンセル</button>
      <button class="btn primary" onclick="npDone()">決定</button>
    </div>`;
  const p = openSheet(html, { modal: true });
  npRender();
  return p;
}
function npRender() {
  const el = document.getElementById("npDisp");
  if (el) el.textContent = (+_np.v || 0).toLocaleString();
}
function npKey(k) {
  if (k === "⌫") _np.v = _np.v.slice(0, -1);
  else if (_np.v.length < 9) _np.v += k;
  npRender();
}
function npPick(amt) {
  // クイックボタンは即決定(1タップ短縮)。上限クランプはnpDoneと同一
  let v = Math.round(amt);
  if (_np.max != null) v = Math.min(v, _np.max);
  closeSheet(v);
}
function npDone() {
  let v = +_np.v || 0;
  if (_np.max != null) v = Math.min(v, _np.max);
  closeSheet(v);
}

/* ---- タグチップ描画(トグル可能) ---- */
function chipRow(tags, selected, onclickName, extra) {
  const sel = new Set(selected || []);
  return `<div class="chips ${extra || ""}">` + tags.map(t =>
    `<button class="chip ${sel.has(t) ? "on" : ""}" onclick="${onclickName}('${esc(t)}')">${esc(t)}</button>`).join("") + `</div>`;
}

/* ---- SVG収支グラフ ---- */
function profitSVG(series, w, h) {
  if (!series.length) return `<div class="mut" style="text-align:center;padding:24px 0">データなし</div>`;
  const pts = [{ t: series[0].t - 1, v: 0 }].concat(series);
  const vs = pts.map(p => p.v);
  const min = Math.min(0, ...vs), max = Math.max(0, ...vs);
  const span = (max - min) || 1;
  const X = i => (i / (pts.length - 1)) * (w - 8) + 4;
  const Y = v => h - 18 - ((v - min) / span) * (h - 30);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const zero = Y(0);
  const last = pts[pts.length - 1].v;
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block">
    <line x1="4" y1="${zero}" x2="${w - 4}" y2="${zero}" stroke="var(--line)" stroke-dasharray="3 3"/>
    <path d="${line}" fill="none" stroke="${last >= 0 ? "#2f9e63" : "var(--red)"}" stroke-width="2" stroke-linejoin="round"/>
    ${pts.slice(1).map((p, i) => `<circle cx="${X(i + 1)}" cy="${Y(p.v)}" r="2.5" fill="${p.v >= 0 ? "#2f9e63" : "var(--red)"}"/>`).join("")}
    <text x="${w - 6}" y="${Y(last) - 6}" fill="var(--ink)" font-size="11" text-anchor="end">${fmtMoney(last, true)}</text>
  </svg>`;
}

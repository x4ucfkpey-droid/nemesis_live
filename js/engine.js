/* NEMESIS LIVE — ハンド状態機械
   アクション順・現在ベット・ポット・ストリート完了/終局判定を管理する。
   ライブ記録用途なので厳格な検証はせず、順番スキップは自動フォールドで補完する。 */
"use strict";

const POS_BY_SIZE = {
  2: ["SB", "BB"],                                        // HU: SB=BTN
  3: ["BTN", "SB", "BB"],
  4: ["CO", "BTN", "SB", "BB"],
  5: ["HJ", "CO", "BTN", "SB", "BB"],
  6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]
};

function preflopOrder(size) {
  // ブラインド以外がポジション順 → SB → BB
  const all = POS_BY_SIZE[size];
  if (size === 2) return ["SB", "BB"]; // HUはSB(BTN)が先
  return all.filter(p => p !== "SB" && p !== "BB").concat(["SB", "BB"]);
}
function postflopOrder(size) {
  const all = POS_BY_SIZE[size];
  if (size === 2) return ["BB", "SB"]; // HUポストフロップはBBが先
  return ["SB", "BB"].concat(all.filter(p => p !== "SB" && p !== "BB"));
}

class HandEngine {
  /* opts: {tableSize, sb, bb, ante(BBアンティ額・0=なし), straddlePos(null|"UTG"), stacks:{pos:amt}} */
  constructor(opts) {
    this.size = opts.tableSize;
    this.sb = opts.sb; this.bb = opts.bb;
    this.ante = opts.ante || 0;
    this.positions = POS_BY_SIZE[this.size].slice();
    this.straddlePos = opts.straddlePos || null;
    this.p = {}; // pos -> {stack, folded, allin, streetPut, totalPut}
    for (const pos of this.positions)
      this.p[pos] = { stack: (opts.stacks && opts.stacks[pos]) || 100 * this.bb, folded: false, allin: false, streetPut: 0, totalPut: 0 };
    this.street = "preflop";
    this.acts = { preflop: [], flop: [], turn: [], river: [] };
    this.board = { flop: null, turn: null, river: null };
    this.pot = 0;
    this._undoStack = [];
    // BBアンティ(死に金): ブラインドより先にポットへ。ベット額(streetPut)には数えない
    if (this.ante > 0) this._putDead("BB", this.ante);
    // ブラインド投入
    this._put("SB", Math.min(this.sb, this.p.SB.stack));
    this._put("BB", Math.min(this.bb, this.p.BB.stack));
    this.curBet = this.bb;
    this.lastRaise = this.bb;
    if (this.straddlePos && this.p[this.straddlePos]) {
      this._put(this.straddlePos, Math.min(2 * this.bb, this.p[this.straddlePos].stack));
      this.curBet = 2 * this.bb; this.lastRaise = this.bb * 2;
    }
    this._initQueue();
  }

  _put(pos, amt) {
    const pl = this.p[pos];
    amt = Math.max(0, Math.min(amt, pl.stack - pl.totalPut)); // 残額を超えない
    pl.streetPut += amt; pl.totalPut += amt;
    this.pot += amt;
    if (pl.totalPut >= pl.stack - 1e-9) pl.allin = true;
  }

  /* 死に金(アンティ): ポットには入るがベット額(streetPut)に数えない */
  _putDead(pos, amt) {
    const pl = this.p[pos];
    amt = Math.max(0, Math.min(amt, pl.stack - pl.totalPut));
    pl.totalPut += amt;
    this.pot += amt;
    if (pl.totalPut >= pl.stack - 1e-9) pl.allin = true;
  }

  _initQueue() {
    let order = this.street === "preflop" ? preflopOrder(this.size) : postflopOrder(this.size);
    if (this.street === "preflop" && this.straddlePos) {
      // ストラドル時: ストラドラーの次から。順番配列を回転しストラドラーを最後尾へ
      const i = order.indexOf(this.straddlePos);
      if (i >= 0) order = order.slice(i + 1).concat(order.slice(0, i + 1));
    }
    this.queue = order.filter(pos => !this.p[pos].folded && !this.p[pos].allin);
    // 行動可能者が1人以下(全員オールイン等)ならアクションなし=ランアウトへ
    if (this.street !== "preflop" && this.queue.length <= 1 && this.curBet === 0) {
      const active = this.activePlayers();
      const notAllin = active.filter(pos => !this.p[pos].allin);
      if (notAllin.length <= 1) this.queue = [];
    }
  }

  activePlayers() { return this.positions.filter(pos => !this.p[pos].folded); }
  toCall(pos) { return Math.max(0, this.curBet - this.p[pos].streetPut); }

  /* 現在の手番。queueの先頭 */
  current() { return this.queue.length ? this.queue[0] : null; }

  snapshot() {
    return JSON.stringify({ p: this.p, street: this.street, acts: this.acts, board: this.board, pot: this.pot, curBet: this.curBet, lastRaise: this.lastRaise, queue: this.queue });
  }
  _pushUndo() { this._undoStack.push(this.snapshot()); if (this._undoStack.length > 200) this._undoStack.shift(); }
  undo() {
    const s = this._undoStack.pop();
    if (!s) return false;
    const o = JSON.parse(s);
    this.p = o.p; this.street = o.street; this.acts = o.acts; this.board = o.board;
    this.pot = o.pot; this.curBet = o.curBet; this.lastRaise = o.lastRaise; this.queue = o.queue;
    return true;
  }

  /* posが行動。act: fold/check/call/bet/raise。amtはbet額 or raise-to額(合計)。
     queue先頭でないposが行動した場合、間の全員を自動フォールドする。 */
  act(pos, act, amt) {
    this._pushUndo();
    // 自動フォールド(スキップされた手番)
    while (this.queue.length && this.queue[0] !== pos) {
      const skipped = this.queue.shift();
      this.p[skipped].folded = true;
      this.acts[this.street].push({ pos: skipped, act: "fold", auto: true });
    }
    if (this.queue[0] === pos) this.queue.shift();
    const pl = this.p[pos];
    if (act === "fold") { pl.folded = true; this.acts[this.street].push({ pos, act: "fold" }); }
    else if (act === "check") { this.acts[this.street].push({ pos, act: "check" }); }
    else if (act === "call") {
      const need = Math.min(this.toCall(pos), pl.stack - pl.totalPut);
      this._put(pos, need);
      this.acts[this.street].push({ pos, act: "call", amt: need });
    }
    else if (act === "bet") {
      const real = Math.min(amt, pl.stack - pl.totalPut);
      this._put(pos, real);
      this.curBet = pl.streetPut; this.lastRaise = pl.streetPut;
      this.acts[this.street].push({ pos, act: "bet", amt: pl.streetPut });
      // ベットが入ったら他の行動済みプレイヤーに再度手番
      this._reopen(pos);
    }
    else if (act === "raise") {
      // amt = raise-to(このストリートの合計額)
      const add = Math.min(amt - pl.streetPut, pl.stack - pl.totalPut);
      const prevBet = this.curBet;
      this._put(pos, add);
      this.lastRaise = Math.max(this.lastRaise, pl.streetPut - prevBet);
      this.curBet = Math.max(this.curBet, pl.streetPut);
      this.acts[this.street].push({ pos, act: "raise", amt: pl.streetPut });
      this._reopen(pos);
    }
    return this.status();
  }

  _reopen(aggressor) {
    // アグレッサー以外のフォールド/オールインしていない全員に手番を再付与(順番維持)
    const order = this.street === "preflop" ? preflopOrder(this.size) : postflopOrder(this.size);
    const i = order.indexOf(aggressor);
    const rotated = order.slice(i + 1).concat(order.slice(0, i));
    this.queue = rotated.filter(pos => !this.p[pos].folded && !this.p[pos].allin && pos !== aggressor);
  }

  /* "playing"|"street_done"|"hand_done_fold"|"hand_done_showdown" */
  status() {
    const active = this.activePlayers();
    if (active.length <= 1) return "hand_done_fold";
    if (this.queue.length === 0) {
      if (this.street === "river") return "hand_done_showdown";
      return "street_done"; // 次のボードカード入力へ(全員オールインのランアウト含む)
    }
    return "playing";
  }

  /* ボードカードを設定して次ストリートへ */
  nextStreet(cards) {
    this._pushUndo();
    if (this.street === "preflop") { this.board.flop = cards; this.street = "flop"; }
    else if (this.street === "flop") { this.board.turn = cards[0]; this.street = "turn"; }
    else if (this.street === "turn") { this.board.river = cards[0]; this.street = "river"; }
    for (const pos of this.positions) this.p[pos].streetPut = 0;
    this.curBet = 0; this.lastRaise = this.bb;
    this._initQueue();
    // 全員オールインならアクションなしで即完了
    return this.status();
  }

  /* 精算: winners=[{pos,amt}] 省略時は残り1人に全ポット。
     未コール分は自動でベッターに払い戻し、ポットから除外する。 */
  settle(winners, rake) {
    rake = rake || 0;
    const u = this.uncalled();
    const potNet = Math.max(0, this.pot - (u ? u.amt : 0) - rake);
    if (!winners || !winners.length) {
      const act = this.activePlayers();
      winners = [{ pos: act[0], amt: potNet }];
    }
    return { winners, rake, pot: this.pot, potNet, uncalled: u };
  }

  /* 未コールベットの払い戻し額(最後のアグレッサーに返る分) */
  uncalled() {
    const puts = this.positions.map(pos => this.p[pos].streetPut).sort((a, b) => b - a);
    if (puts.length < 2) return null;
    const diff = puts[0] - puts[1];
    if (diff <= 0) return null;
    const pos = this.positions.find(p2 => this.p[p2].streetPut === puts[0]);
    return { pos, amt: diff };
  }
}

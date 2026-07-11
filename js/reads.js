/* NEMESIS LIVE — プレイヤー別エクスプロイト・リード
   playerFreq()の頻度統計から、その相手のリークと具体的な突き方(exploit)を生成する。
   基準はGG母集団実測(VPIP25.6 / PFR13.6 / 3bet6.1 / c-bet62.1 / fold-to-cbet44.2)を
   ライブ低〜中ステークス向けに調整したバンド。ライブは標本が小さいため各リードに
   関連statのサンプル数nと信頼度を付し、信頼度でスコアを重み付けして並べる。

   ポーカーロジックの向き（重要・誤ると逆の助言になる）:
    - ルース=レンジが弱く広い → バリューを厚く・ブラフを減らす
    - タイト/NIT=参加時は強い → スチールを増やし（降ろせる）、継続は尊重
    - 3bet極少=3betはほぼバリュー → 3betに降りてよい・オープンには広く反撃
    - fold-to-cbet高=降りすぎ → c-betブラフ最大化（最も現金化しやすいリーク）
    - AFq低=パッシブ → 彼らのアグレは強い（降りてよい）
*/
"use strict";

function playerReads(r) {
  const reads = [];
  // 信頼度: ライブは標本が小さいので正直にnと段階を出す
  const conf = n => (n >= 30 ? { t: "有効", w: 1.0 } : n >= 12 ? { t: "暫定", w: 0.72 } : n >= 4 ? { t: "参考", w: 0.45 } : null);
  const push = (cat, stat, n, sev, leak, exploit) => {
    const c = conf(n);
    if (!c) return;
    reads.push({ cat, stat, n, conf: c.t, score: sev * c.w, sev, leak, exploit });
  };

  // --- ルースさ(VPIP) ---
  if (r.vpip != null) {
    const v = r.vpip, n = r.hands;
    if (v >= 45) push("looseness", "VPIP", n, 3, `非常にルース (VPIP ${v}%)`,
      "薄いバリューまで厚くベット、ブラフは減らす。オープン/コールレンジが弱く広い。");
    else if (v >= 34) push("looseness", "VPIP", n, 2, `ルース (VPIP ${v}%)`,
      "バリュー寄りに調整。平均よりレンジが弱い。");
    else if (v <= 13) push("looseness", "VPIP", n, 2, `非常にタイト/NIT (VPIP ${v}%)`,
      "スチールを増やす(ブラインドを降ろせる)。参加・継続してきたら強いので尊重。");
  }

  // --- パッシブなリンパー/コーラー(VPIP-PFR gap) ---
  if (r.vpip != null && r.pfr != null) {
    const gap = Math.round(r.vpip - r.pfr), n = r.hands;
    if (gap >= 18 && r.vpip >= 28) push("passivity", "VPIP-PFR", n, 2,
      `パッシブなリンパー/コーラー (gap ${gap})`,
      "広くアイソレートして単独ポットでバリュー。彼らのコールは弱く、レイズ/3betは本物。");
  }

  // --- プリフロップ・アグレ(PFR/LAG) ---
  if (r.pfr != null && r.vpip != null) {
    const gap = r.vpip - r.pfr;
    if (r.pfr >= 24 && gap <= 12) push("preflop-agg", "PFR", r.hands, 2,
      `アグレッシブなオープナー (PFR ${r.pfr}%)`,
      "オープンが広い=3betブラフと広めのコールで反撃。ポジションを重視。");
  }

  // --- 3bet ---
  if (r.bet3 != null) {
    const v = r.bet3, n = r.bet3_n;
    if (v <= 3) push("preflop-agg", "3bet", n, 3, `3betが極端に少ない (${v}%)`,
      "3betに直面したら降りてよい=ほぼバリュー。彼らのオープンには広くコール/フロートで反撃。");
    else if (v >= 12) push("preflop-agg", "3bet", n, 2, `3betが多い (${v}%)`,
      "ライト3betを含む。4betブラフと広めのコールで対抗、3betを尊重しすぎない。");
  }

  // --- フロップc-bet ---
  if (r.cbet != null) {
    const v = r.cbet, n = r.cbet_n;
    if (v >= 75) push("cbet", "フロップc-bet", n, 2, `c-betが多い (${v}%)`,
      "フロップで広くコール/レイズしフロート。チェックにはターンで奪う。c-betの信頼度は低い。");
    else if (v <= 40) push("cbet", "フロップc-bet", n, 2, `c-betが少ない (${v}%)`,
      "彼らのc-betは強く正直=尊重。チェックしてきたら弱い→広く攻める。");
  }

  // --- fold to c-bet(最も現金化しやすいリーク) ---
  if (r.fcb != null) {
    const v = r.fcb, n = r.fcb_n;
    if (v >= 62) push("fold-to-cbet", "fold to c-bet", n, 3, `c-betに降りすぎ (${v}%)`,
      "c-betブラフを最大化。どんなボードでも継続ベットが利益になる。");
    else if (v <= 32) push("fold-to-cbet", "fold to c-bet", n, 2, `c-betに粘る (${v}%)`,
      "バリューc-betを厚く、ブラフc-betは減らす。ダブルバレルは選別。");
  }

  // --- ショーダウン傾向 ---
  if (r.wtsd != null) {
    const v = r.wtsd, n = r.wtsd_n;
    if (v >= 34) push("showdown", "WTSD", n, 2, `ショーダウンまで行きすぎ (WTSD ${v}%)`,
      "薄いバリューまで厚く。ブラフは通りにくい=減らす。");
    else if (v <= 20) push("showdown", "WTSD", n, 2, `降りがち (WTSD ${v}%)`,
      "バレルでブラフを通せる。薄いバリューは選別。");
  }
  if (r.wsd != null && r.wsd_n >= 4) {
    const v = r.wsd, n = r.wsd_n;
    if (v <= 42) push("showdown", "W$SD", n, 2, `ショーダウンが弱い=ステーション気味 (W$SD ${v}%)`,
      "バリューを厚く、ブラフを激減。弱い手でコールしてくる。");
  }

  // --- ポストフロップ・アグレ(AFq) ---
  if (r.afq != null) {
    const v = r.afq, n = r.afq_n;
    if (v <= 22) push("postflop-agg", "AFq", n, 2, `ポストフロップがパッシブ (AFq ${v}%)`,
      "彼らのベット/レイズは強い=降りてよい。主導権を握り薄くバリュー。");
    else if (v >= 55) push("postflop-agg", "AFq", n, 2, `ポストフロップがアグレ (AFq ${v}%)`,
      "ベットを割り引きキャッチダウン。チェックレイズ/フロートで誘え。");
  }

  return reads.sort((a, b) => b.score - a.score || b.sev - a.sev);
}

/* 頻度から推定プレイヤータイプ(自動サジェスト)。十分な標本がある時のみ。 */
function autoPlayerType(r) {
  if (r.vpip == null || r.pfr == null || r.hands < 12) return null;
  const v = r.vpip, p = r.pfr, gap = v - p;
  const af = r.afq;
  if (v <= 16 && gap <= 8) return "NIT";
  if (v >= 42 && (af != null && af >= 45)) return "マニアック";
  if (v >= 38 && gap >= 16) return "ステーション";
  if (gap >= 16) return "パッシブ";
  if (v >= 26 && v <= 40 && gap <= 12) return "LAG";
  if (v >= 15 && v <= 28 && gap <= 10) return "TAG";
  return null;
}

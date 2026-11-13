// 画面と操作。Claude Design「（アプリ名）画面デザイン」v0.1 を実装したもの（採用案 1b・1c・1f・1i）。
// 動画の取得元・保存先は platform.js、保存データは store.js、検出は worker.js、切り貼りは remux.js。
'use strict';
const VER = '0.1.9';
const P = self.RallyPlatform, DB = self.RallyStore;
const CFG = {
  ads: false, // 広告 SDK は未導入。true にすると広告枠（320×50 の仮置き）を出す
};

// ---------- 小物
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const mmss = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
const mmssd = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const secs = (t) => t.toFixed(1) + '秒';
const jlen = (t) => { t = Math.round(t); const m = Math.floor(t / 60), s = t % 60; return m ? `${m}分${s}秒` : `${s}秒`; };
const fmtDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${m}月${dd}日（${WD[new Date(y, m - 1, dd).getDay()]}）`; };
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const MBf = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + 'GB' : Math.max(1, Math.round(b / 1e6)) + 'MB');
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const errMsg = (e) => (e && e.message) || String(e);
const once = (el, ev, ms) => new Promise((ok, ng) => {
  const t = setTimeout(() => { el.removeEventListener(ev, f); ng(new Error(ev + ' がタイムアウト')); }, ms);
  const f = () => { clearTimeout(t); ok(); };
  el.addEventListener(ev, f, { once: true });
});

// ---------- アイコン（Design の SVG）
const sv = (d, w = 22, extra = '') => `<svg class="i" viewBox="0 0 24 24" width="${w}" height="${w}" ${extra}>${d}</svg>`;
const I = {
  back: sv('<path d="m15 18-6-6 6-6"/>'),
  next: (w = 20) => sv('<path d="m9 18 6-6-6-6"/>', w),
  prev: (w = 20) => sv('<path d="m15 18-6-6 6-6"/>', w),
  plus: sv('<path d="M5 12h14M12 5v14"/>', 22, 'style="stroke-width:1.75"'),
  plus16: sv('<path d="M5 12h14M12 5v14"/>', 16, 'style="stroke-width:1.75"'),
  set: sv('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  x: sv('<path d="M18 6 6 18M6 6l12 12"/>', 20),
  check: (w = 20) => sv('<path d="M20 6 9 17l-5-5"/>', w),
  play: (w = 26) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" style="fill:currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
  pause: (w = 28) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" style="fill:currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
  full: sv('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>', 20),
  star: (w = 24) => sv('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', w),
  cm: (w = 22) => sv('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', w),
  loop: (w = 16) => sv('<path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/>', w),
  down: sv('<path d="M12 15V3M7 10l5 5 5-5M5 21h14"/>', 20),
  up: (w = 20) => sv('<path d="M12 3v12M7 8l5-5 5 5M5 21h14"/>', w),
  info: (w = 20) => sv('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h0"/>', w),
};
const CORNERS = '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
const adHtml = () => (CFG.ads ? '<div class="ad"><b>広告</b><span>バナー 320×50</span></div>' : '');

// ---------- 状態
const S = {
  stack: ['home'], matches: [], cur: null, sel: null, filter: 'all',
  sheet: null, dialog: null, toast: null, ob: 0,
  add: null, an: null, pl: null, adj: null,
  a2hsHidden: false, // ホーム画面の「ホーム画面に追加」の案内を×で閉じた
};
// 実行中だけの情報：開いた元動画（試合ID → {file,url,source} / null=見つからない / {needsPermission}）、サムネイルの URL
const L = { open: {}, thumbs: {}, tReq: new Set(), scroll: {}, noSave: new Set() }; // noSave: 「保存しない」を選んだ試合（このページを開いている間）
const root = document.getElementById('app');
const scr = () => S.stack[S.stack.length - 1];
const cur = () => S.matches.find((m) => m.id === S.cur) || null;
const sorted = (m) => m.rallies.slice().sort((a, b) => a.start - b.start);
const inF = (r) => S.filter === 'all' || r.star;
const status = (m) => (m.clip ? 'saved' : L.open[m.id] === null ? 'missing' : 'unsaved');
const ST = { saved: '保存済み', unsaved: '未保存', missing: '元動画なし' };
const canEdit = (m) => status(m) === 'unsaved';
const co = (m, r) => (m.clip ? r.co || 0 : 0); // 保存した動画での時刻のずれ（元動画の時刻 + co = 保存した動画の時刻）
const fps = (m) => m.fps || 30;
let saveTimer = 0;
const saveMatch = (m) => DB.putMatch(m).catch((e) => toast('保存できませんでした：' + errMsg(e)));
const saveSoon = (m) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveMatch(m), 400); };

function toast(msg) {
  S.toast = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { S.toast = null; const el = root.querySelector('.toast'); if (el) el.remove(); }, 2400);
  const el = root.querySelector('.toast');
  if (el) el.textContent = msg; else root.insertAdjacentHTML('beforeend', `<div class="toast">${esc(msg)}</div>`);
}

// ---------- 動画（画面をまたいで1つの <video> を使い回す）
const V = document.createElement('video');
V.playsInline = true; V.setAttribute('playsinline', ''); V.setAttribute('webkit-playsinline', ''); V.preload = 'auto';
const PB = { a: 0, b: 0, onEnd: null, seeking: 0 }; // いま再生している範囲（動画の時刻）と、終わりに来たときの処理

async function mediaUrl(m) {
  if (m.clip) { try { return await P.clipUrl(m.clip); } catch (e) { return null; } }
  const o = L.open[m.id];
  return o && o.url ? o.url : null;
}
function setSrc(url) {
  if (!url) { if (V.getAttribute('src')) { V.removeAttribute('src'); V.load(); } return; }
  if (V.src !== url) { V.src = url; V.load(); }
}
async function prepMedia(m) { setSrc(await mediaUrl(m)); }
async function seek(t) {
  if (V.readyState < 1) await once(V, 'loadedmetadata', 15000).catch(() => {});
  if (Math.abs(V.currentTime - t) < 0.005) return;
  const p = once(V, 'seeked', 4000).catch(() => {});
  V.currentTime = t;
  await p;
}
async function playSpan(a, b, onEnd, from) {
  PB.a = a; PB.b = b; PB.onEnd = onEnd;
  PB.seeking++; // シークが終わるまでは「終わりに来た」と判定しない
  try { await seek(from != null ? from : a); } finally { PB.seeking--; }
  if (PB.a === a && PB.b === b) V.play().catch(() => {});
}
function rallySpan(m, r) { const c = co(m, r); return [r.start + c, r.end + c]; }

// 再生位置に合わせて、表示を部分的に更新する（毎フレーム。全体の描き直しはしない）
function checkEnd() { if (!V.paused && !PB.seeking && PB.onEnd && V.currentTime >= PB.b - 0.02) { const f = PB.onEnd; f(); } }
function tickLoop() {
  checkEnd();
  liveUpdate();
  requestAnimationFrame(tickLoop);
}
// 画面が裏に回るなどで requestAnimationFrame が止まっても、範囲の終わりは timeupdate（約4回/秒）で拾う
V.addEventListener('timeupdate', () => { checkEnd(); if (document.hidden) liveUpdate(); });
function setText(id, t) { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; }
function setW(id, pct) { const el = document.getElementById(id); if (el) el.style.width = clamp(pct, 0, 100) + '%'; }
function liveUpdate() {
  root.dataset.paused = V.paused ? '1' : '0';
  const cs = scr(), len = PB.b - PB.a, t = clamp(V.currentTime - PB.a, 0, Math.max(0, len));
  if (cs === 'match' || cs === 'player') {
    setText('vTime', `${mmss(t)} / ${mmss(len)}`);
    setW('vBar', len > 0 ? (t / len) * 100 : 0);
  } else if (cs === 'adjust' && S.adj && !V.paused) {
    S.adj.pt = V.currentTime; updAdj(true);
  }
}

// ---------- 描画
function render() {
  // スクロール位置を保つ
  root.querySelectorAll('[data-sk]').forEach((el) => { L.scroll[el.dataset.sk] = el.scrollTop; });
  const cs = scr();
  const html = (SCREENS[cs] || SCREENS.home)() + sheetHtml() + dlgHtml() + (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : '');
  root.innerHTML = html;
  root.classList.toggle('wide', cs === 'player' && isLand());
  const slot = root.querySelector('[data-vslot]');
  if (slot) slot.prepend(V); else if (V.parentNode) { V.pause(); V.remove(); }
  root.querySelectorAll('[data-sk]').forEach((el) => { if (L.scroll[el.dataset.sk]) el.scrollTop = L.scroll[el.dataset.sk]; });
  AFTER[cs] && AFTER[cs]();
  liveUpdate();
  trapBack();
}
// サムネイルが届いたときなどの描き直し（入力中・ドラッグ中は待つ）
let softT = 0;
function softRender() {
  clearTimeout(softT);
  softT = setTimeout(() => {
    const ae = document.activeElement;
    if (S.sheet || S.dialog || (S.add && S.add.drag >= 0) || (ae && /INPUT|TEXTAREA/.test(ae.tagName))) return;
    if (['home', 'match'].includes(scr())) render();
  }, 120);
}

// ---------- シート・ダイアログの上では、縦に引っぱってもブラウザが再読み込みしないようにする
// （中身がスクロールできるときだけ、そのスクロールは通す）
// それ以外の画面でも、いちばん上で下に引っぱったとき（＝引っぱって再読み込み）は止める。
// iPhone では再読み込みすると元動画を選び直すことになり、beforeunload の確認も出ないため。
let touchY = 0, touchX = 0;
root.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; touchX = e.touches[0].clientX; }, { passive: true });
root.addEventListener('touchmove', (e) => {
  const dy = e.touches[0].clientY - touchY, dx = e.touches[0].clientX - touchX;
  if (!e.target.closest('.sheet-w, .dlg-w')) {
    if (dy <= 0 || Math.abs(dx) > dy) return; // 下向きの縦の動きだけ
    for (let el = e.target; el && el !== root; el = el.parentElement) {
      if (el.scrollTop > 0 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return; // 中身を上へ戻すスクロールは通す
    }
    if (e.cancelable) e.preventDefault();
    return;
  }
  for (let el = e.target; el && !el.classList.contains('sheet-w') && !el.classList.contains('dlg-w'); el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
      if ((dy > 0 && el.scrollTop > 0) || (dy < 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return;
      break;
    }
  }
  if (e.cancelable) e.preventDefault();
}, { passive: false });

// ---------- 保存せずに離れようとしたら、保存を促す
// iPhone など、元動画を選び直さないと開き直せない（ファイルのハンドルを持てない）とき
function unsavedFile(m) {
  return !!m && status(m) === 'unsaved' && m.rallies.length > 0 && !!m.source && m.source.kind === 'file';
}
function needsSave(m) { return unsavedFile(m) && !L.noSave.has(m.id); }
function askSave(m, proceed) {
  if (!needsSave(m)) return false;
  S.dialog = {
    title: 'ラリー動画を保存しますか？',
    body: '保存しないと、ページを開き直したときに元の動画を選び直す必要があります。保存しておくと、元の動画がなくても見られます。',
    ok: '保存する', pri: true, onOk: () => A.save(),
    no: '保存しない', onNo: () => { L.noSave.add(m.id); proceed(); },
  };
  render();
  return true;
}
// 再読み込み・タブを閉じる（PC・Android のブラウザでは確認が出る。iPhone では出ないので、引っぱって再読み込みを止めている）
addEventListener('beforeunload', (e) => {
  if (S.matches.some((m) => needsSave(m) && L.open[m.id] && L.open[m.id].url)) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- 戻る（Android の戻るボタン・Esc）
function depth() { return S.stack.length - 1 + (S.sheet ? 1 : 0) + (S.dialog ? 1 : 0); }
function trapBack() { if (depth() > 0 && !(history.state && history.state.trap)) history.pushState({ trap: true }, ''); }
addEventListener('popstate', () => { if (depth() > 0) back(); });
// アプリ（Capacitor）：@capacitor/app を入れていれば、Android の戻るボタンをここで受ける
const AppPlugin = P.native && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
if (AppPlugin) AppPlugin.addListener('backButton', () => { if (depth() > 0) back(); else AppPlugin.exitApp(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });

function go(name, patch) { Object.assign(S, patch || {}); leave(scr()); S.stack.push(name); render(); }
function replaceTop(name) { leave(scr()); S.stack[S.stack.length - 1] = name; render(); }
function back() {
  if (S.dialog) { S.dialog = null; return render(); }
  if (S.sheet) return closeSheet();
  if (S.stack.length < 2) return;
  const was = scr();
  if (was === 'analyze') return cancelAnalysis();
  if (was === 'match' && askSave(cur(), back)) return;
  leave(was); S.stack.pop();
  if (was === 'player' || was === 'adjust') returnToMatch();
  render();
}
function leave(name) {
  if (name === 'player') { V.pause(); V.playbackRate = 1; exitLand(); }
  if (name === 'match' || name === 'adjust' || name === 'corners') V.pause();
}
function closeSheet() {
  const sh = S.sheet;
  if (sh && sh.stage === 'progress') return;
  S.sheet = null;
  render();
}

// ================================================================ 画面
const SCREENS = {}, AFTER = {};

// ---------- はじめに（3枚）・撮影のコツ
const TIPS_HTML = `
<div style="display:flex;flex-direction:column;gap:6px"><span class="kicker">03 撮り方</span><span class="ob-ttl">三脚で固定して、台全体を入れて撮ります</span></div>
<div class="ex">
 <div style="display:flex;flex-direction:column;gap:8px"><div class="bp frame">${CORNERS}<div class="ph"><div class="net"></div></div></div>
  <div class="h" style="display:flex;align-items:center;gap:6px;font-size:15px;color:var(--accent-ink)">${I.check(18)}良い例</div>
  <span style="font-size:13px;line-height:1.5" class="muted">台の斜め後ろから。4つの角が見える</span></div>
 <div style="display:flex;flex-direction:column;gap:8px"><div class="bp frame">${CORNERS}<div class="ph bad"></div></div>
  <div class="h" style="display:flex;align-items:center;gap:6px;font-size:15px;color:var(--warn)">${sv('<path d="M18 6 6 18M6 6l12 12"/>', 18)}悪い例</div>
  <span style="font-size:13px;line-height:1.5" class="muted">近すぎて台が切れている。手持ちで傾いている</span></div>
</div>
<div class="list-l">
 <div><span class="n">1</span><div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:15px">三脚で固定する</b><span style="font-size:13px" class="muted">手持ちだと、うまく見つけられないことがあります</span></div></div>
 <div><span class="n">2</span><div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:15px">台の斜め後ろから</b><span style="font-size:13px" class="muted">ネットと両方のコートが見える位置に</span></div></div>
 <div><span class="n">3</span><div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:15px">台全体を画面に入れる</b><span style="font-size:13px" class="muted">4つの角がすべて映るように</span></div></div>
</div>`;
const OB_PAGES = [
  `<div style="display:flex;flex-direction:column;gap:6px"><span class="kicker">01 使い方</span><span class="ob-ttl">選んで、待つだけ</span></div>
   <div style="display:flex;flex-direction:column;gap:14px">
   ${[['動画を選ぶ', '写真ライブラリから試合の動画を選びます'], ['台の4つの角をタップ', '台の位置を教えると、ラリーを見つけやすくなります'], ['自動でラリーだけになる', '3分の動画なら、約10秒で終わります']]
    .map(([t, d], i) => `<div class="bp frame ob-step">${CORNERS}<span class="n">${i + 1}</span><div style="display:flex;flex-direction:column;gap:4px"><b style="font-size:16px">${t}</b><span style="font-size:13px;line-height:1.5" class="muted">${d}</span></div></div>`).join('')}
   </div>`,
  `<div style="display:flex;flex-direction:column;gap:6px"><span class="kicker">02 安心</span><span class="ob-ttl">動画は、どこにも送りません</span></div>
   <div class="bp frame illus" style="aspect-ratio:4/3">${CORNERS}<span>イラスト：スマホの中で完結する</span></div>
   <p style="margin:0;font-size:16px;line-height:1.7">ラリーを探す解析は、このスマホの中だけで行います。お子さんの映像がサーバーに上がることはありません。</p>
   <div class="muted" style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:14px"><span style="color:var(--accent)">${I.check(20)}</span>通信なしで、解析も再生もできます</div>`,
  TIPS_HTML,
];
function obScreen(tips) {
  const p = tips ? 2 : S.ob;
  return `<div class="scr">
  <div class="nav" style="justify-content:space-between;padding:0 8px">
   ${tips ? `<button class="btn-t" data-a="back">${I.back}設定</button>` : `<span class="appname" style="padding-left:12px">（アプリ名）</span><button class="btn-t muted" style="font-size:15px;color:var(--ink-2)" data-a="obDone">スキップ</button>`}
  </div>
  <div class="ob-body">${OB_PAGES[p]}</div>
  <div class="ob-foot">
   ${tips ? '' : `<div class="dots">${[0, 1, 2].map((i) => `<span class="${i === p ? 'on' : ''}"></span>`).join('')}</div>`}
   <button class="btn-p bp" data-a="${tips ? 'back' : 'obNext'}">${CORNERS}${tips ? '閉じる' : p < 2 ? '次へ' : 'はじめる'}</button>
  </div></div>`;
}
SCREENS.onboard = () => obScreen(false);
SCREENS.tips = () => obScreen(true);

// ---------- ホーム画面に追加（PWA）
// iPhone はブラウザから追加できる仕組みがないので、手順を案内する。Android・PC の Chrome は beforeinstallprompt で追加できる。
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (['home', 'settings'].includes(scr())) render(); });
addEventListener('appinstalled', () => { installEvt = null; if (['home', 'settings'].includes(scr())) render(); });
const canInstall = () => !P.native && !standalone() && (IOS || !!installEvt);
const a2hsBar = () => (canInstall() && !S.a2hsHidden ? `<div class="savebar a2hs"><div style="flex:1;display:flex;flex-direction:column;gap:2px"><b>ホーム画面に追加</b><span>保存した動画が消えにくくなり、通信がなくても開けます。</span></div><button data-a="install">${IOS ? '方法を見る' : '追加する'}</button><button class="ico" data-a="a2hsHide" aria-label="閉じる">${I.x}</button></div>` : '');

// ---------- ホーム
function thumbHtml(m, r) {
  if (!r) return '';
  const key = m.id + '/' + r.id, u = L.thumbs[key];
  if (u) return `<img src="${u}" alt="">`;
  requestThumb(m, r, key);
  return '';
}
SCREENS.home = () => {
  const ms = S.matches;
  const cards = ms.map((m) => {
    const st = status(m), rs = sorted(m);
    return `<button class="mcard bp" data-a="open" data-id="${m.id}">${CORNERS}
     <div class="in">
      <div class="ph" style="opacity:${st === 'missing' ? 0.4 : 1}">${thumbHtml(m, rs[Math.min(1, rs.length - 1)])}<span class="ov" style="right:3px;bottom:3px;background:rgba(0,0,0,.6);padding:0 4px;text-shadow:none">${mmss(m.dur)}</span></div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
       <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px" class="muted">${fmtDate(m.date)}</span><span class="badge ${st}">${ST[st]}</span></div>
       <span class="t">${m.opp ? 'vs ' + esc(m.opp) : '対戦相手なし'}</span>
       <span style="font-size:14px" class="muted">${esc(m.title) || '大会名なし'}</span>
       <div class="h" style="display:flex;gap:12px;align-items:baseline;margin-top:2px;font-size:15px"><span>${rs.length}<span style="font:400 12px var(--font);color:var(--ink-2)"> ラリー</span></span><span style="color:var(--star)">★ ${rs.filter((r) => r.star).length}</span></div>
      </div>
     </div>
     ${st === 'missing' ? '<div class="miss"><span>元動画が見つかりません</span><span>選び直す ›</span></div>' : ''}
    </button>`;
  }).join('');
  const addBtn = `<button class="btn-p big bp" data-a="add">${CORNERS}${I.plus}動画を追加</button>`;
  return `<div class="scr">
   <div class="none" style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px 0 20px"><span class="appname">（アプリ名）</span><button class="ico" data-a="settings" aria-label="設定">${I.set}</button></div>
   <div class="bigttl">試合</div>
   ${a2hsBar()}
   ${ms.length ? `<div class="scroll" data-sk="home" style="padding:8px 20px 20px;display:flex;flex-direction:column;gap:20px">${cards}</div>` : `
   <div class="grow" style="display:flex;flex-direction:column;justify-content:center;padding:0 28px 24px;gap:18px">
    <div class="bp frame illus" style="aspect-ratio:16/10">${CORNERS}<span>イラスト：試合動画 → ラリーだけ</span></div>
    <span class="h" style="font-size:26px;line-height:1.3">試合の動画を選ぶと、ラリーだけになります</span>
    <span class="muted" style="font-size:15px;line-height:1.7">球拾いや休けいの時間を自動で飛ばします。解析はこのスマホの中だけで行います。</span>
    ${addBtn}
    <button class="btn-t ink" style="align-self:center" data-a="tips">撮影のコツを見る</button>
   </div>`}
   ${ms.length || adHtml() ? `<div class="home-foot">${ms.length ? addBtn : ''}${adHtml()}</div>` : '<div class="safe-b"></div>'}
  </div>`;
};

// ---------- 台の位置
const ROI_ABOVE = 0.4; // 台の上の空間（球が飛ぶところ）を、台の幅の何倍まで含めるか（未検証の目安）
// 台の4隅（0〜1）→ 球用ROI（640×◯ 基準。detect.js の PARAMS.roi と同じ形）
function roiFrom(c, w, h) {
  if (!c || c.length < 4) return null;
  const BW = 640, BH = Math.round(640 * h / w);
  const xs = c.map((p) => p.x * BW), ys = c.map((p) => p.y * BH);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const rx = clamp(Math.floor(x0), 0, BW - 16), ry = clamp(Math.floor(y0 - ROI_ABOVE * (x1 - x0)), 0, BH - 16);
  const rx1 = clamp(Math.ceil(x1), rx + 16, BW), ry1 = clamp(Math.ceil(y1), ry + 16, BH);
  return { x: rx, y: ry, w: rx1 - rx, h: ry1 - ry };
}
// 4点が台の形（凸な四角形・角度・面積）として自然か。順番は中心のまわりの角度で並べ直す
function quad(pts, ar) {
  if (pts.length < 4) return { ok: true, o: pts };
  const cx = pts.reduce((a, p) => a + p.x, 0) / 4, cy = pts.reduce((a, p) => a + p.y, 0) / 4;
  const o = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const Q = o.map((p) => ({ x: p.x * ar, y: p.y }));
  let area = 0, sign = 0, ok = true;
  for (let i = 0; i < 4; i++) {
    const a = Q[(i + 3) % 4], b = Q[i], c = Q[(i + 1) % 4];
    area += b.x * c.y - c.x * b.y;
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) ok = false;
    const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
    const ang = Math.acos(clamp((ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1), -1, 1)) * 180 / Math.PI;
    if (ang < 25 || ang > 160) ok = false;
  }
  if (Math.abs(area) / 2 < 0.04) ok = false;
  return { ok, o };
}
SCREENS.corners = () => {
  const a = S.add;
  return `<div class="scr corners">
   <div class="nav3"><button class="btn-t" style="color:#a9cbef;padding-left:16px" data-a="back">キャンセル</button><span class="ttl">台の位置</span><span></span></div>
   <div class="none" style="padding:12px 20px 16px;display:flex;flex-direction:column;gap:6px">
    <div style="display:flex;align-items:baseline;justify-content:space-between"><span class="h" style="font-size:24px">台の4つの角をタップ</span><span class="h" style="font-size:22px;color:#a9cbef"><span id="cCount">0</span><span style="color:rgba(255,255,255,.5)"> / 4</span></span></div>
    <span style="font-size:13px;line-height:1.5;color:rgba(255,255,255,.7)">点はドラッグで直せます。動かしている間は、指の下が拡大されます。</span>
   </div>
   <div class="cframe" id="cframe" data-vslot style="aspect-ratio:${a.w}/${a.h};max-height:52vh">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon id="cPoly" style="stroke-width:1.5px;vector-effect:non-scaling-stroke;stroke-linejoin:round"/></svg>
    <div id="cPts"></div>
    <div class="loupe" id="loupe" hidden><canvas width="208" height="208"></canvas></div>
   </div>
   <div class="none" style="padding:14px 20px 0" id="cInfo"></div>
   <div class="grow"></div>
   <div class="none" style="padding:0 20px 16px;display:flex;flex-direction:column;gap:6px">
    <div style="display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,.7)"><span>台がよく見えるコマを選ぶ</span><span class="h" style="font-size:14px" id="cFrameL"></span></div>
    <input type="range" class="frame-sl" id="cFrame" min="0" max="1000" value="${Math.round(a.frameT * 1000)}">
   </div>
   <div class="none" style="padding:0 16px var(--safe-b);display:grid;grid-template-columns:1fr 2fr;gap:10px">
    <button class="cbtn2" data-a="cReset">やり直す</button>
    <button class="cgo bp" id="cGo" data-a="cStart">${CORNERS}<span id="cGoL">解析をはじめる</span></button>
   </div></div>`;
};
AFTER.corners = () => {
  const el = document.getElementById('cframe'), a = S.add;
  const xy = (e) => { const r = el.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1), w: r.width, h: r.height }; };
  el.onpointerdown = (e) => {
    const p = xy(e); let idx = -1, best = 1e9;
    a.corners.forEach((q, i) => { const d = Math.hypot((q.x - p.x) * p.w, (q.y - p.y) * p.h); if (d < best) { best = d; idx = i; } });
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* 無視 */ }
    if (best > 30) { if (a.corners.length >= 4) return; a.corners.push({ x: p.x, y: p.y }); a.drag = a.corners.length - 1; } else a.drag = idx;
    updCorners();
  };
  el.onpointermove = (e) => { if (a.drag < 0) return; const p = xy(e); a.corners[a.drag] = { x: p.x, y: p.y }; updCorners(); };
  el.onpointerup = el.onpointercancel = () => { if (a.drag >= 0) { a.drag = -1; updCorners(); } };
  const sl = document.getElementById('cFrame');
  sl.oninput = () => { a.frameT = sl.value / 1000; if (a.dur) { V.currentTime = a.frameT * a.dur; } updCorners(); };
  updCorners();
};
function updCorners() {
  const a = S.add; if (!a || scr() !== 'corners') return;
  const cp = a.corners, q = quad(cp, a.w / a.h), warn = cp.length === 4 && !q.ok;
  const poly = document.getElementById('cPoly');
  poly.setAttribute('points', q.o.map((c) => c.x * 100 + ',' + c.y * 100).join(' '));
  poly.style.fill = cp.length === 4 ? (warn ? 'rgba(230,140,60,.18)' : 'rgba(120,170,230,.2)') : 'none';
  poly.style.stroke = warn ? '#e8a060' : '#a9cbef';
  document.getElementById('cPts').innerHTML = cp.map((c, i) => { const sz = i === a.drag ? 34 : 26; return `<div class="cpt" style="left:${c.x * 100}%;top:${c.y * 100}%;width:${sz}px;height:${sz}px"><span>${i + 1}</span></div>`; }).join('');
  setText('cCount', String(cp.length));
  document.getElementById('cInfo').innerHTML = warn
    ? `<div class="cwarn">${I.info(20)}<span>台の形になっていないようです。4つの点を、台のふちの角に合わせてみてください。</span></div>`
    : `<div style="font-size:14px;color:${cp.length === 4 ? '#a9cbef' : 'rgba(255,255,255,.6)'}">${cp.length < 4 ? `あと${4 - cp.length}か所` : '4つの角がそろいました'}</div>`;
  const go = document.getElementById('cGo');
  go.disabled = cp.length < 4; go.style.opacity = cp.length === 4 ? 1 : 0.45;
  setText('cGoL', warn ? 'このまま解析する' : '解析をはじめる');
  setText('cFrameL', a.dur ? `${mmss(a.frameT * a.dur)} / ${mmss(a.dur)}` : '');
  // 指の下の拡大（3倍）
  const lp = document.getElementById('loupe'), d = a.drag >= 0 ? cp[a.drag] : null;
  lp.hidden = !d;
  if (d && V.videoWidth) {
    const fr = document.getElementById('cframe').getBoundingClientRect();
    lp.style.left = `calc(${d.x * 100}% - 52px)`;
    lp.style.top = d.y * fr.height > 124 ? `calc(${d.y * 100}% - 140px)` : `calc(${d.y * 100}% + 36px)`;
    const g = lp.firstChild.getContext('2d'), sw = (104 / 3) * (V.videoWidth / fr.width), sh = (104 / 3) * (V.videoHeight / fr.height);
    g.fillStyle = '#25292c'; g.fillRect(0, 0, 208, 208);
    try { g.drawImage(V, d.x * V.videoWidth - sw / 2, d.y * V.videoHeight - sh / 2, sw, sh, 0, 0, 208, 208); } catch (_) { /* 未読み込み */ }
  }
}

// ---------- 解析中
SCREENS.analyze = () => `<div class="scr">
  <div class="none" style="padding:28px 24px 0;display:flex;flex-direction:column;gap:4px"><span class="h" style="font-size:28px">ラリーを探しています</span><span style="font-size:14px" class="muted">${jlen(S.an.dur)}の動画</span></div>
  <div class="none" style="padding:28px 24px 0;display:flex;flex-direction:column;gap:10px">
   <div style="display:flex;align-items:baseline;justify-content:space-between"><span class="h" style="font-size:76px;line-height:.9;font-variant-numeric:tabular-nums"><span id="anPct">0</span><span style="font-size:32px">%</span></span><span class="h muted" style="font-size:18px" id="anRemain">準備しています…</span></div>
   <div class="bar6"><div id="anBar"></div></div>
  </div>
  <div class="bp frame none" style="margin:28px 24px 0;padding:16px;display:flex;flex-direction:column;gap:12px">${CORNERS}
   <div style="display:flex;align-items:baseline;justify-content:space-between"><span style="font-size:14px" class="muted">見つかったラリー</span><span class="h" style="font-size:44px;line-height:1;color:var(--accent-ink)"><span id="anFound">0</span><span style="font:400 14px var(--font);color:var(--ink-2)"> 本</span></span></div>
   <div class="anseg" id="anSegs"></div>
  </div>
  <div class="none" style="margin:16px 24px 0;display:flex;gap:10px;font-size:14px;line-height:1.6"><span style="color:var(--warn);margin-top:2px">${I.info(20)}</span><div style="display:flex;flex-direction:column"><b>解析中は画面を閉じないでください</b><span class="muted" style="font-size:13px">ほかのアプリに切り替えると、解析が止まります。</span></div></div>
  <div class="grow"></div>
  <div class="none" style="padding:0 24px 14px"><button class="btn-s" style="width:100%;font-size:17px" data-a="back">キャンセル</button></div>
  ${adHtml()}
  <div class="safe-b"></div></div>`;
AFTER.analyze = () => updAn();
function updAn() {
  const an = S.an; if (!an || scr() !== 'analyze') return;
  const p = an.total ? (an.done / an.total) * 100 : 0;
  setText('anPct', String(Math.floor(p)));
  setW('anBar', p);
  if (an.done > 30) setText('anRemain', `残り 約${Math.max(1, Math.ceil(an.elapsed / an.done * (an.total - an.done) / 1000))}秒`);
  setText('anFound', String(an.found.length));
  const box = document.getElementById('anSegs');
  if (box) box.innerHTML = an.found.map(([a, b]) => `<div style="left:${a / an.dur * 100}%;width:${Math.max(0.6, (b - a) / an.dur * 100)}%"></div>`).join('') + `<div class="scan" style="left:${p}%"></div>`;
}

// ---------- 試合画面
SCREENS.match = () => {
  const m = cur(); if (!m) return SCREENS.home();
  const st = status(m), missing = st === 'missing', edit = canEdit(m);
  const rs = sorted(m), fl = rs.filter(inF), selR = fl.find((r) => r.id === S.sel) || fl[0] || null;
  const no = (r) => rs.indexOf(r) + 1, stars = rs.filter((r) => r.star).length;
  const segs = rs.map((r) => {
    const on = selR && r.id === selR.id;
    return `<div class="sg ${on ? 'on' : inF(r) ? '' : 'off'}" style="left:${r.start / m.dur * 100}%;width:${Math.max(0.5, (r.end - r.start) / m.dur * 100)}%"></div>`;
  }).join('');
  const rows = fl.map((r) => {
    const on = selR && r.id === selR.id;
    return `<div class="row ${on ? 'on' : ''}">
     <button class="main" data-a="sel" data-id="${r.id}">
      <div class="ph" style="opacity:${missing ? 0.5 : 1}">${thumbHtml(m, r)}<span class="ov" style="left:3px;bottom:2px">${secs(r.end - r.start)}</span></div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
       <div style="display:flex;align-items:baseline;gap:8px"><span class="no">ラリー ${no(r)}</span><span class="h muted" style="font-size:14px">${mmss(r.start)}</span></div>
       ${r.comment ? `<span class="clamp2">${esc(r.comment)}</span>` : ''}
      </div>
     </button>
     <button class="ico cm ${r.comment ? 'has' : ''}" data-a="comment" data-id="${r.id}" aria-label="コメント">${I.cm()}</button>
     ${edit ? `<button class="adjb" data-a="adjust" data-id="${r.id}">調整</button>` : ''}
     <button class="ico st ${r.star ? 'on' : ''}" data-a="star" data-id="${r.id}" aria-label="★">${I.star()}</button>
    </div>`;
  }).join('');
  const contDis = missing || !fl.length;
  return `<div class="scr">
   <div class="mhead">
    <button class="btn-t" style="padding:0 8px 0 4px" data-a="back">${I.back}試合</button>
    <button class="mid" data-a="info"><span class="h" style="font-size:16px;line-height:1.1">${m.opp ? 'vs ' + esc(m.opp) : '対戦相手なし'}</span><span style="font-size:11px" class="muted">${fmtDate(m.date)} · ${esc(m.title) || '大会名なし'}</span></button>
    <span class="badge ${st}">${ST[st]}</span>
    <button class="btn-t" style="padding:0 10px 0 6px" data-a="info">編集</button>
   </div>
   <div class="vbox" ${missing ? '' : 'data-vslot'}>
    ${missing ? `<div class="ph" style="position:absolute;inset:0;opacity:.4"></div><div class="vmiss"><span class="h" style="font-size:18px">元動画が見つかりません</span><span style="font-size:12px;color:rgba(255,255,255,.7)">再生するには、動画を選び直してください</span></div>` : `
    <span class="lbl">${selR ? 'ラリー ' + no(selR) : ''}</span>
    <button class="tap" data-a="mpToggle" aria-label="再生"><span class="playdot when-paused">${I.play(26)}</span></button>
    <button class="full" data-a="cont" aria-label="全画面">${I.full}</button>
    <span class="tm" id="vTime"></span>
    <div class="pbar"><div id="vBar"></div></div>`}
   </div>
   <div class="scroll" data-sk="match">
   ${unsavedFile(m) ? `<div class="savebar"><div style="flex:1;display:flex;flex-direction:column;gap:2px"><b>調整が済んだら保存してください</b><span>保存後は調整できません。保存すると元の動画なしで見られます。</span></div><button data-a="save">保存する</button></div>` : ''}
   ${!m.title && !m.opp ? '<button class="infobar" data-a="info"><span>対戦相手と大会名を入力</span><span>›</span></button>' : ''}
   ${missing ? '<div class="missbar"><span style="flex:1;font-size:13px;line-height:1.5;font-weight:600">写真ライブラリから同じ動画を選ぶと、また再生できます。★とサムネイルは残っています。</span><button data-a="relink">動画を選び直す</button></div>' : ''}
   <div class="tl">
    <div class="hd"><span class="sec-l">タイムライン</span>
     ${edit ? `<button class="add" data-a="addMissed">${I.plus16}見逃したラリーを追加</button>` : ''}
     ${st === 'saved' ? '<span style="font-size:12px" class="muted">保存済み：ラリーの部分だけ再生できます</span>' : ''}
    </div>
    <div class="tlbar" data-a="tl"><div class="bg ${st === 'saved' ? 'saved' : ''}" id="tlbg">${segs}</div></div>
    <div class="tlax"><span>0:00</span><span>${mmss(m.dur)}</span></div>
   </div>
   <div class="chips">
    <button class="chip ${S.filter === 'all' ? 'on' : ''}" data-a="filter" data-f="all"><span class="l">すべて</span><span class="c">${rs.length}</span></button>
    <button class="chip star ${S.filter === 'star' ? 'on' : ''}" data-a="filter" data-f="star"><span class="l">★</span><span class="c">${stars}</span></button>
   </div>
    <div class="lhead"><span class="h" style="font-size:18px">${S.filter === 'star' ? `${fl.length}本 / 全${rs.length}本` : `${rs.length}本のラリー`}</span><span style="font-size:12px" class="faint">${esc(m.opp)}</span></div>
    ${!rs.length ? '<div class="empty">ラリーが見つかりませんでした。<br>「見逃したラリーを追加」で手動で追加できます。</div>' : !fl.length ? '<div class="empty">★のラリーはありません</div>' : ''}
    ${fl.length ? `<div class="rows">${rows}</div>` : ''}
    ${adHtml() ? `<div style="padding:20px 0 8px">${adHtml()}</div>` : ''}
    <div style="height:16px"></div>
   </div>
   <div class="mfoot">
    <button class="btn-p bp" style="flex:1;min-width:0" data-a="cont" ${contDis ? 'disabled' : ''}>${CORNERS}${I.play(18)}続けて再生（${fl.length}本）</button>
    <button class="sq ${missing ? 'dis' : ''}" data-a="save" aria-label="${st === 'saved' ? '保存済み' : 'ラリー動画を保存'}">${I.down}${st === 'saved' ? '保存済み' : '保存'}</button>
    <button class="sq ${missing ? 'dis' : ''}" data-a="exp" aria-label="書き出し">${I.up()}書き出し</button>
   </div></div>`;
};
AFTER.match = () => {
  const m = cur(); if (!m) return;
  const fl = sorted(m).filter(inF), selR = fl.find((r) => r.id === S.sel) || fl[0];
  if (selR && S.sel !== selR.id) S.sel = selR.id;
  // 選んでいるラリーの範囲に合わせる（再生中でなければ先頭を表示）
  if (selR && status(m) !== 'missing') {
    const [a, b] = rallySpan(m, selR);
    if (PB.a !== a || PB.b !== b) { PB.a = a; PB.b = b; PB.onEnd = () => V.pause(); if (V.paused) seek(a); }
  }
};

// ---------- 再生画面（続けて再生）
const isLand = () => !!(S.pl && (S.pl.land || innerWidth > innerHeight));
function plCur() {
  const m = cur(), pl = S.pl; if (!m || !pl) return {};
  const rs = sorted(m), r = m.rallies.find((x) => x.id === pl.list[pl.idx]) || rs[0];
  return { m, pl, r, no: rs.indexOf(r) + 1 };
}
SCREENS.player = () => {
  const { pl, r, no } = plCur(); if (!r) return SCREENS.match();
  const len = r.end - r.start, speeds = [1, 0.5, 0.25];
  const spd = (cls) => speeds.map((v) => `<button class="btn-d ${pl.speed === v ? 'on' : 'off'} ${cls}" data-a="speed" data-v="${v}">${v}×</button>`).join('');
  const star = `${I.star(24)}${r.star ? '★を付けました' : '★を付ける'}`;
  const cmb = `<button class="cmbtn ${r.comment ? 'has' : ''}" data-a="comment" data-id="${r.id}">${I.cm(20)}<span>${esc(r.comment) || 'コメントを書く'}</span></button>`;
  const ended = pl.ended ? '<div class="ended"><span class="h" style="font-size:20px">最後まで再生しました</span><button data-a="replay">はじめから</button></div>' : '';
  if (isLand()) {
    return `<div class="land">
     <div class="vfill" data-vslot><button class="tap" data-a="plToggle" aria-label="再生/一時停止"></button>${ended}</div>
     <div class="grad-t"></div><div class="grad-b"></div>
     <div class="bar-t">
      <button class="btn-d x" style="width:44px;padding:0;background:rgba(0,0,0,.3)" data-a="back" aria-label="閉じる">${I.x}</button>
      <span class="h" style="font-size:24px;padding:0 6px">${pl.idx + 1} / ${pl.list.length}</span><span style="font-size:13px;color:rgba(255,255,255,.75)">ラリー ${no} · ${mmss(r.start)}から · ${secs(len)}</span>
      <span class="grow"></span>
      ${spd('')}<button class="btn-d ${pl.loop ? 'on' : 'off'}" style="width:48px;padding:0" data-a="loop" aria-label="くり返し">${I.loop(18)}</button>
      <button class="btn-d" style="background:rgba(0,0,0,.3)" data-a="rotate">縦向き</button>
     </div>
     <button class="side" style="left:max(env(safe-area-inset-left),16px);opacity:${pl.idx === 0 ? 0.3 : 1}" data-a="prev" aria-label="前のラリー">${I.prev(26)}</button>
     <button class="side" style="right:max(env(safe-area-inset-right),16px);opacity:${pl.idx === pl.list.length - 1 ? 0.3 : 1}" data-a="next" aria-label="次のラリー">${I.next(26)}</button>
     <div class="ctr playdot when-paused" style="width:68px;height:68px">${I.play(30)}</div>
     <div class="bar-b">
      <div style="display:flex;align-items:center;gap:10px"><div class="pbar2" style="flex:1"><div id="vBar"></div></div><span class="h" style="font-size:14px" id="vTime"></span></div>
      <div style="display:flex;align-items:center;gap:6px">${cmb}<span class="grow"></span><button class="starbtn ${r.star ? 'on' : ''}" style="height:52px;padding:0 20px;font-size:18px" data-a="plStar">${star}</button></div>
     </div></div>`;
  }
  return `<div class="scr dark">
   <div class="pl-top">
    <button class="btn-d x" data-a="back" aria-label="閉じる">${I.x}</button>
    <span class="h" style="text-align:center;font-size:24px">${pl.idx + 1} / ${pl.list.length}</span>
    <button class="btn-d" data-a="rotate">横向き</button>
   </div>
   <div class="grow pl-mid" style="display:flex;flex-direction:column;justify-content:center;min-height:0">
    <div class="vbox pl-v" data-vslot style="background:#000"><button class="tap" data-a="plToggle" aria-label="再生/一時停止"><span class="playdot when-paused" style="width:64px;height:64px">${I.play(28)}</span></button>${ended}</div>
    <div style="padding:12px 20px 0;display:flex;flex-direction:column;gap:8px;flex:none">
     <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="h" style="font-size:22px">ラリー ${no}</span><span class="h" style="font-size:15px;color:rgba(255,255,255,.7)" id="vTime"></span></div>
     <div class="pbar2"><div id="vBar"></div></div>
     <span style="font-size:12px;color:rgba(255,255,255,.6)">${mmss(r.start)}から · ${secs(len)}</span>
    </div>
   </div>
   <div class="none" style="padding:12px 20px 0;display:grid;grid-template-columns:1fr 72px 1fr;gap:12px;align-items:center">
    <button class="btn-d" style="height:56px;font-size:16px;opacity:${pl.idx === 0 ? 0.3 : 1}" data-a="prev">${I.prev()}前へ</button>
    <button class="pp" data-a="plToggle" aria-label="再生/一時停止"><span class="when-paused" style="margin-left:3px;display:flex">${I.play(30)}</span><span class="when-playing" style="display:flex">${I.pause(28)}</span></button>
    <button class="btn-d" style="height:56px;font-size:16px;opacity:${pl.idx === pl.list.length - 1 ? 0.3 : 1}" data-a="next">次へ${I.next()}</button>
   </div>
   <div class="none" style="padding:16px 20px 0;display:flex;gap:6px">
    ${speeds.map((v) => `<button class="btn-d ${pl.speed === v ? 'on' : 'off'}" style="flex:1;font-size:16px" data-a="speed" data-v="${v}">${v}×</button>`).join('')}
    <button class="btn-d ${pl.loop ? 'on' : 'off'}" style="flex:1.6" data-a="loop">${I.loop(16)}1本くり返し</button>
   </div>
   <div class="none" style="padding:16px 20px 0;display:flex;flex-direction:column;gap:8px">
    <button class="starbtn ${r.star ? 'on' : ''}" data-a="plStar">${star}</button>
    <div style="display:flex">${cmb}</div>
   </div>
   <div class="safe-b" style="height:calc(var(--safe-b) + 16px)"></div></div>`;
};
function plPlay(from) {
  const { m, pl, r } = plCur(); if (!r) return;
  const [a, b] = rallySpan(m, r);
  V.playbackRate = pl.speed;
  playSpan(a, b, onPlEnd, from);
}
function onPlEnd() {
  const pl = S.pl;
  if (pl.loop) { plPlay(); return; }
  if (pl.idx < pl.list.length - 1) { pl.idx++; render(); plPlay(); return; }
  V.pause(); pl.ended = true; render();
}
// 横向きに固定できれば true。iPhone などは固定できないので、端末を横にしてもらう（画面が横長なら自動で横向きの表示になる）
async function enterLand() {
  try { if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen(); } catch (_) { /* 非対応 */ }
  try { await screen.orientation.lock('landscape'); return true; } catch (_) { /* 非対応 */ }
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  return false;
}
function exitLand() {
  try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (_) { /* 非対応 */ }
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
addEventListener('resize', () => { if (scr() === 'player') { const w = root.classList.contains('wide'); if (w !== isLand()) render(); } });
function returnToMatch() {
  // 再生画面で最後に見ていたラリーを選んだ状態に戻す
  if (S.pl) { const { r } = plCur(); if (r) S.sel = r.id; S.pl = null; }
  if (S.adj) S.adj = null;
  PB.a = PB.b = -1;
}

// ---------- 微調整（未保存の試合だけ）
function mkAdj(m, r, isNew, at) {
  let st, en;
  if (r) { st = r.start; en = r.end; } else { st = clamp(at, 0, Math.max(0, m.dur - 6)); en = Math.min(m.dur, st + 6); }
  return { rid: r ? r.id : null, isNew, start: st, end: en, w0: Math.max(0, st - 6), w1: Math.min(m.dur, en + 6), sel: 'start', pt: st };
}
SCREENS.adjust = () => {
  const a = S.adj, m = cur(), rs = sorted(m), idx = rs.findIndex((r) => r.id === a.rid);
  const nudge = [['mHalf', '−0.5秒'], ['mFrame', '−1コマ'], ['pFrame', '＋1コマ'], ['pHalf', '＋0.5秒']];
  return `<div class="scr">
   <div class="nav3"><button class="btn-t" style="padding-left:16px" data-a="back">キャンセル</button><span class="ttl">${a.isNew ? 'ラリーを追加' : `ラリー ${idx + 1} を調整`}</span><button class="btn-t bold r" style="padding-right:16px" data-a="adjSave">${a.isNew ? '追加' : '保存'}</button></div>
   <div class="vbox" data-vslot><span class="tm" style="font-size:18px" id="adjPtL"></span><span class="h when-playing" style="position:absolute;right:12px;top:10px;font-size:13px;color:#fff;background:rgba(0,0,0,.5);padding:2px 8px">再生中</span></div>
   <div class="scroll" style="padding:14px 0 calc(var(--safe-b) + 24px);display:flex;flex-direction:column;gap:14px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 16px">
     <button class="selbox" id="adjS" data-a="selStart"><span style="font-size:11px" class="muted">開始</span><span class="h" style="font-size:20px" id="adjSL"></span></button>
     <button class="selbox" id="adjE" data-a="selEnd"><span style="font-size:11px" class="muted" id="adjLenL"></span><span class="h" style="font-size:20px" id="adjEL"></span></button>
    </div>
    <div class="atl" id="atl"><div id="atlIn"></div></div>
    <div style="padding:0 16px;display:flex;flex-direction:column;gap:6px">
     <span style="font-size:12px" class="muted" id="adjSelL"></span>
     <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">${nudge.map(([k, l]) => `<button class="btn-s" data-a="${k}">${l}</button>`).join('')}</div>
    </div>
    <div style="padding:0 16px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
     <button class="btn-s acc" data-a="playStart">${I.play(14)}開始から再生</button>
     <button class="btn-s acc" data-a="playEnd">${I.play(14)}終了の直前から</button>
    </div>
    ${a.isNew ? '<p class="muted" style="margin:0 16px;font-size:13px;line-height:1.6">試合画面で選んでいた位置のあたりを表示しています。青いハンドルを動かして、ラリーの始まりと終わりに合わせてください。</p>' : `
    <div class="oplist">
     <button data-a="split"><b style="font-size:15px">赤い線の位置で2つに分ける</b><span style="font-size:12px" class="muted">2本のラリーが1つにつながっているとき</span></button>
     <button data-a="merge" style="opacity:${adjPrev() ? 1 : 0.4}"><b style="font-size:15px">前のラリーとつなげる</b><span style="font-size:12px" class="muted">1本のラリーが2つに分かれているとき</span></button>
     <button data-a="rdel" style="color:var(--danger);font-size:15px;font-weight:700">このラリーを削除</button>
    </div>`}
   </div></div>`;
};
AFTER.adjust = () => {
  const el = document.getElementById('atl');
  const tAt = (e) => { const r = el.getBoundingClientRect(), a = S.adj; return { t: a.w0 + clamp((e.clientX - r.left) / r.width, 0, 1) * (a.w1 - a.w0), thr: 26 / r.width * (a.w1 - a.w0) }; };
  let drag = null;
  el.onpointerdown = (e) => {
    const a = S.adj, { t, thr } = tAt(e), ds = Math.abs(t - a.start), de = Math.abs(t - a.end);
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* 無視 */ }
    V.pause();
    if (Math.min(ds, de) < thr) { drag = ds <= de ? 'start' : 'end'; setEdge(drag, t); } else { a.pt = t; seekAdj(); updAdj(); }
  };
  el.onpointermove = (e) => { if (drag) setEdge(drag, tAt(e).t); };
  el.onpointerup = el.onpointercancel = () => { drag = null; };
  seekAdj(); updAdj();
};
let adjSeekBusy = false, adjSeekWant = null;
async function seekAdj() { // ドラッグ中はシークが追いつかないので、最後の位置だけを追う
  adjSeekWant = S.adj.pt;
  if (adjSeekBusy) return;
  adjSeekBusy = true;
  while (adjSeekWant != null) { const t = adjSeekWant; adjSeekWant = null; await seek(t); }
  adjSeekBusy = false;
}
function adjPrev() { const a = S.adj, m = cur(); return a.isNew ? null : sorted(m).filter((r) => r.id !== a.rid && r.start < a.start).pop() || null; }
function setEdge(h, t) {
  const a = S.adj, m = cur();
  if (h === 'start') a.start = clamp(t, 0, a.end - 0.5); else a.end = clamp(t, a.start + 0.5, m.dur);
  a.sel = h; a.pt = h === 'start' ? a.start : a.end;
  a.w0 = Math.min(a.w0, Math.max(0, a.start - 1)); a.w1 = Math.max(a.w1, Math.min(m.dur, a.end + 1));
  seekAdj(); updAdj();
}
function updAdj(onlyPt) {
  const a = S.adj, m = cur(); if (!a || scr() !== 'adjust') return;
  const span = a.w1 - a.w0, P_ = (t) => ((t - a.w0) / span * 100) + '%';
  setText('adjPtL', mmssd(a.pt));
  const box = document.getElementById('atlIn'); if (!box) return;
  const pt = box.querySelector('.pt');
  if (onlyPt && pt) { pt.style.left = P_(a.pt); return; }
  setText('adjSL', mmssd(a.start)); setText('adjEL', mmssd(a.end)); setText('adjLenL', `終了 · 長さ ${secs(a.end - a.start)}`);
  setText('adjSelL', `${a.sel === 'start' ? '開始' : '終了'}を細かく動かす`);
  document.getElementById('adjS').classList.toggle('on', a.sel === 'start');
  document.getElementById('adjE').classList.toggle('on', a.sel === 'end');
  const ticks = [];
  for (let t = Math.ceil(a.w0); t <= a.w1; t++) ticks.push(`<div class="tk" style="left:${P_(t)};height:${t % 5 === 0 ? 10 : 5}px"></div>${t % 5 === 0 ? `<span class="tkl" style="left:${P_(t)}">${mmss(t)}</span>` : ''}`);
  const nb = sorted(m).filter((r) => r.id !== a.rid && r.end > a.w0 && r.start < a.w1)
    .map((r) => `<div class="nb" style="left:${P_(Math.max(r.start, a.w0))};width:${(Math.min(r.end, a.w1) - Math.max(r.start, a.w0)) / span * 100}%"></div>`).join('');
  box.innerHTML = `<div class="base"></div>${nb}<div class="rng" style="left:${P_(a.start)};width:${(a.end - a.start) / span * 100}%"></div>
   <div class="pt" style="left:${P_(a.pt)}"></div>
   <div class="hd s ${a.sel === 'start' ? 'sel' : ''}" style="left:${P_(a.start)}"></div><div class="hd ${a.sel === 'end' ? 'sel' : ''}" style="left:${P_(a.end)}"></div>${ticks.join('')}`;
}
function nudge(d) { const a = S.adj; setEdge(a.sel, (a.sel === 'start' ? a.start : a.end) + d); }
function adjDone(msg, fn, sel) {
  const m = cur();
  fn(m);
  saveMatch(m);
  leave('adjust'); S.stack.pop(); returnToMatch();
  if (sel) S.sel = sel;
  S.toast = null; render(); toast(msg);
}

// ---------- 設定・保存容量・プライバシー
const subHead = (label, title) => `<div class="nav"><button class="btn-t" style="padding:0 8px 0 4px" data-a="back">${I.back}${label}</button></div><div class="bigttl" style="font-size:${title === '設定' ? 34 : 30}px;padding-bottom:${title === '設定' ? 8 : 12}px">${title}</div>`;
const sgroup = (label, body) => `<div style="display:flex;flex-direction:column;gap:6px"><span class="sec-l" style="padding-left:2px">${label}</span><div class="slist">${body}</div></div>`;
SCREENS.settings = () => {
  const total = S.matches.reduce((n, m) => n + (m.clip ? m.clip.bytes : 0), 0);
  return `<div class="scr">${subHead('試合', '設定')}
   <div class="scroll" style="padding:8px 16px 40px;display:flex;flex-direction:column;gap:22px">
    ${canInstall() ? sgroup('使いはじめに', '<button class="srow" data-a="install"><span>ホーム画面に追加</span><span class="muted">›</span></button>') : ''}
    ${sgroup('撮影と保存', `<button class="srow" data-a="tips"><span>撮影のコツ</span><span class="muted">›</span></button>
     <button class="srow" data-a="storage"><span>アプリ内の保存容量</span><span class="muted" style="font-size:14px">${total ? MBf(total) : '0MB'} ›</span></button>
     <button class="srow" data-a="privacy"><span>プライバシー</span><span class="muted">›</span></button>`)}
    ${sgroup('このアプリについて', `<div class="srow" style="cursor:default"><span>バージョン</span><span class="h muted">${VER}</span></div>
     <button class="srow" data-a="contact"><span>お問い合わせ</span><span class="muted">›</span></button>
     <button class="srow" data-a="diag"><span>診断情報</span><span class="muted">›</span></button>`)}
   </div></div>`;
};
SCREENS.storage = () => {
  const saved = S.matches.filter((m) => m.clip), total = saved.reduce((n, m) => n + m.clip.bytes, 0);
  return `<div class="scr">${subHead('設定', '保存容量')}
   <div class="scroll" style="padding:0 16px 40px;display:flex;flex-direction:column;gap:16px">
    <div class="bp frame" style="padding:16px;display:flex;flex-direction:column;gap:4px">${CORNERS}<span style="font-size:13px" class="muted">アプリ内に保存したラリー動画</span><span class="h" style="font-size:40px;line-height:1">${total ? MBf(total) : '0MB'}</span></div>
    ${saved.length ? '' : '<span style="font-size:14px" class="muted">保存した試合はありません。</span>'}
    <div style="border-top:1px solid var(--line)">${saved.map((m) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px"><span class="h" style="font-size:17px">${m.opp ? 'vs ' + esc(m.opp) : '対戦相手なし'}</span><span style="font-size:12px" class="muted">${fmtDate(m.date)} · ${esc(m.title)}</span>
       <div style="height:4px;background:color-mix(in srgb,var(--ink) 7%,transparent)"><div style="height:100%;width:${m.clip.bytes / Math.max(total, 1) * 100}%;background:var(--accent)"></div></div></div>
      <span class="h" style="width:60px;text-align:right">${MBf(m.clip.bytes)}</span>
      <button class="btn-s" style="height:44px;padding:0 10px;color:var(--danger);font:700 13px var(--font)" data-a="clipDel" data-id="${m.id}">削除</button></div>`).join('')}</div>
    <span style="font-size:12px;line-height:1.6" class="muted">削除しても、ラリーの位置と★・コメントは残ります。元の動画があれば、また再生できます。</span>
    ${P.native ? '' : `<span style="font-size:12px;line-height:1.6" class="muted">ブラウザ版では、ブラウザがこの保存を消すことがあります。${standalone() ? '' : 'ホーム画面に追加して使うと、消えにくくなります。'}大切な動画は「書き出し」で端末にも残してください。</span>`}
   </div></div>`;
};
SCREENS.privacy = () => `<div class="scr">${subHead('設定', 'プライバシー')}
  <div class="scroll" style="padding:0 20px 40px;display:flex;flex-direction:column;gap:18px;font-size:15px;line-height:1.75">
   ${[['解析は端末の中だけ', 'ラリーを探す処理は、すべてこのスマホの中で行います。動画や画像をサーバーに送ることはありません。'], ['通信なしで使えます', '解析と再生は、機内モードでも動きます。']].concat(CFG.ads ? [['広告について', '広告は一覧画面と解析中の画面にだけ出ます。広告の仕組みが、動画やその内容に触れることはありません。']] : [])
    .map(([t, d]) => `<div style="display:flex;flex-direction:column;gap:4px"><span class="h" style="font-size:19px">${t}</span><span class="muted">${d}</span></div>`).join('')}
  </div></div>`;

// ================================================================ シート・ダイアログ
function sheetHtml() {
  const sh = S.sheet; if (!sh) return '';
  const m = cur(), body = SHEETS[sh.type](sh, m);
  // 閉じるのは×ボタン（下に引いて閉じる見た目にすると、ブラウザの「引っぱって再読み込み」を誘ってしまう）
  const busy = sh.stage === 'progress';
  return `<div class="sheet-w"><div class="scrim" data-a="closeSheet"></div><div class="sheet">${busy ? '' : `<button class="shx" data-a="closeSheet" aria-label="閉じる">${I.x}</button>`}${body}</div></div>`;
}
const doneHtml = (title, sub, btn) => `<div class="cblk" style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px 0 4px;text-align:center"><span class="done-ic">${I.check(30)}</span><span class="t">${title}</span><span class="d">${sub}</span></div>
  <button class="btn-s" style="height:52px;font-size:18px" data-a="closeSheet">${btn || '閉じる'}</button>`;
const progHtml = (title, sh, extra) => `<span class="t">${title}</span>
  <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="h" style="font-size:48px;line-height:1" id="shPct">${Math.round(sh.prog * 100)}%</span>${extra || ''}</div>
  <div class="bar6"><div id="shBar" style="width:${sh.prog * 100}%"></div></div>`;
const totalLen = (rs) => rs.reduce((n, r) => n + r.end - r.start, 0);
const SHEETS = {
  a2hs() {
    const li = (n, t) => `<div style="display:flex;gap:12px"><span class="h" style="flex:none;width:22px;font-size:20px;line-height:1.3;color:var(--accent)">${n}</span><span style="font-size:15px;line-height:1.6">${t}</span></div>`;
    return `<div style="display:flex;flex-direction:column;gap:6px"><span class="t">ホーム画面に追加</span><span class="d">ホーム画面のアイコンから開くと、アプリのように使えます。保存した動画が消えにくくなり、通信がなくても開けます。</span></div>
     <div style="display:flex;flex-direction:column;gap:12px">
      ${li(1, 'Safari：画面下の「…」→「共有」をタップ（□に↑の共有ボタンが見えていれば、それをタップ）。<br>Chrome：アドレスバーの右の共有ボタンをタップ。')}
      ${li(2, '「ホーム画面に追加」を選ぶ（見当たらなければ、下にスクロールするか「さらに表示」）。')}
      ${li(3, '「追加」をタップ。次からはホーム画面の「ラリー」から開きます。')}
     </div>
     <div class="warnbox">${I.info(20)}<div style="display:flex;flex-direction:column;gap:2px"><b>ここで保存した試合は引き継がれません</b><span>ホーム画面から開いたアプリは、ブラウザとは別の場所に保存します。先に追加してから、動画を解析・保存してください。</span></div></div>
     <button class="btn-s" style="height:52px;font-size:18px" data-a="closeSheet">閉じる</button>`;
  },
  save(sh, m) {
    const rs = sorted(m);
    if (sh.stage === 'choose') {
      const est = m.source && m.source.size && m.dur ? totalLen(rs) * m.source.size / m.dur : 0;
      return `<div style="display:flex;flex-direction:column;gap:6px"><span class="t">ラリー動画を保存</span><span class="d">ラリーの部分だけをアプリ内に保存します。保存すると、元の動画を消しても見られます。</span></div>
       <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)"><span style="flex:1;display:flex;flex-direction:column"><b style="font-size:16px">すべてのラリー</b><span style="font-size:13px" class="muted">${rs.length}本 · ${jlen(totalLen(rs))}</span></span><span class="h" style="font-size:20px">${est ? '約' + MBf(est) : ''}</span></div>
        <div class="warnbox">${I.info(20)}<div style="display:flex;flex-direction:column;gap:2px"><b>保存すると「調整」はできなくなります</b><span>ラリーの開始・終了の調整、分割・結合・削除、見逃したラリーの追加ができなくなります。必要なら、先に調整を済ませてください。</span></div></div>
        ${P.native ? '' : '<span style="font-size:12px;line-height:1.6" class="muted">ブラウザ版では、ブラウザがこの保存を消すことがあります。</span>'}
       </div>
       <button class="btn-p bp" style="height:54px;font-size:19px" data-a="saveGo" ${rs.length ? '' : 'disabled'}>${CORNERS}保存する</button>`;
    }
    if (sh.stage === 'progress') return progHtml('保存しています…', sh, `<span class="h muted" style="font-size:16px">${rs.length}本</span>`) + '<span style="font-size:13px" class="muted">画質はそのままで、ラリーの部分だけを切り出しています。</span>';
    if (sh.stage === 'done') return doneHtml('保存しました', '元の動画を消しても、このアプリで見られます。<br>★とコメントは、あとからでも付けられます。');
    if (sh.stage === 'error') return `<span class="t">保存できませんでした</span><span class="err">${esc(sh.error)}</span><button class="btn-s" style="height:52px" data-a="closeSheet">閉じる</button>`;
    return `<div style="display:flex;flex-direction:column;gap:6px"><span class="t">保存済みです</span><span class="d">この試合のラリー動画（${MBf(m.clip.bytes)}）をアプリ内に保存しています。元の動画を消しても見られます。ラリーの調整はできません。</span></div>
     <button class="btn-p bp" data-a="closeSheet">${CORNERS}閉じる</button>`;
  },
  export(sh, m) {
    const rs = sorted(m), stars = rs.filter((r) => r.star);
    const dest = P.native ? 'カメラロール' : 'この端末';
    if (sh.stage === 'choose') {
      const opt = (k, label, list, dis) => `<button class="opt ${sh.scope === k ? 'on' : ''}" data-a="scope" data-v="${k}" ${dis ? 'disabled style="opacity:.45"' : ''}><span class="rd"></span><b style="flex:1;font-size:16px">${label}</b><span class="h muted" style="font-size:16px">${list.length}本 · ${jlen(totalLen(list))}</span></button>`;
      return `<div style="display:flex;flex-direction:column;gap:6px"><span class="t">${dest}に書き出し</span><span class="d">選んだラリーを1本の動画にまとめます。</span></div>
       <div style="display:flex;flex-direction:column;gap:8px">${opt('all', 'すべてのラリー', rs)}${opt('star', '★のラリーだけ', stars, !stars.length)}</div>
       <button class="btn-p bp" style="height:54px;font-size:19px" data-a="expGo">${CORNERS}書き出す</button>`;
    }
    if (sh.stage === 'progress') return progHtml('書き出しています…', sh);
    if (sh.stage === 'error') return `<span class="t">書き出せませんでした</span><span class="err">${esc(sh.error)}</span><button class="btn-s" style="height:52px" data-a="closeSheet">閉じる</button>`;
    return P.native ? doneHtml('カメラロールに保存しました', '写真アプリから、LINE などで送れます。') : doneHtml('書き出しました', 'ダウンロードしたファイルを、写真アプリや LINE で使えます。');
  },
  info(sh, m) {
    return `<span class="t">試合の情報</span>
     <label class="fld">日付<input type="date" data-in="date" value="${esc(m.date)}"></label>
     <label class="fld">対戦相手<input data-in="opp" value="${esc(m.opp)}" placeholder="例：佐藤 さん" enterkeyhint="next"></label>
     <label class="fld">大会名<input data-in="title" value="${esc(m.title)}" placeholder="例：市民卓球大会" enterkeyhint="next"></label>
     <label class="fld">メモ<textarea data-in="memo" placeholder="例：1回戦。サーブが良かった">${esc(m.memo)}</textarea></label>
     <button class="btn-p bp" data-a="closeSheet">${CORNERS}完了</button>
     <button class="btn-t danger" style="justify-content:center;height:48px;border-top:1px solid var(--line);margin-top:4px" data-a="mdel">この試合を削除</button>`;
  },
  comment(sh, m) {
    const rs = sorted(m), r = m.rallies.find((x) => x.id === sh.rid);
    if (!r) return '';
    return `<div style="display:flex;flex-direction:column;gap:2px"><span class="t">ラリー ${rs.indexOf(r) + 1} のコメント</span><span style="font-size:13px" class="muted">${mmss(r.start)}から · ${secs(r.end - r.start)}</span></div>
     <textarea data-in="comment" placeholder="例：3球目のドライブが決まった" style="min-height:110px">${esc(sh.text)}</textarea>
     <button class="btn-p bp" data-a="cmSave">${CORNERS}保存</button>
     ${r.comment ? '<button class="btn-t danger" style="justify-content:center;margin-top:-6px" data-a="cmDel">コメントを消す</button>' : ''}`;
  },
};
function dlgHtml() {
  const d = S.dialog; if (!d) return '';
  return `<div class="dlg-w"><div class="dlg bp">${CORNERS}<span class="h" style="font-size:20px;line-height:1.3">${esc(d.title)}</span><span class="muted" style="font-size:14px;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere">${esc(d.body)}</span>
   <div style="display:grid;grid-template-columns:${d.single ? '1fr' : '1fr 1fr'};gap:8px;margin-top:6px">${d.single ? '' : `<button class="btn-s" data-a="dlgNo">${esc(d.no || 'キャンセル')}</button>`}<button class="${d.single ? 'btn-s' : 'ok'}${d.pri ? ' pri' : ''}" data-a="dlgOk">${esc(d.ok)}</button></div></div></div>`;
}
function ask(title, body, ok, onOk) { S.dialog = { title, body, ok, onOk }; render(); }
function alertDlg(title, body) { S.dialog = { title, body, ok: '閉じる', single: true, onOk: () => {} }; render(); }
function updSheetProg() {
  const sh = S.sheet; if (!sh) return;
  setText('shPct', Math.round(sh.prog * 100) + '%'); setW('shBar', sh.prog * 100);
}

// ================================================================ 操作
const A = {};
A.back = () => back();
A.obNext = () => { if (S.ob < 2) { S.ob++; render(); } else A.obDone(); };
A.obDone = () => { DB.set('onboarded', true); S.stack = ['home']; render(); };
A.tips = () => go('tips');
A.settings = () => go('settings');
A.storage = () => go('storage');
A.privacy = () => go('privacy');
A.contact = () => toast('お問い合わせ先は準備中です');
A.install = async () => {
  if (!installEvt) { S.sheet = { type: 'a2hs' }; render(); return; }
  const e = installEvt; installEvt = null;
  try { await e.prompt(); await e.userChoice; } catch (err) { diag('ホーム画面に追加: ' + errMsg(err)); }
  render();
};
A.a2hsHide = () => { S.a2hsHidden = true; DB.set('a2hsHidden', true); render(); toast('設定からいつでも追加できます'); };
A.diag = async () => {
  let n = '?'; try { n = await DB.countThumbs(); } catch (e) { n = '読めません: ' + errMsg(e); }
  const lines = [`バージョン ${VER}`, navigator.userAgent, `サムネイル：記録 ${n} 枚／表示中 ${Object.keys(L.thumbs).length} 枚`,
    `試合 ${S.matches.length} 件`, `ホーム画面から：${standalone() ? 'はい' : 'いいえ'}／SW：${navigator.serviceWorker && navigator.serviceWorker.controller ? '動作中' : 'なし'}`, '', ...(diagLog.length ? diagLog : ['（エラーの記録なし）'])];
  alertDlg('診断情報', lines.join('\n'));
};
A.closeSheet = () => closeSheet();
A.dlgNo = () => { const d = S.dialog; S.dialog = null; if (d && d.onNo) d.onNo(); if (!S.dialog) render(); };
A.dlgOk = () => { const d = S.dialog; S.dialog = null; d.onOk(); if (!S.dialog) render(); };

// --- 動画を追加 → 台の位置 → 解析
A.add = async () => {
  let op;
  try { op = await P.pickVideo(); } catch (e) { if (!P.isCancel(e)) alertDlg('動画を開けませんでした', errMsg(e)); return; }
  S.add = { opened: op, corners: [], drag: -1, frameT: 0.1, dur: 0, w: 16, h: 9 };
  go('corners');
  setSrc(op.url);
  try {
    await once(V, 'loadedmetadata', 20000);
    const a = S.add; if (!a || a.opened !== op) return;
    a.dur = V.duration; a.w = V.videoWidth || 16; a.h = V.videoHeight || 9;
    // iOS は一度再生しないとコマが表示されないことがある
    V.muted = true; await V.play().catch(() => {}); V.pause(); V.muted = false;
    await seek(a.frameT * a.dur);
    if (scr() === 'corners') { const f = document.getElementById('cframe'); if (f) f.style.aspectRatio = `${a.w}/${a.h}`; updCorners(); }
  } catch (e) { alertDlg('動画を開けませんでした', 'この動画は再生できないようです。'); }
};
A.cReset = () => { S.add.corners = []; S.add.drag = -1; updCorners(); };
A.cStart = () => { if (S.add.corners.length === 4) startAnalysis(); };

let wakeLock = null;
function startAnalysis() {
  const a = S.add, op = a.opened, roi = roiFrom(quad(a.corners, a.w / a.h).o, a.w, a.h);
  const w = new Worker('worker.js?v=' + VER);
  S.an = { w, dur: a.dur, total: 0, done: 0, elapsed: 0, found: [], info: null };
  V.pause();
  replaceTop('analyze');
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
  w.onmessage = (e) => {
    const msg = e.data, an = S.an; if (!an || an.w !== w) return;
    if (msg.type === 'info') an.info = msg;
    else if (msg.type === 'progress') { an.total = msg.total; an.done = msg.done; an.elapsed = msg.elapsed; updAn(); }
    else if (msg.type === 'partial') { an.found = msg.segs; updAn(); }
    else if (msg.type === 'done') finishAnalysis(msg);
    else if (msg.type === 'error') failAnalysis(msg.message);
  };
  w.onerror = (e) => failAnalysis(e.message || 'Worker のエラー');
  const opts = { detect: true, read: 'copy', range: '', hw: P.decodeHw, roi, partial: true };
  if (op.file.url) w.postMessage({ type: 'start', src: { url: op.file.url, size: op.file.size, name: op.file.name }, opts });
  else w.postMessage({ type: 'start', file: op.file, opts });
}
function endAnalysis() {
  if (S.an) S.an.w.terminate();
  S.an = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
function cancelAnalysis() { endAnalysis(); S.add = null; S.stack = ['home']; render(); toast('解析を中止しました'); }
function failAnalysis(message) { endAnalysis(); S.add = null; S.stack = ['home']; alertDlg('解析できませんでした', message); }
async function finishAnalysis(msg) {
  const a = S.add, an = S.an, info = an.info || {};
  endAnalysis();
  const dur = info.duration || a.dur;
  const m = {
    id: 'm' + Date.now().toString(36), created: Date.now(),
    date: ymd(a.opened.source.lastModified || Date.now()), title: '', opp: '', memo: '',
    dur, w: info.width || a.w, h: info.height || a.h, fps: info.fps || 30, codec: info.codec || '',
    corners: a.corners, roi: roiFrom(quad(a.corners, a.w / a.h).o, a.w, a.h),
    source: a.opened.source, clip: null,
    rallies: msg.segs.map(([s, e]) => ({ id: uid(), start: +s.toFixed(3), end: +Math.min(e, dur).toFixed(3), star: false, comment: '' })),
  };
  L.open[m.id] = a.opened;
  S.matches.unshift(m);
  S.add = null;
  await saveMatch(m);
  S.cur = m.id; S.filter = 'all'; S.sel = m.rallies[0] ? m.rallies[0].id : null; delete L.scroll.match;
  S.stack = ['home', 'match'];
  await prepMedia(m);
  render();
  toast(m.rallies.length ? `${m.rallies.length}本のラリーが見つかりました` : 'ラリーが見つかりませんでした');
}

// --- 試合を開く
A.open = async (d) => {
  const m = S.matches.find((x) => x.id === d.id); if (!m) return;
  if (!m.clip) {
    const o = L.open[m.id];
    if (!o || !o.url) { const r = await P.reopen(m.source, true); L.open[m.id] = r && r.url ? r : (r && r.needsPermission ? r : null); }
  }
  S.cur = m.id; S.filter = 'all'; S.sel = sorted(m)[0] ? sorted(m)[0].id : null; delete L.scroll.match;
  PB.a = PB.b = -1;
  await prepMedia(m);
  go('match');
};
A.sel = (d) => {
  const m = cur(), r = m.rallies.find((x) => x.id === d.id); if (!r) return;
  S.sel = r.id; render();
  if (status(m) !== 'missing') { const [a, b] = rallySpan(m, r); playSpan(a, b, () => V.pause()); }
};
A.mpToggle = () => {
  const m = cur(), r = m && m.rallies.find((x) => x.id === S.sel); if (!r) return;
  if (!V.paused) { V.pause(); return; }
  const [a, b] = rallySpan(m, r);
  playSpan(a, b, () => V.pause(), V.currentTime >= a && V.currentTime < b - 0.05 ? V.currentTime : a);
};
A.tl = (d, e) => {
  const m = cur(), el = document.getElementById('tlbg'); if (!m || !el) return;
  const r = el.getBoundingClientRect(), t = (e.clientX - r.left) / r.width * m.dur;
  let best = null, bd = 1e9;
  sorted(m).forEach((x) => { const dd = t < x.start ? x.start - t : t > x.end ? t - x.end : 0; if (dd < bd) { bd = dd; best = x; } });
  if (best) { if (!inF(best)) S.filter = 'all'; A.sel({ id: best.id }); }
};
A.filter = (d) => { S.filter = d.f; render(); };
A.star = (d) => { const m = cur(), r = m.rallies.find((x) => x.id === d.id); r.star = !r.star; saveMatch(m); render(); };
A.comment = (d) => {
  const m = cur(), r = m.rallies.find((x) => x.id === d.id); if (!r) return;
  V.pause();
  S.sheet = { type: 'comment', rid: r.id, text: r.comment || '' }; render();
};
A.cmSave = () => { const m = cur(), r = m.rallies.find((x) => x.id === S.sheet.rid); r.comment = S.sheet.text.trim(); saveMatch(m); S.sheet = null; render(); };
A.cmDel = () => { const m = cur(), r = m.rallies.find((x) => x.id === S.sheet.rid); r.comment = ''; saveMatch(m); S.sheet = null; render(); };
A.info = () => { S.sheet = { type: 'info' }; render(); };
A.mdel = () => {
  const m = cur();
  ask('この試合を削除しますか？', (m.clip ? `ラリーの位置・★・コメントと、アプリ内に保存したラリー動画（${MBf(m.clip.bytes)}）が消えます。` : 'ラリーの位置・★・コメントが消えます。') + '写真ライブラリの元の動画は消えません。', '削除', async () => {
    if (m.clip) await P.deleteClip(m.clip).catch(() => {});
    await DB.deleteMatch(m.id); DB.deleteThumbs(m.id + '/').catch(() => {});
    S.matches = S.matches.filter((x) => x.id !== m.id);
    S.sheet = null; S.stack = ['home']; V.pause(); setSrc(null);
    render(); toast('試合を削除しました');
  });
};
A.relink = async () => {
  const m = cur(); let op;
  try { op = await P.pickVideo(); } catch (e) { if (!P.isCancel(e)) alertDlg('動画を開けませんでした', errMsg(e)); return; }
  const link = async () => {
    L.open[m.id] = op; m.source = op.source; await saveMatch(m);
    for (const k of Object.keys(tFail)) if (k.startsWith(m.id + '/')) { delete tFail[k]; L.tReq.delete(k); }
    await prepMedia(m); PB.a = PB.b = -1; render(); toast('元の動画とつなぎ直しました');
  };
  if (m.source && m.source.size && op.source.size !== m.source.size) {
    ask('この試合の動画ではないようです', `ファイルの大きさが違います（元の動画：${MBf(m.source.size)}、選んだ動画：${MBf(op.source.size)}）。このままつなぎますか？`, 'つなぐ', link);
  } else link();
};

// --- 続けて再生
A.cont = () => {
  const m = cur(); if (!m || status(m) === 'missing') return;
  const fl = sorted(m).filter(inF); if (!fl.length) return;
  const list = fl.map((r) => r.id), i = Math.max(0, list.indexOf(S.sel));
  V.pause();
  go('player', { pl: { list, idx: i, speed: 1, loop: false, land: false, ended: false } });
  plPlay();
};
A.plToggle = () => {
  const pl = S.pl;
  if (pl.ended) return A.replay();
  if (!V.paused) { V.pause(); return; }
  const { m, r } = plCur(), [a, b] = rallySpan(m, r);
  plPlay(V.currentTime >= a && V.currentTime < b - 0.05 ? V.currentTime : a);
};
A.replay = () => { S.pl.idx = 0; S.pl.ended = false; render(); plPlay(); };
A.prev = () => { const pl = S.pl; if (pl.idx === 0) { plPlay(); return; } pl.idx--; pl.ended = false; render(); plPlay(); };
A.next = () => { const pl = S.pl; if (pl.idx >= pl.list.length - 1) return; pl.idx++; pl.ended = false; render(); plPlay(); };
A.speed = (d) => { S.pl.speed = +d.v; V.playbackRate = S.pl.speed; render(); };
A.loop = () => { S.pl.loop = !S.pl.loop; render(); };
A.plStar = () => { const { m, r } = plCur(); r.star = !r.star; saveMatch(m); render(); };
A.rotate = async () => {
  const pl = S.pl;
  if (isLand()) {
    pl.land = false; exitLand(); render();
    if (innerWidth > innerHeight) toast('端末を縦に向けてください');
  } else if (await enterLand()) { pl.land = true; render(); } else toast('端末を横に向けてください');
};

// --- 微調整
A.adjust = (d) => {
  const m = cur(), r = m.rallies.find((x) => x.id === d.id); if (!r || !canEdit(m)) return;
  V.pause(); go('adjust', { adj: mkAdj(m, r, false) });
};
A.addMissed = () => {
  const m = cur(); if (!canEdit(m)) return;
  const selR = m.rallies.find((x) => x.id === S.sel);
  V.pause(); go('adjust', { adj: mkAdj(m, null, true, selR ? selR.end + 3 : m.dur / 2) });
};
A.selStart = () => { const a = S.adj; a.sel = 'start'; a.pt = a.start; V.pause(); seekAdj(); updAdj(); };
A.selEnd = () => { const a = S.adj; a.sel = 'end'; a.pt = a.end; V.pause(); seekAdj(); updAdj(); };
A.mHalf = () => nudge(-0.5);
A.pHalf = () => nudge(0.5);
A.mFrame = () => nudge(-1 / fps(cur()));
A.pFrame = () => nudge(1 / fps(cur()));
A.playStart = () => { const a = S.adj; playSpan(a.start, a.end, () => V.pause()); };
A.playEnd = () => { const a = S.adj, m = cur(); playSpan(Math.max(a.start, a.end - 2), Math.min(m.dur, a.end + 1), () => V.pause()); };
const dropThumb = (m, id) => { const k = m.id + '/' + id; delete L.thumbs[k]; L.tReq.delete(k); DB.deleteThumbs(k).catch(() => {}); };
A.adjSave = () => {
  const a = S.adj;
  if (a.isNew) {
    const id = uid();
    adjDone('ラリーを追加しました', (m) => { m.rallies.push({ id, start: a.start, end: a.end, star: false, comment: '' }); }, id);
  } else {
    adjDone('調整しました', (m) => { const r = m.rallies.find((x) => x.id === a.rid); if (Math.abs(r.start - a.start) > 0.01) dropThumb(m, r.id); r.start = a.start; r.end = a.end; });
  }
};
A.split = () => {
  const a = S.adj, at = a.pt > a.start + 0.5 && a.pt < a.end - 0.5 ? a.pt : (a.start + a.end) / 2, id = uid();
  adjDone('2つに分けました', (m) => {
    const r = m.rallies.find((x) => x.id === a.rid);
    if (Math.abs(r.start - a.start) > 0.01) dropThumb(m, r.id);
    r.start = a.start; r.end = at;
    m.rallies.push({ id, start: at, end: a.end, star: false, comment: '' });
  });
};
A.merge = () => {
  const prev = adjPrev(), a = S.adj; if (!prev) return;
  adjDone('前のラリーとつなげました', (m) => {
    const r = m.rallies.find((x) => x.id === a.rid);
    m.rallies = m.rallies.filter((x) => x.id !== prev.id);
    dropThumb(m, prev.id); dropThumb(m, r.id);
    r.start = prev.start; r.end = a.end; r.star = r.star || prev.star;
    r.comment = [prev.comment, r.comment].filter(Boolean).join(' / ');
  });
};
A.rdel = () => {
  const a = S.adj;
  ask('このラリーを削除しますか？', '誤って見つかったラリーを一覧から消します。', '削除', () => {
    adjDone('削除しました', (m) => { m.rallies = m.rallies.filter((x) => x.id !== a.rid); dropThumb(m, a.rid); });
  });
};

// --- ラリー動画を保存
A.save = () => {
  const m = cur(); if (status(m) === 'missing') return;
  V.pause();
  S.sheet = { type: 'save', stage: m.clip ? 'already' : 'choose', prog: 0 }; render();
};
A.saveGo = async () => {
  const m = cur(), sh = S.sheet;
  sh.stage = 'progress'; sh.prog = 0; render();
  try {
    let op = L.open[m.id];
    if (!op || !op.file) { op = await P.reopen(m.source, true); if (!op || !op.file) throw new Error('元の動画を開けません'); L.open[m.id] = op; }
    const rs = sorted(m);
    const plan = self.RallyRemux.planClip(await self.RallySource.readMoov(op.file), rs.map((r) => [r.start, r.end]));
    const name = `${m.id}_${Date.now().toString(36)}.mp4`;
    const res = await P.writeClip(name, plan, op, (p) => { sh.prog = p; updSheetProg(); });
    if (res.bytes !== plan.size) throw new Error(`保存した大きさが違います（${res.bytes} / ${plan.size}）`);
    // 元動画の時刻 → 保存した動画の時刻（ラリーはキーフレームから始まるので、少し前から入っている）
    for (const r of rs) {
      const run = plan.rallies.find((q) => q.srcStart <= r.start + 0.05 && q.srcEnd >= r.start) ||
        plan.rallies.reduce((b, q) => (Math.abs(q.srcStart - r.start) < Math.abs(b.srcStart - r.start) ? q : b));
      r.co = run.start - run.srcStart;
    }
    m.clip = { name: res.name, bytes: res.bytes, duration: plan.duration, savedAt: Date.now() };
    await saveMatch(m);
    sh.stage = 'done'; sh.prog = 1;
    PB.a = PB.b = -1;
    await prepMedia(m);
  } catch (e) { sh.stage = 'error'; sh.error = errMsg(e); }
  render();
};
A.clipDel = (d) => {
  const m = S.matches.find((x) => x.id === d.id);
  ask('保存したラリー動画を削除しますか？', '元の動画が端末にない場合、この試合は再生できなくなります。', '削除', async () => {
    await P.deleteClip(m.clip).catch(() => {});
    m.clip = null; m.rallies.forEach((r) => { delete r.co; });
    await saveMatch(m);
    if (!L.open[m.id] || !L.open[m.id].url) { const r = await P.reopen(m.source, false); L.open[m.id] = r && r.url ? r : null; }
    render(); toast('削除しました');
  });
};

// --- 書き出し
A.exp = () => {
  const m = cur(); if (status(m) === 'missing') return;
  V.pause();
  S.sheet = { type: 'export', stage: 'choose', scope: m.rallies.some((r) => r.star) ? 'star' : 'all', prog: 0 }; render();
};
A.scope = (d) => { S.sheet.scope = d.v; render(); };
A.expGo = async () => {
  const m = cur(), sh = S.sheet;
  sh.stage = 'progress'; sh.prog = 0; render();
  try {
    const rs = sorted(m).filter((r) => sh.scope === 'all' || r.star);
    let file, segs;
    if (m.clip) { file = await P.clipFile(m.clip); segs = rs.map((r) => rallySpan(m, r)); } else {
      let op = L.open[m.id];
      if (!op || !op.file) { op = await P.reopen(m.source, true); if (!op || !op.file) throw new Error('元の動画を開けません'); L.open[m.id] = op; }
      file = op.file; segs = rs.map((r) => [r.start, r.end]);
    }
    const plan = self.RallyRemux.planClip(await self.RallySource.readMoov(file), segs);
    sh.prog = 0.5; updSheetProg();
    const name = `${m.opp ? 'vs_' + m.opp.replace(/[\\/:*?"<>|\s]+/g, '_') + '_' : ''}${m.date}${sh.scope === 'star' ? '_star' : ''}.mp4`;
    await P.exportClip(name, plan, file);
    sh.stage = 'done'; sh.prog = 1;
  } catch (e) { sh.stage = 'error'; sh.error = errMsg(e); }
  render();
};

// ---------- イベント（すべて委譲）
root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]');
  if (!b || b.disabled || !root.contains(b)) return;
  const f = A[b.dataset.a];
  if (f) f(b.dataset, e, b);
});
root.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.in; if (!k) return;
  if (k === 'comment') { S.sheet.text = e.target.value; return; }
  const m = cur(); if (!m) return;
  if (k === 'date' && !e.target.value) return; // 日付は空にしない
  m[k] = e.target.value; saveSoon(m);
});
root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
V.addEventListener('ended', () => { if (PB.onEnd && !PB.seeking) PB.onEnd(); });

// ---------- サムネイル（解析後に裏で作る。元動画が消えても残るよう IndexedDB に保存）
const TV = document.createElement('video');
TV.muted = true; TV.playsInline = true; TV.setAttribute('playsinline', ''); TV.preload = 'auto';
// iPhone はページに付いていない video を読み込まないことがあるので、見えない形でページに置く
TV.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
document.body.appendChild(TV);
const tFail = {}; // サムネイルの失敗回数（同じものを何度も試さない。つなぎ直したら数え直す）
// 診断情報（設定 → 診断情報 で見られる。実機で原因を調べるため）
const diagLog = [];
function diag(msg) { diagLog.push(new Date().toTimeString().slice(0, 8) + ' ' + msg); if (diagLog.length > 12) diagLog.shift(); console.warn(msg); }
const tQ = []; let tBusy = false;
function requestThumb(m, r, key) {
  if (L.tReq.has(key)) return;
  L.tReq.add(key);
  DB.getThumb(key).then((b) => {
    if (b) { L.thumbs[key] = URL.createObjectURL(b); softRender(); } else { tQ.push({ m, r, key }); pumpThumbs(); }
  }).catch((e) => { diag('サムネイルを読めません: ' + errMsg(e)); tQ.push({ m, r, key }); pumpThumbs(); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function frameReady(v, ms) {
  return new Promise((ok) => { setTimeout(ok, ms); if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => ok()); });
}
function isBlank(g) { // 真っ黒（何も描けていない）か。数点だけ見る
  const d = g.getImageData(0, 0, 176, 99).data;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) return false;
  return true;
}
async function pumpThumbs() {
  if (tBusy) return; tBusy = true;
  while (tQ.length) {
    const j = tQ.shift();
    try {
      if (!S.matches.includes(j.m) || !j.m.rallies.includes(j.r)) continue;
      const url = await mediaUrl(j.m);
      if (!url) { L.tReq.delete(j.key); continue; } // 元動画が無い：つなぎ直したらまた作る
      if (TV.src !== url || TV.readyState < 1) {
        if (TV.src !== url) TV.src = url;
        TV.load();
        await Promise.race([once(TV, 'loadedmetadata', 15000), once(TV, 'error', 15000).then(() => { throw new Error('動画を読めません（' + (TV.error && TV.error.code) + '）'); })]);
      }
      const [a, b] = rallySpan(j.m, j.r);
      const p = once(TV, 'seeked', 8000);
      TV.currentTime = Math.min(b, a + Math.min(1.8, (b - a) / 2));
      await p;
      // WebKit は seeked の直後だとまだ描けない（最初の1枚が真っ黒になる）ので、コマが届くのを待ち、黒ければ描き直す
      await frameReady(TV, 400);
      const c = document.createElement('canvas'); c.width = 176; c.height = 99;
      const g = c.getContext('2d', { willReadFrequently: true });
      for (let k = 0; ; k++) {
        g.drawImage(TV, 0, 0, 176, 99);
        if (!isBlank(g)) break;
        if (k >= 3) break; // 本当に黒いコマならそのまま使う
        await sleep(250);
      }
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.7));
      if (blob) {
        L.thumbs[j.key] = URL.createObjectURL(blob); softRender();
        await DB.putThumb(j.key, blob).catch((e) => diag('サムネイルを記録できません: ' + errMsg(e)));
      } else diag('サムネイルの画像を作れません');
    } catch (e) {
      tFail[j.key] = (tFail[j.key] || 0) + 1;
      diag('サムネイル失敗(' + tFail[j.key] + '): ' + errMsg(e));
      if (tFail[j.key] < 3) L.tReq.delete(j.key); // 3回失敗したら、つなぎ直すまで試さない
    }
  }
  tBusy = false;
}

// ---------- 起動
(async function boot() {
  try {
    const [ms, onboarded, a2hsHidden] = await Promise.all([DB.allMatches(), DB.get('onboarded'), DB.get('a2hsHidden')]);
    S.matches = (ms || []).sort((a, b) => b.created - a.created);
    S.a2hsHidden = !!a2hsHidden;
    if (!onboarded) S.stack = ['onboard'];
  } catch (e) {
    alertDlg('データを読めませんでした', errMsg(e));
  }
  render();
  requestAnimationFrame(tickLoop);
  // 通信なしで開けるように、アプリ本体を端末にしまう（sw.js）。アプリ版（Capacitor）では使わない
  if ('serviceWorker' in navigator && !P.native && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js?v=' + VER).catch((e) => diag('Service Worker: ' + errMsg(e)));
  }
  // 未保存の試合の元動画が、まだ開けるか確かめる（開けなければ「元動画なし」）
  for (const m of S.matches) {
    if (m.clip) continue;
    const r = await P.reopen(m.source, false);
    L.open[m.id] = r && r.url ? r : (r && r.needsPermission ? r : null);
  }
  if (['home', 'match'].includes(scr())) render();
})();

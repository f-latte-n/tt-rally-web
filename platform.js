// 「動画をどこから開くか」「ラリー動画をどこに保存するか」の差し替え層。
//   Web   ：File（または File System Access のハンドル）／OPFS
//   アプリ：RallyIO プラグイン（iOS: PHAsset、Android: content URI）／アプリ専用領域
// 画面（app.js）はここだけを通して読み書きする。動画の読み出しは source.js の形（size と slice(a,b).arrayBuffer()）。
(function () {
  'use strict';
  const C = window.Capacitor;
  const native = !!(C && C.isNativePlatform && C.isNativePlatform());
  const platform = native && C.getPlatform ? C.getPlatform() : 'web';
  const IO = native ? C.registerPlugin('RallyIO') : null;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const { rangeFile } = self.RallySource;

  const contentUrl = (uri) => location.origin + '/_rally_/content?u=' + encodeURIComponent(uri);
  const nativeClipUrl = (name) => location.origin + '/_rally_/clip/' + encodeURIComponent(name);
  const errMsg = (e) => (e && e.message) || String(e);
  const isCancel = (e) => /cancel|abort/i.test(errMsg(e)) || (e && e.name === 'AbortError');

  async function sizeOf(url) { // サイズが取れない提供元のとき、Content-Range から取る
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    const m = /\/(\d+)$/.exec(r.headers.get('Content-Range') || '');
    return m ? +m[1] : -1;
  }

  // ---------- 開く
  // 戻り値 { source, file, url }
  //   source：IndexedDB に保存する情報（次回つなぎ直すため）
  //   file  ：検出・保存で読むもの（File と同じ形）
  //   url   ：<video> で再生する URL
  async function nativeOpened(v) {
    if (!v.exists) throw new Error('動画が見つかりません');
    if (v.needsOpen) v = await IO.openVideo({ uri: v.uri }); // iOS：写真ライブラリから取り出す
    const url = v.url ? location.origin + v.url : contentUrl(v.uri);
    const size = v.size > 0 ? v.size : await sizeOf(url);
    return { source: { kind: 'native', uri: v.uri, name: v.name || '', size }, file: rangeFile(url, size, v.name || ''), url };
  }

  const blobUrls = new WeakMap();
  function fromFile(f, handle) {
    let url = blobUrls.get(f);
    if (!url) { url = URL.createObjectURL(f); blobUrls.set(f, url); }
    const source = { kind: handle ? 'handle' : 'file', name: f.name, size: f.size, lastModified: f.lastModified };
    if (handle) source.handle = handle;
    return { source, file: f, url };
  }

  function pickByInput() {
    return new Promise((ok, ng) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'video/*,.mov,.mp4,.m4v';
      inp.style.display = 'none';
      inp.onchange = () => { const f = inp.files[0]; inp.remove(); f ? ok(fromFile(f)) : ng(new Error('canceled')); };
      inp.addEventListener('cancel', () => { inp.remove(); ng(new Error('canceled')); });
      document.body.append(inp);
      inp.click();
    });
  }

  async function pickVideo() {
    if (native) return nativeOpened(await IO.pickVideo());
    // ハンドルを保存できるブラウザ（PC・Android の Chrome）は、次回から選び直さずに開ける
    if (window.showOpenFilePicker) {
      try {
        const [h] = await window.showOpenFilePicker({ types: [{ description: '動画', accept: { 'video/*': ['.mp4', '.mov', '.m4v'] } }] });
        return fromFile(await h.getFile(), h);
      } catch (e) {
        if (isCancel(e)) throw e;
        // セキュリティ上の理由などで使えなければ、ふつうのファイル選択に切り替える
      }
    }
    return pickByInput();
  }

  // 以前の動画につなぎ直す。見つからなければ null。
  // gesture：ユーザーの操作の中で呼ぶとき true（ブラウザの読み取り許可の確認を出せる）
  async function reopen(source, gesture) {
    if (!source) return null;
    try {
      if (source.kind === 'native') {
        if (!native) return null;
        if (platform === 'android') {
          const { items } = await IO.listPersisted();
          const v = items.find((x) => x.uri === source.uri);
          if (!v || !v.exists) return null;
          return await nativeOpened(v);
        }
        return await nativeOpened({ uri: source.uri, exists: true, needsOpen: true });
      }
      if (source.kind === 'handle' && source.handle) {
        const h = source.handle, opt = { mode: 'read' };
        let perm = h.queryPermission ? await h.queryPermission(opt) : 'granted';
        if (perm === 'prompt' && gesture && h.requestPermission) perm = await h.requestPermission(opt);
        if (perm !== 'granted') return perm === 'prompt' ? { needsPermission: true } : null;
        const f = await h.getFile();
        if (f.size !== source.size) return null;
        return fromFile(f, h);
      }
    } catch (e) {
      return null;
    }
    return null; // ふつうのファイル選択で開いた動画は、ページを開き直すとつなぎ直せない
  }

  // ---------- 保存先（ラリー動画）
  // plan：remux.js の planClip の結果（header ＋ 元ファイルのバイト範囲）
  function toBase64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function opfsDir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('clips', { create: true });
  }

  async function writeClip(name, plan, opened, onProgress) {
    if (native) {
      const h = await IO.addListener('clipProgress', (p) => onProgress && onProgress(p.done / p.total));
      try {
        const res = await IO.writeClip({ name, src: opened.source.uri, header: toBase64(plan.header), ranges: plan.ranges });
        return { name, bytes: res.bytes };
      } finally { h.remove(); }
    }
    // Web：OPFS。書き込みは Worker の同期アクセスハンドルで行う（Safari でも使える）
    if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) { /* 任意 */ } }
    const w = new Worker('opfs-write.js');
    try {
      return await new Promise((ok, ng) => {
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'progress') onProgress && onProgress(m.done / m.total);
          else if (m.type === 'done') ok({ name, bytes: m.bytes });
          else if (m.type === 'error') ng(new Error(m.message));
        };
        w.onerror = (e) => ng(new Error(e.message || '保存に失敗しました'));
        w.postMessage({ dir: 'clips', name, header: plan.header, ranges: plan.ranges, file: opened.file });
      });
    } finally { w.terminate(); }
  }

  const clipUrls = new Map();
  async function clipUrl(clip) {
    if (native) return nativeClipUrl(clip.name);
    if (clipUrls.has(clip.name)) return clipUrls.get(clip.name);
    const f = await (await (await opfsDir()).getFileHandle(clip.name)).getFile();
    const u = URL.createObjectURL(f);
    clipUrls.set(clip.name, u);
    return u;
  }
  async function clipFile(clip) {
    if (native) return rangeFile(nativeClipUrl(clip.name), clip.bytes, clip.name);
    return (await (await opfsDir()).getFileHandle(clip.name)).getFile();
  }
  async function deleteClip(clip) {
    if (native) { await IO.deleteClip({ name: clip.name }); return; }
    const u = clipUrls.get(clip.name);
    if (u) { URL.revokeObjectURL(u); clipUrls.delete(clip.name); }
    try { await (await opfsDir()).removeEntry(clip.name); } catch (e) { /* もう無い */ }
  }

  // ---------- 書き出し（有償）
  // アプリ：カメラロールへ（ネイティブ側は未実装）。Web：ダウンロード
  async function exportClip(name, plan, file) {
    if (native) throw new Error('カメラロールへの書き出しは準備中です');
    const blob = new Blob([plan.header, ...plan.ranges.map(([o, l]) => file.slice(o, o + l))], { type: 'video/mp4' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // ---------- 購入（App Store / Google Play 課金は未実装）
  // 開発中（localhost）だけ、書き出しを試せるように購入済みにできる
  const devUnlock = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  async function purchase() {
    if (devUnlock) return { ok: true };
    return { ok: false, message: '購入はまだ準備中です' };
  }
  async function restorePurchase() {
    if (devUnlock) return { ok: true };
    return { ok: false, message: '購入の復元はまだ準備中です' };
  }

  self.RallyPlatform = {
    native, platform, isAndroid,
    // Android は SW デコードが速くて正確（CLAUDE.md）。SW で扱えない形式は worker.js が既定に戻す
    decodeHw: isAndroid ? 'prefer-software' : '',
    canExport: !native,
    pickVideo, reopen, isCancel,
    writeClip, clipUrl, clipFile, deleteClip, exportClip,
    purchase, restorePurchase,
  };
})();

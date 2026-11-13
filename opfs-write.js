// Web 版の「ラリー動画を保存」：OPFS に header ‖ 元ファイル[ranges...] を書く。
// 同期アクセスハンドルは Worker 内でしか使えない（Safari も対応）。
self.onmessage = async (e) => {
  const { dir, name, header, ranges, file } = e.data;
  let ah = null;
  try {
    const root = await navigator.storage.getDirectory();
    const d = await root.getDirectoryHandle(dir, { create: true });
    const fh = await d.getFileHandle(name, { create: true });
    ah = await fh.createSyncAccessHandle();
    ah.truncate(0);
    const total = header.length + ranges.reduce((n, r) => n + r[1], 0);
    let at = 0;
    ah.write(header, { at }); at += header.length;
    const CH = 8 << 20;
    let last = 0;
    for (const [off, len] of ranges) {
      for (let p = 0; p < len; p += CH) {
        const n = Math.min(CH, len - p);
        const buf = new Uint8Array(await file.slice(off + p, off + p + n).arrayBuffer());
        if (buf.length !== n) throw new Error('元の動画を読めませんでした');
        ah.write(buf, { at }); at += n;
        const t = performance.now();
        if (t - last > 100) { last = t; self.postMessage({ type: 'progress', done: at, total }); }
      }
    }
    ah.flush(); ah.close(); ah = null;
    self.postMessage({ type: 'done', bytes: at });
  } catch (err) {
    if (ah) { try { ah.close(); } catch (_) { /* 無視 */ } }
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};

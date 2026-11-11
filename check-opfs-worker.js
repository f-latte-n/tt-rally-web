// 選んだ動画を OPFS にコピーする（同期アクセスハンドルは Worker 内でのみ使える）
self.onmessage = async (e) => {
  const { file } = e.data;
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(file.name, { create: true });
    const ah = await fh.createSyncAccessHandle();
    ah.truncate(0);
    const CH = 8 << 20, t0 = performance.now();
    for (let pos = 0; pos < file.size; pos += CH) {
      const buf = new Uint8Array(await file.slice(pos, pos + CH).arrayBuffer());
      ah.write(buf, { at: pos });
      self.postMessage({ type: 'progress', done: Math.min(file.size, pos + CH), total: file.size });
    }
    ah.flush(); ah.close();
    self.postMessage({ type: 'done', ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.name + ' ' + err.message });
  }
};

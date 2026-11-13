// 保存データ（IndexedDB）。全プラットフォーム共通。
// - matches：試合（ラリーの区間・★・コメント、元動画の情報、保存したラリー動画の情報）
// - thumbs ：ラリーのサムネイル（JPEG の Blob）。キーは「試合ID/ラリーID」。元動画が消えても残る
// - kv     ：設定など（はじめにを見たか、購入済みか）
(function () {
  'use strict';
  const NAME = 'tt-rally', VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((ok, ng) => {
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('matches')) db.createObjectStore('matches', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ng(r.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((ok, ng) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      let out;
      const req = fn(s);
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => ok(out);
      t.onerror = () => ng(t.error);
      t.onabort = () => ng(t.error);
    });
  }

  // FileSystemFileHandle などは保存できるが、関数や DOM は保存できないので、試合は素のデータだけにする
  const api = {
    allMatches: () => tx('matches', 'readonly', (s) => s.getAll()),
    putMatch: (m) => tx('matches', 'readwrite', (s) => s.put(m)),
    deleteMatch: (id) => tx('matches', 'readwrite', (s) => s.delete(id)),
    getThumb: (key) => tx('thumbs', 'readonly', (s) => s.get(key)),
    putThumb: (key, blob) => tx('thumbs', 'readwrite', (s) => s.put(blob, key)),
    deleteThumbs: (prefix) => tx('thumbs', 'readwrite', (s) => s.delete(IDBKeyRange.bound(prefix, prefix + '￿'))),
    get: (key) => tx('kv', 'readonly', (s) => s.get(key)),
    set: (key, v) => tx('kv', 'readwrite', (s) => s.put(v, key)),
  };
  self.RallyStore = api;
})();

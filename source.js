// 「動画をどこから読むか」の層。検出・保存は File と同じ形（size と slice(a,b).arrayBuffer()）で読む。
// - Web：File をそのまま使う
// - アプリ：ネイティブ側の Range 対応の読み出し口（URL）を、File と同じ形に包む
(function () {
  'use strict';

  async function fetchRange(url, a, b) {
    if (b <= a) return new ArrayBuffer(0);
    const r = await fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` }, cache: 'no-store' });
    if (!r.ok) throw new Error(`読み出し失敗 (HTTP ${r.status})`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength !== b - a) throw new Error(`範囲読み出しの長さが違います: ${buf.byteLength} / ${b - a} (HTTP ${r.status})`);
    return buf;
  }

  // URL を File と同じ形にする
  function rangeFile(url, size, name) {
    return {
      url, size, name,
      slice(a, b) { a = Math.max(0, a); b = Math.min(b == null ? size : b, size); return { arrayBuffer: () => fetchRange(url, a, b) }; },
    };
  }

  // トップレベルのboxを走査して ftyp と moov だけ読み、連結して返す（mdatは読まない）
  async function readMoov(file) {
    let pos = 0; const parts = [];
    while (pos + 8 <= file.size) {
      const h = new DataView(await file.slice(pos, Math.min(file.size, pos + 16)).arrayBuffer());
      let size = h.getUint32(0);
      const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
      if (size === 1) size = Number(h.getBigUint64(8));
      else if (size === 0) size = file.size - pos;
      if (size < 8) break;
      if (type === 'ftyp' || type === 'moov') parts.push(new Uint8Array(await file.slice(pos, pos + size).arrayBuffer()));
      if (type === 'moov') {
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
        out.buffer.fileStart = 0;
        return out.buffer;
      }
      pos += size;
    }
    throw new Error('moov が見つかりません（MP4/MOV以外？）');
  }

  const api = { fetchRange, rangeFile, readMoov };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else self.RallySource = api;
})();

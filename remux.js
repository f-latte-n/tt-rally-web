// ラリー区間だけを再エンコードなしで1本のMP4にする「設計図」を作る。
// 入力：元ファイルの ftyp+moov（mdat は不要）と区間 [[開始秒, 終了秒], ...]（検出の時刻＝先頭フレームを0秒とする）
// 出力：header（ftyp + 新しいmoov + mdatヘッダ）と ranges（元ファイルからコピーするバイト範囲）。
//       ファイル = header ‖ 元ファイル[ranges[0]] ‖ 元ファイル[ranges[1]] ‖ ...
// 大きなデータ（映像そのもの）はここを通らないので、コピーはネイティブ側やBlobの連結に任せられる。
// 開始はキーフレーム単位（区間の開始より少し前から始まる）。
(function () {
  'use strict';
  const MP4BoxLib = (typeof self !== 'undefined' && self.MP4Box) ||
    (typeof require === 'function' ? require('./vendor/mp4box.all.min.js') : null);

  // ---- box の読み取り（生バイト）
  function readBoxes(u8, start, end) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p), hdr = 8;
      const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) throw new Error('壊れたbox: ' + type);
      out.push({ type, start: p, size, hdr, end: p + size });
      p += size;
    }
    return out;
  }
  const kids = (u8, b) => readBoxes(u8, b.start + b.hdr, b.end);
  const find = (list, type) => list.find((b) => b.type === type);
  const raw = (u8, b) => u8.slice(b.start, b.end);

  // ---- box の書き出し
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function box(type, parts) {
    const body = concat(parts), out = new Uint8Array(8 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    return out;
  }
  const full = (type, version, flags, parts) => box(type, [new Uint8Array([version, flags >> 16 & 255, flags >> 8 & 255, flags & 255]), ...parts]);
  function u32(arr) {
    const out = new Uint8Array(arr.length * 4), dv = new DataView(out.buffer);
    for (let i = 0; i < arr.length; i++) dv.setUint32(i * 4, arr[i] >>> 0);
    return out;
  }
  function runLength(vals) { // [count, value, count, value, ...]
    const out = [];
    for (const v of vals) { if (out.length && out[out.length - 1] === v) out[out.length - 2]++; else out.push(1, v); }
    return out;
  }

  // ---- 既存boxの数値を書き換える（version 0/1 で位置が違う）
  function patchDuration(b, type, dur) {
    const dv = new DataView(b.buffer, b.byteOffset), v = b[8];
    const at = { mvhd: v ? 32 : 24, mdhd: v ? 32 : 24, tkhd: v ? 36 : 28 }[type];
    if (v) dv.setBigUint64(at, BigInt(Math.round(dur))); else dv.setUint32(at, Math.min(0xffffffff, Math.round(dur)));
    return b;
  }
  const tkhdId = (u8, b) => new DataView(u8.buffer, u8.byteOffset).getUint32(b.start + b.hdr + (u8[b.start + b.hdr] ? 20 : 12));
  // edts/elst の最初の通常エディット（空エディットは飛ばす）の media_time。無ければ 0
  function editMediaTime(u8, trak) {
    const edts = find(kids(u8, trak), 'edts'); if (!edts) return 0;
    const elst = find(kids(u8, edts), 'elst'); if (!elst) return 0;
    const dv = new DataView(u8.buffer, u8.byteOffset), p = elst.start + elst.hdr, v = u8[p], n = dv.getUint32(p + 4);
    for (let i = 0, q = p + 8; i < n; i++, q += v ? 20 : 12) {
      const mt = v ? Number(dv.getBigInt64(q + 8)) : dv.getInt32(q + 4);
      if (mt >= 0) return mt;
    }
    return 0;
  }

  // ---- 本体
  function planClip(moovBuf, segs, opts) {
    opts = opts || {};
    const GAP = opts.gap != null ? opts.gap : 64 << 10; // これ以下の隙間はまとめてコピー（範囲の数を減らす）
    const u8 = new Uint8Array(moovBuf);
    const top = readBoxes(u8, 0, u8.length);
    const ftyp = find(top, 'ftyp'), moov = find(top, 'moov');
    if (!moov) throw new Error('moov がありません');

    const mp4 = MP4BoxLib.createFile();
    let info = null;
    mp4.onError = (e) => { throw new Error(e); };
    mp4.onReady = (i) => { info = i; };
    const ab = u8.slice().buffer; ab.fileStart = 0;
    mp4.appendBuffer(ab); mp4.flush();
    if (!info) throw new Error('mp4box: moov を解析できません');
    const vt = info.videoTracks[0], at = info.audioTracks[0];
    if (!vt) throw new Error('映像トラックがありません');

    const moovKids = kids(u8, moov), traks = moovKids.filter((b) => b.type === 'trak');
    const trakOf = (id) => traks.find((t) => tkhdId(u8, find(kids(u8, t), 'tkhd')) === id);
    const movieTs = info.timescale;

    // --- 映像：区間ごとに「直前のキーフレーム〜終了時刻を含むサンプル」をとる（デコード順）
    const vs = mp4.getTrackById(vt.id).samples, vTs = vt.timescale;
    const vTrak = trakOf(vt.id), vMT = editMediaTime(u8, vTrak);
    let minCts = Infinity; for (const s of vs) minCts = Math.min(minCts, s.cts);
    const runs = [];
    for (const [a, b] of segs.slice().sort((x, y) => x[0] - y[0])) {
      const ca = minCts + a * vTs, cb = minCts + b * vTs;
      let k = 0;
      for (let i = 0; i < vs.length && vs[i].dts <= ca; i++) if (vs[i].is_sync && vs[i].cts <= ca) k = i;
      let L = k;
      for (let i = k; i < vs.length && vs[i].dts < cb; i++) if (vs[i].cts < cb) L = i;
      const last = runs[runs.length - 1];
      if (last && k <= last.L + 1) last.L = Math.max(last.L, L); // 重なる・隣り合う区間はつなげる
      else runs.push({ k, L });
    }
    if (!runs.length) throw new Error('区間がありません');

    const v = { ts: vTs, idx: [], dur: [], off: [] }; // 新しいファイルでのサンプル（元のindex・長さ）
    const a = at ? { ts: at.timescale, idx: [], dur: [] } : null;
    const as = at ? mp4.getTrackById(at.id).samples : [];
    const aMT = at ? editMediaTime(u8, trakOf(at.id)) : 0;
    let vCum = 0, aCum = 0, ai = 0;
    const clipRuns = []; // 新しいファイルでの各ラリーの開始・長さ（秒）
    for (const { k, L } of runs) {
      const startDts = vCum;
      // キーフレームより前に表示されるフレーム（open GOP の leading B）は前のGOPを参照するので除く
      const keep = [];
      for (let i = k; i <= L; i++) if (i === k || vs[i].cts >= vs[k].cts) keep.push(i);
      keep.forEach((i, n) => {
        const d = n + 1 < keep.length ? vs[keep[n + 1]].dts - vs[i].dts : vs[i].duration;
        v.idx.push(i); v.dur.push(d); vCum += d;
      });
      clipRuns.push({ startDts, keyOff: vs[k].cts - vs[k].dts, durDts: vCum - startDts,
                      srcStart: (vs[k].cts - minCts) / vTs, srcEnd: (vs[L].cts - minCts + vs[L].duration) / vTs });
      if (a) {
        // 音声：キーフレームの表示時刻に一番近いサンプルから、累積の長さが映像に追いつくまで
        const t0 = (vs[k].cts - vMT) / vTs;
        while (ai < as.length && (as[ai].cts - aMT + as[ai].duration / 2) / a.ts < t0) ai++;
        while (ai > 0 && (as[ai - 1].cts - aMT + as[ai - 1].duration / 2) / a.ts >= t0) ai--;
        const target = vCum / vTs;
        while (ai < as.length && (aCum + as[ai].duration / 2) / a.ts < target) {
          a.idx.push(ai); a.dur.push(as[ai].duration); aCum += as[ai].duration; ai++;
        }
      }
    }

    // --- コピーするバイト範囲（元ファイルのオフセット順に並べて、近いものはまとめる）
    const picks = v.idx.map((i) => vs[i]).concat(a ? a.idx.map((i) => as[i]) : []);
    const order = picks.slice().sort((x, y) => x.offset - y.offset);
    const ranges = [];
    for (const s of order) {
      const r = ranges[ranges.length - 1];
      if (r && s.offset <= r.src + r.len + GAP) r.len = Math.max(r.len, s.offset + s.size - r.src);
      else ranges.push({ src: s.offset, len: s.size });
    }
    let dst = 0; for (const r of ranges) { r.dst = dst; dst += r.len; }
    const dataLen = dst;
    const where = (o) => { // 元のオフセット → mdat データ内の位置
      let lo = 0, hi = ranges.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ranges[m].src <= o) lo = m; else hi = m - 1; }
      return ranges[lo].dst + (o - ranges[lo].src);
    };

    // --- 新しい moov
    function stbl(trak, samples, t, offsets) {
      const sb = find(kids(u8, find(kids(u8, find(kids(u8, find(kids(u8, trak), 'mdia')), 'minf')), 'stbl')), 'stsd');
      const parts = [raw(u8, sb)];
      parts.push(full('stts', 0, 0, [u32([0]), u32(runLength(t.dur))]));
      fixCount(parts[parts.length - 1]);
      const co = t.idx.map((i) => samples[i].cts - samples[i].dts);
      if (co.some((x) => x !== 0)) {
        const neg = co.some((x) => x < 0);
        const b = full('ctts', neg ? 1 : 0, 0, [u32([0]), u32(runLength(co))]); fixCount(b); parts.push(b);
      }
      const sync = []; t.idx.forEach((i, n) => { if (samples[i].is_sync) sync.push(n + 1); });
      if (sync.length < t.idx.length) parts.push(full('stss', 0, 0, [u32([sync.length]), u32(sync)]));
      parts.push(full('stsc', 0, 0, [u32([1, 1, 1, 1])]));
      parts.push(full('stsz', 0, 0, [u32([0, t.idx.length]), u32(t.idx.map((i) => samples[i].size))]));
      const co64 = new Uint8Array(4 + offsets.length * 8), dv = new DataView(co64.buffer);
      dv.setUint32(0, offsets.length);
      offsets.forEach((o, n) => dv.setBigUint64(4 + n * 8, BigInt(o)));
      parts.push(full('co64', 0, 0, [co64]));
      return box('stbl', parts);
    }
    // stts/ctts の entry_count（先頭の0）を実際の数に直す
    function fixCount(b) { const dv = new DataView(b.buffer, b.byteOffset); dv.setUint32(12, (b.length - 16) / 8); }

    function trakBox(trak, samples, t, offsets, edit) {
      const tk = kids(u8, trak), mdia = find(tk, 'mdia'), mk = kids(u8, mdia), minf = find(mk, 'minf');
      const trackDur = t.dur.reduce((n, d) => n + d, 0);
      // 表示の終わり（Bフレームの並べ替えで、最後のサンプルより後に表示されるフレームがある）
      let end = 0, d0 = 0;
      t.idx.forEach((i, n) => { end = Math.max(end, d0 + samples[i].cts - samples[i].dts + t.dur[n]); d0 += t.dur[n]; });
      const movieDur = (Math.max(trackDur, end) - edit) / t.ts * movieTs;
      const parts = [patchDuration(raw(u8, find(tk, 'tkhd')), 'tkhd', movieDur)];
      if (edit > 0) {
        const e = new Uint8Array(20), dv = new DataView(e.buffer);
        dv.setUint32(0, 1); dv.setBigUint64(4, BigInt(Math.round(movieDur))); dv.setBigInt64(12, BigInt(edit));
        const rate = new Uint8Array([0, 1, 0, 0]);
        parts.push(box('edts', [full('elst', 1, 0, [e, rate])]));
      }
      const minfParts = kids(u8, minf).filter((b) => b.type !== 'stbl').map((b) => raw(u8, b));
      minfParts.push(stbl(trak, samples, t, offsets));
      parts.push(box('mdia', [patchDuration(raw(u8, find(mk, 'mdhd')), 'mdhd', trackDur), raw(u8, find(mk, 'hdlr')), box('minf', minfParts)]));
      return { b: box('trak', parts), movieDur };
    }

    // 映像のエディット：先頭サンプルの表示時刻ずれ（Bフレームの遅延）を打ち消す
    let vEdit = Infinity, dts = 0;
    for (let n = 0; n < v.idx.length; n++) { const s = vs[v.idx[n]]; vEdit = Math.min(vEdit, dts + s.cts - s.dts); dts += v.dur[n]; }
    vEdit = Math.max(0, vEdit);
    // 新しいファイルでの各ラリーの開始＝キーフレームの表示時刻
    const rallies = clipRuns.map((r) => ({ start: (r.startDts + r.keyOff - vEdit) / vTs, duration: r.durDts / vTs,
                                           srcStart: r.srcStart, srcEnd: r.srcEnd }));

    function buildMoov(base) {
      const vOff = v.idx.map((i) => base + where(vs[i].offset));
      const tv = trakBox(vTrak, vs, v, vOff, vEdit);
      const list = [tv.b]; let dur = tv.movieDur;
      if (a && a.idx.length) {
        const ta = trakBox(trakOf(at.id), as, a, a.idx.map((i) => base + where(as[i].offset)), 0);
        list.push(ta.b); dur = Math.max(dur, ta.movieDur);
      }
      return box('moov', [patchDuration(raw(u8, find(moovKids, 'mvhd')), 'mvhd', dur), ...list]);
    }
    const ftypRaw = ftyp ? raw(u8, ftyp) : box('ftyp', [new TextEncoder().encode('qt  '), u32([0x200]), new TextEncoder().encode('qt  ')]);
    const moovLen = buildMoov(0).length;
    const base = ftypRaw.length + moovLen + 16;
    const moovNew = buildMoov(base);
    const mdatHdr = new Uint8Array(16), dv = new DataView(mdatHdr.buffer);
    dv.setUint32(0, 1); mdatHdr.set([109, 100, 97, 116], 4); dv.setBigUint64(8, BigInt(16 + dataLen));
    const header = concat([ftypRaw, moovNew, mdatHdr]);

    return {
      header,
      ranges: ranges.map((r) => [r.src, r.len]),
      size: header.length + dataLen,
      duration: vCum / vTs,
      rallies, // 新しいファイルでの各ラリーの位置（元動画での位置も）
      video: v.idx.length, audio: a ? a.idx.length : 0,
    };
  }

  const api = { planClip, readBoxes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else self.RallyRemux = api;
})();

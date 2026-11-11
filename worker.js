// デマックス(mp4box.js) → デコード(WebCodecs) → 縮小・ROI読み出し(OffscreenCanvas) → 検出(detect.js)
importScripts('vendor/mp4box.all.min.js', 'detect.js' + self.location.search); // ?v= を引き継いでキャッシュ回避
const { PARAMS, Detector, track, segment, yuvToRgba, unexpandRange } = self.RallyDetect;
const BASE_W = 640;
const MAX_FRAMES = 8; // 同時に保持するフレーム数（読み出しの並行数）

self.onmessage = (e) => {
  if (e.data.type === 'start') run(e.data.file, e.data.opts).catch((err) => post({ type: 'error', message: String(err && err.message || err) }));
};
const post = (m, tr) => self.postMessage(m, tr || []);
const now = () => performance.now();

// トップレベルのboxを走査して ftyp と moov だけ読み、連結して mp4box に渡す（mdatは読まない）
async function readMoov(file) {
  let pos = 0; const parts = [];
  while (pos + 8 <= file.size) {
    const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
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

async function openTrack(file) {
  const buf = await readMoov(file);
  const mp4 = MP4Box.createFile();
  let info = null;
  mp4.onError = (e) => { throw new Error(e); };
  mp4.onReady = (i) => { info = i; };
  mp4.appendBuffer(buf);
  mp4.flush();
  if (!info) throw new Error('mp4box: moov を解析できません');
  const vt = info.videoTracks[0];
  if (!vt) throw new Error('映像トラックがありません');
  const trak = mp4.getTrackById(vt.id);
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
  let description;
  if (box) {
    const s = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    box.write(s);
    description = new Uint8Array(s.buffer, 8); // boxヘッダを除く
  }
  // ファイル側の色範囲（colr nclx の full_range_flag）。無ければ limited とみなす
  const colr = entry.colr || (entry.boxes || []).find((b) => b.type === 'colr');
  const srcFull = !!(colr && colr.full_range_flag);
  return { vt, samples: trak.samples, description, srcFull };
}

async function run(file, opts) {
  const st = { demux: 0, io: 0, grab: 0, detect: 0, post: 0 };
  const T0 = now();
  const { vt, samples, description, srcFull } = await openTrack(file);
  st.demux = now() - T0;

  const config = { codec: vt.codec, codedWidth: vt.video.width, codedHeight: vt.video.height, description };
  if (opts.hw) config.hardwareAcceleration = opts.hw;
  const sup = await VideoDecoder.isConfigSupported(config);
  if (!sup.supported) throw new Error('このブラウザでデコードできません: ' + vt.codec);

  const duration = vt.movie_duration / vt.movie_timescale || vt.duration / vt.timescale;
  post({ type: 'info', codec: vt.codec, width: vt.video.width, height: vt.video.height, frames: samples.length,
         duration, fps: samples.length / (vt.samples_duration / vt.timescale) });

  const { x: rx, y: ry, w: rw, h: rh } = PARAMS.roi;
  const det = new Detector(), rgba = new Uint8ClampedArray(rw * rh * 4);
  const pos = [], ts = [];
  let ctx = null, method = '';
  const pool = []; // copyTo用バッファの使い回し
  // 診断：特定フレームのROI(YUV)の合計とハッシュ。ffmpegのデコード結果と比べて端末差を調べる
  const DIAG_FRAMES = [0, 100, 1800, 5000];
  const diag = { frames: {}, tsBackward: 0 };
  function yuvDigest(buf, fmt, layout, w, h) {
    const nv12 = fmt === 'NV12';
    let sy = 0, su = 0, sv = 0, hy = 0x811c9dc5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = buf[layout[0].offset + y * layout[0].stride + x];
      sy += v; hy = Math.imul(hy ^ v, 0x01000193) >>> 0;
    }
    for (let y = 0; y < h >> 1; y++) for (let x = 0; x < w >> 1; x++) {
      if (nv12) { const o = layout[1].offset + y * layout[1].stride + x * 2; su += buf[o]; sv += buf[o + 1]; }
      else { su += buf[layout[1].offset + y * layout[1].stride + x]; sv += buf[layout[2].offset + y * layout[2].stride + x]; }
    }
    return { sumY: sy, sumU: su, sumV: sv, hashY: hy.toString(16) };
  }
  let frameErr = null, wake = null, lastProg = 0, pending = 0, chain = Promise.resolve();

  // ROI（640x360基準）の読み出しを開始する。copyTo は非同期なので複数フレーム並行に投げ、
  // 戻り値の関数（RGBAを返す）は順番どおりに呼ぶ。
  function startGrab(frame) {
    const s = frame.displayWidth / BASE_W, fmt = frame.format;
    if (opts.read === 'copy' && (fmt === 'I420' || fmt === 'NV12')) {
      // YUVをROIだけコピーして自前で変換（Pythonと同じ色変換）
      const vr = frame.visibleRect;
      const x0 = Math.floor(rx * s) & ~1, y0 = Math.floor(ry * s) & ~1;
      const x1 = Math.min(vr.width, (Math.ceil((rx + rw) * s) + 1) & ~1), y1 = Math.min(vr.height, (Math.ceil((ry + rh) * s) + 1) & ~1);
      const rect = { x: vr.x + x0, y: vr.y + y0, width: x1 - x0, height: y1 - y0 };
      const size = frame.allocationSize({ rect });
      let buf = pool.pop();
      if (!buf || buf.length < size) buf = new Uint8Array(size);
      const cs = frame.colorSpace ? frame.colorSpace.toJSON() : null;
      const frameFull = !!(cs && cs.fullRange);
      // 自動：ファイルが limited なのにフレームが full → 端末が引き延ばしたので逆変換して limited で扱う
      const undo = opts.range === 'undo' || (!opts.range && frameFull && !srcFull);
      const full = !undo && (opts.range === 'full' || (opts.range !== 'limited' && frameFull));
      if (!diag.first) diag.first = { fmt, cs, srcFull, undo, coded: [frame.codedWidth, frame.codedHeight], visible: vr.toJSON ? vr.toJSON() : vr, rect };
      return frame.copyTo(buf, { rect }).then((layout) => () => {
        const k = ts.length - 1;
        if (k === 0) diag.first.layout = layout;
        const dg = DIAG_FRAMES.includes(k);
        if (dg && undo) (diag.raw = diag.raw || {})[k] = yuvDigest(buf, fmt, layout, rect.width, rect.height);
        if (undo) unexpandRange(buf, fmt, layout, rect.width, rect.height);
        if (dg) diag.frames[k] = yuvDigest(buf, fmt, layout, rect.width, rect.height);
        // 色行列はOpenCV同様つねにBT.601（閾値はその条件で調整済み）
        yuvToRgba(buf, fmt, layout, rx * s - x0, ry * s - y0, s, rw, rh, rgba, { fullRange: full });
        pool.push(buf);
        method = 'copyTo ' + fmt + (undo ? ' undo' : full ? ' full' : ' limited');
        return rgba;
      });
    }
    return Promise.resolve(() => {
      if (!ctx) ctx = new OffscreenCanvas(rw, rh).getContext('2d', { willReadFrequently: opts.read === 'canvas-wrf' });
      ctx.drawImage(frame, rx * s, ry * s, rw * s, rh * s, 0, 0, rw, rh);
      method = 'canvas ' + fmt + (opts.read === 'canvas-wrf' ? ' wrf' : '');
      return ctx.getImageData(0, 0, rw, rh).data;
    });
  }

  const decoder = new VideoDecoder({
    output: (frame) => {
      pending++;
      const job = opts.detect ? startGrab(frame) : null;
      if (job) job.catch(() => {});
      chain = chain.then(async () => {
        if (ts.length && frame.timestamp <= ts[ts.length - 1]) diag.tsBackward++;
        ts.push(frame.timestamp);
        if (ts.length === 1) sendPreview(frame);
        if (job) {
          const t = now(); const px = (await job)(); const t2 = now(); st.grab += t2 - t;
          pos.push(det.push(px));
          st.detect += now() - t2;
        }
      }).catch((err) => { frameErr = frameErr || err; }).finally(() => {
        frame.close(); pending--;
        if (wake) { const w = wake; wake = null; w(); }
        const t = now();
        if (t - lastProg > 250) { lastProg = t; post({ type: 'progress', done: ts.length, total: samples.length, elapsed: t - T0 }); }
      });
    },
    error: (e) => { frameErr = e; if (wake) wake(); },
  });
  decoder.configure(config);

  const waitOutput = () => new Promise((r) => { wake = r; setTimeout(() => { if (wake === r) wake = null; r(); }, 4); });
  const BLOCK = 8 << 20;
  for (let i = 0; i < samples.length;) {
    const s0 = samples[i]; let j = i, end = s0.offset + s0.size;
    while (j + 1 < samples.length) {
      const n = samples[j + 1];
      if (n.offset < s0.offset || n.offset + n.size - s0.offset > BLOCK) break;
      j++; end = Math.max(end, n.offset + n.size);
    }
    let t = now();
    const buf = new Uint8Array(await file.slice(s0.offset, end).arrayBuffer());
    st.io += now() - t;
    for (let k = i; k <= j; k++) {
      while ((decoder.decodeQueueSize > 12 || pending > MAX_FRAMES) && !frameErr) await waitOutput();
      if (frameErr) throw frameErr;
      const s = samples[k];
      decoder.decode(new EncodedVideoChunk({
        type: s.is_sync ? 'key' : 'delta',
        timestamp: Math.round(s.cts * 1e6 / s.timescale),
        duration: Math.round(s.duration * 1e6 / s.timescale),
        data: buf.subarray(s.offset - s0.offset, s.offset - s0.offset + s.size),
      }));
    }
    i = j + 1;
  }
  await decoder.flush();
  await chain;
  decoder.close();
  if (frameErr) throw frameErr;
  const T1 = now();

  let segs = [], ev = new Uint8Array(0), chains = 0;
  const times = new Float64Array(ts.length);
  for (let k = 0; k < ts.length; k++) times[k] = (ts[k] - ts[0]) / 1e6;
  if (opts.detect) {
    const r = track(pos);
    ev = r.ev; chains = r.ball.length;
    segs = segment(ev, times);
  }
  st.post = now() - T1;
  const total = now() - T0;
  post({ type: 'done', segs, ev, times, chains, frames: ts.length,
         method, diag: { ...diag, cands: pos.reduce((n, c) => n + c.length, 0), ballFrames: ev.reduce((n, v) => n + v, 0) }, stats: { total, ...st, other: Math.max(0, T1 - T0 - st.demux - st.io - st.grab - st.detect) } },
       [ev.buffer, times.buffer]);
}

function sendPreview(frame) {
  const w = 640, h = Math.round(640 * frame.displayHeight / frame.displayWidth);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(frame, 0, 0, w, h);
  const bmp = c.transferToImageBitmap();
  post({ type: 'preview', bmp, roi: PARAMS.roi }, [bmp]);
}

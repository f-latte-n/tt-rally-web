// ラリー検出コア（prototype/*.py の移植）。Worker（importScripts）と Node（require）の両方で動く。
(function (root) {
  'use strict';

  const PARAMS = {
    roi: { x: 170, y: 60, w: 280, h: 170 }, // 球用ROI（640x360基準）
    diffTh: 25, vMin: 170, sMax: 70,        // 3フレーム差分・明るさ・彩度
    areaMin: 2, areaMax: 40, sizeMax: 10, maxCands: 5,
    stepMin: 4, stepMax: 35, chainMin: 4, chainDx: 30, // 追跡
    gap: 1.3, minLen: 1.0, minBallFrames: 15, pre: 1.5, post: 1.0, // 区間化
  };

  // OpenCV と同じ固定小数点の変換（BGR2GRAY / BGR2HSV 8bit）
  const SDIV = new Int32Array(256);
  for (let i = 1; i < 256; i++) SDIV[i] = Math.round((255 << 12) / i);

  // フレームを1枚ずつ push する。戻り値はこのフレーム番号での球候補 [[x,y],...]
  // （Python同様、候補はひとつ前のフレームのもの。最初の2フレームは空）
  function Detector(p) {
    p = p || PARAMS;
    const { w, h } = p.roi, n = w * h, BW = (w + 1) >> 1;
    let gA = new Uint8Array(n), gB = new Uint8Array(n), gC = new Uint8Array(n);
    let bB = new Uint8Array(n), bC = new Uint8Array(n);
    const mask = new Uint8Array(n), stack = new Int32Array(n);
    let count = 0;

    // rgba: ROI部分の画素（w*h*4）
    this.push = function (rgba) {
      const g2 = gC, b2 = bC, vMin = p.vMin, sMax = p.sMax;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
        g2[i] = (b * 1868 + g * 9617 + r * 4899 + 8192) >> 14;
        let mx = r > g ? r : g; if (b > mx) mx = b;
        if (mx > vMin) {
          let mn = r < g ? r : g; if (b < mn) mn = b;
          b2[i] = (((mx - mn) * SDIV[mx] + 2048) >> 12) < sMax ? 1 : 0;
        } else b2[i] = 0;
      }
      let cands = [];
      if (count >= 2) {
        const g0 = gA, g1 = gB, b1 = bB, th = p.diffTh;
        let any = false;
        for (let i = 0; i < n; i++) {
          const d1 = g1[i] - g0[i], d2 = g2[i] - g1[i];
          const m = b1[i] && (d1 > th || d1 < -th) && (d2 > th || d2 < -th) ? 1 : 0;
          mask[i] = m; if (m) any = true;
        }
        if (any) cands = components();
      }
      // 回転：A<-B<-C
      const t = gA; gA = gB; gB = gC; gC = t;
      const tb = bB; bB = bC; bC = tb;
      count++;
      return cands;
    };

    // 8近傍の連結成分。OpenCV(Spaghetti)のラベル順＝2x2ブロック走査順に並べる
    function components() {
      const out = [];
      for (let i0 = 0; i0 < n; i0++) {
        if (!mask[i0]) continue;
        let sp = 0; stack[sp++] = i0; mask[i0] = 0;
        let area = 0, sx = 0, sy = 0, x0 = w, x1 = -1, y0 = h, y1 = -1, key = Infinity;
        while (sp) {
          const j = stack[--sp], x = j % w, y = (j - x) / w;
          area++; sx += x; sy += y;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          const k = (y >> 1) * BW + (x >> 1); if (k < key) key = k;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy; if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx; if (xx < 0 || xx >= w) continue;
              const q = yy * w + xx;
              if (mask[q]) { mask[q] = 0; stack[sp++] = q; }
            }
          }
        }
        if (area >= p.areaMin && area <= p.areaMax && x1 - x0 + 1 <= p.sizeMax && y1 - y0 + 1 <= p.sizeMax)
          out.push({ key, x: sx / area + p.roi.x, y: sy / area + p.roi.y });
      }
      out.sort((a, b) => a.key - b.key);
      return out.slice(0, p.maxCands).map(c => [c.x, c.y]);
    }
  }

  // track.py：候補をつないで球らしい軌跡を抽出。ev[f]=1 が球フレーム
  function track(pos, p) {
    p = p || PARAMS;
    const chains = []; let active = [];
    for (let f = 0; f < pos.length; f++) {
      const cands = pos[f], used = new Set(), next = [];
      for (const ch of active) {
        const [, px, py] = ch[ch.length - 1];
        let best = -1, bd = 1e9;
        for (let j = 0; j < cands.length; j++) {
          if (used.has(j)) continue;
          const [x, y] = cands[j], dx = x - px, dy = y - py, dist = (dx * dx + dy * dy) ** 0.5;
          if (dist >= p.stepMin && dist <= p.stepMax) {
            if (ch.length >= 2 && Math.sign(x - px) !== Math.sign(px - ch[ch.length - 2][1]) && Math.abs(x - px) > 3) continue;
            if (dist < bd) { best = j; bd = dist; }
          }
        }
        if (best >= 0) { used.add(best); ch.push([f, cands[best][0], cands[best][1]]); next.push(ch); }
        else chains.push(ch);
      }
      for (let j = 0; j < cands.length; j++) if (!used.has(j)) next.push([[f, cands[j][0], cands[j][1]]]);
      active = next;
    }
    chains.push(...active);
    const ball = chains.filter(c => c.length >= p.chainMin && Math.abs(c[c.length - 1][1] - c[0][1]) >= p.chainDx);
    const ev = new Uint8Array(pos.length);
    for (const c of ball) for (const [f] of c) ev[f] = 1;
    return { ev, ball };
  }

  // segment.py：球フレームを区間にまとめる。times[f] = フレームfの秒
  function segment(ev, times, p) {
    p = p || PARAMS;
    const groups = [];
    for (let f = 0; f < ev.length; f++) {
      if (!ev[f]) continue;
      const x = times[f], g = groups[groups.length - 1];
      if (g && x - g[1] <= p.gap) { g[1] = x; g[2]++; } else groups.push([x, x, 1]);
    }
    const m = [];
    for (const [a, b, cnt] of groups) {
      if (b - a < p.minLen || cnt < p.minBallFrames) continue;
      const s = Math.max(0, a - p.pre), e = b + p.post, last = m[m.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e); else m.push([s, e]);
    }
    return m;
  }

  // YUV(I420/NV12)のバッファからROIを切り出し、縮小しながらRGBAにする。
  // 変換は ffmpeg(swscale x86) の固定小数点式と同じ → OpenCV(Python試作)と画素単位で一致する。
  // buf: 平面データ、layout: [{offset,stride}...]、(ox0,oy0): bufの座標でのROI左上、s: 縮小率（元/640）
  // out は Uint8ClampedArray（クリップのため）
  function yuvToRgba(buf, format, layout, ox0, oy0, s, outW, outH, out, cs) {
    const nv12 = format === 'NV12';
    const Yo = layout[0].offset, Ys = layout[0].stride, Uo = layout[1].offset, Us = layout[1].stride;
    const Vo = nv12 ? Uo + 1 : layout[2].offset, Vs = nv12 ? Us : layout[2].stride, cstep = nv12 ? 2 : 1;
    const full = !!(cs && cs.fullRange), t = [104597, 132201, 25675, 53279]; // swscale の BT.601 係数
    const k = full ? 224 / 255 : 1, c = (v) => Math.round(v / 65536 * 8192 * k);
    const cy = full ? 8192 : Math.round(1.164383 * 8192), yoff = full ? 0 : 16;
    const crv = c(t[0]), cbu = c(t[1]), cgu = -c(t[2]), cgv = -c(t[3]);
    const xa = new Int32Array(outW), xb = new Int32Array(outW), xc = new Int32Array(outW);
    for (let x = 0; x < outW; x++) {
      xa[x] = Math.floor(ox0 + x * s); xb[x] = Math.max(xa[x] + 1, Math.floor(ox0 + (x + 1) * s));
      xc[x] = (Math.floor(ox0 + (x + 0.5) * s) >> 1) * cstep;
    }
    // 輝度LUT・色差LUT（固定小数点の結果をそのまま表に）
    const LY = new Int32Array(256), RV = new Int32Array(256), GU = new Int32Array(256), GV = new Int32Array(256), BU = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      LY[i] = ((i - yoff) * 8 * cy) >> 16;
      const d = (i - 128) * 8;
      RV[i] = (d * crv) >> 16; GU[i] = (d * cgu) >> 16; GV[i] = (d * cgv) >> 16; BU[i] = (d * cbu) >> 16;
    }
    const acc = new Int32Array(outW), one = s === 1 && ox0 === Math.floor(ox0) && oy0 === Math.floor(oy0);
    let o = 0;
    for (let y = 0; y < outH; y++) {
      const ya = Math.floor(oy0 + y * s), yb = Math.max(ya + 1, Math.floor(oy0 + (y + 1) * s));
      const yc = Math.floor(oy0 + (y + 0.5) * s) >> 1, ur = Uo + yc * Us, vr = Vo + yc * Vs;
      if (one) {
        const r = Yo + ya * Ys + ox0;
        for (let x = 0; x < outW; x++) acc[x] = buf[r + x];
      } else {
        // 縮小：s×s の平均（横に足してから縦に足す）
        acc.fill(0);
        for (let yy = ya; yy < yb; yy++) {
          const r = Yo + yy * Ys;
          for (let x = 0; x < outW; x++) { let a = 0; const e = r + xb[x]; for (let q = r + xa[x]; q < e; q++) a += buf[q]; acc[x] += a; }
        }
        const nh = yb - ya;
        for (let x = 0; x < outW; x++) { const n = nh * (xb[x] - xa[x]); acc[x] = ((acc[x] + (n >> 1)) / n) | 0; }
      }
      for (let x = 0; x < outW; x++) {
        const L = LY[acc[x]], u = buf[ur + xc[x]], v = buf[vr + xc[x]];
        out[o++] = L + RV[v];
        out[o++] = L + GU[u] + GV[v];
        out[o++] = L + BU[u];
        out[o++] = 255;
      }
    }
  }

  // iPhone(WebKit)は limited の映像を full に引き延ばして VideoFrame を返す。
  // その式（実測で特定）：Y' = floor(1.16425*(Y-16)+0.51)、C' = floor(1.1381*(C-128)+128.485)
  // 単調なので逆表を作れば元の値に正確に戻せる。
  function makeInverse(f, lo, hi) {
    const inv = new Uint8Array(256), hit = new Int16Array(256).fill(-1);
    for (let v = lo; v <= hi; v++) { const q = Math.min(255, Math.max(0, f(v))); if (hit[q] < 0) hit[q] = v; }
    let last = lo; // 写像されない値は直前の値に寄せる
    for (let q = 0; q < 256; q++) { if (hit[q] >= 0) last = hit[q]; inv[q] = last; }
    return inv;
  }
  const INV_Y = makeInverse((v) => Math.floor(1.16425 * (v - 16) + 0.51), 0, 255);
  const INV_C = makeInverse((v) => Math.floor(1.1381 * (v - 128) + 128.485), 0, 255);
  // buf の Y/UV 平面（w×h の範囲）をその場で limited に戻す
  function unexpandRange(buf, format, layout, w, h) {
    for (let y = 0; y < h; y++) { const r = layout[0].offset + y * layout[0].stride; for (let x = 0; x < w; x++) buf[r + x] = INV_Y[buf[r + x]]; }
    const planes = format === 'NV12' ? [[layout[1], w]] : [[layout[1], w >> 1], [layout[2], w >> 1]];
    for (const [pl, cw] of planes) for (let y = 0; y < h >> 1; y++) { const r = pl.offset + y * pl.stride; for (let x = 0; x < cw; x++) buf[r + x] = INV_C[buf[r + x]]; }
  }

  const api = { PARAMS, Detector, track, segment, yuvToRgba, unexpandRange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RallyDetect = api;
})(typeof self !== 'undefined' ? self : this);

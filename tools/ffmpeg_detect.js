// Node でアルゴリズムだけを検証する（ffmpeg でデコード → detect.js）。
// 使い方: node web/tools/ffmpeg_detect.js 動画.mov [segs.json] [cands.json]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PARAMS, Detector, track, segment, yuvToRgba } = require(path.join(__dirname, '..', 'detect.js'));

const [src, outSegs, outCands] = process.argv.slice(2);
const W = 640, H = 360, FPS = 60000 / 1001, { x: rx, y: ry, w: rw, h: rh } = PARAMS.roi;
// YUV=1 でブラウザの copyTo 経路と同じ変換（yuvToRgba）を使う
const YUV = process.env.YUV === '1';
const ff = spawn('ffmpeg', ['-v', 'error', '-i', src, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', YUV ? 'yuv420p' : 'rgb24', '-']);
const det = new Detector(), pos = [], frame = Buffer.alloc(YUV ? W * H * 3 / 2 : W * H * 3), roi = new Uint8ClampedArray(rw * rh * 4);
const layout = [{ offset: 0, stride: W }, { offset: W * H, stride: W / 2 }, { offset: W * H * 5 / 4, stride: W / 2 }];
let fill = 0; const t0 = Date.now();
ff.stdout.on('data', (buf) => {
  let o = 0;
  while (o < buf.length) {
    const k = Math.min(buf.length - o, frame.length - fill);
    buf.copy(frame, fill, o, o + k); fill += k; o += k;
    if (fill === frame.length) {
      if (YUV) yuvToRgba(frame, 'I420', layout, rx, ry, 1, rw, rh, roi);
      else for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
        const s = ((y + ry) * W + x + rx) * 3, d = (y * rw + x) * 4;
        roi[d] = frame[s]; roi[d + 1] = frame[s + 1]; roi[d + 2] = frame[s + 2]; roi[d + 3] = 255;
      }
      pos.push(det.push(roi)); fill = 0;
    }
  }
});
ff.on('close', () => {
  const { ev, ball } = track(pos);
  const segs = segment(ev, pos.map((_, i) => i / FPS));
  segs.forEach(([a, b], i) => console.log(`${String(i + 1).padStart(2)}  ${a.toFixed(1).padStart(6)} - ${b.toFixed(1).padStart(6)}  (${(b - a).toFixed(1)}s)`));
  const kept = segs.reduce((s, [a, b]) => s + b - a, 0);
  console.log(`frames=${pos.length} chains=${ball.length} rallies=${segs.length} kept=${kept.toFixed(0)}s  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (outSegs) fs.writeFileSync(outSegs, JSON.stringify(segs));
  if (outCands) fs.writeFileSync(outCands, JSON.stringify(pos));
});

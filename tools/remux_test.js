// remux.js を Node で検証する：設計図どおりにファイルを組み立て、ffmpeg でエラーなく読めるか、
// 出力の全フレームが元動画にあり、各ラリーの先頭が元動画の正しいフレームかを調べる。
// 使い方: node web/tools/remux_test.js 元動画 segs.json 出力.mp4   （FRAMES=0 でフレーム照合を省く）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { planClip } = require(path.join(__dirname, '..', 'remux.js'));

const [src, segsPath, out] = process.argv.slice(2);
const segs = JSON.parse(fs.readFileSync(segsPath, 'utf8'));
const fd = fs.openSync(src, 'r'), size = fs.fstatSync(fd).size;
const read = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };

// ftyp + moov だけ読む（worker.js の readMoov と同じ）
function readMoov() {
  let pos = 0; const parts = [];
  while (pos + 8 <= size) {
    const h = read(pos, 16); let s = h.readUInt32BE(0); const type = h.toString('latin1', 4, 8);
    if (s === 1) s = Number(h.readBigUInt64BE(8)); else if (s === 0) s = size - pos;
    if (type === 'ftyp' || type === 'moov') parts.push(read(pos, s));
    if (type === 'moov') { const b = Buffer.concat(parts); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); }
    pos += s;
  }
  throw new Error('no moov');
}

let t = Date.now();
const plan = planClip(readMoov(), segs);
const tPlan = Date.now() - t;
t = Date.now();
const ofd = fs.openSync(out, 'w');
fs.writeSync(ofd, plan.header);
for (const [p, len] of plan.ranges) {
  for (let o = 0; o < len; o += 8 << 20) { const n = Math.min(8 << 20, len - o); fs.writeSync(ofd, read(p + o, n)); }
}
fs.closeSync(ofd);
const tCopy = Date.now() - t;
const outSize = fs.statSync(out).size;
console.log(JSON.stringify({ plan_ms: tPlan, copy_ms: tCopy, header: plan.header.length, ranges: plan.ranges.length,
  size: outSize, expected: plan.size, ratio: +(outSize / size).toFixed(3), duration: +plan.duration.toFixed(3),
  video: plan.video, audio: plan.audio, rallies: plan.rallies.length }));
if (outSize !== plan.size) throw new Error('size mismatch');

// ffmpeg で全体をデコードしてエラーがないか
const err = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
console.log('decode errors:', err.trim() || 'none');
const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration,nb_frames:format=duration', '-of', 'compact', out], { encoding: 'utf8' });
console.log(probe.trim());

if (process.env.FRAMES === '0') process.exit(0);
// 全フレームの framemd5（表示順）を取り、出力の各フレームが元動画の何フレーム目かを調べる
function list(f) {
  const lines = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-an', '-vsync', 'passthrough', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n');
  const hs = lines.filter((l) => l && l[0] !== '#').map((l) => l.split(',').pop().trim());
  // framemd5 の pts は丸められるので、表示時刻は ffprobe のパケット（捨てる印 D を除く）から取る
  const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', f],
    { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n').map((l) => l.split(',')).filter((r) => !r[1].includes('D'))
    .map((r) => +r[0]).sort((x, y) => x - y);
  if (pts.length !== hs.length) console.log(`warn: ${f} packets ${pts.length} != frames ${hs.length}`);
  return hs.map((h, i) => ({ t: pts[i] - pts[0], h })); // 先頭フレームを0秒とした表示時刻
}
const A = list(out), B = list(src), first = new Map();
B.forEach((r, i) => { if (!first.has(r.h)) first.set(r.h, i); });
const unmatched = A.filter((r) => !first.has(r.h)).length;
const at = (L, sec) => { const i = L.findIndex((r) => r.t >= sec - 1e-3); return i < 0 ? L.length - 1 : i; };
const bad = [];
plan.rallies.forEach((r, k) => {
  const got = first.get(A[at(A, r.start)].h), exp = at(B, r.srcStart);
  if (got !== exp) bad.push([k, got, exp]);
});
console.log(`frames: out ${A.length} / src ${B.length}, unmatched ${unmatched}, rally starts bad ${JSON.stringify(bad)}`);

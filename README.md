# 卓球ラリー検出 試作ページ（速度計測用）

公開ページ: https://f-latte-n.github.io/tt-rally-web/

動画はブラウザ内だけで処理し、どこにも送信しません。

- `index.html` 画面 / `worker.js` デマックス→デコード→ROI読み出し / `detect.js` 検出コア
- WebCodecs は安全なコンテキスト（HTTPS か localhost）でしか動かない。

```
python3 -m http.server 8765    # ローカル: http://localhost:8765/
```

## 照合
- `node tools/ffmpeg_detect.js 動画.mov [segs.json]` … ffmpegでデコードしてJS版の検出だけ実行（`YUV=1` でブラウザと同じ色変換経路）
- 色変換は swscale(x86) の固定小数点式を再現しており、640x360 の動画では OpenCV 版と球候補が全フレーム一致する。
- 1080p などは JS で s×s 平均して縮小するため、ffmpeg で作った 360p とは少しずれる。

# scripts/assets — アイコンの生成元

`public/*.png` は生成物だが**コミットする**（CI に画像変換の依存を増やさないため。poker-gto と同じ方針）。

生成元:

- `public/favicon.svg` — 角丸あり。favicon / 通常アイコン / apple-touch-icon の元
- `scripts/assets/icon-maskable.svg` — 角丸なし・全面ベタ塗り・マークを中央62%に縮小。maskable 専用（OS が円や角丸に切り抜くため、角丸を焼き込むと二重に丸くなり、マークが端まであると切られる）

再生成（macOS の `sips` は SVG を読める。他のOSでは `rsvg-convert` 等に読み替える）:

```bash
sips -s format png --resampleHeightWidth 192 192 public/favicon.svg --out public/icon-192.png
sips -s format png --resampleHeightWidth 512 512 public/favicon.svg --out public/icon-512.png
sips -s format png --resampleHeightWidth 180 180 public/favicon.svg --out public/apple-touch-icon.png
sips -s format png --resampleHeightWidth 512 512 scripts/assets/icon-maskable.svg --out public/icon-maskable-512.png
```

`public/` 配下だけが Vite に配信されるので、このディレクトリの SVG は成果物に入らない。

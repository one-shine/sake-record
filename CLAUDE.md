# CLAUDE.md

## 概要
- 日本酒の飲酒記録アプリ。2020-12 から Excel + 写真で溜めた203本を置き換える。React 19 + TypeScript + Vite の SPA / PWA。UI は日本語。
- **中核の分担: 味のデータは自分で入力しない。** 銘柄に紐づくフレーバー6軸は外部（さけのわデータ）から取り、本人が入れるのは評価とメモだけ。飲みながらの入力を最短にするための設計判断で、これが崩れると続かない。
- 保存は IndexedDB のみ（端末内に閉じる）。認証・クラウド同期・SNS共有は**恒久的にスコープ外**。端末間の移動は JSON エクスポート/インポート。
- 公開: GitHub Pages（public リポジトリ + `noindex`）。**個人の飲酒記録そのものはコミットしない**（`data/seed/` は gitignore）。

## コマンド
```bash
# dev:        npm run dev        (http://localhost:5173/ — base は './' なのでルート配信)
# build:      npm run build      (tsc -b && vite build && inject-sw-precache)
# test (all): npm run test
# test (one): npm test -- linkBrand      (素の `npm test` は許可設定でブロックされるので引数を付ける)
# check:      npm run check      (tsc -b && eslint .)
# 全部:       npm run ci         (invariants → lint → build → attribution:check → test。CI と同一定義)

# データ:     npm run fetch:sakenowa     さけのわ6endpointを取得 → public/data/sakenowa/*.json
#             npm run data:check         同梱データの gzip 合計 ≤200KB を検証
# 不変条件:   npm run naming:check       ブランド名の出現を表示文字列3ファイルに限定 + base が './'
#             npm run attribution:check  dist にクレジット2件 + noindex があるか
# OCR:        npm run ocr:assets         public/ocr/ の同梱物(wasm/worker/学習データ)を作り直す
#             npm run ocr:check          同梱物の sha256・合計サイズ ≤12MB・dist への到達を検証
```

## コードスタイル
- コメントは**自明でない「なぜ」**にだけ書く。何をしているかの再説明は書かない。
- UI コピーは**常体**で統一する（敬体と混ぜない）。
- 絵文字をアイコン代わりに使わない。アイコンは `src/ui/icons/icons.tsx` の自作ライン（24グリッド / stroke 1.5 / currentColor）で統一する。
- 情報密度と論理を優先する。見出し下の飾り罫、全角のカラーバー、本文の中央寄せ、要求していないクリーム/ベージュ背景は入れない。
- **日本語ラベルは語中で折れる。** 直すときは必ず対で: コンテナに `flex-wrap` + `gap-y-*`、短い原子ラベル（バッジ・ピル）に `whitespace-nowrap`。
- OS 既定の `confirm()` / `<select>` / `<input type="date">` を使わない（自作する）。
- **配色は `src/index.css` の `@theme` の意味的トークンから引く**（`bg-canvas` `text-ink` `border-line` など）。`bg-stone-800` のような**スケール値を直書きしない** — トークンが配色の**単一の出所**で、将来ダークを足すなら値の差し替えだけで済む状態を保つ。旧→新の対応表は `src/index.css` 末尾のコメント節。
- **Tailwind のクラスを文字列連結で作らない。** `fill-amber-${n}` のような書き方は静的抽出が候補を見つけられず**本番で色が消える**。必ずリテラルで書く（段の切り替えは配列にリテラルを並べる）。
- **連続量のランプは白背景なので「多い＝濃い」。** ダーク前提の「多い＝明るい」を持ち込まない（地図の塗り・棒・凡例・文言のすべてで向きを揃える）。
- **地と面はクリーム/ベージュに寄せない。** 白〜ごく薄い中性グレー（`zinc` 系）で、暖色寄りの `stone` は使わない（`stone-50` はクリームに見える）。テーマはライト単色で `prefers-color-scheme` による自動切替を入れない（`html` に `color-scheme: light`）。

## アーキテクチャ
- **依存方向は一方向に固定する: `src/domain/` ← `src/store/` ← `src/ui/`。** `src/domain/` は React 非依存の純TS で、`react` / `window` / `document` / `process` を import しない。外部依存なしで単体テストできる状態を保つ。
- `src/domain/linkBrand.ts` が**銘柄紐付けの唯一の実装**。`scripts/` 側は markdown → 行JSON の射影だけを行い、紐付けも集計も持たない（暗黙の二重実装は必ずドリフトする）。集計も同じ規律で `src/domain/stats.ts` のみ。
- `linkBrand` は純関数にするため `createLinker(tables) => (label, prefecture) => Result` の形を取る（銘柄マスタとランタイムエイリアスを注入する）。
- **ルックアップのキーが定義域外のとき、結果が「全件」にフォールバックしてはならない。** 空を返す。銘柄サジェストと都道府県絞り込みの両方に効く（フォールバックすると別県の同名銘柄に誤紐付けする）。
- **紐付け済み ≠ フレーバー取得済み**（紐付いてもチャートが無い銘柄がある）。6軸集計の分母は「フレーバー取得済み件数」を出し、`unlinked`/`unknown` に推定値を埋めない。`linkStatus` のバッジ対応表は1箇所に集約する。
- **OCR は「銘柄サジェストの補助」であって銘柄を確定しない。** 候補を出すだけで、選ぶのは本人（選択は手動サジェストと同一の経路に合流させる）。読めない・確度が足りないときは**もっともらしい別銘柄を上位に出さず**「読み取れなかった → 手で選ぶ」に落とす。**手動サジェストの経路を常に残す**（OCR 資産の取得失敗・SIMD 非対応端末を含む）。`unlinked` に推定値を埋めないのと同じ規律。
- **OCR の実行は原寸の元ファイルに対して行う**（長辺400px のサムネイルでは解像度が足りない）。原本は `RecordForm` の state にしか置かず、保存も dirty 判定もしない。**サムネイルの仕様（長辺400px / 50KB以下）は変えない**。
- **OCR エンジンは `src/lib/ocr/`、照合は `src/domain/brandFromText.ts`。** エンジンはブラウザ API（Worker / wasm）依存なので domain に置けない。照合は純関数として domain に置く（**eslint の境界 regex に `lib` が無いので機械強制されていない** → B54）。
- **OCR 資産は同一オリジン（`public/ocr/`）に同梱する。** 写真を端末外に出さないのが要件なのでクラウド OCR / 第三者 CDN を使わない。**7.7MB を SW の原子的シェル（`addAll`）に入れない**（install ごと落ちる）。別のキャッシュ層に置き、初回は「OCR を使う」明示操作の後にだけ取得する。エンジン本体は**動的 import** で遅延チャンクに留める（静的 import にすると初期バンドルに 3.8MB が乗る。ガードが落ちることを実演済み）。
- **画面は5タブ（記録 / 統計 / 味 / 産地 / 知る）。** 「知る」（`src/ui/Learn/`）は基礎知識と出典/ライセンスの置き場で、**記録に依存しない**（props で受け取るのは開く下位タブ `initialPanel` だけ）。**「知る」の中はさらに6つの下位タブ**（種類 / ラベル / 季節 / 産地 / 味 / アプリ）で、1画面に1トピックだけ出す。**タブは読む人の関心で割る**（「数え方」のような実装の都合で割らない）。**説明は平易さを優先する**（個人利用のアプリなので法令上の厳密さは求めない = 出所バッジ・「確認できていない」の断り・慣習の印は置かない）。ただし**特定名称8種の表の値だけは告示から写したまま**にし、出典と取得日を出典タブに残す。タブと小見出しの文言は `src/ui/Learn/outline.ts` の1箇所だけが持つ。
- **「知る」に説明用の作り値を置かない。** 6軸の図は**枠と軸線とラベルだけ**（架空の値の多角形を描かない）。「推定で埋めた値は無い」と書いている面に、実データに見える作り物を混ぜない。
- **クレジットの置き場: さけのわは全画面のフッタに1行**（5タブすべてがさけのわデータを使うため）、**地図の CC-BY 4項目は使用箇所（産地タブ）と「知る」タブだけ**（フッタには出さない。URL ルーティングが無く CC-BY §3(a)(2) の URI 枝に乗れないので使用箇所への併記で満たす）。**文字列の有無は `attribution:check`、描画は単体テストが担う分担を崩さない**（増やすときは両方に足す）。
- URL ルーティングを持たない（共有機能がスコープ外なので共有する URL が無い）。オーバーレイの開閉だけ `history.pushState(null,'',location.href)` + `popstate` で戻るボタンに対応する。

## リポジトリ作法
- 進捗・課題の正典は `docs/BACKLOG.md`。コミットメッセージに課題ID（`B1:` 等）を付ける。
- 生成物でもコミットするもの: `public/data/sakenowa/*.json`（さけのわ）、`public/*.png`（アイコン）。
- **コミットしないもの: `data/seed/`**（203本の日付・店名・備考。public リポジトリなので）。回帰テストは `src/domain/*.cases.json`（日付なし / 銘柄名なしに射影した2分割）が担う。
- `.env` 系は一切使わない（このアプリは環境変数を必要としない）。`.env.example` は hook と permission で読み書き両方ブロックされている。

## 環境の癖 / gotcha
- **`npm test` と `npm install` は素だと許可設定でブロックされる**（引数が必須）。`npm test -- <pattern>` / `npm install <pkg>` / `npm ci` を使う。`node scripts/*.mjs` も直接叩くと確認が出るので `npm run <name>` から呼ぶ。
- **Vitest 設定は `vitest.config.ts` に分離してある。** Vite 8 (rolldown) と vitest 同梱 vite の `Plugin` 型が衝突するため、プラグインは `vite.config.ts`、`test:{}` はこちら。統合しない。
- **`100vh` を使わない（`h-dvh` / `100dvh`）。** iOS は URL バー込みの高さになり下端のタブが画面外に出る。**Chromium では `dvh == vh` で再現しないのでブラウザ自動化では検出できない** — 実機スクショだけが証拠になる。
- `env(safe-area-inset-*)` は `index.html` の `viewport-fit=cover` が無いと 0 になる。
- **Service Worker の必須シェルは `cache.addAll` の原子性を保つ。** install 全体を best-effort にすると欠落したまま「成功」が記録されて再試行されず、オフライン起動が恒久的に壊れる。さけのわデータも必須シェル側（無いとサジェストが空になり新規記録ができない）。
- **Node 専用の型をアプリ全体の `types` に足さない。** 必要なテストファイルだけで `/// <reference types="node" />` する（`process`/`Buffer` が本番 `src` に漏れるとバグを隠す）。
- `<img>` に `width`/`height` 属性を付けたら CSS で `height:auto` を当てる（付けないと縦に伸びる）。
- さけのわ API は **CORS ヘッダを返さない**。実行時 fetch は不可能なのでビルド時取得＋コミット。
- prettier は入れていない（整形は eslint）。`.claude/hooks/format.sh` は prettier 不在で no-op になる。

## コンテキスト維持
- 変更したファイル一覧・実行中のテストコマンド・未解決の課題(BACKLOG)を要約に必ず残す。

## 参照
- **進捗・課題の正典: `docs/BACKLOG.md`（着手前に必ず読む）** / 仕様: `docs/SPEC.md` / 実装計画: `docs/PLAN.md`（7フェーズの index）
- 開発プロセス: `docs/README.md`（`/spec`→`/plan`→`/phase-review`→`/release`）
- パス別ルール: `.claude/rules/` / 起動可能ワークフロー: `.claude/skills/`

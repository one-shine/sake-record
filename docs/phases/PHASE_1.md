# PHASE 1 — 足場 / CI / Pages公開 / PWAシェル / さけのわ取得

## 目的 / 完了条件

- 目的: `npm run ci` が緑で、空のシェルが GitHub Pages で公開され、オフラインで起動でき、A1 / A12 / A13 / A14 / A17 が**仕組みとして**閉じている状態。以降の全フェーズが常にデプロイ可能になる。
- 完了条件(満たせば done):
  - [ ] `npm run ci` が緑（invariants → lint → build → attribution:check → test）
  - [ ] `npm run fetch:sakenowa` が6ファイル生成し、件数を自己検証して出力する: brands **3264** / flavorCharts **1344** / breweries **1749** / areas **48** / flavorTags **141** / brandFlavorTags **2970**。1つでも不一致なら非ゼロ終了（**A1**）
  - [ ] `npm run data:check` が gzip 合計を印字して **≤ 200KB**（見込み ~92KB）。超過で非ゼロ終了（**A1**）
  - [ ] `npm run naming:check` が `saketime` の出現を `index.html` / `public/manifest.json` / `src/config/app.ts` の3ファイルに限定し、`vite.config.ts` の `base` が `'./'` であることを検証（**A17**）
  - [ ] `npm run attribution:check` が **`dist/assets/*.js`** に `https://sakenowa.com` と CC-BY クレジットを、`dist/index.html` に `noindex` を確認（**A13 / A14**）
  - [ ] **赤を実演した**: `Attribution.tsx` からリンク文字列を一時的に消して `npm run ci` が落ちるのを見て、戻した。落ちなければ A13 は未達（brain「revert して赤を見るまで回帰テストではない」）
  - [ ] 全画面共通フッターに さけのわクレジット + `https://sakenowa.com` リンク + CC-BY クレジット + 「20歳未満の飲酒は法律で禁止されています」が出る（**A12** / B8）
  - [ ] 公開URLが生き、DevTools Application で SW が activated、Network offline で再読込しても起動する（**A16 の機構**）
  - [ ] **390px / 1280px のスクショ2枚**。下端タブが `env(safe-area-inset-bottom)` を持つ（**A15 の機構**）
  - [ ] レイアウト高さが `h-dvh` / `100dvh` で表現されている。`100vh` は**直後に `100dvh` で上書きするフォールバックとしてのみ**許す（`src/index.css` の `#root` の2行。裸の `100vh` は不可）
  - [ ] `docs/PLAN.md` / `docs/phases/PHASE_1..7.md` / `docs/BACKLOG.md` が揃い、BACKLOG の `## 進捗` 先頭5行が現状を表す

## タスク

- [ ] 計画docs 3種を書く（`PLAN.md` / `PHASE_1..7.md` / `BACKLOG.md`）
- [ ] `.gitignore` に `node_modules/` `dist/` `.DS_Store` `coverage/` `data/seed/` を追加。**`public/data/sakenowa/*.json` はコミット対象なので無視しない**
- [ ] `git init`（不可逆なので確認を取る）
- [ ] `package.json` — poker-gto の依存構成から Tauri一式 / `framer-motion` / `@fontsource*`4件 / `sharp` / `idb` / `@vitest/ui` / `tsx` を落とし、`@svg-maps/japan@^2.0.0` + `@types/svg-maps__common@^0.0.4` を足す
- [ ] `vite.config.ts`（`base: './'` + react + tailwind）/ **`vitest.config.ts`（分離必須）**
- [ ] tsconfig 3分割（poker-gto 版 + **`"strict": true`**。`types` は `["vite/client","vitest/globals"]` のまま＝`node` を足さない）
- [ ] `eslint.config.js`（`globalIgnores(['dist'])`）
- [ ] `index.html` — `lang="ja"` / `noindex, nofollow` / `viewport-fit=cover` / `theme-color` / `mobile-web-app-capable` と `apple-` 版の両方 / `%BASE_URL%manifest.json`
- [ ] `src/main.tsx` — SW登録は prod のみ・`import.meta.env.BASE_URL` 経由・`controllerchange` の一度だけリロードを `hadController` でガード
- [ ] `src/App.tsx`（4タブの空枠）/ `src/index.css`（`@import "tailwindcss"` + `@theme` + `100dvh` + `env(safe-area-inset-*)`）
- [ ] `src/config/app.ts` — 表示名の唯一の TS 出所（B10）
- [ ] `src/ui/AppShell/` / `src/ui/Attribution/` / `src/ui/icons/`（自作ラインアイコン。フレームワーク既定アイコンは使わない）
- [ ] `public/sw.js`（必須シェルは `cache.addAll` の原子性を維持）/ `public/manifest.json`（`start_url` `scope` `id` すべて `"./"`）/ アイコン3種
- [ ] `scripts/fetch-sakenowa.mjs` — 6endpoint→タプル化。件数を自己検証。**`fetchedAt` をデータに入れない**（毎月必ず差分が出て `git diff --quiet` ガードが無意味になる）。上流の `etag`/`last-modified` だけ `meta.json` に記録
- [ ] `scripts/check-data-size.mjs` / `check-attribution.mjs` / `check-naming.mjs` / `inject-sw-precache.mjs`
- [ ] `.github/workflows/ci.yml`（`npm ci && npm run ci && npm audit --audit-level=high` の3行。**CI とローカルが同一定義**になり `node scripts/*.mjs` の許可プロンプトを踏まない）
- [ ] `.github/workflows/deploy-pages.yml`（poker-gto をそのまま + **`on: workflow_call` を追加** — Phase 7 の月次更新から呼ぶため）
- [ ] `CLAUDE.md` を実値で埋める（現在は未記入スケルトン）
- [ ] ハーネス不具合2件（B12）: `.claude/rules/testing.md` の frontmatter を1行目に / `format.sh` の case 節に `*.mjs`
- [ ] `verify.sh` 有効化 — `check` が緑を確認してから `settings.json` の Stop hook に `env: { VERIFY_CMD: "npm run check" }`
- [ ] `gh repo create sake-record --public`（対外的なので確認を取る）→ push → Settings→Pages を「GitHub Actions」に

## 検証

```bash
npm ci
npm run check              # tsc -b && eslint .
npm test -- --run
npm run fetch:sakenowa     # 件数の自己検証
npm run data:check         # gzip 合計 ≤200KB
npm run build              # tsc -b && vite build && inject-sw-precache
npm run attribution:check  # dist/assets/*.js に2クレジット / index.html に noindex
npm run naming:check
npm run preview            # + Chrome DevTools で offline 再読込
```

画面確認は **390px / 1280px の2ビューポートのスクショ**を証拠にする（自己申告は証拠として受け付けない）。空シェル + フッターのクレジットが両幅で崩れないこと、下端が `dvh` + safe-area で切れないこと。

## 検証の証拠

```
npm run ci                → exit 0
  data:check              → 合計 raw 230.7KB / gzip 84.6KB ≤ 200.0KB (6ファイル)
  naming:check            → base は './' / ブランド名は index.html(1) + app.ts(2) + manifest.json(2) のみ
  build                   → index.html 1.30kB / css 8.72kB(gzip 2.75) / js 195.90kB(gzip 62.24)
  inject-sw-precache      → 必須プリキャッシュ 9件（assets 2 + さけのわデータ 7）
  attribution:check       → さけのわ(リンク+表記) / CC-BY 4項目 / noindex
  test                    → 3 passed
npm audit --audit-level=high → found 0 vulnerabilities
npm run fetch:sakenowa    → areas 48 / breweries 1749 / brands 3264 / flavorCharts 1344
                             / flavorTags 141 / brandFlavorTags 2970
                             2回連続実行して meta.json 含めバイト一致（決定性）
```

**赤の実演（A13）**: `src/config/app.ts` の `SAKENOWA_URL` を `https://example.invalid` に変えて再ビルド →
`attribution:check` が exit 1 で「JS チャンクに さけのわ本体へのリンクが無い」を報告。復旧して緑に戻した。
このとき**単体テスト側が緑のままだった**ため恒真だと判明し、期待値を config の定数比較からリテラルへ修正（B15）。
修正後は2層とも exit 1 になることを確認した。

**オフライン起動（A16 の機構）**: `vite preview` を **kill してサーバを完全に落とした状態**で再読込し、
4タブ・見出し・クレジット4リンク・年齢表記が描画され、`brands.json` 3264件 / `flavorCharts.json` 1344件が読め、
`紀土`(819) が引けることを確認した。オンライン時のスクショとオフライン時のスクショは**バイト一致**。
到達までに SW のバグ2件（B14: `Vary: Origin` と `respondWith(undefined)`）を踏んで修正している。

**Stop hook（verify.sh）**: `VERIFY_CMD='npm run check'` を有効化し、緑で exit 0 / 赤で exit 2 + メッセージを確認。

**スクショ**: `docs/evidence/phase1-390-offline.png`（390px・サーバ停止中）/ `docs/evidence/phase1-1280.png`（1280px）。
両幅で横スクロールなし、クレジットは折り返しても括弧が離れず、下端タブは `env(safe-area-inset-bottom)` を持つ。

## フェーズ末レビュー

- レビュー所見(code-reviewer):
- 対応した点:
- 積み残し → `docs/BACKLOG.md` に起票した ID:

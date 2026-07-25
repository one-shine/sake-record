# PHASE 3 — 永続化 / バックアップ / Timeline + インポート

**←ここで初めて実データが画面に出る。** 以降スクショが評価対象になる。

## 目的 / 完了条件

- 目的: 203本が時系列リストに並び、JSON の往復で失われないこと。
- 完了条件(満たせば done):
  - [ ] `data/seed/sake-log-rows.json` をインポート画面から読み込むと **203件**が時系列リストに並ぶ（新しい順。同日は `createdAt` 降順 = ログの `No.` 逆順）（**A9** の1画面）
  - [ ] **DOM 行数 = 203 のテスト**。React `key` は必ず `record.id`。`drankOn + brandLabel` を key にすると 2025-12-08 赤武×2 が衝突して**1行が静かに消え、ストアは203なのに画面は202になる**。この事故をテストで固定する
  - [ ] `linkStatus` バッジが `auto` / `alias` / `manual` / `unlinked` / `unknown` の5種で出る。**バッジ対応表は1箇所**（brain: 単一の真実源から引く。迷ったら格下げ）
  - [ ] ラベル折り返しを**対で**修正した: コンテナに `flex-wrap` + `gap-y-*`、短い原子ラベル（バッジ/ピル）に `whitespace-nowrap`（brain: 日本語ラベルは語中で折れる。片方だけでは直らない）
  - [ ] 検索（銘柄/メモ/場所の部分一致）と絞り込み（年 / 都道府県 / linkStatus）が動く（SPEC スコープ4だが受け入れ基準が無い項目。B6）
  - [ ] エクスポート → IDB 全消し → インポートで 203件が復元（**A11** のサムネイル無し版。サムネ込みは Phase 4）
  - [ ] `backup.test.ts` が `fake-indexeddb` + 合成 Blob で往復し、`thumbnail.size` と `type` が保存されることを assert
  - [ ] **export payload に `aliases` が含まれる** — A11 は records しか言っていないが、含めないと `manual` の根拠が往復で失われて A6 の「永続化」が壊れる
  - [ ] 空状態が価値を売る（「まだ0本。JSONを取り込むか、写真から1本目を記録する」+ 主要導線2つ）。プレースホルダ文言の残骸なし（brain 品質バー）
  - [ ] スクショ 390px / 1280px

## タスク

- [ ] `src/store/db.ts` + `.test.ts` — 自作 IndexedDB ラッパ。**3ストア: `records` / `aliases` / `meta`**（SPEC は「1ストア+索引」と書いているが3つ必要）
- [ ] `src/store/records.ts` + `.test.ts` — CRUD + `drankOn` 索引
- [ ] `src/store/backup.ts` + `.test.ts` — export / import。`{schemaVersion, exportedAt, records, aliases}`。未来バージョンを拒否し、部分インポートを許容し `{ok, errors, applied}` を返す（poker-gto `dataTransfer.ts` が雛形）
- [ ] `src/domain/backupSchema.ts` — wire 型。`Omit<SakeRecord,'thumbnail'> & { thumbnail: string | null }` を**別型として定義**し、ドメイン型と配線型が別物であることを型で強制する
- [ ] `src/store/linking.ts` — テーブルと aliases を束ねて `createLinker` を供給
- [ ] `src/data/tables.ts` + `.test.ts` — `public/data/sakenowa/*.json` を fetch → タプル復号 → Map
- [ ] `src/ui/Timeline/` — `Timeline.tsx` + `.test.tsx` / `RecordCard.tsx` / `LinkStatusBadge.tsx` / `EmptyState.tsx`
- [ ] `src/ui/RecordDetail/RecordDetail.tsx`
- [ ] `src/ui/ImportExport/ImportExportPanel.tsx`

### Blob と JSON の往復

- IDB には `Blob` をそのまま入れる（structured clone で通る。SPEC 通り、`idb` パッケージは使わない）
- エンコードは `FileReader.readAsDataURL` を1件ずつ。**`btoa(String.fromCharCode(...new Uint8Array(buf)))` は大配列でスタックが飛ぶので使わない**
- デコードは `await (await fetch(dataUrl)).blob()` の1行（`data:` URL はオフラインでも解決される）
- **巨大文字列を1本作らない** — export は `new Blob([...parts])` に部品配列で組む。50KB×203 = 10.2MB → base64 で 13.6MB になるが、現状203件はサムネ0なので実サイズは数百KB。増加は年 ~1.5MB
- **オーバーレイの戻るボタン対応**: `RecordDetail` / `ImportExportPanel` を開くときだけ `history.pushState(null,'',location.href)` し `popstate` で閉じる。URL は変わらないので相対 `base` は無傷

## 検証

```bash
npm test -- store backup Timeline
npm run dev    # インポート画面から data/seed/sake-log-rows.json を実際に読む
```

- 時系列に203本が並ぶ。**行数を DevTools で数える**（ストア件数の自己申告では A9 の証拠にならない）
- export → Application → Clear site data → 再読込で0件 → import で203件

## フェーズ末レビュー

- レビュー所見(code-reviewer):
- 対応した点:
- 積み残し → `docs/BACKLOG.md` に起票した ID:

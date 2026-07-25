# BACKLOG — 日本酒 記録アプリ

**進捗・課題の単一の真実源(single source of truth)。セッション開始時にまずここを読む。**
フェーズ末レビューや実装中に出た「気になる点・スコープ外の発見・不具合」をここに起票する。

## 進捗
- 現在: Phase 1 実装済み(レビュー待ち) — 次は `/phase-review 1` → Phase 2(ドメイン層/203本パーサ/紐付け回帰)
- Phase 1 の結果: `npm run ci` 緑 / audit 0件 / サーバ停止状態でオフライン起動を確認 / gzip 84.6KB
- 公開: https://one-shine.github.io/sake-record/ （public リポ。docs/ も追跡する。**gitignore は `data/seed/` = 203本の生記録のみ**）
- 罠: `base` は `'./'` 固定 / `vitest.config.ts` は分離必須 / `100vh` 禁止 / 素の `npm install`・`npm test` は不許可
- Phase 1 で踏んだ実バグ: B13(CDN の encoding 別世代) / B14(SW の Vary) / B15(恒真テスト) — 全て修正済み

## 課題 / TODO

| ID | 種別 | 内容 | 優先 | 状態 | 出所 |
|----|------|------|------|------|------|
| B1 | improve | **SPEC 誤差4件の本文反映**: (1)「92%以上」→ 件数 ≥186（186/203=91.6% なので百分率だと落ちる）(2) e2e手順10 の分母 186→**185**（`ビキニ娘` id2020 は紐付くがチャート無し）(3) e2e手順12 の分母 191→**190** (4) 突合表「76種/173本」→ 素の完全一致は **75種/172本**（173本目 no.103 `翔空(Lagoon Brewery)` は括弧除去を経て一致） | high | open | 計画時の実測 |
| B2 | improve | **生成データの置き場所を `src/data/sakenowa/` → `public/data/sakenowa/` に変更**した逸脱を SPEC 本文に追随させる。理由: SW の原子的 SHELL に安定した既知パスを書けてオフライン保証が確実になる / 月次更新が JS バンドルのハッシュを変えない / 232KB の JSON を tsc の入力から外せる | high | open | PLAN 設計方針 |
| B3 | improve | **`linkBrand(label, prefecture)` は実装不能**（銘柄マスタとランタイムエイリアスを注入できず純関数にならない）→ `createLinker({brands,breweries,areas,aliases}) => (label,prefecture) => Result` に変更する。SPEC の型定義を訂正 | high | open | 計画時の設計 |
| B4 | improve | **`SakeRecord` に2フィールド追加**: (a) `brandName: string \| null` — 紐付け時点の値を非正規化保存（毎回 brandId 逆引きすると テーブル非同期ロードを待つ / 上流から消えたら表示も消える / export が自己記述的でなくなる）(b) `sourceNo: number \| null` — `drankOn` は同日最大6〜7件重複し表裏ラベルの2組は内容で区別できないため、`drankOn` のみのソートでは**順序が非決定になり2本の赤武が入れ替わる** | high | open | 計画時の設計 |
| B5 | idea | **`flavorTags`(141) と `brandFlavorTags`(2970) を取得するがどの機能も使わない** — gzip 92KB のうち 28KB が機能ゼロの死重。記録詳細に味タグのチップ（ジューシー/フルーティ等）を出して Timeline のファセットにもするか、取得自体をやめるか判断する。**黙って同梱したままにしない** | med | open | 計画時の発見 |
| B6 | improve | **受け入れ基準の穴**: SPEC スコープ1の「編集・削除」とスコープ4の「検索/絞り込み」に受け入れ基準が無く、e2e も作成(手順13)しか通らない → PHASE_3 / PHASE_4 の完了条件に足した。SPEC 側にも基準を追加する | med | open | 計画時の発見 |
| B7 | improve | **iOS Safari の7日間ストレージ退避**: SPEC は「サイトデータ削除で消える」しか警告していないが、インストールしていない Safari では7日間未使用で自動退避され得る。唯一のバックアップが手動 export である以上これは約束の穴 → `navigator.storage.persist()` 要求 + 初回に「ホーム画面に追加すると消えにくい」案内 + 経過日数督促（PHASE_7） | med | open | 計画時の発見 |
| B8 | improve | **飲酒アプリなのに年齢に関する表記が無い** → クレジットの隣に「20歳未満の飲酒は法律で禁止されています」を常設する。コストゼロで、無いと不注意に見える | med | open | 計画時の発見 |
| B9 | improve | **コミットバックからデプロイ到達までの実走確認**（PHASE_7）。`GITHUB_TOKEN` で push したコミットは他 workflow の `on: push` を再トリガしないため `deploy-pages.yml` に `on: workflow_call` を足して直接呼ぶ設計にした。コードベース初のコミットバックなので `workflow_dispatch` 手動実行で1回目で見る | med | open | 計画時の設計 |
| B10 | improve | **表示名 `saketime` こそが商標リスク**。SPEC は識別子（リポジトリ名・base・バンドルID）を守っているが、`saketime.jp` の SAKETIME株式会社は**同じ日本酒レビュー領域**なので混同が起きるのは表示名。`index.html` / `public/manifest.json` / `src/config/app.ts` の3ファイルに閉じ込め `check-naming.mjs` で強制し、改名が3ファイル操作で済む状態を保つ。**アセット作成前・ストア申請前なら改名はコストゼロ**（brain `niche-app-portfolio.md`「名前はまだタダのうちにクリアランスする」） | med | open | 計画時の発見 |
| B11 | improve | **エイリアス8件のうち2件は正規化に食われて冗長**（`髙砂/三重県` は異体字マップ+県で一意に絞れる / `ゆきのまゆ` はさけのわ名 `ゆきのまゆ（醸す森）` が括弧除去で一致）。安全網として保持するが、変異テストで「冗長であること」を固定し、正規化が変わったら気づける状態にする（PHASE_2） | low | open | 計画時の変異テスト |
| B12 | improve | `.claude/rules/testing.md` の frontmatter が HTML コメントの下にあり `paths:` スコープが効いていない / `.claude/hooks/format.sh` の case 節に `*.mjs` が無く `scripts/*.mjs` が整形対象外 | low | done | 計画時の発見 |
| B13 | bug | **さけのわ CDN は `accept-encoding` ごとに別世代のキャッシュ変種を返す。** 同時刻でも gzip 変種は age 33508s / weak etag / flavorCharts **1342**件、identity 変種は age 8861s / strong etag / **1344**件だった（Node の fetch は既定 gzip、curl は既定 identity なので手検証と食い違う）。放置すると月次更新が変種間で往復して無意味な差分を作り、データを古い世代へ巻き戻す → `accept-encoding: identity` に固定し、全行を id 昇順にソートして解決。**Phase 7 の月次ジョブでこの前提が効いているか確認する** | high | done | Phase1 実測 |
| B14 | bug | **オフラインで HTML だけ復元され JS/CSS が ERR_FAILED になる SW バグを踏んだ。** 原因2つ: (1) `caches.match` は既定で `Vary` を尊重し、`vite preview` が同一オリジンにも `Vary: Origin` を付けるため install 時の保存分とブラウザの subresource リクエストが突合しない (2) `.catch(() => cached)` が `undefined` に解決し得て `respondWith(undefined)` がネットワークエラーになる → `ignoreVary: true` + 明示的な 504 応答 + cache-first に変更して解決。当初「`Vary: Origin` は vite preview 由来なので本番では出ない罠」と考えたが、**公開後に実測したら GitHub Pages も `Vary: Accept-Encoding` を返していた**ため、Vary 突合の失敗は本番でも起こり得る。ヘッダを特定せず `ignoreVary` で一般に無効化したのが結果的に正しかった。Phase 7 の実機オフライン確認は公開URLで行う | high | done | Phase1 実測 |
| B15 | improve | **`Attribution.test.tsx` が恒真だった。** `toHaveAttribute('href', SAKENOWA_URL)` と config から import した定数を比較していたため、定数を `example.invalid` に書き換えても緑のままだった（赤の実演で発見）。ライセンス義務であって設定値ではないので URL をリテラルで書くよう修正。**他のテストでも「期待値を実装と同じ出所から取っていないか」を点検する** | med | done | Phase1 赤の実演 |
| B17 | improve | 一度 `docs/` と `.claude/` を gitignore にしたが、**正典（SPEC / PLAN / BACKLOG / PHASE）が版管理外になり、上書きしても戻せず・差分も追えず・`/phase-review` の `git diff` にフェーズ状態や課題の変更が出なくなる**ため公開追跡に戻した。docs に含まれるのは銘柄名・年別/県別の集計値までで、**日付・店名・備考は含まれない**（それらは `data/seed/` に閉じて gitignore 済み）。poker-gto も public で `CLAUDE.md` と `docs/` を追跡しており前例と揃う | med | done | Phase1 の公開方針 |
| B16 | idea | 1280px 幅で下端タブが全幅に伸び、本文も左端に寄る。モバイル先行の PWA として許容範囲だが、PC で見たときの体裁として本文に max-width とタブの中央寄せを検討する（Phase 3 で Timeline を作るときに実データで判断する） | low | open | Phase1 スクショ |

## 完了
<!-- done にした項目をここへ移す(履歴)。 -->

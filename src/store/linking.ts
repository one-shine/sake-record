// 同梱の銘柄マスタと2種のエイリアスを束ねて `Linker` を1本供給する。
//
// 依存方向は domain ← store ← ui。**UI と records.ts はテーブルの読み方(fetch する / タプルを解く /
// エイリアスを2箇所からマージする)を一切知らなくてよい**: `buildLinker()` を await して
// 得た関数を `importRows(rows, link)` などに渡すだけにする。
//
// 照合ロジックはここに書かない。具体性(県あり > 県なし)の比較・生の一致と正規化一致の2段・
// 同名が2件以上残ったら `unlinked` に留める判断は全て `createLinker` の責務で、
// ここは「何を注入するか」だけを決める(実装が2箇所に分かれると必ずドリフトする)。

import { BRAND_ALIASES } from '../data/brand-aliases.ts'
import { loadTables, type DecodedTables } from '../data/tables.ts'
import { createLinker } from '../domain/linkBrand.ts'
import type { BrandAlias, Linker, LinkerTables } from '../domain/types.ts'
import { listAliases, mergeAliases } from './aliases.ts'

/** `createLinker` に要る3表。フレーバーチャートは紐付けに使わない */
export type BrandTables = Omit<LinkerTables, 'aliases'>

// ---------------------------------------------------------------------------
// テーブルのキャッシュ
// ---------------------------------------------------------------------------
//
// `loadTables()` はメモ化していない(4ファイルの fetch + 3264件の復号)。Timeline の描画・
// インポート・詳細表示がそれぞれ呼ぶので、キャッシュの責務はこの層に置く。
//
// **無効化の条件**:
// - セッション中に無効化する条件は無い。中身は `public/data/sakenowa/*.json` の静的ファイルで、
//   変わるのはデプロイの時だけ。Service Worker が新版を取っても反映はページ再読込を伴い、
//   その時点でモジュールの状態ごと作り直されるため。
// - **失敗した Promise は掴まない。** オフラインで1回失敗したものを保持すると、
//   復帰後も同じ拒否を返し続けて「電波が戻っても紐付けが直らない」になる。
// - `invalidateTables()` はテストと「サイトデータ削除 → 再取得」の検証用。月次更新(Phase 7)で
//   同梱データを差し替えたときの手動リロードにも使える。

let cached: Promise<DecodedTables> | null = null

/** 同梱テーブル(索引付き)。2回目以降はキャッシュを返す */
export function getTables(): Promise<DecodedTables> {
  if (cached) return cached
  const loading = loadTables().catch((error: unknown) => {
    if (cached === loading) cached = null
    throw error
  })
  cached = loading
  return loading
}

/** キャッシュを捨てる。次の `getTables()` / `buildLinker()` で読み直す */
export function invalidateTables(): void {
  cached = null
}

// ---------------------------------------------------------------------------
// Linker の組み立て
// ---------------------------------------------------------------------------

/** 既定(同梱テーブル / IDB の runtime / 組み込み8件)を差し替える口。テストと変異検証用 */
export type LinkerSources = {
  tables?: BrandTables
  /** 手動紐付けの永続化分。既定は IDB の `aliases` ストア全件 */
  runtimeAliases?: readonly BrandAlias[]
  /** 既定は `src/data/brand-aliases.ts` の8件 */
  builtinAliases?: readonly BrandAlias[]
}

/**
 * 紐付け関数を組む。**呼ぶたびに組み直す(Linker はキャッシュしない)。**
 *
 * runtime エイリアスは手動紐付け(Phase 5)とバックアップの復元で増えるので、束ねた関数を
 * 使い回すと本人が紐付けた直後の1件が古い表で `unlinked` のまま入る。索引を張り直す費用は
 * 3264件の Map 構築で、キャッシュ済みのテーブルに対しては fetch より2桁安い。
 *
 * テーブルの取得に失敗したら**拒否をそのまま投げる**。空テーブルの Linker に落とすと
 * 203本が全て `unlinked` として保存され、しかも画面上は正常に見える(不確実性を隠さない)。
 * 呼び出し側は失敗を UI に出すこと。
 */
export async function buildLinker(sources: LinkerSources = {}): Promise<Linker> {
  const [tables, runtime] = await Promise.all([
    sources.tables ?? getTables(),
    // 空配列も「runtime 無し」として尊重する(?? は空配列を落とさない)
    sources.runtimeAliases ?? listAliases(),
  ])
  return createLinker({
    brands: tables.brands,
    breweries: tables.breweries,
    areas: tables.areas,
    // 優先順位は runtime > builtin。畳み方は aliases.ts の1箇所に閉じる
    aliases: mergeAliases(sources.builtinAliases ?? BRAND_ALIASES, runtime),
  })
}

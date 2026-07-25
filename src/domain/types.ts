// ドメイン層の型契約。ここは他の全モジュール(store / ui / data)が依存する一点なので、
// React 非依存の純TS に保つ(`react` / `window` / `document` / `process` を参照しない)。

/**
 * 紐付けの由来。UI のバッジはこの5値だけを見る。
 * - `auto`     … 名称(+都道府県)の一致で機械的に決まった
 * - `alias`    … エイリアス表で決まった(src/data/brand-aliases.ts と手動紐付けの永続化分)
 * - `manual`   … 本人が手動紐付けUIで決めた。機械が決めた値と区別できるようにしておく
 * - `unlinked` … 銘柄は分かっているがさけのわに無い / 候補が絞れない(`寫楽` など12本)
 * - `unknown`  … 記録時点で銘柄自体が判読できていない(ログの `不明` 5本)
 *
 * `unlinked` / `unknown` にフレーバー値を推定で埋めない。6軸集計の分母から外す。
 */
export type LinkStatus = 'auto' | 'alias' | 'manual' | 'unlinked' | 'unknown'

/** 5段階。未評価は `null`(既存203本は全て未評価で取り込む) */
export type Rating = 1 | 2 | 3 | 4 | 5

export type SakeRecord = {
  /** uuid v4 */
  id: string
  /** 'YYYY-MM-DD'。同日に最大6〜7件あるので一意ではない */
  drankOn: string
  /** 本人が記録した生の表記。さけのわに無い `寫楽` もそのまま原本として残す(正規化前の値) */
  brandLabel: string
  sakenowaBrandId: number | null
  /**
   * 紐付けた時点のさけのわ銘柄名。brandId からの逆引きにしないのは:
   * (a) 銘柄マスタは public/data から非同期ロードなので Timeline の描画が待たされる
   * (b) 上流のマスタから銘柄が消えると過去の記録の表示まで消える
   * (c) エクスポートした JSON が自己記述的でなくなる
   */
  brandName: string | null
  linkStatus: LinkStatus
  /** 都道府県の日本語名。紐付け時はさけのわ areas 由来、未紐付け時はログ/手入力由来 */
  prefecture: string | null
  /** 「純米大吟醸 無濾過生原酒」等の自由文。空文字は未記入 */
  spec: string
  rating: Rating | null
  /** 飲んだ場所・店名 */
  place: string
  note: string
  /** 長辺400px の JPEG。Blob のまま IndexedDB に structured clone で入る(base64 に膨らませない) */
  thumbnail: Blob | null
  /**
   * sake-log.md の No.(1..203)。アプリで作った記録は `null`。
   * `drankOn` は同日に重複し、表/裏ラベルの2組(2025-12-08 赤武 / 2025-12-12 加茂錦)は
   * 内容でも区別できないため、日付だけで並べると順序が非決定になり2本が入れ替わる。
   * 安定ソートの第2キーとして必要。
   */
  sourceNo: number | null
  /** ISO8601 */
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// さけのわデータ(public/data/sakenowa/*.json を解いた形)
// ---------------------------------------------------------------------------

/** 銘柄。3264件。**name は一意でない**(54個の名前が複数銘柄を持ち、都道府県で絞っても25グループ残る) */
export type SakenowaBrand = { id: number; name: string; breweryId: number }

/** 蔵元。1749件。銘柄は都道府県を持たないので、県はここを経由して areaId に辿る */
export type SakenowaBrewery = { id: number; name: string; areaId: number }

/** エリア。48件。id 1..47 が JIS 都道府県コードと一致し、**id 0 は「その他」で都道府県ではない** */
export type SakenowaArea = { id: number; name: string }

/**
 * フレーバー6軸。f1 華やか / f2 芳醇 / f3 重厚 / f4 穏やか / f5 ドライ / f6 軽快。
 *
 * **単位は 0-100 の整数**。さけのわ API の原値は 0.0-1.0 の float だが、同梱データは
 * gzip サイズのため100倍して整数に丸めてある。0.0-1.0 だと思って扱うと平均も
 * レーダーの半径も例外を出さずに壊れるので、比較・正規化のたびにこの単位を確認する。
 */
export type FlavorChart = {
  brandId: number
  f1: number
  f2: number
  f3: number
  f4: number
  f5: number
  f6: number
}

/** 6軸を走査するためのキー。ラベル(華やか等)は表示層に置く */
export type FlavorAxisKey = 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6'

// flavorTags(141) / brandFlavorTags は同梱してあるがまだどの機能も使っていない(BACKLOG B5)。
// 使うと決めたら SakenowaTables に足す。型だけ先に置いて「黙って同梱したまま」を避ける。
export type FlavorTag = { id: number; tag: string }
export type BrandFlavorTags = { brandId: number; tagIds: readonly number[] }

// ---------------------------------------------------------------------------
// 紐付け
// ---------------------------------------------------------------------------

/**
 * 銘柄名のエイリアス。初期値は src/data/brand-aliases.ts の8件で、手動紐付けの結果も
 * 同じ形で永続化して結合する(Phase 5)。
 * - `label` は **normalize() 済みの文字列**を入れる(照合は正規化後同士で行う。`ZEBRA` は `zebra`)
 * - `prefecture` は記録側の都道府県名(さけのわ areas と同じ日本語名)との完全一致。
 *   `null` はワイルドカード(県を問わない)
 */
export type BrandAlias = { label: string; prefecture: string | null; brandId: number }

export type LinkResult = {
  brandId: number | null
  /** 紐付いた銘柄のさけのわ名。SakeRecord.brandName に非正規化保存する値 */
  brandName: string | null
  status: LinkStatus
  /**
   * 一意に決まらなかったときの候補。**手動紐付けUIに見せる材料で、採用の材料ではない。**
   *
   * 都道府県で絞るのは「機械が自動で採用してよいか」の判定だけ(記録に県があるなら同県の候補のみ。
   * **0件になっても全件に広げない** — 広げると `Beau Michelle`(神奈川/川西屋酒造) が同名の
   * 3141(長野/伴野酒造) に誤紐付けされる)。ここには県が違う同名も入れる:
   * `Beau Michelle` は 3141 を候補に出したまま `brandId` は null に留め、決めるのは本人。
   */
  candidates: SakenowaBrand[]
}

/**
 * サジェスト・フレーバー集計・紐付けに注入するテーブル束。実装は src/data/tables.ts。
 *
 * 索引(名前→銘柄 など)を型に含めないのは意図的:
 * (a) テストで数件のリテラルからテーブルを組めること
 * (b) 索引の作り方は使う側の関心(createLinker は正規化名の索引を生成時に1回だけ作る)
 */
export type SakenowaTables = {
  brands: readonly SakenowaBrand[]
  breweries: readonly SakenowaBrewery[]
  areas: readonly SakenowaArea[]
  flavorCharts: readonly FlavorChart[]
}

/**
 * createLinker が要求する最小の束。フレーバーチャートは紐付けに要らないので含めない
 * (テストが空配列を渡す必要がなくなる)。SakenowaTables + aliases はこれを満たす。
 */
export type LinkerTables = Pick<SakenowaTables, 'brands' | 'breweries' | 'areas'> & {
  aliases: readonly BrandAlias[]
}

/** createLinker(tables) の戻り。呼び出し側の形は SPEC の linkBrand(label, prefecture) のまま */
export type Linker = (label: string, prefecture: string | null) => LinkResult

// ---------------------------------------------------------------------------
// 同梱 JSON の生の形(タプル)。gzip サイズのためオブジェクトではなく配列で持っている。
// この境界の取り違えは静かに壊れるので、解く側(src/data/tables.ts)はこの型を経由する。
// ---------------------------------------------------------------------------

export type SakenowaFile<Row> = { copyright: string; rows: readonly Row[] }

/** areas.json は **添字が areaId**(rows[0] === 'その他' / rows[7] === '福島県') */
export type AreasFile = SakenowaFile<string>

export type BreweryRow = readonly [id: number, name: string, areaId: number]
export type BrandRow = readonly [id: number, name: string, breweryId: number]
/** f1..f6 は 0-100 の整数 */
export type FlavorChartRow = readonly [
  brandId: number,
  f1: number,
  f2: number,
  f3: number,
  f4: number,
  f5: number,
  f6: number,
]
export type FlavorTagRow = readonly [id: number, tag: string]
/** 先頭が brandId、残りが tagIds。tagIds が空の行は生成時に除去済み */
export type BrandFlavorTagsRow = readonly [brandId: number, ...tagIds: number[]]

export type BreweriesFile = SakenowaFile<BreweryRow>
export type BrandsFile = SakenowaFile<BrandRow>
export type FlavorChartsFile = SakenowaFile<FlavorChartRow>
export type FlavorTagsFile = SakenowaFile<FlavorTagRow>
export type BrandFlavorTagsFile = SakenowaFile<BrandFlavorTagsRow>

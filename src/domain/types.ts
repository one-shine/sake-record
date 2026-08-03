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

/**
 * サムネイルの MIME。**`SakeRecord.thumbnail` はバイト列だけを持ち、型を添えない**ので、
 * バイト列から Blob を組み直す全箇所(表示・書き出し・同期)がここを引く。
 *
 * 定数でよいのは `src/lib/image/resize.ts` が**これ以外の型を保存させない**から
 * (`canvas.toBlob` は未対応の型を黙って PNG に落とすので、生成の直後に検査して弾いている)。
 * domain に置くのは、store も lib も ui も引くのに `lib`(ブラウザAPI依存)を
 * store から import させたくないため。
 */
export const THUMBNAIL_MIME = 'image/jpeg'

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
  /**
   * 長辺400px の JPEG のバイト列。base64 に膨らませずそのまま IndexedDB に入る。
   *
   * **Blob ではなく ArrayBuffer で持つ(B72)。** Blob は structured clone でも
   * **参照のまま**保存され、iOS の Safari では IndexedDB に入れた実体が後から失われる
   * (`size` は残るのに中身が読めなくなる。実機で1件踏んだ)。ArrayBuffer は**値として複製される**
   * ので、実体を失う経路が構造的に無い。MIME は常に `image/jpeg`(`resize.ts` が他の型を通さない)
   * なので別に持たず(`THUMBNAIL_MIME`)、**表示する直前にだけ Blob を組む**。
   */
  thumbnail: ArrayBuffer | null
  /**
   * sake-log.md の No.(1..203)。アプリで作った記録は `null`。
   * `drankOn` は同日に重複し、同一ボトルの表/裏ラベルとして2本に数えている2組は
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

// flavorTags(141語) / brandFlavorTags(2136銘柄) は時系列タブの絞り込み1軸が使う(B5)。
//
// **`SakenowaTables` には足さない。** あちらは `loadTables()` が返す束で、その成否が
// 記録フォーム・詳細・手動紐付けを開けるかを決めている(`App` の `openWithTables`)。
// 任意のファセット1つのために「記録が作れない」条件を増やさないため、味タグは
// `src/data/tables.ts` の `DecodedFlavorTags` として**別の束**で読む(索引もそちら)。
//
// 下の2つは**タプルではない側の形**(生の JSON はこのファイル末尾の `*Row` を見る)。
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

// ---------------------------------------------------------------------------
// 銘柄・蔵元のメモ(B76)
// ---------------------------------------------------------------------------

/** メモの宛先。**裸の数値を鍵にしない**理由は `BrandNote` の doc */
export type NoteTarget = 'brand' | 'brewery'

/**
 * 銘柄または蔵元に本人が書いたメモ。**記録1件ごとの `SakeRecord.note` とは別物。**
 *
 * ## 宛先の種類を鍵に焼き込む
 *
 * **銘柄IDと蔵元IDは別の名前空間なのに値域が重なる**(実測: 銘柄ID 3264件のうち **1352個**が
 * 蔵元IDとしても存在する)。`SakenowaBrand.id` も `SakenowaBrewery.id` も `number` なので、
 * 型でも実行時でもこの取り違えは止まらない。裸の数値を鍵にすると「銘柄123のメモ」と
 * 「蔵元123のメモ」が同じ鍵に落ち、例外を出さずに片方が消える。
 *
 * ## 2種類に割らない
 *
 * 同期の運搬は種類ごとに1配列 + サーバ側に1表なので、型を分けると表・送信上限・畳み込みが
 * 種類ごとに増える。判別子1つなら運搬は1本で済む。
 *
 * ## 空文字を持たない
 *
 * 空にする操作は**削除**に落とす(`BrandAlias` が空の `label` を持たないのと同じ)。
 * 「空文字のまま生きている行」を作れると、消したことの表現が2通りになり、
 * 同期の勝ち負けで**別の端末で消したメモが空の行として復活する**。
 */
export type BrandNote = { target: NoteTarget; targetId: number; text: string }

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

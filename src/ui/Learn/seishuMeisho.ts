// 清酒の製法品質表示基準（平成元年11月22日 国税庁告示第8号）の**逐語写し**。
//
// ## この表の性質（読む前に知るべきこと）
//
// **これは手で写した静止画で、改正に自動で追随する仕組みは無い。** 出典は Shift_JIS の HTML で
// 機械可読な配布形態が無く、実行時 fetch もしない（さけのわ API と同じくビルド時にも取らない —
// 告示は年単位でしか動かないので取得の自動化に見合わない）。
// したがって**唯一の誠実な扱いは「取得日を画面に出す」**こと。`NTA_FETCHED_ON` を消さないこと。
//
// ## 8行の出所（1つのページから来ていない）
//
// 告示 第1項の表が挙げる特定名称は **3つだけ**（吟醸酒 / 純米酒 / 本醸造酒）で、残る5つは
// 第2項の各号（「純米」の併記 / 「大吟醸酒」の名称 / 「特別純米酒」「特別本醸造酒」の名称）から
// 派生する。**8行×5列に整えた形は国税庁の「概要」ページの表**（`NTA_GAIYO_URL`）で、
// 告示本文（`NTA_KOKUJI_URL`）にこの形の表は無い。だから出典 URL を2本持つ。
//
// ## 著作権
//
// 法令・告示は著作権法13条により権利の目的とならないので、引用の可否は問題にならない。
// それでも出典と取得日を書く（読者が原文に戻れることと、写し間違いを検証できることのため）。

/** 出典を取得した日。**手写しなので、この日以降の改正はこの表に入っていない** */
export const NTA_FETCHED_ON = '2026-07-26'

/** 告示の本文。第1項の表（3名称）と第5項の任意記載事項がある */
export const NTA_KOKUJI_URL = 'https://www.nta.go.jp/taxes/sake/hyoji/seishu/kokuji891122/03.htm'

/** 概要ページ。8行×5列に整えた表があるのはこちら */
export const NTA_GAIYO_URL = 'https://www.nta.go.jp/taxes/sake/hyoji/seishu/gaiyo/02.htm'

/**
 * 「精米歩合の要件が無い」を表す記号（U+2212）。
 *
 * **空文字やハイフン、「なし」と書かない。** 空セルは「調べていない」と見分けが付かず、
 * `-` は「70%以下」からの削除線に見える。凡例を表の下に必ず出すこと
 * （記号だけでは「要件が無い」と「値が未確認」を読者が区別できない）。
 */
export const NO_REQUIREMENT = '−'

export type SeishuMeishoRow = {
  /** 特定名称。**`酒` の字を落とさない**（スペック欄の語は「純米」でも名称は「純米酒」） */
  readonly name: string
  readonly ingredients: string
  /** 精米歩合。要件が無い行は `NO_REQUIREMENT` */
  readonly polishing: string
  readonly kojiRatio: string
  readonly quality: string
}

/**
 * 表の列。**見出しと行のフィールドを対で持つ**ので、描画側は見出しも中身もここから引く
 * （見出しの配列と `<td>` の並びを別々に書くと、列を足したときにラベルと値がずれる）。
 * 先頭列は行の見出し（`<th scope="row">`）として描く。
 */
export const SEISHU_MEISHO_COLUMNS: readonly {
  readonly head: string
  readonly field: keyof SeishuMeishoRow
}[] = [
  { head: '特定名称', field: 'name' },
  { head: '使用原料', field: 'ingredients' },
  { head: '精米歩合', field: 'polishing' },
  { head: 'こうじ米使用割合', field: 'kojiRatio' },
  { head: '香味等の要件', field: 'quality' },
]

/**
 * 特定名称の8種類。行の順序は出典の表のまま（吟醸系 → 純米系 → 特別 → 本醸造系）。
 *
 * ★ **`純米酒` の `polishing` は `NO_REQUIREMENT`。** 「70%以下」と書かないこと —
 * その要件は改正で削除されており、記憶で書き戻すと**告示に無い制限を告示の表として出す**ことになる。
 * 告示 第1項の純米酒の行は逐語で
 * 「白米、米こうじ及び水を原料として製造した清酒で、香味及び色沢が良好なもの」であり、
 * 精米歩合に一切触れていない（`Learn.test.tsx` がこの行に `70%` が出ないことを固定している）。
 */
export const SEISHU_MEISHO: readonly SeishuMeishoRow[] = [
  {
    name: '吟醸酒',
    ingredients: '米、米こうじ、醸造アルコール',
    polishing: '60%以下',
    kojiRatio: '15%以上',
    quality: '吟醸造り、固有の香味、色沢が良好',
  },
  {
    name: '大吟醸酒',
    ingredients: '米、米こうじ、醸造アルコール',
    polishing: '50%以下',
    kojiRatio: '15%以上',
    quality: '吟醸造り、固有の香味、色沢が特に良好',
  },
  {
    name: '純米酒',
    ingredients: '米、米こうじ',
    polishing: NO_REQUIREMENT,
    kojiRatio: '15%以上',
    quality: '香味、色沢が良好',
  },
  {
    name: '純米吟醸酒',
    ingredients: '米、米こうじ',
    polishing: '60%以下',
    kojiRatio: '15%以上',
    quality: '吟醸造り、固有の香味、色沢が良好',
  },
  {
    name: '純米大吟醸酒',
    ingredients: '米、米こうじ',
    polishing: '50%以下',
    kojiRatio: '15%以上',
    quality: '吟醸造り、固有の香味、色沢が特に良好',
  },
  {
    name: '特別純米酒',
    ingredients: '米、米こうじ',
    polishing: '60%以下又は特別な製造方法（要説明表示）',
    kojiRatio: '15%以上',
    quality: '香味、色沢が特に良好',
  },
  {
    name: '本醸造酒',
    ingredients: '米、米こうじ、醸造アルコール',
    polishing: '70%以下',
    kojiRatio: '15%以上',
    quality: '香味、色沢が良好',
  },
  {
    name: '特別本醸造酒',
    ingredients: '米、米こうじ、醸造アルコール',
    polishing: '60%以下又は特別な製造方法（要説明表示）',
    kojiRatio: '15%以上',
    quality: '香味、色沢が特に良好',
  },
] as const

export type TermDefinition = {
  readonly term: string
  readonly definition: string
}

/**
 * 表の語の定義（告示 第1項「本表の適用に関する通則」より）。
 * 表のセルは短縮形なので、セルだけでは何を測っているのか分からない語をここで開く。
 */
export const SEISHU_MEISHO_DEFINITIONS: readonly TermDefinition[] = [
  {
    term: '精米歩合',
    definition:
      '白米のその玄米に対する重量の割合。精米歩合60%とは、玄米の表層部を40%削り取った白米を使うこと。',
  },
  {
    term: 'こうじ米使用割合',
    definition:
      'こうじ米（米こうじの製造に使う白米）の重量が、白米の重量に対して占める割合。特定名称の清酒は8種すべて15%以上に限られる。',
  },
  {
    term: '醸造アルコール',
    definition:
      'でん粉質物または含糖質物を原料として発酵させて蒸留したアルコール。原料の一部に使う場合、その重量（アルコール分95度換算）は白米の重量の10%を超えられない。',
  },
  {
    term: '吟醸造り',
    definition:
      '吟味して醸造すること。よりよく精米した白米を低温でゆっくり発酵させ、かすの割合を高くして、特有の芳香（吟香）を有するように醸造する製法。',
  },
  {
    term: '白米',
    definition:
      '特定名称の清酒に使えるのは、農産物検査法により3等以上に格付けされた玄米（またはこれに相当する玄米）を精米したものに限られる。',
  },
] as const

// 告示 第5項「任意記載事項」の逐語（原酒 / 生酒）。
//
// **画面では使っていない。** ラベルの語の説明は平易な言い方に寄せたので（`sakeTerms.ts`）、
// 条文そのものは出していない。消さずに残してあるのは、8種の表と同じ出所の逐語で、
// 厳密な言い回しが必要になったときに書き直さずに済むため。

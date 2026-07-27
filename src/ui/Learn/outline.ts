// 「知る」の見出しの構成表。**目次と見出しの唯一の出所**。
//
// ## なぜ構成を表に切り出すのか
//
// 「知る」は5タブで最も長い面（実測 3,400px 超 = 390px の端末で9画面分）で、節の切れ目が
// 見出しの太さだけだと「どこに何があるか」が読む前に分からない。先頭に目次を置いて構造を
// 見せるが、**目次の項目名を画面の見出しと別に書くと、片方だけ直したときに黙ってずれる**
// （目次には「味タグ」と書いてあるのに本文の見出しは別の語、という壊れ方は目視で気付けない）。
// → 見出しの文字列はここにしか無い。目次も本文も `LEARN_SECTIONS` / `LEARN_SUB_TITLES` を引く。
//
// ## id が DOM の id を兼ねる
//
// 目次から本文へ送るのに要素の id が要る。id を別に作ると「表には在るが DOM に無い節」へ
// 送ろうとして黙って何も起きないので、`sectionDomId` / `subDomId` で機械的に作る。
// URL のハッシュは使わない（このアプリは URL ルーティングを持たない）。
//
// ## 節を足すとき
//
// `LearnSubId` に語を足すと `LEARN_SUB_TITLES` が `Record` なのでコンパイルエラーになる。
// ただし **`LEARN_SECTIONS` のどれかに並べ忘れる**のは型では捕まらない（目次から落ちるだけで
// 本文は正しく見える）ので、`outline.test.ts` が「小見出しがどこか1つの節に属する」ことを見る。

/** 節。番号は `LEARN_SECTIONS` の並び順から導く（表に書かない = 並べ替えでずれない） */
export type LearnSectionId = 'counting' | 'meisho' | 'terms' | 'sources'

/** 小見出し。**接頭辞は節の id**（id だけでどの節の語か分かる / DOM の id も一意になる） */
export type LearnSubId =
  | 'counting-style'
  | 'counting-link'
  | 'counting-flavor'
  | 'counting-tag'
  | 'meisho-table'
  | 'meisho-terms'
  | 'sources-sakenowa'
  | 'sources-map'
  | 'sources-ocr'
  | 'sources-nta'

/**
 * 小見出しの文言。**どの画面の話かを括弧で添える** — 「知る」は5タブぶんの語彙を1枚で
 * 説明する面なので、見出しだけでは自分がどこで見た数字の話なのかが分からない。
 */
export const LEARN_SUB_TITLES: Record<LearnSubId, string> = {
  'counting-style': 'スタイル分布（統計タブ）',
  'counting-link': '紐付けの状態（記録タブ）',
  'counting-flavor': 'フレーバー6軸（味タブ）',
  'counting-tag': '味タグ（記録タブの絞り込み）',
  'meisho-table': '8種の要件',
  'meisho-terms': '表の語の定義',
  'sources-sakenowa': 'さけのわデータ',
  'sources-map': '産地マップ',
  'sources-ocr': '端末内 OCR（tesseract.js）',
  'sources-nta': '国税庁の告示',
}

export type LearnSection = {
  readonly id: LearnSectionId
  readonly title: string
  /** 目次に添える1行。**節を読むかどうかを決められる**ように、要約ではなく行き先を書く */
  readonly summary: string
  /** 小見出し。持たない節は空（目次には節の行だけが出る） */
  readonly subs: readonly LearnSubId[]
}

/**
 * 表示順。**この並びが節番号と目次の並びを決める**（本文側は id で引くので、
 * ここを並べ替えれば番号も目次も本文も一緒に動く）。
 */
export const LEARN_SECTIONS: readonly LearnSection[] = [
  {
    id: 'counting',
    title: 'このアプリの数え方',
    summary: '画面に出る数字が、どの入力から、どんな規則で数えられているか。',
    subs: ['counting-style', 'counting-link', 'counting-flavor', 'counting-tag'],
  },
  {
    id: 'meisho',
    title: '特定名称の8種類',
    summary: '国税庁の告示が要件を定めた8種の名称。逐語で写した表。',
    subs: ['meisho-table', 'meisho-terms'],
  },
  {
    id: 'terms',
    title: 'スペック欄の11語はどこから来た語か',
    summary: '統計タブが数える11語の出所。告示の語と、このアプリが決めた規則の区別。',
    subs: [],
  },
  {
    id: 'sources',
    title: '出典とライセンス',
    summary: 'データ・地図・OCR・法令の出所と利用条件。',
    subs: ['sources-sakenowa', 'sources-map', 'sources-ocr', 'sources-nta'],
  },
]

/** 目次そのものの id。各節の末尾から戻る先 */
export const LEARN_TOC_ID = 'learn-toc'

export function sectionDomId(id: LearnSectionId): string {
  return `learn-${id}`
}

export function subDomId(id: LearnSubId): string {
  return `learn-${id}`
}

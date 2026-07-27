// 「知る」の下位タブの構成表。**タブの見出しと本文の小見出しの唯一の出所**。
//
// ## なぜ下位タブなのか（利用者の要望「下にスクロールだから見にくい」）
//
// 1枚に全部を積むと 390px で 5,000px を超え、**読みたい1トピックに辿り着くまでが全部スクロール**
// だった。目次を足しても「長い1枚」であることは変わらない。→ **5つの下位タブに割って、
// 1画面に1トピックだけ出す**。各タブは 390px で数画面に収まり、タブ帯は上端に貼り付くので
// どこまで読んでも別のトピックへ移れる。
//
// ## 目次の項目名を別に書かない
//
// タブの短いラベルと本文の見出しを別々に書くと、片方だけ直したときに黙ってずれる。
// → 文字列はここにしか無い。タブ帯も本文もこの表を引く。
//
// ## id が DOM の id を兼ねる
//
// タブと本文の結び付け（`aria-controls` / `aria-labelledby`）に要る。別々に作ると
// 「表には在るが DOM に無い」組み合わせが生まれるので、`panelDomId` などで機械的に作る。
// URL のハッシュは使わない（このアプリは URL ルーティングを持たない）。
//
// ## タブを足すとき
//
// `LearnSubId` に語を足すと `LEARN_SUB_TITLES` が `Record` なのでコンパイルエラーになる。
// **`LEARN_PANELS` のどれかに並べ忘れる**のは型では捕まらない（本文には出るがタブの
// 説明から落ちるだけ）ので、`outline.test.ts` が「小見出しがどこか1つのタブに属する」ことを見る。

/** 下位タブ。**この並びがタブ帯の並び** */
export type LearnPanelId = 'counting' | 'flavor' | 'area' | 'sake' | 'season' | 'sources'

/** 小見出し。**接頭辞はタブの id**（id だけでどのタブの語か分かる / DOM の id も一意になる） */
export type LearnSubId =
  | 'counting-style'
  | 'counting-link'
  | 'counting-storage'
  | 'flavor-axes'
  | 'flavor-tags'
  | 'area-source'
  | 'area-fill'
  | 'area-unmapped'
  | 'sake-what'
  | 'sake-meisho'
  | 'sake-terms'
  | 'sake-numbers'
  | 'sources-sakenowa'
  | 'sources-map'
  | 'sources-ocr'
  | 'sources-nta'

/** 小見出しの文言。**どの画面の話かを括弧で添える**（「知る」は5タブぶんの語彙を説明する面） */
export const LEARN_SUB_TITLES: Record<LearnSubId, string> = {
  'counting-style': 'スタイル分布（統計タブ）',
  'counting-link': '紐付けの状態（記録タブ）',
  'counting-storage': '記録の保存とバックアップ',
  'flavor-axes': 'フレーバー6軸',
  'flavor-tags': '味タグ',
  'area-source': '県はどこから来るか',
  'area-fill': '塗り分けの5段',
  'area-unmapped': '地図に塗れない記録',
  'sake-what': '日本酒とは',
  'sake-meisho': '特定名称の8種類',
  'sake-terms': 'ラベルでよく見る語',
  'sake-numbers': 'ラベルの数字',
  'sources-sakenowa': 'さけのわデータ',
  'sources-map': '産地マップ',
  'sources-ocr': '端末内 OCR（tesseract.js）',
  'sources-nta': '国税庁の告示',
}

export type LearnPanel = {
  readonly id: LearnPanelId
  /** タブ帯のラベル。**6つが 390px に1段で収まる長さ**にする（2〜3文字） */
  readonly tab: string
  /** 本文の見出し */
  readonly title: string
  /** 見出しの下の1行。そのタブに何が書いてあるかを読む前に決められるようにする */
  readonly summary: string
  readonly subs: readonly LearnSubId[]
}

export const LEARN_PANELS: readonly LearnPanel[] = [
  {
    id: 'counting',
    tab: '数え方',
    title: 'このアプリの数え方',
    summary: '統計タブの数字の数え方と、記録がどこに保存されているか。',
    subs: ['counting-style', 'counting-link', 'counting-storage'],
  },
  {
    id: 'flavor',
    tab: '味',
    title: '味の見方',
    summary: '味タブの6軸と、絞り込みに使う味タグ。どちらも銘柄に紐づく外部のデータ。',
    subs: ['flavor-axes', 'flavor-tags'],
  },
  {
    id: 'area',
    tab: '産地',
    title: '産地の見方',
    summary: '産地タブの県がどこから来て、どう塗り分けられ、何が地図に載らないか。',
    subs: ['area-source', 'area-fill', 'area-unmapped'],
  },
  {
    id: 'sake',
    tab: '日本酒',
    title: '日本酒の基礎',
    summary: '日本酒がどういう酒で、ラベルの語と数字が何を意味するのか。',
    subs: ['sake-what', 'sake-meisho', 'sake-terms', 'sake-numbers'],
  },
  {
    id: 'season',
    tab: '季節',
    title: '季節の呼び名',
    summary: '新酒・ひやおろしなど、時期に結びついた語。',
    // 節を持たない。1節だけの下位タブに小見出しを置くと、パネルの題と同じ文字列が二重に出る
    subs: [],
  },
  {
    id: 'sources',
    tab: '出典',
    title: '出典とライセンス',
    summary: 'データ・地図・OCR・法令の出所と利用条件。',
    subs: ['sources-sakenowa', 'sources-map', 'sources-ocr', 'sources-nta'],
  },
]

/** 既定で開くタブ。**記録の話から始める**（このアプリ自身の数え方が最も参照される） */
export const LEARN_DEFAULT_PANEL: LearnPanelId = 'counting'

export function panelDomId(id: LearnPanelId): string {
  return `learn-panel-${id}`
}

export function tabDomId(id: LearnPanelId): string {
  return `learn-tab-${id}`
}

export function subDomId(id: LearnSubId): string {
  return `learn-${id}`
}

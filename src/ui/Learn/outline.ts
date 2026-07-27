// 「知る」の下位タブの構成表。**タブの見出しと本文の小見出しの唯一の出所**。
//
// ## タブの切り方（2026-07-27 に組み替えた）
//
// もとは「このアプリの数え方」を先頭に置き、画面ごとの数え方を軸に割っていたが、
// **読む人には「数え方」というタブが何の話か分からなかった**（利用者の指摘）。
// 実装の都合ではなく**読む人の関心**で割り直す:
//
//   種類 → ラベル → 季節 → 産地 → 味   … 日本酒そのものの話（この面の主）
//   アプリ                              … この画面の数字の出し方・保存・出典（付随）
//
// 「日本酒」というタブ名も外した。**この面は全部が日本酒の話**なので、区別にならない。
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
export type LearnPanelId = 'types' | 'label' | 'season' | 'area' | 'flavor' | 'app'

/** 小見出し。**接頭辞はタブの id**（id だけでどのタブの語か分かる / DOM の id も一意になる） */
export type LearnSubId =
  | 'types-what'
  | 'types-meisho'
  | 'label-terms'
  | 'label-numbers'
  | 'area-regions'
  | 'area-breweries'
  | 'area-rice'
  | 'area-map'
  | 'flavor-axes'
  | 'flavor-tags'
  | 'app-storage'
  | 'app-counting'
  | 'app-link'
  | 'app-sakenowa'
  | 'app-map'
  | 'app-ocr'
  | 'app-nta'

/** 小見出しの文言。**どの画面の話かは必要なときだけ括弧で添える** */
export const LEARN_SUB_TITLES: Record<LearnSubId, string> = {
  'types-what': '日本酒とは',
  'types-meisho': '特定名称の8種類',
  'label-terms': 'ラベルでよく見る語',
  'label-numbers': 'ラベルの数字',
  'area-regions': '酒どころ',
  'area-breweries': '蔵の数',
  'area-rice': '酒米',
  'area-map': '産地タブの地図の見方',
  'flavor-axes': 'フレーバー6軸',
  'flavor-tags': '味タグ',
  'app-storage': '記録の保存とバックアップ',
  'app-counting': 'スタイル分布の数え方',
  'app-link': '銘柄の紐付け',
  'app-sakenowa': 'さけのわデータ',
  'app-map': '産地マップ',
  'app-ocr': '端末内 OCR（tesseract.js）',
  'app-nta': '国税庁の告示',
}

export type LearnPanel = {
  readonly id: LearnPanelId
  /** タブ帯のラベル。**6つが 390px に1段で収まる長さ**にする（1〜3文字） */
  readonly tab: string
  /** 本文の見出し */
  readonly title: string
  /** 見出しの下の1行。そのタブに何が書いてあるかを読む前に決められるようにする */
  readonly summary: string
  readonly subs: readonly LearnSubId[]
}

export const LEARN_PANELS: readonly LearnPanel[] = [
  {
    id: 'types',
    tab: '種類',
    title: '日本酒の種類',
    summary: 'どういう酒で、名前がどう分かれているか。',
    subs: ['types-what', 'types-meisho'],
  },
  {
    id: 'label',
    tab: 'ラベル',
    title: 'ラベルの読み方',
    summary: 'ラベルに並ぶ語と数字が何を意味するのか。',
    subs: ['label-terms', 'label-numbers'],
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
    id: 'area',
    tab: '産地',
    title: '産地',
    summary: '蔵がどこに多いか、土地ごとに何が違うか。産地タブの地図の見方も。',
    subs: ['area-regions', 'area-breweries', 'area-rice', 'area-map'],
  },
  {
    id: 'flavor',
    tab: '味',
    title: '味の見方',
    summary: '味タブの6軸と、絞り込みに使う味タグ。どちらも銘柄に紐づく外部のデータ。',
    subs: ['flavor-axes', 'flavor-tags'],
  },
  {
    id: 'app',
    tab: 'アプリ',
    title: 'このアプリについて',
    summary: '記録の保存、画面の数字の出し方、データの出典。',
    subs: ['app-storage', 'app-counting', 'app-link', 'app-sakenowa', 'app-map', 'app-ocr', 'app-nta'],
  },
]

/** 既定で開くタブ。**日本酒そのものの話から始める** */
export const LEARN_DEFAULT_PANEL: LearnPanelId = 'types'

/** フッタの「出典とライセンス」から開くタブ（出典はこのタブの後半にある） */
export const LEARN_SOURCES_PANEL: LearnPanelId = 'app'

/** 出典の先頭。フッタから来たときはここまで送る */
export const LEARN_SOURCES_SUB: LearnSubId = 'app-sakenowa'

export function panelDomId(id: LearnPanelId): string {
  return `learn-panel-${id}`
}

export function tabDomId(id: LearnPanelId): string {
  return `learn-tab-${id}`
}

export function subDomId(id: LearnSubId): string {
  return `learn-${id}`
}

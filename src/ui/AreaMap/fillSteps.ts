// 本数 → 塗りの段。**地図の `<path>` / 凡例のスウォッチ / 一覧の棒が同じ1箇所から色を引く**。
//
// 3箇所で別々に色を決めると、凡例の「6〜10本」と地図の色が静かに食い違う(例外は出ないので
// 凡例が嘘になったことに誰も気付けない)。段の境界も同じ理由で1箇所に置く。
//
// ## 連続階調にしない理由
//
// `count / max` の線形補間は 1本と2本の差を見分けられない一方で、**この画面で最も重要な差は
// 「0本と1本」**(未進出県が空白で分かることが SPEC の要求)。段にすれば 0 が専用の段になり、
// 「まだ行っていない県」と「1本だけの県」が確実に別の色になる。
//
// 段の切り方(0 / 1〜2 / 3〜5 / 6〜10 / 11本以上)は上位県が最上段に集まる形にしてある。
// 段を増やすと上位が分散して「濃い県」が読めなくなり、減らすと 1本と10本が同色になる。
//
// ## クラス名はリテラルで並べる
//
// `fill-amber-${n}` のような文字列連結で作ると Tailwind の静的抽出がクラス候補を見つけられず、
// **dev では効いて見えるのに本番ビルドで色が消える**(生成される CSS にその名前が入らない)。
// `fill-*`(SVG) と `bg-*`(凡例・棒) は同じ色を別ユーティリティで書く必要があるため、
// 片方から機械的に導出せず両方を明示して並べる。

/** 塗りの1段。`max: null` は上限なし(最上段) */
export type FillStep = {
  /** この段に入る本数の下限(本) */
  readonly min: number
  /** 上限(本)。`null` は上限なし */
  readonly max: number | null
  /** 凡例の表記。**常体・単位付き**(「0」ではなく「未進出（0本）」と書く) */
  readonly label: string
  /** 地図の `<path>` に当てる塗り */
  readonly fill: string
  /** 凡例のスウォッチと一覧の棒に当てる背景 */
  readonly swatch: string
}

/**
 * 段の定義。**添字が段の番号**で、地図の `data-step` にそのまま出す(テストが段の区別を見る)。
 *
 * 0段目だけ無彩色にしてあるのが要点。暖色の階調(amber)は明るいほど本数が多い向きで、
 * 未進出は階調の外(stone)に置く。**「一番薄い暖色」にすると 0本と1本が階調の中で隣り合い、
 * 未進出が「少しだけ飲んだ県」と同じ仲間に見える。**
 */
export const FILL_STEPS: readonly FillStep[] = [
  { min: 0, max: 0, label: '未進出（0本）', fill: 'fill-stone-900', swatch: 'bg-stone-900' },
  { min: 1, max: 2, label: '1〜2本', fill: 'fill-amber-900', swatch: 'bg-amber-900' },
  { min: 3, max: 5, label: '3〜5本', fill: 'fill-amber-700', swatch: 'bg-amber-700' },
  { min: 6, max: 10, label: '6〜10本', fill: 'fill-amber-500', swatch: 'bg-amber-500' },
  { min: 11, max: null, label: '11本以上', fill: 'fill-amber-300', swatch: 'bg-amber-300' },
]

/**
 * 県の輪郭。**全段に同じ輪郭を引く** — 未進出県が塗り無しで消えると日本の形が崩れて
 * 「そこに県が無い」ように見えるため、0本の県も線では必ず存在させる。
 */
export const SHAPE_STROKE = 'stroke-stone-600'

/**
 * 県コードに解決できなかった形の塗り。**段の階調に混ぜない**(本数0と見分けられなくなる)。
 * 赤系で「データの不整合」として出し、画面側が id を名指しで併記する。
 */
export const UNRESOLVED_FILL = 'fill-rose-950 stroke-rose-400'

/**
 * 本数 → 段の添字。**負・NaN・小数は 0 段(未進出)側に寄せない**…のではなく、
 * 0以下と非数だけを未進出として扱う(本数は `computeStats` 由来の非負整数なので通常来ない)。
 *
 * 段が見つからない(=最上段の `max` が `null` でなくなった)ときは**最上段に寄せる**。
 * 0段目に落とすと、本数が最も多い県が「未進出」として空白で描かれる。
 */
export function fillStepIndex(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0
  const index = FILL_STEPS.findIndex((step) => step.max === null || count <= step.max)
  return index === -1 ? FILL_STEPS.length - 1 : index
}

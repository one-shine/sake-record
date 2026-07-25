// 統計画面の棒グラフ2種。**自作 SVG で、チャートライブラリを入れない**(SPEC の依存方針)。
//
// ## 1. 数値は必ず HTML のテキストで出す。棒は装飾
//
// 「グラフの高さだけで数を語る」のをやめる(情報密度を優先する)。ラベルと本数は HTML の
// テキストノードで、棒は `aria-hidden` の SVG。読み上げも検索(Ctrl+F)もテキスト側で成立し、
// 棒が無くても数は1つも失われない。**逆(数字を SVG の `<text>` に入れる)にしない** —
// 下の 2. の理由で座標系を非等比に潰しているため、SVG 内の文字は必ず歪む。
//
// ## 2. 座標系は `preserveAspectRatio="none"`。だから SVG に文字を置かない
//
// 棒の長さは「値 / その節の最大値」の百分率なので、幅は器に追随してよく、高さは固定でよい。
// 等比(既定の `xMidYMid meet`)にすると、390px 用に組んだ viewBox が 768px の器で 2倍に
// 拡大され、中の文字も2倍になる(逆に狭い器では読めない大きさに縮む)。非等比で潰せば
// 矩形は素直に伸縮し、文字は SVG の外(HTML)にあるので歪まない。
// `rx`(角丸)も非等比で楕円に歪むので使わない。
//
// ## 3. 0 の行を消さない / 0 で割らない
//
// 件数0の語や段も**行として描く**(`stats.ts` が 0 の行を返すのはそれが実測値だから。
// 行を消すと「0本」と「まだ数えていない」が同じ見た目になる)。全行0のときは最大値を1と
// みなして棒を全部0幅にする(`0/0` の `NaN` を width 属性に流し込まない)。
//
// **集計はここでは一切しない。** 与えられた行をそのまま描く(数える実装は `domain/stats.ts` の1本)。

export type BarRow = {
  /** React の `key`。ラベルが重複し得る節では呼び側が一意な値を渡す */
  key: string
  /** 行の見出し(県名・スタイル語・年など)。短い原子ラベルなので語中で折らせない */
  label: string
  count: number
}

type ChartProps = {
  /**
   * グラフ自体の読み上げ名(`<ul>` / `<ol>` の `aria-label`)。
   * 「年別の本数」のように**何を数えた列か**を書く(「グラフ」では中身が分からない)。
   */
  label: string
  rows: readonly BarRow[]
}

/**
 * 横棒。**行数が多い列(都道府県33行)や、ラベルが日本語で長い列**に使う。
 * 行は `flex-wrap` + `gap-y`、ラベル・本数は `whitespace-nowrap`(390px で語中折れを防ぐ対)。
 */
export function BarList({ label, rows }: ChartProps) {
  const max = maxCount(rows)
  return (
    <ul aria-label={label} className="mt-2 flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-20 shrink-0 whitespace-nowrap text-xs text-stone-300">{row.label}</span>
          {/* 軌道(背景) + 値。値の幅が 0 でも矩形は残す(DOM の形を行ごとに変えない) */}
          <svg
            viewBox="0 0 100 6"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="h-1.5 min-w-16 flex-1"
          >
            <rect x="0" y="0" width="100" height="6" className="fill-stone-800" />
            <rect x="0" y="0" width={barPercent(row.count, max)} height="6" className="fill-stone-300" />
          </svg>
          <span className="w-10 shrink-0 whitespace-nowrap text-right text-xs text-stone-200">
            {row.count}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 縦棒。**軸に順序がある列(年)**に使う。左から右に時間が流れる並びで呼び側が渡す。
 *
 * 列は等幅(`flex-1`)で、棒は列の中央 70% を占める(隙間を SVG の座標で作るので、
 * HTML 側は `gap` を持たない = 数字・年ラベルと棒の中心が必ず一致する)。
 */
export function ColumnChart({ label, rows }: ChartProps) {
  const max = maxCount(rows)
  return (
    <ol aria-label={label} className="mt-2 flex items-end">
      {rows.map((row) => {
        const height = barPercent(row.count, max)
        return (
          <li
            key={row.key}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 overflow-hidden"
          >
            <span className="whitespace-nowrap text-[11px] text-stone-200">{row.count}</span>
            {/* border-b が列をまたいで連なり、目盛りの無い基線になる */}
            <svg
              viewBox="0 0 10 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="h-24 w-full border-b border-stone-700"
            >
              <rect x="1.5" y={100 - height} width="7" height={height} className="fill-stone-300" />
            </svg>
            {/* 列が細くなると年が入らない。切り詰めて器の外へはみ出させない */}
            <span className="w-full truncate text-center text-[10px] text-stone-400">
              {row.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** 棒の基準。**全行0でも1を返す**(0除算で `NaN` の width を出さない)。負や非有限は無視 */
function maxCount(rows: readonly BarRow[]): number {
  let max = 0
  for (const row of rows) {
    if (Number.isFinite(row.count) && row.count > max) max = row.count
  }
  return max === 0 ? 1 : max
}

/** 0..100。小数第1位で丸めて DOM の値を安定させる(器の幅に依らない値にする) */
function barPercent(count: number, max: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.min(100, Math.round((count / max) * 1000) / 10)
}

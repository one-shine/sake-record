// @vitest-environment node
// **配色そのものの検査。** `src/index.css` の `@theme` の実値を読み、相対輝度を計算して
// 「ライト単色」「地はクリームに寄らない」「本文は 4.5:1」「押せる部品の枠は 3:1」
// 「グラフはデータが最も濃い」を固定する。
//
// ## なぜ要るか
//
// 約365箇所の配色を意味的トークンに置き換えたが、**既存のテストは配色を1件も見ていない**
// (`toHaveClass` は折り返し・高さの5件だけ)。「`npm run ci` が緑」は配色の正しさの証拠にならず、
// 実際に「レーダーの目盛りと記録の線が対比 1.00 = 区別不能」「削除ボタンの枠が 2.18」という
// 欠陥が実ブラウザの実測でしか見つからなかった。ここに置くのは**実測で見つけた要求を
// 数値のまま残す**ためで、値を1つ動かすと落ちる形にしてある。
//
// 段階の向き(多いほど濃い)は `src/ui/AreaMap/fillSteps.test.ts` が持つ。読み出しと輝度計算は
// `src/test/cssTokens.ts` の1箇所。
//
// **旧パレットのクラス名をこのファイルに書かない。** Tailwind v4 の候補抽出は src/ 配下の
// ソースを走査するので、書くとその名前の死んだ規則が本番 CSS に残る。

import {
  channelSpread,
  channels,
  contrast,
  CSS_RULES,
  hexOf,
  luminance,
  over,
  readSrc,
} from './test/cssTokens.ts'

/** 本文・補助文字の下限(WCAG AA) */
const TEXT_MIN = 4.5
/** 押せる部品の境界・意味のある図形の下限(WCAG 1.4.11) */
const UI_MIN = 3

const CANVAS = hexOf('canvas')
const SURFACES = ['canvas', 'surface', 'surface-raised', 'field'] as const

describe('ライト単色の宣言', () => {
  it('color-scheme: light を宣言している(ブラウザが描く部品もライトになる)', () => {
    expect(CSS_RULES).toMatch(/color-scheme:\s*light/)
  })

  // 自動切替にすると OS がダークの利用者に「まだ暗い」画面が出る。片方だけを持つのが要求。
  it('prefers-color-scheme で切り替えない', () => {
    expect(CSS_RULES).not.toContain('prefers-color-scheme')
  })
})

describe('画像の height:auto は @layer base の中にある', () => {
  // Phase 4 で踏んだ欠陥の回帰テスト。レイヤーの外に書くと「レイヤー無しは全レイヤーより強い」
  // というカスケード規則で Tailwind の utilities(`h-16` など)を必ず打ち負かし、
  // サムネイルが行ごとに違う高さで描かれる。**散文のコメントは検査ではない**ので数値で押さえる。
  //
  // 走査は波括弧の深さを数えるだけの素朴なもの(この CSS に文字列リテラルもコメント内の括弧も
  // 無いことを前提にする。あれば prelude がずれて**落ちる**側に倒れる)。
  /** `height: auto` の各出現について、それを囲む at-rule / セレクタの prelude を外側から並べる */
  function enclosingPreludes(css: string): string[][] {
    const stack: string[] = []
    const found: string[][] = []
    let prelude = ''
    for (let at = 0; at < css.length; at += 1) {
      const char = css[at]
      if (char === '{') {
        stack.push(prelude.trim().replace(/\s+/g, ' '))
        prelude = ''
      } else if (char === '}') {
        stack.pop()
        prelude = ''
      } else if (char === ';') {
        if (/height:\s*auto/.test(prelude)) found.push([...stack])
        prelude = ''
      } else {
        prelude += char
      }
    }
    return found
  }

  it('height:auto の出現が1つ以上あり、すべて @layer base 内の img 規則である', () => {
    const places = enclosingPreludes(CSS_RULES)
    expect(places.length).toBeGreaterThanOrEqual(1)
    for (const stack of places) {
      expect(stack[0]).toBe('@layer base')
      expect(stack[stack.length - 1]).toContain('img')
    }
  })
})

describe('地は白〜中性グレー(クリーム/ベージュに寄らない)', () => {
  // 利用者の明示の要求。`stone` 系の暖色グレーを敷くと黄みがかって見えるため、
  // **赤が青を上回らない(= 暖色側に倒れない)** ことと、色味の幅が小さいことを数値で固定する。
  const NEUTRAL = [...SURFACES, 'line', 'scale-0', 'ink', 'plot-ink'] as const

  for (const name of NEUTRAL) {
    it(`${name} は暖色に寄らない`, () => {
      const [red, , blue] = channels(hexOf(name))
      expect(red - blue).toBeLessThanOrEqual(0)
      expect(channelSpread(hexOf(name))).toBeLessThanOrEqual(4)
    })
  }
})

describe('文字のコントラスト', () => {
  for (const ink of ['ink', 'ink-muted', 'ink-faint', 'link'] as const) {
    for (const surface of SURFACES) {
      it(`${ink} 対 ${surface} が ${String(TEXT_MIN)} 以上`, () => {
        expect(contrast(hexOf(ink), hexOf(surface))).toBeGreaterThanOrEqual(TEXT_MIN)
      })
    }
  }

  // 反転(ink の面に乗る文字)。選択ピル・主ボタンの中身。
  for (const ink of ['ink-inverted', 'ink-inverted-muted'] as const) {
    it(`${ink} 対 ink が ${String(TEXT_MIN)} 以上`, () => {
      expect(contrast(hexOf(ink), hexOf('ink'))).toBeGreaterThanOrEqual(TEXT_MIN)
    })
  }

  // 状態色は**自分の面の上と地の上の両方**で本文として読める必要がある
  // (注記の箱は面付き、`role="alert"` の文だけの表示は地の上)。
  for (const state of ['notice', 'alert', 'danger', 'ok'] as const) {
    it(`${state}-ink が地と自分の面の両方で ${String(TEXT_MIN)} 以上`, () => {
      expect(contrast(hexOf(`${state}-ink`), CANVAS)).toBeGreaterThanOrEqual(TEXT_MIN)
      expect(contrast(hexOf(`${state}-ink`), hexOf(`${state}-surface`))).toBeGreaterThanOrEqual(
        TEXT_MIN,
      )
    })
  }

  // 下線は文字ではなく装飾なので 4.5 は課さないが、装飾として見える濃さは要る。
  it(`link-underline が地の上で ${String(UI_MIN)} 以上`, () => {
    expect(contrast(hexOf('link-underline'), CANVAS)).toBeGreaterThanOrEqual(UI_MIN)
  })
})

describe('押せる部品の枠', () => {
  // **地の上だけを見ない(B43)。** 面(surface-raised)と地の差は 1.07 しか無いので
  // **枠がボタンの輪郭を担っている**のに、以前は地の上(3.20)だけを固定していて
  // 面の上 2.99 / 一段上の面 2.72 で割っているのを検出できなかった。
  // 「書き出す」などの副ボタンは `bg-surface-raised` の上に置かれる = そこが本番。
  for (const [name, bg] of [
    ['地', CANVAS],
    ['surface', hexOf('surface')],
    ['surface-raised', hexOf('surface-raised')],
  ] as const) {
    it(`line-strong が${name}の上で ${String(UI_MIN)} 以上`, () => {
      expect(contrast(hexOf('line-strong'), bg)).toBeGreaterThanOrEqual(UI_MIN)
    })
  }

  // 「削除する」ボタンの枠。**自分の面(danger-surface)の上で 3:1** を満たすこと —
  // 前の値は 2.18 で、薄い赤の面にピンクの枠が溶けて輪郭が消えていた。
  // `surface-raised` にも乗る(確認ダイアログの副ボタンと並ぶ)ので、そちらも見る。
  it(`danger-line が地 / surface-raised / danger-surface で ${String(UI_MIN)} 以上`, () => {
    expect(contrast(hexOf('danger-line'), CANVAS)).toBeGreaterThanOrEqual(UI_MIN)
    expect(contrast(hexOf('danger-line'), hexOf('surface-raised'))).toBeGreaterThanOrEqual(UI_MIN)
    expect(contrast(hexOf('danger-line'), hexOf('danger-surface'))).toBeGreaterThanOrEqual(UI_MIN)
  })

  // notice-line(2.28 / 自面 2.15)と ok-line(2.09 / 1.95)は 3:1 を割る。
  // 注記の箱・度数表のセル・印(ピル)の**押せない**枠にしか使っていないので許容しているが、
  // 押せる部品に使い回すならここに足す前に値を濃くすること(index.css の枠の節に明記)。
})

describe('グラフの層の順序(白地では「全部をデータより薄く」が成立しない)', () => {
  // 不透明度は**クラス文字列がただ1つの出所**なので、ソースから読む。
  // 定数に切り出して連結で組むと Tailwind の静的抽出が候補を見落として本番で色が消えるため、
  // クラスはリテラルのまま置き、検査側が読む。整形で書き方が変わったらここが落ちる(黙って通らない)。
  const RADAR = readSrc('ui/FlavorMap/RadarChart.tsx')
  const traceOpacity = /stroke-plot-ink\/(\d+)/.exec(RADAR)
  const averageFillOpacity = /fill-plot-ink\/(\d+)/.exec(RADAR)
  if (traceOpacity === null || averageFillOpacity === null) {
    throw new Error('RadarChart.tsx から記録層/平均の不透明度を読めない')
  }
  /** 記録1本ずつの線の**実効色**(白地に薄めて置いた結果) */
  const TRACE = over(hexOf('plot-ink'), CANVAS, Number(traceOpacity[1]) / 100)

  it('記録1本ずつの線が白地で見える(15% では溶ける・20% で 1.48)', () => {
    expect(contrast(TRACE, CANVAS)).toBeGreaterThanOrEqual(1.4)
  })

  it('平均の線が記録層より確実に濃い', () => {
    expect(contrast(hexOf('plot-ink'), TRACE)).toBeGreaterThanOrEqual(4)
  })

  // 実測で見つけた欠陥の回帰テスト: 目盛りと記録層が同じ濃さ(対比 1.00)で区別できなかった。
  it('目盛りは記録層より薄く、かつ記録層と区別できる', () => {
    expect(luminance(hexOf('plot-grid'))).toBeGreaterThan(luminance(TRACE))
    expect(contrast(hexOf('plot-grid'), TRACE)).toBeGreaterThanOrEqual(1.15)
  })

  it('目盛りが白地で見える', () => {
    expect(contrast(hexOf('plot-grid'), CANVAS)).toBeGreaterThanOrEqual(1.2)
  })

  // 外周(図の枠)は**データ層より濃い**。白地では 1.00〜1.48 の間に枠と目盛りを2段入れると
  // 両方消えるため、枠だけは濃さで勝たせる(データとの区別は形と面で付ける)。この向きも固定する。
  it('外周は図の枠として見え、記録層より濃い', () => {
    expect(contrast(hexOf('plot-axis'), CANVAS)).toBeGreaterThanOrEqual(2)
    expect(luminance(hexOf('plot-axis'))).toBeLessThan(luminance(TRACE))
  })
})

describe('散布図のセル', () => {
  const SCATTER = readSrc('ui/FlavorMap/ScatterPlot.tsx')
  // `fillOpacity={empty ? 1 : 0.08 + 0.34 * (count / maxCount)}` の2つの数を読む
  const cellOpacity = /fillOpacity=\{[\s\S]*?([\d.]+)\s*\+\s*([\d.]+)\s*\*/.exec(SCATTER)
  if (cellOpacity === null) throw new Error('ScatterPlot.tsx からセルの不透明度を読めない')
  const floor = Number(cellOpacity[1])
  const range = Number(cellOpacity[2])
  const lightestCell = over(hexOf('plot-ink'), CANVAS, floor)
  const darkestCell = over(hexOf('plot-ink'), CANVAS, floor + range)

  // セルの枠が目盛りと別トークンである理由がこれ: 目盛りの薄さだと最も薄いセルの上で
  // 対比 1.03 になり、隣のセルとの切れ目が消える。
  it('記録セルの枠が最も薄いセルと最も濃いセルの両方の上で見える', () => {
    expect(contrast(hexOf('plot-cell-line'), lightestCell)).toBeGreaterThanOrEqual(1.2)
    expect(contrast(hexOf('plot-cell-line'), darkestCell)).toBeGreaterThanOrEqual(1.5)
  })

  // 空白セルは**色味**で切る(明るさの差では最も薄い記録セルと混ざる)。
  // ハッチと破線の枠はアクセント1色、記録セルは無彩色。
  it('アクセントは色味を持ち、データの色は無彩色である', () => {
    expect(channelSpread(hexOf('accent'))).toBeGreaterThanOrEqual(60)
    expect(channelSpread(hexOf('plot-ink'))).toBeLessThanOrEqual(8)
    expect(contrast(hexOf('accent'), CANVAS)).toBeGreaterThanOrEqual(UI_MIN)
  })
})

// @vitest-environment node
// 塗り段階の**向きと段差**を固定する。DOM も合成データも要らない、配色そのものの検査。
//
// ## なぜクラス名の照合では足りないか
//
// `fillSteps.ts` は色を意味的トークン名(`fill-scale-0` …)でしか持たないので、「多いほど濃い」が
// 守られているかはクラス名を見ても分からない。**実際の値は `src/index.css` の `@theme`** にある。
// 「段0 は `fill-scale-0`」と書き写す検査は定義の写経で、index.css 側で値を入れ替えて向きを
// 反転させても緑のままになる(恒真に近い)。ここでは index.css から hex を読み出して相対輝度を
// 計算し、段が単調に濃くなること・隣接段に差があること・未進出が階調の外にあることを直接見る。
//
// index.css の読み出しと相対輝度の計算は `src/test/cssTokens.ts` の1箇所が持つ
// (`src/theme.test.ts` も同じ計算を使う。2箇所で書くと片方だけ直った状態が起きる)。
// そちらに「なぜ `?raw` ではなく `readFileSync` か」「なぜ `new URL` を使わないか」を書いてある。
//
// **このファイルに旧パレットのクラス名を書かない。** Tailwind v4 の候補抽出は src/ 配下の
// ソースを走査するので、書くとその名前の死んだ規則が本番 CSS に残る。
import { channelSpread, contrast, hexOf, luminance, over, readSrc } from '../../test/cssTokens.ts'
import { FILL_STEPS, SHAPE_STROKE, UNRESOLVED_FILL } from './fillSteps.ts'

/** `bg-scale-0` → `scale-0`。接頭辞が違えばそこで落とす(役割の付け替えを見逃さない) */
function tokenOf(utility: string, prefix: string): string {
  if (!utility.startsWith(prefix)) throw new Error(`${utility} が ${prefix} で始まっていない`)
  return utility.slice(prefix.length)
}

const STEP_HEX = FILL_STEPS.map((step) => hexOf(tokenOf(step.fill, 'fill-')))
const CANVAS = hexOf('canvas')

describe('塗り段階のランプ', () => {
  it('段の数だけトークンが index.css に定義されている', () => {
    expect(STEP_HEX).toHaveLength(5)
    for (const hex of STEP_HEX) expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  })

  // この画面の中核。白地では「薄い＝少ない / 濃い＝多い」でなければ地図が読めない
  // (暗い地の上に置く配色とは向きが逆になる)。
  it('段が上がるほど濃くなる(輝度が単調に下がる)', () => {
    const lums = STEP_HEX.map(luminance)
    for (let index = 1; index < lums.length; index += 1) {
      expect(lums[index]).toBeLessThan(lums[index - 1])
    }
    // 端の比較も別に置く。向きの取り違えを「最上段が最も濃い」という言葉で名指しできる
    expect(luminance(STEP_HEX[STEP_HEX.length - 1])).toBeLessThan(luminance(STEP_HEX[0]))
  })

  it('隣り合う段が区別できる(隣接のコントラスト比が 1.2 以上)', () => {
    for (let index = 1; index < STEP_HEX.length; index += 1) {
      expect(contrast(STEP_HEX[index - 1], STEP_HEX[index])).toBeGreaterThanOrEqual(1.2)
    }
  })

  it('最上段は白地からはっきり浮く(コントラスト比 4.5 以上)', () => {
    expect(contrast(STEP_HEX[STEP_HEX.length - 1], CANVAS)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('未進出(0本)の段', () => {
  // 「塗っていない」と読めることが SPEC の要求。白地との差はごく僅かにして、形は輪郭で残す。
  it('最も薄いが白地と同一ではない', () => {
    expect(luminance(STEP_HEX[0])).toBeLessThan(luminance(CANVAS))
    expect(STEP_HEX[0].toLowerCase()).not.toBe(CANVAS.toLowerCase())
  })

  it('1〜2本と明るさで切れる(0本が階調の一番薄い段に埋もれない)', () => {
    expect(contrast(STEP_HEX[0], STEP_HEX[1])).toBeGreaterThanOrEqual(1.2)
  })

  // 明るさだけの差は面積の小さい県(香川・大阪)では読めないので、色味でも切る。
  it('0本は無彩色で、1本以上の段には色が付いている', () => {
    expect(channelSpread(STEP_HEX[0])).toBeLessThanOrEqual(8)
    for (const hex of STEP_HEX.slice(1)) {
      expect(channelSpread(hex)).toBeGreaterThanOrEqual(60)
    }
  })

  it('輪郭が最も薄い段の上でも最も濃い段の上でも見える', () => {
    const line = hexOf(tokenOf(SHAPE_STROKE, 'stroke-'))
    // 0本の県の形が白地に溶けないための線。UI 部品の境界の目標 3:1 に対して段0上は 2.5 を下限にする
    expect(contrast(line, STEP_HEX[0])).toBeGreaterThanOrEqual(2.5)
    expect(contrast(line, CANVAS)).toBeGreaterThanOrEqual(3)
    // 濃い段でも線が飲まれない
    expect(contrast(line, STEP_HEX[STEP_HEX.length - 1])).toBeGreaterThanOrEqual(2)
  })
})

describe('凡例・一覧の棒と地図が同じ色を指す', () => {
  // `fill-*`(SVG) と `bg-*`(凡例・棒) は別ユーティリティなので二重に書くしかない。
  // 片方だけ差し替えると凡例が静かに嘘になる(例外は出ない)ので、同じトークンであることを固定する。
  it('swatch と fill が同一のトークンを指す', () => {
    for (const step of FILL_STEPS) {
      expect(tokenOf(step.swatch, 'bg-')).toBe(tokenOf(step.fill, 'fill-'))
    }
  })

  it('段ごとに違う値を使う(同じ色の段が2つあると凡例が読めない)', () => {
    expect(new Set(STEP_HEX).size).toBe(FILL_STEPS.length)
  })
})

describe('一覧の棒(段の色を薄めて敷く)', () => {
  // 棒は**行の背景**で、県名と本数がその上に乗る。段の色をそのまま敷くと最上段で本文が 2.32 まで
  // 落ちて読めないので不透明度を下げてある。**下げすぎると棒が白地から消える**ので、
  // 「文字が読める」と「棒が見える」の両方を数値で固定する(30% では最上段の棒が 1.65 しか無かった)。
  //
  // 不透明度はクラス文字列がただ1つの出所(定数に切り出して連結すると Tailwind の静的抽出が
  // 候補を見落として本番で色が消える)。よってソースから読む。整形で書き方が変わればここが落ちる。
  const found = /swatch\}\s+opacity-(\d+)/.exec(readSrc('ui/AreaMap/PrefectureList.tsx'))
  if (found === null) throw new Error('PrefectureList.tsx から棒の不透明度を読めない')
  const ALPHA = Number(found[1]) / 100
  const INK = hexOf('ink')
  /** 選択中の行は下地が一段上の面になる。棒はその上に重なるので**両方の下地**で見る */
  const BACKDROPS = [CANVAS, hexOf('surface-raised')]

  it('棒の上の県名・本数が 4.5:1 以上で読める', () => {
    for (const hex of STEP_HEX) {
      for (const backdrop of BACKDROPS) {
        expect(contrast(INK, over(hex, backdrop, ALPHA))).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('最も濃い段の棒が下地から見える', () => {
    const top = STEP_HEX[STEP_HEX.length - 1]
    for (const backdrop of BACKDROPS) {
      expect(contrast(over(top, backdrop, ALPHA), backdrop)).toBeGreaterThanOrEqual(2.7)
    }
  })
})

describe('解決できない形の塗り', () => {
  const [fill, stroke] = UNRESOLVED_FILL.split(' ')

  it('段の階調のどの色でもなく、未進出とも見分けが付く', () => {
    const hex = hexOf(tokenOf(fill, 'fill-'))
    expect(STEP_HEX).not.toContain(hex)
    // 薄い面を使うと「塗っていない県」として素通りするので、0本との差を要求する
    expect(contrast(hex, STEP_HEX[0])).toBeGreaterThanOrEqual(1.5)
  })

  it('輪郭が自分の面の上で見える', () => {
    const line = hexOf(tokenOf(stroke, 'stroke-'))
    expect(contrast(line, hexOf(tokenOf(fill, 'fill-')))).toBeGreaterThanOrEqual(3)
  })
})

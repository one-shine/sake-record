// OCR に渡す前に画像を**白黒に落とす**層(局所適応二値化)。
//
// ## なぜ要るか(利用者の指摘「読めた文字数とラベルの文字数が違う」)
//
// 実機の写真で、ラベルには20〜30字しか無いのに読み取りは200字を超えていた。中身を見ると
// **`ー` と `ニ` `二` `三` が異常に多い** — ラベルの紙の**横リブ(畝)を長音符として読んでいた**。
// tesseract は自前で大域的な二値化(Otsu)をするが、大域では
//   - 紙の質感(リブ・繊維・和紙の凹凸)が文字と同じ濃さに落ちる
//   - 照明のむら(瓶の丸みで片側が暗い)で片側の文字が背景に沈む
// のどちらも直せない。**局所平均との比**で見れば、質感は周囲と同じ明るさなので消え、
// 文字だけが残る。
//
// 実測(利用者のラベルを切り出して3パス): 素のJPEG / グレー / コントラスト伸長 / 大津 では
// **ふりがな「みやいずみ」が読めない**が、局所適応では**正しく読める**。
//
// ## 何を消して何を残すのか
//
// 消すのは「周囲と同じ明るさのもの」= 質感と地。残すのは「周囲より一定以上暗いもの」= インク。
// **半径は画像の短辺に対する比**で決める(px 固定だと縮小率で効き方が変わる)。
// 文字の太さより十分大きく、照明のむらより十分小さい半径が要る。
//
// ## 失敗しても OCR を止めない
//
// この層は前処理なので、`prepareImage.ts` 側で例外を握って元の画像に落とす。

/**
 * 局所平均に対する比。これより暗ければインクとみなす。1に近いほど拾いすぎる。
 *
 * 0.92 から下げた。**ぼけた写真では局所の揺らぎが 8% を簡単に超え、地の全面が
 * インクになる**(実測でインク率 21.7% = 紙が真っ黒。読み取りが数千字に膨れた)。
 */
export const BINARIZE_BIAS = 0.85

/** 局所窓の半径 = 短辺 ÷ この値。小さくすると窓が広がり、質感が残る */
export const BINARIZE_RADIUS_DIVISOR = 24

/** 半径の下限(px)。小さい画像で窓が文字より細くなると、文字の内側まで白く抜ける */
export const BINARIZE_MIN_RADIUS = 8

/**
 * 局所平均との**絶対差**の下限。比だけだと暗い場所で閾値が甘くなり、
 * ぼけやノイズの揺らぎを拾う。実測のインク率: 比だけ 21.7% → 比+差 10.2%。
 */
export const BINARIZE_MIN_DELTA = 24

/** 中間調とみなす明るさの範囲(この外は「ほぼ白」か「ほぼ黒」) */
export const MIDTONE_LOW = 64
export const MIDTONE_HIGH = 192

/**
 * 二値化を掛ける下限。**中間調の画素がこの割合に満たない画像には掛けない。**
 *
 * 既に白黒に近い画像(スキャンした帯ラベル・白地に黒の印刷)は二値化しても得るものが無く、
 * 実測では逆に読み取りが落ちた(合成の綺麗なラベル9枚で到達 8/9 → 6/9)。
 * 一方、紙や布や瓶が写った写真は中間調だらけなので必ず掛かる。
 *
 * 5% は実測の谷。**綺麗なラベル 0.2〜0.4% / 瓶が写るシーン 17.3〜17.5% /
 * 写真ふう 67.3〜67.5% / 利用者の実機写真 63.1〜66.2%** と、境の両側が2桁離れている。
 */
export const BINARIZE_MIN_MIDTONE = 0.05

/**
 * 中間調の画素の割合(0..1)。**二値化が要る画像かどうかの判定**にだけ使う。
 */
export function midtoneRatio(gray: Uint8Array | readonly number[]): number {
  if (gray.length === 0) return 0
  let mid = 0
  for (let at = 0; at < gray.length; at++) {
    const v = gray[at]
    if (v >= MIDTONE_LOW && v < MIDTONE_HIGH) mid += 1
  }
  return mid / gray.length
}

/** 二値化を掛けるべきか。**既に白黒に近い画像には掛けない**(掛けると読み取りが落ちる) */
export function needsBinarize(gray: Uint8Array | readonly number[]): boolean {
  return midtoneRatio(gray) >= BINARIZE_MIN_MIDTONE
}

/**
 * 局所適応二値化。**純関数**(グレースケール配列 → 0/255 の配列)。
 *
 * 各画素を「半径 r の窓の平均 × `bias`」と比べ、暗ければ 0(インク)、そうでなければ 255(地)。
 * 窓の和は積分画像で O(1) に引くので、全体で O(w×h)。
 */
export function binarizeAdaptive(
  gray: Uint8Array | readonly number[],
  width: number,
  height: number,
  bias = BINARIZE_BIAS,
  radiusDivisor = BINARIZE_RADIUS_DIVISOR,
): Uint8Array {
  const out = new Uint8Array(width * height)
  if (width < 1 || height < 1) return out
  const radius = Math.max(BINARIZE_MIN_RADIUS, Math.round(Math.min(width, height) / radiusDivisor))

  // 積分画像。最大でも 画素数 × 255 なので Uint32 に収まる(3M画素で 765M < 2^32)
  const stride = width + 1
  const integral = new Uint32Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x]
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum
    }
  }

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      const area = (y1 - y0 + 1) * (x1 - x0 + 1)
      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)] -
        integral[y0 * stride + (x1 + 1)] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0]
      // `gray * area < sum * bias` は `gray < 平均 * bias` と同値。**割り算を避ける**。
      // 絶対差の門も同じ形にする(`gray < 平均 - delta` ⟺ `gray*area < sum - delta*area`)
      const value = gray[y * width + x]
      const scaled = value * area
      out[y * width + x] =
        scaled < sum * bias && scaled < sum - BINARIZE_MIN_DELTA * area ? 0 : 255
    }
  }
  return out
}

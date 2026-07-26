import { SAKENOWA_URL, MAP_SOURCE_URL, MAP_LICENSE_URL } from '../../config/app.ts'

// 2つのクレジット義務の**文言の出所**。置く場所は分かれるが文言はこの1ファイルに閉じる
// (同じ義務の文言が2箇所にあると片方だけ直されて食い違う)。
//
//  1. さけのわデータ — クレジット表示 + https://sakenowa.com へのリンク(省略は禁止事項)。
//     利用条件は「利用している箇所に併記する / 1画面で何箇所使っていても表示は1箇所にまとめてよい」。
//     **5タブすべてがさけのわのデータで動く**ので、全画面のフッタ(`Attribution`)に1行残す。
//  2. @svg-maps/japan — CC-BY-4.0。作者・タイトル・ライセンスリンク・改変の明示が必要。
//     §3(a)(2) は「必要情報のある場所を URI で示す」枝も認めるが、このアプリは URL ルーティングを
//     持たない(タブは state なので `<a href>` にできない)ため明文の枝に乗れない。
//     → **ライセンス対象を描く場所に併記する** = `MapCredit` を産地タブ(地図の直下)と
//     「知る」の出典節に置く。フッタには出さない(全画面に5行出るのが邪魔だという要望)。
//
// ## クレジットの文言を JSX のテキストとして直接書く理由(定数の補間に戻さない)
//
// `scripts/check-attribution.mjs` が dist の JS を grep して文言の欠落で CI を落とす。
// JSX のテキストは `<a>` を挟むたびに別の文字列リテラルへ割れるので、
// `…データは <a>さけのわデータ</a> を利用しています` と書くと成果物には
// 「さけのわデータを利用しています」という連続した文字列が**存在しない**。
// 結果として短い needle しか選べず、`さけのわデータを取得できない:` のようなエラー文言や
// パッケージ側の `{"label":"Map of Japan"}` で満たせてしまっていた(偽陽性2件を実測)。
// `{MAP_TITLE} by {MAP_AUTHOR}` のように定数を補間する形も実行時連結なのでバンドル上は割れたまま
// (だから `config/app.ts` は作者名とタイトルの定数を持たない。URL だけを持つ)。
// → **偽造できない長さの文言が1つのリテラルとしてバンドルに残る形**で書く。
// URL は href に置くのでリテラルのまま残る = 定数のままでよい。
//
// 地の文なので括弧のまわりに flex + gap を入れない(「（ CC BY 4.0 ）」のように隙間が空く)。
// 折り返しは行末で自然に起きればよく、リンク文字列だけを whitespace-nowrap で割らせない。

const linkClass =
  'whitespace-nowrap text-link underline decoration-link-underline underline-offset-2'

type Props = {
  /** 「出典とライセンス」を押したとき。「知る」タブの出典節(全文)を開く */
  onOpenLearn: () => void
}

// safe-area の下端余白は画面最下部に接する nav 側が持つ。ここで足すと二重になる。
export function Attribution({ onOpenLearn }: Props) {
  return (
    <footer className="mt-auto border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-muted">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* 「〜を利用しています」は敬体で、UI コピーを常体で統一する規約に反する。
            **さけのわが例示するフォーマットの逐語**なのであえて変えない(一括で常体に
            直すときはここを対象外にする)。 */}
        <a href={SAKENOWA_URL} target="_blank" rel="noreferrer" className={linkClass}>
          さけのわデータを利用しています
        </a>
        <button type="button" onClick={onOpenLearn} className={linkClass}>
          出典とライセンス
        </button>
      </div>
    </footer>
  )
}

/**
 * 産地マップの県形状(@svg-maps/japan・CC-BY-4.0)のクレジット。4項目
 * (タイトル / 作者 / ライセンスへのリンク / 改変した旨)を1行で満たす。
 *
 * **ライセンス対象を描く場所に置く**: `ui/AreaMap/AreaMap.tsx`(地図と凡例の直下)と
 * 「知る」の出典節。フッタには出さない(上のコメント 2 を参照)。
 *
 * タイトルと作者を1本のリンクにまとめてあるのは、`Map of Japan` 単体だと
 * パッケージが持つ `{"label":"Map of Japan"}` と衝突して成果物検査が偽陽性になるため。
 */
export function MapCredit() {
  return (
    <p className="text-[11px] leading-relaxed text-ink-faint">
      産地マップの県形状は{' '}
      <a href={MAP_SOURCE_URL} target="_blank" rel="noreferrer" className={linkClass}>
        Map of Japan by Victor Cazanave
      </a>
      （
      <a href={MAP_LICENSE_URL} target="_blank" rel="noreferrer" className={linkClass}>
        CC BY 4.0
      </a>
      ・本数に応じて着色する改変あり）
    </p>
  )
}

import {
  SAKENOWA_URL,
  MAP_SOURCE_URL,
  MAP_LICENSE_URL,
  KANJIDIC_URL,
  KANJIDIC_LICENSE_URL,
  WIKIPEDIA_URL,
  WIKIPEDIA_LICENSE_URL,
} from '../../config/app.ts'

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

/**
 * 蔵元の説明(B78)の出所。**CC-BY-SA 4.0 なので表示義務がある。**
 *
 * 置き場は「知る」の出典タブと**使用箇所(記録の詳細)の両方**。地図と同じで
 * ライセンス対象そのものを描く画面があるが、地図と違って**対象が蔵ごとに別の記事**なので、
 * 記事URLは使用箇所の側にしか書けない(`ui/RecordDetail` の `BreweryAbout`)。
 * ここに置くのは全記事に共通する分 = 出所とライセンスと改変の有無。
 *
 * **改変は「書き出しだけを抜き出した」に留める。** 要約・言い換えをすると
 * Adapted Material になり継承(§3(b))が発生する。
 *
 * リンクの文字列が「日本語版」で終わらず**「の執筆者」まで含む**のは2つの理由による:
 * (1) CC-BY-SA が求めているのは著作者の表示で、ウィキペディアの慣習では記事の履歴に載る
 * 執筆者を指す(記事URLは使用箇所に出している) (2) `ウィキペディア日本語版` だけだと
 * **同梱データの `copyright` 欄にも同じ文字列がある**ので、クレジットを1つも描かなくても
 * `attribution:check` が満たされてしまう(KANJIDIC で実際に踏んだ形)。
 */
export function WikipediaCredit() {
  return (
    <p className="text-[11px] leading-relaxed text-ink-faint">
      蔵元の説明は{' '}
      <a href={WIKIPEDIA_URL} target="_blank" rel="noreferrer" className={linkClass}>
        ウィキペディア日本語版の執筆者
      </a>
      （
      <a href={WIKIPEDIA_LICENSE_URL} target="_blank" rel="noreferrer" className={linkClass}>
        CC BY-SA 4.0
      </a>
      ・各記事の書き出しだけを抜き出す改変あり。記事名は記録の詳細に出す）
    </p>
  )
}

/**
 * 銘柄の読み(B68)の出所。**CC-BY-SA 4.0 なので表示義務がある。**
 *
 * 置き場は「知る」の出典タブだけ。地図と違って**ライセンス対象そのものを描く画面が無い**
 * (読みは銘柄を探すための鍵で、画面に出るのは当たった読み1つだけ)ので、
 * サジェストの下に4項目を並べる形は採らない。文言を1つのリテラルで書く理由は
 * このファイルの頭に書いたとおり。
 */
export function KanjiDicCredit() {
  return (
    <p className="text-[11px] leading-relaxed text-ink-faint">
      銘柄の読みは{' '}
      <a href={KANJIDIC_URL} target="_blank" rel="noreferrer" className={linkClass}>
        KANJIDIC Project by EDRDG
      </a>
      （
      <a href={KANJIDIC_LICENSE_URL} target="_blank" rel="noreferrer" className={linkClass}>
        CC BY-SA 4.0
      </a>
      ・銘柄名に出る漢字だけに絞って書き出す改変あり）
    </p>
  )
}

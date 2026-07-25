import {
  SAKENOWA_URL,
  SAKENOWA_DATA_URL,
  MAP_AUTHOR,
  MAP_TITLE,
  MAP_SOURCE_URL,
  MAP_LICENSE_URL,
} from '../../config/app.ts'

// 全画面共通フッター。2つのクレジット義務を負っている:
//  1. さけのわデータ — クレジット表示 + https://sakenowa.com へのリンク(省略は禁止事項)
//  2. @svg-maps/japan — CC-BY-4.0。作者・タイトル・ライセンスリンク・改変の明示
// リンク文字列が欠けたら scripts/check-attribution.mjs が dist/assets/*.js を grep して CI を落とす。
//
// 地の文なので flex ではなく通常のインライン流し込みで組む。
// flex + gap にすると括弧の内側にも隙間が入って「（ さけのわ ）」のように見える。
// 折り返しは行末で自然に起きればよく、リンク文字列だけを whitespace-nowrap で割らせない。

const linkClass =
  'whitespace-nowrap text-stone-200 underline decoration-stone-600 underline-offset-2'

// safe-area の下端余白は画面最下部に接する nav 側が持つ。ここで足すと二重になる。
export function Attribution() {
  return (
    <footer className="mt-auto border-t border-stone-800 px-4 py-3 text-xs leading-relaxed text-stone-400">
      <p>
        銘柄・蔵元・フレーバーのデータは{' '}
        <a href={SAKENOWA_DATA_URL} target="_blank" rel="noreferrer" className={linkClass}>
          さけのわデータ
        </a>{' '}
        を利用しています（
        <a href={SAKENOWA_URL} target="_blank" rel="noreferrer" className={linkClass}>
          さけのわ
        </a>
        ）
      </p>
      <p className="mt-1">
        産地マップの県形状は{' '}
        <a href={MAP_SOURCE_URL} target="_blank" rel="noreferrer" className={linkClass}>
          {MAP_TITLE}
        </a>{' '}
        by {MAP_AUTHOR}（
        <a href={MAP_LICENSE_URL} target="_blank" rel="noreferrer" className={linkClass}>
          CC BY 4.0
        </a>
        ・本数に応じて着色する改変あり）
      </p>
      <p className="mt-1.5 text-stone-500">20歳未満の飲酒は法律で禁止されています。</p>
    </footer>
  )
}

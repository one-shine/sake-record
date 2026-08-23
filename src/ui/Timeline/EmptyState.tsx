// 0本のときの画面。**「まだ0本」で終わらせない** — ここは価値を売る面なので、
// 「記録が入ると何が見えるようになるか」と**導線2つ**(取り込み / 1本目の記録)を出す。
//
// 導線のハンドラは**任意にしない**。`onImport?` にすると押しても何も起きないボタンが
// 作れてしまい、それは空状態のプレースホルダ文言と同じ「残骸」になる。配線されていなければ
// 呼び側が型エラーで気付く。

import { PlusIcon } from '../icons/icons.tsx'

type Props = {
  /** JSON の取り込み(既存の台帳 / エクスポートしたバックアップ)を開く */
  onImport: () => void
  /** 1本目の記録フォームを開く */
  onCreate: () => void
}

export function EmptyState({ onImport, onCreate }: Props) {
  return (
    <div className="flex flex-col gap-4 py-2">
      <div>
        <p className="text-sm font-semibold text-ink">まだ1本も記録が無い</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          記録が入ると、時系列・年別と都道府県別の集計・フレーバー6軸の分布・産地マップが同じデータから使えるようになる。味の6軸は銘柄に紐づくさけのわのデータから引くので、自分で入力するのは評価とメモだけ。
        </p>
      </div>

      {/* flex-wrap + gap-y と、ボタン側の whitespace-nowrap を対で当てる(390px でラベルが割れる) */}
      <div className="flex flex-wrap gap-x-2 gap-y-2">
        <button
          type="button"
          onClick={onImport}
          className="whitespace-nowrap rounded border border-ink bg-ink px-3 py-1.5 text-sm font-medium text-ink-inverted"
        >
          JSON を取り込む
        </button>
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-1.5 whitespace-nowrap rounded border border-line-strong px-3 py-1.5 text-sm text-ink"
        >
          <PlusIcon className="h-4 w-4" />
          1本目を記録する
        </button>
      </div>

      <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-ink-muted">
        {/* **形式ごとに書き分ける**(B102)。両方まとめて「全か無か」と書いていたが、
            全体拒否は台帳の JSON だけで、バックアップ JSON は**読めた分だけを取り込む**
            (B26 の設計で、確認画面が件数付きで予告する)。「1行でも壊れていれば何も起きない
            = 安全」と読んで警告を流されると、全置換で想定外の欠落が起きる。
            約物も他画面に揃える(B115) — ここだけ全角コロンだった */}
        <p>
          <span className="text-ink-muted">取り込み</span>: 書き出した JSON
          は、読めない行を件数付きで示して読めた分だけを取り込む。既存の台帳から作った JSON
          は1行でも形が違えば1件も保存せず理由を出す。
        </p>
        <p>
          {/* **無条件に「6軸が埋まる」と言わない**(B116) — チャートを持つ銘柄は過半ではない */}
          <span className="text-ink-muted">記録</span>:
          写真を選んで銘柄をサジェストから選ぶと都道府県・蔵元が埋まり、さけのわにあればフレーバー6軸も入る。銘柄が分からない記録もそのまま残せる（推定で埋めない）。
        </p>
      </div>
    </div>
  )
}

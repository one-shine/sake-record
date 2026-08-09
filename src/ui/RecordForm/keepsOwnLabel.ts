import { normalize } from '../../domain/normalize.ts'

/**
 * 候補を選んだとき、**打ってある文字を残すか、銘柄名で置き換えるか**。
 *
 * 「本人の表記が原本」は台帳から取り込んだ行の話で、そこでは `寫楽` `会津宮泉`
 * `日高見(平孝酒造)` のような**本人が書いた表記**に意味がある。だが**フォームに打つ文字は
 * 銘柄を探すための検索語**で、B68 でかな検索を入れてからは `きど` のように
 * **銘柄名と字が1つも重ならない文字列**が普通になった。それを残すと記録の表記が
 * `きど` で固定され、一覧に「記録の表記: きど」が一生付いて回る(実機で報告された)。
 *
 * 見分けるのは**正規化した上でどちらかがどちらかを含むか**の1点:
 *   残す … `寫楽`→`冩楽`(異体字で一致) / `会津宮泉`⊇`宮泉` / `九平次`⊆`醸し人九平次`
 *          / `髙砂`→`高砂` / `日高見(平孝酒造)`→`日高見`(括弧除去で一致)
 *   置換 … `きど`→`紀土` / `ほまれきりん`→`ほまれ麒麟` / `KID`→`紀土`(読み・ローマ字の検索語)
 *
 * 空欄から選んだときも「含む」に当たらないので置換に落ちる(以前の `label === ''` の枝と同じ)。
 *
 * **ファイルを分けてあるのは fast refresh のため** — コンポーネントのファイルから
 * 関数を export すると `react-refresh/only-export-components` で落ちる。
 */
export function keepsOwnLabel(label: string, brandName: string): boolean {
  const typed = normalize(label)
  const name = normalize(brandName)
  if (typed === '' || name === '') return false
  return typed.includes(name) || name.includes(typed)
}

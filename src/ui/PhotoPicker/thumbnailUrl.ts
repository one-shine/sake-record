// Blob を `<img>` に出すための object URL を「生成と revoke を必ず対で」扱う。
//
// ## なぜ hook に切り出すか
//
// `URL.createObjectURL` は Blob を表示する唯一の手段だが、**revoke を忘れるとタブを閉じるまで
// 解放されない**。写真選択は「選ぶ → 作り直す → 外す → また選ぶ」を1画面で繰り返すので、
// 対応漏れが最も起きやすい。生成と解放を1関数に閉じ込めて、呼び側が対で書くことを忘れられなくする。
//
// ## `src` を state に持たず effect から DOM に直接書く理由
//
// `src/ui/Timeline/RecordCard.tsx` の `Thumbnail` と**意図的に同じ手**を使っている:
//   - effect の中で同期的に `setState` するのは React の指針に反する
//     (`react-hooks` の `set-state-in-effect` が実際に error を出す)
//   - render 中に `useMemo` で作ると StrictMode の二重呼び出しで**1本ずつ leak する**
//     (捨てられた1本目は revoke されない)
// 「外部システム(DOM のプロパティ)を React の state と同期させる」のは effect の本来の用途なので、
// `img.src` を effect で直接書き、cleanup で revoke する。React に `src` を描かせないので
// 再描画で上書きされることもない。
//
// RecordCard / RecordDetail にも同じ実装が写しで存在する。統合はこの Phase の担当範囲外
// (並列ステージが両ファイルを触る)なので、ここでは新たな写しを増やさないことだけを守る。

import { useEffect, useRef, type RefObject } from 'react'

/**
 * この環境で Blob を画像として出せるか。
 * 出せない環境(古いブラウザ・node 環境のテスト)ではプレビューを**描かない**
 * — 例外で画面を落とすより、写真の付け外し自体は動くほうがよい。
 */
export function canShowThumbnail(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
}

/**
 * `blob` の object URL を `<img>` の `src` に流し込み、blob が変わるとき / unmount するときに
 * **必ず revoke する** ref を返す。返った ref を `<img ref={...}>` に付けるだけでよい。
 *
 * `blob` が null のときは何もしない(`<img>` 自体を描かない呼び側を想定)。
 */
export function useThumbnailImageRef(blob: Blob | null): RefObject<HTMLImageElement | null> {
  const ref = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = ref.current
    if (img === null || blob === null || !canShowThumbnail()) return
    const objectUrl = URL.createObjectURL(blob)
    img.src = objectUrl
    return () => {
      // 解放済みの URL を指した `<img>` を残すと壊れた画像アイコンが出るので先に外す
      img.removeAttribute('src')
      URL.revokeObjectURL(objectUrl)
    }
  }, [blob])

  return ref
}

// 保存したサムネイル(バイト列)を `<img>` に出すための object URL を、
// **生成と revoke を必ず対で**扱う。
//
// ## なぜ hook に切り出すか
//
// `URL.createObjectURL` は画像のバイト列を表示する唯一の手段だが、**revoke を忘れると
// タブを閉じるまで解放されない**(一覧では203行ぶんが積み上がる)。生成と解放を1関数に
// 閉じ込めて、呼び側が対で書くことを忘れられなくする。
//
// **写しを3つ持っていたのをここに寄せた(B32)。** `PhotoPicker` / `Timeline/RecordCard` /
// `RecordDetail` が同型の effect を各自持っており、B72 で `Blob` → `ArrayBuffer` に変えたとき
// **3箇所を同じように直す必要があった** — 写しが増えるほど、次に触る人が1つ取りこぼす。
//
// ## `src` を state に持たず effect から DOM に直接書く理由
//
//   - effect の中で同期的に `setState` するのは React の指針に反する
//     (`react-hooks` の `set-state-in-effect` が実際に error を出す)
//   - render 中に `useMemo` で作ると StrictMode の二重呼び出しで**1本ずつ leak する**
//     (捨てられた1本目は revoke されない)
//
// 「外部システム(DOM のプロパティ)を React の state と同期させる」のは effect の本来の用途なので、
// `img.src` を effect で直接書き、cleanup で revoke する。React に `src` を描かせないので
// 再描画で上書きされることもない。

import { useEffect, useRef, type RefObject } from 'react'
import { THUMBNAIL_MIME } from '../../domain/types.ts'

/**
 * この環境でサムネイルを画像として出せるか。
 * 出せない環境(古いブラウザ・node 環境のテスト)では**描かない**
 * — 例外で画面を落とすより、写真の付け外しや一覧の表示そのものは動くほうがよい。
 */
export function canShowThumbnail(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
}

/**
 * `bytes` の object URL を `<img>` の `src` に流し込み、bytes が変わるとき / unmount するときに
 * **必ず revoke する** ref を返す。返った ref を `<img ref={...}>` に付けるだけでよい。
 *
 * **Blob はここで初めて作る。** 記録が持つのは ArrayBuffer で(B72。Blob のまま IndexedDB に
 * 入れると iOS で実体が失われる)、Blob は表示のあいだだけ存在する一時的な包みにする。
 * MIME は保存時に JPEG しか通していない(`resize.ts`)ので定数でよい。
 *
 * `bytes` が null のときは何もしない(`<img>` 自体を描かない呼び側を想定)。
 */
export function useThumbnailImageRef(
  bytes: ArrayBuffer | null,
): RefObject<HTMLImageElement | null> {
  const ref = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = ref.current
    if (img === null || bytes === null || !canShowThumbnail()) return
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: THUMBNAIL_MIME }))
    img.src = objectUrl
    return () => {
      // 解放済みの URL を指した `<img>` を残すと壊れた画像アイコンが出るので先に外す
      img.removeAttribute('src')
      URL.revokeObjectURL(objectUrl)
    }
  }, [bytes])

  return ref
}

// f1..f6 の日本語ラベル。**フレーバー画面群での唯一の出所**。
//
// 定数をコンポーネントと同じファイルから export すると Fast Refresh が効かなくなるため
// (`ui/AppShell/tabs.ts` / `ui/Timeline/linkStatus.ts` と同じ理由)、表はこのモジュールに置き
// `RadarChart.tsx` / `ScatterPlot.tsx` / `FlavorMap.tsx` は描画だけを持つ。
//
// **`Record<FlavorAxisKey, string>` にしてあるので、軸が7本目に増えると型エラーになる**
// (ラベルを足し忘れた軸が「f7」のまま画面に出ることがない)。
//
// 順序は `domain/flavor.ts` の `FLAVOR_AXIS_KEYS`(f1..f6) が持ち、ここは持たない。
// 順序をここにも書くと、走査の順とラベルの順が別々に直されて軸がずれる。
//
// 既知の重複: `ui/RecordDetail/RecordDetail.tsx` が同じ6語を private な配列で持っている
// (記録1件のフレーバー表示。Phase 3 で先に書かれた)。**同じ語が2箇所にある状態**なので、
// あちらをこのモジュールに寄せるのが筋(担当範囲外のため BACKLOG に起票して持ち越す)。

import { FLAVOR_AXIS_KEYS } from '../../domain/flavor.ts'
import type { FlavorAxisKey } from '../../domain/types.ts'

/**
 * 軸の日本語ラベル。**値の単位は 0-100 の整数**(さけのわ原値の 0.0-1.0 ではない)ので、
 * ラベルに単位を書かず、目盛りを持つ側(レーダーの同心六角形・散布図の軸)が 0〜100 を明示する。
 */
export const FLAVOR_AXIS_LABELS: Record<FlavorAxisKey, string> = {
  f1: '華やか',
  f2: '芳醇',
  f3: '重厚',
  f4: '穏やか',
  f5: 'ドライ',
  f6: '軽快',
}

/** 2軸射影1面の見出し。`華やか × 芳醇` の形に揃える(面の同一性は軸の対で決まる) */
export function flavorFaceLabel(axes: readonly [FlavorAxisKey, FlavorAxisKey]): string {
  return `${FLAVOR_AXIS_LABELS[axes[0]]} × ${FLAVOR_AXIS_LABELS[axes[1]]}`
}

/** 面を選ぶ UI 状態のキー。軸の対から一意に作る(表示ラベルを状態のキーにしない) */
export function flavorFaceKey(axes: readonly [FlavorAxisKey, FlavorAxisKey]): string {
  return `${axes[0]}-${axes[1]}`
}

/**
 * 軸の並び(単位ベクトル)。**f1 が真上(-90°)で、時計回りに 60° ずつ。**
 *
 * レーダー(`RadarChart`)と「知る」の軸配置図が**同じ並びを描くための唯一の出所**。
 * 角度を両方に書くと、凡例の図とレーダーで軸の位置が食い違う(図は正しく見えるので気付けない)。
 * 半径・座標系は使う側が決める(ここは向きだけを持つ)。
 */
export const FLAVOR_AXIS_UNITS: readonly { readonly x: number; readonly y: number }[] =
  FLAVOR_AXIS_KEYS.map((_, index) => {
    const angle = ((-90 + index * 60) * Math.PI) / 180
    return { x: Math.cos(angle), y: Math.sin(angle) }
  })

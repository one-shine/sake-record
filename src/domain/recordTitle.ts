// 記録を画面で何と呼ぶか。**この1本だけが決める(B37)。**
//
// ## なぜ1箇所に寄せるのか
//
// `record.brandName ?? record.brandLabel` が **3画面に写しで**あった
// (`ui/RecordDetail` / `ui/Timeline/RecordCard` / `ui/AreaMap/brandsInPrefecture`)。
// `??` は `null` しか拾わないので**空文字が素通りする**:
//
//   - 銘柄不明の記録(`brandLabel` が空文字)は `brandName` も `null` なので**必ず**空になる
//   - 削除の確認が「2026年7月26日の「」を削除する。取り消せない。」になった(実ブラウザで観測)
//
// **取り消せない操作の確認文で対象が空**なのは、押す前に何を消すか確かめられないということ。
// 写しのままだと1画面で直しても他の2つに残るので(B32 で object URL に同じことが起きた)、
// 判断を純関数1本にして呼び側は結果を描くだけにする。
//
// ## 「名前が無い」を隠さない
//
// 代替の語を返すだけでなく `named: false` を添える。**呼び側が文の形を変えられる**ようにするため:
// 名前があるなら「…の「紀土」を削除する」、無いなら「…の銘柄不明の記録を削除する」。
// 鉤括弧の中に代替の語を入れると、それが記録に書かれた銘柄名のように読める。

import type { SakeRecord } from './types.ts'

/** 名前が無いときに出す語。**状態を名乗らない**(`unknown` かどうかはバッジの担当) */
export const UNNAMED_RECORD = '銘柄不明の記録'

export type RecordTitle = {
  /** 画面に出す名前。**空文字にならない** */
  readonly text: string
  /** `text` が記録の値そのものか。`false` なら `UNNAMED_RECORD` に落ちている */
  readonly named: boolean
  /**
   * 併記する本人の表記。**紐付けた銘柄名と本人の表記が違うときだけ**。
   *
   * 記録は本人の表記が原本で、さけのわ名はそれに当てた解釈にすぎない(`荷札酒` → `加茂錦`)。
   * 同じなら重ねても情報が増えないので `null`、**空文字も `null`**
   * (バックアップ JSON 由来の `''` で「記録の表記: 」という中身の無い行が出る)。
   */
  readonly rawLabel: string | null
}

/** 空白だけの値も「無い」として扱う(見た目が空なら空) */
const present = (value: string | null): string | null => {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : value
}

/**
 * 記録の表示名を決める。**さけのわ由来の銘柄名を優先し、無ければ本人の表記に落ちる。**
 *
 * `brandId` から毎回逆引きしないのは、テーブル未着でも描けるようにするため
 * (`types.ts` の `brandName` の設計)。
 */
export function recordTitle(record: Pick<SakeRecord, 'brandName' | 'brandLabel'>): RecordTitle {
  const brandName = present(record.brandName)
  const brandLabel = present(record.brandLabel)
  const text = brandName ?? brandLabel

  if (text === null) return { text: UNNAMED_RECORD, named: false, rawLabel: null }
  return {
    text,
    named: true,
    rawLabel: brandLabel !== null && brandLabel !== text ? brandLabel : null,
  }
}

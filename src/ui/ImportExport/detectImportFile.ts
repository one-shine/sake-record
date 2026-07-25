// 取り込み欄に来たファイルを「どちらの形式か」に振り分ける。**書き込みは一切しない。**
//
// 受けるのは2種類だけで、JSON の型で排他に分かれる:
//
// | 形 | 中身 | 経路 |
// |---|---|---|
// | オブジェクト | `{schemaVersion, exportedAt, records, aliases}` = このアプリのバックアップ | `importAll` |
// | 配列 | `[{no, drankOn, brandLabel, prefecture, spec, note}, ...]` = 記録の元データ | `importRows`(linker で紐付ける) |
//
// **判定できないものは理由を返して拒否する。** どちらかに寄せて「たぶん元データだろう」と
// 読み進めると、既存の記録を消してから0件を書く事故になる(取り込みは全置換)。
//
// 判定を純関数として切り出しているのは、振り分けの取り違え(バックアップを行配列として
// 読む / その逆)を React を起動せずに固定できるようにするため。

import { checkExportPayload } from '../../domain/backupSchema.ts'
import type { SakeLogRow } from '../../domain/parseSakeLog.ts'
import { checkImportRows } from '../../store/records.ts'
import { describeError } from '../common/errors.ts'

export type DetectedFile =
  | {
      kind: 'backup'
      /** そのまま `importAll` に渡す(再直列化しない) */
      text: string
      records: number
      aliases: number
      /** ISO8601。いつのバックアップかを確認画面に出す */
      exportedAt: string
    }
  | { kind: 'seed'; rows: SakeLogRow[] }
  /** 取り込めない。**理由を必ず画面に出す**(無音で捨てない) */
  | { kind: 'rejected'; reason: string }

/** 値の中身は出さずに型だけ言う(拒否理由に台帳の内容を混ぜない) */
function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '配列'
  return typeof value
}

export function detectImportFile(text: string): DetectedFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    return { kind: 'rejected', reason: `JSON として読み取れない — ${describeError(cause)}` }
  }

  if (Array.isArray(parsed)) {
    // 行の配列 = 記録の元データ。形の検証は store 側と同じ1本(checkImportRows)を使う
    const check = checkImportRows(parsed)
    if (!check.ok) {
      return { kind: 'rejected', reason: `記録の元データとして読めない: ${check.reason}` }
    }
    if (check.rows.length === 0) {
      // 空配列を通すと「全置換で0件」= 全消去になる。消すなら消す操作から明示的にやる
      return { kind: 'rejected', reason: '行が0件なので取り込むものがない' }
    }
    return { kind: 'seed', rows: check.rows }
  }

  if (typeof parsed === 'object' && parsed !== null) {
    // オブジェクトはバックアップだけ。版・アプリ識別子の判定も domain 側の1本に任せる
    const check = checkExportPayload(parsed)
    if (!check.ok) return { kind: 'rejected', reason: check.reason }
    return {
      kind: 'backup',
      text,
      records: check.payload.records.length,
      aliases: check.payload.aliases.length,
      exportedAt: check.payload.exportedAt,
    }
  }

  return {
    kind: 'rejected',
    reason: `JSON の中身が配列でもオブジェクトでもない(${typeName(parsed)})`,
  }
}

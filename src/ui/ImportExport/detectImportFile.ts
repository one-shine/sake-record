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

import {
  checkExportPayload,
  isExportedAlias,
  isExportedNote,
  isExportedRecord,
} from '../../domain/backupSchema.ts'
import type { SakeLogRow } from '../../domain/parseSakeLog.ts'
import { aliasKeyOf } from '../../store/aliases.ts'
import { noteKeyOf } from '../../store/notes.ts'
import { checkImportRows } from '../../store/records.ts'
import { describeError } from '../common/errors.ts'

export type DetectedFile =
  | {
      kind: 'backup'
      /** そのまま `importAll` に渡す(再直列化しない) */
      text: string
      /**
       * **実際に取り込める件数(B26)。** 生の行数ではない。
       *
       * 以前は `records.length` をそのまま出していたので、中身が1件も読めない JSON でも
       * 「記録 2件」と言い、取り込むと「0件しか読めない」と言い直していた。
       * `importAll` が実際に書く数と同じ数え方(**形が読める行を id で畳む**)にする。
       */
      records: number
      /** ファイルに入っている生の行数。`records` との差が「落ちる件数」 */
      recordRows: number
      aliases: number
      aliasRows: number
      /** 銘柄・蔵元のメモ(v3〜)。**取り込みで置き換わるのに予告していなかった** */
      notes: number
      noteRows: number
      /** ISO8601。いつのバックアップかを確認画面に出す */
      exportedAt: string
    }
  | { kind: 'seed'; rows: SakeLogRow[] }
  /** 取り込めない。**理由を必ず画面に出す**(無音で捨てない) */
  | { kind: 'rejected'; reason: string }

/**
 * **`importAll` が実際に書く件数を数える(B26)。** 形が読めない行を落とし、鍵で畳む。
 *
 * 数え方をあちらと合わせるのが要点 — 生の行数を出すと「2件読める」と言った直後に
 * 「0件しか読めない」と言うことになる(事前の警告として役に立たない)。
 * **判定そのものは `domain/backupSchema.ts` の型ガードを共有する**(写しを作らない)。
 */
function countImportable<T>(
  rows: readonly unknown[],
  readable: (row: unknown) => row is T,
  keyOf: (row: T) => string,
): number {
  const keys = new Set<string>()
  for (const row of rows) {
    if (!readable(row)) continue
    keys.add(keyOf(row))
  }
  return keys.size
}

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
    const { records, aliases, notes = [], exportedAt } = check.payload
    return {
      kind: 'backup',
      text,
      records: countImportable(records, isExportedRecord, (row) => row.id),
      recordRows: records.length,
      aliases: countImportable(aliases, isExportedAlias, (row) => aliasKeyOf(row)),
      aliasRows: aliases.length,
      notes: countImportable(notes, isExportedNote, (row) => noteKeyOf(row)),
      noteRows: notes.length,
      exportedAt,
    }
  }

  return {
    kind: 'rejected',
    reason: `JSON の中身が配列でもオブジェクトでもない(${typeName(parsed)})`,
  }
}

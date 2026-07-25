// 手動紐付けの**計算**(何件に波及するか / 何を永続化するか)と**副作用の順序**を、
// React から独立した形に切り出す。画面(LinkBrandPanel)はここを呼ぶだけにする。
//
// 依存方向は domain ← store ← ui。ここは ui 層なので store を呼んでよい(逆は不可)。
// パネル本体から store の import を外に出す理由は ImportExport/importActions.ts と同じ:
// (a) コンポーネントのテストが IndexedDB を要らなくなる
// (b) 「別名を先に保存してから記録を更新する」という**順序が意味を持つ手順**を1箇所に閉じられる
//
// ## この層が引き受けている5つの約束
//
// 1. **波及件数を事前に数える。** `planManualLink` は書き込みを1つもせずに「これから何件が
//    変わるか」を返す。画面はその数を確認ダイアログに出してから `applyManualLink` を呼ぶ
//    (brain: 破壊的・波及的な操作を無音で実行しない)。
// 2. **報告するのは実績値。** 「他N本にも適用した」の N は計画値ではなく**更新できた件数**。
//    途中で失敗した記録は `failures` に理由が残る(無音で件数だけ合わせない)。
// 3. **紐付け済みの記録を上書きしない。** 同じ表記でも既に紐付いている記録は触らず、
//    触らなかったことを `keptLinked` で表に出す。
// 4. **即時の更新と、次に `createLinker` が出す結果を一致させる。** 波及する対象は
//    「保存する別名が実際に効く記録」と同じ条件(`aliasApplies`)で選ぶ。ここがずれると
//    画面では紐付いているのに再取り込みで戻る(またはその逆)という差が生まれる。
// 5. **解除は「消す別名」を推測しない。** 消すキーは記録の**現在の**都道府県から組み立てず、
//    保存済みの別名の中からこの記録に効いている行を見つけて、その行のキーで消す
//    (`planUnlink` に `aliases` を渡すのはこのため)。紐付けのときに空だった県を
//    さけのわ由来で埋めるので、記録から組み立てるとキーが変わって**別名だけが残る** —
//    「解除したのに次の取り込みで紐付けが復活する」という原因の見えない状態になる。

import { normalize } from '../../domain/normalize.ts'
import type { BrandAlias, LinkStatus, SakeRecord, SakenowaBrand } from '../../domain/types.ts'
import { aliasKeyOf, deleteAlias, listAliases, putAlias } from '../../store/aliases.ts'
import { updateRecord } from '../../store/records.ts'
import { isLinkedStatus } from '../Timeline/linkStatus.ts'
import { describeError } from '../common/errors.ts'

/**
 * 計画に要る最小の面。`SakeRecord` がそのまま満たす。
 * `brandName` は「いま何に紐付いているか」を画面に出すために持つ(計画には使わない)。
 */
export type LinkableRecord = Pick<
  SakeRecord,
  'id' | 'brandLabel' | 'prefecture' | 'linkStatus' | 'sakenowaBrandId' | 'brandName'
>

/**
 * 記録1件に書き込む紐付け。`RecordPatch` の部分集合で、**`prefecture` を省略したときは
 * 記録の県に触らない**(patch の `undefined` = 指定なし と同じ意味論)。
 */
export type RecordLink = {
  sakenowaBrandId: number | null
  brandName: string | null
  linkStatus: LinkStatus
  prefecture?: string
}

/**
 * 記録の県を「照合に使えるスコープ」に畳む。**`''` は県名ではなく手がかりが無いこと**なので
 * `null` と同じに扱う(`createLinker` と同じ規則。ここを揃えないと別名の効く範囲がずれる)。
 */
export function scopeOf(prefecture: string | null): string | null {
  if (prefecture === null) return null
  const trimmed = prefecture.trim()
  return trimmed === '' ? null : trimmed
}

function inScope(key: string, scope: string | null, record: LinkableRecord): boolean {
  if (normalize(record.brandLabel) !== key) return false
  // 県を指定した別名は同県の記録にだけ効く。`null` はワイルドカード(県を問わない)
  return scope === null || scope === scopeOf(record.prefecture)
}

/**
 * その別名がこの記録に効くか。**`createLinker` のキー規則
 * (`(normalize(label), prefecture)` 完全一致 → `(normalize(label), null)`)と同じ**にしてある。
 * `alias.label` は正規化済みであることを前提にする(`putAlias` / `planManualLink` が保証する)。
 */
export function aliasApplies(alias: BrandAlias, record: LinkableRecord): boolean {
  return inScope(alias.label, alias.prefecture, record)
}

/**
 * 紐付いている状態。**実装は `../Timeline/linkStatus.ts` の1箇所**にある
 * (時系列の行と記録の詳細も「手動紐付けの導線を出すか」の判断に同じ述語を使うので、
 * store を引かないモジュールに置いてある)。列挙外の値を「紐付いている」側に寄せる規則も
 * あちらが持つ。ここでは名前だけを揃えて再輸出する。
 */
export { isLinkedStatus as isLinked } from '../Timeline/linkStatus.ts'

// ---------------------------------------------------------------------------
// 別名にできない表記
// ---------------------------------------------------------------------------

/**
 * `createLinker` が**別名表を見る前に** `unknown` で返してしまう照合キー。
 * ここに載るキーで別名を保存しても永久に発火しない(例外も出ない死んだ行になる)。
 *
 * 値の出所は `src/domain/linkBrand.ts`(空キーと `不明`)で、**これは写しである。**
 * 写しがドリフトすると「保存できたのに効かない」が無音で復活するので、
 * `applyManualLink.test.ts` が**本物の `createLinker` に対して**発火しないことを固定している。
 */
const DEAD_ALIAS_KEYS: readonly string[] = ['', '不明']

/** 別名にできない理由。**この1本だけには紐付けられる**ので、そう言う(打てる手を示す) */
function deadAliasReason(key: string): string {
  if (key === '') {
    return '記録の銘柄表記が空なので別名として保存できない。この記録1本にだけ紐付ける。'
  }
  return `表記が「${key}」では別名として保存できない（他の同じ表記の記録は別の酒のことがある）。この記録1本にだけ紐付ける。`
}

// ---------------------------------------------------------------------------
// 紐付けの計画(純関数。書き込みを1つもしない)
// ---------------------------------------------------------------------------

export type ManualLinkPlan = {
  /** 起点の記録 */
  origin: LinkableRecord
  brandId: number
  brandName: string
  /** 選んだ銘柄の都道府県(さけのわ由来)。県に落ちない銘柄は `null` */
  brandPrefecture: string | null
  /**
   * 永続化する別名。**`null` は「別名にできない」**で、理由は `aliasBlocked` に入る。
   * `label` は正規化済み、`prefecture` は記録の県(空ならワイルドカードの `null`)。
   */
  alias: BrandAlias | null
  /** `alias === null` の理由。画面にそのまま出す(`null` なら理由は無い) */
  aliasBlocked: string | null
  /** 更新する記録。**起点が必ず先頭**。同じ表記でも紐付け済みの記録は入らない */
  targets: LinkableRecord[]
  /** 起点以外の件数(「他N本にも適用する」の N) */
  others: number
  /** 同じ表記だが既に紐付いていて触らない件数 */
  keptLinked: number
}

/**
 * 選んだ銘柄で何が起きるかを組む。**IndexedDB にも React にも触らない。**
 *
 * 波及の条件は「保存する別名が効く記録」+「まだ紐付いていない」。前者を `aliasApplies` に
 * 委ねているので、いま画面で変わる集合と、次に `createLinker` が別名から出す集合が一致する。
 */
export function planManualLink(input: {
  records: readonly LinkableRecord[]
  origin: LinkableRecord
  brand: SakenowaBrand
  /** 選んだ銘柄の都道府県。`DecodedTables.prefectureOfBrand` の戻りをそのまま渡す */
  brandPrefecture: string | null
}): ManualLinkPlan {
  const { records, origin, brand, brandPrefecture } = input
  const key = normalize(origin.brandLabel)
  const scope = scopeOf(origin.prefecture)
  const dead = DEAD_ALIAS_KEYS.includes(key)
  // 別名にできないキーは波及もさせない。`不明` の5本は互いに別の酒で、
  // 1本の判断を他の `不明` に広げるのは推測を事実に混ぜることになる
  const alias: BrandAlias | null = dead
    ? null
    : { label: key, prefecture: scope, brandId: brand.id }

  const targets: LinkableRecord[] = [origin]
  let keptLinked = 0
  if (alias !== null) {
    for (const record of records) {
      if (record.id === origin.id) continue
      if (!aliasApplies(alias, record)) continue
      // 既に紐付いている記録は上書きしない(機械の一致も他の手動判断も潰さない)
      if (isLinkedStatus(record.linkStatus)) {
        keptLinked += 1
        continue
      }
      targets.push(record)
    }
  }

  return {
    origin,
    brandId: brand.id,
    brandName: brand.name,
    brandPrefecture,
    alias,
    aliasBlocked: dead ? deadAliasReason(key) : null,
    targets,
    others: targets.length - 1,
    keptLinked,
  }
}

/**
 * 対象1件に書き込む値。**都道府県は記録側が原本なので、空のときだけさけのわ由来で埋める。**
 *
 * 上書きしない理由: 記録の県はその場で見たラベル・店の情報で、選んだ銘柄の県と食い違うこと自体が
 * 手がかり(`Beau Michelle` は記録が神奈川、さけのわの同名は長野)。勝手に揃えると
 * 食い違っていた事実が消える。食い違いは確認ダイアログで**見せる**(画面側の責務)。
 */
export function linkPatchFor(plan: ManualLinkPlan, record: LinkableRecord): RecordLink {
  const link: RecordLink = {
    sakenowaBrandId: plan.brandId,
    brandName: plan.brandName,
    linkStatus: 'manual',
  }
  if (scopeOf(record.prefecture) === null && plan.brandPrefecture !== null) {
    return { ...link, prefecture: plan.brandPrefecture }
  }
  return link
}

// ---------------------------------------------------------------------------
// 解除の計画(純関数)
// ---------------------------------------------------------------------------

export type UnlinkPlan = {
  origin: LinkableRecord
  /** 消す別名。**`null` は「消す別名が見つからない」**(保存されていない / 別名にできない表記) */
  alias: BrandAlias | null
  /** 消す別名のキー。`alias` が `null` なら `null`(存在しないキーを当てずに消さない) */
  aliasKey: string | null
  /** `unlinked` に戻す記録。起点が先頭 */
  targets: LinkableRecord[]
  /** 起点以外の件数 */
  others: number
}

/**
 * この記録の紐付けを作っている別名を、保存済みの表から1つ選ぶ。
 *
 * 選び方は `createLinker` の内部と同じ**「県指定 → ワイルドカード」**で、さらに
 * **いま紐付いている銘柄と同じ `brandId`** の行に限る。別の銘柄を指す同キーの行を消すと、
 * 同じ表記の**他の**記録の紐付けを巻き込んで壊す。
 *
 * 記録の県から `aliasKey()` を組み立てないのがこの関数の存在理由:
 * 紐付けのときに空だった県はさけのわ由来で埋まる(`linkPatchFor`)ので、解除の時点では
 * 記録の県が別名のキー(`null` = ワイルドカード)と一致しない。組み立てで消すと空振りして
 * **記録だけ `unlinked` に戻り別名が残る**。
 */
export function pickAliasFor(
  aliases: readonly BrandAlias[],
  record: LinkableRecord,
): BrandAlias | null {
  let wildcard: BrandAlias | null = null
  let scoped: BrandAlias | null = null
  for (const alias of aliases) {
    if (alias.brandId !== record.sakenowaBrandId) continue
    if (!aliasApplies(alias, record)) continue
    if (alias.prefecture === null) wildcard = alias
    else scoped = alias
  }
  return scoped ?? wildcard
}

/**
 * 手動紐付けを元に戻す計画。**戻すのは同じ判断で変わった記録だけ** —
 * 消す別名の効く範囲にあり、`manual` で、**同じ銘柄**に紐付いている記録に限る。
 * `auto` / `alias` で紐付いた記録や、別の銘柄に手動紐付けした記録は巻き込まない。
 *
 * 範囲を記録の県ではなく**消す別名の県**から取るのは、県付きの別名で紐付けた後に
 * 別の県の記録まで戻さないため / ワイルドカードで紐付けた後に県を埋めた記録を
 * 取り残さないため(どちらも `pickAliasFor` の注記と同じ理由)。
 */
export function planUnlink(input: {
  records: readonly LinkableRecord[]
  origin: LinkableRecord
  /** 保存済みの runtime 別名(`listAliases()` の戻り)。組み込み8件は消せないので渡さなくてよい */
  aliases: readonly BrandAlias[]
}): UnlinkPlan {
  const { records, origin, aliases } = input
  const key = normalize(origin.brandLabel)
  const dead = DEAD_ALIAS_KEYS.includes(key)
  // 別名にできない表記(空 / `不明`)は保存もされていないので探さない。ここで探すと
  // 他人が保存した同キーの行を拾って、無関係な `不明` の記録まで巻き込む
  const alias = dead ? null : pickAliasFor(aliases, origin)
  const scope = alias === null ? scopeOf(origin.prefecture) : alias.prefecture

  const targets: LinkableRecord[] = [origin]
  if (!dead) {
    for (const record of records) {
      if (record.id === origin.id) continue
      if (!inScope(key, scope, record)) continue
      if (record.linkStatus !== 'manual') continue
      if (record.sakenowaBrandId !== origin.sakenowaBrandId) continue
      targets.push(record)
    }
  }

  return {
    origin,
    alias,
    // キーの作り方は db.ts の1箇所に閉じている(自分で組み立てない)
    aliasKey: alias === null ? null : aliasKeyOf(alias),
    targets,
    others: targets.length - 1,
  }
}

/** 解除後に書き込む値。**都道府県は消さない**(紐付け時に埋めた値と元の値を区別できない) */
export const UNLINKED_LINK: RecordLink = {
  sakenowaBrandId: null,
  brandName: null,
  linkStatus: 'unlinked',
}

// ---------------------------------------------------------------------------
// 副作用(順序はここだけが決める)
// ---------------------------------------------------------------------------

/** 画面が呼ぶ副作用の全部。テストはこの面だけを差し替える */
export type ManualLinkActions = {
  /** 別名を永続化する。正規化後の形が返る */
  saveAlias: (alias: BrandAlias) => Promise<BrandAlias>
  /** 別名を消す。消える行が無ければ `false` */
  removeAlias: (key: string) => Promise<boolean>
  /** 保存済みの別名を読む。**解除のときに「どの行が効いているか」を知るために要る** */
  loadAliases: () => Promise<BrandAlias[]>
  /** 記録の紐付けだけを差し替える */
  linkRecord: (id: string, link: RecordLink) => Promise<void>
}

/** 既定の配線。store のラッパをそのまま使う(照合も永続化も再実装しない) */
export const defaultManualLinkActions: ManualLinkActions = {
  saveAlias: putAlias,
  removeAlias: deleteAlias,
  loadAliases: listAliases,
  linkRecord: async (id, link) => {
    await updateRecord(id, link)
  },
}

export type ManualLinkResult = {
  brandId: number
  brandName: string
  /** 選んだ銘柄の都道府県(さけのわ由来)。県が空だった記録に入った値でもある */
  brandPrefecture: string | null
  /** 実際に保存した別名。保存しなかったときは `null`(理由は `aliasBlocked`) */
  alias: BrandAlias | null
  aliasBlocked: string | null
  /** 実際に更新できた記録の id */
  appliedIds: string[]
  /** 起点以外で**実際に**更新できた件数。計画値ではない */
  others: number
  keptLinked: number
  /** 更新できなかった記録の理由。空でなければ画面に出す */
  failures: string[]
}

/**
 * 計画を実行する。**順序は「別名 → 記録」で固定する。**
 *
 * 別名を先にする理由: 別名の保存に失敗したら記録は1件も触らないまま例外が上がる(戻す処理が
 * 要らない)。逆順にすると、記録だけ `manual` になって判断が永続化されていない状態が残り、
 * 再取り込みで静かに `unlinked` へ戻る。
 *
 * 記録の更新は1件ずつ直列に行い、失敗しても残りを続ける。**成功した件数だけを数える**ので
 * 画面に出る「他N本にも適用した」は常に実績値になる。
 */
export async function applyManualLink(
  plan: ManualLinkPlan,
  actions: ManualLinkActions,
): Promise<ManualLinkResult> {
  // 別名の保存は失敗をそのまま投げる(記録は1件も触っていない)。呼び側が画面に出す
  const alias = plan.alias === null ? null : await actions.saveAlias(plan.alias)

  const appliedIds: string[] = []
  const failures: string[] = []
  for (const record of plan.targets) {
    try {
      await actions.linkRecord(record.id, linkPatchFor(plan, record))
      appliedIds.push(record.id)
    } catch (cause) {
      failures.push(`記録 ${record.id} を更新できなかった — ${describeError(cause)}`)
    }
  }

  return {
    brandId: plan.brandId,
    brandName: plan.brandName,
    brandPrefecture: plan.brandPrefecture,
    alias,
    aliasBlocked: plan.aliasBlocked,
    appliedIds,
    others: appliedIds.filter((id) => id !== plan.origin.id).length,
    keptLinked: plan.keptLinked,
    failures,
  }
}

export type UnlinkResult = {
  /** 別名の行が実際に消えたか。`false` は「消す行が無かった」 */
  aliasRemoved: boolean
  appliedIds: string[]
  others: number
  failures: string[]
}

/**
 * 紐付けを解除する。順序は紐付けと同じ「別名 → 記録」。
 *
 * 逆順にすると、記録は `unlinked` に戻っているのに別名が残る = 次の取り込みで紐付けが
 * **復活する**状態を作れる(「解除したのに戻る」は原因が見えない)。
 */
export async function applyUnlink(
  plan: UnlinkPlan,
  actions: ManualLinkActions,
): Promise<UnlinkResult> {
  const aliasRemoved = plan.aliasKey === null ? false : await actions.removeAlias(plan.aliasKey)

  const appliedIds: string[] = []
  const failures: string[] = []
  for (const record of plan.targets) {
    try {
      await actions.linkRecord(record.id, UNLINKED_LINK)
      appliedIds.push(record.id)
    } catch (cause) {
      failures.push(`記録 ${record.id} を戻せなかった — ${describeError(cause)}`)
    }
  }

  return {
    aliasRemoved,
    appliedIds,
    others: appliedIds.filter((id) => id !== plan.origin.id).length,
    failures,
  }
}

// ---------------------------------------------------------------------------
// 文言(件数を出す唯一の場所)
// ---------------------------------------------------------------------------
//
// 件数の文言をここに置くのは、**波及件数が UI コピーの一部**だから(brain: 波及する操作は
// 件数を明示する)。純関数なので「N が正しいか」を画面を組まずに固定できる。

/** 確認ダイアログに出す「これから何が起きるか」。1要素 = 1段落 */
export function linkPlanLines(plan: ManualLinkPlan): string[] {
  const lines = [
    `記録の表記「${plan.origin.brandLabel}」を さけのわの「${plan.brandName}」として紐付ける。`,
  ]
  if (plan.alias === null) {
    if (plan.aliasBlocked !== null) lines.push(plan.aliasBlocked)
  } else {
    lines.push(
      plan.alias.prefecture === null
        ? '別名として保存する（都道府県は問わない）。同じ表記の記録に以後も適用される。'
        : `別名として保存する（都道府県は ${plan.alias.prefecture} のときだけ）。同じ表記の記録に以後も適用される。`,
    )
    lines.push(
      plan.others > 0
        ? `同じ表記で未紐付けの他${plan.others}本もまとめて手動紐付けにする。`
        : '適用するのはこの1本だけ。同じ表記で未紐付けの記録は他に無い。',
    )
  }
  if (plan.keptLinked > 0) {
    lines.push(`同じ表記でも既に紐付いている${plan.keptLinked}本は変えない。`)
  }
  lines.push(...prefectureLines(plan))
  lines.push('紐付けは後から解除できる。')
  return lines
}

/** 記録の県と銘柄の県の関係。**食い違いを隠さずに出す**(揃えるかは本人が決める) */
function prefectureLines(plan: ManualLinkPlan): string[] {
  const recorded = scopeOf(plan.origin.prefecture)
  if (plan.brandPrefecture === null) {
    return ['選んだ銘柄はさけのわで都道府県に辿れない。記録の都道府県はそのまま残す。']
  }
  if (recorded === null) {
    return [`都道府県が空の記録には ${plan.brandPrefecture} を入れる。`]
  }
  if (recorded !== plan.brandPrefecture) {
    return [
      `記録の都道府県は ${recorded}、選んだ銘柄は ${plan.brandPrefecture}。別の蔵の同名かもしれない。`,
      '都道府県は記録の値を残す（記録が原本）。',
    ]
  }
  return []
}

/**
 * 実行後の報告。**「他N本にも適用した」の N は実績値**で、
 * 波及が無かったときは件数ではなく「この1本だけ」と言う(0本という言い方をしない)。
 */
export function linkAppliedMessage(result: ManualLinkResult): string {
  if (result.appliedIds.length === 0) return '1本も更新できなかった。'
  const head = `「${result.brandName}」として紐付けた。`
  return result.others > 0
    ? `${head}同じ表記の他${result.others}本にも適用した。`
    : `${head}適用したのはこの1本だけ。`
}

/** 解除後の報告。別名を消したかどうかも言う(判断の永続化まで消えたことを伝える) */
export function unlinkAppliedMessage(result: UnlinkResult): string {
  if (result.appliedIds.length === 0) return '1本も戻せなかった。'
  const head = '紐付けを解除して未紐付けに戻した。'
  const others = result.others > 0 ? `同じ表記の他${result.others}本も戻した。` : ''
  const alias = result.aliasRemoved
    ? '保存していた別名も消した。'
    : '消す別名は残っていなかった。'
  return `${head}${others}${alias}`
}

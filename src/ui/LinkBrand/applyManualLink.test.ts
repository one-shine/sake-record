// @vitest-environment node
//
// **node 環境で回す。** このモジュールは React にも DOM にも触らないので、node で緑になること
// 自体が「計算と副作用の順序がコンポーネントから独立している」ことの実証になる
// (`store/aliases.test.ts` と同じ理由)。IndexedDB は `fake-indexeddb`。
//
// ## このテストが見張っているもの
//
// 1. **波及の範囲が `createLinker` の別名解決と一致する。** ずれると「画面では紐付いたのに
//    再取り込みで戻る」が無音で起きる。`aliasApplies` の判定を本物の `createLinker` と
//    総当たりで突き合わせて固定する。
// 2. **別名にできないキー(空 / `不明`)の写しがドリフトしない。** 本物の `createLinker` が
//    そのキーで発火しないことをテスト側から確認する(applyManualLink.ts の定数は写しなので)。
// 3. **件数が実績値である。** 途中で失敗したら N が減り、理由が残る。
// 4. **副作用の順序が「別名 → 記録」で固定されている。**
//
// データはすべて合成。実際の飲酒記録(`data/seed/` は gitignore)を fixture にしない。
// 銘柄名・県名は架空(`てすとしゅ` / `甲県`)、日付は1種類だけ(BACKLOG B22 の台帳ガード)。
// 例外は `src/data/brand-aliases.ts` の組み込み8件で、これはコミット済みのソースそのもの。

import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { BRAND_ALIASES } from '../../data/brand-aliases.ts'
import { createLinker } from '../../domain/linkBrand.ts'
import { normalize } from '../../domain/normalize.ts'
import type { BrandAlias, LinkerTables, SakenowaBrand } from '../../domain/types.ts'
import { aliasKey, clearAliases, listAliases, mergeAliases } from '../../store/aliases.ts'
import { closeDb } from '../../store/db.ts'
import { clearRecords, createRecord, getRecord } from '../../store/records.ts'
import {
  aliasApplies,
  applyManualLink,
  applyUnlink,
  defaultManualLinkActions,
  isLinked,
  linkAppliedMessage,
  linkPatchFor,
  linkPlanLines,
  planManualLink,
  planUnlink,
  scopeOf,
  unlinkAppliedMessage,
  type LinkableRecord,
  type ManualLinkActions,
  type RecordLink,
} from './applyManualLink.ts'

function installFakeIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: fakeIndexedDB,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    value: FakeIDBKeyRange,
    configurable: true,
    writable: true,
  })
}
installFakeIndexedDb()

// ---------------------------------------------------------------------------
// 合成データ
// ---------------------------------------------------------------------------

/**
 * 架空の銘柄マスタ。`甲酒`(甲県) / `乙酒`(乙県) / `架空宮泉`(甲県)。
 * **`てすとしゅ` という銘柄は存在しない**ので、この表記は別名でしか解決しない
 * (名称一致が混ざると「別名が効いたのか」を見分けられなくなる)。
 */
const TABLES: Omit<LinkerTables, 'aliases'> = {
  areas: [
    // id 0 は「その他」で都道府県ではない
    { id: 0, name: 'その他' },
    { id: 1, name: '甲県' },
    { id: 2, name: '乙県' },
  ],
  breweries: [
    { id: 11, name: '甲蔵', areaId: 1 },
    { id: 22, name: '乙蔵', areaId: 2 },
  ],
  brands: [
    { id: 101, name: '甲酒', breweryId: 11 },
    { id: 202, name: '乙酒', breweryId: 22 },
    // 組み込み8件の `会津宮泉` が指す 2401 に相当する架空の銘柄(runtime との優先順位を見るため)
    { id: 2401, name: '架空宮泉', breweryId: 11 },
  ],
}

const KOU: SakenowaBrand = { id: 101, name: '甲酒', breweryId: 11 }
const OTSU: SakenowaBrand = { id: 202, name: '乙酒', breweryId: 22 }

/** マスタに無い表記。手動紐付けの対象そのもの */
const LABEL = 'てすとしゅ'

function rec(over: Partial<LinkableRecord> = {}): LinkableRecord {
  return {
    id: 'r1',
    brandLabel: LABEL,
    prefecture: null,
    linkStatus: 'unlinked',
    sakenowaBrandId: null,
    brandName: null,
    ...over,
  }
}

/** 同じ表記の記録を n 件。id は `r1`..`rn` */
function sameLabel(count: number, over: Partial<LinkableRecord> = {}): LinkableRecord[] {
  return Array.from({ length: count }, (_, index) => rec({ id: `r${String(index + 1)}`, ...over }))
}

function linkerWith(aliases: readonly BrandAlias[]) {
  return createLinker({ ...TABLES, aliases })
}

type Recorder = {
  actions: ManualLinkActions
  /** 呼ばれた副作用を呼ばれた順に(順序そのものを固定するため文字列で持つ) */
  calls: string[]
  saved: BrandAlias[]
  links: Map<string, RecordLink>
}

function recorder(over: Partial<ManualLinkActions> = {}): Recorder {
  const calls: string[] = []
  const saved: BrandAlias[] = []
  const links = new Map<string, RecordLink>()
  const actions: ManualLinkActions = {
    saveAlias: (alias) => {
      calls.push(`saveAlias:${alias.label}/${alias.prefecture ?? '*'}→${String(alias.brandId)}`)
      saved.push(alias)
      return Promise.resolve(alias)
    },
    removeAlias: (key) => {
      calls.push(`removeAlias:${key}`)
      return Promise.resolve(true)
    },
    loadAliases: () => Promise.resolve([...saved]),
    linkRecord: (id, link) => {
      calls.push(`linkRecord:${id}`)
      links.set(id, link)
      return Promise.resolve()
    },
    ...over,
  }
  return { actions, calls, saved, links }
}

function planFor(records: readonly LinkableRecord[], brand = KOU, brandPrefecture = '甲県') {
  return planManualLink({ records, origin: records[0], brand, brandPrefecture })
}

// ---------------------------------------------------------------------------

describe('scopeOf / aliasApplies — 別名の効く範囲', () => {
  it('空文字の都道府県はワイルドカードと同じに畳む(県名として扱わない)', () => {
    expect(scopeOf(null)).toBeNull()
    expect(scopeOf('')).toBeNull()
    expect(scopeOf('  ')).toBeNull()
    expect(scopeOf(' 甲県 ')).toBe('甲県')
  })

  it('label は正規化後で突き合わせる(生表記のままでは一致しない罠を塞ぐ)', () => {
    const alias: BrandAlias = { label: normalize('ＺＥＢＲＡ'), prefecture: null, brandId: 101 }
    expect(aliasApplies(alias, rec({ brandLabel: 'ZEBRA' }))).toBe(true)
    expect(aliasApplies(alias, rec({ brandLabel: 'zebra （限定）' }))).toBe(true)
    expect(aliasApplies(alias, rec({ brandLabel: '甲酒' }))).toBe(false)
  })

  // **写しの検証**: `aliasApplies` は createLinker のキー規則を再実装している。
  // ずれると波及した記録と再取り込みの結果が食い違うので、本物と総当たりで突き合わせる。
  it('本物の createLinker が別名で解決する範囲と完全に一致する', () => {
    const aliases: BrandAlias[] = [
      { label: LABEL, prefecture: null, brandId: 101 },
      { label: LABEL, prefecture: '甲県', brandId: 101 },
    ]
    const prefectures: (string | null)[] = [null, '', '甲県', '乙県']
    for (const alias of aliases) {
      const link = linkerWith([alias])
      for (const prefecture of prefectures) {
        const record = rec({ prefecture })
        const resolved = link(record.brandLabel, record.prefecture).brandId === alias.brandId
        expect(aliasApplies(alias, record)).toBe(resolved)
      }
    }
  })

  it('紐付いている状態の判定(未知の値は「紐付いている」= 上書きしない側に寄せる)', () => {
    expect(isLinked('auto')).toBe(true)
    expect(isLinked('alias')).toBe(true)
    expect(isLinked('manual')).toBe(true)
    expect(isLinked('unlinked')).toBe(false)
    expect(isLinked('unknown')).toBe(false)
  })
})

describe('planManualLink — 波及件数を書き込む前に数える', () => {
  it('同じ表記の5件を1件から紐付けると5件が対象になり、他は4本と数える', () => {
    const plan = planFor(sameLabel(5))

    expect(plan.targets.map((target) => target.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
    expect(plan.others).toBe(4)
    expect(plan.keptLinked).toBe(0)
    // 起点は必ず先頭(適用の実績を起点と他で分けて数えるための前提)
    expect(plan.targets[0].id).toBe('r1')
    expect(plan.alias).toEqual({ label: LABEL, prefecture: null, brandId: 101 })
  })

  it('同じ表記でも既に紐付いている記録は対象にせず、触らない件数として出す', () => {
    const records = [
      rec({ id: 'r1' }),
      rec({ id: 'r2' }),
      rec({ id: 'r3', linkStatus: 'auto', sakenowaBrandId: 202, brandName: '乙酒' }),
      rec({ id: 'r4', linkStatus: 'manual', sakenowaBrandId: 202, brandName: '乙酒' }),
    ]
    const plan = planFor(records)

    expect(plan.targets.map((target) => target.id)).toEqual(['r1', 'r2'])
    expect(plan.others).toBe(1)
    expect(plan.keptLinked).toBe(2)
  })

  it('記録に都道府県があれば県付きの別名になり、県が違う同表記には波及しない', () => {
    const records = [
      rec({ id: 'r1', prefecture: '甲県' }),
      rec({ id: 'r2', prefecture: '甲県' }),
      rec({ id: 'r3', prefecture: '乙県' }),
      rec({ id: 'r4', prefecture: null }),
    ]
    const plan = planFor(records)

    expect(plan.alias).toEqual({ label: LABEL, prefecture: '甲県', brandId: 101 })
    expect(plan.targets.map((target) => target.id)).toEqual(['r1', 'r2'])
    expect(plan.others).toBe(1)
  })

  it('記録の都道府県が空ならワイルドカードで書き、県のある同表記にも波及する', () => {
    const records = [
      rec({ id: 'r1', prefecture: '' }),
      rec({ id: 'r2', prefecture: '甲県' }),
      rec({ id: 'r3', prefecture: '乙県' }),
    ]
    const plan = planFor(records)

    expect(plan.alias?.prefecture).toBeNull()
    expect(plan.targets.map((target) => target.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('同じ表記が1件だけなら他0本(件数ではなく「この1本だけ」と言える形で返る)', () => {
    const plan = planFor([rec()])
    expect(plan.others).toBe(0)
    expect(plan.targets).toHaveLength(1)
  })

  it('記録が空配列でも起点1本には紐付けられる', () => {
    const origin = rec()
    const plan = planManualLink({ records: [], origin, brand: KOU, brandPrefecture: '甲県' })
    expect(plan.targets).toEqual([origin])
    expect(plan.others).toBe(0)
  })
})

describe('planManualLink — 別名にできない表記', () => {
  // **写しの検証**: 空キーと `不明` は createLinker が別名表を見る前に unknown で返す。
  // ここが変わったら applyManualLink.ts の DEAD_ALIAS_KEYS も直さないと死んだ行が保存される。
  it('本物の createLinker は空表記と「不明」では別名を一度も発火させない', () => {
    for (const label of ['', '不明']) {
      const link = linkerWith([{ label: normalize(label), prefecture: null, brandId: 101 }])
      const result = link(label, null)
      expect(result.status).toBe('unknown')
      expect(result.brandId).toBeNull()
    }
  })

  it('「不明」の記録は別名を保存せず、他の「不明」にも波及させない', () => {
    const plan = planFor(sameLabel(3, { brandLabel: '不明', linkStatus: 'unknown' }))

    expect(plan.alias).toBeNull()
    expect(plan.aliasBlocked).toContain('別名として保存できない')
    expect(plan.targets.map((target) => target.id)).toEqual(['r1'])
    expect(plan.others).toBe(0)
  })

  it('表記が空の記録も別名を保存せず、その1本だけに紐付ける', () => {
    const plan = planFor(sameLabel(2, { brandLabel: '   ' }))
    expect(plan.alias).toBeNull()
    expect(plan.targets).toHaveLength(1)
  })
})

describe('linkPatchFor — 都道府県は記録が原本', () => {
  it('県が空の記録にはさけのわ由来の県を入れる', () => {
    const plan = planFor([rec({ prefecture: null })])
    expect(linkPatchFor(plan, plan.targets[0])).toEqual({
      sakenowaBrandId: 101,
      brandName: '甲酒',
      linkStatus: 'manual',
      prefecture: '甲県',
    })
  })

  it('県がある記録の県は上書きしない(食い違いを消さない)', () => {
    const origin = rec({ prefecture: '乙県' })
    const plan = planManualLink({ records: [origin], origin, brand: KOU, brandPrefecture: '甲県' })
    const patch = linkPatchFor(plan, origin)
    expect(patch).not.toHaveProperty('prefecture')
    expect(patch.sakenowaBrandId).toBe(101)
  })

  it('銘柄が都道府県に辿れないときは県を書かない(既定の県に落とさない)', () => {
    const origin = rec()
    const plan = planManualLink({ records: [origin], origin, brand: KOU, brandPrefecture: null })
    expect(linkPatchFor(plan, origin)).not.toHaveProperty('prefecture')
  })
})

describe('applyManualLink — 副作用の順序と実績値', () => {
  it('別名を保存してから記録を更新する(順序が逆だと判断が永続化されない状態が残る)', async () => {
    const { actions, calls, links } = recorder()
    const result = await applyManualLink(planFor(sameLabel(5)), actions)

    expect(calls[0]).toBe(`saveAlias:${LABEL}/*→101`)
    expect(calls.slice(1)).toEqual([
      'linkRecord:r1',
      'linkRecord:r2',
      'linkRecord:r3',
      'linkRecord:r4',
      'linkRecord:r5',
    ])
    expect(result.others).toBe(4)
    expect(result.appliedIds).toHaveLength(5)
    expect(result.failures).toEqual([])
    // 5件すべてが manual になる(1件だけ紐付けて残りが auto/unlinked のまま残らない)
    for (const link of links.values()) expect(link.linkStatus).toBe('manual')
  })

  it('別名の保存に失敗したら記録を1件も触らずに投げる', async () => {
    const { actions, calls } = recorder({
      saveAlias: () => Promise.reject(new Error('保存できない')),
    })

    await expect(applyManualLink(planFor(sameLabel(5)), actions)).rejects.toThrow('保存できない')
    expect(calls).toEqual([])
  })

  it('一部の記録が更新できなければ件数を減らし、理由を残す(無音で件数を合わせない)', async () => {
    const base = recorder()
    const actions: ManualLinkActions = {
      ...base.actions,
      linkRecord: (id, link) =>
        id === 'r3' ? Promise.reject(new Error('壊れている')) : base.actions.linkRecord(id, link),
    }
    const result = await applyManualLink(planFor(sameLabel(5)), actions)

    expect(result.appliedIds).toEqual(['r1', 'r2', 'r4', 'r5'])
    expect(result.others).toBe(3)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('壊れている')
    // 報告する N は実績値。計画の4本ではなく3本になる
    expect(linkAppliedMessage(result)).toContain('他3本')
  })

  it('別名にできない表記でも起点1本は紐付け、別名は保存しない', async () => {
    const { actions, calls, saved } = recorder()
    const result = await applyManualLink(
      planFor(sameLabel(3, { brandLabel: '不明', linkStatus: 'unknown' })),
      actions,
    )

    expect(saved).toEqual([])
    expect(calls).toEqual(['linkRecord:r1'])
    expect(result.alias).toBeNull()
    expect(result.aliasBlocked).not.toBeNull()
    expect(result.others).toBe(0)
  })
})

describe('文言 — 件数を出す唯一の場所', () => {
  it('他に波及したときは本数を出す', async () => {
    const { actions } = recorder()
    const result = await applyManualLink(planFor(sameLabel(5)), actions)
    expect(linkAppliedMessage(result)).toBe('「甲酒」として紐付けた。同じ表記の他4本にも適用した。')
  })

  it('1本だけのときは文言が変わる(「他0本」と言わない)', async () => {
    const { actions } = recorder()
    const result = await applyManualLink(planFor([rec()]), actions)
    expect(linkAppliedMessage(result)).toBe('「甲酒」として紐付けた。適用したのはこの1本だけ。')
    expect(linkAppliedMessage(result)).not.toContain('他0本')
  })

  it('1件も更新できなければ成功と読める文言を出さない', async () => {
    const { actions } = recorder({ linkRecord: () => Promise.reject(new Error('だめ')) })
    const result = await applyManualLink(planFor([rec()]), actions)
    expect(linkAppliedMessage(result)).toBe('1本も更新できなかった。')
  })

  it('確認に出す文言が波及件数・別名の範囲・県の食い違いを言う', () => {
    const records = [rec({ id: 'r1', prefecture: '乙県' }), rec({ id: 'r2', prefecture: '乙県' })]
    const lines = linkPlanLines(planFor(records)).join('\n')

    expect(lines).toContain('他1本')
    expect(lines).toContain('乙県')
    expect(lines).toContain('甲県')
    expect(lines).toContain('解除できる')
  })

  it('波及が無いときの確認文言は件数を出さずに「この1本だけ」と言う', () => {
    const lines = linkPlanLines(planFor([rec()])).join('\n')
    expect(lines).toContain('この1本だけ')
    expect(lines).not.toContain('他0本')
  })
})

describe('planUnlink / applyUnlink — 戻せる', () => {
  /** 起点を紐付けたときに保存された別名(ワイルドカード) */
  const SAVED: BrandAlias = { label: LABEL, prefecture: null, brandId: 101 }

  it('同じ判断で変わった記録だけを戻し、別名も消す', async () => {
    const records = [
      rec({ id: 'r1', linkStatus: 'manual', sakenowaBrandId: 101, brandName: '甲酒' }),
      rec({ id: 'r2', linkStatus: 'manual', sakenowaBrandId: 101, brandName: '甲酒' }),
      // 別の銘柄への手動紐付け / 機械が紐付けた記録 / 未紐付け は巻き込まない
      rec({ id: 'r3', linkStatus: 'manual', sakenowaBrandId: 202, brandName: '乙酒' }),
      rec({ id: 'r4', linkStatus: 'auto', sakenowaBrandId: 101, brandName: '甲酒' }),
      rec({ id: 'r5' }),
    ]
    const plan = planUnlink({ records, origin: records[0], aliases: [SAVED] })
    expect(plan.targets.map((target) => target.id)).toEqual(['r1', 'r2'])
    expect(plan.others).toBe(1)
    expect(plan.aliasKey).toBe(aliasKey(LABEL, null))

    const { actions, calls, links } = recorder()
    const result = await applyUnlink(plan, actions)

    // 順序は紐付けと同じ「別名 → 記録」。逆だと解除後に紐付けが復活し得る
    expect(calls[0]).toBe(`removeAlias:${aliasKey(LABEL, null)}`)
    expect(calls.slice(1)).toEqual(['linkRecord:r1', 'linkRecord:r2'])
    expect(links.get('r1')).toEqual({
      sakenowaBrandId: null,
      brandName: null,
      linkStatus: 'unlinked',
    })
    expect(result.aliasRemoved).toBe(true)
    expect(unlinkAppliedMessage(result)).toContain('他1本')
    expect(unlinkAppliedMessage(result)).toContain('別名も消した')
  })

  it('消す別名が無かったことを結果に出す(消したふりをしない)', async () => {
    const origin = rec({ linkStatus: 'manual', sakenowaBrandId: 101, brandName: '甲酒' })
    const { actions } = recorder({ removeAlias: () => Promise.resolve(false) })
    const result = await applyUnlink(planUnlink({ records: [origin], origin, aliases: [SAVED] }), actions)

    expect(result.aliasRemoved).toBe(false)
    expect(unlinkAppliedMessage(result)).toContain('残っていなかった')
  })

  // **回帰**: 紐付けのとき空だった県はさけのわ由来で埋まる(linkPatchFor)。解除のキーを
  // 記録の県から組み立てると、埋まった県で別のキーになり**別名だけが残る** =
  // 次の取り込みで紐付けが復活する。消すキーは保存済みの行から選ぶ。
  it('紐付けで都道府県が埋まった記録でも、保存済みのワイルドカード別名のキーで消す', async () => {
    // r1 は紐付けの結果として県が入っている(別名は県なしで保存されている)
    const origin = rec({
      prefecture: '甲県',
      linkStatus: 'manual',
      sakenowaBrandId: 101,
      brandName: '甲酒',
    })
    const other = rec({ id: 'r2', linkStatus: 'manual', sakenowaBrandId: 101, brandName: '甲酒' })
    const plan = planUnlink({ records: [origin, other], origin, aliases: [SAVED] })

    expect(plan.aliasKey).toBe(aliasKey(LABEL, null))
    expect(plan.aliasKey).not.toBe(aliasKey(LABEL, '甲県'))
    // 戻す範囲も別名の範囲(ワイルドカード)で取るので、県が入っていない同表記も戻る
    expect(plan.targets.map((target) => target.id)).toEqual(['r1', 'r2'])
  })

  it('県付きの別名で紐付けたときは同県の記録だけを戻す', () => {
    const scoped: BrandAlias = { label: LABEL, prefecture: '甲県', brandId: 101 }
    const origin = rec({
      prefecture: '甲県',
      linkStatus: 'manual',
      sakenowaBrandId: 101,
      brandName: '甲酒',
    })
    const plan = planUnlink({
      records: [
        origin,
        rec({ id: 'r2', prefecture: '甲県', linkStatus: 'manual', sakenowaBrandId: 101 }),
        rec({ id: 'r3', prefecture: '乙県', linkStatus: 'manual', sakenowaBrandId: 101 }),
      ],
      origin,
      aliases: [scoped],
    })

    expect(plan.aliasKey).toBe(aliasKey(LABEL, '甲県'))
    expect(plan.targets.map((target) => target.id)).toEqual(['r1', 'r2'])
  })

  it('別の銘柄を指す同キーの別名は選ばない(他の記録の紐付けを巻き込まない)', async () => {
    const origin = rec({ linkStatus: 'manual', sakenowaBrandId: 101, brandName: '甲酒' })
    const plan = planUnlink({
      records: [origin],
      origin,
      aliases: [{ label: LABEL, prefecture: null, brandId: 202 }],
    })

    expect(plan.alias).toBeNull()
    expect(plan.aliasKey).toBeNull()

    // キーが無いので removeAlias は一度も呼ばれない(存在しないキーを当てて消しに行かない)
    const { actions, calls } = recorder()
    const result = await applyUnlink(plan, actions)
    expect(calls).toEqual(['linkRecord:r1'])
    expect(result.aliasRemoved).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 実際の store との往復(fake-indexeddb)。**別名の永続化とマージ規則がここで効く**
// ---------------------------------------------------------------------------

describe('既定の配線 — 永続化と優先順位', () => {
  beforeEach(async () => {
    await clearAliases()
    await clearRecords()
  })

  afterAll(() => {
    closeDb()
  })

  /** 起点1件を実際に保存して、その記録を返す */
  async function seedRecord(over: Partial<Parameters<typeof createRecord>[0]> = {}) {
    return createRecord({
      drankOn: '2020-01-01',
      brandLabel: LABEL,
      sakenowaBrandId: null,
      brandName: null,
      linkStatus: 'unlinked',
      prefecture: null,
      spec: '',
      rating: null,
      place: '',
      note: '',
      thumbnail: null,
      sourceNo: null,
      ...over,
    })
  }

  it('紐付けると別名が永続化され、リロード相当(listAliases 再読込)でも解決する', async () => {
    const saved = await seedRecord()
    const plan = planManualLink({
      records: [saved],
      origin: saved,
      brand: KOU,
      brandPrefecture: '甲県',
    })
    await applyManualLink(plan, defaultManualLinkActions)

    // 記録は manual になり、空だった県はさけのわ由来で埋まる
    const stored = await getRecord(saved.id)
    expect(stored?.linkStatus).toBe('manual')
    expect(stored?.sakenowaBrandId).toBe(101)
    expect(stored?.prefecture).toBe('甲県')

    // リロード相当: IDB から読み直した runtime を組み込み表と畳んで linker を組み直す
    const runtime = await listAliases()
    // `updatedAt`(同期の勝ち負けを決める値)が付くので、紐付けに効く3項目だけを見る
    expect(runtime).toMatchObject([{ label: LABEL, prefecture: null, brandId: 101 }])
    const link = linkerWith(mergeAliases(BRAND_ALIASES, runtime))
    expect(link(LABEL, null)).toMatchObject({ brandId: 101, status: 'alias' })
  })

  it('runtime の別名が組み込み8件を上書きする(mergeAliases の規則がここでも効く)', async () => {
    // 組み込みは `会津宮泉` → 2401。同じキーに本人の判断(101)を保存する
    const builtin = BRAND_ALIASES.find((alias) => alias.label === '会津宮泉')
    expect(builtin?.brandId).toBe(2401)

    const saved = await seedRecord({ brandLabel: '会津宮泉' })
    // 上書き前は組み込みの判断が効いている
    expect(linkerWith(mergeAliases(BRAND_ALIASES, []))('会津宮泉', null).brandId).toBe(2401)

    await applyManualLink(
      planManualLink({ records: [saved], origin: saved, brand: KOU, brandPrefecture: '甲県' }),
      defaultManualLinkActions,
    )

    const merged = mergeAliases(BRAND_ALIASES, await listAliases())
    expect(linkerWith(merged)('会津宮泉', null).brandId).toBe(101)
    // 同じキーなので行は増えない(組み込みの位置に上書きされる)
    expect(merged).toHaveLength(BRAND_ALIASES.length)
  })

  it('解除すると別名が消え、記録は未紐付けに戻る', async () => {
    const saved = await seedRecord()
    await applyManualLink(
      planManualLink({ records: [saved], origin: saved, brand: OTSU, brandPrefecture: '乙県' }),
      defaultManualLinkActions,
    )
    const linked = await getRecord(saved.id)
    expect(linked?.linkStatus).toBe('manual')
    // **紐付けで県が埋まっている。** ここから記録の県でキーを組み立てると別名が残る(回帰)
    expect(linked?.prefecture).toBe('乙県')

    const result = await applyUnlink(
      planUnlink({
        records: [linked!],
        origin: linked!,
        aliases: await defaultManualLinkActions.loadAliases(),
      }),
      defaultManualLinkActions,
    )

    expect(result.aliasRemoved).toBe(true)
    expect(await listAliases()).toEqual([])
    const back = await getRecord(saved.id)
    expect(back?.linkStatus).toBe('unlinked')
    expect(back?.sakenowaBrandId).toBeNull()
    expect(back?.brandName).toBeNull()
    // 別名が消えたので、次に組み直した linker はもう解決しない
    expect(linkerWith(mergeAliases(BRAND_ALIASES, await listAliases()))(LABEL, null).status).toBe(
      'unlinked',
    )
  })
})

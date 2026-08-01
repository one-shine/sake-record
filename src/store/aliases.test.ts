// @vitest-environment node
//
// **node 環境で回す(db.test.ts / records.test.ts と同じ理由)。** store 層は DOM を要らないので、
// node で回すこと自体が「aliases.ts に window/document が混ざっていない」ことの実証になる。
//
// テストデータは**すべて合成**。実際の飲酒記録(`data/seed/` は gitignore)を転記しない。
// 銘柄名・県名は架空(`てすとしゅ` / `甲県`)で、**日付は1つも出てこない**(BACKLOG B22 の台帳ガード)。
// 例外は `src/data/brand-aliases.ts` の組み込み8件で、これはコミット済みのソースそのもの。
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { BRAND_ALIASES } from '../data/brand-aliases.ts'
import { createLinker } from '../domain/linkBrand.ts'
import type { BrandAlias, Linker, LinkerTables } from '../domain/types.ts'
import { clear, closeDb, put } from './db.ts'
import type { StoredAlias } from './db.ts'
import {
  aliasKey,
  aliasKeyOf,
  canonicalAlias,
  clearAliasDeletions,
  clearAliases,
  deleteAlias,
  getAlias,
  listAliasDeletions,
  listAliases,
  mergeAliases,
  putAlias,
} from './aliases.ts'

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

/** 架空の銘柄マスタ。`甲酒`(甲県) と `乙酒`(乙県) の2銘柄だけ。`てすとしゅ` は**存在しない** */
const TABLES: Omit<LinkerTables, 'aliases'> = {
  areas: [
    // id 0 は「その他」で都道府県ではない(createLinker は県名索引に入れない)
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
  ],
}

const LABEL = 'てすとしゅ'

function alias(over: Partial<BrandAlias> = {}): BrandAlias {
  return { label: LABEL, prefecture: null, brandId: 101, ...over }
}

/** 保存時に入る更新時刻。**固定値を渡す** — 既定は `new Date()` なので比較が揺れる */
const AT = '2026-01-01T00:00:00.000Z'

/** 保存されたあとの形(`alias()` に更新時刻が付いたもの) */
function stored(over: Partial<BrandAlias> = {}, at: string = AT): StoredAlias {
  return { ...alias(over), updatedAt: at }
}

/** builtin と runtime を畳んで解決関数にする(= buildLinker がやる合成の、fetch 抜きの中身) */
function linkerFor(builtin: readonly BrandAlias[], runtime: readonly BrandAlias[]): Linker {
  return createLinker({ ...TABLES, aliases: mergeAliases(builtin, runtime) })
}

beforeEach(async () => {
  await clearAliases()
  // 消した記録は `clearAliases` では消えない(全置換を削除として飛ばさないため)。
  // テスト間で持ち越さないようにここで空にする
  await clear('aliasDeletions')
})

afterAll(() => {
  closeDb()
})

// ---------------------------------------------------------------------------

describe('canonicalAlias — 保存/比較の前に形を揃える', () => {
  it('label を normalize する(全角・括弧・空白・異体字・大文字)', () => {
    // 生表記のまま保存されたエイリアスは createLinker が normalize 後のキーで引くので
    // 例外も出さずに一度も発火しない。その経路を canonicalAlias で塞いでいる
    expect(canonicalAlias(alias({ label: 'ＺＥＢＲＡ' })).label).toBe('zebra')
    expect(canonicalAlias(alias({ label: 'てすと しゅ（限定）' })).label).toBe(LABEL)
  })

  it('prefecture の空文字・空白は null(県を問わない)に畳む', () => {
    // '' は aliasKey ではワイルドカードと同じキーに落ちるのに、createLinker の県一致では
    // null でも県名でもないので拾われない = 死んだ行になる
    expect(canonicalAlias(alias({ prefecture: '' })).prefecture).toBeNull()
    expect(canonicalAlias(alias({ prefecture: '   ' })).prefecture).toBeNull()
  })

  it('県名の前後の空白は落とすが県名自体は残す', () => {
    expect(canonicalAlias(alias({ prefecture: ' 甲県 ' })).prefecture).toBe('甲県')
  })

  it('brandId は触らない', () => {
    expect(canonicalAlias(alias({ brandId: 202 })).brandId).toBe(202)
  })

  it('冪等(2回通しても変わらない)', () => {
    const once = canonicalAlias(alias({ label: 'ＺＥＢＲＡ', prefecture: '' }))
    expect(canonicalAlias(once)).toEqual(once)
  })
})

describe('mergeAliases — 純関数(IndexedDB 不要)', () => {
  it('runtime が空なら組み込み8件がそのまま残る', () => {
    // 組み込み表を壊していないことの固定。件数も内容も順序も builtin と同一
    expect(mergeAliases(BRAND_ALIASES, [])).toEqual([...BRAND_ALIASES])
    expect(mergeAliases(BRAND_ALIASES, [])).toHaveLength(8)
  })

  it('組み込み8件は既に正規化済み(label は normalize 後の値で書く規約)', () => {
    // 生表記(`髙砂` / `ＺＥＢＲＡ`)を builtin に足すとここが落ちる。
    // 落ちても merge 後は発火するが、表の読み方が2通りになるので規約側で止める
    for (const builtin of BRAND_ALIASES) {
      expect(canonicalAlias(builtin)).toEqual(builtin)
    }
  })

  it('同じキーは runtime が勝つ(本人の判断を開発者の推測で上書きしない)', () => {
    const merged = mergeAliases([alias({ brandId: 101 })], [alias({ brandId: 202 })])
    expect(merged).toEqual([alias({ brandId: 202 })])
  })

  it('runtime が上書きしても builtin の並び位置は動かない', () => {
    const first = alias({ label: 'いち', brandId: 101 })
    const second = alias({ label: 'に', brandId: 101 })
    const third = alias({ label: 'さん', brandId: 101 })
    const merged = mergeAliases([first, second, third], [alias({ label: 'に', brandId: 202 })])
    expect(merged.map((a) => a.label)).toEqual(['いち', 'に', 'さん'])
    expect(merged[1].brandId).toBe(202)
  })

  it('県ありと県なしは別のキーなので両方残る(どちらを使うかは createLinker が決める)', () => {
    const merged = mergeAliases(
      [alias({ prefecture: null, brandId: 101 })],
      [alias({ prefecture: '甲県', brandId: 202 })],
    )
    expect(merged).toHaveLength(2)
    expect(merged.map((a) => a.prefecture)).toEqual([null, '甲県'])
  })

  it('runtime 側の表記ゆれも正規化して突き合わせる(生表記が builtin を上書きできる)', () => {
    // インポートした JSON など外から来た行が生表記のこともある
    const merged = mergeAliases([alias({ label: 'zebra', brandId: 101 })], [
      alias({ label: 'ＺＥＢＲＡ', brandId: 202 }),
    ])
    expect(merged).toEqual([alias({ label: 'zebra', brandId: 202 })])
  })

  it('空文字の県は県なしと同じキーとして上書きする', () => {
    const merged = mergeAliases(
      [alias({ prefecture: null, brandId: 101 })],
      [alias({ prefecture: '', brandId: 202 })],
    )
    expect(merged).toEqual([alias({ prefecture: null, brandId: 202 })])
  })

  it('runtime 内に同じキーが2件あれば後勝ち', () => {
    const merged = mergeAliases([], [alias({ brandId: 101 }), alias({ brandId: 202 })])
    expect(merged).toEqual([alias({ brandId: 202 })])
  })

  it('出力のキーは一意(createLinker の「同キーは後勝ち」に頼らない)', () => {
    const merged = mergeAliases(BRAND_ALIASES, [
      alias({ label: '赤武', brandId: 202 }),
      alias({ label: 'ＺＥＢＲＡ', brandId: 202 }),
      alias({ prefecture: '甲県', brandId: 101 }),
    ])
    const keys = merged.map((a) => aliasKeyOf(a))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('入力配列を書き換えない', () => {
    const builtin = [alias({ brandId: 101 })]
    const runtime = [alias({ brandId: 202 })]
    const merged = mergeAliases(builtin, runtime)
    expect(builtin).toEqual([alias({ brandId: 101 })])
    expect(runtime).toEqual([alias({ brandId: 202 })])
    expect(merged).not.toBe(builtin)
  })

  it('どちらも空なら空(全件や builtin に落ちない)', () => {
    expect(mergeAliases([], [])).toEqual([])
  })
})

describe('mergeAliases + createLinker — 優先順位が解決結果に効く', () => {
  it('runtime の上書きが紐付け先を変える(status は alias)', () => {
    const builtin = [alias({ brandId: 101 })]
    const runtime = [alias({ brandId: 202 })]

    expect(linkerFor(builtin, [])(LABEL, null)).toMatchObject({
      brandId: 101,
      brandName: '甲酒',
      status: 'alias',
    })
    expect(linkerFor(builtin, runtime)(LABEL, null)).toMatchObject({
      brandId: 202,
      brandName: '乙酒',
      status: 'alias',
    })
  })

  it('県指定ありは県なしより優先される(具体性は由来より強い)', () => {
    // builtin の県付き vs runtime のワイルドカード。県が一致する記録は builtin 側が勝つ
    const link = linkerFor([alias({ prefecture: '甲県', brandId: 101 })], [
      alias({ prefecture: null, brandId: 202 }),
    ])
    expect(link(LABEL, '甲県')).toMatchObject({ brandId: 101, status: 'alias' })
    // 県が違う記録には県付きが当たらないのでワイルドカードに落ちる
    expect(link(LABEL, '乙県')).toMatchObject({ brandId: 202, status: 'alias' })
    expect(link(LABEL, null)).toMatchObject({ brandId: 202, status: 'alias' })
  })

  it('県付きを覆したいなら同じ県で書く(同じキーなので runtime が勝つ)', () => {
    const link = linkerFor([alias({ prefecture: '甲県', brandId: 101 })], [
      alias({ prefecture: '甲県', brandId: 202 }),
    ])
    expect(link(LABEL, '甲県')).toMatchObject({ brandId: 202, status: 'alias' })
  })

  it('エイリアスが無ければ未紐付け(推測で埋めない)', () => {
    expect(linkerFor([], [])(LABEL, null)).toMatchObject({
      brandId: null,
      brandName: null,
      status: 'unlinked',
    })
  })
})

describe('永続化 — putAlias / listAliases / getAlias', () => {
  it('初期状態は空配列', async () => {
    expect(await listAliases()).toEqual([])
  })

  it('put した1件を listAliases で読める', async () => {
    await putAlias(alias({ prefecture: '甲県', brandId: 202 }), AT)
    expect(await listAliases()).toEqual([stored({ prefecture: '甲県', brandId: 202 })])
  })

  it('正規化した形で保存し、その形を返す(呼び側がキーを作れる)', async () => {
    const saved = await putAlias({ label: 'ＺＥＢＲＡ', prefecture: '', brandId: 101 }, AT)
    expect(saved).toEqual({ label: 'zebra', prefecture: null, brandId: 101, updatedAt: AT })
    expect(await listAliases()).toEqual([saved])
    expect(await getAlias(aliasKeyOf(saved))).toEqual(saved)
  })

  it('同じキーへの put は上書き(件数は増えない)', async () => {
    await putAlias(alias({ brandId: 101 }), AT)
    await putAlias(alias({ brandId: 202 }), AT)
    expect(await listAliases()).toEqual([stored({ brandId: 202 })])
  })

  it('県ありと県なしは別の行として2件保存される', async () => {
    await putAlias(alias({ prefecture: null, brandId: 101 }))
    await putAlias(alias({ prefecture: '甲県', brandId: 202 }))
    const stored = await listAliases()
    expect(stored).toHaveLength(2)
    expect(await getAlias(aliasKey(LABEL, null))).toMatchObject({ brandId: 101 })
    expect(await getAlias(aliasKey(LABEL, '甲県'))).toMatchObject({ brandId: 202 })
  })

  it('未知のキーは undefined(全件に落ちない)', async () => {
    await putAlias(alias())
    expect(await getAlias(aliasKey('そんざいしないしゅ', null))).toBeUndefined()
  })

  it('正規化後に空になる label は理由付きで断る(永久に発火しないため)', async () => {
    await expect(putAlias(alias({ label: '（限定）' }))).rejects.toThrow(/空/)
    await expect(putAlias(alias({ label: '   ' }))).rejects.toThrow(/空/)
    expect(await listAliases()).toEqual([])
  })

  it('brandId が正の整数でなければ断る', async () => {
    await expect(putAlias(alias({ brandId: 0 }))).rejects.toThrow(/銘柄ID/)
    await expect(putAlias(alias({ brandId: -1 }))).rejects.toThrow(/銘柄ID/)
    await expect(putAlias(alias({ brandId: 1.5 }))).rejects.toThrow(/銘柄ID/)
    await expect(putAlias(alias({ brandId: Number.NaN }))).rejects.toThrow(/銘柄ID/)
    expect(await listAliases()).toEqual([])
  })
})

describe('永続化 — deleteAlias / clearAliases', () => {
  it('消えた行があれば true、無ければ false(UI が「外したのに何も起きない」を検出できる)', async () => {
    const saved = await putAlias(alias())
    expect(await deleteAlias(aliasKeyOf(saved))).toBe(true)
    expect(await listAliases()).toEqual([])
    // IndexedDB の delete は存在しないキーでも成功するので、戻り値で区別する
    expect(await deleteAlias(aliasKeyOf(saved))).toBe(false)
  })

  it('deleteAlias は指定した1件だけ消す', async () => {
    await putAlias(alias({ prefecture: null, brandId: 101 }), AT)
    await putAlias(alias({ prefecture: '甲県', brandId: 202 }), AT)
    expect(await deleteAlias(aliasKey(LABEL, '甲県'))).toBe(true)
    expect(await listAliases()).toEqual([stored({ prefecture: null, brandId: 101 })])
  })

  // **消したことを残さないと、別端末との同期で紐付けが復活する。**
  // `deleteRecord` が同じ規律で記録側をやっているのと対になる(PHASE 8)
  it('deleteAlias は消したことを同じトランザクションで残す', async () => {
    await putAlias(alias({ prefecture: '甲県', brandId: 202 }), AT)
    const key = aliasKey(LABEL, '甲県')
    expect(await deleteAlias(key, '2026-02-02T00:00:00.000Z')).toBe(true)

    expect(await listAliases()).toEqual([])
    expect(await listAliasDeletions()).toEqual([{ key, deletedAt: '2026-02-02T00:00:00.000Z' }])
  })

  // 持っていなかった紐付けの削除を送ると、別端末が本当に紐付けた直後の値を倒しかねない
  it('元から無いキーを消しても、消した記録は残さない', async () => {
    expect(await deleteAlias(aliasKey('しらないの', null))).toBe(false)
    expect(await listAliasDeletions()).toEqual([])
  })

  it('clearAliasDeletions は渡したキーだけ捨てる(未送信の分を巻き添えにしない)', async () => {
    await putAlias(alias({ prefecture: null, brandId: 101 }), AT)
    await putAlias(alias({ prefecture: '甲県', brandId: 202 }), AT)
    const wildcard = aliasKey(LABEL, null)
    const scoped = aliasKey(LABEL, '甲県')
    await deleteAlias(wildcard, '2026-02-02T00:00:00.000Z')
    await deleteAlias(scoped, '2026-02-03T00:00:00.000Z')

    await clearAliasDeletions([wildcard])

    expect(await listAliasDeletions()).toEqual([
      { key: scoped, deletedAt: '2026-02-03T00:00:00.000Z' },
    ])
  })

  it('空の配列を渡しても何も消さない', async () => {
    await putAlias(alias(), AT)
    await deleteAlias(aliasKey(LABEL, null), '2026-02-02T00:00:00.000Z')
    await clearAliasDeletions([])
    expect(await listAliasDeletions()).toHaveLength(1)
  })

  // 全置換の取り込みと「全データ削除」がここを通る。どちらも同期先に対する削除の意思表示ではない
  it('clearAliases は消した記録を作らない(取り込みの全置換が削除として飛ばない)', async () => {
    await putAlias(alias({ brandId: 101 }), AT)
    await putAlias(alias({ prefecture: '甲県', brandId: 202 }), AT)
    await clearAliases()
    expect(await listAliases()).toEqual([])
    expect(await listAliasDeletions()).toEqual([])
  })

  it('clearAliases の後はマージ結果が組み込み8件に戻る', async () => {
    await putAlias(alias({ label: '赤武', brandId: 202 }))
    expect(mergeAliases(BRAND_ALIASES, await listAliases())).not.toEqual([...BRAND_ALIASES])

    await clearAliases()
    expect(await listAliases()).toEqual([])
    expect(mergeAliases(BRAND_ALIASES, await listAliases())).toEqual([...BRAND_ALIASES])
  })
})

describe('永続化 → マージ → 解決の往復', () => {
  it('保存した runtime エイリアスが紐付けに効く', async () => {
    await putAlias(alias({ brandId: 202 }))
    const link = linkerFor([], await listAliases())
    expect(link(LABEL, null)).toMatchObject({ brandId: 202, brandName: '乙酒', status: 'alias' })
  })

  it('生表記のまま保存された行(外部 JSON 由来)もマージで正規化されて効く', async () => {
    // putAlias を通さず db に直接入れる = インポートで復元した行に相当
    const raw: StoredAlias = {
      label: 'ＺＥＢＲＡ',
      prefecture: '',
      brandId: 202,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await put('aliases', raw, aliasKey(raw.label, raw.prefecture))

    const link = linkerFor([{ label: 'zebra', prefecture: null, brandId: 101 }], await listAliases())
    expect(link('ZEBRA', null)).toMatchObject({ brandId: 202, status: 'alias' })
  })

  it('runtime を消せば builtin の紐付けに戻る', async () => {
    const builtin = [alias({ brandId: 101 })]
    await putAlias(alias({ brandId: 202 }))
    expect(linkerFor(builtin, await listAliases())(LABEL, null)).toMatchObject({ brandId: 202 })

    await clearAliases()
    expect(linkerFor(builtin, await listAliases())(LABEL, null)).toMatchObject({ brandId: 101 })
  })
})

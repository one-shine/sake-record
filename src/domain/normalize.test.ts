// @vitest-environment node
// ドメイン層は React も DOM も要らない(CLAUDE.md の依存方向)。node 環境で回すことで
// jsdom に依存した実装が紛れ込んだら赤になる。
import { normalize, VARIANT_CHARS } from './normalize.ts'

/**
 * 異体字マップの期待表。**実装から import した VARIANT_CHARS を期待値に使わず、ここへリテラルで書く。**
 * 実装と同じ出所から期待値を取ると、マップを書き換えたときに期待値も一緒に動いて恒真になる
 * (B15: config の定数と比較して永久に緑だったテストの前例)。
 */
const EXPECTED_VARIANTS: readonly (readonly [variant: string, modern: string])[] = [
  ['髙', '高'],
  ['寫', '写'],
  ['冩', '写'],
  ['樂', '楽'],
  ['冨', '富'],
  ['澤', '沢'],
  ['嶋', '島'],
  ['邊', '辺'],
  ['邉', '辺'],
  ['瀧', '滝'],
  ['眞', '真'],
  ['惠', '恵'],
  ['龍', '竜'],
  ['國', '国'],
  ['壽', '寿'],
  ['濱', '浜'],
  ['巖', '巌'],
  ['齊', '斉'],
  ['齋', '斎'],
  ['寶', '宝'],
  ['舘', '館'],
  ['嵜', '崎'],
  ['碕', '崎'],
]

it('DOM 無しで動く(依存方向の固定。jsdom が要るようになったら赤になる)', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
  expect(normalize('髙砂')).toBe('高砂')
})

describe('異体字マップ', () => {
  it('件数と内容がリテラルの期待表と一致する', () => {
    expect(Object.keys(VARIANT_CHARS)).toHaveLength(23)
    expect(VARIANT_CHARS).toEqual(Object.fromEntries(EXPECTED_VARIANTS))
  })

  it('NFKC は1字も畳まない(= マップが無いと別字のまま残る)', () => {
    // このテストが緑である限り、23字すべてがマップの存在理由を持っている。
    // NFKC だけで済む字が混ざっていたら赤になる。
    for (const [variant, modern] of EXPECTED_VARIANTS) {
      expect(variant.normalize('NFKC')).toBe(variant)
      expect(variant.normalize('NFKC')).not.toBe(modern)
    }
  })

  it('全エントリが変換として機能する', () => {
    for (const [variant, modern] of EXPECTED_VARIANTS) {
      expect(normalize(variant)).toBe(modern)
    }
  })

  it('変換先がさらに別のエントリのキーになっていない(1パスで確定する)', () => {
    for (const [, modern] of EXPECTED_VARIANTS) {
      expect(VARIANT_CHARS[modern]).toBeUndefined()
    }
  })

  it('新字体側はそのまま通る(エイリアス表のキー `高砂` が一致するための前提)', () => {
    expect(normalize('高砂')).toBe('高砂')
    expect(normalize('写楽')).toBe('写楽')
    expect(normalize('栄光富士')).toBe('栄光富士')
  })
})

describe('異体字 — 実データの銘柄名', () => {
  it('髙砂 → 高砂 (NFKC 単独では変換されない)', () => {
    expect('髙砂'.normalize('NFKC')).not.toBe('高砂')
    expect(normalize('髙砂')).toBe('高砂')
  })

  // **マスタ自身が旧字体の側**という珍しい組み合わせ。さけのわの銘柄は `冩楽`(宮泉銘醸)で、
  // 台帳の表記は `寫楽`、実ラベルの印字は `寫樂`、OCR が読むのは `写樂` のこともある。
  // 4通りの表記が1つの照合キー `写楽` に落ちて初めて繋がる(2026-07-31 の実ラベル計測で発覚)。
  it('冩楽 / 寫楽 / 寫樂 / 写樂 がすべて 写楽 に落ちる', () => {
    for (const written of ['冩楽', '寫楽', '寫樂', '写樂', '冩樂']) {
      expect(written.normalize('NFKC'), written).not.toBe('写楽')
      expect(normalize(written), written).toBe('写楽')
    }
  })

  // 蔵元 `萬歳樂` と銘柄 `萬歳楽` は同じ蔵の同じ名前だが、マップが無いと別字のまま残る
  it('萬歳樂 → 萬歳楽', () => {
    expect(normalize('萬歳樂')).toBe(normalize('萬歳楽'))
  })

  it('栄光冨士 → 栄光富士 (NFKC 単独では変換されない)', () => {
    expect('栄光冨士'.normalize('NFKC')).not.toBe('栄光富士')
    expect(normalize('栄光冨士')).toBe('栄光富士')
  })

  it('丹澤山 → 丹沢山 / 磐城壽 → 磐城寿 (どちらも表記ゆれが両方さけのわに登録されている)', () => {
    expect(normalize('丹澤山')).toBe('丹沢山')
    expect(normalize('磐城壽')).toBe('磐城寿')
  })

  it('龍吟虎嘯 → 竜吟虎嘯 (ログ no.83。さけのわ未登録なので紐付かない)', () => {
    expect(normalize('龍吟虎嘯')).toBe('竜吟虎嘯')
  })

  it('1語に2字含まれても両方変換する (濱嶋 → 浜島)', () => {
    expect(normalize('濱嶋')).toBe('浜島')
  })
})

describe('括弧内除去', () => {
  it('半角括弧を落とす (寒菊(OCEAN99) / 翔空(Lagoon Brewery))', () => {
    // 寒菊: ログの `寒菊` と `寒菊(OCEAN99)` が同じキーに落ちるのでエイリアス1件で2本回収できる
    expect(normalize('寒菊(OCEAN99)')).toBe('寒菊')
    // no.103: 括弧内除去を経て初めてさけのわの `翔空` と一致する auto 173本目
    expect(normalize('翔空(Lagoon Brewery)')).toBe('翔空')
  })

  it('全角括弧を落とす (ゆきのまゆ（醸す森） / 御湖鶴（旧）)', () => {
    expect(normalize('ゆきのまゆ（醸す森）')).toBe('ゆきのまゆ')
    expect(normalize('御湖鶴（旧）')).toBe('御湖鶴')
  })

  it('全角括弧は NFKC が半角へ畳む (実装が全角の枝を持たない根拠)', () => {
    // この前提が崩れたら括弧の正規表現に全角の枝が必要になる
    expect('（醸す森）'.normalize('NFKC')).toBe('(醸す森)')
    expect('［旧］'.normalize('NFKC')).toBe('[旧]')
    // 隅付き括弧は NFKC が畳まないので自前で持つ必要がある
    expect('【限定】'.normalize('NFKC')).toBe('【限定】')
  })

  it('角括弧と隅付き括弧を落とす', () => {
    expect(normalize('【限定】獺祭')).toBe('獺祭')
    expect(normalize('獺祭[生]')).toBe('獺祭')
  })

  it('入れ子の括弧を残さない', () => {
    expect(normalize('翔空(Lagoon (Niigata))')).toBe('翔空')
  })

  it('全体が括弧なら空文字になる', () => {
    expect(normalize('(OCEAN99)')).toBe('')
  })

  it('閉じ括弧が無いときは消さない(銘柄名を丸ごと落とさない)', () => {
    expect(normalize('翔空(Lagoon')).toBe('翔空(lagoon')
  })
})

describe('空白除去', () => {
  it('語中の半角スペースを除く (ささのは さらさら)', () => {
    // さけのわには `ささのは さらさら`(2150) と `ささのはさらさら`(3394) が別銘柄で登録されている。
    // 正規化すると同じキーになるが同一蔵(breweryId 102)なので都道府県で解決できる
    expect(normalize('ささのは さらさら')).toBe('ささのはさらさら')
    expect(normalize('ささのはさらさら')).toBe('ささのはさらさら')
  })

  it('全角スペースとタブ・改行も除く', () => {
    expect(normalize('ささのは　さらさら')).toBe('ささのはさらさら')
    expect(normalize('ささのは\tさらさら')).toBe('ささのはさらさら')
    expect(normalize('ささのは\nさらさら')).toBe('ささのはさらさら')
  })

  it('前後の空白も除く(trim を兼ねる)', () => {
    expect(normalize('  寒菊  ')).toBe('寒菊')
  })
})

describe('lowercase と全角英数', () => {
  it('ZEBRA / MAGMA を小文字にする(エイリアス表のキーが小文字)', () => {
    expect(normalize('ZEBRA')).toBe('zebra')
    expect(normalize('MAGMA')).toBe('magma')
  })

  it('全角英数と全角記号を半角にして小文字にする (Ｆｕ． → fu.)', () => {
    expect(normalize('Ｆｕ．')).toBe('fu.')
  })

  it('Beau Michelle → beaumichelle (空白除去 + 小文字)', () => {
    // no.58。この正規化で 3141(長野/伴野酒造) と文字列一致してしまうため、
    // 誤紐付けを止めるのは linkBrand 側の都道府県絞り込み(全件へフォールバックしない)
    expect(normalize('Beau Michelle')).toBe('beaumichelle')
  })
})

describe('境界', () => {
  it('空文字は空文字', () => {
    expect(normalize('')).toBe('')
  })

  it('空白のみは空文字', () => {
    expect(normalize('   ')).toBe('')
    expect(normalize('　')).toBe('')
    expect(normalize('\t\n')).toBe('')
  })

  it('冪等(正規化済みの文字列を通しても変わらない)', () => {
    const labels = [
      '髙砂',
      '寒菊(OCEAN99)',
      'ゆきのまゆ（醸す森）',
      'ささのは さらさら',
      'Ｆｕ．',
      'ZEBRA',
      '濱嶋',
      '不明',
      '',
    ]
    for (const label of labels) {
      expect(normalize(normalize(label))).toBe(normalize(label))
    }
  })

  it('ログのセンチネル `不明` を特別扱いしない(判定は linkBrand の仕事)', () => {
    expect(normalize('不明')).toBe('不明')
  })
})

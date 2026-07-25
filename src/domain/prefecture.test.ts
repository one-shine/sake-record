// @vitest-environment node
// domain 層のテストは jsdom を要求しない。node 環境で回すこと自体がその実証で、
// window/document に触る実装が混ざった瞬間にこのファイルが落ちる。
import japanMap from '@svg-maps/japan'
import areasJson from '../../public/data/sakenowa/areas.json'
import {
  PREFECTURE_NAMES,
  PREFECTURE_ROMAJI,
  codeFromRomaji,
  prefectureCode,
  prefectureName,
  prefectureRomaji,
} from './prefecture.ts'

/** 1..47 */
const ALL_CODES = Array.from({ length: 47 }, (_, i) => i + 1)

/**
 * JIS 都道府県コード順の期待値。**literal で持つ**。
 *
 * 集合としての一致(47件・重複なし・@svg-maps の id と同じ集合)と全単射だけでは
 * **並び替えを検出できない**: 実装の `PREFECTURE_ROMAJI` で `tottori`/`shimane` を入れ替えても
 * 全テストが緑のままになるのを実測した。入れ替わると産地マップが隣県を塗るが SVG は例外を出さない。
 * 対応そのものを1件ずつここに書き出して固定する(実装の定数を import して比較すると恒真になる)。
 */
const JIS_TABLE: readonly (readonly [code: number, name: string, romaji: string])[] = [
  [1, '北海道', 'hokkaido'],
  [2, '青森県', 'aomori'],
  [3, '岩手県', 'iwate'],
  [4, '宮城県', 'miyagi'],
  [5, '秋田県', 'akita'],
  [6, '山形県', 'yamagata'],
  [7, '福島県', 'fukushima'],
  [8, '茨城県', 'ibaraki'],
  [9, '栃木県', 'tochigi'],
  [10, '群馬県', 'gunma'],
  [11, '埼玉県', 'saitama'],
  [12, '千葉県', 'chiba'],
  [13, '東京都', 'tokyo'],
  [14, '神奈川県', 'kanagawa'],
  [15, '新潟県', 'niigata'],
  [16, '富山県', 'toyama'],
  [17, '石川県', 'ishikawa'],
  [18, '福井県', 'fukui'],
  [19, '山梨県', 'yamanashi'],
  [20, '長野県', 'nagano'],
  [21, '岐阜県', 'gifu'],
  [22, '静岡県', 'shizuoka'],
  [23, '愛知県', 'aichi'],
  [24, '三重県', 'mie'],
  [25, '滋賀県', 'shiga'],
  [26, '京都府', 'kyoto'],
  [27, '大阪府', 'osaka'],
  [28, '兵庫県', 'hyogo'],
  [29, '奈良県', 'nara'],
  [30, '和歌山県', 'wakayama'],
  [31, '鳥取県', 'tottori'],
  [32, '島根県', 'shimane'],
  [33, '岡山県', 'okayama'],
  [34, '広島県', 'hiroshima'],
  [35, '山口県', 'yamaguchi'],
  [36, '徳島県', 'tokushima'],
  [37, '香川県', 'kagawa'],
  [38, '愛媛県', 'ehime'],
  [39, '高知県', 'kochi'],
  [40, '福岡県', 'fukuoka'],
  [41, '佐賀県', 'saga'],
  [42, '長崎県', 'nagasaki'],
  [43, '熊本県', 'kumamoto'],
  [44, '大分県', 'oita'],
  [45, '宮崎県', 'miyazaki'],
  [46, '鹿児島県', 'kagoshima'],
  [47, '沖縄県', 'okinawa'],
]

describe('JIS コード / 県名 / romaji の対応', () => {
  it('47件すべてで code ⇄ 県名 ⇄ romaji が JIS 順のまま一致する', () => {
    expect(JIS_TABLE).toHaveLength(47)
    for (const [code, name, romaji] of JIS_TABLE) {
      expect(prefectureName(code), `code ${code} の県名`).toBe(name)
      expect(prefectureRomaji(code), `code ${code} の romaji`).toBe(romaji)
      expect(prefectureCode(name), `${name} の code`).toBe(code)
      expect(codeFromRomaji(romaji), `${romaji} の code`).toBe(code)
    }
  })
})

describe('PREFECTURE_ROMAJI と JIS コードの対応', () => {
  it('47件で重複がない', () => {
    expect(PREFECTURE_ROMAJI).toHaveLength(47)
    expect(new Set(PREFECTURE_ROMAJI).size).toBe(47)
  })

  it('1..47 のすべてで romaji ⇄ code が往復する(全単射)', () => {
    const romajiOfCodes = ALL_CODES.map((code) => prefectureRomaji(code))
    // 順序込みで表と一致 = 1..47 が表の47要素に1対1で写る
    expect(romajiOfCodes).toEqual([...PREFECTURE_ROMAJI])
    // 逆写像でも元の code に戻る(?? '' は null なら必ず落ちるための番人)
    expect(romajiOfCodes.map((romaji) => codeFromRomaji(romaji ?? ''))).toEqual(ALL_CODES)
  })
})

// Phase 6 の産地マップは location.id で県を引く。ここが1件でもずれると
// 塗られない県が黙って出る(SVG は例外を出さない)ので、漏れ0をここで固定する。
describe('@svg-maps/japan の location id との一致', () => {
  it('47件が完全一致する(過不足なし)', () => {
    const mapIds = japanMap.locations.map((location) => location.id)
    expect(mapIds).toHaveLength(47)
    expect(new Set(mapIds).size).toBe(47)

    // 順序はパッケージ側がアルファベット順・こちらが JIS 順なので集合として比較する
    expect([...mapIds].sort()).toEqual([...PREFECTURE_ROMAJI].sort())
  })

  it('すべての location.id が JIS コードに解決できる', () => {
    for (const location of japanMap.locations) {
      expect(codeFromRomaji(location.id), `${location.id} が解決できない`).not.toBeNull()
    }
  })
})

// 県名の出所は areas.json 1本。ここが二重管理になると紐付け側(蔵元 → areaId → 県名)と
// 表示側で同じ県が別文字列になる。
describe('areas.json を単一の出所にしている', () => {
  it('添字がそのまま areaId で、0 は県ではない', () => {
    expect(areasJson.rows).toHaveLength(48)
    expect(areasJson.rows[0]).toBe('その他')
    expect(PREFECTURE_NAMES).toHaveLength(47)
    expect(new Set(PREFECTURE_NAMES).size).toBe(47)
  })

  // 県名を実装側に写し取っていないこと(= areas.json 由来であること)を固定する。
  // 二重管理になると紐付け側(蔵元 → areaId → 県名)と表示側で同じ県が別文字列になる。
  it('prefectureName(code) が areas.json の rows[code] と一致する', () => {
    for (const code of ALL_CODES) {
      expect(prefectureName(code), `code ${code}`).toBe(areasJson.rows[code])
    }
  })
})

describe('prefectureCode', () => {
  it('ログに出る県名を JIS コードに解決する', () => {
    expect(prefectureCode('北海道')).toBe(1)
    expect(prefectureCode('福島県')).toBe(7)
    expect(prefectureCode('東京都')).toBe(13)
    expect(prefectureCode('和歌山県')).toBe(30)
    expect(prefectureCode('沖縄県')).toBe(47)
  })

  // 定義域外を「全件」や「その他(0)」に落とさない。ここが緩むと都道府県での絞り込みが
  // 無効化され、別県の同名銘柄に誤紐付けする(実測で踏んだ: Beau Michelle 神奈川 → 長野の同名)。
  it('定義域外は null を返す(0 や全件にフォールバックしない)', () => {
    // 記録1本の県が「静岡県または京都府」で確定していない。合成値そのものは未知
    expect(prefectureCode('静岡県または京都府')).toBeNull()
    // ただし構成要素は個別には既知 — 未知なのは合成値だけであることを示す
    expect(prefectureCode('静岡県')).toBe(22)
    expect(prefectureCode('京都府')).toBe(26)

    expect(prefectureCode('')).toBeNull()
    expect(prefectureCode(null)).toBeNull()
    expect(prefectureCode(undefined)).toBeNull()
    // areas.json の添字0。県ではないのでコードとして返さない
    expect(prefectureCode('その他')).toBeNull()
    expect(prefectureCode('不明')).toBeNull()
  })

  it('表記ゆれを吸収しない(県名は areas.json と完全一致のみ)', () => {
    expect(prefectureCode('福島')).toBeNull()
    expect(prefectureCode('東京')).toBeNull()
    expect(prefectureCode(' 福島県')).toBeNull()
    expect(prefectureCode('ｆｕｋｕｓｈｉｍａ')).toBeNull()
  })
})

describe('prefectureName / prefectureRomaji の定義域', () => {
  it('1..47 以外は null', () => {
    for (const code of [0, -1, 48, 100, 1.5, NaN, Infinity]) {
      expect(prefectureName(code), `name(${code})`).toBeNull()
      expect(prefectureRomaji(code), `romaji(${code})`).toBeNull()
    }
  })
})

describe('codeFromRomaji', () => {
  it('未知の romaji は null(大文字・別表記も吸収しない)', () => {
    expect(codeFromRomaji('')).toBeNull()
    expect(codeFromRomaji('Hokkaido')).toBeNull()
    expect(codeFromRomaji('tōkyō')).toBeNull()
    expect(codeFromRomaji('kyoto-fu')).toBeNull()
    expect(codeFromRomaji('その他')).toBeNull()
  })
})

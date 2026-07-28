// @vitest-environment node
// domain 層のテストは jsdom を要求しない(CLAUDE.md の依存方向)。node 環境で回すこと自体が
// その実証で、window/document に触る実装が混ざった瞬間にこのファイルが落ちる。
// **OCR エンジン(tesseract.js)はブラウザ API に依存するので domain には置けない**
// (`src/lib/ocr/`)。ここで見るのは「読めた文字列 → 候補」の純関数だけ。
//
// 実装(brandFromText.ts)は src/domain/ の外を一切 import しない。ここで src/data/tables.ts の
// decodeTables を使うのはテスト側の都合で、タプル行を解くコードを二重に書かないため
// (linkBrand.test.ts / suggest.test.ts と同じ方針)。
//
// **期待値はすべてリテラルで書く。** 実装から定数や語彙を import して期待値を組むと恒真になる
// (このリポジトリで過去に4件踏んでいる)。閾値・重み・語彙を動かしたらここが落ちるのが正しい。
//
// **銘柄名・蔵元名・都道府県は公開マスタ(さけのわ)の値**で、飲酒台帳ではない。ここに
// 日付や「日付 × 銘柄」の対を書くと `npm run ledger:check` が落ちる(意図通り)。
import { decodeTables } from '../data/tables.ts'
import areasJson from '../../public/data/sakenowa/areas.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import breweriesJson from '../../public/data/sakenowa/breweries.json'
import flavorChartsJson from '../../public/data/sakenowa/flavorCharts.json'
import {
  createBrandMatcher,
  createCharNarrower,
  DEFAULT_BRAND_MATCH_LIMIT,
  DEFAULT_NARROW_CHAR_LIMIT,
} from './brandFromText.ts'
import { normalize } from './normalize.ts'
import type { BrandMatchResult, BrandMatcherTables } from './brandFromText.ts'
import type {
  AreasFile,
  BrandsFile,
  BreweriesFile,
  FlavorChartsFile,
  SakenowaArea,
  SakenowaBrand,
  SakenowaBrewery,
} from './types.ts'

const decoded = decodeTables({
  areas: areasJson as AreasFile,
  breweries: breweriesJson as unknown as BreweriesFile,
  brands: brandsJson as unknown as BrandsFile,
  flavorCharts: flavorChartsJson as unknown as FlavorChartsFile,
})

/** 照合に要るのは3表だけ(フレーバーは使わない) */
const tables: BrandMatcherTables = {
  brands: decoded.brands,
  breweries: decoded.breweries,
  areas: decoded.areas,
}

const match = createBrandMatcher(tables)

const names = (result: BrandMatchResult) => result.candidates.map((c) => c.brand.name)

/** 「全件」に落ちていないことを言うための基準値。3264件が返る枝は存在してはいけない */
const ALL_BRANDS = 3264

describe('OCR の実測出力から銘柄候補を絞る', () => {
  it('索引の母数は3264件', () => {
    expect(tables.brands).toHaveLength(ALL_BRANDS)
  })

  // -------------------------------------------------------------------------
  // 実測: 合成ラベル(clean な明朝体)に対する tesseract.js の出力
  // -------------------------------------------------------------------------

  it('横書き「獺祭」の誤読 "獅祭" → 獺祭1件だけ(名前の半分に届かない銘柄は出さない)', () => {
    // 実測: jpn + PSM SINGLE_BLOCK → "獅祭" conf 38(期待文字 1/2)。
    // **単純な一致文字数で並べると獺祭は3位**だった(唐獅子 / 獅子の里 / 獺祭 / ぱんだ祭り /
    // 上田獅子)。希少性の重みで1位に上げ、被覆率の門で残り4件を落とす。
    const result = match('獅祭')
    expect(result.tooWeak).toBe(false)
    expect(names(result)).toEqual(['獺祭'])

    // 落ちた4件は**どれも稀な字が当たっている**(獅 は3264件中3件)。それでも出さないのは
    // 銘柄名の半分に届かないから(唐獅子 1/3 / 獅子の里 1/4 / 上田獅子 1/4 / ぱんだ祭り 1/5)。
    for (const name of ['唐獅子', '獅子の里', '上田獅子', 'ぱんだ祭り']) {
      expect(names(match('獅祭', ALL_BRANDS)), name).not.toContain(name)
    }

    const [first] = result.candidates
    expect(first.matchedChars).toEqual(['祭'])
    // 何字中何字かを返す(UI が「2字のうち1字」と添えて、当たりと外れを見分けられるようにする)
    expect(first.brandCharCount).toBe(2)

    // 候補は銘柄名だけでは選び分けられない(同名が54組ある)。県と蔵元まで返す
    expect(first.brand.id).toBe(887)
    expect(first.prefecture).toBe('山口県')
    expect(first.breweryName).toBe('獺祭')
  })

  it('縦書き「獺祭」の誤読 "猟祭" → 獺祭1件', () => {
    // 実測: jpn_vert + PSM AUTO → "猟祭" conf 31。`猟` は3264件のどの銘柄名にも出ないので
    // 照合には使われず、`祭` だけが効く。`ぱんだ祭り` は5字のうち1字なので出さない。
    const result = match('猟祭')
    expect(result.tooWeak).toBe(false)
    expect(names(result)).toEqual(['獺祭'])
  })

  it('全字読めた候補は、稀な1字だけの候補より上に来る', () => {
    // `大山`(全字一致・和 7.03)と `獺祭`(祭 1字・7.39 × 被覆率 0.50 = 3.70)。
    // **一致文字数でも希少性の最大値でも `獺祭` が勝ってしまう**ので、順位が付くのは
    // 「和 × 被覆率」で採点しているから。ここが等しくなったら重み付けが消えている。
    const result = match('大山祭')
    expect(names(result)).toEqual(['大山', '獺祭'])
    const [first, second] = result.candidates
    expect(first.matchedChars).toEqual(['大', '山'])
    expect(second.matchedChars).toEqual(['祭'])
    expect(first.score).toBeGreaterThan(second.score)
  })

  it('縦書き「紀土」の誤読 "新十" → 候補を出さず tooWeak(正解が候補に無いため)', () => {
    // 実測: jpn_vert + PSM AUTO → "新十純米大吟醒"。スペックを除いた "新十" は
    // **1文字共有で39件に一致し、正解「紀土」はそのどこにも居ない**
    // (上位: 新十津川 / 新政 / 三十六人衆 / 十四代)。
    // 正解が無いのに `新十津川` を1位に出すのが最悪の挙動なので、候補を出さずに手動へ回す。
    const result = match('新十')
    expect(result.tooWeak).toBe(true)
    expect(result.candidates).toEqual([])
    // 上限を極端に上げても39件は出ない(「絞れなかった」を候補欄で隠さない)
    expect(match('新十', ALL_BRANDS).candidates).toEqual([])
  })

  it('"新十" が落ちるのは閾値のせいで、`新` が使えないからではない', () => {
    // 同じ `新` を含む `新政` は**銘柄名の全字が読めている**ので通る。
    // つまり落ちる境目は「部分一致か全字一致か」と「共有した字の希少性」であって、
    // 特定の文字を除外しているわけではない。
    const result = match('新政')
    expect(result.tooWeak).toBe(false)
    expect(names(result)).toEqual(['新政'])
    expect(result.candidates[0].matchedChars).toEqual(['新', '政'])
  })

  it('実測の生の行 "新十純米大吟醒" → スペック語を除いても tooWeak のまま', () => {
    const result = match('新十純米大吟醒')
    // 醸→醒 の1文字誤読でも語彙の表記を返す。UI はそのままスペック欄に使える
    expect(result.specTerms).toEqual(['純米大吟醸'])
    expect(result.labelTerms).toEqual([])
    expect(result.tooWeak).toBe(true)
    expect(result.candidates).toEqual([])
  })

  // -------------------------------------------------------------------------
  // スペック語彙の除外(これが無いと117件のノイズが出る)
  // -------------------------------------------------------------------------

  it('"純米大吟醒" は銘柄照合に流さず specTerms に入れる(117件のノイズを出さない)', () => {
    // 実測: 素で照合すると117件に一致する(`純米大吟醸` という銘柄が実在し
    // 「〜の純米大吟醸」も多い)。スペックはラベルに必ず写るので、銘柄名の材料にしない。
    const result = match('純米大吟醒')
    expect(result.specTerms).toEqual(['純米大吟醸'])
    expect(result.candidates).toEqual([])
    expect(result.tooWeak).toBe(true)
    expect(match('純米大吟醒', ALL_BRANDS).candidates).toEqual([])
  })

  it('スペック語は11語すべて個別に発火する', () => {
    // **入力を STYLE_TERMS から作ると恒真になる**(語をその語自身に当てるので綴りが何であれ
    // 一致する)。手書きのリテラルで1語ずつ当てる(stats.ts の同じ罠と同じ理由)。
    const cases: readonly (readonly [string, string])[] = [
      ['純米大吟醸', '純米大吟醸'],
      ['大吟醸', '大吟醸'],
      ['純米吟醸', '純米吟醸'],
      ['純米', '純米'],
      ['本醸造', '本醸造'],
      ['生原酒', '生原酒'],
      ['無濾過', '無濾過'],
      ['原酒', '原酒'],
      ['ひやおろし', 'ひやおろし'],
      ['しぼりたて', 'しぼりたて'],
      ['にごり', 'にごり'],
    ]
    for (const [text, term] of cases) {
      expect(match(text).specTerms, text).toEqual([term])
    }
  })

  it('スペック語は長い語から当てる(同じ場所を2回数えない)', () => {
    // `純米大吟醸` を消してから `純米` `大吟醸` を当てると specTerms が3語に膨れる
    expect(match('純米大吟醸').specTerms).toEqual(['純米大吟醸'])
    // 語はテキストに現れた順で返す(UI がそのままスペック欄に並べられる形)
    expect(match('無濾過生原酒の純米大吟醸').specTerms).toEqual(['無濾過', '生原酒', '純米大吟醸'])
  })

  it('ラベル常出語と数値・単位を除いた残りで照合する', () => {
    const result = match('紀土 純米大吟醸 平和酒造株式会社')
    // スペック語とラベル常出語は**分けて返す**。混ぜると `株式会社` がスペック欄に貼られる
    expect(result.specTerms).toEqual(['純米大吟醸'])
    expect(result.labelTerms).toEqual(['酒造', '株式会社'])
    expect(names(result)).toEqual(['紀土'])
    expect(result.candidates[0].brand.id).toBe(819)
    expect(result.candidates[0].prefecture).toBe('和歌山県')
    expect(result.candidates[0].breweryName).toBe('平和酒造')
  })

  it('ラベルがスペックと数値だけなら「読み取れなかった」と言う', () => {
    const result = match('精米歩合50% 720ml 15度 純米大吟醸 無濾過生原酒')
    expect(result.specTerms).toEqual(['純米大吟醸', '無濾過', '生原酒'])
    expect(result.labelTerms).toEqual(['精米歩合'])
    expect(result.candidates).toEqual([])
    expect(result.tooWeak).toBe(true)
  })

  it('1800ml / 度数 のような表記も塊で落とす', () => {
    // 単位だけが残ると `ml` の `m` `l` がラテン1文字として照合に紛れ込む
    expect(match('1800ml').candidates).toEqual([])
    expect(match('アルコール分15.5度').candidates).toEqual([])
    expect(match('1800ml').tooWeak).toBe(true)
  })

  it('山廃・生酛・特別もスペック語として除く(STYLE_TERMS には足さない)', () => {
    // **STYLE_TERMS に足さない**理由は統計側にある。あれは集計語彙で、実測値
    // (43 / 45 / 51 / 112 / … / 延べ314)がその11語に対する値として固定されている。
    // 照合の都合で語を足すと無関係な統計の数字が黙って動くので、表を分けて持つ。
    const cases: readonly (readonly [string, readonly string[]])[] = [
      ['山廃', ['山廃']],
      ['生酛', ['生酛']],
      ['生もと', ['生もと']],
      ['特別純米', ['特別', '純米']],
      ['特別本醸造', ['特別', '本醸造']],
    ]
    for (const [text, terms] of cases) {
      expect(match(text).specTerms, text).toEqual(terms)
      expect(match(text, ALL_BRANDS).candidates, text).toEqual([])
    }
  })

  it('実測の生の行 "山廃絢米精米歩合六〇" → 「渡辺あさ 山廃」を出さない(回帰)', () => {
    // 実測(kariho.png / 期待は刈穂): 縦書きパス conf 71 の読み。`山廃` が語彙に無かったため
    // **廃(3264件中1件)+ 山 の全字一致**で「渡辺あさ 山廃」を1件だけ高い確度で1位に出していた。
    const result = match('山廃絢米精米歩合六〇')
    expect(result.specTerms).toEqual(['山廃'])
    expect(result.labelTerms).toEqual(['精米歩合'])
    expect(result.tooWeak).toBe(true)
    expect(result.candidates).toEqual([])
  })

  it('実測の生の行 "大山特別純米" / "田酒特別純米酒" → 正解1件だけに絞る(回帰)', () => {
    // `特別純米` が語彙に無かったころは `伯楽星 特別純米 限定` `龍の鼓動 特別純米酒`
    // `特撰 大吟醸` が候補欄に混ざっていた。
    expect(names(match('大山特別純米'))).toEqual(['大山'])
    expect(names(match('田酒特別純米酒'))).toEqual(['田酒'])
    expect(match('大山特別純米').specTerms).toEqual(['特別', '純米'])
  })

  it('銘柄名に「酒造」を含む銘柄は除外の代償で tooWeak に落ちる(既知)', () => {
    // `町田酒造` `田中酒造` は銘柄名に `酒造` を含むので、除去後の `町田` は部分一致になり
    // 希少性の閾値に届かない。**蔵元名の接尾語としての「酒造」はほぼ全てのラベルに写る**ので
    // ノイズを取るほうを選んだ。落ちても手動サジェストに回るだけで、別銘柄を1位に出さない。
    const result = match('町田酒造')
    expect(result.labelTerms).toEqual(['酒造'])
    expect(result.tooWeak).toBe(true)
    expect(result.candidates).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 希少性の重み(ありふれた誤読で候補欄を汚さない)
  // -------------------------------------------------------------------------

  it('ありふれた字の一致は候補にしない("十" は35件に出るので絞りに効かない)', () => {
    // `十祭` の `十` は3264件中35件、`祭` は2件。**一致文字数は同じ1つでも重みが違う**ので、
    // `十` 由来の候補(十酒 / 十九 / 十水 / 十四代 …)は1件も上がらない。
    const result = match('十祭')
    expect(names(result)).toEqual(['獺祭'])
    for (const candidate of result.candidates) {
      expect(candidate.matchedChars).toEqual(['祭'])
    }
  })

  it('ありふれた1字だけでは全字一致でも通さない', () => {
    // `酒` は145件、`泉` は65件に出る。`泉` は**単字の銘柄名として実在する**が、
    // その1字が読めただけでは同定できないので「読み取れなかった」と言う。
    for (const text of ['酒', '泉', '大', '山']) {
      expect(match(text, ALL_BRANDS).candidates, text).toEqual([])
      expect(match(text).tooWeak, text).toBe(true)
    }
  })

  it('ありふれた2字でも全字一致なら通す(大山 / 田酒 / 白鶴)', () => {
    // 全字一致は希少性の**和**で見る。`大` も `山` も単独ではありふれていても、
    // 両方を含む銘柄は3264件中で数件しかない(独立と仮定した期待件数で約3件)。
    // 部分一致を最も稀な1字で見るのと数え方を変えているのはここが理由。
    expect(names(match('大山'))).toEqual(['大山'])
    expect(names(match('田酒'))).toEqual(['田酒'])
    expect(names(match('白鶴'))).toEqual(['白鶴'])
  })

  it('ほぼ固有の1字なら部分一致でも通す("獺" は1件にしか出ない)', () => {
    const result = match('獺')
    expect(names(result)).toEqual(['獺祭'])
    expect(result.candidates[0].matchedChars).toEqual(['獺'])
  })

  // -------------------------------------------------------------------------
  // 被覆率の門(希少性だけではゴミを弾けない)
  // -------------------------------------------------------------------------

  it('銘柄名の半分に届かない部分一致は、字がどれだけ稀でも候補にしない', () => {
    // **これが「自信ありげな別銘柄」を止める門。** OCR のゴミ文字はまさに稀な字なので、
    // 希少性の重み付けは弾くどころか通してしまう(実測で3枚が誤読の1字から1位を出した)。
    //   `覧` は3264件中1件(`天覧山`)= 希少性では最上位。だが3字のうち1字しか読めていない
    //   `廃` も1件(`渡辺あさ 山廃`)。こちらは6字のうち1字
    // どちらも実測で1位に出ていた組み合わせ。
    for (const text of ['七覧', '覧', '廃']) {
      expect(match(text, ALL_BRANDS).candidates, text).toEqual([])
      expect(match(text).tooWeak, text).toBe(true)
    }
  })

  it('半分以上読めていれば通す(境目は 1/2 ちょうどを含む)', () => {
    // `祭` は `獺祭` の2字のうち1字 = ちょうど 1/2。ここを含めないと実測で1位だった
    // 「獅祭」→「獺祭」が消える(再現率が 4/9 → 2/9 に落ちるのを測って確かめた)。
    expect(names(match('祭'))).toEqual(['獺祭'])
    expect(match('祭').candidates[0].brandCharCount).toBe(2)
  })

  it('2字の銘柄に稀な1字が当たる形は通る — ここは文字だけでは切り分けられない', () => {
    // 実測(v2.png)で「花垣」を1位に出した `垣`(3264件中4件)。**この層では落とせない** —
    // `獅祭`→`獺祭`(正解)と証拠の形がまったく同じ(どちらも「2字のうち稀な1字が一致」)で、
    // 文字の情報だけでは区別できないから。切り分けるのは読み取り側の信頼度で、
    // `src/lib/ocr/recognize.ts` の `selectMatchableResults` が担当する
    // (実測ではこの `垣` は conf 15 のパス由来で、conf 41 の本命パスとは別物だった)。
    expect(names(match('垣'))).toEqual(['花垣', '高垣'])
    // 3字以上の `八重垣` `美濃国 大垣城` は被覆率で落ちている
    expect(names(match('垣', ALL_BRANDS))).toEqual(['花垣', '高垣'])
  })

  it('1文字だけの一致で候補に上がれる銘柄は472件(旧規則では1270件だった)', () => {
    // **この数がこの修正の本体。** 旧規則では3264件中1270件(38.9%)が「稀な1字が当たっただけ」で
    // 候補欄に出られた。df≤4 の字は異なり字1418のうち932字(65.7%)あり、OCR のゴミ文字は
    // まさにそこに落ちるので、希少性の重み付けはゴミを弾くどころか通していた。
    // 閾値や被覆率を緩めると必ずここが動く = 「候補が増えて便利になった」の実体が
    // 「当てずっぽうが増えた」であることを数字で見えるようにしておく。
    const surfaced = tables.brands.filter((brand) =>
      [...new Set(normalize(brand.name))].some((ch) =>
        match(ch, ALL_BRANDS).candidates.some((c) => c.brand.id === brand.id),
      ),
    ).length
    expect(surfaced).toBe(472)
  })

  it('matchedChars は稀な順に並ぶ(UI がそのまま「この字で絞った」と出せる)', () => {
    // `獺` は1件 / `祭` は2件。読めた順でも銘柄名の順でもなく希少性の降順
    expect(match('獺祭').candidates[0].matchedChars).toEqual(['獺', '祭'])
  })

  // -------------------------------------------------------------------------
  // 全件フォールバックの禁止
  // -------------------------------------------------------------------------

  it('空文字・空白・記号だけは0件 + tooWeak(全件を返さない)', () => {
    for (const text of ['', '   ', '\n\t', '.,-/()【】', '……', '---']) {
      const result = match(text, ALL_BRANDS)
      expect(result.candidates, JSON.stringify(text)).toEqual([])
      expect(result.tooWeak, JSON.stringify(text)).toBe(true)
      expect(result.specTerms, JSON.stringify(text)).toEqual([])
    }
  })

  it('記号は照合に使わない(`-` は4件の銘柄名にしか出ないので希少性では通ってしまう)', () => {
    // `N-888` `UK-01` のように `-` は3264件中4件しか持たない = 希少性で見ると
    // 「非常に稀な一致」に化ける。記号は銘柄の同定に寄与しないので照合前に落とす。
    expect(names(match('-'))).toEqual([])
    expect(names(match('.'))).toEqual([])
  })

  it('マスタに1件も無い文字だけなら0件(定義域外のキーで全件に落ちない)', () => {
    for (const text of ['кириллица', 'ΑΒΓΔ', '猟']) {
      expect(match(text, ALL_BRANDS).candidates, text).toEqual([])
      expect(match(text).tooWeak, text).toBe(true)
    }
  })

  it('ありふれた字だけの誤読でも候補を作らない', () => {
    // どれも1文字共有では100件超に一致するが、希少性の閾値に届く候補は無い
    for (const text of ['一二三四五', '口口口口', '酒酒酒']) {
      expect(match(text, ALL_BRANDS).candidates, text).toEqual([])
    }
  })

  // -------------------------------------------------------------------------
  // 曖昧さを畳まない
  // -------------------------------------------------------------------------

  it('同名4件の `高砂` は1つに丸めず県と蔵元を付けて全部返す', () => {
    const result = match('高砂')
    expect(result.candidates).toHaveLength(4)
    expect(names(result)).toEqual(['高砂', '高砂', '高砂', '高砂'])
    expect(result.candidates.map((c) => c.prefecture)).toEqual([
      '静岡県',
      '三重県',
      '佐賀県',
      '島根県',
    ])
    expect(result.candidates.map((c) => c.breweryName)).toEqual([
      '富士高砂酒造',
      '木屋正酒造',
      '小柳酒造',
      '財間酒場',
    ])
    // 同点(共有字も被覆率も同じ)の並びは銘柄ID昇順で決定的にする
    expect(result.candidates.map((c) => c.brand.id)).toEqual([2359, 9941, 66006, 77752])
  })

  // -------------------------------------------------------------------------
  // 契約(不変条件・上限)
  // -------------------------------------------------------------------------

  it('candidates が空 ⟺ tooWeak', () => {
    const texts = [
      '獅祭',
      '猟祭',
      '新十',
      '純米大吟醒',
      '獺祭',
      '紀土',
      '町田酒造',
      '',
      '.,-',
      '酒',
      '高砂',
      '一二三四五',
    ]
    for (const text of texts) {
      const result = match(text)
      expect(result.tooWeak, text).toBe(result.candidates.length === 0)
    }
  })

  it('既定の上限は5件。上限は1未満に落とさない(0件は「読み取れなかった」の意味に予約)', () => {
    // 5件以上に絞れるのは、同名4件の `高砂` に `獺祭` が乗ったときのような形
    // (被覆率の門が入ったので、1字だけの一致で候補欄が埋まることはもう無い)
    expect(DEFAULT_BRAND_MATCH_LIMIT).toBe(5)
    expect(names(match('獺祭高砂', ALL_BRANDS))).toEqual(['獺祭', '高砂', '高砂', '高砂', '高砂'])
    expect(match('獺祭高砂').candidates).toHaveLength(5)
    expect(names(match('獺祭高砂', 2))).toEqual(['獺祭', '高砂'])
    // 0件を表示上限で作ると tooWeak と見分けが付かなくなる
    for (const limit of [0, -1, 0.5]) {
      expect(names(match('獺祭高砂', limit)), String(limit)).toEqual(['獺祭'])
      expect(match('獺祭高砂', limit).tooWeak, String(limit)).toBe(false)
    }
    // NaN / Infinity は既定に戻す(暗黙に結果が化けない)
    expect(match('獺祭高砂', Number.NaN).candidates).toHaveLength(5)
    expect(match('獺祭高砂', Number.POSITIVE_INFINITY).candidates).toHaveLength(5)
    expect(match('獺祭高砂', 3.9).candidates).toHaveLength(3)
  })

  it('返す配列は呼び出しごとに独立(索引を書き換えられない)', () => {
    const first = match('獺祭高砂')
    first.candidates.length = 0
    first.specTerms.push('壊れた')
    expect(names(match('獺祭高砂'))).toHaveLength(5)
    expect(match('純米大吟醒').specTerms).toEqual(['純米大吟醸'])
  })
})

describe('文字頻度表の構築', () => {
  it('createBrandMatcher の中で1回だけ構築し、呼び出しでは銘柄名を読み直さない', () => {
    // 3264件の走査が呼び出しごとに走ると、頻度表(= 重みそのもの)を毎回作り直すことになる。
    // `name` の読み取り回数で観測する。**銘柄オブジェクトを返す実装なので、
    // 候補の `brand.name` を読むとこのカウンタも動く** — だから先に回数を確定させる。
    let nameReads = 0
    const brands: readonly SakenowaBrand[] = [
      {
        id: 1,
        breweryId: 10,
        get name() {
          nameReads++
          return '獺祭'
        },
      },
      {
        id: 2,
        breweryId: 10,
        get name() {
          nameReads++
          return 'ぱんだ祭り'
        },
      },
      {
        id: 3,
        breweryId: 11,
        get name() {
          nameReads++
          return '紀土'
        },
      },
    ]
    const breweries: readonly SakenowaBrewery[] = [
      { id: 10, name: '旭酒造', areaId: 35 },
      { id: 11, name: '平和酒造', areaId: 30 },
    ]
    const areas: readonly SakenowaArea[] = [
      { id: 30, name: '和歌山県' },
      { id: 35, name: '山口県' },
    ]

    const matcher = createBrandMatcher({ brands, breweries, areas })
    const afterBuild = nameReads
    const first = matcher('祭')
    const second = matcher('紀土')
    const third = matcher('獺')
    const afterCalls = nameReads

    // 構築時に1件1回だけ読む
    expect(afterBuild).toBe(3)
    // 3回呼んでも増えない = 呼び出しごとにマスタを走査していない
    expect(afterCalls).toBe(3)

    // ここから先は name を読むのでカウンタが動く(上の2つの assert より後に置くこと)。
    // `祭` は `獺祭`(2字の1字)には届くが `ぱんだ祭り`(5字の1字)には届かない
    expect(first.candidates.map((c) => c.brand.id)).toEqual([1])
    expect(second.candidates.map((c) => c.brand.id)).toEqual([3])
    expect(third.candidates.map((c) => c.brand.id)).toEqual([1])
  })

  it('銘柄0件のテーブルでも例外を出さず tooWeak を返す', () => {
    const matcher = createBrandMatcher({ brands: [], breweries: [], areas: [] })
    const result = matcher('獺祭')
    expect(result.candidates).toEqual([])
    expect(result.tooWeak).toBe(true)
    // 語彙の除外はマスタに依存しないので効いたまま
    expect(matcher('純米大吟醸').specTerms).toEqual(['純米大吟醸'])
  })

  it('蔵が引けない銘柄は県も蔵元名も推定で埋めない', () => {
    const matcher = createBrandMatcher({
      brands: [
        { id: 1, name: '獺祭', breweryId: 999 },
        // 蔵元名が空の行(実データに48件ある「その県の蔵元不明」の受け皿)
        { id: 2, name: '紀土', breweryId: 10 },
        // areaId 0 は「その他」で都道府県ではない
        { id: 3, name: '新政', breweryId: 11 },
      ],
      breweries: [
        { id: 10, name: '   ', areaId: 30 },
        { id: 11, name: '海外蔵', areaId: 0 },
      ],
      areas: [
        { id: 0, name: 'その他' },
        { id: 30, name: '和歌山県' },
      ],
    })
    expect(matcher('獺祭').candidates[0]).toMatchObject({
      prefecture: null,
      breweryName: null,
    })
    expect(matcher('紀土').candidates[0]).toMatchObject({
      prefecture: '和歌山県',
      breweryName: null,
    })
    expect(matcher('新政').candidates[0]).toMatchObject({
      prefecture: null,
      breweryName: '海外蔵',
    })
  })
})

// ---------------------------------------------------------------------------
// 読めた字で絞る(候補の門を通らなかったときの受け皿)
// ---------------------------------------------------------------------------
//
// **候補の門を緩める代わりの手当て**なので、ここが緑でも `match` の閾値は動かない。
// 期待値はすべてリテラル(実装から df や語彙を import して組むと恒真になる)。

describe('読めた字を絞り込みの鍵にする', () => {
  const narrow = createCharNarrower(tables.brands)
  const chars = (text: string, limit?: number) => narrow(text, limit).map((c) => c.char)

  it('含む銘柄が少ない順に並ぶ(絞り込みが強い順)', () => {
    // 祭 2件 / 土 9件 / 米 33件。読めた順でも銘柄名の順でもない
    expect(narrow('米土祭')).toEqual([
      { char: '祭', brandCount: 2 },
      { char: '土', brandCount: 9 },
      { char: '米', brandCount: 33 },
    ])
  })

  it('件数が同じときはコードポイント順で決定的にする', () => {
    // 獺 も 賢 も 又 も 3264件中1件
    expect(chars('賢又獺')).toEqual(['又', '獺', '賢'])
  })

  it('マスタに1件も無い字は出さない(押しても0件になる字を押せる形で並べない)', () => {
    // `猟` は誤読で出るがマスタに無い / キリル・ギリシャ文字も同じ
    expect(chars('猟')).toEqual([])
    expect(chars('кириллица')).toEqual([])
    expect(chars('ΑΒΓΔ')).toEqual([])
  })

  it('記号・数値・空白は鍵にしない', () => {
    expect(chars('')).toEqual([])
    expect(chars('  \n\t')).toEqual([])
    expect(chars('.,-/()【】……')).toEqual([])
    expect(chars('720ml 15度 精米歩合50%')).toEqual([])
  })

  it('スペック語とラベル常出語は鍵にしない(語で絞っても銘柄は絞れない)', () => {
    // `純米大吟醸` `株式会社` はそのまま除外語彙に当たる
    expect(chars('純米大吟醸')).toEqual([])
    expect(chars('株式会社')).toEqual([])
    // 1文字置換の誤読も除外される(`醸` → `醒`)
    expect(chars('純米大吟醒')).toEqual([])
    // 語を除いた残りだけが鍵になる
    expect(chars('紀土純米吟醸')).toEqual(['土', '紀'])
  })

  it('同じ字が何度出ても1つに畳む', () => {
    expect(chars('祭祭祭祭')).toEqual(['祭'])
  })

  it('既定の上限は8。0以下なら空(表示上限で勝手に1件残さない)', () => {
    expect(DEFAULT_NARROW_CHAR_LIMIT).toBe(8)
    // 12字ぶん読めても8つまで
    expect(narrow('祭土米獺賢又穂竜山川花月')).toHaveLength(8)
    expect(narrow('祭土米', 2)).toHaveLength(2)
    expect(narrow('祭土米', 0)).toEqual([])
    expect(narrow('祭土米', -1)).toEqual([])
    // NaN / Infinity は既定に戻す
    expect(narrow('祭土米獺賢又穂竜山川花月', Number.NaN)).toHaveLength(8)
    expect(narrow('祭土米獺賢又穂竜山川花月', Number.POSITIVE_INFINITY)).toHaveLength(8)
  })

  it('異体字は銘柄マスタ側と同じ形に畳む(`龍` は `竜` として引ける)', () => {
    // 実測で `黒龍` の写真から読めたのは `龍` 1字だけ。畳まないと「マスタに無い字」になって消える
    expect(narrow('龍')).toEqual([{ char: '竜', brandCount: 41 }])
  })

  // **この節がこの機能の存在理由**。候補の門(`match`)を通らなかった実測の読みが、
  // 鍵としては効くことを1件ずつ固定する。緩めたのは候補ではなく「人が押す道」の側。
  it('候補が出なかった実測の読みでも、鍵としては効く', () => {
    for (const [text, key] of [
      ['。・穂', '穂'],
      ['土', '土'],
      ['龍', '竜'],
    ] as const) {
      expect(match(text).tooWeak, text).toBe(true)
      expect(chars(text), text).toContain(key)
    }
  })

  it('銘柄0件のテーブルでも例外を出さず空を返す', () => {
    expect(createCharNarrower([])('獺祭')).toEqual([])
  })
})

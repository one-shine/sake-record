import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Attribution, KanjiDicCredit, MapCredit, WikipediaCredit } from './Attribution.tsx'

// クレジットが**描画される**ことを守るのはここ(A12)。
// `scripts/check-attribution.mjs` は dist の JS に文言が「在る」ことしか見ない
// (どこか1箇所から import されていれば、義務のある画面が描いていなくても文言は残る)ので、
// 到達可能性はテストの担当。**このファイルが持つのは「部品が4項目を出すこと」まで**で、
// 「その画面に併記されていること」は使用箇所側のテストが持つ:
// 産地タブ = `ui/AreaMap/AreaMap.test.tsx` / 「知る」の出典節 = `ui/Learn/Learn.test.tsx`。
//
// URL は必ず**リテラルで**書く。config から import した定数と比較すると、
// 定数を書き換えたときに期待値も一緒に動いて恒真になり、テストが永久に緑のままになる
// (実際に定数を example.invalid に変えて赤にならないことを確認して直した)。
// ライセンス義務であって設定値ではないので、ここに直接書くのが正しい。
describe('Attribution (全画面のフッタ)', () => {
  it('さけのわのクレジットを sakenowa.com へのリンクとして描画する', () => {
    render(<Attribution onOpenLearn={() => undefined} />)
    expect(screen.getByRole('link', { name: 'さけのわデータを利用しています' })).toHaveAttribute(
      'href',
      'https://sakenowa.com',
    )
  })

  // フッタは1行に圧縮した。**産地マップの CC-BY はフッタから外して使用箇所へ移した**ので、
  // ここに戻ってきたら回帰(全画面に5行の注釈が出るのが邪魔だという要望が起点)。
  it('産地マップの CC-BY 4項目はフッタに出さない(使用箇所へ移設)', () => {
    render(<Attribution onOpenLearn={() => undefined} />)
    expect(screen.queryByText(/Map of Japan/)).toBeNull()
    expect(screen.queryByText(/Victor Cazanave/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'CC BY 4.0' })).toBeNull()
    expect(screen.queryByText(/改変/)).toBeNull()
    // 読みの CC-BY-SA も同じ理由でフッタには出さない(B68)
    expect(screen.queryByText(/KANJIDIC/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'CC BY-SA 4.0' })).toBeNull()
  })

  // 20歳未満の表記は Phase 1 で自主的に足したもので、法的義務の根拠が文書上どこにも無い。
  // 私的なアプリのフッタを5行占める理由が無いので削除した。
  it('20歳未満の飲酒に関する表記を出さない', () => {
    render(<Attribution onOpenLearn={() => undefined} />)
    expect(screen.queryByText(/20歳未満/)).toBeNull()
  })

  it('「出典とライセンス」を押すと onOpenLearn を1回呼ぶ', async () => {
    const user = userEvent.setup()
    const onOpenLearn = vi.fn()
    render(<Attribution onOpenLearn={onOpenLearn} />)

    await user.click(screen.getByRole('button', { name: '出典とライセンス' }))

    expect(onOpenLearn).toHaveBeenCalledTimes(1)
  })
})

// CC-BY-4.0 §3(a)(1) が要求する4項目。**1つでも欠けたら義務違反**なので個別に見る
// (まとめて1つの正規表現にすると、どれが落ちたのか分からないうえ通し方が緩くなる)。
describe('MapCredit (産地マップの CC-BY)', () => {
  it('タイトルと作者を出所へのリンクとして描画する', () => {
    render(<MapCredit />)
    expect(screen.getByRole('link', { name: 'Map of Japan by Victor Cazanave' })).toHaveAttribute(
      'href',
      'https://github.com/VictorCazanave/svg-maps',
    )
  })

  it('ライセンスへのリンクを描画する', () => {
    render(<MapCredit />)
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    )
  })

  it('改変した旨を描画する', () => {
    render(<MapCredit />)
    expect(screen.getByText(/本数に応じて着色する改変あり/)).toBeInTheDocument()
  })
})

// CC-BY-SA-4.0 §3(a)(1) が要求する4項目。地図と同じ理由で個別に見る(B68)。
describe('KanjiDicCredit (銘柄の読みの CC-BY-SA)', () => {
  it('タイトルと作者を出所へのリンクとして描画する', () => {
    render(<KanjiDicCredit />)
    expect(screen.getByRole('link', { name: 'KANJIDIC Project by EDRDG' })).toHaveAttribute(
      'href',
      'https://www.edrdg.org/wiki/index.php/KANJIDIC_Project',
    )
  })

  it('ライセンスへのリンクを描画する', () => {
    render(<KanjiDicCredit />)
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/',
    )
  })

  it('改変した旨を描画する', () => {
    render(<KanjiDicCredit />)
    expect(screen.getByText(/銘柄名に出る漢字だけに絞って書き出す改変あり/)).toBeInTheDocument()
  })
})

// CC-BY-SA-4.0 §3(a)(1)。**記事URLはここには無い** — 蔵ごとに別の記事なので
// 使用箇所(記録の詳細)にしか書けず、そちらは RecordDetail の単体テストが持つ(B78)。
describe('WikipediaCredit (蔵元の説明の CC-BY-SA)', () => {
  it('出所と執筆者を1本のリンクとして描画する', () => {
    render(<WikipediaCredit />)
    expect(screen.getByRole('link', { name: 'ウィキペディア日本語版の執筆者' })).toHaveAttribute(
      'href',
      'https://ja.wikipedia.org/',
    )
  })

  it('ライセンスへのリンクを描画する', () => {
    render(<WikipediaCredit />)
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/',
    )
  })

  // **要約や言い換えをすると Adapted Material になって継承が発生する。**
  // 「書き出しだけを抜き出した」に留めていることを画面で言う
  it('改変した旨を描画する', () => {
    render(<WikipediaCredit />)
    expect(screen.getByText(/各記事の書き出しだけを抜き出す改変あり/)).toBeInTheDocument()
  })

  // 同梱データの `copyright` 欄にも `ウィキペディア日本語版` は出る。
  // クレジットを描かなくても成果物に残る文字列を義務の証拠にしない(KANJIDIC で踏んだ形)
  it('出所の文字列が同梱データの copyright と同じ形にならない', () => {
    render(<WikipediaCredit />)
    expect(screen.queryByText('ウィキペディア日本語版')).toBeNull()
  })
})

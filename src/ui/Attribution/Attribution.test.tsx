import { render, screen } from '@testing-library/react'
import { Attribution } from './Attribution.tsx'

// さけのわデータの利用条件はクレジット表示 + https://sakenowa.com へのリンクが必須(省略は禁止事項)。
// 成果物側は scripts/check-attribution.mjs が dist を grep して守るが、
// リンクが「描画される」ことはここで守る(A12)。
//
// URL は必ず**リテラルで**書く。config から import した定数と比較すると、
// 定数を書き換えたときに期待値も一緒に動いて恒真になり、テストが永久に緑のままになる
// (実際に定数を example.invalid に変えて赤にならないことを確認して直した)。
// ライセンス義務であって設定値ではないので、ここに直接書くのが正しい。
describe('Attribution', () => {
  it('さけのわのクレジットと sakenowa.com へのリンクを描画する', () => {
    render(<Attribution />)
    expect(screen.getByText(/さけのわデータ/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'さけのわ' })).toHaveAttribute(
      'href',
      'https://sakenowa.com',
    )
  })

  it('産地マップの CC-BY クレジット(作者・タイトル・ライセンス・改変)を描画する', () => {
    render(<Attribution />)
    expect(screen.getByRole('link', { name: 'Map of Japan' })).toBeInTheDocument()
    expect(screen.getByText(/by Victor Cazanave/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    )
    expect(screen.getByText(/改変あり/)).toBeInTheDocument()
  })

  it('20歳未満の飲酒に関する表記を描画する', () => {
    render(<Attribution />)
    expect(screen.getByText(/20歳未満の飲酒は法律で禁止されています/)).toBeInTheDocument()
  })
})

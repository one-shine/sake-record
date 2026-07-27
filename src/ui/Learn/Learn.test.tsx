import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Learn } from './Learn.tsx'

// 「知る」ページ。**このテストの主目的は「記憶で書き戻される」のを止めること**。
//
// 日本酒の知識は書き手（人でも LLM でも）の記憶が強く干渉する領域で、次の2方向の書き戻しが
// 実際に起きる。どちらも画面としては自然に見えるので、目視レビューでは通ってしまう:
//
//   1. **無い要件を足す方向** … 「純米酒は精米歩合70%以下」。かつては要件だったが改正で
//      削除済み。告示 第1項の純米酒の行は精米歩合に一切触れていない
//   2. **在る定義を消す方向** … 「原酒 や 生酒 は法令に定義が無い」。特定名称の表には無いが
//      **告示 第5項の任意記載事項に定義がある**。「表に無い＝定義が無い」は誤り
//
// 期待値はすべて**リテラル**で書く。`seishuMeisho.ts` から import して比較すると、
// 表を書き換えたときに期待値も一緒に動いて恒真になる（過去に4件踏んでいる）。
// 告示の逐語は法令の文面であって設定値ではないので、ここに直接書くのが正しい。

/** 行見出しから `<tr>` を取る。`closest` は `Element | null` なので型で絞ってから返す */
function rowOf(name: string): HTMLTableRowElement {
  const header = screen.getByRole('rowheader', { name })
  const row = header.closest('tr')
  if (!(row instanceof HTMLTableRowElement)) {
    throw new Error(`行見出し「${name}」を含む tr が無い`)
  }
  return row
}

describe('Learn（知る）', () => {
  // 5タブで最も長い面（3,400px 超）なので、**内容ではなく構造**を守る。
  // 期待値はリテラルで書く（`outline.ts` から import すると、文言を変えたときに
  // 期待値も一緒に動いて恒真になる）。
  describe('構造（目次と節）', () => {
    it('目次に4つの節を、本文の見出しと同じ文字列で出す', () => {
      render(<Learn />)
      const toc = screen.getByRole('navigation', { name: 'このページの構成' })

      for (const title of [
        'このアプリの数え方',
        '特定名称の8種類',
        'スペック欄の11語はどこから来た語か',
        '出典とライセンス',
      ]) {
        expect(within(toc).getByRole('button', { name: title })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
      }
    })

    // 目次に「どの節に何が入っているか」まで出ていること。これが構造化の実体で、
    // 節の題だけでは10個の小見出しがどこにあるのか分からない
    it.each([
      'スタイル分布（統計タブ）',
      '紐付けの状態（記録タブ）',
      'フレーバー6軸（味タブ）',
      '味タグ（記録タブの絞り込み）',
      '8種の要件',
      '表の語の定義',
      'さけのわデータ',
      '産地マップ',
      '端末内 OCR（tesseract.js）',
      '国税庁の告示',
    ])('小見出し「%s」を目次と本文の両方に同じ文字列で出す', (title) => {
      render(<Learn />)
      const toc = screen.getByRole('navigation', { name: 'このページの構成' })

      expect(within(toc).getByText(title)).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    })

    // ★ 送り先に**着く**こと。jsdom はレイアウトを持たないのでスクロールは観測できないが、
    // フォーカスは観測できる（実装もフォーカスを移す = キーボードと読み上げの位置が付いてくる）。
    // **`scrollIntoView` はこの jsdom に定義が無い**ので、optional call をやめるとここが
    // TypeError で落ちる（実ブラウザでだけ動く書き方を CI で捕まえる）
    it('目次の項目を押すとその節の見出しへフォーカスが移る', async () => {
      const user = userEvent.setup()
      render(<Learn />)
      const toc = screen.getByRole('navigation', { name: 'このページの構成' })

      await user.click(within(toc).getByRole('button', { name: '出典とライセンス' }))

      expect(screen.getByRole('heading', { name: '出典とライセンス' })).toHaveFocus()
    })

    it('節の末尾から目次へ戻れる（長い節を読み終えた位置から次を選べる）', async () => {
      const user = userEvent.setup()
      render(<Learn />)

      const backs = screen.getAllByRole('button', { name: '目次へ戻る' })
      expect(backs).toHaveLength(4)

      const last = backs[3]
      if (last === undefined) throw new Error('「目次へ戻る」が4つ無い')
      await user.click(last)

      expect(screen.getByRole('navigation', { name: 'このページの構成' })).toHaveFocus()
    })

    // 節番号は目次と本文の対応を示す飾りなので、読み上げとアクセシブル名から外す
    // （名前が「1 このアプリの数え方」になると目次に出る文字列とずれる）
    it('節番号を見出しのアクセシブル名に入れない', () => {
      render(<Learn />)

      expect(screen.getByRole('heading', { name: 'このアプリの数え方' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /^1/ })).toBeNull()
    })
  })

  describe('特定名称の8種類', () => {
    // 8行そろっていること。1行でも落ちると「その名称は存在しない」に見える
    it.each([
      '吟醸酒',
      '大吟醸酒',
      '純米酒',
      '純米吟醸酒',
      '純米大吟醸酒',
      '特別純米酒',
      '本醸造酒',
      '特別本醸造酒',
    ])('%s の行を描画する', (name) => {
      render(<Learn />)
      expect(screen.getByRole('rowheader', { name })).toBeInTheDocument()
    })

    it('5列の見出し（特定名称・使用原料・精米歩合・こうじ米使用割合・香味等の要件）を描画する', () => {
      render(<Learn />)
      for (const head of ['特定名称', '使用原料', '精米歩合', 'こうじ米使用割合', '香味等の要件']) {
        expect(screen.getByRole('columnheader', { name: head })).toBeInTheDocument()
      }
    })

    // ★★ 回帰の本体。純米酒に精米歩合の要件は無い(改正で削除)。`−` は U+2212。
    // 「70%以下」と書き戻されたらここで落ちる
    it('純米酒の行は精米歩合が「−」で、70% を出さない', () => {
      render(<Learn />)
      const row = rowOf('純米酒')

      expect(row.textContent).toContain('−')
      expect(row.textContent).not.toContain('70%')
    })

    it('本醸造酒の行は精米歩合 70%以下 を出す（上の検査が「70% を消しただけ」で通らないこと）', () => {
      render(<Learn />)
      expect(rowOf('本醸造酒').textContent).toContain('70%以下')
    })

    it('「−」が要件の不在を意味することを本文で説明する（未確認と読ませない）', () => {
      render(<Learn />)
      expect(screen.getByText(/要件が無いことを示す/)).toBeInTheDocument()
      expect(screen.getByText(/改正で削除された/)).toBeInTheDocument()
    })

    it('こうじ米使用割合 15%以上 を8行すべてに出す', () => {
      render(<Learn />)
      for (const name of [
        '吟醸酒',
        '大吟醸酒',
        '純米酒',
        '純米吟醸酒',
        '純米大吟醸酒',
        '特別純米酒',
        '本醸造酒',
        '特別本醸造酒',
      ]) {
        expect(rowOf(name).textContent).toContain('15%以上')
      }
    })

    // 表のセルは短縮形なので、セルだけでは何を測っているのか分からない。定義が併記されること
    it('表の語（精米歩合・吟醸造り）の定義を出す', () => {
      render(<Learn />)
      // 「精米歩合」は表の列見出しにも出るので、定義リスト側(`dt`)を selector で指名する
      expect(screen.getByText('精米歩合', { selector: 'dt' })).toBeInTheDocument()
      expect(screen.getByText(/白米のその玄米に対する重量の割合/)).toBeInTheDocument()
      expect(screen.getByText('吟醸造り', { selector: 'dt' })).toBeInTheDocument()
      expect(screen.getByText(/低温でゆっくり発酵させ/)).toBeInTheDocument()
    })

    // 手写しなので取得日が唯一の誠実な扱い。日付が消えたら「いつ時点の法令か」が分からなくなる。
    // 取得日は**出典リンクと同じ段落**に出す(離すと、どちらの日付なのか読者が決められない)
    it('国税庁の出典2本を、取得日と同じ段落に出す', () => {
      render(<Learn />)
      const kokuji = screen.getByRole('link', { name: '清酒の製法品質表示基準を定める件' })
      const gaiyo = screen.getByRole('link', { name: '「清酒の製法品質表示基準」の概要' })

      expect(kokuji).toHaveAttribute(
        'href',
        'https://www.nta.go.jp/taxes/sake/hyoji/seishu/kokuji891122/03.htm',
      )
      expect(gaiyo).toHaveAttribute(
        'href',
        'https://www.nta.go.jp/taxes/sake/hyoji/seishu/gaiyo/02.htm',
      )
      expect(kokuji.parentElement?.textContent).toContain('2026-07-26 取得')
    })
  })

  describe('スペック欄の11語の出所（3値）', () => {
    it('11語すべてを行として描画する', () => {
      render(<Learn />)
      for (const term of [
        '純米大吟醸',
        '大吟醸',
        '純米吟醸',
        '純米',
        '本醸造',
        '生原酒',
        '無濾過',
        '原酒',
        'ひやおろし',
        'しぼりたて',
        'にごり',
      ]) {
        expect(screen.getByRole('rowheader', { name: term })).toBeInTheDocument()
      }
    })

    // ★★ 逆向きの回帰。「原酒 は法令に定義が無い」と書き戻されたらここで落ちる。
    // 定義は告示 第5項(4) の任意記載事項にあり、特定名称の表に無いこととは無関係
    it('原酒に告示の定義（第5項の任意記載事項）を付ける', () => {
      render(<Learn />)
      const row = rowOf('原酒')

      expect(row.textContent).toContain('告示（任意記載事項）')
      expect(row.textContent).toContain('製成後、加水調整')
      expect(row.textContent).toContain('をしない清酒である場合に表示できる')
    })

    it('特定名称の5語は出所を「告示（特定名称）」として上の表へ送る', () => {
      render(<Learn />)
      for (const term of ['純米大吟醸', '大吟醸', '純米吟醸', '純米', '本醸造']) {
        expect(rowOf(term).textContent).toContain('告示（特定名称）')
      }
      // 語に「酒」が付かないこと(11語)と付くこと(名称)の対応を示している
      expect(rowOf('純米').textContent).toContain('純米酒')
      expect(rowOf('大吟醸').textContent).toContain('大吟醸酒')
    })

    // 「生原酒」という語自体は告示に無い。特定名称と同じ扱いにしないこと
    it('生原酒は「告示の要件の組み合わせ」として扱い、告示の用語だと書かない', () => {
      render(<Learn />)
      const row = rowOf('生原酒')

      expect(row.textContent).toContain('告示の要件の組み合わせ')
      expect(row.textContent).toContain('「生原酒」という語そのものは告示に無い')
      expect(row.textContent).not.toContain('告示（特定名称）')
    })

    // ★ 定義を確認できていない語に定義文を書かない。推測で埋めるのは
    // `unlinked` に推定値を入れるのと同じ間違い
    it.each(['無濾過', 'ひやおろし', 'しぼりたて', 'にごり'])(
      '%s は「確認できていない」とだけ書き、定義文を付けない',
      (term) => {
        render(<Learn />)
        const row = rowOf(term)

        expect(row.textContent).toContain('確認できていない')
        // 告示由来の定義文に必ず出る言い回し。混入したら定義を書いてしまっている
        expect(row.textContent).not.toContain('表示できる')
        expect(row.textContent).not.toContain('要件')
        expect(row.textContent).not.toContain('精米歩合')
      },
    )

    // 第3の状態。法令の表の隣に出所なしで並べると、アプリ独自の規則が法令由来に見える
    it('部分一致・重複計上・スペック欄だけがアプリのルールであることを明示する', () => {
      render(<Learn />)
      expect(screen.getByText(/どの法令にも書いていない/)).toBeInTheDocument()
      expect(screen.getByText(/すべてこのアプリが決めたルール/)).toBeInTheDocument()
    })
  })

  describe('このアプリの数え方', () => {
    // 5値のラベルはリテラルで書く。`LINK_STATUS_BADGES` から作ると綴りが何であれ一致して恒真になる
    it.each(['自動', '別名', '手動', '未紐付け', '銘柄不明'])(
      '紐付けの状態「%s」を凡例に出す',
      (label) => {
        render(<Learn />)
        const badge = screen.getByText(label)

        expect(badge).toBeInTheDocument()
        // 対応表(`LINK_STATUS_BADGES`)の help が title に入る = 凡例が実物のバッジで描かれている
        expect(badge).toHaveAttribute('title')
      },
    )

    it.each(['華やか', '芳醇', '重厚', '穏やか', 'ドライ', '軽快'])(
      'フレーバー6軸のラベル「%s」を出す',
      (label) => {
        render(<Learn />)
        expect(screen.getByText(label)).toBeInTheDocument()
      },
    )

    it('6軸が 0〜100 の整数で、銘柄に紐づく値（本人の評価ではない）と書く', () => {
      render(<Learn />)
      expect(screen.getByText(/0〜100 の整数/)).toBeInTheDocument()
      expect(screen.getByText(/銘柄に紐づく値で、自分の評価ではない/)).toBeInTheDocument()
    })

    it('6軸の分母がフレーバー取得済みであって紐付け済みではないと書く', () => {
      render(<Learn />)
      expect(screen.getByText(/「フレーバー取得済み」の本数/)).toBeInTheDocument()
    })

    it('スタイル分布の規則（スペック欄だけ・部分一致・重複計上・備考は数えない）を書く', () => {
      render(<Learn />)
      expect(screen.getByText(/備考（メモ）は数えない/)).toBeInTheDocument()
      // 完全一致で強調語だけを取る。正規表現にすると節3の帯(「部分一致で判定すること」)にも当たる
      expect(screen.getByText('部分一致')).toBeInTheDocument()
      expect(screen.getByText(/表記ゆれを吸収する処理/)).toBeInTheDocument()
      expect(screen.getByText('複数の語に重複計上する')).toBeInTheDocument()
      expect(screen.getByText(/延べ本数は総本数を超える/)).toBeInTheDocument()
    })

    // ★ 味タグの偽陰性。「タグが無い＝その味がない」と読まれるのが一番害が大きい
    it('味タグが銘柄あたり20語で打ち切られていること（と、その根拠の段差）を書く', () => {
      render(<Learn />)
      expect(
        screen.getByText(/タグが無いことは「その味がない」ことを意味しない/),
      ).toBeInTheDocument()
      expect(screen.getByText(/20語ちょうどの銘柄が2,136件中731件（34%）/)).toBeInTheDocument()
      expect(screen.getByText(/19語の銘柄は16件しかない/)).toBeInTheDocument()
    })

    it('味タグの上位語がほとんど絞り込めないことを割合付きで書く', () => {
      render(<Learn />)
      expect(screen.getByText(/上位5語はどれも半分以上の銘柄に付く/)).toBeInTheDocument()
    })
  })

  describe('出典とライセンス', () => {
    it('さけのわのクレジットと sakenowa.com へのリンクを出す', () => {
      render(<Learn />)
      expect(screen.getByRole('link', { name: 'さけのわ' })).toHaveAttribute(
        'href',
        'https://sakenowa.com',
      )
      expect(screen.getByRole('link', { name: 'さけのわデータ' })).toHaveAttribute(
        'href',
        'https://muro.sakenowa.com/sakenowa-data/',
      )
    })

    // CC-BY-4.0 §3(a)(1) の4項目。**1つでも欠けたら義務違反**なので個別に見る。
    // 描画は `MapCredit` に委ねているので、ここは「この画面に届いているか」を見ている
    it('産地マップの CC-BY 4項目（タイトル・作者・ライセンス・改変）を出す', () => {
      render(<Learn />)
      expect(screen.getByText(/Map of Japan/)).toBeInTheDocument()
      expect(screen.getByText(/Victor Cazanave/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
        'href',
        'https://creativecommons.org/licenses/by/4.0/',
      )
      expect(screen.getByText(/改変あり/)).toBeInTheDocument()
    })

    it('tesseract.js の Apache-2.0 を、表示義務が無いことと併せて出す', () => {
      render(<Learn />)
      expect(screen.getByText(/Apache-2.0。/)).toBeInTheDocument()
      expect(screen.getByText(/画面での表示義務は無い/)).toBeInTheDocument()
    })

    it('法令が著作権の目的とならないことに触れつつ出典を書く', () => {
      render(<Learn />)
      expect(screen.getByText(/著作権法13条/)).toBeInTheDocument()
    })
  })

  describe('載せないもの', () => {
    // 利用者の決定。法的義務の根拠が文書上どこにも無く、フッタからも外した
    it('20歳未満の飲酒に関する表記を出さない', () => {
      render(<Learn />)
      expect(screen.queryByText(/20歳未満/)).toBeNull()
    })

    // 出典の無い一般論を同じページに置かない、という線引きを画面に書いておく
    it('このページの範囲（一般論を載せない理由）を最初に書く', () => {
      render(<Learn />)
      expect(screen.getByRole('heading', { name: 'このページの範囲' })).toBeInTheDocument()
      expect(screen.getByText(/出典を持たない一般論を混ぜると/)).toBeInTheDocument()
    })
  })
})

import { render, screen } from '@testing-library/react'
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
//
// ## 下位タブ（2026-07-27〜）
//
// 内容は5つの下位タブに分かれ、**開いているタブのぶんしか DOM に無い**。
// 各 describe は `openTab()` で自分のタブを開いてから見る。既定は「数え方」。

/** 下位タブを開く。タブ帯のラベルは `outline.ts` の `tab` */
async function openTab(label: string) {
  const user = userEvent.setup()
  render(<Learn />)
  await user.click(screen.getByRole('tab', { name: label }))
  return user
}

/** 行見出しから `<tr>` を取る。`closest` は `Element | null` なので型で絞ってから返す */
function rowOf(name: string): HTMLTableRowElement {
  const header = screen.getByRole('rowheader', { name })
  const row = header.closest('tr')
  if (!(row instanceof HTMLTableRowElement)) {
    throw new Error(`行見出し「${name}」を含む tr が無い`)
  }
  return row
}

/** 11語の1行（表ではなく `dt` + `dd` の積み）。語の `dt` を含む `div` を返す */
function styleTermRow(term: string): HTMLElement {
  const label = screen.getByText(term, { selector: 'dt > span' })
  const row = label.closest('div')
  if (row === null) throw new Error(`語「${term}」の行が無い`)
  return row
}

describe('Learn（知る）', () => {
  describe('下位タブ', () => {
    it('5つのタブを出し、既定は「数え方」が開いている', () => {
      render(<Learn />)
      const tabs = screen.getAllByRole('tab')

      expect(tabs.map((tab) => tab.textContent)).toEqual(['数え方', '味', '産地', '名称', '出典'])
      expect(screen.getByRole('tab', { name: '数え方', selected: true })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'このアプリの数え方' })).toBeInTheDocument()
    })

    // ★ 分割の本体。開いていないタブの中身は DOM に無い（= 1画面に1トピック）
    it('開いていないタブの中身は出さない', () => {
      render(<Learn />)

      expect(screen.queryByRole('heading', { name: '出典とライセンス' })).toBeNull()
      expect(screen.queryByText(/Victor Cazanave/)).toBeNull()
      expect(screen.queryByRole('heading', { name: '産地の見方' })).toBeNull()
    })

    it('タブを押すとそのタブの中身に入れ替わる', async () => {
      await openTab('産地')

      expect(screen.getByRole('heading', { name: '産地の見方' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'このアプリの数え方' })).toBeNull()
    })

    // フッタの「出典とライセンス」から来たときに出典タブで開く経路（App が渡す）
    it('initialPanel を渡すとそのタブで開く', () => {
      render(<Learn initialPanel="sources" />)

      expect(screen.getByRole('tab', { name: '出典', selected: true })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '出典とライセンス' })).toBeInTheDocument()
    })

    it('左右キーで隣のタブへ移る', async () => {
      const user = userEvent.setup()
      render(<Learn />)
      const first = screen.getByRole('tab', { name: '数え方' })
      first.focus()

      await user.keyboard('{ArrowRight}')

      expect(screen.getByRole('tab', { name: '味', selected: true })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '味の見方' })).toBeInTheDocument()
    })

    // どのタブでも、この面が何を載せない面なのかは読める
    it('このページの範囲（一般論を載せない理由）をどのタブでも出す', async () => {
      render(<Learn />)
      expect(screen.getByText(/出典を持たない一般論を混ぜると/)).toBeInTheDocument()

      const user = userEvent.setup()
      await user.click(screen.getByRole('tab', { name: '名称' }))
      expect(screen.getByText(/出典を持たない一般論を混ぜると/)).toBeInTheDocument()
    })
  })

  describe('特定名称の8種類（名称タブ）', () => {
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
    ])('%s の行を描画する', async (name) => {
      await openTab('名称')
      expect(screen.getByRole('rowheader', { name })).toBeInTheDocument()
    })

    it('5列の見出し（特定名称・使用原料・精米歩合・こうじ米使用割合・香味等の要件）を描画する', async () => {
      await openTab('名称')
      for (const head of ['特定名称', '使用原料', '精米歩合', 'こうじ米使用割合', '香味等の要件']) {
        expect(screen.getByRole('columnheader', { name: head })).toBeInTheDocument()
      }
    })

    // ★★ 回帰の本体。純米酒に精米歩合の要件は無い(改正で削除)。`−` は U+2212。
    // 「70%以下」と書き戻されたらここで落ちる
    it('純米酒の行は精米歩合が「−」で、70% を出さない', async () => {
      await openTab('名称')
      const row = rowOf('純米酒')

      expect(row.textContent).toContain('−')
      expect(row.textContent).not.toContain('70%')
    })

    it('本醸造酒の行は精米歩合 70%以下 を出す（上の検査が「70% を消しただけ」で通らないこと）', async () => {
      await openTab('名称')
      expect(rowOf('本醸造酒').textContent).toContain('70%以下')
    })

    it('「−」が要件の不在を意味することを本文で説明する（未確認と読ませない）', async () => {
      await openTab('名称')
      expect(screen.getByText(/要件が無いことを示す/)).toBeInTheDocument()
      expect(screen.getByText(/改正で削除された/)).toBeInTheDocument()
    })

    it('こうじ米使用割合 15%以上 を8行すべてに出す', async () => {
      await openTab('名称')
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
    it('表の語（精米歩合・吟醸造り）の定義を出す', async () => {
      await openTab('名称')
      // 「精米歩合」は表の列見出しにも出るので、定義リスト側(`dt`)を selector で指名する
      expect(screen.getByText('精米歩合', { selector: 'dt' })).toBeInTheDocument()
      expect(screen.getByText(/白米のその玄米に対する重量の割合/)).toBeInTheDocument()
      expect(screen.getByText('吟醸造り', { selector: 'dt' })).toBeInTheDocument()
      expect(screen.getByText(/低温でゆっくり発酵させ/)).toBeInTheDocument()
    })

    // 手写しなので取得日が唯一の誠実な扱い。日付が消えたら「いつ時点の法令か」が分からなくなる。
    // 取得日は**出典リンクと同じ段落**に出す(離すと、どちらの日付なのか読者が決められない)
    it('国税庁の出典2本を、取得日と同じ段落に出す', async () => {
      await openTab('名称')
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

  describe('スペック欄の11語の出所（3値。名称タブ）', () => {
    it('11語すべてを行として描画する', async () => {
      await openTab('名称')
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
        expect(styleTermRow(term)).toBeInTheDocument()
      }
    })

    // ★★ 逆向きの回帰。「原酒 は法令に定義が無い」と書き戻されたらここで落ちる。
    // 定義は告示 第5項(4) の任意記載事項にあり、特定名称の表に無いこととは無関係
    it('原酒に告示の定義（第5項の任意記載事項）を付ける', async () => {
      await openTab('名称')
      const row = styleTermRow('原酒')

      expect(row.textContent).toContain('告示（任意記載事項）')
      expect(row.textContent).toContain('製成後、加水調整')
      expect(row.textContent).toContain('をしない清酒である場合に表示できる')
    })

    it('特定名称の5語は出所を「告示（特定名称）」として上の表へ送る', async () => {
      await openTab('名称')
      for (const term of ['純米大吟醸', '大吟醸', '純米吟醸', '純米', '本醸造']) {
        expect(styleTermRow(term).textContent).toContain('告示（特定名称）')
      }
      // 語に「酒」が付かないこと(11語)と付くこと(名称)の対応を示している
      expect(styleTermRow('純米').textContent).toContain('純米酒')
      expect(styleTermRow('大吟醸').textContent).toContain('大吟醸酒')
    })

    // 「生原酒」という語自体は告示に無い。特定名称と同じ扱いにしないこと
    it('生原酒は「告示の要件の組み合わせ」として扱い、告示の用語だと書かない', async () => {
      await openTab('名称')
      const row = styleTermRow('生原酒')

      expect(row.textContent).toContain('告示の要件の組み合わせ')
      expect(row.textContent).toContain('「生原酒」という語そのものは告示に無い')
      expect(row.textContent).not.toContain('告示（特定名称）')
    })

    // ★ 定義を確認できていない語に定義文を書かない。推測で埋めるのは
    // `unlinked` に推定値を入れるのと同じ間違い
    it.each(['無濾過', 'ひやおろし', 'しぼりたて', 'にごり'])(
      '%s は「確認できていない」とだけ書き、定義文を付けない',
      async (term) => {
        await openTab('名称')
        const row = styleTermRow(term)

        expect(row.textContent).toContain('確認できていない')
        // 告示由来の定義文に必ず出る言い回し。混入したら定義を書いてしまっている
        expect(row.textContent).not.toContain('表示できる')
        expect(row.textContent).not.toContain('要件')
        expect(row.textContent).not.toContain('精米歩合')
      },
    )

    // 第3の状態。法令の表の隣に出所なしで並べると、アプリ独自の規則が法令由来に見える
    it('部分一致・重複計上・スペック欄だけがアプリのルールであることを明示する', async () => {
      await openTab('名称')
      expect(screen.getByText(/どの法令にも書いていない/)).toBeInTheDocument()
      expect(screen.getByText(/すべてこのアプリが決めたルール/)).toBeInTheDocument()
    })
  })

  describe('このアプリの数え方（数え方タブ）', () => {
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

    it('スタイル分布の規則（スペック欄だけ・部分一致・重複計上・備考は数えない）を書く', () => {
      render(<Learn />)
      expect(screen.getByText(/備考（メモ）は数えない/)).toBeInTheDocument()
      expect(screen.getByText('部分一致')).toBeInTheDocument()
      expect(screen.getByText(/表記ゆれを吸収する処理/)).toBeInTheDocument()
      expect(screen.getByText('複数の語に重複計上する')).toBeInTheDocument()
      expect(screen.getByText(/延べ本数は総本数を超える/)).toBeInTheDocument()
    })
  })

  describe('味の見方（味タブ）', () => {
    it.each(['華やか', '芳醇', '重厚', '穏やか', 'ドライ', '軽快'])(
      'フレーバー6軸のラベル「%s」を軸の配置図に出す',
      async (label) => {
        await openTab('味')
        expect(screen.getByText(label)).toBeInTheDocument()
      },
    )

    // ★ 図に架空の値を描かない。このページは「推定で埋めた値は無い」と書いている面なので、
    // 説明のための多角形が1つでも混ざると、実データに見える図が同じ画面に並ぶ
    it('軸の配置図に値を描かない（枠と軸線とラベルだけ）', async () => {
      await openTab('味')
      const figure = screen.getByTitle(/6軸の並び/)

      // 枠は1つ(値100の六角形)。データの多角形が増えると2つ以上になる
      expect(figure.parentElement?.querySelectorAll('polygon')).toHaveLength(1)
      expect(screen.getByText(/値そのものは描いていない/)).toBeInTheDocument()
    })

    it('6軸が 0〜100 の整数で、銘柄に紐づく値（本人の評価ではない）と書く', async () => {
      await openTab('味')
      expect(screen.getByText(/0〜100 の整数/)).toBeInTheDocument()
      expect(screen.getByText(/銘柄に紐づく値で、自分の評価ではない/)).toBeInTheDocument()
    })

    it('6軸の分母がフレーバー取得済みであって紐付け済みではないと書く', async () => {
      await openTab('味')
      expect(screen.getByText(/「フレーバー取得済み」の本数/)).toBeInTheDocument()
    })

    // ★ 味タグの偽陰性。「タグが無い＝その味がない」と読まれるのが一番害が大きい
    it('味タグが銘柄あたり20語で打ち切られていること（と、その根拠の段差）を書く', async () => {
      await openTab('味')
      expect(
        screen.getByText(/タグが無いことは「その味がない」ことを意味しない/),
      ).toBeInTheDocument()
      expect(screen.getByText(/20語ちょうどの銘柄が2,136件中731件/)).toBeInTheDocument()
      expect(screen.getByText(/19語の銘柄は16件しかない/)).toBeInTheDocument()
    })

    it('上位5語を割合つきで並べる（押しても絞れないことが棒で見える）', async () => {
      await openTab('味')
      // 語と割合が**同じ行に**あることを見る（`酸味` は下の味覚のチップにも出るので、
      // 素の getByText だと2件見つかる = 行の対応を見ていないことになる）
      for (const [tag, percent] of [
        ['甘味', '59%'],
        ['旨味', '58%'],
        ['酸味', '56%'],
        ['辛口', '53%'],
        ['スッキリ', '51%'],
      ]) {
        const row = screen.getByText(percent).closest('li')
        expect(row?.textContent).toContain(tag)
      }
      expect(screen.getByText(/どれも半分以上に付くので、選んでもほとんど絞れない/)).toBeInTheDocument()
    })

    // 「味タグという名前だが味ではない語が混ざる」を文章だけで言わず、実物の語で見せる
    it('語の種類ごとに実物の語を並べ、網羅ではないと断る', async () => {
      await openTab('味')
      for (const kind of ['味覚', '口当たり', '食べ物・飲み物の比喩', '温度帯', '飲む速さ']) {
        expect(screen.getByText(kind)).toBeInTheDocument()
      }
      for (const tag of ['セメダイン', '燗冷まし', 'ゴクゴク', 'とろみ']) {
        expect(screen.getByText(tag)).toBeInTheDocument()
      }
      expect(screen.getByText(/網羅ではない/)).toBeInTheDocument()
    })
  })

  describe('産地の見方（産地タブ）', () => {
    // ★ 一番誤解されるところ。県は蔵元の所在地であって、酒米の産地でも飲んだ場所でもない
    it('県が蔵元の所在地であることと、酒米の産地・飲んだ場所ではないことを書く', async () => {
      await openTab('産地')

      expect(screen.getByText(/蔵元の所在地であって、酒米の産地ではない/)).toBeInTheDocument()
      expect(screen.getByText(/飲んだ場所でもない/)).toBeInTheDocument()
    })

    // 凡例は `FILL_STEPS` を走査して描く。ラベルはリテラルで固定する（表から作ると恒真）
    it.each(['未進出（0本）', '1〜2本', '3〜5本', '6〜10本', '11本以上'])(
      '塗り分けの段「%s」を凡例に出す',
      async (label) => {
        await openTab('産地')
        expect(screen.getByText(label)).toBeInTheDocument()
      },
    )

    it('多いほど濃いこと・未進出だけ色味を持たないことを書く', async () => {
      await openTab('産地')

      expect(screen.getByText('多いほど濃い')).toBeInTheDocument()
      expect(screen.getByText(/未進出（0本）だけ色味を持たない/)).toBeInTheDocument()
    })

    // 地図に載らない記録を丸めない、という規律（`unlinked` に推定値を埋めないのと同じ）
    it('県が決まらない記録を近い県に丸めず件数で残すと書く', async () => {
      await openTab('産地')

      expect(screen.getByText(/近い県に丸めたり、多いほうの県に寄せたりはしない/)).toBeInTheDocument()
      expect(screen.getByText(/足すと全本数になる/)).toBeInTheDocument()
    })
  })

  describe('出典とライセンス（出典タブ）', () => {
    it('さけのわのクレジットと sakenowa.com へのリンクを出す', async () => {
      await openTab('出典')
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
    // 描画は `MapCredit` に委ねているので、ここは「この画面に届いているか」を見ている。
    // **使用箇所（産地タブ）の併記は `AreaMap.test.tsx` が別に守っている**ので、
    // この面が下位タブに畳まれても義務の検査は落ちない（B58 の分担）
    it('産地マップの CC-BY 4項目（タイトル・作者・ライセンス・改変）を出す', async () => {
      await openTab('出典')
      expect(screen.getByText(/Map of Japan/)).toBeInTheDocument()
      expect(screen.getByText(/Victor Cazanave/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
        'href',
        'https://creativecommons.org/licenses/by/4.0/',
      )
      expect(screen.getByText(/改変あり/)).toBeInTheDocument()
    })

    it('tesseract.js の Apache-2.0 を、表示義務が無いことと併せて出す', async () => {
      await openTab('出典')
      expect(screen.getByText(/Apache-2.0。/)).toBeInTheDocument()
      expect(screen.getByText(/画面での表示義務は無い/)).toBeInTheDocument()
    })

    it('法令が著作権の目的とならないことに触れつつ出典を書く', async () => {
      await openTab('出典')
      expect(screen.getByText(/著作権法13条/)).toBeInTheDocument()
    })
  })

  describe('載せないもの', () => {
    // 利用者の決定。法的義務の根拠が文書上どこにも無く、フッタからも外した
    it('20歳未満の飲酒に関する表記を出さない', () => {
      render(<Learn />)
      expect(screen.queryByText(/20歳未満/)).toBeNull()
    })
  })
})

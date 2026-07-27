import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Learn } from './Learn.tsx'

// 「知る」ページ。**このテストの主目的は2つ**。
//
// ## 1. 特定名称8種の表が記憶で書き戻されるのを止める
//
// この表だけは国税庁の告示から写した値で、ここが狂うと画面の意味が変わる。書き手（人でも
// LLM でも）の記憶が最も強く干渉するのが**純米酒の精米歩合**で、「70%以下」と書き戻される。
// かつては要件だったが改正で削除済み。期待値は**リテラル**で書く（`seishuMeisho.ts` から
// import して比較すると、表を書き換えたときに期待値も一緒に動いて恒真になる）。
//
// ## 2. 下位タブに割った構造を守る
//
// 内容は6つの下位タブに分かれ、**開いているタブのぶんしか DOM に無い**。
// 各 describe は `openTab()` で自分のタブを開いてから見る。既定は「数え方」。
//
// **2026-07-27 に方針が変わった**: 出所の3値バッジ・「確認できていない」の断り・慣習の印を
// 外した（私用のアプリで法令上の厳密さを求めない、という利用者の判断）。それらを固定していた
// テストも一緒に外してある。**残したのは「事実として誤っていたら困るもの」だけ**。

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

/**
 * 小見出しの節を取る。**同じ語が2つの節に出る**（`ひやおろし` は11語の表にも季節の節にも
 * 出る）ので、素の `getByText` では取り違える
 */
function sectionOf(subId: string): HTMLElement {
  const heading = document.getElementById(`learn-${subId}`)
  const section = heading?.parentElement
  if (!(section instanceof HTMLElement)) throw new Error(`節「${subId}」が無い`)
  return section
}

/** 語の行（`dt` + `dd` の積み）を、指定した節の中から取る */
function termRow(subId: string, term: string): HTMLElement {
  const label = within(sectionOf(subId)).getByText(term, { selector: 'dt' })
  const row = label.closest('div')
  if (row === null) throw new Error(`語「${term}」の行が無い`)
  return row
}

/** 11語の1行（説明の積み） */
function specTermRow(term: string): HTMLElement {
  return termRow('label-terms', term)
}

describe('Learn（知る）', () => {
  describe('下位タブ', () => {
    it('6つのタブを出し、既定は「種類」が開いている', () => {
      render(<Learn />)
      const tabs = screen.getAllByRole('tab')

      expect(tabs.map((tab) => tab.textContent)).toEqual([
        '種類',
        'ラベル',
        '季節',
        '産地',
        '味',
        'アプリ',
      ])
      expect(screen.getByRole('tab', { name: '種類', selected: true })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '日本酒の種類' })).toBeInTheDocument()
    })

    // ★ 分割の本体。開いていないタブの中身は DOM に無い（= 1画面に1トピック）
    it('開いていないタブの中身は出さない', () => {
      render(<Learn />)

      expect(screen.queryByRole('heading', { name: 'このアプリについて' })).toBeNull()
      expect(screen.queryByText(/Victor Cazanave/)).toBeNull()
      expect(screen.queryByRole('heading', { name: '産地' })).toBeNull()
    })

    it('タブを押すとそのタブの中身に入れ替わる', async () => {
      await openTab('産地')

      expect(screen.getByRole('heading', { name: '産地' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: '日本酒の種類' })).toBeNull()
    })

    // フッタの「出典とライセンス」から来たときに出典タブで開く経路（App が渡す）
    it('initialPanel を渡すとそのタブで開く', () => {
      render(<Learn initialPanel="app" />)

      expect(screen.getByRole('tab', { name: 'アプリ', selected: true })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'このアプリについて' })).toBeInTheDocument()
    })

    it('左右キーで隣のタブへ移る', async () => {
      const user = userEvent.setup()
      render(<Learn />)
      const first = screen.getByRole('tab', { name: '種類' })
      first.focus()

      await user.keyboard('{ArrowRight}')

      expect(screen.getByRole('tab', { name: 'ラベル', selected: true })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'ラベルの読み方' })).toBeInTheDocument()
    })

    // どのタブでも、この面が何の面なのかは読める
    it('この画面が何をまとめた面なのかをどのタブでも出す', async () => {
      render(<Learn />)
      expect(screen.getByText(/日本酒の語と、この画面に出る数字をまとめたもの/)).toBeInTheDocument()

      const user = userEvent.setup()
      await user.click(screen.getByRole('tab', { name: 'ラベル' }))
      expect(screen.getByText(/日本酒の語と、この画面に出る数字をまとめたもの/)).toBeInTheDocument()
    })
  })

  describe('特定名称の8種類（種類タブ）', () => {
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
      await openTab('種類')
      expect(screen.getByRole('rowheader', { name })).toBeInTheDocument()
    })

    it('5列の見出し（特定名称・使用原料・精米歩合・こうじ米使用割合・香味等の要件）を描画する', async () => {
      await openTab('種類')
      for (const head of ['特定名称', '使用原料', '精米歩合', 'こうじ米使用割合', '香味等の要件']) {
        expect(screen.getByRole('columnheader', { name: head })).toBeInTheDocument()
      }
    })

    // ★★ 回帰の本体。純米酒に精米歩合の要件は無い(改正で削除)。`−` は U+2212。
    // 「70%以下」と書き戻されたらここで落ちる
    it('純米酒の行は精米歩合が「−」で、70% を出さない', async () => {
      await openTab('種類')
      const row = rowOf('純米酒')

      expect(row.textContent).toContain('−')
      expect(row.textContent).not.toContain('70%')
    })

    it('本醸造酒の行は精米歩合 70%以下 を出す（上の検査が「70% を消しただけ」で通らないこと）', async () => {
      await openTab('種類')
      expect(rowOf('本醸造酒').textContent).toContain('70%以下')
    })

    // 記号の凡例が無いと `−` が「調べていない」と読める
    it('「−」が条件の不在を意味することを本文で説明する', async () => {
      await openTab('種類')
      expect(screen.getByText(/条件が無いという意味/)).toBeInTheDocument()
      expect(screen.getByText(/純米酒に精米歩合の決まりは無い/)).toBeInTheDocument()
    })

    it('こうじ米使用割合 15%以上 を8行すべてに出す', async () => {
      await openTab('種類')
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
    it('表の語（精米歩合・吟醸造り）の定義を表と同じ節に出す', async () => {
      await openTab('種類')
      const section = within(sectionOf('types-meisho'))

      expect(section.getByText('精米歩合', { selector: 'dt' })).toBeInTheDocument()
      expect(section.getByText(/白米のその玄米に対する重量の割合/)).toBeInTheDocument()
      expect(section.getByText('吟醸造り', { selector: 'dt' })).toBeInTheDocument()
      // 「低温でゆっくり発酵させ」はラベルの語（大吟醸）の説明にも出るので節で絞る
      expect(section.getByText(/低温でゆっくり発酵させ、かすの割合/)).toBeInTheDocument()
    })

    // 手写しなので取得日が唯一の誠実な扱い。日付が消えたら「いつ時点の表か」が分からなくなる。
    // 取得日は**出典リンクと同じ段落**に出す(離すと、どちらの日付なのか読者が決められない)
    it('国税庁の出典2本を、取得日と同じ段落に出す（出典タブ）', async () => {
      await openTab('アプリ')
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

  describe('ラベルの語（ラベルタブ）', () => {
    // 11語は統計が数える語彙そのもの。**説明の無い語が画面に出ない**ことを見る
    // （`SPEC_TERM_NOTES` は `Record<StyleTerm, string>` なので足し忘れは型で止まるが、
    //  描画側が一部しか回さない書き方に変わると型では捕まらない）
    it.each([
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
    ])('11語の「%s」を説明つきで出す', async (term) => {
      await openTab('ラベル')
      const row = specTermRow(term)

      expect(row.textContent).toContain(term)
      // 語だけの行にしない（説明が空だと一覧の意味が無い）
      expect((row.textContent ?? '').length).toBeGreaterThan(term.length + 10)
    })

    it('11語の外でラベルによく見る語も出す', async () => {
      await openTab('ラベル')
      for (const term of ['生酒', '生貯蔵酒', '山廃・生酛', '樽酒']) {
        expect(termRow('label-terms', term).textContent).toContain(term)
      }
    })

    it('ラベルの数字（アルコール分・精米歩合・日本酒度・酸度）を説明する', async () => {
      await openTab('ラベル')
      for (const name of ['アルコール分', '日本酒度', '酸度']) {
        expect(screen.getByText(name, { selector: 'dt' })).toBeInTheDocument()
      }
      expect(screen.getByText(/プラスが大きいほど辛口寄り/)).toBeInTheDocument()
    })
  })

  describe('日本酒とは（種類タブ）', () => {
    it('原料と造りの流れを書く', async () => {
      await openTab('種類')

      expect(screen.getByText(/米・米こうじ・水を発酵させ/)).toBeInTheDocument()
      expect(screen.getByText(/三段仕込み/)).toBeInTheDocument()
    })

    it('「日本酒」が国産米・国内製造のものを指すと書く', async () => {
      await openTab('種類')
      expect(screen.getByText(/国産米を使って日本国内で造ったもの/)).toBeInTheDocument()
    })

    // 8種は名乗るための条件であって清酒の分類ではない。当てはまらない酒が劣るわけでもない
    it('8種に当てはまらない清酒があることを書く', async () => {
      await openTab('種類')
      expect(screen.getByText(/味が劣るという意味ではない/)).toBeInTheDocument()
    })
  })

  describe('季節の呼び名（季節タブ）', () => {
    it.each(['新酒', 'しぼりたて', 'ひやおろし', '秋あがり', '夏酒'])(
      '季節の呼び名「%s」を時期つきで出す',
      async (term) => {
        await openTab('季節')
        const label = within(screen.getByRole('tabpanel')).getByText(term, {
          selector: 'dt > span',
        })
        const row = label.closest('div')
        if (row === null) throw new Error(`語「${term}」の行が無い`)

        expect(row.textContent).toMatch(/\d+月/)
      },
    )

    // 蔵や地域で前後する。「11月から」と言い切る書き戻しをここで止める
    it('時期が目安であることを添える', async () => {
      await openTab('季節')
      expect(screen.getByText(/時期は目安で、蔵や地域で前後する/)).toBeInTheDocument()
    })
  })

  describe('このアプリについて（アプリタブ）', () => {
    // 5値のラベルはリテラルで書く。`LINK_STATUS_BADGES` から作ると綴りが何であれ一致して恒真になる
    it.each(['自動', '別名', '手動', '未紐付け', '銘柄不明'])(
      '紐付けの状態「%s」を凡例に出す',
      async (label) => {
        await openTab('アプリ')
        const badge = screen.getByText(label)

        expect(badge).toBeInTheDocument()
        // 対応表(`LINK_STATUS_BADGES`)の help が title に入る = 凡例が実物のバッジで描かれている
        expect(badge).toHaveAttribute('title')
      },
    )

    // ★ 実害が最も大きい知識。記録は端末内にしかなく、消える条件とバックアップの手段を
    // 画面に書いていなかった（SPEC の「決定に由来する制約」に書いてあるだけだった）
    it('記録が端末内にしか無いこと・消える条件・唯一の避難手段を書く', async () => {
      await openTab('アプリ')

      expect(screen.getByText(/この端末のブラウザの中/)).toBeInTheDocument()
      expect(screen.getByText(/サイトデータを消すと記録も消える/)).toBeInTheDocument()
      expect(screen.getByText(/JSON の書き出しと取り込みだけ/)).toBeInTheDocument()
    })

    // 数値は実装から引く（14/30日・400px・50KB を書き写すと、直したとき説明だけが古くなる）
    it('督促のしきい値とサムネイルの仕様を実装と同じ値で出す', async () => {
      await openTab('アプリ')

      expect(screen.getByText(/14日で注意、30日で強い注意/)).toBeInTheDocument()
      expect(screen.getByText(/長辺 400px・50KB 以下/)).toBeInTheDocument()
      expect(screen.getByText(/原本はアプリが持たない/)).toBeInTheDocument()
    })

    it('スタイル分布の規則（スペック欄だけ・部分一致・重複計上・備考は数えない）を書く', async () => {
      await openTab('アプリ')
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

  describe('産地（産地タブ）', () => {
    // ★ 利用者の指摘「産地の特徴を書くべき」。土地ごとの手がかりが本文にあること
    it('酒どころの手がかりを出す（灘と伏見・寒い地域・淡麗辛口）', async () => {
      await openTab('産地')

      expect(screen.getByText(/灘（兵庫）と伏見（京都）/)).toBeInTheDocument()
      expect(screen.getByText(/新潟の淡麗辛口/)).toBeInTheDocument()
      // 県名から味を決めつけない
      expect(screen.getByText(/県名から味は決まらない/)).toBeInTheDocument()
    })

    it('蔵の数を県別に出し、47都道府県すべてに蔵があると書く', async () => {
      await openTab('産地')

      expect(screen.getByText(/同梱データに載っている蔵は 1,749/)).toBeInTheDocument()
      const row = screen.getByText('新潟県').closest('li')
      expect(row?.textContent).toContain('113')
      expect(screen.getByText(/47都道府県すべてに蔵がある/)).toBeInTheDocument()
    })

    it('酒米を産地つきで出す', async () => {
      await openTab('産地')
      for (const rice of ['山田錦', '五百万石', '美山錦', '雄町']) {
        expect(termRow('area-rice', rice).textContent).toContain(rice)
      }
      expect(screen.getByText(/兵庫が主産地/)).toBeInTheDocument()
    })

    // 地図の見方（凡例は `FILL_STEPS` を走査して描く）
    it.each(['未進出（0本）', '1〜2本', '3〜5本', '6〜10本', '11本以上'])(
      '塗り分けの段「%s」を凡例に出す',
      async (label) => {
        await openTab('産地')
        expect(screen.getByText(label)).toBeInTheDocument()
      },
    )

    it('県が蔵元の所在地であることと、地図に載らない記録の扱いを書く', async () => {
      await openTab('産地')

      expect(screen.getByText(/その銘柄の蔵元の所在地/)).toBeInTheDocument()
      expect(screen.getByText(/近い県に丸めない/)).toBeInTheDocument()
      expect(screen.getByText(/多いほど濃い/)).toBeInTheDocument()
    })
  })

  describe('出典とライセンス（アプリタブ）', () => {
    it('さけのわのクレジットと sakenowa.com へのリンクを出す', async () => {
      await openTab('アプリ')
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
      await openTab('アプリ')
      expect(screen.getByText(/Map of Japan/)).toBeInTheDocument()
      expect(screen.getByText(/Victor Cazanave/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
        'href',
        'https://creativecommons.org/licenses/by/4.0/',
      )
      expect(screen.getByText(/改変あり/)).toBeInTheDocument()
    })

    it('tesseract.js の Apache-2.0 を、表示義務が無いことと併せて出す', async () => {
      await openTab('アプリ')
      expect(screen.getByText(/Apache-2.0。/)).toBeInTheDocument()
      expect(screen.getByText(/画面での表示義務は無い/)).toBeInTheDocument()
    })

    // 表以外の説明が条文ではないことは、この面のどこかに1度あればよい（出典タブに置いた）
    it('表以外の説明が法令の条文ではないと書く', async () => {
      await openTab('アプリ')
      expect(screen.getByText(/法令の条文ではない/)).toBeInTheDocument()
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

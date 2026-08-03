// 写真選択の約束を固定する: **結果を数字で出す / 失敗を無音にしない / HEIC を専用に案内する /
// object URL を leak しない / 外せる。**
//
// リサイズ本体(`resizeToThumbnail`)は `resize` prop で差し替える。canvas も createImageBitmap も
// jsdom に無いので、ここで本物を呼ぶと全ケースが `unsupported` になり画面の分岐を1つも検証できない
// (リサイズの中身は src/lib/image/resize.test.ts の担当)。
//
// HEIC の案内文は `HEIC_ADVICE` を import して照合する。**文言をテストに写さない** —
// 写すと文言の出所が2箇所になり、resize.ts 側を直しても画面が古い文言のままでも緑になる。
//
// データはすべて合成。実際の飲酒記録(`data/seed/` は gitignore)は fixture にしない。

import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  HEIC_ADVICE,
  ThumbnailError,
  type ThumbnailResult,
} from '../../lib/image/resize.ts'
import { PhotoPicker, type PhotoPickerProps, type PhotoResizer } from './PhotoPicker.tsx'

afterEach(() => {
  vi.restoreAllMocks()
})

/** 38KB ちょうどに出るバイト数(38912 / 1024 = 38) */
const BYTES_38KB = 38912

/** 保存形のサムネイル。**Blob ではなくバイト列**(B72) */
function jpeg(bytes: number): ArrayBuffer {
  return new ArrayBuffer(bytes)
}

function thumbnail(overrides: Partial<ThumbnailResult> = {}): ThumbnailResult {
  const bytes = overrides.bytes ?? BYTES_38KB
  return {
    data: jpeg(bytes),
    width: 400,
    height: 533,
    bytes,
    quality: 0.82,
    ...overrides,
  }
}

function photoFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File(['original-bytes'], name, { type })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * `value` は親(RecordForm)が持つ設計なので、テストでも親を1つ立てる。
 * `PhotoPicker` 単体を非制御で回すと「選んだのに value が変わらない」という本番に無い状態で
 * 検証してしまう。
 */
function Harness({
  initial = null,
  onChange,
  ...rest
}: Omit<PhotoPickerProps, 'value' | 'onChange'> & {
  initial?: ArrayBuffer | null
  onChange?: (thumbnail: ArrayBuffer | null) => void
}) {
  const [photo, setPhoto] = useState<ArrayBuffer | null>(initial)
  return (
    <PhotoPicker
      {...rest}
      value={photo}
      onChange={(next) => {
        setPhoto(next)
        onChange?.(next)
      }}
    />
  )
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText('写真')
}

describe('入力の作り', () => {
  it('image/* を受け、capture は付けない（カメラ直起動を強制しない）', () => {
    render(<Harness resize={vi.fn()} />)
    const input = fileInput()
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'image/*')
    // capture を付けると端末の写真アプリから選べなくなる(SPEC は撮影済みの写真を選ぶ前提)
    expect(input.hasAttribute('capture')).toBe(false)
  })

  it('写真が無いうちは外すボタンもプレビューも出ない', () => {
    render(<Harness resize={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '写真を外す' })).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('サムネイル生成', () => {
  it('成功するとバイト数と寸法を出す（A8 の証拠）', async () => {
    const user = userEvent.setup()
    const made = thumbnail()
    const resize = vi.fn<PhotoResizer>().mockResolvedValue(made)
    const onChange = vi.fn()
    render(<Harness resize={resize} onChange={onChange} />)

    await user.upload(fileInput(), photoFile())

    expect(await screen.findByText('サムネイル 38KB / 400×533')).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(made.data)
    expect(screen.getByAltText('選んだ写真のサムネイル')).toBeInTheDocument()
  })

  it('生成中はその旨を出し、終わったら消す', async () => {
    const user = userEvent.setup()
    const pending = deferred<ThumbnailResult>()
    const onBusyChange = vi.fn()
    render(
      <Harness resize={vi.fn<PhotoResizer>().mockReturnValue(pending.promise)} onBusyChange={onBusyChange} />,
    )

    await user.upload(fileInput(), photoFile('big.jpg'))

    // 大きい写真は数秒かかる。無反応に見せない
    expect(screen.getByRole('status')).toHaveTextContent('big.jpg')
    // 親は生成中に保存させてはいけない(写真なしで保存が通ると無音の取りこぼしになる)
    expect(onBusyChange).toHaveBeenCalledExactlyOnceWith(true)

    pending.resolve(thumbnail())

    expect(await screen.findByText('サムネイル 38KB / 400×533')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  })

  it('品質を落として収めたときはそれも書く（絵が甘くなったことを隠さない）', async () => {
    const user = userEvent.setup()
    const resize = vi.fn<PhotoResizer>().mockResolvedValue(
      thumbnail({ bytes: 50_000, quality: 0.5, width: 320, height: 427 }),
    )
    render(<Harness resize={resize} />)

    await user.upload(fileInput(), photoFile())

    expect(await screen.findByText('サムネイル 49KB / 320×427')).toBeInTheDocument()
    expect(screen.getByText(/JPEG の品質を 0.5 まで落とした/)).toBeInTheDocument()
  })

  it('既定の品質で収まったときは品質の注記を出さない', async () => {
    const user = userEvent.setup()
    render(<Harness resize={vi.fn<PhotoResizer>().mockResolvedValue(thumbnail())} />)

    await user.upload(fileInput(), photoFile())

    await screen.findByText('サムネイル 38KB / 400×533')
    expect(screen.queryByText(/品質を/)).toBeNull()
  })

  it('1KB 未満はバイトで出す（0KB と書くと空ファイルに見える）', async () => {
    const user = userEvent.setup()
    const resize = vi
      .fn<PhotoResizer>()
      .mockResolvedValue(thumbnail({ bytes: 900, width: 40, height: 30 }))
    render(<Harness resize={resize} />)

    await user.upload(fileInput(), photoFile())

    expect(await screen.findByText('サムネイル 900バイト / 40×30')).toBeInTheDocument()
  })

  it('生成中に選び直したとき、追い越された古い結果を捨てる', async () => {
    const user = userEvent.setup()
    const slow = deferred<ThumbnailResult>()
    const fast = deferred<ThumbnailResult>()
    const resize = vi
      .fn<PhotoResizer>()
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const onChange = vi.fn()
    const onBusyChange = vi.fn()
    render(<Harness resize={resize} onChange={onChange} onBusyChange={onBusyChange} />)

    await user.upload(fileInput(), photoFile('first.jpg'))
    await user.upload(fileInput(), photoFile('second.jpg'))

    const second = thumbnail({ bytes: 20_480, width: 300, height: 400 })
    fast.resolve(second)
    // 遅い1枚目が後から届く。ここで上書きされると「選んだのと違う写真が付く」
    slow.resolve(thumbnail({ bytes: 45_056, width: 400, height: 300 }))

    expect(await screen.findByText('サムネイル 20KB / 300×400')).toBeInTheDocument()
    expect(screen.queryByText('サムネイル 44KB / 400×300')).toBeNull()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(second.data)
    // 畳むのは最後の世代だけ(古い世代が false を出すと生成中に保存できてしまう)
    expect(onBusyChange.mock.calls).toEqual([[true], [true], [false]])
  })
})

describe('失敗の案内', () => {
  it('HEIC のデコード失敗は専用の案内を出す', async () => {
    const user = userEvent.setup()
    const resize = vi
      .fn<PhotoResizer>()
      .mockRejectedValue(new ThumbnailError('heic', HEIC_ADVICE))
    render(<Harness resize={resize} />)

    await user.upload(fileInput(), photoFile('IMG_0001.HEIC', 'image/heic'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('IMG_0001.HEIC')
    expect(alert).toHaveTextContent('対応していない形式')
    // 文言の出所は resize.ts の1箇所。画面はそれをそのまま出す
    expect(screen.getByText(HEIC_ADVICE)).toBeInTheDocument()
  })

  it('一般的なデコード失敗は HEIC とは別の案内を出す', async () => {
    const user = userEvent.setup()
    const message = 'この写真を画像として読み込めない(形式が違うか壊れている)。別の写真を選ぶ。'
    const resize = vi.fn<PhotoResizer>().mockRejectedValue(new ThumbnailError('decode', message))
    render(<Harness resize={resize} />)

    await user.upload(fileInput(), photoFile('broken.png', 'image/png'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('読み込めない写真')
    expect(alert).toHaveTextContent(message)
    // HEIC 向けの案内と混ざっていない
    expect(alert).not.toHaveTextContent('対応していない形式')
    expect(screen.queryByText(HEIC_ADVICE)).toBeNull()
  })

  it('50KB に収まらないときも理由を出す（無音で巨大保存しない）', async () => {
    const user = userEvent.setup()
    const message = 'この写真は256×341・品質0.4まで落としても88KBあり、50KB以下にならない。'
    const resize = vi.fn<PhotoResizer>().mockRejectedValue(new ThumbnailError('too-large', message))
    render(<Harness resize={resize} />)

    await user.upload(fileInput(), photoFile())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('小さくできない')
    expect(alert).toHaveTextContent(message)
  })

  it('名前の無いファイル（共有シート経由）でも案内の文が壊れない', async () => {
    const user = userEvent.setup()
    const pending = deferred<ThumbnailResult>()
    render(<Harness resize={vi.fn<PhotoResizer>().mockReturnValue(pending.promise)} />)

    // 共有シート経由の File は name が空になることがある。素通しすると
    // 「 からサムネイルを作っている」と主語の無い文になる
    await user.upload(fileInput(), new File(['bytes'], '', { type: 'image/jpeg' }))

    expect(screen.getByRole('status')).toHaveTextContent(
      '選んだ写真 からサムネイルを作っている',
    )

    pending.reject(new ThumbnailError('decode', 'この写真を画像として読み込めない。'))

    expect(await screen.findByRole('alert')).toHaveTextContent('選んだ写真 — 読み込めない写真')
  })

  it('ThumbnailError 以外の例外も画面に出す（catch して捨てない）', async () => {
    const user = userEvent.setup()
    const resize = vi.fn<PhotoResizer>().mockRejectedValue(new TypeError('boom'))
    render(<Harness resize={resize} />)

    await user.upload(fileInput(), photoFile())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('想定外のエラー')
    expect(alert).toHaveTextContent('TypeError: boom')
  })

  it('失敗しても既に付いている写真は落とさない', async () => {
    const user = userEvent.setup()
    const resize = vi
      .fn<PhotoResizer>()
      .mockRejectedValue(new ThumbnailError('heic', HEIC_ADVICE))
    const onChange = vi.fn()
    render(<Harness initial={jpeg(BYTES_38KB)} resize={resize} onChange={onChange} />)

    expect(screen.getByText('保存済みの写真 38KB')).toBeInTheDocument()

    await user.upload(fileInput(), photoFile('IMG_0002.HEIC', 'image/heic'))

    await screen.findByRole('alert')
    // 差し替えに失敗しただけで元の写真を消すのは静かなデータ喪失
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('保存済みの写真 38KB')).toBeInTheDocument()
    expect(screen.getByText('いま付いている写真はそのまま残っている。')).toBeInTheDocument()
  })

  it('追い越された古い失敗の案内は出さない（成功した写真の隣に前のエラーを残さない）', async () => {
    const user = userEvent.setup()
    const slow = deferred<ThumbnailResult>()
    const fast = deferred<ThumbnailResult>()
    const resize = vi
      .fn<PhotoResizer>()
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    render(<Harness resize={resize} />)

    await user.upload(fileInput(), photoFile('first.heic', 'image/heic'))
    await user.upload(fileInput(), photoFile('second.jpg'))

    const second = thumbnail()
    fast.resolve(second)
    // 遅い1枚目が「読めなかった」と後から届く。世代を見ないと、付いているのは2枚目なのに
    // 1枚目の HEIC 案内が出て「保存できていないのでは」と読めてしまう
    slow.reject(new ThumbnailError('heic', HEIC_ADVICE))

    expect(await screen.findByText('サムネイル 38KB / 400×533')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('次の選択が成功すると前の失敗の案内は消える', async () => {
    const user = userEvent.setup()
    const resize = vi
      .fn<PhotoResizer>()
      .mockRejectedValueOnce(new ThumbnailError('decode', 'こわれている'))
      .mockResolvedValueOnce(thumbnail())
    render(<Harness resize={resize} />)

    await user.upload(fileInput(), photoFile('broken.png'))
    await screen.findByRole('alert')

    await user.upload(fileInput(), photoFile())

    expect(await screen.findByText('サムネイル 38KB / 400×533')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('保存済みの写真', () => {
  it('寸法が分からない Blob にはバイト数だけ出す（推定で埋めない）', () => {
    render(<Harness initial={jpeg(BYTES_38KB)} resize={vi.fn()} />)

    expect(screen.getByText('保存済みの写真 38KB')).toBeInTheDocument()
    expect(screen.queryByText(/×/)).toBeNull()
  })

  it('親が別の Blob に差し替えたら、前に作った寸法を出し続けない', async () => {
    const user = userEvent.setup()
    const resize = vi.fn<PhotoResizer>().mockResolvedValue(thumbnail())
    const replacement = jpeg(2048)

    // 編集フォームの読み直しや取り込みで、親が自分の作ったものとは別の Blob を入れてくる。
    // このとき前回の 400×533 を貼り続けるのは、寸法を推測で埋めるのと同じこと
    function Swapper() {
      const [photo, setPhoto] = useState<ArrayBuffer | null>(null)
      return (
        <>
          <PhotoPicker value={photo} onChange={setPhoto} resize={resize} />
          <button
            type="button"
            onClick={() => {
              setPhoto(replacement)
            }}
          >
            別の写真に差し替える
          </button>
        </>
      )
    }

    render(<Swapper />)
    await user.upload(fileInput(), photoFile())
    await screen.findByText('サムネイル 38KB / 400×533')

    await user.click(screen.getByRole('button', { name: '別の写真に差し替える' }))

    expect(screen.queryByText('サムネイル 38KB / 400×533')).toBeNull()
    expect(screen.getByText('保存済みの写真 2KB')).toBeInTheDocument()
  })
})

describe('object URL の後始末', () => {
  it('unmount で revokeObjectURL する（leak を止めている）', () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')

    const { unmount } = render(<Harness initial={jpeg(1024)} resize={vi.fn()} />)

    expect(create).toHaveBeenCalledTimes(1)
    const url = create.mock.results[0].value as string
    expect(revoke).not.toHaveBeenCalled()

    unmount()

    expect(revoke).toHaveBeenCalledExactlyOnceWith(url)
  })

  it('写真を差し替えると古い URL を revoke する', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    render(<Harness initial={jpeg(1024)} resize={vi.fn<PhotoResizer>().mockResolvedValue(thumbnail())} />)

    const first = create.mock.results[0].value as string

    await user.upload(fileInput(), photoFile())
    await screen.findByText('サムネイル 38KB / 400×533')

    expect(revoke).toHaveBeenCalledWith(first)
    expect(create).toHaveBeenCalledTimes(2)
  })

  // `delete URL.createObjectURL` では消えない: jsdom の own プロパティを外すと Node 組み込みの
  // 同名 static が露出し、`typeof` は function のまま(jsdom の Blob を渡すと投げる別実装になる)。
  // 未対応環境の再現は「undefined を被せる」で行う。
  function withoutObjectUrl(body: () => void): void {
    const original = URL.createObjectURL
    const define = (value: unknown) => {
      Object.defineProperty(URL, 'createObjectURL', { value, configurable: true, writable: true })
    }
    define(undefined)
    try {
      body()
    } finally {
      define(original)
    }
  }

  it('createObjectURL が無い環境ではプレビューを描かず、数字だけ出す', () => {
    withoutObjectUrl(() => {
      expect(typeof URL.createObjectURL).not.toBe('function')
      render(<Harness initial={jpeg(BYTES_38KB)} resize={vi.fn()} />)
      // 例外で画面を落とさず、付け外しは動く
      expect(screen.queryByRole('img')).toBeNull()
      expect(screen.getByText('保存済みの写真 38KB')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '写真を外す' })).toBeInTheDocument()
    })
  })
})

describe('写真を外す', () => {
  it('外すと表示が消え、親には null が渡る', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onBusyChange = vi.fn()
    render(
      <Harness
        resize={vi.fn<PhotoResizer>().mockResolvedValue(thumbnail())}
        onChange={onChange}
        onBusyChange={onBusyChange}
      />,
    )

    await user.upload(fileInput(), photoFile())
    await screen.findByText('サムネイル 38KB / 400×533')

    await user.click(screen.getByRole('button', { name: '写真を外す' }))

    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByText('サムネイル 38KB / 400×533')).toBeNull()
    expect(screen.queryByAltText('選んだ写真のサムネイル')).toBeNull()
    expect(screen.queryByRole('button', { name: '写真を外す' })).toBeNull()
  })

  it('外した後にもう一度選べる（付けたら消せない/消したら付けられない を作らない）', async () => {
    const user = userEvent.setup()
    const resize = vi
      .fn<PhotoResizer>()
      .mockResolvedValueOnce(thumbnail())
      .mockResolvedValueOnce(thumbnail({ bytes: 20_480, width: 300, height: 400 }))
    render(<Harness resize={resize} />)

    await user.upload(fileInput(), photoFile())
    await screen.findByText('サムネイル 38KB / 400×533')
    await user.click(screen.getByRole('button', { name: '写真を外す' }))

    await user.upload(fileInput(), photoFile('another.jpg'))

    expect(await screen.findByText('サムネイル 20KB / 300×400')).toBeInTheDocument()
  })

  it('生成中に外すと、後から届いた結果で写真が戻らない', async () => {
    const user = userEvent.setup()
    const pending = deferred<ThumbnailResult>()
    const onChange = vi.fn()
    render(
      <Harness initial={jpeg(BYTES_38KB)} resize={vi.fn<PhotoResizer>().mockReturnValue(pending.promise)} onChange={onChange} />,
    )

    await user.upload(fileInput(), photoFile())
    expect(screen.getByRole('status')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '写真を外す' }))
    pending.resolve(thumbnail())
    // 生成の完了を待ってから状態を見る
    await Promise.resolve()

    expect(onChange.mock.calls).toEqual([[null]])
    expect(screen.queryByText('サムネイル 38KB / 400×533')).toBeNull()
    expect(screen.queryByRole('button', { name: '写真を外す' })).toBeNull()
  })
})

// 原本(原寸の元ファイル)は OCR に渡すためだけに親へ出す。**保存されるのはサムネイルだけ**で、
// サムネイル生成の挙動(長辺400px / 50KB以下)はこの受け渡しで一切変わっていない。
describe('原本の受け渡し', () => {
  it('サムネイルが作れたときだけ、その写真の原本を親に渡す', async () => {
    const user = userEvent.setup()
    const made = thumbnail()
    const onChange = vi.fn()
    const onSourceChange = vi.fn()
    render(
      <Harness
        resize={vi.fn<PhotoResizer>().mockResolvedValue(made)}
        onChange={onChange}
        onSourceChange={onSourceChange}
      />,
    )

    const file = photoFile()
    await user.upload(fileInput(), file)
    await screen.findByText('サムネイル 38KB / 400×533')

    // サムネイル(400px)では OCR に解像度が足りないので、渡すのは原本そのもの
    expect(onSourceChange).toHaveBeenCalledExactlyOnceWith(file)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(made.data)
  })

  it('生成に失敗したら原本も渡さない（サムネイルと原本が別の写真にならない）', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onSourceChange = vi.fn()
    render(
      <Harness
        initial={jpeg(BYTES_38KB)}
        resize={vi.fn<PhotoResizer>().mockRejectedValue(new ThumbnailError('heic', HEIC_ADVICE))}
        onChange={onChange}
        onSourceChange={onSourceChange}
      />,
    )

    await user.upload(fileInput(), photoFile('IMG_0003.HEIC', 'image/heic'))
    await screen.findByRole('alert')

    // 付いている写真を替えないのだから、原本も替えない(決定4と対)
    expect(onChange).not.toHaveBeenCalled()
    expect(onSourceChange).not.toHaveBeenCalled()
  })

  it('写真を外すと原本も落とす（外したのに読み取りの導線だけ残らない）', async () => {
    const user = userEvent.setup()
    const onSourceChange = vi.fn()
    render(
      <Harness
        resize={vi.fn<PhotoResizer>().mockResolvedValue(thumbnail())}
        onSourceChange={onSourceChange}
      />,
    )

    await user.upload(fileInput(), photoFile())
    await screen.findByText('サムネイル 38KB / 400×533')
    await user.click(screen.getByRole('button', { name: '写真を外す' }))

    expect(onSourceChange).toHaveBeenLastCalledWith(null)
  })

  it('追い越された古い世代の原本は渡さない', async () => {
    const user = userEvent.setup()
    const slow = deferred<ThumbnailResult>()
    const fast = deferred<ThumbnailResult>()
    const resize = vi
      .fn<PhotoResizer>()
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const onSourceChange = vi.fn()
    render(<Harness resize={resize} onSourceChange={onSourceChange} />)

    const first = photoFile('first.jpg')
    const second = photoFile('second.jpg')
    await user.upload(fileInput(), first)
    await user.upload(fileInput(), second)

    fast.resolve(thumbnail({ bytes: 20_480, width: 300, height: 400 }))
    slow.resolve(thumbnail())

    await screen.findByText('サムネイル 20KB / 300×400')
    // 1枚目の原本が後から渡ると、2枚目の写真に対して1枚目の文字を読み取ることになる
    expect(onSourceChange).toHaveBeenCalledExactlyOnceWith(second)
  })
})

describe('親が入力を止めているとき', () => {
  it('disabled で選択も除去も押せない', () => {
    render(<Harness initial={jpeg(1024)} resize={vi.fn()} disabled />)

    expect(fileInput()).toBeDisabled()
    expect(screen.getByRole('button', { name: '写真を外す' })).toBeDisabled()
  })
})

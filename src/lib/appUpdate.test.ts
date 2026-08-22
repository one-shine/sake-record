// @vitest-environment node
// ブラウザ側の口は差し替えるので DOM を要らない。
//
// **ここが守っているのは「SW の更新が打った内容を黙って消さない」**(B87)。
// 以前は `controllerchange` で無条件に `window.location.reload()` していて、
// `visibilitychange` のたびに更新確認もしていたので、写真アプリから記録の途中に戻った
// 瞬間にリロードが起きて入力が全損しうる形だった。

import { describe, expect, it, vi } from 'vitest'
import {
  shouldReloadNow,
  watchAppUpdate,
  type OpenWork,
  type UpdateEnvironment,
} from './appUpdate.ts'

const NOTHING_OPEN: OpenWork = {
  form: false,
  detail: false,
  linking: false,
  importExport: false,
  sync: false,
}

describe('shouldReloadNow', () => {
  it('何も開いていなければその場でリロードしてよい', () => {
    expect(shouldReloadNow(NOTHING_OPEN)).toBe(true)
  })

  // **1つでも開いていたら保留する。** 誤って保留する代償は「再読み込みを1回押させる」だけ、
  // 誤ってリロードする代償は「打った内容が消える」で取り返しがつかない
  it('どれか1つでも開いていたら保留する', () => {
    for (const key of ['form', 'detail', 'linking', 'importExport', 'sync'] as const) {
      expect(shouldReloadNow({ ...NOTHING_OPEN, [key]: true }), key).toBe(false)
    }
  })
})

function fakeEnv(over: Partial<UpdateEnvironment> = {}) {
  const handlers: { controller: (() => void)[]; visible: (() => void)[] } = {
    controller: [],
    visible: [],
  }
  const checkForUpdate = vi.fn()
  const env: UpdateEnvironment = {
    onControllerChange: (handler) => {
      handlers.controller.push(handler)
      return () => {
        handlers.controller = handlers.controller.filter((entry) => entry !== handler)
      }
    },
    hasController: () => true,
    checkForUpdate,
    onVisible: (handler) => {
      handlers.visible.push(handler)
      return () => {
        handlers.visible = handlers.visible.filter((entry) => entry !== handler)
      }
    },
    ...over,
  }
  return {
    env,
    checkForUpdate,
    fireControllerChange: () => {
      for (const handler of [...handlers.controller]) handler()
    },
    fireVisible: () => {
      for (const handler of [...handlers.visible]) handler()
    },
    counts: () => ({ controller: handlers.controller.length, visible: handlers.visible.length }),
  }
}

describe('watchAppUpdate', () => {
  it('版が入れ替わったら知らせる', () => {
    const onUpdate = vi.fn()
    const harness = fakeEnv()

    watchAppUpdate(harness.env, onUpdate)
    harness.fireControllerChange()

    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  // 初回訪問の `controllerchange` は「初めて SW が入った」であって版の入れ替わりではない。
  // ここで知らせると、初めて開いた人にいきなり「新しい版がある」と言うことになる
  it('初回訪問(まだ誰も制御していない)では知らせない', () => {
    const onUpdate = vi.fn()
    const harness = fakeEnv({ hasController: () => false })

    watchAppUpdate(harness.env, onUpdate)
    harness.fireControllerChange()

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('何度入れ替わっても知らせるのは1回だけ', () => {
    const onUpdate = vi.fn()
    const harness = fakeEnv()

    watchAppUpdate(harness.env, onUpdate)
    harness.fireControllerChange()
    harness.fireControllerChange()

    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  // 数日開いたままのタブが旧版に留まるのを防ぐ。**確認するだけでリロードはしない**
  it('画面が見えたら更新の確認を頼むが、それ自体では知らせない', () => {
    const onUpdate = vi.fn()
    const harness = fakeEnv()

    watchAppUpdate(harness.env, onUpdate)
    harness.fireVisible()

    expect(harness.checkForUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('解除すると両方の購読が外れる', () => {
    const harness = fakeEnv()

    const stop = watchAppUpdate(harness.env, vi.fn())
    expect(harness.counts()).toEqual({ controller: 1, visible: 1 })
    stop()

    expect(harness.counts()).toEqual({ controller: 0, visible: 0 })
  })
})

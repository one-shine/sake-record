// 新しい版に入れ替わったことを画面に伝える配線(B87)。
//
// ## 何を直したのか
//
// `sw.js` は install で `skipWaiting()`、activate で `clients.claim()` を呼ぶので、
// 新しい版はデプロイ後すぐ制御を奪う。以前はその `controllerchange` で
// **無条件に `window.location.reload()`** していた。さらに登録後は `visibilitychange` の
// たびに `reg.update()` を呼ぶので、**「記録の途中で写真アプリへ切り替えて戻った瞬間」**という
// 一番ありうるタイミングでリロードが起きる。`RecordForm` の入力はメモリ上の state にしか無く、
// dirty のときの確認ダイアログは**アプリ内の閉じる操作にしか効かない**ので、打っていた銘柄・
// メモ・選んだ写真が黙って消えていた。「入力があるまま閉じるときは確認を出す」という
// この画面の規律を、SW の更新だけが素通りしていたことになる。
//
// ## 直し方の方針
//
// **失うものが無いときは今までどおり即リロードし、あるときは本人に委ねる。**
// 常に確認を挟むと、何も開いていない画面でも「再読み込み」を押させることになって煩わしい。
// 逆に常に即リロードすると、この不具合が戻る。判断は `shouldReloadNow` の1本が持つ。
//
// **「失うもの」をフォームの dirty ではなくオーバーレイの有無で見る。** dirty は
// `RecordForm` の内側にしか無く、App まで引き上げると同期先が増える(そして必ずずれる)。
// オーバーレイが開いている = 本人が何かの途中、と粗く見て保留するほうが安全側に倒れる。
// 取り込みのプレビューや同期の結果表示も、途中で消えれば同じように困る。

/** 画面が開いているもの。`true` が1つでもあれば「本人が何かの途中」とみなす */
export type OpenWork = {
  /** 記録の作成 / 編集フォーム(打った内容はメモリ上にしか無い) */
  form: boolean
  /** 記録の詳細 */
  detail: boolean
  /** 手動紐付け */
  linking: boolean
  /** 取り込み / 書き出し(読み込んだファイルのプレビューが載っている) */
  importExport: boolean
  /** 同期(結果の表示が載っている) */
  sync: boolean
}

/**
 * 新しい版に入れ替わったとき、その場でリロードしてよいか。
 *
 * **迷ったら保留する。** 誤って保留した場合の代償は「再読み込みを1回押させる」だけだが、
 * 誤ってリロードした場合の代償は「打った内容が消える」で、取り返しがつかない。
 */
export function shouldReloadNow(open: OpenWork): boolean {
  return !(open.form || open.detail || open.linking || open.importExport || open.sync)
}

/** `watchAppUpdate` が使うブラウザ側の口。テストで差し替える */
export type UpdateEnvironment = {
  /** `controllerchange` の購読。解除する関数を返す */
  onControllerChange: (handler: () => void) => () => void
  /** 既に制御している SW が居るか(初回訪問と入れ替わりを区別する) */
  hasController: () => boolean
  /** 更新の確認を頼む(復帰のたびに呼ぶ)。失敗しても投げない */
  checkForUpdate: () => void
  /** 画面が見えるようになったときの購読。解除する関数を返す */
  onVisible: (handler: () => void) => () => void
}

/**
 * 新しい版に入れ替わったら1回だけ `onUpdate` を呼ぶ。
 *
 * **初回訪問(まだ誰も制御していない)では呼ばない。** そこでの `controllerchange` は
 * 「初めて SW が入った」であって版の入れ替わりではなく、リロードする理由が無い。
 *
 * @returns 購読を解除する関数
 */
export function watchAppUpdate(env: UpdateEnvironment, onUpdate: () => void): () => void {
  // **購読より前に読む。** `controllerchange` が起きた後に読むと、入れ替わった後の
  // controller を見て「最初から居た」と誤判定する
  const hadController = env.hasController()
  let notified = false

  const stopControllerChange = env.onControllerChange(() => {
    if (!hadController || notified) return
    notified = true
    onUpdate()
  })
  // 数日開いたままのタブが旧版に留まるのを防ぐ。**取得そのものはここでは待たない**
  const stopVisible = env.onVisible(() => {
    env.checkForUpdate()
  })

  return () => {
    stopControllerChange()
    stopVisible()
  }
}

// ---------------------------------------------------------------------------
// ブラウザ側の実体
// ---------------------------------------------------------------------------

/**
 * 更新の確認を頼む関数。**登録が終わるまで存在しない**ので後から差し込む。
 *
 * `main.tsx` の `register()` は非同期で、App の mount のほうが先に来る。
 * `ServiceWorkerRegistration` を App まで引き回すより、確認だけを1つの口に集めるほうが
 * 呼び側が増えても配線が散らない(`checkForUpdate` は失敗しても何も起きなくてよい)。
 */
let updateChecker: (() => void) | null = null

export function setUpdateChecker(check: () => void): void {
  updateChecker = check
}

/** テスト用。モジュール変数を跨いで漏らさない */
export function resetUpdateCheckerForTest(): void {
  updateChecker = null
}

/**
 * 実ブラウザの口。**Service Worker が無い環境では何も起きない口を返す** —
 * 例外を投げると、SW を持たないブラウザや jsdom でアプリが起動しなくなる。
 */
export function browserUpdateEnvironment(): UpdateEnvironment {
  // **参照を1回だけ掴む。** 解除のときに読み直すと、その時点で口が消えていた場合に
  // cleanup が例外を投げてアンマウント全体を壊す(購読できたなら解除もできる、を保つ)
  const worker =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : null
  return {
    onControllerChange: (handler) => {
      if (worker === null) return () => undefined
      worker.addEventListener('controllerchange', handler)
      return () => {
        worker.removeEventListener('controllerchange', handler)
      }
    },
    hasController: () => worker !== null && worker.controller !== null,
    checkForUpdate: () => {
      updateChecker?.()
    },
    onVisible: (handler) => {
      if (typeof document === 'undefined') return () => undefined
      const listener = () => {
        if (document.visibilityState === 'visible') handler()
      }
      document.addEventListener('visibilitychange', listener)
      return () => {
        document.removeEventListener('visibilitychange', listener)
      }
    },
  }
}

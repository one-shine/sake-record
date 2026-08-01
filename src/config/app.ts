// 表示名の唯一の TS 出所。
//
// ブランド名を技術識別子(リポジトリ名・base・バンドルID)に埋め込まない方針だが、
// 商標上の混同が実際に起きるのは識別子ではなく「表示名」である:
// saketime.jp は SAKETIME株式会社(日本酒レビューサイト)が運営中で、同じ領域で名前が衝突する。
// そのため表示名は次の3ファイルだけに置き、scripts/check-naming.mjs で強制する:
//   index.html / public/manifest.json / このファイル
// 改名が必要になったらこの3ファイルの操作で済む(アセット作成前・ストア申請前ならコストゼロ)。
export const APP_NAME = 'saketime'
export const APP_TAGLINE = '日本酒の記録'

// 端末間同期の同期先(B69 / PHASE 8)。**秘密ではない** — 守っているのはトークン1本だけなので、
// URL を置いても `.env` を使わない方針を保てる(SPEC スコープ11)。
//
// **空文字は「同期先をまだ用意していない」。** その端末では同期の画面がそう言い、通信は一切しない。
//
// **同一オリジンに置いてはいけない。** `public/sw.js` は同一オリジンの GET を cache-first で
// 保持するので(ハッシュの付かない同梱データを意図してそう扱っている)、最初の応答が固定されて
// 以後どれだけ同期しても同じ変更と同じ位置が返り続ける。push は通るので「同期できている」ように
// 見えるのに、別端末の変更が永久に届かない。クロスオリジンは素通しされるので workers.dev のままにする。
export const SYNC_URL = 'https://sake-record-sync.sv-sync.workers.dev'

// さけのわデータの利用条件: クレジット表示と https://sakenowa.com へのリンクが必須(省略は禁止事項)。
export const SAKENOWA_URL = 'https://sakenowa.com'
export const SAKENOWA_DATA_URL = 'https://muro.sakenowa.com/sakenowa-data/'

// 産地マップの県形状は @svg-maps/japan (CC-BY-4.0)。作者・タイトル・ライセンス・改変の明示が必要。
//
// **作者名とタイトルはここに定数を置かない。** `ui/Attribution/Attribution.tsx` が
// `Map of Japan by Victor Cazanave` を1つの文字列リテラルとして書く約束で、
// 定数を補間すると成果物では実行時連結になって連続した文字列が消え、
// `scripts/check-attribution.mjs` が欠落を検出できなくなる(理由は Attribution 側の頭に詳しい)。
// URL は `href` に入るのでバンドル上もリテラルのまま残る = 定数でよい。
export const MAP_SOURCE_URL = 'https://github.com/VictorCazanave/svg-maps'
export const MAP_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'

// 銘柄の読み(B68)は KANJIDIC(電子辞書研究開発グループ / CC-BY-SA 4.0)由来。
// 表示義務があるので「知る」の出典タブに出す。**地図と同じ理由で作者名とタイトルの定数は
// 置かない**(`KanjiDicCredit` が1つのリテラルとして書く。補間するとバンドルで割れて
// `attribution:check` が欠落を検出できなくなる)。
export const KANJIDIC_URL = 'https://www.edrdg.org/wiki/index.php/KANJIDIC_Project'
export const KANJIDIC_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'

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

// さけのわデータの利用条件: クレジット表示と https://sakenowa.com へのリンクが必須(省略は禁止事項)。
export const SAKENOWA_URL = 'https://sakenowa.com'
export const SAKENOWA_DATA_URL = 'https://muro.sakenowa.com/sakenowa-data/'

// 産地マップの県形状は @svg-maps/japan (CC-BY-4.0)。作者・タイトル・ライセンス・改変の明示が必要。
export const MAP_AUTHOR = 'Victor Cazanave'
export const MAP_TITLE = 'Map of Japan'
export const MAP_SOURCE_URL = 'https://github.com/VictorCazanave/svg-maps'
export const MAP_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'

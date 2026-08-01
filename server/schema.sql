-- 同期先(D1)のスキーマ。適用は `npm run schema:remote` / `npm run schema:local`。
--
-- ## 2つの時間を分けて持つ
--
-- | 列          | 誰の時計か   | 何に使うか                                       |
-- |-------------|--------------|--------------------------------------------------|
-- | `updated_at`| **端末**     | 勝ち負けの判定(last-writer-wins)だけ            |
-- | `seq`       | **サーバ**   | 「どこまで受け取ったか」の位置だけ                |
--
-- 兼ねさせてはいけない。時計がずれた端末が過去の時刻で書き込むと、そこを通り過ぎた端末は
-- その行を二度と受け取らない(片方の端末にだけ見えない記録ができ、例外は何も出ない)。
-- `seq` はサーバの単調増加カウンタなので、どの端末の時計にも依存しない。
--
-- ISO8601(`YYYY-MM-DDTHH:mm:ss.sssZ`)は**辞書順 = 時系列**なので、時刻の比較は文字列比較でよい。
--
-- ## 本体(`body`)はサーバにとって不透明
--
-- サーバは `id` / `updated_at` / `deleted_at` しか読まない。記録の形を知らせると、項目を1つ
-- 足すたびにサーバの再デプロイが要る。形の検証はクライアント(`src/domain/syncWire.ts`)が行う。

-- 位置カウンタ。**1行しか持たない。** push のたびに1つ進め、その push で書いた行すべてに同じ値を振る。
-- 進めるのと書くのを同じトランザクション(D1 の batch)に入れるので、
-- 「seq だけ進んで行が書かれていない」も「行はあるのに seq が古い」も作れない。
CREATE TABLE IF NOT EXISTS cursor (
  only_row INTEGER PRIMARY KEY CHECK (only_row = 1),
  n INTEGER NOT NULL
);
INSERT OR IGNORE INTO cursor (only_row, n) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  -- 削除の記録。NULL でなければ削除済み。**行そのものは消さない** —
  -- 消すと「消した」という事実が消え、別端末の次の同期でその記録が復活する
  deleted_at TEXT,
  -- 写真が**在るべきか**(端末が宣言した値)。実体の有無ではない。
  -- 本人が写真を外した記録の写真が別端末で復活しないように、明示の 0 で消す
  has_thumb INTEGER NOT NULL DEFAULT 0,
  -- 削除のときは NULL
  body TEXT
);
CREATE INDEX IF NOT EXISTS records_seq ON records (seq);

-- 手動紐付け。**records だけ同期すると片方の端末でだけ `寫楽` が未紐付けに戻る**
-- (紐付けは「銘柄表記 → brandId」の判断で、記録1件に閉じない)。
CREATE TABLE IF NOT EXISTS aliases (
  key TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  body TEXT
);
CREATE INDEX IF NOT EXISTS aliases_seq ON aliases (seq);

-- サムネイル。**records と別の表にする。**
--
-- 同じ表に置くと、記録の変更より先に写真だけを送れない(行がまだ無い)。順序を
-- 「写真 → 記録」にできないと、記録が見えてから写真が届くまでの隙間に別端末が同期したとき、
-- その端末は**写真の無い記録を保存したまま二度と取りに来ない**(記録がもう変わらないので)。
-- 別表なら記録の行が無くても先に置ける。
--
-- 長辺400px / 50KB以下 × 203件 = 約10MB。D1 の容量からは当面問題にならない
-- (数百MBに向かうなら R2 へ移す判断を PHASE_8 に書いてある)。
CREATE TABLE IF NOT EXISTS thumbs (
  id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  bytes BLOB NOT NULL
);

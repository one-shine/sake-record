---
name: spec
description: 新機能の要件を AskUserQuestion で interview し、自己完結の仕様を docs/SPEC.md に書き出す。大きめの機能の着手前に /spec で呼ぶ
disable-model-invocation: true
---

新機能の仕様を固める。対象: $ARGUMENTS

1. AskUserQuestion を使って要件を interview する。技術実装・UI/UX・エッジケース・トレードオフなど、本人が見落としがちな難所を掘る。自明な質問はしない。
2. 一通り埋まるまで質問を続ける。
3. `docs/SPEC_TEMPLATE.md` の構成に沿って `docs/SPEC.md` を自己完結形で書く: 目的/背景・スコープ(やらないこと含む)・対象ファイル/IF・受け入れ基準・**end-to-end 検証手順**。
4. 仕様が固まったら、実装はクリーンな文脈の新規セッションで行うよう促す(精緻なSPECは監視時間より割に合う)。

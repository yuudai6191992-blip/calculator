# Civil City Simulator - アーキテクチャ設計書

## 1. 全体構成

Vanilla JavaScript（ES6 Modules）によるモジュール分割アーキテクチャ。
フレームワーク非依存で、将来のReact/Vue移行やThree.js/MapLibre統合を阻害しない設計。

```
┌─────────────────────────────────────────┐
│                 main.js                  │
│        （ゲームループ・統括制御）           │
└──┬──────┬──────┬──────┬──────┬──────┬──┘
   │      │      │      │      │      │
┌──▼──┐┌──▼───┐┌─▼────┐┌─▼───┐┌─▼───┐┌─▼──┐
│map  ││simul ││trans ││infra││disas││ai  │
│.js  ││ation ││porta ││struc││ter  ││.js │
│     ││.js   ││tion  ││ture ││.js  ││    │
└──┬──┘└──┬───┘└─┬────┘└─┬───┘└─┬───┘└─┬──┘
   │      │      │       │      │      │
┌──▼──────▼──────▼───────▼──────▼──────▼──┐
│          data.js（共有定数・定義）          │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│    ui.js（DOM描画・イベントログ・モーダル）   │
│    economy.js（予算・税収・LCC・B/C）       │
└─────────────────────────────────────────┘
```

## 2. モジュール責務

| モジュール | 責務 |
|-----------|------|
| `data.js` | 建物定義・ゲーム定数・イベント定義（単一の真実の源） |
| `map.js` | グリッド管理・セル描画・建設/撤去・BFS接続判定・老朽化 |
| `economy.js` | 予算・税収・維持費・地価・経済効果・B/C計算 |
| `simulation.js` | ターン進行・人口・幸福度・CO2・KPI集約 |
| `transportation.js` | 交通量・渋滞・道路網評価・交通利便性 |
| `infrastructure.js` | 河川生成・上下水道・老朽化率・更新費・LCC |
| `disaster.js` | 災害リスク計算・災害発生・ハザードマップ |
| `ai.js` | KPI/マップ分析による都市診断・提言生成 |
| `ui.js` | 建設メニュー・KPIパネル・ログ・モーダルのDOM操作 |
| `main.js` | 初期化・モジュール間の配線・ゲームループ |

## 3. データフロー

1ターンの処理順序（`main.js: nextTurn()`）:

```
transportation.processTurn()  → 渋滞・交通利便性
infrastructure.processTurn()  → 水道・老朽化・更新費
disaster.processTurn()        → リスク計算・災害判定
applyPolicies()               → PPP/PFI効果
simulation.nextTurn(extras)   → 人口・幸福度・経済・KPI集約
refreshUI()                   → ヘッダー・KPIパネル・AI診断の再描画
```

各サブシステムの結果は `extras` オブジェクトとして simulation に渡され、
KPIとして一元管理される（疎結合）。

## 4. 状態管理

- ゲーム状態は各クラスインスタンスが保持
- `map.grid` が都市の物理状態の単一の真実の源
- 各セル: `{ x, y, type, age, level }`
- `serialize()/deserialize()` によりJSON保存・復元可能

## 5. 将来拡張の設計指針

### GIS統合（OpenStreetMap / PLATEAU / 国土数値情報）
- `map.js` のグリッドは抽象化されており、セル→緯度経度変換レイヤーを追加すれば
  MapLibre GL JS のタイル上へ投影可能
- `data/sample-city.json` の形式は実データ変換の受け皿

### 3D表示（Three.js）
- `map.render()` はDOM描画に閉じているため、
  同じ `grid` データを読むThree.jsレンダラーへ差し替え可能

### バックエンド（Supabase / Node.js）
- `serialize()` の出力をそのままSupabaseに保存する設計
- リアルタイム交通・気象データはターン処理の `extras` に注入する形で統合

## 6. コーディング規約

- ES6クラスベース、1ファイル1クラス
- コメントは日本語で処理の意図を記述
- マジックナンバーは `data.js` の定数へ集約
- DOM操作は `ui.js` と `map.js` に限定

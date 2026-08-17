# Sky Run（`pg-skyrun`）

3D 環道飛行模擬——Playgrounds **`kind: game`** 小品。

類型：**飛行／街機** · 系列建議：街機

## 遊玩

純 HTML／CSS／JavaScript（無 build）。經 Playgrounds 場殼或 go 開啟（`window.PG` 由宿主注入）。

- 收集 **12 個能量環**即完成任務
- 燃料隨時間消耗；能量環回少量燃料，綠色燃料箱回大量
- 撞上岩柱或壁面＝機體 −1（共 3）；機體歸零＝任務失敗
- 燃料歸零＝任務失敗
- 分數＝環 ×100＋完成獎（勝利）＋時間獎（勝利）− 撞擊罰 50／次
- 加速（BOOST）提速但加倍耗油
- 最高分存於 `PG.kv`

## 操控

| 動作 | 桌面 | 手機 |
| --- | --- | --- |
| 轉向 | `W A S D`／方向鍵 | 左下搖桿 |
| 加速 | `Space`／`Shift` | 右下 BOOST 大鈕 |
| 暫停 | `P`／`Esc` | 右上按鈕（切離頁面自動暫停） |

## 開發

```bash
npx vitest run
```

- `rules.js` — 純規則函式（無 DOM；測試對象）
- `scene.js` — Three.js 視覺層（經 `PG.libs.load("three")`）
- `app.js` — 啟動、輸入、循環、`PG.kv`、頁內 UI
- `tests/rules.test.js` — 規則測試

## 署名

見 [ATTRIBUTION.md](./ATTRIBUTION.md)。

## License

MIT

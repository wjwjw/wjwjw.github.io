# h5-games/assets —— 共享素材仓库

跨游戏公共素材统一放这里，避免每个游戏重复打包。

## 放什么
- `bg/` 通用背景图（星空、草地、暗色渐变等）
- `sfx/` 通用音效（`click.mp3`、`confirm.mp3`、`back.mp3`、`win.mp3`、`lose.mp3`）
- `icons/` 通用 UI 图标（用 SVG/PNG，**不要依赖 emoji 字体**，见 STANDARD.md §6）
- `fonts/` 如需统一字体

## 怎么引用
游戏内用相对路径：`../assets/sfx/click.mp3`、`../assets/bg/space.png`。
本地（开发机 IP 服务器）与正式（GitHub Pages）都按相同相对结构解析，无需改路径。

## 约定
- 资源走 Git 跟踪（纯静态，无构建步骤）。
- 控制体积：旧电视设备内存有限，单图建议 < 200KB，音频用短 mp3。
- 新增公共素材后，在 `docs/README.md` 的「共享资源清单」补一行说明。

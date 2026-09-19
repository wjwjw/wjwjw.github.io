# h5-games/assets —— 共享素材仓库

跨游戏公共素材统一放这里，避免每个游戏重复打包。

## 放什么
- `bg/` 通用背景图（星空、草地、暗色渐变等）
- `sfx/` 通用音效（`click.mp3`、`confirm.mp3`、`back.mp3`、`win.mp3`、`lose.mp3`）
- `icons/` 通用 UI 图标（用 SVG/PNG，**不要依赖 emoji 字体**，见 STANDARD.md §6）
  - `icons/` 下已有一套**九枚像素风游戏图标**（数字跑酷 / 迷宫闯关 / 火眼金睛 / 记忆翻牌 /
    小小达人 / 拼图乐园 / 贪吃蛇 / 3D 俄罗斯方块 / 新游戏待定），
    每枚含 `.svg` + `.png`(64) + `@2x.png`(128)。
    规格与设计说明见 `icons/SPEC.md`，总览页 `icons/preview.html`，
    重新生成：`cd icons && python build_icons.py`。
- `fonts/` 如需统一字体

## 怎么引用
游戏内用相对路径：`../assets/sfx/click.mp3`、`../assets/bg/space.png`。
本地（开发机 IP 服务器）与正式（GitHub Pages）都按相同相对结构解析，无需改路径。

启动器引用图标（相对 `tv-h5-app/index.html`）：`../h5-games/assets/icons/<id>.svg`。

## 约定
- 资源走 Git 跟踪（纯静态，无构建步骤）。
- **例外**：`icons/build_icons.py` 是图标生成脚本，不是运行时资源 ——
  它只是把「像素网格 → SVG/PNG」这一步变成可重复、可 diff 的动作，
  站点运行不依赖它，产物（svg/png）照常入库。
- 控制体积：旧电视设备内存有限，单图建议 < 200KB，音频用短 mp3。
- 新增公共素材后，在 `docs/README.md` 的「共享资源清单」补一行说明。

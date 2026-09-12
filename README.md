# wjwjw 的博客与作品集

> 个人 GitHub Pages 站点，收录一些小作品与开发笔记。

- 在线访问：<https://wjwjw.github.io>
- 主页风格：草稿纸手写风（纯内联 CSS，无外部框架依赖）

## 作品导航

| 项目 | 说明 | 入口 |
| --- | --- | --- |
| 掌中灵 TV 游戏厅 | 运行在 Android 电视上的 H5 游戏启动器，遥控器导航、即点即玩 | [tv-h5-app/index.html](tv-h5-app/index.html) |
| 迷宫闯关 · 像素冒险 | 手绘 canvas 像素风迷宫，方向键 / WASD 移动闯关 | [h5-games/maze-challenge/index.html](h5-games/maze-challenge/index.html) |
| 火眼金睛 · 找不同 | 程序化生成的找不同，方向键移动取景框，OK 标记差异 | [h5-games/spot-difference/index.html](h5-games/spot-difference/index.html) |
| 记忆翻牌 · 配对 | 预览 → 扣牌 → 方向键移动高亮框，OK 翻两张相同的图案配成一对 | [h5-games/memory-match/index.html](h5-games/memory-match/index.html) |
| 小小达人 · 认知问答 | 看图选答案：认形状 / 认颜色 / 认动物 / 比大小 / 找不同 / 数一数，不识字也能玩 | [h5-games/kids-quiz/index.html](h5-games/kids-quiz/index.html) |
| 拼图乐园 · 滑动拼图 | 方向键把打乱的画推回原样，3×3 → 4×4，6 个手绘场景轮换 | [h5-games/puzzle-slide/index.html](h5-games/puzzle-slide/index.html) |
| 3D 俄罗斯方块 | 基于 three.js 的 3D 俄罗斯方块，鼠标旋转视角 | [threejs-brick-game/index.html](threejs-brick-game/index.html) |
| 网页 URL 测速工具 | 一键测速，查看网页资源加载耗时与顺序 | [url-speed-test/index.html](url-speed-test/index.html) |

## 站点结构

- `index.html` — 站点主页（草稿纸手写风，纯内联 CSS）
- `tv-h5-app/` — 掌中灵 TV 游戏厅启动器（H5 壳 + 原生 WebView 外壳）
  - `index.html` / `css/` / `js/`（菜单、遥控导航、iframe 加载游戏）
  - `android/` — 原生 App 源码与 APK，**本地保留，不入库**
  - `README.md` / `GAME_DEV_GUIDE.md` — 启动器说明与新游戏接入指南
- `h5-games/` — 所有 H5 游戏
  - `maze-challenge/` — 示例游戏（迷宫闯关）
  - `number-runner/` — 3D 数字跑酷（three.js）
  - `spot-difference/` — 找不同（纯 Canvas 矢量绘制，场景每局随机生成）
  - `memory-match/` — 记忆翻牌配对（预览-扣牌-翻相同图案）
  - `kids-quiz/` — 小小达人认知问答（7 种题型全图形化，低龄儿童不识字也能玩）
  - `puzzle-slide/` — 拼图乐园滑动拼图（3×3→4×4，6 个矢量场景，打乱必定可解）
  - `docs/STANDARD.md` — TV 游戏开发规范（目录结构、输入契约、兼容性约束）
  - `start-server.bat` / `start-server.sh` — 本地开发服务器（电视通过局域网 IP 访问）
- `threejs-brick-game/` — 3D 俄罗斯方块（three.js）
- `url-speed-test/` — 网页测速工具

## 本地预览

根目录 `start.bat` 会启动 `python -m http.server 8000` 并打开浏览器，访问 <http://localhost:8000> 即可预览整站。

TV 游戏厅联调请改用 `h5-games/start-server.bat`（电视通过开发机局域网 IP 访问游戏）。

## 说明

- 主页为纯静态、内联样式，兼容老旧 WebView（未使用 `grid` / `gap` / `min()` / `clamp()` / `inset` / `color-mix` 等较新特性）。
- `tv-h5-app/android/` 为原生 App 源码与产物，**仅本地保留，不提交入库**。
- 站点由 GitHub Pages 自动发布，推送到 `master` 即上线。

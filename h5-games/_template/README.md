# 新游戏脚手架（_template）

复制本目录 → 重命名为你的游戏 id（kebab-case）→ 实现玩法 → 在 `tv-h5-app/js/config.js` 登记。

## 已示范的契约（对照 STANDARD.md）
- 入口 `index.html` 可直接打开运行（不依赖启动器）。
- 用 `../shared/input.js` 的 `TVInput` 归一化方向键/WASD/OK。
- 用 `../shared/nav.js` 的 `TVNav` 做 standalone 菜单焦点导航（启动器内由 tv-controls 自动接管）。
- 画布随 `resize` 自适应（见 `resize()`）。
- 主按钮 `autofocus`，OK 可激活。
- 未使用 ES module / `inset` / `color-mix` / emoji 核心图形，兼容 MiTV4A（Android 6）。
- 资源用相对路径；公共素材走 `../assets/`。

## 你只需要改
- `main.js` 里的玩法逻辑（这里是「移动到目标得分」占位）。
- `style.css`、私有素材。
- `index.html` 里的标题 / 文案。

做完后，把 `config.js` 里该游戏的 `completed` 设为 `true`。

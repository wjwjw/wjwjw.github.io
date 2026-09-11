# H5 游戏开发规范（核心）

**版本 v0.2 · 补充无指针玩法（网格取景框）与覆盖层动画的实战结论**

## 0. 一句话原则
每个游戏都是「能被电视遥控器玩、能单独打开运行、不依赖启动器」的静态网页。引擎不限，但必须满足下面的**契约**。

## 1. 目录结构
```
h5-games/
├── docs/                 # 本规范（README.md + STANDARD.md）
├── shared/               # 跨游戏共享最小代码（input.js / nav.js / base.css）
├── assets/               # 跨游戏共享素材（背景/音效/图标/字体）
├── _template/            # 新游戏脚手架（复制即用）
└── <game-id>/            # 每个游戏一个目录
    ├── index.html        # 入口（必须）
    ├── style.css
    ├── js/ 或 *.js
    └── （私有素材可放 images/ audio/ 等子目录）
```
- 游戏之间**互不可见**：不要从一个游戏目录引用另一个游戏的私有文件；公共的走 `../shared/` 和 `../assets/`。
- 启动器代码在 `tv-h5-app/`，游戏不要放进去。

## 2. 游戏 ID 与命名
- `kebab-case` 英文小写、唯一，建议与目录同名（如 `maze-challenge`）。
- 用作 `config.js` 的 `id` 与 `folder`，也决定菜单展示顺序。

## 3. 入口与「独立可运行」
- 必须有 `index.html`，且**直接双击/打开它就能玩**（不依赖启动器注入的变量、不依赖 query 参数才能运行）。
- 资源引用一律**相对自身**（`style.css`、`js/main.js`、`images/x.png`）；公共的用 `../shared/...`、`../assets/...`。
- 不要把游戏逻辑写死依赖父页面（`window.top` / `parent` / `opener`）。
- 在 iframe 中（启动器内）加载时，同源情况下启动器会注入 `tv-controls.js` 增强遥控；游戏自身应**不假设**一定被注入。

## 4. 输入契约（电视遥控，最重要）
电视遥控器 = 方向键(D-pad) + OK + 返回。启动器把遥控键映射成标准键盘事件转发给游戏，所以游戏必须「键盘友好」：

✅ **必须做**
1. **主操作绑定方向键 + WASD**
   遥控器方向键 = `ArrowUp/Down/Left/Right`；很多遥控器也映射 `W/A/S/D`。推荐直接用 `shared/input.js` 的 `TVInput.on('dir', cb)`，已归一化大小写 WASD 与方向键：
   ```js
   TVInput.on('dir', (dir) => { /* dir: 'up'|'down'|'left'|'right' */ });
   ```
2. **可激活主按钮（开始/下一关/返回）**
   界面出现时主按钮 `autofocus` 或 JS `.focus()`，使遥控器 OK（= `Enter`/`Space`）能激活。OK 事件从 `TVInput.on('confirm', cb)` 拿。
3. **菜单/选择界面可遥控导航**
   可点元素用 `<button>` / `<a>` 或带 `tabindex`、标记 `data-tv-focus` 的 div；启动器注入的 `tv-controls.js` 会自动做空间导航。standalone 时可用 `shared/nav.js` 的 `TVNav`。
4. **返回键可退出/回上层**
   优先用 `history.pushState` + `popstate` 陷阱捕获返回（参考 maze 的 `setupBackButtonTrap`）。**注意每次 `popstate` 后要重新 `pushState` 占位**，否则第二次按返回就真的离开了（见 §6）。启动器内返回由 launcher 统一处理（关闭游戏 iframe），游戏内可再用页面按钮兜底；用 `window.__tvControlsInjected` 判断是否在启动器内，在启动器内不自己装陷阱。

❌ **不要做**
- 不要把「只能鼠标拖动 / 触屏滑动」作为**唯一**玩法（遥控器无指针）。触屏/鼠标可作**附加**。
- 不要依赖系统 emoji 字体做核心画面（见 §6）。

> 💡 **无指针玩法怎么设计（实战结论）**：找不同、拼图、点选这类天然依赖指针的玩法，
> 可用「**网格取景框**」代替鼠标——把画面切成 N×M 网格，方向键在格子间移动高亮框，
> OK 判定当前格。参考 `spot-difference`（7×4 网格，`Scenes.GRID_COLS/ROWS`）。
> 要点：① 格子别太密（7×4 左右，10-foot 距离下看得清）；② 判定给一点容差
> （光标格中心到目标的「格子距离」< 0.72 即算命中，保证同格必中、相邻格不误判）；
> ③ 方向键加 100~130ms 防抖，否则老 WebView 的 auto-repeat 会一次连跳多格；
> ④ **目标要落在格子中心附近**，否则取景框明明盖住了、看起来却没「选中」，手感很别扭。
> 最省事的做法是**生成时就按格子中心摆**：先建一张 N×M 的空格子表，一格只放一件东西，
> 位置取「格子中心 ± 0.22 格」的小抖动（既居中又不像摆好的棋盘），而不是先随机撒点、
> 事后再把目标往中心搬——场景一挤，「搬过去就撞到别的物件」，回退率会高得离谱。
> ⑤ 关卡主题/背景要与网格对齐（如地平线放在第 2 行中心高度），
> 否则吸附到格子中心的地面物件会「浮在半空」。

## 5. 画布与自适应
- 画布尺寸跟随窗口：`resize()` 里按 `window.innerWidth/innerHeight` 计算，并监听 `resize`：
  ```js
  function resize() {
    const maxW = Math.min(window.innerWidth * 0.96, 1100);
    const maxH = window.innerHeight * 0.8;
    // 计算 TILE / canvas 尺寸，设置 canvas.width/height（含 devicePixelRatio）与 style
  }
  window.addEventListener('resize', resize); resize();
  ```
- 设计基准视口约 **960×540** 逻辑像素（1080p @ 密度 2x 下 WebView 逻辑像素），但必须自适应任意尺寸，**不写死像素**。
- 文字/可聚焦目标足够大（10-foot UI）：最小可聚焦尺寸 ≥ 设计稿 44–48px。

## 6. 兼容性约束（目标设备 MiTV4A / Android 6 / WebView ≈ Chromium 47）
这是最容易踩的坑。以下特性**在目标电视上不可用或表现异常**，请避免：

| 特性 | 状态 | 替代 |
|------|------|------|
| ES Module (`import`/`export`) | ❌ 不支持(Chrome 47) | 用经典 `<script src>` + IIFE / 全局变量 |
| `display: grid` / CSS Grid 布局 | ❌ 不支持(Chrome 57+) | 用 `display:flex;flex-wrap:wrap` + 子元素固定宽度（如 `width:calc(20%-10px)` 模拟 N 列） |
| `gap` 属性（flexbox 容器上） | ❌ 不支持(Chrome 84+) | 用子元素 `margin` 替代（如 `.container > *{margin:6px;}`） |
| `min()` / `max()` / `clamp()` CSS 函数 | ❌ 不支持(Chrome 79+) | 用固定值 + `max-width` 组合替代（如 `width:560px;max-width:94vw`） |
| `inset: 0` | ❌ 不生效 | 用 `top/right/bottom/left: 0` |
| `color-mix()` | ❌ 不生效 | 用 `rgba(...)` 或半透明叠层 |
| 系统彩色 emoji 字体（😀❤️🍌） | ⚠️ 渲染成 □ 方框 | 用 canvas 形状绘制或 PNG/SVG 图片素材 |
| `backdrop-filter` / 复杂滤镜 | ⚠️ 性能差/不支持 | 避免或用纯色替代 |
| `fetch` 跨域 / 模块 | ⚠️ 受限 | 同域静态资源即可；勿跨域 |

✅ **可用**：Canvas 2D、`requestAnimationFrame`、`localStorage`、`addEventListener`、classic `<script>`、**CSS Flexbox（不含 gap）**、`transform`/`opacity`/`calc()`、`pushState`/`popstate`、`@media` 查询。

> 补充（实测）：Canvas 的 `ctx.ellipse()`、`ctx.setLineDash()`、`ctx.createLinearGradient()`、
> `ctx.quadraticCurveTo()`、`ctx.clip()` 在 Chrome 47 上均可用，程序化矢量绘图不受限。
> 另外，静态画面建议**预渲染到离屏 canvas**，每帧只 `drawImage` + 叠加动态元素——
> 画面元素多（几十个图形）时能明显减轻老设备负担，`spot-difference` 即采用此做法。

> 补充（界面过渡动画）：`@keyframes` / `animation` / `transition` / `transform` / `opacity` /
> `animation-fill-mode` 在 Chrome 47 上都可用，覆盖层做「渐入 + 轻微上浮」没问题
> （`spot-difference` 的 `.overlay.anim-in`）。两个坑：
> ① 同一个元素第二次显示时动画不会自动重播，要**先摘类 → 强制回流（读一次 `offsetWidth`）
> → 再加类**；
> ② 动画驱动的是合成/动画时钟，与主线程的 `requestAnimationFrame` 绘制循环是两条线。
> 在弱机（或 headless 虚拟时钟）下，如果主线程被绘制循环占满，动画可能长时间停在起始帧
> ——若起始帧是 `opacity: 0`，用户就会看到一张「看不见的卡片」，等于卡死。
> **务必加 JS 兜底**：显示后 700ms 左右把动画类摘掉，让元素回落到「完全可见」的基础样式。
> ③ **覆盖层本身不要用 `opacity` 做渐入**。启动器注入的 `tv-controls.js` 用
> `getComputedStyle(el).opacity === "0"` 判断元素「是否可见」，据此决定自动聚焦哪个按钮。
> 若覆盖层父节点带着 `opacity: 0` 的动画起始帧，`isVisible()` 会把里面所有按钮判为不可见，
> 自动聚焦直接失效（遥控器 OK 没反应）。做法：让**父覆盖层只动 `background-color`**
> （`@keyframes` 只写 `from { background-color: rgba(0,0,0,0); }`，终态自动取元素自身底色，
> 这样带主题底色的覆盖层也能正确参与），把 `opacity` + `translateY` + `scale` 的渐入
> 放到**子卡片**上；同时在显示覆盖层后，用 JS 主动给 `data-tv-focus` 的第一个元素 `.focus()` 兜底。
>
> 补充（返回键陷阱）：`history.pushState` + `popstate` 做返回键拦截时，**每次 `popstate` 触发后
> 都要重新 `pushState` 占位**——否则用户第二次按返回就会真的离开页面/退出游戏。
> 另外在 TV 启动器内不要自己装陷阱（启动器会用 `evaluateJavascript('TVLauncher.handleBack()')`
> 统一处理返回键），可用 `window.__tvControlsInjected` 判断是否处于启动器环境并跳过。

> ⚠️ 实测：MiTV4A（Android 6 / WebView≈Chromium 47）**不支持系统彩色 emoji**，会渲染成 □ 方框。本仓库 `maze-challenge` 最初用 emoji 画爱心/香蕉/冰墙/弹簧、HUD 血量、菜单图标，在真机上全部成方框——**已整改为 canvas 矢量绘制 / inline SVG / 文字符号（★☆♪✦✕）**。新游戏请一律避免用 emoji 做核心图形，统一走 `assets/` 图片或 canvas 程序化绘制；菜单图标用文字符号或图片。

## 7. 资源约定
- **公共素材** → `h5-games/assets/`（背景图、通用按钮音 `click.mp3`、图标、字体）。游戏用 `../assets/...` 引用，本地与 GitHub 都通。
- **私有素材** → 游戏自己目录（如 `images/`、`audio/`），相对自身引用。
- 图片优先 SVG/PNG；音频用 `<audio>` 或 WebAudio；注意体积（旧设备内存有限）。
- 音频自动播放限制：在用户首次交互（点击「开始游戏」/OK 触发的 click）后再 `resume()` / 起 BGM。

## 8. 接入 TV 启动器（config.js）
打开 `tv-h5-app/js/config.js`，在 `games[]` 追加：
```js
{
  id: "my-game",
  title: "我的游戏",
  subtitle: "一句话说明",
  icon: "🎮",            // 见 §6：电视上 emoji 会成方框，正式可用图片路径
  folder: "my-game",     // h5-games/ 下目录名
  entry: "index.html",
  completed: false,      // ★ 总开关：做完设 true；未完成设 false（菜单只占位）
  color: "#5a8dee",      // 卡片主题色(可选)
  tvControls: true       // 是否注入遥控增强(可选,默认 true,仅同源)
}
```
- `completed` 是「游戏是否完成」开关：`false` → 菜单显示「即将推出」、不可进入；`true` → 可玩。
- 本地/正式切换由 `useRemote` 与 `?local=` / `?remote=` 控制，游戏无需感知。

## 9. 验收清单（发布前）
- [ ] `h5-games/<id>/index.html` 存在，直接打开可独立运行。
- [ ] 方向键 + WASD 能操作（不只鼠标）。
- [ ] 主按钮出现时自动聚焦，OK(`Enter`/`Space`) 能激活。
- [ ] 菜单/选择界面能用方向键导航、OK 进入（standalone 与启动器内都行）。
- [ ] 画布随 `resize` 自适应，在 960×540 逻辑视口正常。
- [ ] 未使用 §6 禁用的特性（无 ES module / `inset` / `color-mix` / 系统 emoji 核心图形）。
- [ ] 覆盖层有渐入过渡，且带 JS 兜底 —— 动画没跑完也不会停在半透明/不可见状态。
- [ ] 覆盖层父节点没有用 `opacity` 做渐入（否则启动器自动聚焦会失效），且在启动器内主动 `.focus()` 兜底。
- [ ] 返回键陷阱每次 `popstate` 后都重新占位（连按两次返回仍不离开游戏）。
- [ ] 网格取景框类玩法：目标都落在格子中心附近（生成时按格子中心摆）。
- [ ] 已在 `config.js` 登记，且 `completed` 状态正确。
- [ ] 音频在用户首次交互后正常播放；返回键可退出/回上层。

## 10. 如何演进
- 每开发一款游戏，把新坑 / 新需求补进本文档对应章节。
- 跨游戏可复用代码 → `shared/`，公共素材 → `assets/`，并在 `docs/README.md` 清单登记。
- 重大变更递增版本号；破坏性变更在提交说明里标注。

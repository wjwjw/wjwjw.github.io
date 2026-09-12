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
>
> 💡 **翻牌类动画（memory-match 实战）**：卡牌用「**scaleX 在 0~1 之间往返**」模拟翻面，
> 起点 f=0（背面），先缩到 0 再展到 1（正面），中途 f=0.5 处换面贴图。
> 关键细节：① 选中框画在缩放变换**之外**，翻牌时不会被压扁；
> ② `easeInOutQuad(p)` 比线性自然；③ 翻面期间**禁用 OK**，否则会在中途错翻。
> 另外，**预览阶段被返回键暂停**的话，恢复时要把 `peekUntil` 整体后移
> `Date.now() - pauseStart`，否则会跳过剩余预览、白送答案。
>
> 💡 **选择题/问答类（kids-quiz 实战）**：把选项摆成 **2×2 网格**，方向键移动高亮框、
> OK 选定——四个格子足够少，不识字的低龄儿童也能玩，且完全不需要指针。
> 要点：① **每题都把光标归位到 0 号（左上）**，否则孩子一上来找不到框在哪；
> ② 判定停留时间分长短：答对 850ms、答错 1350ms（答错要留时间看清正确答案），
> 停留期间**允许按 OK 跳过**（不想等就翻页）；
> ③ 答错时除了给选中项打红叉，**还要把正确答案圈出来**，否则错了也不知道错在哪；
> ④ 暂停时若正处在判定停留中，恢复要把 `resolveUntil` 后移，别让暂停变成惩罚。
>
> 💡 **出题器的「防蒙」设计（kids-quiz 实战）**：图形选择题最大的坑是**干扰维度没控制住**
> ——题干「红色的圆」，四个选项里只有一个是红圆、其余颜色形状都不同时，孩子靠
> 「哪个最像」也能蒙对，题目就废了。正确做法是**一次只考一个维度**：
> 考形状 → 所有选项**颜色统一且与题干不同色**（只能靠形状选）；
> 考颜色 → 所有选项**形状统一且与题干不同形**（只能靠颜色选）。
> 「找不同」类则反过来要求**三同一异**：三个干扰项必须在被考维度上完全一致。
> 题干那行汉字只是给家长看的，孩子靠图形就该能作答。
>
> ⚠️ **canvas 与 DOM 覆盖层的坐标冲突（kids-quiz 实战）**：题干和选项是画在 canvas 上的，
> HUD / 提示气泡是 DOM，**两套坐标系各算各的，谁也不会自动给谁让位**。
> 实测：反馈气泡放在 `#hud` 里走文档流，会把 canvas 上的题干文字顶下去/盖住；
> 改成 `position:absolute` 脱离文档流后，又反过来压住下排选项。
> 结论：**凡是 DOM 覆盖层压在 canvas 上，两边都要显式留位**——
> canvas 侧的 `computeLayout()` 里给底部留白加上气泡占位（`TOAST_RESERVE`），
> 不能靠「看起来不重叠」。这类问题纯 Node 的冒烟测试测不到，必须量化验收（见 §6 末尾）。
>
> 💡 **拼图 / 推箱子类（puzzle-slide 实战）**：棋盘就是 N×N 网格，方向键天然对应，
> 一次按键走一步，是最省事的遥控器玩法之一。四条经验：
> ① **方向语义选「方块滑动的方向」**（按「右」＝空格左边那块往右滑），
> 不要选「空格移动的方向」——后者会让玩家按了往反方向走，挫败感极强；
> 这条语义要写成独立函数（`Puzzle.sourceIndex`）并在测试里专门断言。
> ② **打乱必须从完成态反向走 N 步合法移动**，结果必然可解；
> 「随机排列 + 判奇偶」会有一半局面无解，孩子永远拼不出来。
> 打乱时还要**不走上一个方向的反向**，否则原地来回抖等于没打乱。
> ③ **降低挫败感的四个设计**：常驻目标缩略图（随时对照）、按 OK 看大图、
> **归位的块描绿边 + 能动的方向描黄边**、滑不动时抖一下并给闷响。
> ④ 滑块动画不要改逻辑状态——棋盘数组直接更新为「移动后」，
> 动画块单独记 `{to, fromR, fromC, toR, toC, start}`，渲染时跳过目标格、按插值补画；
> 连按方向键时直接丢弃上一次动画（`anim = null`），手感更跟手。

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
> 补充（**headless 截图调试**：Chrome `--headless=new --virtual-time-budget` **不会触发
> `requestAnimationFrame`**，但 `setTimeout` / `Date.now()` 会被加速 —— 实测 frames=0、
> Date.now() 推进 5000ms。
> 如果游戏主循环挂在 rAF 上，`--virtual-time-budget` 截图永远停在「第一帧」，
> 看起来像 bug，实际是 headless 假象。**改用真实时钟 + Chrome DevTools 协议**
> （Node 22 内置 WebSocket 起 `--remote-debugging-port=9222` → `Page.navigate`
> → `Runtime.evaluate` 模拟按键 → `Page.captureScreenshot`）就稳了。
> `memory-match/test/shot.js` 是一份可复用的脚手架。
>
> 补充（**排版几何量化验收**：截图只能靠肉眼看，回归时很容易漏。做法是用同一套 CDP
> 把「量」取回来做断言，`kids-quiz/test/layout.js` 是模板：
> ① DOM 侧用 `getBoundingClientRect()` 拿覆盖层矩形；
> ② canvas 侧用 `ctx.getImageData()` **按填充色扫像素**求包围盒
> （选项卡填充 `#FFFCF2` → 判 `r>240 && g>235 && b>220`，注意把 dpr 除回去），
> 这样不依赖游戏内部的 layout 变量，**像素是最终真相**；
> ③ 断言两者不相交、矩形都在视口内、单个可聚焦目标 ≥44px。
> 配合 `Emulation.setDeviceMetricsOverride` 一次跑多个视口（1280×720 / 960×540 / 640×420）。
>
> 补充（**接入验收**：冒烟测试只证明游戏自己能跑，还要证明「接入是对的」。
> `kids-quiz/test/in-launcher.js` 用 CDP 打开 `tv-h5-app/index.html?local=<本地服务>`，
> 断言菜单里出现了新条目、用 config 里的 `folder/entry` 拼出的地址能装进 iframe、
> 且 iframe 内部的关键全局（如 `Art`/`Quiz`/`TVInput`）都挂上了 —— 最后一条能拦住
> 「路径写错但 404 页也能渲染」这类哑火。
>
> 补充（**程序化图源的自检**：画面全是 Canvas 矢量绘制时，「某个场景画成了一块纯色」
> 在截图里很难一眼看出来。用同一套 CDP 把场景画进一张小离屏 canvas，
> **采样 10×10 个点统计不同颜色的种类数**——只有 1~2 种就说明画挂了；
> 正常场景一般十几到二十几种。`puzzle-slide/test/layout.js` 的「图源自检」段是模板。
> 同理，若某块画面是靠 `drawImage` 从离屏画布**切片**贴上去的，
> 要在目标区域采样验证「真的有内容」，否则切片坐标算错会退化成纯色矩形。
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
- [ ] 选择题类：一次只考一个维度（干扰项在被考维度外保持一致），不存在「靠像不像蒙对」。
- [ ] DOM 覆盖层不遮挡 canvas 内容，且 canvas 布局已为覆盖层预留空间（多视口量化验收）。
- [ ] 已在启动器内实测：菜单能进、iframe 内脚本全部加载、无 404。
- [ ] 拼图/推箱子类：打乱是从完成态反向走合法步（结果必定可解），且打乱后不是完成态。
- [ ] 方向键语义经过断言（是「方块滑动方向」还是「空格移动方向」，别搞反）。
- [ ] 程序化绘制的画面做过「有内容」自检（采样颜色种类数），不是一片纯色。
- [ ] 已在 `config.js` 登记，且 `completed` 状态正确。
- [ ] 音频在用户首次交互后正常播放；返回键可退出/回上层。

## 10. 如何演进
- 每开发一款游戏，把新坑 / 新需求补进本文档对应章节。
- 跨游戏可复用代码 → `shared/`，公共素材 → `assets/`，并在 `docs/README.md` 清单登记。
- 重大变更递增版本号；破坏性变更在提交说明里标注。

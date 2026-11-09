# 弹球打砖块 · brick-breaker

一款跑在 Android 电视上的儿童向打砖块。方向键按住移动挡板、OK 发球，把画面上方的砖块全部打光就过关，共 6 关。

## 玩法

1. **左右方向键 / A D** 按住移动挡板（不是一次按键走一格，是持续移动）。
2. 发球前有 **3-2-1 预备**，期间挡板可以移动、按 **OK** 可立即发球。
3. 球撞砖块会碎并加分，**连续打中**有连击加成（最高 +50/块）。
4. 带 **金色星星** 的砖块打碎后会掉一颗星，用挡板接住 +30 分；接不住没有惩罚。
5. **球掉下去不会马上结束**，只掉一颗心（共 3 颗），球回到挡板上重新发球。
6. 清空一关先撒彩纸、延后约 1.25s 再弹结算卡；六关全清显示「全部通关啦」。
7. **OK** 在可玩时 = 暂停；**返回键** 游戏中暂停 / 暂停中继续 / 结算页回标题。

## 儿童向改造

| 经典打砖块 | 本作 |
|---|---|
| 掉球即失去一条命、命少 | 掉球只掉心、共 3 颗，掉光才结束 |
| 挡板窄、球速快 | 挡板宽 96~190px，球速 250px/s 起步，逐关 +24，**封顶 420px/s** |
| 开局直接开球 | 3-2-1 预备，掉球后再给 1.3s 宽限，可提前按 OK 发球 |
| 没有额外目标 | 星砖掉星星 +30 分，值得绕路但不惩罚 |
| 角度随机、易卡死 | 反射角钳在离水平 ≥19°、离垂直 ≥20° 的扇区，杜绝水平长循环 |

## 目录结构

```
brick-breaker/
├── index.html          # 入口（可直接双击独立运行）
├── style.css           # 暗色 10-foot UI，兰花紫 + 暖金
├── js/
│   ├── logic.js        # 纯逻辑：反射角 / 挡板反弹 / AABB 命中 / 关卡生成 / 球速曲线
│   ├── audio.js        # 程序化音效 + 轻量 BGM（Web Audio，无外部文件）
│   └── game.js         # 状态机 / 输入 / 物理推进 / 渲染 / 覆盖层
├── test/
│   ├── smoke.js        # 纯 Node 冒烟（149 项断言，含纯逻辑与行为）
│   ├── shot.js         # CDP 真机验收 + 截图 + 像素探针 + 多视口
│   └── in-launcher.js  # 启动器接入验收（config / 菜单 / iframe 内脚本）
└── README.md
```

`js/logic.js` 是刻意拆出来的：物理与关卡生成最容易写错，也最该被断言。它不碰 DOM / Canvas / 计时器，所以 `test/smoke.js` 能直接在 vm 里调函数验证，不用从源码抽片段。

## 实现要点

- **按住持续移动，不靠 auto-repeat**：`shared/input.js` 只给语义 `dir` 事件，没有按下/抬起状态，老 WebView 的重复率也不稳。所以自己监听 `keydown` / `keyup` 维护 `held.left/right`（同时认方向键、WASD、安卓 DPAD keyCode 19~22），在 rAF 里按 `dt` 推进挡板，`blur` 时清空，避免切后台回来挡板一直往一边跑。`TVInput` 的 `dir` 只用于菜单/结算页焦点导航。
- **子步物理**：球速最高 420px/s，一帧会跨过整块砖。按「每子步最多走 0.7 个球半径」把一帧拆成最多 8 个子步，每子步独立做墙 / 挡板 / 砖块判定，每子步最多消一块砖。
- **反射角钳制**：所有反弹（挡板、砖块、发球）统一过 `BrickLogic.clampDir`，返回单位向量且 `|dy| ≥ sin(19°)`、`|dx| ≥ cos(70°)`。挡板按击中位置决定角度（中心陡、边缘平），再叠加一点挡板速度做「搓球」。
- **关卡程序化**：`buildLevel(level)` 用固定种子 LCG 从 6 种图案（实心 / 棋盘 / 金字塔 / 拱门 / 心形 / 波浪）里取，第 3 关起出现 2 血加固砖，每关恰好两颗星砖。零图片素材、可复现、必然可清空。
- **静态画面预渲染**：场地边框、星尘底纹画进离屏 canvas，每帧只 `drawImage`；暗角走 `FX.vignette`。渲染循环里不建渐变、不拼 rgba 字符串（STANDARD §10.3）。
- **特效**：`shared/fx.js` 的 `burst / float / ring / glow / confetti / flash / shake / setAmbient` 分别用于碎砖、连击飘字、接球扩散环、连击柔光、过关彩纸、通关金光、掉球轻震、场地浮尘；震屏只包场地层，不晃 HUD。
- **覆盖层**：父层只动 `background-color`，子卡片才动 `opacity`，避免启动器 `tv-controls.js` 的可见性判断失效；显示后 700ms 摘掉动画类做 JS 兜底。
- **庆祝不锁死**：`pauseGame()` 只认 `play/ready`，过关进入 `clear/win` 后按暂停不会卡住结算卡；`gotoStart()` 会清掉延后弹卡的定时器。
- **返回键陷阱**：`pushState` 占位 + `popstate` 后重新占位；启动器内由 launcher 统一处理，不自己装。

## 兼容性

遵循 `../docs/STANDARD.md`：经典 `<script>`（无 ES module）、纯 ES5、无 CSS Grid / `gap` / `inset` / CSS 变量 / `min()` / `clamp()` / 系统 emoji 核心图形（生命用 `♥♡`）。设计基准视口 960×540，画布随 `resize` 自适应，已在 1280×720 / 960×540 / 640×420 三个视口量化验收。

## 测试

```bash
# 纯 Node（无需浏览器）
node h5-games/brick-breaker/test/smoke.js

# 真机 CDP：先在仓库根起静态服务器
python -m http.server 8010
node h5-games/brick-breaker/test/shot.js E:/tmp/bb-shots
node h5-games/brick-breaker/test/in-launcher.js
```

`shot.js` 默认用 8010 / CDP 9223，`in-launcher.js` 用 CDP 9224（都避开其它游戏的 9222），可用 `BB_HTTP_PORT` / `BB_CDP_PORT` / `BB_LAUNCHER_CDP_PORT` / `CHROME_PATH` 覆盖；`shot.js` 默认截图输出到系统临时目录，不写进仓库。它用 `__brick.freeze(true)` 冻住自动物理推进后手动 `stepBall`，绕开 headless 下 rAF 时钟失真。`in-launcher.js` 会检查 config 条目、菜单标题、图标 200、以及同源 iframe 内 `TVInput / FX / BrickLogic / AudioManager / TVNav` 是否全部挂上（拦住「路径写错但 404 页也能渲染」）。

## 调试钩子

URL 带 `#debug` 时挂 `window.__brick`：`state / level / score / lives / bricksLeft / ball / paddle / bricks / layout / held / clearFinal / logic`，以及 `startGame / launch / setBall / setPaddle / setLevel / hold / movePaddle / stepBall / updatePlay / forceClear / loseBall / freeze / clearFx / render / syncHud`。

## 接入启动器

已在 `tv-h5-app/js/config.js` 登记，图标 `../assets/icons/brick-breaker.svg`，`color` 与图标 `accent` 一致。

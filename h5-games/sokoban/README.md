# 推箱子（sokoban）

经典推箱子：方向键移动搬运工，把所有箱子推上目标点。箱子只能推、不能拉，
推进死角就无解——所以先想后走。共 18 关，全部经离线求解器校验可解。

## 玩法与功能

- **核心**：方向键 / WASD / 遥控方向键 / 触屏滑动移动；OK 或「暂停」按钮暂停。
- **撤销（无限次）**：HUD「撤销」按钮或 `U` 键；撤销会同步回退步数/推数记账。
- **重开本关**：`R` 或「重开」按钮。
- **进度**：按关解锁（`localStorage: sokoProgress`），另记每关最少步数/最少推数。
- **切后台/失焦自动暂停**，恢复必须玩家手动（STANDARD §9）。
- 特效：箱子入目标 burst、通关 confetti、撞墙轻震屏（shared/fx.js）。

## 主题套装（角色 × 场景）

| 套装 | 角色 | 场景 | 主题色 |
| --- | --- | --- | --- |
| 仓库搬运工（默认） | 搬运工阿力 | 旧仓库 | `#b5722e` |
| 农场小农夫 | 小农夫豆豆 | 果园农庄 | `#6cbf5a` |
| 冰雪小企鹅 | 企鹅波波 | 冰雪世界 | `#7ec8f2` |
| 太空宇航员 | 宇航员小宇 | 太空货舱 | `#a98df0` |

- 预设套装一键整配；角色、场景也可**自由混搭**（4×4=16 种组合）。
- 联动规则（同 flipping-bird）：选套装后处于联动态，此时只换角色会自动带上
  它的配套场景；手动单独换场景即解除联动，「恢复配套」按钮可重新联动。
- 风格配置：**立体方块 / 平面俯视**两种渲染密度、**高对比模式**（墙/箱与地板
  明度差拉大、目标点更亮）。选择与风格存 `localStorage: sokoTheme`。
- 4 套主题的 BGM 音阶各不相同（`js/audio.js` 的 `startBGM(sceneIdx)`）。

## 目录结构

```
sokoban/
├── index.html          入口（双击可玩，独立可运行）
├── style.css           页面样式（经典 CSS，见 docs/STANDARD.md §6）
├── build_levels.py     关卡源 + BFS/A* 求解校验器（生成 js/levels.js）
├── js/
│   ├── levels.js       自动生成：18 关数据 {name, grid, par, parPushes}
│   ├── themes.js       主题绘制层（SokoThemes：套装数据 + 全部 Canvas 绘制）
│   ├── audio.js        音效/BGM（AudioManager，振荡器合成，无音频文件）
│   └── game.js         核心状态机/渲染/输入/存档
└── test/smoke.js       冒烟测试（含 shared 门禁）
```

## 关卡与求解器

- 关卡即数据：字符网格 `#` 墙 `@` 玩家 `+` 玩家在目标 `$` 箱 `*` 箱在目标
  `.` 目标点，空格地板（与 maze-challenge 惯例同构）。
- `build_levels.py` 内嵌 18 关源数据，逐关校验：矩形补齐、边界封死、
  箱数=目标数、玩家连通性，然后 A*(推数, 步数) 字典序求解确认可解，
  并把最少步数写入 `par`（HUD「参考」与过关页显示用）。
- 求解剪枝：从目标点反向拉箱 BFS 得到「可能到达目标」的格子集合（拉箱距离
  同时作 A* 一致启发式），死角/死线直接剪枝。改关卡改 `SRC` 后重跑：
  `python build_levels.py`。

| 关 | 名称 | 箱 | 参考（步/推） | 关 | 名称 | 箱 | 参考（步/推） |
| - | - | - | - | - | - | - | - |
| 1 | 直推入门 | 1 | 1/1 | 10 | 岔口运货 | 3 | 14/5 |
| 2 | 绕到箱后 | 1 | 5/2 | 11 | 中庭四箱 | 4 | 25/8 |
| 3 | 双箱开工 | 2 | 9/4 | 12 | 三柱门 | 3 | 11/3 |
| 4 | 三层小楼 | 3 | 18/3 | 13 | 穿堂过巷 | 3 | 29/8 |
| 5 | 一排三箱 | 3 | 13/3 | 14 | 田字四箱 | 4 | 18/4 |
| 6 | 十字路口 | 3 | 11/4 | 15 | 五箱大班 | 5 | 26/5 |
| 7 | 天窗小院 | 1 | 10/4 | 16 | 回字迷宫 | 3 | 54/8 |
| 8 | 仓库转角 | 1 | 14/5 | 17 | 中央广场 | 6 | 26/9 |
| 9 | 四角归位 | 4 | 14/6 | 18 | 九宫回廊 | 4 | 38/12 |

## 实现要点

- 目标设备 MiTV4A（Android 6 / WebView ≈ Chromium 47）：纯 ES5、经典 script、
  无 emoji 图形；渲染全部 Canvas 2D 矢量，静态背景预渲染离屏 canvas（§10.3）。
- 移动为 130ms 补间 + 输入缓冲（补间中按方向键会排队，最多 2 步），
  撞墙为原地「顶一下」的 bump 动画（音效 140ms 节流防连响）。
- 伪 3D 立体模式下按行序绘制（下面的行盖住上面的行），角色最后绘制。
- 返回键 history 陷阱与 number-runner 同构（每次 popstate 后重新 pushState，
  `__tvControlsInjected` 时跳过，STANDARD §4）；对局中 OK = 暂停。
- 调试钩子：URL 带 `#debug` 时才挂出控制台 `__soko`
  （`state/startLevel/tryMove/undo/progress/theme/...`，与另两款一致），
  smoke 测试即用它驱动状态机。

## 验证

```
python build_levels.py      # 18 关可解校验 + 生成 levels.js
node test/smoke.js          # shared 门禁 + 160 项断言（含多视口棋盘布局量化）
```

真机验收（在仓库根执行，会自起静态服务与 headless Chrome，截图写系统临时目录）：

```
node h5-games/test/cdp-verify.js sokoban   # 三视口棋盘布局 / U·R 键 / 启动器 iframe（STANDARD §9）
```

浏览器联调：仓库根 `h5-games/start-server.bat` 起静态服务后访问
`http://<IP>:8000/h5-games/sokoban/index.html`；启动器入口
`tv-h5-app/index.html`（已在 `tv-h5-app/js/config.js` 登记）。

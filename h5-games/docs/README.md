# h5-games 游戏开发规范

> 初始版 **v0.1** —— 在开发过程中持续完善（演进方式见 `STANDARD.md` 第 10 节）。

本目录是「掌中灵 TV 游戏厅」所有 H5 游戏的存放与协作规范。目标：**多个游戏可由不同人并行开发，接入同一套电视启动器，不重复造轮子。**

## 文档导航
- [STANDARD.md](./STANDARD.md) —— 核心规范：目录结构、输入契约、兼容性约束、资源、启动器接入、验收清单（**新增游戏必读**）
- 启动器接入指南：`../tv-h5-app/GAME_DEV_GUIDE.md`（聚焦「如何接入启动器」，规则以本目录 `STANDARD.md` 为准）

## 三个关键决策（初始版结论）
1. **不强制统一游戏引擎。** 采用「契约式」约束：任何引擎（原生 canvas / Phaser / three.js 等）只要满足 `STANDARD.md` 的**输入契约、独立可运行、兼容性约束**即可。理由：现有 `maze-challenge` 是手绘 canvas 实现，强制换引擎重写成本太高，且旧电视 WebView 有兼容/性能风险。
2. **建立统一的轻量资源仓库** `h5-games/assets/`。跨游戏公共素材（背景、按钮音效、通用图标、字体）放这里，游戏用 `../assets/...` 引用；游戏私有素材仍随游戏目录。不引入打包/构建步骤，保持纯静态、旧设备友好。
3. **提供统一的最小共享代码** `h5-games/shared/`（`input.js` 输入归一化、`nav.js` 可选焦点导航、`base.css` TV 基础样式）。游戏按需引入，不绑定引擎。

## 新游戏起步（同步开发）
最快方式：复制 `h5-games/_template/` → 重命名为你的游戏 id（kebab-case）→ 实现玩法 → 在 `tv-h5-app/js/config.js` 登记。详见 `_template/README.md`。

## 共享资源清单（持续补充）
| 资源 | 路径 | 说明 |
|------|------|------|
| 输入归一化 | `shared/input.js` | `TVInput`：方向键/WASD/OK/返回 → 语义事件 |
| 焦点导航 | `shared/nav.js` | `TVNav`：standalone 菜单空间导航（启动器内由 tv-controls 接管） |
| TV 基础样式 | `shared/base.css` | 暗色 10-foot UI、焦点环、全屏 overlay |
| 公共素材 | `assets/` | 背景/音效/图标/字体（见其内 README） |

## 如何演进
- 每开发一款新游戏，把踩到的坑、新增的通用需求补进 `STANDARD.md` 对应章节。
- 任何跨游戏可复用的工具/素材，沉淀到 `shared/` 或 `assets/`，并在上方清单登记。
- 版本号随重大变更递增（v0.1 → v0.2 …）。

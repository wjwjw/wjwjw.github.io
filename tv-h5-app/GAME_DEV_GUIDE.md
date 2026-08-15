# H5 游戏开发指南（接入掌中灵 TV 游戏厅）

> **规则总规范以 [`../h5-games/docs/STANDARD.md`](../h5-games/docs/STANDARD.md) 为准**（目录结构、输入契约、兼容性约束、资源、验收清单）。
> 本文件聚焦「如何接入启动器」，新增游戏请先读上面那份规范。

本指南面向「要往这个 TV 启动器里加新游戏」的开发者。只要遵守下面几条约定，
游戏就能在电视遥控器上正常玩、被启动器正确加载，且本地调试 / 正式发布无需改代码。

---

## 1. 放在哪里

所有游戏统一放在仓库的 **`h5-games/<你的游戏>/`** 下，每个游戏一个目录，必须有入口 `index.html`。

```
h5-games/
└── my-game/
    ├── index.html     # 入口（必须）
    ├── style.css
    └── js/...
```

然后在 `tv-h5-app/js/config.js` 的 `games` 数组里登记（见第 5 节）。
**不要**放进 `tv-h5-app/` 里——那是启动器自己的代码。

---

## 2. 电视输入（最重要）

电视遥控器没有鼠标指针，只有 **方向键（D-pad）** 和 **OK / 返回** 等少数键。
启动器会把遥控按键翻译成普通键盘事件转发进游戏，所以游戏必须「键盘友好」：

### ✅ 必须做
1. **主操作绑定方向键 / WASD**
   遥控器方向键 = 键盘 `ArrowUp/Down/Left/Right`；很多遥控器也映射 `W/A/S/D`。
   在 `window` 或 `document` 上监听 `keydown`，按 `e.key` 判断即可：
   ```js
   const KEYMAP = { ArrowUp:"up", ArrowDown:"down", ArrowLeft:"left", ArrowRight:"right",
                    w:"up", s:"down", a:"left", d:"right" };
   window.addEventListener("keydown", (e) => {
     const dir = KEYMAP[e.key];
     if (dir) { e.preventDefault(); move(dir); }
   });
   ```
2. **主要按钮要能「按 OK 激活」**
   遥控器 OK 键 = 键盘 `Enter` / `Space`。游戏里的「开始游戏」「下一关」等主按钮，
   在界面出现时应自动获得焦点（`autofocus` 或 JS `el.focus()`），这样 OK 才能点它。
3. **菜单/选择界面可被遥控导航**
   角色选择、关卡选择、结算页里的可点元素，应是 `<button>` / `<a>`，或带 `onclick` 的元素
   （启动器会自动把它们标记为可聚焦）。需要自定义焦点顺序时，加 `tabindex` 或 `data-tv-focus`。

### 🤖 启动器自动帮你做的（tv-controls.js）
启动器在加载**同源**游戏时，会自动向 iframe 注入 `tv-controls.js`，它会：
- 覆盖层（`.overlay`）一显示就自动聚焦里面第一个可交互元素；
- `Enter` / `Space` 激活当前焦点元素（按钮、带 `onclick` 的 div 都能点）；
- 方向键在可聚焦元素间做「空间导航」（就近移动）。

> 设计原则：仅当焦点在「菜单控件」上时才会拦截方向键；游戏进行中焦点通常在
> `body`/画布上，方向键原样交给游戏，**不抢按键**。

若某游戏自带完整的遥控器逻辑、不希望被增强，在 `config.js` 里设 `tvControls: false`。

### ⚠️ 关键坑：OK 键在启动器内是「双重处理」的
在 TV 启动器内，一次遥控器 OK 会**同时**被两层处理：
1. 启动器注入的 `tv-controls.js` 先截到 `Enter`，激活当前焦点按钮（如「开始游戏」「继续」）；
2. 同一个 `Enter` 事件随后冒泡到**游戏自己的** `keydown` 监听器。

如果你的游戏在 `keydown` 里对「菜单态」也响应了确认（例如 `Focus.screen` 一变成 `game` 就 `pause()`），
就会出现两个典型 bug：
- **「一进关卡就暂停」**：选关 OK → `startLevel()` 把状态切成 `game` → 同一事件冒泡到游戏 → 立刻 `pause()`；
- **「继续没反应」**：暂停页 OK → `resume()` 切到 `game` → 同一事件冒泡到游戏 → 又 `pause()`。

`tv-controls.js` 已把「点按钮」**延迟到 keydown 事件处理完之后**（`setTimeout(…,0)`）规避此问题，
**游戏侧请遵守以下约定，不要自己再重蹈覆辙**：
- 菜单/选择/结算等界面里，确认键**交给 tv-controls**（不要自己 `Focus.confirm()` 或 `click()`），
  即 `if (inLauncher) 不要处理确认；否则再处理`。
- 「游戏中 OK = 暂停」只在 `Focus.screen === "game"` 且**焦点在画布/body**（tv-controls 不会拦截）时由游戏自己处理即可。

> 判断是否在启动器内：`window.__tvControlsInjected === true`（tv-controls 注入时会置位）。

### ❌ 不要做
- 不要把「只能鼠标拖动 / 触屏滑动」作为**唯一**玩法（遥控器没指针）。
- 不要写死鼠标坐标逻辑作为必要操作。
- 触屏滑动可以保留作为**附加**操作（手机/触屏电视也支持），但必须有键盘等价操作。

---

## 3. 资源用相对路径

游戏内部引用脚本 / 样式 / 图片一律用**相对路径**（相对本游戏 `index.html`）：
```html
<link rel="stylesheet" href="style.css" />
<script src="js/main.js"></script>
<img src="images/hero.png" />
```
这样「本地服务器」和「GitHub Pages」两种环境都能正确加载，无需改路径。

---

## 4. 画面自适应

电视分辨率多为 1080p，但 WebView 逻辑视口大约 **960×540**（密度 2x）。
游戏画布应随窗口大小自适应，并监听 `resize`：
```js
function resize() {
  const w = Math.min(window.innerWidth * 0.94, 560);
  const h = window.innerHeight * 0.6;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  // 同时按需设置 canvas.width/height（含 devicePixelRatio）
}
window.addEventListener("resize", resize);
```
不要把尺寸写死成某个像素值，否则在不同电视上会跑偏。

---

## 5. 在启动器里登记

打开 `tv-h5-app/js/config.js`，在 `games` 数组追加一项：
```js
{
  id: "my-game",
  title: "我的游戏",
  subtitle: "一句话说明（会显示在卡片和预览面板）",
  icon: "🕹️",              // emoji 即可，也可用图片路径
  folder: "my-game",        // h5-games 下的目录名（必须和上面一致）
  entry: "index.html",      // 入口文件，默认 index.html
  completed: true,          // ★ 完成开关：开发完成设 true；未完成设 false（菜单只占位、不可进入）
  color: "#5a8dee",         // 卡片主题色（可选）
  tvControls: true          // 是否注入遥控增强（可选，默认 true）
}
```

- **`completed` 是「游戏是否完成」的总开关**：
  - `true` → 菜单卡片显示「可玩」，可按 OK 进入；
  - `false` → 卡片显示「即将推出」、置灰，按 OK 只提示「敬请期待」。
  新游戏先 `completed: false` 占位，做完再改成 `true`，无需改其他代码。

---

## 6. iframe / 单页约定

游戏在启动器里是**通过 iframe 加载**的，请留意：
- 使用经典 `<script src>` 引入脚本（避免依赖父页面的全局变量）。
- 不要访问 `window.top` / `window.parent` / `opener`（跨域会被拦，同源也没必要）。
- 音频自动播放：浏览器通常要求「用户首次交互后」才能出声。让游戏在用户点击
  「开始游戏」（遥控器 OK 触发的 click）时 `audio.resume()` / 启动 BGM 即可。
- 若游戏需要自己处理「返回」键（返回菜单），可自行监听并在合适时机调用
  父页面桥（同源时）或直接用页面内按钮——启动器的「返回」键逻辑见 `launcher.js`。

---

## 7. 本地调试流程

```bash
# 1) 开发机启动本地服务器（打印本机 IP）
双击 h5-games/start-server.bat

# 2) 电视上用 adb 打开启动器（本地模式）
adb shell am start -n com.wjwjw.tvlauncher/.MainActivity \
  -e url "http://<开发机IP>:8000/tv-h5-app/index.html"

# 3) 也可以直接在电脑浏览器打开游戏自测键盘操作
#    http://<开发机IP>:8000/h5-games/my-game/index.html
```
也可以本地用浏览器直接打开 `h5-games/my-game/index.html`，用键盘（方向键 + 回车）模拟遥控器验收。

---

## 8. 验收清单（发布前自测）

- [ ] 入口 `h5-games/<game>/index.html` 存在，资源全用相对路径。
- [ ] 方向键 / WASD 能操作（不只是鼠标）。
- [ ] 主按钮在界面出现时自动聚焦，遥控器 OK 能激活。
- [ ] 菜单/选择界面能用方向键导航、OK 进入。
- [ ] 画布随窗口 resize 自适应，在 960×540 逻辑视口下显示正常。
- [ ] 已在 `config.js` 登记，且 `completed` 状态正确。
- [ ] 音频在用户首次交互后正常播放。
```

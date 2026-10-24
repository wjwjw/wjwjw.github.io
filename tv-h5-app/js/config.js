/*
 * ============================================================
 *  掌中灵 TV 游戏厅 —— 全局配置（唯一配置入口）
 * ============================================================
 *  两个核心开关：
 *  1) useRemote
 *       false（默认，本地开发） → 游戏从「开发机本地服务器」加载
 *                                 地址 = localServer + "/h5-games/<folder>/<entry>"
 *       true （正式发布）       → 游戏从「GitHub Pages」加载
 *                                 地址 = remoteBase + "/h5-games/<folder>/<entry>"
 *       ★ 页面以 https:// 打开时（GitHub Pages），浏览器会拦截 http:// 的
 *         iframe（Mixed Content，游戏白屏）。此时启动器会自动切换为正式
 *         资源，无需手动改这里；只有显式带 ?remote=0 / ?local=... 才保持
 *         本地源（会被浏览器拦截，页面会弹提示）。
 *         —— 自愈逻辑见 launcher.js，别在两边各写一套。
 *  2) games[].completed
 *       该游戏是否已完成。false → 菜单只展示占位「即将推出」，不可进入。
 *
 *  本地调试是怎么工作的（重要）：
 *    - 在开发机上进入仓库的 h5-games/ 目录，双击 start-server.bat，
 *      它会启动一个静态服务器（根目录=仓库根），例如 http://192.168.2.100:8000
 *    - 电视设备和开发机在同一局域网，直接用这个 IP:端口 访问资源：
 *        · 游戏：http://192.168.2.100:8000/h5-games/maze-challenge/index.html
 *        · 启动器：http://192.168.2.100:8000/tv-h5-app/index.html
 *    - 所以「本地」和「正式」都是绝对地址，区别只是基址不同（开发机 IP vs GitHub）。
 *
 *  运行期可用 URL 参数临时覆盖（方便在电视上快速验证，无需改文件）：
 *    ?remote=1 | ?remote=0      覆盖 useRemote
 *    ?local=http://IP:端口       强制本地模式并把 localServer 指向该地址
 *    ?base=https://...           覆盖 remoteBase（正式资源基地址）
 * ============================================================
 */
window.APP_CONFIG = {
  // false = 本地开发机；true = GitHub Pages 正式资源
  useRemote: false,

  // 开发机本地服务器基址（start-server.bat 启动后，设备通过此 IP:端口访问）。
  // 请改成你开发机的局域网 IP（start-server.bat 运行时会打印出来）。
  localServer: "http://192.168.2.100:8000",

  // 正式资源基地址（GitHub Pages，整站发布）
  remoteBase: "https://wjwjw.github.io",

  /*
   * games：游戏清单。顺序即菜单从左到右、从上到下的展示顺序。
   *   id        唯一标识（建议与文件夹同名）
   *   title     菜单标题
   *   subtitle  副标题 / 一句话说明
   *   icon      菜单卡片用的大图标。★ 统一用图片路径，不要用 emoji / 汉字：
   *               · 目标设备 MiTV4A（Android 6 / WebView≈Chromium 47）渲染不了彩色 emoji，会画成 □ 方框
   *               · 汉字当图标风格、字重、视觉重心各不一致，九个游戏九个样
   *             统一图标集在 h5-games/assets/icons/（九枚像素风，含 SVG + PNG 64/128），
   *             相对本页路径写 "../h5-games/assets/icons/<id>.svg"。
   *             规范见 h5-games/assets/icons/SPEC.md，总览页 icons/preview.html。
   *   folder    h5-games/ 下的子目录名
   *   entry     该游戏的入口 html（默认 index.html）
   *   completed 是否已完成（核心开关）。false → 显示「即将推出」且不可进入
   *   color     卡片主题色（可选）。★ 应与该游戏图标的底板色一致 ——
   *             选中卡片的描边与聚焦环就是用它画的，色不一致会显得脏。
   *             图标底板色 = h5-games/assets/icons/build_icons.py 里该游戏的 accent。
   *   tvControls 是否向该游戏注入 TV 遥控增强（默认 true，仅同源游戏生效）
   */
  games: [
    {
      id: "number-runner",
      title: "数字跑酷",
      subtitle: "三车道无尽跑酷 · 合并相同数字",
      // 统一像素图标集（h5-games/assets/icons/），见 SPEC.md
      icon: "../h5-games/assets/icons/number-runner.svg",
      folder: "number-runner",
      entry: "index.html",
      completed: true,
      color: "#ff8c42",
      tvControls: true
    },

    {
      id: "maze-challenge",
      title: "迷宫闯关",
      subtitle: "像素小冒险 · 方向键 / WASD 移动",
      icon: "../h5-games/assets/icons/maze-challenge.svg",
      folder: "maze-challenge",
      entry: "index.html",
      completed: true,
      color: "#5a8dee",
      tvControls: true
    },

    {
      id: "spot-difference",
      title: "火眼金睛",
      subtitle: "找不同 · 方向键移动取景框，OK 标记",
      icon: "../h5-games/assets/icons/spot-difference.svg",
      folder: "spot-difference",
      entry: "index.html",
      completed: true,
      color: "#f2a33c",
      tvControls: true
    },

    {
      id: "memory-match",
      title: "记忆翻牌",
      subtitle: "翻牌配对 · 预览-扣牌-方向键翻相同图案",
      icon: "../h5-games/assets/icons/memory-match.svg",
      folder: "memory-match",
      entry: "index.html",
      completed: true,
      color: "#8b6ce8",
      tvControls: true
    },

    {
      id: "kids-quiz",
      title: "小小达人",
      subtitle: "认知问答 · 看图选答案，不识字也能玩",
      icon: "../h5-games/assets/icons/kids-quiz.svg",
      folder: "kids-quiz",
      entry: "index.html",
      completed: true,
      color: "#2ab7b0",
      tvControls: true
    },

    {
      id: "puzzle-slide",
      title: "拼图乐园",
      subtitle: "滑动拼图 · 方向键把打乱的画推回原样",
      icon: "../h5-games/assets/icons/puzzle-slide.svg",
      folder: "puzzle-slide",
      entry: "index.html",
      completed: true,
      // 原为 #f2a33c，与「火眼金睛」重复 -> 卡片描边会同色。
      // 改用游戏内实际配色，同时也与图标底板一致（见 icons/SPEC.md §2.2）。
      color: "#e0524f",
      tvControls: true
    },

    {
      id: "snake",
      title: "贪吃蛇",
      subtitle: "吃苹果长大 · 方向键转弯，撞墙会穿过去",
      icon: "../h5-games/assets/icons/snake.svg",
      folder: "snake",
      entry: "index.html",
      completed: true,
      color: "#3fa96b",
      tvControls: true
    },

    /* ↓↓↓ 后续新游戏照抄这一段，completed 先设 false 即可占位 ↓↓↓ */
    {
      id: "coming-soon",
      title: "新游戏待定",
      subtitle: "开发中 · 敬请期待",
      icon: "../h5-games/assets/icons/coming-soon.svg",
      folder: "",
      entry: "",
      completed: false,
      color: "#8a8f98"
    }
    /* ↑↑↑ 新增游戏示例（占位） ↑↑↑ */
  ]
};

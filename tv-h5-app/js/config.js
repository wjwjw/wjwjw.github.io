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
   *   icon      菜单卡片用的大图标（emoji 最省事，也可用图片路径）
   *   folder    h5-games/ 下的子目录名
   *   entry     该游戏的入口 html（默认 index.html）
   *   completed 是否已完成（核心开关）。false → 显示「即将推出」且不可进入
   *   color     卡片主题色（可选）
   *   tvControls 是否向该游戏注入 TV 遥控增强（默认 true，仅同源游戏生效）
   */
  games: [
    {
      id: "maze-challenge",
      title: "迷宫闯关",
      subtitle: "像素小冒险 · 方向键 / WASD 移动",
      icon: "🦖",
      folder: "maze-challenge",
      entry: "index.html",
      completed: true,
      color: "#5a8dee",
      tvControls: true
    },

    {
      id: "number-runner",
      title: "数字跑酷",
      subtitle: "三车道无尽跑酷 · 合并相同数字",
      // 注意：icon 走 ASCII 符号，避免电视 WebView 上 emoji 渲染成 □（见 STANDARD §6）
      icon: "123",
      folder: "number-runner",
      entry: "index.html",
      completed: true,
      color: "#ff8c42",
      tvControls: true
    },

    /* ↓↓↓ 后续新游戏照抄这一段，completed 先设 false 即可占位 ↓↓↓ */
    {
      id: "coming-soon",
      title: "新游戏待定",
      subtitle: "开发中 · 敬请期待",
      icon: "🎯",
      folder: "",
      entry: "",
      completed: false,
      color: "#8a8f98"
    }
    /* ↑↑↑ 新增游戏示例（占位） ↑↑↑ */
  ]
};

# 掌中灵 TV 游戏厅

一个运行在 Android TV（小米 MiTV4A / 其他 Android 电视）上的 H5 游戏启动器。
原生外壳只是一个全屏 WebView，真正的内容（菜单、游戏列表、遥控导航、游戏加载、环境开关）
全部是 `tv-h5-app/` 下的 H5，迭代无需重新打包 APK。

## 目录结构

```
tv-h5-app/
├── index.html            # 启动器页面（菜单 UI）
├── css/style.css         # 电视风样式（面向 1080p，逻辑视口约 960×540）
├── js/
│   ├── config.js         # ★ 唯一配置入口：环境开关 + 游戏清单 + 完成开关
│   └── launcher.js       # 菜单导航 / iframe 加载游戏 / 按键转发 / 返回键桥
├── tv-controls.js        # 同源游戏自动注入的「遥控增强」脚本
├── android/              # 原生 WebView 外壳（Java，命令行打包，无 Gradle）
│   ├── app/src/main/...  # MainActivity + Manifest + 资源
│   └── build_apk.sh      # 打包 / 安装脚本
├── README.md             # 本文件
└── GAME_DEV_GUIDE.md     # 新游戏开发注意事项（给后续开发者）

h5-games/                  # ★ 所有游戏放这里，每个游戏一个子目录
├── maze-challenge/       #   示例游戏（已有的迷宫闯关）
├── start-server.bat      # ★ 本地开发服务器（双击启动，电视通过 IP 访问）
└── start-server.sh
```

## 两种资源来源（核心开关）

| 模式 | 配置 | 游戏地址 |
|------|------|----------|
| 本地调试 | `useRemote: false` | `localServer + /h5-games/<folder>/<entry>` |
| 正式发布 | `useRemote: true`  | `remoteBase + /h5-games/<folder>/<entry>` |

- `localServer`：`h5-games/start-server.bat` 启动后的开发机地址（例如 `http://192.168.2.100:8000`）。
- `remoteBase`：GitHub Pages 整站地址 `https://wjwjw.github.io`。

> 两种都是**绝对地址**，区别只是基址不同（开发机 IP vs GitHub）。没有「相对路径」概念。

## 快速开始

### 1) 本地调试（电视连开发机）

```bash
# 在开发机上（仓库内）启动服务器
双击 h5-games/start-server.bat
# 终端会打印本机局域网 IP，例如 http://192.168.2.100:8000
```

然后在电视上用 adb 打开启动器（本地模式，游戏走开发机）：

```bash
adb shell am start -n com.wjwjw.tvlauncher/.MainActivity \
  -e url "http://192.168.2.100:8000/tv-h5-app/index.html"
```

启动器以「本地开发机」模式加载游戏：
`http://192.168.2.100:8000/h5-games/maze-challenge/index.html`

> 也可以直接把 `config.js` 里的 `localServer` 改成你的 IP，
> 或在 URL 上追加 `?local=http://192.168.2.100:8000` 临时覆盖。

### 2) 正式发布（GitHub Pages）

把仓库推到 `wjwjw.github.io`（GitHub Pages 会自动发布整站）。
原生 App 默认启动地址就是正式资源：

```
https://wjwjw.github.io/tv-h5-app/index.html?remote=1
```

电视上安装好 App 后直接打开即可，`?remote=1` 让游戏走 GitHub。

## 如何新增一个游戏

1. 在 `h5-games/` 下新建目录，例如 `h5-games/my-game/`，放 `index.html` 及资源。
2. 打开 `tv-h5-app/js/config.js`，在 `games` 数组里加一项：
   ```js
   {
     id: "my-game",
     title: "我的游戏",
     subtitle: "一句话说明",
     icon: "🕹️",
     folder: "my-game",          // h5-games 下的目录名
     entry: "index.html",
     completed: true,            // ★ 完成开关：false 则菜单只占位、不可进入
     color: "#5a8dee"
   }
   ```
3. 本地起服务器联调；完成后 `git push` 即上线。
4. 开发注意事项见 **GAME_DEV_GUIDE.md**。

## 原生外壳打包 / 安装

```bash
cd tv-h5-app/android
bash build_apk.sh            # 仅打包 -> build/tv-launcher.apk
bash build_apk.sh install    # 打包并 adb install -r 到已连接电视
bash build_apk.sh clean      # 清空 build
```

打包只用 Android SDK 命令行工具（aapt2 / d8 / zipalign / apksigner），不依赖 Gradle。
最低支持 Android 6.0（API 23，已适配小米 MiTV4A）。

## 设备调试速查

```bash
# 设备列表
adb devices
# 启动（本地）
adb shell am start -n com.wjwjw.tvlauncher/.MainActivity -e url "http://<IP>:8000/tv-h5-app/index.html"
# 模拟遥控器
adb shell input keyevent KEYCODE_DPAD_CENTER   # OK
adb shell input keyevent KEYCODE_DPAD_RIGHT    # 右
adb shell input keyevent KEYCODE_BACK          # 返回
# 截图验证
adb shell screencap -p /sdcard/shot.png && adb pull /sdcard/shot.png ./shot.png
```

/* main.js — 界面流程 / 输入 / HUD / 进度 / TV 焦点导航
 *
 * 兼容：目标设备 WebView ≈ Chromium 47 —— 不用箭头函数 / const / let / 模板字符串 /
 * 对象方法简写 / 属性简写，见 ../docs/STANDARD.md §6。另外避开了几个 Chrome 47 上没有的
 * 库方法：Array.prototype.includes / Array.from / Array.prototype.find，
 * 以及 addEventListener 的 { passive: true }（老 WebView 会把这个对象当 capture=true）。
 */
(function () {
  function $(id) { return document.getElementById(id); }
  var canvas = $("game");
  var audio = new AudioManager();

  var progress = loadProgress();
  var selectedChar = CHARACTERS[0];
  var game = null;
  var currentLevel = 0;

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem("maze_progress")) || { unlocked: 1, stars: {} }; }
    catch (e) { return { unlocked: 1, stars: {} }; }
  }
  function saveProgress() { try { localStorage.setItem("maze_progress", JSON.stringify(progress)); } catch (e) {} }

  // ---------- 屏幕切换 ----------
  var SCREEN_NAME = { startScreen: "start", selectScreen: "select", winScreen: "win", loseScreen: "lose", pauseScreen: "pause" };
  var screens = ["startScreen", "selectScreen", "winScreen", "loseScreen", "pauseScreen"];
  function hideAll() {
    screens.forEach(function (s) { $(s).classList.add("hidden"); });
  }
  function show(id) {
    hideAll();
    $(id).classList.remove("hidden");
    var name = SCREEN_NAME[id];
    if (name) Focus.setScreen(name);
  }

  function setHud(visible) {
    $("hud").classList.toggle("hidden", !visible);
    $("dpad").classList.toggle("hidden", !visible);
  }

  // ---------- 选角 ----------
  var painter = new Game(document.createElement("canvas"), audio, {});
  function buildCharPicker() {
    var box = $("charPicker"); box.innerHTML = "";
    CHARACTERS.forEach(function (c) {
      var el = document.createElement("div");
      el.className = "char-opt tv-focus" + (c.id === selectedChar.id ? " sel" : "");
      el.dataset.char = c.id;
      el.tabIndex = 0; el.setAttribute("data-tv-focus", "");   // 让 tv-controls 可识别/导航
      var fc = document.createElement("canvas");
      fc.width = 48; fc.height = 48; fc.className = "face";
      fc.style.width = "44px"; fc.style.height = "44px";
      painter.drawChar(fc.getContext("2d"), c, 24, 24, 44, "down");
      el.appendChild(fc);
      var nm = document.createElement("div"); nm.className = "nm"; nm.textContent = c.name;
      el.appendChild(nm);
      el.onclick = function () { selectChar(c); };
      box.appendChild(el);
    });
  }
  function selectChar(c) {
    if (!c) return;
    if (selectedChar && selectedChar.id === c.id) return; // 未切换则不重绘/不响
    selectedChar = c;
    var opts = document.querySelectorAll("#charPicker .char-opt");
    Array.prototype.forEach.call(opts, function (el) {
      el.classList.toggle("sel", el.dataset.char === c.id);
    });
    audio.resume(); audio.sfx("heart");
  }
  // Array.prototype.find 在 Chrome 47 上不可用，这里手写一个
  function findCharById(id) {
    for (var i = 0; i < CHARACTERS.length; i++) if (CHARACTERS[i].id === id) return CHARACTERS[i];
    return null;
  }

  // ---------- 选关 ----------
  function buildLevelPicker() {
    var box = $("levelPicker"); box.innerHTML = "";
    LEVELS.forEach(function (lv, i) {
      var locked = i + 1 > progress.unlocked;
      var st = progress.stars[i] || 0;
      var el = document.createElement("div");
      el.className = "lv-opt" + (locked ? " locked" : " tv-focus");
      el.dataset.level = i;
      if (!locked) { el.tabIndex = 0; el.setAttribute("data-tv-focus", ""); }  // 让 tv-controls 可识别/导航
      // 锁用矢量挂锁 SVG（避免 emoji 成方框）
      var starStr = locked
        ? '<svg class="lock" viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h1zm2 0h6V7a3 3 0 0 0-6 0v3z"/></svg>'
        : new Array(st + 1).join("★") + new Array(3 - st + 1).join("☆");
      el.innerHTML = "<div>" + (i + 1) + '</div><div class="lv-stars">' + starStr + "</div>";
      if (!locked) el.onclick = function () { startLevel(i); };
      box.appendChild(el);
    });
  }

  function startLevel(i) {
    currentLevel = i;
    audio.resume(); audio.startBGM();
    hideAll(); setHud(true); Focus.screen = "game";
    $("levelName").textContent = LEVELS[i].name;
    if (!game) game = new Game(canvas, audio, { onHearts: onHearts, onWin: onWin, onLose: onLose });
    game.load(i, selectedChar);
    game.start();
  }

  // ---------- HUD ----------
  // 血量用矢量心形 SVG（避免系统 emoji 在旧电视上成方框）
  var HEART_PATH = "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";
  function onHearts(h) {
    var s = "";
    for (var i = 0; i < 5; i++)
      s += '<svg class="heart' + (i < h ? "" : " empty") + '" viewBox="0 0 24 24"><path d="' + HEART_PATH + '"/></svg>';
    $("hearts").innerHTML = s;
  }
  function onWin(stars) {
    setHud(false);
    var idx = game.levelIndex;
    progress.stars[idx] = Math.max(progress.stars[idx] || 0, stars);
    progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length, idx + 2));
    saveProgress();
    $("winStars").textContent = new Array(stars + 1).join("★") + new Array(3 - stars + 1).join("☆");
    var last = idx + 1 >= LEVELS.length;
    $("winTitle").textContent = last ? "全部通关！" : "通关啦！";
    $("winTip").textContent = stars === 3 ? "满血肉通关，太厉害啦！" : "收集爱心、躲开危险，争取三星！";
    $("btnNext").style.display = last ? "none" : "";
    show("winScreen");
  }
  function onLose() {
    setHud(false);
    show("loseScreen");
  }

  // ---------- TV 焦点导航（spatial navigation） ----------
  var Focus = {
    screen: null,            // 'start' | 'select' | 'win' | 'lose' | 'pause' | 'game'
    current: null,
    defaultFor: { start: "btnStart", win: "btnNext", lose: "btnReplayLose", pause: "btnResume" },
    setScreen: function (name) {
      this.screen = name;
      var items = this.items();
      if (!items.length) { this.current = null; return; }
      var el = null;
      if (name === "select") {
        el = document.querySelector("#charPicker .char-opt.sel") || items[0];
      } else if (name === "win") {
        el = (document.getElementById("btnNext") && document.getElementById("btnNext").style.display !== "none")
          ? document.getElementById("btnNext") : document.getElementById("btnReplayWin");
      } else {
        var def = this.defaultFor[name];
        el = def ? document.getElementById(def) : items[0];
      }
      // Array.prototype.includes 在 Chrome 47 上不存在，用 indexOf 代替
      if (!el || items.indexOf(el) === -1) el = items[0];
      this.current = el;
      this.apply();
    },
    items: function () {
      var ov = document.querySelector(".overlay:not(.hidden)");
      var root = ov || document.getElementById("stage");
      if (!root) return [];
      // Array.from 在 Chrome 47 上不可用，用 slice 把 NodeList 转成真数组
      var all = Array.prototype.slice.call(root.querySelectorAll(".tv-focus"));
      return all.filter(function (el) {
        return !el.classList.contains("locked") && el.offsetParent !== null;
      });
    },
    rectOf: function (el) {
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    apply: function () {
      // 启动器内焦点高亮交由 tv-controls 的真实 :focus 负责，避免双重/陈旧高亮
      if (!window.__tvControlsInjected) {
        var olds = document.querySelectorAll(".tv-focus.focus");
        Array.prototype.forEach.call(olds, function (e) { e.classList.remove("focus"); });
      }
      if (!this.current) return;
      if (!window.__tvControlsInjected) this.current.classList.add("focus");
      try { this.current.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
      // 角色：焦点即选中（实时切换），不重建 DOM
      var cid = this.current.dataset.char;
      if (cid) selectChar(findCharById(cid));
    },
    move: function (dir) {
      var items = this.items();
      if (!items.length || !this.current) return;
      var cur = this.rectOf(this.current);
      var best = null, bestScore = Infinity;
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (el === this.current) continue;
        var r = this.rectOf(el);
        var dx = r.x - cur.x, dy = r.y - cur.y;
        var primary, secondary;
        if (dir === "up") { if (dy >= -1) continue; primary = -dy; secondary = Math.abs(dx); }
        else if (dir === "down") { if (dy <= 1) continue; primary = dy; secondary = Math.abs(dx); }
        else if (dir === "left") { if (dx >= -1) continue; primary = -dx; secondary = Math.abs(dy); }
        else { if (dx <= 1) continue; primary = dx; secondary = Math.abs(dy); }
        var score = primary + secondary * 0.4;     // 主方向距离 + 次要方向偏差惩罚
        if (score < bestScore) { bestScore = score; best = el; }
      }
      if (best) { this.current = best; this.apply(); }
    },
    confirm: function () { if (this.current) this.current.click(); }
  };

  function handleBack() {
    switch (Focus.screen) {
      case "start": break;                                   // 最外层，不处理
      case "select": show("startScreen"); break;
      case "win": show("selectScreen"); break;
      case "lose": show("selectScreen"); break;
      case "pause": hideAll(); setHud(true); game.resume(); Focus.screen = "game"; break;
      case "game": game.pause(); show("pauseScreen"); break;
    }
  }

  // ---------- 键码映射（键盘 + 遥控器） ----------
  var KEYMAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right",
  };
  // 确认键：MiTV4A 遥控器 OK = DPAD_CENTER(23) → 浏览器 Enter(13/23)；空格兼容器
  function isConfirm(e) {
    return e.key === "Enter" || e.key === " " || e.key === "Spacebar" ||
      e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 32;
  }
  // 返回键：MiTV4A 遥控器 返回 = BACK(4)。
  // 注意：Android TV 浏览器里 BACK 往往直接触发页面后退而非派发 keydown，
  // 所以真正的可靠捕获靠 history popstate 陷阱（见 setupBackButtonTrap）。
  // 这里对 keydown 形式做兜底覆盖（Android/Escape、Tizen&webOS/461、Chromecast/GoBack 等）。
  function isBack(e) {
    return e.key === "Escape" || e.key === "BrowserBack" || e.key === "GoBack" ||
      e.key === "Back" || e.keyCode === 461 || e.keyCode === 27;
  }

  // 是否运行在 TV 启动器内（tv-h5-app 注入的 tv-controls.js 会置 window.__tvControlsInjected）。
  // 启动器内：菜单的「方向导航 / OK 确认 / 返回」全部由 launcher + tv-controls 接管，
  // 游戏自身只保留「游戏进行中」的方向移动与 OK 暂停，避免重复响应造成双击 / 双重导航。
  function inLauncher() { return !!window.__tvControlsInjected; }

  window.addEventListener("keydown", function (e) {
    var dir = KEYMAP[e.key];
    if (dir) {
      e.preventDefault();
      if (Focus.screen === "game") { if (game) game.attemptMove(dir); }   // 游戏中方向 = 移动角色
      else if (!inLauncher()) Focus.move(dir);                            // 菜单方向 = 移动焦点（仅 standalone）
      // 启动器内菜单方向交给 tv-controls 处理，这里放行不拦截
      return;
    }
    if (isConfirm(e)) {
      e.preventDefault();
      if (Focus.screen === "game") { game.pause(); show("pauseScreen"); }  // 游戏中确认 = 暂停
      else if (!inLauncher()) Focus.confirm();                            // 菜单确认（仅 standalone）
      // 启动器内确认由 tv-controls 激活当前焦点元素
      return;
    }
    if (isBack(e)) {
      e.preventDefault();
      if (!inLauncher()) handleBack();   // 启动器内返回由 launcher 统一处理（关闭游戏），不拦截
      return;
    }
  });

  // 鼠标/触摸点击也同步焦点位置（不影响 TV 键盘导航）
  document.addEventListener("click", function (e) {
    var f = e.target && e.target.closest ? e.target.closest(".tv-focus") : null;
    if (f) Focus.current = f;
  });

  // ---------- Android TV 返回键可靠捕获（history 陷阱） ----------
  // MiTV4A 的 BACK 键在浏览器里通常触发页面后退，而非派发可被拦截的 keydown。
  // 通过 pushState 占位 + 监听 popstate，用户按返回时优先走我们的界面回退逻辑，
  // 而不是真的离开游戏。每次返回后再 pushState 占位，形成稳定陷阱。
  // （起始页按返回会触发 handleBack，但 handleBack 在 startScreen 不退出，留在游戏内。）
  // ---------- 浏览器返回键陷阱（仅 standalone / 桌面调试用） ----------
  // 在 TV 启动器（tv-h5-app）内，返回键由 launcher 的返回键桥统一处理（关闭游戏），
  // 不应再装此陷阱，否则会和 launcher 抢返回键。用 window.__tvControlsInjected 判断是否在
  // 启动器内：tv-controls 在 iframe load 时注入，故在 load 之后再决定是否安装，并在 popstate
  // 时再兜底一次（注入可能稍晚）。
  function setupBackButtonTrap() {
    function mark() { history.pushState({ maze: "trap" }, ""); }
    mark();
    window.addEventListener("popstate", function () {
      if (window.__tvControlsInjected) return;   // 启动器内：返回交给 launcher，不自行处理
      handleBack();
      mark();
    });
  }
  if (document.readyState === "complete") { if (!window.__tvControlsInjected) setupBackButtonTrap(); }
  else window.addEventListener("load", function () { if (!window.__tvControlsInjected) setupBackButtonTrap(); });

  // 触屏滑动（移动端）
  // 注意第三参数：老 WebView 不支持 { passive: true }，会把它当 capture=true，这里显式传 false
  var ts = null;
  canvas.addEventListener("touchstart", function (e) {
    ts = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, false);
  canvas.addEventListener("touchend", function (e) {
    if (!ts) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - ts.x, dy = t.clientY - ts.y;
    if (Math.abs(dx) > 24 || Math.abs(dy) > 24) {
      var dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      if (game) game.attemptMove(dir);
    }
    ts = null;
  }, false);

  // 方向键（移动端触屏按钮）
  var dpadBtns = document.querySelectorAll(".dpad-btn");
  Array.prototype.forEach.call(dpadBtns, function (b) {
    b.addEventListener("click", function () { if (game) game.attemptMove(b.dataset.dir); });
  });

  // ---------- 按钮 ----------
  $("btnStart").onclick = function () { audio.resume(); audio.startBGM(); buildCharPicker(); buildLevelPicker(); show("selectScreen"); };
  $("btnBackStart").onclick = function () { show("startScreen"); };
  $("btnNext").onclick = function () { startLevel(Math.min(LEVELS.length - 1, currentLevel + 1)); };
  $("btnReplayWin").onclick = function () { startLevel(currentLevel); };
  $("btnMenuWin").onclick = function () { buildLevelPicker(); show("selectScreen"); };
  $("btnReplayLose").onclick = function () { startLevel(currentLevel); };
  $("btnMenuLose").onclick = function () { buildLevelPicker(); show("selectScreen"); };
  $("btnResume").onclick = function () { hideAll(); setHud(true); game.resume(); Focus.screen = "game"; };
  $("btnRestartPause").onclick = function () { startLevel(currentLevel); };
  $("btnMenuPause").onclick = function () { game.stop(); buildLevelPicker(); show("selectScreen"); };
  $("btnPause").onclick = function () { if (game) game.pause(); show("pauseScreen"); };
  $("btnRestart").onclick = function () { startLevel(currentLevel); };
  // 静音按钮用 ♪（有声）/ ✕（静音）文字符号，避免 emoji 成方框
  $("btnMute").onclick = function () {
    var m = audio.toggleMute();
    $("btnMute").textContent = m ? "✕" : "♪";
  };
  $("btnMutePause").onclick = function () {
    var m = audio.toggleMute();
    $("btnMutePause").textContent = m ? "✕ 声音" : "♪ 声音";
    $("btnMute").textContent = m ? "✕" : "♪";
  };

  window.addEventListener("resize", function () {
    if (game && game.state !== "idle") game.resize();
  });

  // 初始
  show("startScreen");
})();

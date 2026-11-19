/* ============================================================
 *  掌中灵 TV 游戏厅 —— 启动器逻辑
 *  - 渲染菜单（D-pad 可导航）
 *  - 用 iframe 加载游戏，并把遥控按键转发进 iframe
 *  - 处理「返回」键（先关游戏，再退出 App）
 *  - 解析环境开关（本地开发机 IP / GitHub 正式资源）
 * ============================================================ */
(function () {
  "use strict";

  var cfg = window.APP_CONFIG || { useRemote: false, localServer: "http://127.0.0.1:8000", remoteBase: "https://wjwjw.github.io", games: [] };

  // ---- URL 参数可临时覆盖配置（方便在电视上快速验证）----
  var params = new URLSearchParams(location.search);
  if (params.has("remote")) cfg.useRemote = (params.get("remote") === "1" || params.get("remote") === "true");
  if (params.has("base")) cfg.remoteBase = params.get("base");
  if (params.has("local")) { cfg.useRemote = false; cfg.localServer = params.get("local"); }

  // ---- 混合内容（Mixed Content）自愈 ----
  // 页面以 HTTPS 打开时（如 GitHub Pages），浏览器会直接拦截 iframe 里的
  // http:// 资源，游戏只会白屏。此时只要用户没有显式用 ?remote=0 / ?local=...
  // 指定本地源，就自动切到正式资源，保证点开就能玩。
  // 本地调试走 http:// 打开启动器，不受影响，仍是本地开发机模式。
  var mixedContentWarn = false;
  if (/^https:$/.test(location.protocol)) {
    if (!params.has("remote") && !params.has("local")) {
      cfg.useRemote = true;
    } else if (!cfg.useRemote && /^http:/.test(cfg.localServer)) {
      mixedContentWarn = true; // 显式强制的 http 本地源，仍会被浏览器拦截
    }
  }

  var menuEl = document.getElementById("menu");
  var preview = {
    icon: document.getElementById("pvIcon"),
    title: document.getElementById("pvTitle"),
    desc: document.getElementById("pvDesc"),
    status: document.getElementById("pvStatus")
  };
  var modeTag = document.getElementById("modeTag");
  var toastEl = document.getElementById("toast");
  var overlay = document.getElementById("gameOverlay");
  // iframe 不再放在 HTML 里复用，改为每次进入游戏动态创建、返回时销毁。
  // 老 WebView（Android 6 / Chromium 47）复用同一个 iframe 反复 src 导航时，
  // 第二次的 load 经常不触发，游戏白屏 —— 表现为「返回后打不开另一个游戏」。
  var iframe = null;
  var backBtn = document.getElementById("backBtn");
  var gameStatus = document.getElementById("gameStatus");
  var gsTitle = document.getElementById("gsTitle");
  var gsDesc = document.getElementById("gsDesc");
  var gsRetry = document.getElementById("gsRetry");
  var gsClose = document.getElementById("gsClose");
  var gameError = false;
  var lastUrl = null, lastGame = null;

  var selected = 0;
  var gameOpen = false;
  var columns = 1;
  var toastTimer = null;

  // tv-controls.js 的地址（与启动器同源，给同源游戏注入遥控增强）
  var tvControlsUrl = new URL("tv-controls.js", location.href).href;

  // ----------------------------------------------------------
  // 配置解析：本地=开发机服务器，正式=GitHub Pages，均为绝对地址
  // ----------------------------------------------------------
  function resolveGameUrl(g) {
    if (!g.folder) return "";
    var root = cfg.useRemote
      ? cfg.remoteBase.replace(/\/+$/, "") + "/h5-games"
      : cfg.localServer.replace(/\/+$/, "") + "/h5-games";
    return root + "/" + g.folder + "/" + (g.entry || "index.html");
  }

  function updateModeTag() {
    if (modeTag) {
      modeTag.textContent = cfg.useRemote ? "GitHub 正式资源" : "本地开发机";
      modeTag.classList.toggle("remote", !!cfg.useRemote);
    }
  }

  // ----------------------------------------------------------
  // 菜单渲染
  // ----------------------------------------------------------
  function renderMenu() {
    menuEl.innerHTML = "";
    cfg.games.forEach(function (g, i) {
      var card = document.createElement("div");
      card.className = "card" + (g.completed ? "" : " wip");
      card.style.setProperty("--card-color", g.color || "#5a8dee");
      card.dataset.index = i;
      card.innerHTML =
        '<div class="card-icon">' + iconHtml(g.icon) + "</div>" +
        '<div class="card-title">' + escapeHtml(g.title) + "</div>" +
        '<div class="card-sub">' + escapeHtml(g.subtitle || "") + "</div>" +
        (g.completed
          ? '<div class="card-badge ok">可玩</div>'
          : '<div class="card-badge wip">即将推出</div>');
      card.addEventListener("click", function () { select(i); activate(); });
      card.addEventListener("mouseenter", function () { select(i); });
      menuEl.appendChild(card);
    });
    columns = getColumns();
    select(Math.min(selected, cfg.games.length - 1));
  }

  function getColumns() {
    var cards = menuEl.querySelectorAll(".card");
    if (cards.length < 2) return 1;
    var top = cards[0].offsetTop;
    var cols = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].offsetTop === top) cols++;
      else break;
    }
    return Math.max(1, cols);
  }

  function select(i) {
    selected = Math.max(0, Math.min(cfg.games.length - 1, i));
    var cards = menuEl.querySelectorAll(".card");
    cards.forEach(function (c, idx) { c.classList.toggle("selected", idx === selected); });
    if (cards[selected]) cards[selected].scrollIntoView({ block: "nearest", inline: "nearest" });
    updatePreview();
  }

  function updatePreview() {
    var g = cfg.games[selected];
    if (!g) return;
    preview.icon.innerHTML = iconHtml(g.icon);
    preview.title.textContent = g.title;
    preview.desc.textContent = g.subtitle || "";
    preview.status.className = "preview-status " + (g.completed ? "ok" : "wip");
    preview.status.innerHTML = g.completed
      ? '<span class="status ok">● 已完成 · 可进入</span>'
      : '<span class="status wip">● 开发中 · 暂不可进入</span>';
  }

  function move(dir) {
    var next = selected;
    if (dir === "left") next = selected - 1;
    else if (dir === "right") next = selected + 1;
    else if (dir === "up") next = selected - columns;
    else if (dir === "down") next = selected + columns;
    if (next >= 0 && next < cfg.games.length) select(next);
  }

  // ----------------------------------------------------------
  // 启动 / 关闭游戏
  // ----------------------------------------------------------
  function activate() {
    var g = cfg.games[selected];
    if (!g) return;
    if (!g.completed) {
      showToast("「" + g.title + "」即将推出，敬请期待");
      return;
    }
    var url = resolveGameUrl(g);
    if (!url) { showToast("游戏入口缺失"); return; }
    openGame(url, g);
  }

  // 每次进入游戏都创建一个全新的 iframe。老 WebView（Chromium 47）复用同一
  // iframe 反复 src 导航（游戏 → about:blank → 游戏）时第二次 load 常不触发，
  // 导致白屏；全新节点 = 全新 browsing context，可彻底规避。
  function openGame(url, g) {
    closeGameFrame();                       // 先销毁可能残留的旧 frame
    gameOpen = true;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");

    var f = document.createElement("iframe");
    f.id = "gameFrame";
    f.frameBorder = "0";
    f.setAttribute("allow", "autoplay; fullscreen; gamepad");
    f.dataset.tvControls = (g && g.tvControls === false ? "0" : "1");
    f.addEventListener("load", onGameFrameLoad);
    iframe = f;
    overlay.appendChild(f);
    f.src = url;                            // append 后再赋值 src，确保 load 事件被捕获
  }

  // 返回大厅：把 iframe 从 DOM 中彻底移除，而不是只把 src 设成 about:blank。
  // 这样旧游戏的 JS 定时器 / 音频 / 事件监听随节点一起被 GC，不留隐患。
  function closeGameFrame() {
    if (!iframe) return;
    var f = iframe;
    iframe = null;                          // 先置空，避免 load 回调误注入
    try { f.contentWindow && f.contentWindow.stop && f.contentWindow.stop(); } catch (e) {}
    f.removeEventListener("load", onGameFrameLoad);
    try { f.src = "about:blank"; } catch (e) {}
    if (f.parentNode) f.parentNode.removeChild(f);
  }

  function closeGame() {
    if (!gameOpen) return;
    gameOpen = false;
    closeGameFrame();
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    select(selected);
  }

  // 给同源 iframe 注入 TV 遥控增强脚本（跨域则跳过）
  function onGameFrameLoad() {
    if (!gameOpen || !iframe) return;
    if (this !== iframe) return;             // 忽略已销毁的旧 frame 的迟到 load 事件
    if (iframe.dataset.tvControls === "0") return;
    try {
      var doc = iframe.contentDocument;
      if (doc && doc.body) {
        var s = doc.createElement("script");
        s.src = tvControlsUrl;
        s.dataset.injectedBy = "tv-launcher";
        doc.body.appendChild(s);
      }
    } catch (e) { /* 跨域则跳过 */ }
  }

  backBtn.addEventListener("click", closeGame);

  // ----------------------------------------------------------
  // 按键：菜单导航 / 转发给游戏
  // ----------------------------------------------------------
  function navFromEvent(e) {
    var k = e.key, c = e.keyCode;
    if (k === "ArrowLeft" || c === 37) return "left";
    if (k === "ArrowRight" || c === 39) return "right";
    if (k === "ArrowUp" || c === 38) return "up";
    if (k === "ArrowDown" || c === 40) return "down";
    if (k === "Enter" || k === " " || c === 13 || c === 23) return "ok";
    return null;
  }

  function forwardKey(e) {
    if (!gameOpen || !iframe || !iframe.contentWindow) return;
    var map = { 37: "ArrowLeft", 39: "ArrowRight", 38: "ArrowUp", 40: "ArrowDown", 13: "Enter", 32: " " };
    var key = (e.key && e.key !== "Unidentified") ? e.key : (map[e.keyCode] || "");
    if (!key) return;
    var want = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "];
    var isWasd = /^[wasd]$/i.test(key);
    if (want.indexOf(key) === -1 && !isWasd) return;
    e.preventDefault();
    var codeMap = { ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", Enter: "Enter", " ": "Space" };
    try {
      iframe.contentWindow.dispatchEvent(new KeyboardEvent("keydown", {
        key: key,
        code: codeMap[key] || key,
        keyCode: e.keyCode || 0,
        which: e.keyCode || 0,
        bubbles: true,
        cancelable: true
      }));
    } catch (_) {}
  }

  document.addEventListener("keydown", function (e) {
    if (gameOpen) { forwardKey(e); return; }
    var nav = navFromEvent(e);
    if (!nav) return;
    e.preventDefault();
    if (nav === "ok") activate();
    else move(nav);
  });

  // ----------------------------------------------------------
  // 给原生 App 调用的桥：返回键处理
  //  返回 true  → 退出整个 App
  //  返回 false → 仅关闭当前游戏（停留在菜单）
  // ----------------------------------------------------------
  window.TVLauncher = {
    handleBack: function () {
      if (gameOpen) { closeGame(); return false; }
      return true;
    },
    isGameOpen: function () { return gameOpen; }
  };

  // ----------------------------------------------------------
  // 工具
  // ----------------------------------------------------------
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  // icon 支持两种形态：图片路径（.png/.jpg/.svg… → <img>，老 WebView 渲染不了彩色 emoji 字形，用图最稳）或纯字符
  function iconHtml(icon) {
    if (!icon) return "?";
    if (/\.(png|jpe?g|gif|svg)$/i.test(icon)) {
      return '<img src="' + escapeHtml(icon) + '" alt="">';
    }
    return escapeHtml(icon);
  }

  window.addEventListener("resize", function () { columns = getColumns(); });

  // ---- 启动 ----
  updateModeTag();
  renderMenu();
  if (mixedContentWarn) {
    showToast("HTTPS 页面无法加载 http:// 本地资源（混合内容），游戏将被浏览器拦截");
  }
})();

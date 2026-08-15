/* ============================================================
 *  tv-controls.js  ——  TV 遥控增强（由 TV 启动器自动注入同源游戏）
 * ------------------------------------------------------------
 *  解决的问题：H5 小游戏大多为「鼠标/触屏」设计，在电视遥控器上
 *  没有指针，需要用 方向键 移动光标、用 OK 键 确认。本脚本为零侵入
 *  增强，让普通按钮 / 可点击元素也能用遥控器操作：
 *
 *   1) Enter / OK / 空格  →  激活当前获得焦点的元素（click）
 *   2) 方向键            →  在可聚焦元素之间做「空间导航」（就近移动）
 *   3) 自动聚焦          →  每当某个覆盖层（.overlay）显示出来，自动把
 *                          焦点放到里面第一个可交互元素上（如「开始游戏」）
 *
 *  设计原则：仅在「焦点位于菜单控件」时才拦截方向键；游戏进行中焦点
 *  通常在 body/canvas 上，此时方向键原样放行给游戏（不抢按键）。
 *
 *  若某游戏自带完整的遥控器逻辑、不希望被增强，可在游戏配置里设
 *  tvControls: false，启动器便不会注入本脚本。
 * ============================================================ */
(function () {
  if (window.__tvControlsInjected) return;
  window.__tvControlsInjected = true;

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent === null) return false;          // display:none / 脱离布局
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return false;
    return true;
  }

  function isFocusable(el) {
    if (!el || !isVisible(el)) return false;
    if (el.tabIndex >= 0) return true;
    var t = el.tagName;
    return t === "BUTTON" || t === "A" || t === "INPUT" ||
           t === "SELECT" || t === "TEXTAREA" ||
           el.hasAttribute("onclick") || el.getAttribute("role") === "button";
  }

  // 把带 onclick 的 div/span 之类标记为可聚焦，便于空间导航
  function tagClickables() {
    var els = document.querySelectorAll("[onclick]");
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.tabIndex < 0 && !e.hasAttribute("tabindex")) {
        e.tabIndex = 0;
        e.setAttribute("data-tv-focus", "");
      }
    }
  }

  function focusables() {
    var sel = "button, a[href], input, select, textarea, [tabindex], [data-tv-focus], [onclick]";
    var els = document.querySelectorAll(sel);
    var arr = [];
    for (var i = 0; i < els.length; i++) if (isFocusable(els[i])) arr.push(els[i]);
    return arr;
  }

  // 找到当前可见的覆盖层（优先最靠后的、最上层的）
  function visibleOverlay() {
    var list = document.querySelectorAll(".overlay");
    for (var i = list.length - 1; i >= 0; i--) {
      if (isVisible(list[i])) return list[i];
    }
    return null;
  }

  function focusFirstIn(container) {
    if (!container) return false;
    var items = focusables().filter(function (el) {
      return container.contains(el);
    });
    if (items.length) { items[0].focus(); return true; }
    return false;
  }

  // 空间导航：在方向上找最近的、且大致对齐的元素
  function spatial(dir, current) {
    var items = focusables();
    if (!items.length) return false;
    var a = current.getBoundingClientRect();
    var ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
    var best = null, bestScore = Infinity;
    for (var i = 0; i < items.length; i++) {
      var b = items[i].getBoundingClientRect();
      if (items[i] === current) continue;
      var bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      var dx = bc.x - ac.x, dy = bc.y - ac.y;
      var primary = (dir === "left") ? -dx : (dir === "right") ? dx : (dir === "up") ? -dy : dy;
      if (primary <= 1) continue;                        // 必须确实在所指方向
      var cross = (dir === "left" || dir === "right") ? Math.abs(dy) : Math.abs(dx);
      var score = Math.abs(primary) + cross * 2.5;        // 优先方向一致、横向/纵向对齐
      if (score < bestScore) { bestScore = score; best = items[i]; }
    }
    if (best) { best.focus(); return true; }
    return false;
  }

  function refocusOverlay() {
    var ov = visibleOverlay();
    if (ov) focusFirstIn(ov);
  }

  // ---- 全局键盘处理 ----
  document.addEventListener("keydown", function (e) {
    var ae = document.activeElement;

    // 确认键：激活当前焦点元素（按钮 / 带 onclick 的 div 都能点）
    if (e.key === "Enter" || e.key === " " || e.keyCode === 13 || e.keyCode === 32) {
      if (ae && ae !== document.body && typeof ae.click === "function") {
        e.preventDefault();
        // 关键：把「点击」推迟到当前 keydown 事件冒泡处理完之后再做。
        // 否则本脚本在 document 阶段点了按钮（如「开始关卡」「继续」），按钮回调会把
        // 游戏状态切到 game；同一 Enter 事件随后冒泡到游戏自身的 window 监听器时，它会
        // 看到 Focus.screen==="game" 而再次 game.pause()，造成「一进关卡就暂停 / 继续无效」。
        // 推迟到下一 tick 后，游戏的监听器先跑、看到的是旧状态（select/pause），不会误暂停。
        setTimeout(function () { if (ae && typeof ae.click === "function") ae.click(); }, 0);
      }
      return;
    }

    // 方向键：仅当焦点在菜单控件上才做空间导航，否则放行给游戏
    var dir = null;
    if (e.key === "ArrowLeft" || e.keyCode === 37) dir = "left";
    else if (e.key === "ArrowRight" || e.keyCode === 39) dir = "right";
    else if (e.key === "ArrowUp" || e.keyCode === 38) dir = "up";
    else if (e.key === "ArrowDown" || e.keyCode === 40) dir = "down";
    if (!dir) return;

    if (ae && ae !== document.body && isFocusable(ae)) {
      if (spatial(dir, ae)) e.preventDefault();
    }
    // 焦点在 body / canvas（游戏进行中）→ 不拦截，方向键交给游戏
  }, false);

  // ---- 覆盖层显隐变化时自动聚焦 ----
  var mo = new MutationObserver(function () { tagClickables(); refocusOverlay(); });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });

  // ---- 初次启动：标记 + 聚焦首个可交互元素 ----
  function boot() {
    tagClickables();
    refocusOverlay();
    if (!document.activeElement || document.activeElement === document.body) {
      var f = focusables();
      if (f.length) f[0].focus();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // 兜底：部分游戏在 load 之后才渲染界面
  window.addEventListener("load", function () { tagClickables(); refocusOverlay(); });
})();

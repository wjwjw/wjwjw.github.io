/*
 * shared/input.js —— 电视/键盘输入归一化（无依赖、经典脚本）
 *
 * 把遥控器/键盘事件归一化为语义事件，供所有 h5-games 复用，
 * 避免每个游戏重写 KEYMAP。启动器会把遥控键映射成标准键盘事件，
 * 因此游戏只需监听语义事件即可同时支持遥控与桌面键盘。
 *
 * 用法：
 *   <script src="../shared/input.js"></script>
 *   TVInput.on('dir', dir => ...);      // 'up' | 'down' | 'left' | 'right'
 *   TVInput.on('confirm', () => ...);   // Enter / Space / 遥控器 OK
 *   TVInput.on('back', () => ...);      // Escape / 浏览器返回
 *
 * 目标兼容：Android 6 WebView(Chrome 47)，故用经典脚本，不用 ES module。
 */
(function (global) {
  'use strict';

  var DIR_KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right'
  };
  // 安卓电视 / 老 WebView(Chrome47) 的 D-pad 方向键常只给 keyCode、e.key 为空或 "Unidentified"，
  // 必须按 keyCode 兜底匹配：19/20/21/22 是安卓 DPAD，37-40 是部分 WebView 转译出来的箭头键。
  var DIR_CODES = {
    38: 'up', 40: 'down', 37: 'left', 39: 'right',
    19: 'up', 20: 'down', 21: 'left', 22: 'right'
  };
  var handlers = { dir: [], confirm: [], back: [] };

  function emit(type, payload) {
    for (var i = 0; i < handlers[type].length; i++) {
      try { handlers[type][i](payload); } catch (e) { /* 忽略单个回调异常 */ }
    }
  }

  function isConfirm(e) {
    return e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' ||
           e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 32;
  }
  function isBack(e) {
    return e.key === 'Escape' || e.key === 'BrowserBack' || e.key === 'GoBack' ||
           e.key === 'Back' || e.keyCode === 461 || e.keyCode === 27 ||
           e.keyCode === 4; // 安卓电视遥控器返回键（KEYCODE_BACK），真遥控 e.key 未必是 "Back"
  }

  global.addEventListener('keydown', function (e) {
    var dir = DIR_KEYS[e.key] || DIR_CODES[e.keyCode];
    if (dir) { e.preventDefault(); emit('dir', dir); return; }
    if (isConfirm(e)) { e.preventDefault(); emit('confirm'); return; }
    if (isBack(e)) { e.preventDefault(); emit('back'); return; }
  });

  // 可选：移动端触屏滑动 → dir（作为键盘操作的附加，不替代）
  var ts = null;
  global.addEventListener('touchstart', function (e) {
    if (e.touches && e.touches[0]) ts = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  global.addEventListener('touchend', function (e) {
    if (!ts || !e.changedTouches || !e.changedTouches[0]) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - ts.x, dy = t.clientY - ts.y;
    if (Math.abs(dx) > 24 || Math.abs(dy) > 24) {
      emit('dir', Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }
    ts = null;
  }, { passive: true });

  var TVInput = {
    on: function (type, cb) { if (handlers[type]) handlers[type].push(cb); return TVInput; },
    trigger: function (type, payload) { emit(type, payload); } // 手动触发（测试/编程用）
  };
  global.TVInput = TVInput;
})(window);

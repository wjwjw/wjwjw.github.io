/*
 * shared/nav.js —— 轻量空间焦点导航（standalone 用；启动器内由 tv-controls 接管）
 *
 * 扫描带 .tv-focus / [data-tv-focus] / button / a[tabindex] 的可聚焦元素，
 * 用方向键在它们之间做「就近」空间移动，confirm 激活当前焦点。
 * 注意：在 tv-h5-app 启动器内，焦点导航由注入的 tv-controls.js 负责，
 * 本文件仅用于游戏被「直接打开」(standalone) 调试时。两者不要同时强控同一焦点。
 *
 * 用法：
 *   TVNav.init();                 // 扫描并聚焦第一个可聚焦元素
 *   TVInput.on('dir', d => TVNav.move(d));
 *   TVInput.on('confirm', () => TVNav.confirm());
 */
(function (global) {
  'use strict';

  var current = null;
  var root = null;

  function items() {
    var r = root || document;
    return Array.prototype.slice.call(
      r.querySelectorAll('.tv-focus,[data-tv-focus],button,a[tabindex]')
    ).filter(function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function apply() {
    if (!current) return;
    try { current.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    try { current.focus(); } catch (e) {}
  }
  function move(dir) {
    var list = items();
    if (!list.length) return;
    if (!current || list.indexOf(current) < 0) { current = list[0]; apply(); return; }
    var cur = rectOf(current);
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === current) continue;
      var r = rectOf(el);
      var dx = r.x - cur.x, dy = r.y - cur.y;
      var primary, secondary;
      if (dir === 'up') { if (dy >= -1) continue; primary = -dy; secondary = Math.abs(dx); }
      else if (dir === 'down') { if (dy <= 1) continue; primary = dy; secondary = Math.abs(dx); }
      else if (dir === 'left') { if (dx >= -1) continue; primary = -dx; secondary = Math.abs(dy); }
      else { if (dx <= 1) continue; primary = dx; secondary = Math.abs(dy); }
      var score = primary + secondary * 0.4; // 主方向距离 + 次要方向偏差惩罚
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { current = best; apply(); }
  }
  function confirm() { if (current && current.click) current.click(); }
  function focusFirst() { var list = items(); current = list[0] || null; apply(); }

  var TVNav = {
    init: function (scope) { root = scope || null; focusFirst(); },
    move: move,
    confirm: confirm,
    focusFirst: focusFirst,
    get current() { return current; }
  };
  global.TVNav = TVNav;
})(window);

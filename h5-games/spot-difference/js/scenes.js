/*
 * scenes.js —— 找不同的「场景生成 + 矢量绘制」
 *
 * 全部画面由 Canvas 2D 程序化绘制，不依赖任何图片素材，也不使用系统 emoji
 * （目标机型 MiTV4A / Android 6 的 WebView 渲染不了彩色 emoji，会变成 □，
 *   见 docs/STANDARD.md §6）。
 *
 * 对外接口（挂到 window.Scenes）：
 *   Scenes.GRID_COLS / GRID_ROWS      取景框网格列数 / 行数
 *   Scenes.generate(level)            生成一关 -> LevelData
 *   Scenes.prepare(level, w, h, dpr)  预渲染静态画面到离屏 canvas（尺寸/关卡变化时调用）
 *   Scenes.drawPanel(ctx, x0, y0, w, h, side, view, now)
 *                                     把某一侧画面 + 标记 + 取景框画到主 canvas
 *   Scenes.diffCountOf / objCountOf   该关的差异数 / 场景物件数
 *   Scenes.themeOf(level)             该关的画面主题（天色）
 *   Scenes.invalidate()               丢弃离屏缓存
 *
 * LevelData = {
 *   id, level, theme, objects: [Obj], rightObjects: [Obj], diffs: [Diff], diffCount
 * }
 * Obj  = { id, type, x, y, r, color, color2, hidden }    x/y/r 均为 0..1 归一化值
 * Diff = { id, objId, kind, x, y, found, mx, my, addObj }
 *        kind: 'recolor' | 'resize' | 'move' | 'remove' | 'add'
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var GRID_COLS = 7;
  var GRID_ROWS = 4;
  // 画框宽高比近似值：把「归一化 x 距离」换算成与 y 同量纲，用于碰撞判定
  var ASPECT = 1.34;

  var levelSeq = 0;

  // ---------- 通用小工具 ----------
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function hex2rgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function colorDist(a, b) {
    var A = hex2rgb(a), B = hex2rgb(b);
    var dr = A[0] - B[0], dg = A[1] - B[1], db = A[2] - B[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
  // 从色池里挑一个与当前色差异最明显的（在前两名里随机，避免每次都一样）
  function pickDistinct(pool, cur) {
    var scored = [];
    for (var i = 0; i < pool.length; i++) scored.push({ c: pool[i], d: colorDist(pool[i], cur) });
    scored.sort(function (a, b) { return b.d - a.d; });
    var top = scored.slice(0, Math.min(2, scored.length));
    return pick(top).c;
  }

  // ---------- 调色板：每类对象一组「彼此差异明显」的颜色，供 recolor 造差异 ----------
  // 注意：每一组的颜色必须「彼此看得出来的不同」，否则 recolor 类差异等于没造。
  var COLORS = {
    sun:       ['#ffd54f', '#ff9f1c', '#ff7043'],
    moon:      ['#eef3fb'],
    cloud:     ['#ffffff', '#eaf3fc', '#ccdae8'],
    house:     ['#f6e2ca', '#e8cda6', '#dfe8f5', '#f7e3a1', '#f2d7d2'],
    roof:      ['#c0563f', '#8d6e63', '#3f7cac', '#5c6bc0', '#6d8f4e', '#b04f8f'],
    tree:      ['#4caf50', '#2e7d32', '#cddc39', '#26a69a', '#ff9800'],
    flower:    ['#ef5350', '#ab47bc', '#ff7043', '#ec407a', '#7e57c2', '#ffca28'],
    bird:      ['#37474f', '#8d6e63', '#607d8b', '#7e57c2'],
    balloon:   ['#ef5350', '#42a5f5', '#ffca28', '#ab47bc', '#26a69a', '#ff7043'],
    bush:      ['#66bb6a', '#2e7d32', '#c0ca33', '#26a69a'],
    star:      ['#ffd54f', '#fff176', '#ff8a65', '#90caf9'],
    butterfly: ['#ff8a65', '#ba68c8', '#4fc3f7', '#ffd54f', '#f06292'],
    mushroom:  ['#e57373', '#ba68c8', '#ffb74d', '#90caf9', '#aed581'],
    fence:     ['#a1887f', '#c9a227', '#8d6e63', '#b0bec5'],
    kite:      ['#ef5350', '#42a5f5', '#ffca28', '#ab47bc', '#26a69a'],
    dragonfly: ['#4fc3f7', '#81c784', '#ffb74d', '#ba68c8'],
    bee:       ['#ffca28', '#ff8a65', '#aed581'],
    rock:      ['#9e9e9e', '#cfd8dc', '#8d6e63', '#6d7f8c'],
    stump:     ['#a1887f', '#8d6e63', '#c9a227'],
    lamp:      ['#ffd54f', '#4fc3f7', '#ef5350', '#81c784'],
    sign:      ['#e57373', '#4fc3f7', '#81c784', '#ffb74d', '#ba68c8']
  };

  // ---------- 关卡主题：每关换一套天色，画面观感不重复 ----------
  // 地平线固定在 0.62：这样 7×4 取景框的第 2 行（中心 0.625）正好压在草地上，
  // 第 3 行（中心 0.875）在草地中部 —— 地面物件吸附到格子中心后不会「浮在半空」。
  var THEMES = [
    { id: 'day',    name: '晴朗',
      sky: [[0, '#7fc9f2'], [0.50, '#cbe9fa'], [1, '#eaf6e4']],
      hill1: '#b6d9c4', hill2: '#a4cdb6', grass: '#9ed17e', tuft: 'rgba(92,152,72,0.42)' },
    { id: 'dusk',   name: '黄昏',
      sky: [[0, '#f6a35c'], [0.40, '#f7c98b'], [0.72, '#f6dfb4'], [1, '#f3e3c0']],
      hill1: '#c9a98c', hill2: '#b89372', grass: '#c8a86a', tuft: 'rgba(150,116,60,0.45)' },
    { id: 'night',  name: '夜晚', moon: true, stars: true,
      sky: [[0, '#12204a'], [0.55, '#24406e'], [1, '#3d5a83']],
      hill1: '#2f4a63', hill2: '#263d54', grass: '#2b4a45', tuft: 'rgba(120,180,160,0.30)' },
    { id: 'spring', name: '春天',
      sky: [[0, '#8fd3f4'], [0.55, '#d9f0fb'], [1, '#eef7e6']],
      hill1: '#c9e3b6', hill2: '#b3d8a0', grass: '#a8dc86', tuft: 'rgba(104,166,80,0.42)' },
    { id: 'autumn', name: '秋天',
      sky: [[0, '#9ecbe8'], [0.55, '#dbeaf4'], [1, '#f2ecd6']],
      hill1: '#d5c98a', hill2: '#c2b070', grass: '#cbb45f', tuft: 'rgba(146,120,50,0.45)' }
  ];
  function themeOf(level) { return THEMES[(level - 1) % THEMES.length]; }

  // ---------- 各类对象的尺寸范围与出现区域（yMin/yMax 为归一化纵向区间） ----------
  // once: true 表示每幅画只出现一个，由 generate 手动放置，不参与随机撒点
  var TYPES = [
    { type: 'sun',       rMin: 0.044, rMax: 0.060, yMin: 0.13, yMax: 0.22, sky: true,  once: true, pool: COLORS.sun },
    { type: 'moon',      rMin: 0.044, rMax: 0.058, yMin: 0.13, yMax: 0.22, sky: true,  once: true, pool: COLORS.moon },
    { type: 'cloud',     rMin: 0.052, rMax: 0.082, yMin: 0.10, yMax: 0.44, sky: true,  pool: COLORS.cloud },
    { type: 'bird',      rMin: 0.028, rMax: 0.044, yMin: 0.10, yMax: 0.40, sky: true,  pool: COLORS.bird },
    { type: 'balloon',   rMin: 0.028, rMax: 0.042, yMin: 0.12, yMax: 0.36, sky: true,  pool: COLORS.balloon },
    { type: 'star',      rMin: 0.024, rMax: 0.038, yMin: 0.08, yMax: 0.34, sky: true,  pool: COLORS.star },
    { type: 'kite',      rMin: 0.028, rMax: 0.042, yMin: 0.10, yMax: 0.36, sky: true,  pool: COLORS.kite },
    { type: 'butterfly', rMin: 0.026, rMax: 0.040, yMin: 0.18, yMax: 0.50, sky: true,  pool: COLORS.butterfly },
    { type: 'dragonfly', rMin: 0.024, rMax: 0.036, yMin: 0.16, yMax: 0.48, sky: true,  pool: COLORS.dragonfly },
    { type: 'bee',       rMin: 0.020, rMax: 0.030, yMin: 0.20, yMax: 0.50, sky: true,  pool: COLORS.bee },
    { type: 'house',     rMin: 0.068, rMax: 0.094, yMin: 0.64, yMax: 0.86, sky: false, pool: COLORS.house },
    { type: 'tree',      rMin: 0.058, rMax: 0.082, yMin: 0.64, yMax: 0.86, sky: false, pool: COLORS.tree },
    { type: 'lamp',      rMin: 0.032, rMax: 0.046, yMin: 0.66, yMax: 0.88, sky: false, pool: COLORS.lamp },
    { type: 'sign',      rMin: 0.032, rMax: 0.046, yMin: 0.66, yMax: 0.88, sky: false, pool: COLORS.sign },
    { type: 'fence',     rMin: 0.038, rMax: 0.052, yMin: 0.66, yMax: 0.90, sky: false, pool: COLORS.fence },
    { type: 'bush',      rMin: 0.042, rMax: 0.060, yMin: 0.68, yMax: 0.90, sky: false, pool: COLORS.bush },
    { type: 'stump',     rMin: 0.034, rMax: 0.048, yMin: 0.68, yMax: 0.90, sky: false, pool: COLORS.stump },
    { type: 'rock',      rMin: 0.030, rMax: 0.046, yMin: 0.70, yMax: 0.92, sky: false, pool: COLORS.rock },
    { type: 'mushroom',  rMin: 0.030, rMax: 0.044, yMin: 0.70, yMax: 0.92, sky: false, pool: COLORS.mushroom },
    { type: 'flower',    rMin: 0.030, rMax: 0.044, yMin: 0.70, yMax: 0.92, sky: false, pool: COLORS.flower }
  ];
  var META = {};
  var SKY_TYPES = [];
  var GROUND_TYPES = [];
  (function () {
    for (var i = 0; i < TYPES.length; i++) {
      META[TYPES[i].type] = TYPES[i];
      if (TYPES[i].once) continue;
      (TYPES[i].sky ? SKY_TYPES : GROUND_TYPES).push(TYPES[i]);
    }
  })();

  // ============================================================
  //  绘制原语（坐标均为画框内的 CSS 像素）
  // ============================================================

  var PAINTERS = {};

  PAINTERS.sun = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.strokeStyle = o.color;
    ctx.lineWidth = Math.max(1.5, r * 0.16);
    ctx.lineCap = 'round';
    for (var i = 0; i < 8; i++) {
      var a = i * TAU / 8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 1.30, y + Math.sin(a) * r * 1.30);
      ctx.lineTo(x + Math.cos(a) * r * 1.72, y + Math.sin(a) * r * 1.72);
      ctx.stroke();
    }
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  PAINTERS.moon = function (ctx, x, y, r, o) {
    ctx.save();
    // 柔和光晕
    ctx.fillStyle = 'rgba(226,238,255,0.14)';
    ctx.beginPath(); ctx.arc(x, y, r * 1.72, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(226,238,255,0.24)';
    ctx.beginPath(); ctx.arc(x, y, r * 1.32, 0, TAU); ctx.fill();
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    // 环形山
    ctx.fillStyle = 'rgba(176,194,220,0.55)';
    ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.26, r * 0.22, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.28, y + r * 0.18, r * 0.16, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.06, y - r * 0.56, r * 0.11, 0, TAU); ctx.fill();
    ctx.restore();
  };

  PAINTERS.cloud = function (ctx, x, y, r, o) {
    var parts = [[-1.00, 0.18, 0.60], [0.00, 0.00, 0.86], [0.95, 0.20, 0.56],
                 [-0.42, -0.36, 0.56], [0.46, -0.30, 0.50]];
    ctx.save();
    // 先铺一层略大的淡蓝灰底衬：白云落在浅色天空上也有轮廓，否则会「隐形」
    ctx.fillStyle = 'rgba(150,186,214,0.34)';
    for (var k = 0; k < parts.length; k++) {
      ctx.beginPath();
      ctx.arc(x + parts[k][0] * r, y + parts[k][1] * r, parts[k][2] * r * 1.10, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = o.color;
    for (var i = 0; i < parts.length; i++) {
      ctx.beginPath();
      ctx.arc(x + parts[i][0] * r, y + parts[i][1] * r, parts[i][2] * r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  PAINTERS.house = function (ctx, x, y, r, o) {
    var w = r * 1.85, h = r * 1.50;
    ctx.save();
    // 屋顶
    ctx.fillStyle = o.color2 || '#c0563f';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.64, y - h * 0.46);
    ctx.lineTo(x, y - h * 1.14);
    ctx.lineTo(x + w * 0.64, y - h * 0.46);
    ctx.closePath();
    ctx.fill();
    // 墙体
    ctx.fillStyle = o.color;
    ctx.fillRect(x - w * 0.5, y - h * 0.5, w, h);
    // 门
    ctx.fillStyle = 'rgba(66,44,28,0.55)';
    ctx.fillRect(x - w * 0.15, y + h * 0.06, w * 0.30, h * 0.44);
    // 窗
    ctx.fillStyle = '#bfe3ff';
    ctx.fillRect(x + w * 0.16, y - h * 0.34, w * 0.22, h * 0.24);
    ctx.fillRect(x - w * 0.38, y - h * 0.34, w * 0.22, h * 0.24);
    ctx.restore();
  };

  PAINTERS.tree = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(x - r * 0.16, y + r * 0.02, r * 0.32, r * 1.18);
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.arc(x, y - r * 0.26, r * 0.95, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.62, y + r * 0.18, r * 0.60, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.62, y + r * 0.18, r * 0.60, 0, TAU); ctx.fill();
    ctx.restore();
  };

  PAINTERS.fence = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.fillStyle = o.color;
    for (var i = -1; i <= 1; i++) {
      ctx.fillRect(x + i * r * 0.72 - r * 0.13, y - r * 0.74, r * 0.26, r * 1.46);
    }
    ctx.fillRect(x - r * 1.16, y - r * 0.40, r * 2.32, r * 0.19);
    ctx.fillRect(x - r * 1.16, y + r * 0.22, r * 2.32, r * 0.19);
    ctx.restore();
  };

  PAINTERS.bush = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.fillStyle = o.color;
    // 底座：把三瓣连成一片，避免三个圆叠成一个球
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.34, r * 1.28, r * 0.44, 0, 0, TAU);
    ctx.fill();
    var p = [[-0.80, 0.10, 0.48], [0.80, 0.10, 0.48], [0, -0.42, 0.64]];
    for (var i = 0; i < p.length; i++) {
      ctx.beginPath();
      ctx.arc(x + p[i][0] * r, y + p[i][1] * r, p[i][2] * r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  PAINTERS.mushroom = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.fillStyle = '#f5ead6';
    ctx.fillRect(x - r * 0.22, y - r * 0.06, r * 0.44, r * 0.98);
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.06, r * 0.86, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath(); ctx.arc(x - r * 0.36, y - r * 0.40, r * 0.16, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.30, y - r * 0.46, r * 0.13, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.02, y - r * 0.66, r * 0.10, 0, TAU); ctx.fill();
    ctx.restore();
  };

  PAINTERS.flower = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(x - r * 0.07, y - r * 0.10, r * 0.14, r * 1.46);
    ctx.fillStyle = o.color;
    for (var i = 0; i < 5; i++) {
      var a = i * TAU / 5 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.52, y + Math.sin(a) * r * 0.52, r * 0.42, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe082';
    ctx.beginPath(); ctx.arc(x, y, r * 0.30, 0, TAU); ctx.fill();
    ctx.restore();
  };

  PAINTERS.bird = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.strokeStyle = o.color;
    ctx.lineWidth = Math.max(1.6, r * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.quadraticCurveTo(x - r * 0.42, y - r * 0.94, x, y - r * 0.08);
    ctx.quadraticCurveTo(x + r * 0.42, y - r * 0.94, x + r, y);
    ctx.stroke();
    ctx.restore();
  };

  PAINTERS.balloon = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.strokeStyle = 'rgba(70,60,55,0.5)';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.92);
    ctx.quadraticCurveTo(x + r * 0.46, y + r * 1.70, x, y + r * 2.30);
    ctx.stroke();
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.72, r * 0.92, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.13, y + r * 0.86);
    ctx.lineTo(x + r * 0.13, y + r * 0.86);
    ctx.lineTo(x, y + r * 1.06);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  PAINTERS.star = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.fillStyle = o.color;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var rr = (i % 2) ? r * 0.46 : r;
      var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  PAINTERS.butterfly = function (ctx, x, y, r, o) {
    ctx.save();
    // 触角
    ctx.strokeStyle = '#3e2f2a';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.05, y - r * 0.50);
    ctx.quadraticCurveTo(x - r * 0.34, y - r * 1.00, x - r * 0.52, y - r * 0.86);
    ctx.moveTo(x + r * 0.05, y - r * 0.50);
    ctx.quadraticCurveTo(x + r * 0.34, y - r * 1.00, x + r * 0.52, y - r * 0.86);
    ctx.stroke();
    // 四片翅膀：左右各留出缝隙，中间的深色身体才看得见
    ctx.fillStyle = o.color;
    var w = [[-0.74, -0.48, 0.56, 0.40], [-0.58, 0.44, 0.42, 0.30],
             [0.74, -0.48, 0.56, 0.40], [0.58, 0.44, 0.42, 0.30]];
    for (var i = 0; i < w.length; i++) {
      ctx.beginPath();
      ctx.ellipse(x + w[i][0] * r, y + w[i][1] * r, w[i][2] * r, w[i][3] * r, 0, 0, TAU);
      ctx.fill();
    }
    // 身体
    ctx.fillStyle = '#3e2f2a';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.11, r * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  // ============================================================
  //  新增物件：风筝 / 蜻蜓 / 蜜蜂 / 石头 / 树桩 / 路灯 / 路牌
  // ============================================================

  PAINTERS.kite = function (ctx, x, y, r, o) {
    ctx.save();
    // 风筝线
    ctx.strokeStyle = 'rgba(70,60,55,0.42)';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.70);
    ctx.quadraticCurveTo(x - r * 0.62, y + r * 1.60, x - r * 0.98, y + r * 2.26);
    ctx.stroke();
    // 菱形筝面
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.06);
    ctx.lineTo(x + r * 0.80, y - r * 0.12);
    ctx.lineTo(x, y + r * 0.72);
    ctx.lineTo(x - r * 0.80, y - r * 0.12);
    ctx.closePath();
    ctx.fill();
    // 骨架
    ctx.strokeStyle = 'rgba(255,255,255,0.70)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.06);
    ctx.lineTo(x, y + r * 0.72);
    ctx.moveTo(x - r * 0.80, y - r * 0.12);
    ctx.lineTo(x + r * 0.80, y - r * 0.12);
    ctx.stroke();
    ctx.restore();
  };

  PAINTERS.dragonfly = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.fillStyle = o.color;
    var w = [[-0.36, -0.28, 0.64, 0.20], [0.36, -0.28, 0.64, 0.20],
             [-0.32, 0.16, 0.56, 0.17], [0.32, 0.16, 0.56, 0.17]];
    for (var i = 0; i < w.length; i++) {
      ctx.beginPath();
      ctx.ellipse(x + w[i][0] * r, y + w[i][1] * r, w[i][2] * r, w[i][3] * r, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#37474f';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.12, r * 0.80, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - r * 0.84, r * 0.20, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  PAINTERS.bee = function (ctx, x, y, r, o) {
    ctx.save();
    // 翅膀
    ctx.fillStyle = 'rgba(255,255,255,0.70)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.30, y - r * 0.54, r * 0.54, r * 0.28, -0.50, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + r * 0.30, y - r * 0.54, r * 0.54, r * 0.28, 0.50, 0, TAU);
    ctx.fill();
    // 身体（先画圆再裁剪，条纹才不会溢出）
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.66, r * 0.48, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.66, r * 0.48, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#3a3027';
    ctx.fillRect(x - r * 0.20, y - r * 0.60, r * 0.18, r * 1.20);
    ctx.fillRect(x + r * 0.18, y - r * 0.60, r * 0.16, r * 1.20);
    ctx.restore();
    // 头
    ctx.fillStyle = '#3a3027';
    ctx.beginPath();
    ctx.arc(x - r * 0.68, y, r * 0.26, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  PAINTERS.rock = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.moveTo(x - r * 1.06, y + r * 0.56);
    ctx.quadraticCurveTo(x - r * 0.94, y - r * 0.48, x - r * 0.22, y - r * 0.62);
    ctx.quadraticCurveTo(x + r * 0.54, y - r * 0.80, x + r * 0.96, y - r * 0.06);
    ctx.quadraticCurveTo(x + r * 1.14, y + r * 0.46, x + r * 0.74, y + r * 0.58);
    ctx.closePath();
    ctx.fill();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.24, y - r * 0.28, r * 0.40, r * 0.18, -0.35, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  PAINTERS.stump = function (ctx, x, y, r, o) {
    ctx.save();
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.68, y + r * 0.86);
    ctx.lineTo(x - r * 0.50, y - r * 0.40);
    ctx.lineTo(x + r * 0.50, y - r * 0.40);
    ctx.lineTo(x + r * 0.68, y + r * 0.86);
    ctx.closePath();
    ctx.fill();
    // 年轮切面
    ctx.fillStyle = '#c8a878';
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.42, r * 0.54, r * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,110,80,0.75)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.42, r * 0.26, r * 0.10, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  };

  PAINTERS.lamp = function (ctx, x, y, r, o) {
    ctx.save();
    // 灯光
    ctx.fillStyle = 'rgba(255,236,160,0.42)';
    ctx.beginPath();
    ctx.arc(x, y - r * 1.60, r * 0.70, 0, TAU);
    ctx.fill();
    // 灯柱与底座
    ctx.fillStyle = '#4a5560';
    ctx.fillRect(x - r * 0.09, y - r * 1.58, r * 0.18, r * 2.34);
    ctx.fillRect(x - r * 0.44, y + r * 0.66, r * 0.88, r * 0.18);
    // 灯罩
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.48, y - r * 1.34);
    ctx.lineTo(x + r * 0.48, y - r * 1.34);
    ctx.lineTo(x + r * 0.30, y - r * 1.92);
    ctx.lineTo(x - r * 0.30, y - r * 1.92);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  PAINTERS.sign = function (ctx, x, y, r, o) {
    ctx.save();
    // 立杆
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(x - r * 0.09, y - r * 0.24, r * 0.18, r * 1.56);
    // 牌面
    ctx.fillStyle = o.color;
    ctx.fillRect(x - r * 0.88, y - r * 1.18, r * 1.76, r * 0.88);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.strokeRect(x - r * 0.88, y - r * 1.18, r * 1.76, r * 0.88);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x - r * 0.62, y - r * 0.98, r * 1.24, r * 0.13);
    ctx.fillRect(x - r * 0.62, y - r * 0.70, r * 0.84, r * 0.13);
    ctx.restore();
  };

  // ============================================================
  //  场景生成
  // ============================================================

  function newObj(id, type, x, y, r) {
    var meta = META[type];
    var o = {
      id: id,
      type: type,
      x: x,
      y: y,
      r: (typeof r === 'number') ? r : rnd(meta.rMin, meta.rMax),
      color: pick(meta.pool),
      color2: null,
      hidden: false
    };
    if (type === 'house') o.color2 = pick(COLORS.roof);
    return o;
  }

  function copyObj(o) {
    return { id: o.id, type: o.type, x: o.x, y: o.y, r: o.r,
             color: o.color, color2: o.color2, hidden: o.hidden };
  }

  // 两个对象是否靠太近（把 x 距离按 ASPECT 折算成与 y 同量纲）
  function overlaps(objects, x, y, r) {
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      var dx = (o.x - x) * ASPECT;
      var dy = o.y - y;
      if (Math.sqrt(dx * dx + dy * dy) < (o.r + r) * 1.28) return true;
    }
    return false;
  }

  function cellOf(x, y) {
    var c = clamp(Math.floor(x * GRID_COLS), 0, GRID_COLS - 1);
    var r = clamp(Math.floor(y * GRID_ROWS), 0, GRID_ROWS - 1);
    return c + ',' + r;
  }

  function cellCenterX(c) { return (c + 0.5) / GRID_COLS; }
  function cellCenterY(r) { return (r + 0.5) / GRID_ROWS; }

  // 物件相对格子中心的最大抖动（单位：格）。
  // 0.22 格 = 稳稳待在取景框正中间，又不会把所有东西排成死板的棋盘格。
  var CELL_JITTER = 0.22;

  /*
   * 在「还空着的格子」里挑一格放东西，位置取格子中心 ±CELL_JITTER。
   *
   * 这是遥控器手感的关键：取景框永远吸附在格子中心，物件也贴着格子中心，
   * 方向键移过去时物件就落在框子正中间 —— 「居中选中」，而不是卡在框子边角。
   * 同时整幅画仍然是随机生成、大小颜色各异，不会显得是摆好的棋盘。
   *
   * 只在该类型的合理纵向区间内挑行（天上的东西不会跑到草地上）。
   */
  function randomPosOnGrid(meta, objects, freeCells) {
    var cells = [];
    for (var c = 0; c < GRID_COLS; c++) {
      for (var r = 0; r < GRID_ROWS; r++) {
        if (!freeCells[c + ',' + r]) continue;
        var cy = cellCenterY(r);
        if (cy < meta.yMin - 0.09 || cy > meta.yMax + 0.09) continue;
        cells.push([c, r]);
      }
    }
    shuffle(cells);
    for (var i = 0; i < cells.length; i++) {
      var bx = cellCenterX(cells[i][0]), by = cellCenterY(cells[i][1]);
      for (var t = 0; t < 3; t++) {
        var x = bx + rnd(-CELL_JITTER, CELL_JITTER) / GRID_COLS;
        var y = by + rnd(-CELL_JITTER, CELL_JITTER) / GRID_ROWS;
        var rr = rnd(meta.rMin, meta.rMax);
        if (!overlaps(objects, x, y, rr)) {
          return { x: x, y: y, r: rr, cell: cells[i][0] + ',' + cells[i][1] };
        }
      }
    }
    return null;
  }

  function makeDiff(id, o, kind) {
    var d = { id: id, objId: o.id, kind: kind, x: o.x, y: o.y, found: false, mx: 0, my: 0 };
    if (kind === 'move') {
      // 位移幅度控制在半格以内：挪过去之后仍在同一个取景格里，
      // 玩家用同一个格子按 OK 就能判中（原位置与移动后位置都算）。
      var c = clamp(Math.floor(o.x * GRID_COLS), 0, GRID_COLS - 1);
      var r = clamp(Math.floor(o.y * GRID_ROWS), 0, GRID_ROWS - 1);
      var cx = cellCenterX(c), cy = cellCenterY(r);
      var limX = 0.48 / GRID_COLS, limY = 0.48 / GRID_ROWS;
      var dirs = shuffle([[1, 0], [-1, 0], [0, 1], [0, -1],
                          [0.72, 0.70], [-0.72, 0.70], [0.72, -0.70], [-0.72, -0.70]]);
      var len = 0.058;
      var bmx = null, bmy = 0;
      for (var q = 0; q < dirs.length; q++) {
        var mx = dirs[q][0] * len, my = dirs[q][1] * len;
        if (o.x + mx < cx - limX || o.x + mx > cx + limX) continue;
        if (o.y + my < cy - limY || o.y + my > cy + limY) continue;
        if (o.x + mx < 0.04 || o.x + mx > 0.96) continue;   // 越出画框的方向不要
        if (o.y + my < 0.04 || o.y + my > 0.96) continue;
        bmx = mx; bmy = my;
        break;
      }
      if (bmx === null) { bmx = len; bmy = 0; }             // 兜底：一律往右挪
      d.mx = bmx;
      d.my = bmy;
    }
    return d;
  }

  /*
   * 每关的手法配比：保证「凭空多出 / 消失 / 平移 / 变色 / 大小」都能出现，
   * 而不是随机到一整关全是变色 —— 这样每关的破绽类型才够丰富。
   */
  function kindPlan(diffCount, level) {
    var plan = [];
    var adds = Math.min(1 + Math.floor((level - 1) / 2), 3);
    var moves = Math.min(1 + Math.floor((level - 1) / 3), 3);
    var removes = level >= 3 ? Math.min(1 + Math.floor((level - 3) / 3), 2) : 0;
    var i;
    for (i = 0; i < adds; i++) plan.push('add');
    for (i = 0; i < moves; i++) plan.push('move');
    for (i = 0; i < removes; i++) plan.push('remove');
    while (plan.length < diffCount) plan.push(Math.random() < 0.5 ? 'recolor' : 'resize');
    return shuffle(plan.slice(0, diffCount));
  }

  function buildDiffs(objects, diffCount, level, cellsFree) {
    var plan = kindPlan(diffCount, level);
    var diffs = [];
    var diffCell = {};
    // 太阳 / 月亮是每幅画的锚点，不参与差异抽取（月亮只有一个颜色，
    // 拿它做 recolor 等于没造差异；太阳太大，做差异又太容易看出来）
    var pool = [];
    for (var z = 0; z < objects.length; z++) {
      if (!META[objects[z].type].once) pool.push(objects[z]);
    }
    pool = shuffle(pool);
    var pi = 0;                                   // plan 里下一个「非 add」的手法

    for (var i = 0; i < pool.length && diffs.length < diffCount; i++) {
      var o = pool[i];
      var cell = cellOf(o.x, o.y);
      if (diffCell[cell]) continue;                // 同一格只放一处差异
      var kind = null;
      while (pi < plan.length) {
        if (plan[pi] === 'add') { pi++; continue; }
        kind = plan[pi++];
        break;
      }
      if (!kind) break;                            // 非 add 的手法已经用完
      diffCell[cell] = 1;
      diffs.push(makeDiff(diffs.length, o, kind));
    }

    // add 类差异：在「连装饰物都没有」的空格子里凭空多出一件东西
    var addLeft = 0;
    for (var q = 0; q < plan.length; q++) if (plan[q] === 'add') addLeft++;
    if (addLeft > 0) {
      var free = {};
      for (var c = 0; c < GRID_COLS; c++) {
        for (var r = 0; r < GRID_ROWS; r++) {
          if (cellsFree[c + ',' + r]) free[c + ',' + r] = 1;
        }
      }
      var extras = [];
      var guard = 0;
      while (addLeft > 0 && guard++ < 120) {
        var meta = pick(SKY_TYPES.concat(GROUND_TYPES));
        var pos = randomPosOnGrid(meta, objects.concat(extras), free);
        if (!pos) { guard += 6; continue; }
        delete free[pos.cell];
        var extra = newObj(-(diffs.length + 1), meta.type, pos.x, pos.y, pos.r);
        extras.push(extra);
        diffs.push({ id: diffs.length, objId: extra.id, kind: 'add',
                     x: pos.x, y: pos.y, found: false, mx: 0, my: 0, addObj: extra });
        addLeft--;
      }
    }

    return diffs;
  }

  // 依据差异，构造右侧「对比图」的对象列表
  function applyDiffs(objects, diffs) {
    var right = [];
    var i;
    for (i = 0; i < objects.length; i++) right.push(copyObj(objects[i]));

    for (var k = 0; k < diffs.length; k++) {
      var d = diffs[k];
      if (d.kind === 'add') { right.push(copyObj(d.addObj)); continue; }
      var t = null;
      for (i = 0; i < right.length; i++) {
        if (right[i].id === d.objId) { t = right[i]; break; }
      }
      if (!t) continue;

      if (d.kind === 'recolor') {
        if (t.type === 'house') t.color2 = pickDistinct(COLORS.roof, t.color2);
        else t.color = pickDistinct(META[t.type].pool, t.color);
      } else if (d.kind === 'resize') {
        t.r = t.r * (Math.random() < 0.5 ? 1.34 : 0.68);
      } else if (d.kind === 'move') {
        t.x = clamp(t.x + d.mx, 0.05, 0.95);
        t.y = clamp(t.y + d.my, 0.05, 0.95);
      } else if (d.kind === 'remove') {
        t.hidden = true;
      }
    }
    return right;
  }

  // 关卡配置：差异数逐关递增、对象数递增（物件越多，越难一眼扫出破绽）
  function diffCountOf(level) { return Math.min(4 + level, 12); }
  function objCountOf(level) { return Math.min(14 + (level - 1) * 2, 24); }

  function generate(level) {
    var diffCount = diffCountOf(level);
    var objTarget = objCountOf(level);
    var theme = themeOf(level);
    var objects = [];
    var nextId = 1;

    // 空格子表：一格只放一件东西，物件才会均匀铺满整幅画，
    // 每个物件也都贴着格子中心（取景框能「居中选中」的前提）。
    var cellsFree = {};
    var c, r;
    for (c = 0; c < GRID_COLS; c++) {
      for (r = 0; r < GRID_ROWS; r++) cellsFree[c + ',' + r] = 1;
    }

    // 天空锚点：白天是太阳，夜晚换成月亮。放在第一行某一格的中心，
    // 既不会被画框裁掉光芒，也永远不是差异点（once 类型不参与差异抽取）。
    var anchor = theme.moon ? 'moon' : 'sun';
    var aCol = Math.floor(rnd(0, GRID_COLS));
    objects.push(newObj(nextId++, anchor,
      cellCenterX(aCol) + rnd(-0.14, 0.14) / GRID_COLS,
      cellCenterY(0) + rnd(-0.10, 0.10) / GRID_ROWS,
      rnd(META[anchor].rMin, META[anchor].rMax)));
    delete cellsFree[aCol + ',0'];

    var guard = 0;
    while (objects.length < objTarget && guard++ < 500) {
      var wantSky = Math.random() < 0.44;
      var meta = pick(wantSky ? SKY_TYPES : GROUND_TYPES);
      var pos = randomPosOnGrid(meta, objects, cellsFree);
      if (!pos) {
        meta = pick(wantSky ? GROUND_TYPES : SKY_TYPES);   // 这类塞不下了，换一类
        pos = randomPosOnGrid(meta, objects, cellsFree);
        if (!pos) break;                                    // 整幅画都排满了
      }
      delete cellsFree[pos.cell];
      objects.push(newObj(nextId++, meta.type, pos.x, pos.y, pos.r));
    }

    var diffs = buildDiffs(objects, diffCount, level, cellsFree);
    var rightObjects = applyDiffs(objects, diffs);

    levelSeq++;
    return {
      id: levelSeq,
      level: level,
      theme: theme,
      objects: objects,
      rightObjects: rightObjects,
      diffs: diffs,
      diffCount: diffs.length
    };
  }

  // ============================================================
  //  绘制
  // ============================================================

  function paintBackground(ctx, w, h, theme) {
    var HZ = 0.62;   // 地平线：草地从这里开始，与 7×4 取景框第 2 行的中心对齐

    var sky = ctx.createLinearGradient(0, 0, 0, h);
    for (var s = 0; s < theme.sky.length; s++) {
      sky.addColorStop(theme.sky[s][0], theme.sky[s][1]);
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 夜空星点（纯装饰，不参与差异）
    if (theme.stars) {
      var pts = [[0.06, 0.05], [0.19, 0.15], [0.31, 0.04], [0.44, 0.12], [0.57, 0.06],
                 [0.69, 0.17], [0.82, 0.03], [0.94, 0.13], [0.13, 0.27], [0.65, 0.29],
                 [0.38, 0.23], [0.88, 0.26], [0.25, 0.09], [0.76, 0.10]];
      var unit0 = Math.min(w, h);
      for (var p = 0; p < pts.length; p++) {
        ctx.fillStyle = (p % 4 === 0) ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(pts[p][0] * w, pts[p][1] * h, unit0 * (p % 3 === 0 ? 0.0068 : 0.0042), 0, TAU);
        ctx.fill();
      }
    }

    // 远山
    ctx.fillStyle = theme.hill1;
    ctx.beginPath();
    ctx.moveTo(0, h * HZ);
    ctx.quadraticCurveTo(w * 0.18, h * (HZ - 0.17), w * 0.38, h * HZ);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = theme.hill2;
    ctx.beginPath();
    ctx.moveTo(w * 0.50, h * HZ);
    ctx.quadraticCurveTo(w * 0.72, h * (HZ - 0.21), w, h * (HZ - 0.02));
    ctx.lineTo(w, h * HZ);
    ctx.closePath();
    ctx.fill();

    // 草地
    ctx.fillStyle = theme.grass;
    ctx.beginPath();
    ctx.moveTo(0, h * HZ);
    ctx.quadraticCurveTo(w * 0.5, h * (HZ - 0.06), w, h * HZ);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    // 固定的小草纹（不参与差异，纯装饰）
    ctx.strokeStyle = theme.tuft;
    ctx.lineWidth = Math.max(1, h * 0.004);
    var tufts = [[0.07, 0.80], [0.23, 0.90], [0.37, 0.74], [0.55, 0.92],
                 [0.70, 0.78], [0.89, 0.88], [0.14, 0.68], [0.63, 0.70]];
    for (var i = 0; i < tufts.length; i++) {
      var tx = tufts[i][0] * w, ty = tufts[i][1] * h;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - w * 0.008, ty - h * 0.038);
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + w * 0.011, ty - h * 0.032);
      ctx.stroke();
    }
  }

  function paintScene(ctx, w, h, objects, theme) {
    paintBackground(ctx, w, h, theme || THEMES[0]);
    var unit = Math.min(w, h);
    var list = objects.slice().sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.hidden) continue;
      var fn = PAINTERS[o.type];
      if (fn) fn(ctx, o.x * w, o.y * h, o.r * unit, o);
    }
  }

  // ---------- 离屏缓存：静态画面只渲染一次，每帧只叠标记与取景框 ----------
  var cache = { sig: '', left: null, right: null };

  function renderOff(objects, w, h, dpr, theme) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintScene(g, w, h, objects, theme);
    return c;
  }

  function prepare(level, w, h, dpr) {
    if (!level || w < 4 || h < 4) return;
    var sig = level.id + '|' + Math.round(w) + 'x' + Math.round(h) + '@' + dpr;
    if (cache.sig === sig) return;
    cache.left = renderOff(level.objects, w, h, dpr, level.theme);
    cache.right = renderOff(level.rightObjects, w, h, dpr, level.theme);
    cache.sig = sig;
  }

  function cornerMark(ctx, x, y, len, sx, sy) {
    ctx.beginPath();
    ctx.moveTo(x + sx * len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * len);
    ctx.stroke();
  }

  /*
   * view = {
   *   marks:  [{x, y}]        已找到的差异位置（左右两幅都画）
   *   hint:   {x, y} | null   提示脉冲圈
   *   cursor: {x, y, w, h}    取景框（归一化）
   * }
   */
  function drawPanel(ctx, x0, y0, w, h, side, view, now) {
    var off = (side === 'left') ? cache.left : cache.right;
    if (off) {
      ctx.drawImage(off, x0, y0, w, h);
    } else {
      ctx.fillStyle = '#dfe9f2';
      ctx.fillRect(x0, y0, w, h);
    }

    var unit = Math.min(w, h);

    // 提示圈
    if (view.hint) {
      var pulse = 0.86 + 0.24 * Math.sin(now / 210);
      ctx.strokeStyle = 'rgba(255,183,3,0.95)';
      ctx.lineWidth = Math.max(3, unit * 0.013);
      ctx.beginPath();
      ctx.arc(x0 + view.hint.x * w, y0 + view.hint.y * h, unit * 0.085 * pulse, 0, TAU);
      ctx.stroke();
    }

    // 已找到标记（位移类差异在右侧画在「挪过去之后」的位置，圈才不会落空）
    if (view.marks && view.marks.length) {
      for (var i = 0; i < view.marks.length; i++) {
        var m = view.marks[i];
        var mux = (side === 'right' && typeof m.rx === 'number') ? m.rx : m.x;
        var muy = (side === 'right' && typeof m.ry === 'number') ? m.ry : m.y;
        var mx = x0 + mux * w, my = y0 + muy * h;
        var rr = unit * 0.075;
        ctx.beginPath(); ctx.arc(mx, my, rr, 0, TAU);
        ctx.strokeStyle = 'rgba(16,42,32,0.55)';
        ctx.lineWidth = Math.max(5, unit * 0.021);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(mx, my, rr, 0, TAU);
        ctx.strokeStyle = '#6ef0b8';
        ctx.lineWidth = Math.max(3, unit * 0.013);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx - rr * 0.44, my + rr * 0.04);
        ctx.lineTo(mx - rr * 0.10, my + rr * 0.40);
        ctx.lineTo(mx + rr * 0.48, my - rr * 0.40);
        ctx.stroke();
      }
    }

    // 取景框
    if (view.cursor) {
      var cx = x0 + view.cursor.x * w, cy = y0 + view.cursor.y * h;
      var cw = view.cursor.w * w, ch = view.cursor.h * h;
      ctx.fillStyle = 'rgba(255,209,102,0.15)';
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = 'rgba(255,209,102,0.75)';
      ctx.lineWidth = Math.max(1.5, unit * 0.006);
      ctx.strokeRect(cx, cy, cw, ch);

      var L = Math.min(cw, ch) * 0.30;
      ctx.strokeStyle = '#fff6d5';
      ctx.lineWidth = Math.max(3, unit * 0.015);
      ctx.lineCap = 'round';
      cornerMark(ctx, cx, cy, L, 1, 1);
      cornerMark(ctx, cx + cw, cy, L, -1, 1);
      cornerMark(ctx, cx, cy + ch, L, 1, -1);
      cornerMark(ctx, cx + cw, cy + ch, L, -1, -1);
    }

    // 画框描边
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
  }

  global.Scenes = {
    GRID_COLS: GRID_COLS,
    GRID_ROWS: GRID_ROWS,
    generate: generate,
    prepare: prepare,
    drawPanel: drawPanel,
    diffCountOf: diffCountOf,
    objCountOf: objCountOf,
    themeOf: themeOf,
    invalidate: function () { cache.sig = ''; }
  };
})(window);

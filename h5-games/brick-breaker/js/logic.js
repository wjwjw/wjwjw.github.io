/*
 * logic.js —— 弹球打砖块：纯逻辑层（无 DOM / 无 Canvas / 无计时器）
 *
 * 单独拆出来的理由：物理与关卡生成是这个游戏最容易写错、又最该被断言的部分。
 * game.js 只负责状态机、输入和渲染；本文件的每个函数都能在纯 Node 的 vm 里直接跑，
 * 见 test/smoke.js。经典脚本 + IIFE + ES5，兼容 Android 6 WebView。
 *
 * 两个设计红线（都是老式打砖块的经典坑）：
 *   1) 反射角必须钳在「离水平 >= 19 度、离垂直 >= 20 度」的扇区里。
 *      否则球会进入近水平的长循环，在左右墙之间永远弹、一块砖也打不到，孩子只能干等。
 *   2) 挡板按「击中位置」决定出球角度，中心偏陡、边缘偏平；再叠加一点挡板移动的
 *      「搓球」，玩家才有「我能控制球往哪去」的手感，而不是纯靠运气。
 */
(function (global) {
  'use strict';

  var MAX_LEVEL = 6;
  var GRID_COLS = 10;
  var MIN_T = 0.34;    /* 与水平线的最小夹角（弧度，约 19.5 度） */
  var MAX_T = 1.22;    /* 与水平线的最大夹角（约 70 度，即离垂直至少 20 度） */
  var ROW_COLORS = ['#ff7a7a', '#ffa94d', '#ffd166', '#8ce99a', '#66d9e8', '#b197fc'];
  var HEART = [
    '..##..##..',
    '.########.',
    '.########.',
    '..######..',
    '...####...',
    '....##....'
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* 固定种子 LCG：关卡图案必须可复现，重开同一关长得一样（STANDARD §10.3）。 */
  function lcg(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  /*
   * 把任意方向向量归一成单位向量，并钳进四个可用扇区。
   * 返回值的 x / y 符号跟随入参（x == 0 视为向右，y == 0 视为向下），
   * 长度恒为 1，且 |y| >= sin(MIN_T)、|x| >= cos(MAX_T)。
   */
  function clampDir(dx, dy) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    var t = (ax + ay < 1e-8) ? MIN_T : Math.atan2(ay, ax);
    t = clamp(t, MIN_T, MAX_T);
    var sx = dx < 0 ? -1 : 1;
    var sy = dy < 0 ? -1 : 1;
    return { x: sx * Math.cos(t), y: sy * Math.sin(t) };
  }

  /* 挡板反弹。paddleX 是挡板中心，paddleW 是整块宽度，paddleVel 是挡板速度 px/s。 */
  function paddleBounce(ballX, paddleX, paddleW, paddleVel, incomingDx) {
    var half = Math.max(1, paddleW / 2);
    var off = clamp((ballX - paddleX) / half, -1, 1);
    var t = MAX_T - (MAX_T - MIN_T) * Math.abs(off);
    var dir = off === 0 ? (incomingDx < 0 ? -1 : 1) : (off < 0 ? -1 : 1);
    var skew = clamp((paddleVel || 0) * 0.00035, -0.22, 0.22);
    return clampDir(dir * Math.cos(t) + skew, -Math.sin(t));
  }

  /* 圆与矩形的相交判定：取矩形上离球心最近的点。 */
  function hitBrick(ball, rect, radius) {
    var nx = clamp(ball.x, rect.x, rect.x + rect.w);
    var ny = clamp(ball.y, rect.y, rect.y + rect.h);
    var dx = ball.x - nx, dy = ball.y - ny;
    return dx * dx + dy * dy <= radius * radius;
  }

  /*
   * 砖块反弹：按球心相对砖块中心的「归一化偏移」选主轴，
   * 上下进就翻 y、左右进就翻 x，再统一过一次 clampDir 防止角度退化。
   */
  function brickBounce(ball, rect, radius, dx, dy) {
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var rx = (ball.x - cx) / (rect.w / 2 + radius);
    var ry = (ball.y - cy) / (rect.h / 2 + radius);
    var ox = dx, oy = dy;
    if (Math.abs(rx) > Math.abs(ry)) ox = -ox;
    else oy = -oy;
    return clampDir(ox, oy);
  }

  function patternAt(k, c, r, cols, rows) {
    var mid = (cols - 1) / 2;
    var d = Math.abs(c - mid);
    var band;
    switch (k % 6) {
      case 0: /* 实心砖墙，最后一行留透气孔 */
        return (r < rows - 1 || c % 2 === 0) ? 1 : 0;
      case 1: /* 棋盘 */
        return ((c + r) % 2 === 0) ? 1 : 0;
      case 2: /* 金字塔 */
        return (d <= r + 0.6) ? 1 : 0;
      case 3: /* 拱门 */
        band = d + r;
        return (band >= rows - 1.5 && band <= rows + 1.2) ? 1 : 0;
      case 4: /* 心形位图（10 列 6 行） */
        if (r >= HEART.length || c >= HEART[0].length) return 0;
        return HEART[r].charAt(c) === '#' ? 1 : 0;
      default: /* 波浪 + 中轴 */
        return (r === Math.round(rows / 2 + Math.sin(c * 0.9) * 1.3) || d < 1.1) ? 1 : 0;
    }
  }

  /*
   * 生成一关。返回 {cols, rows, bricks:[{c,r,hp,maxHp,star,color,alive}]}。
   * 保证：至少有一块砖；每块 hp 有限（一定能清空）；恰好两颗星砖。
   */
  function buildLevel(level) {
    var lv = Math.max(1, Math.floor(level) || 1);
    var k = lv - 1;
    var rows = Math.min(4 + Math.floor(k / 2), 6);
    if (k % 6 === 4) rows = 6;                 /* 心形图案需要 6 行 */
    var cols = GRID_COLS;
    var bricks = [];
    var c, r, v, hp;
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        v = patternAt(k, c, r, cols, rows);
        if (!v) continue;
        hp = (k >= 2 && (r === 0 || (k >= 4 && r === 1 && c % 3 === 0))) ? 2 : 1;
        bricks.push({
          c: c, r: r, hp: hp, maxHp: hp, star: false,
          color: ROW_COLORS[r % ROW_COLORS.length], alive: true
        });
      }
    }
    if (!bricks.length) {
      bricks.push({ c: 4, r: 0, hp: 1, maxHp: 1, star: false, color: ROW_COLORS[0], alive: true });
    }

    /* 用固定种子挑两颗星砖：位置可复现，且不会因图案不同而挤在同一格 */
    var rnd = lcg(20261108 + lv * 7919);
    var picked = 0, guard = 0;
    while (picked < 2 && guard < 40 && picked < bricks.length) {
      var b = bricks[Math.floor(rnd() * bricks.length)];
      if (!b.star) { b.star = true; picked++; }
      guard++;
    }
    return { cols: cols, rows: rows, bricks: bricks };
  }

  /* 球速（px/s）：慢起步、逐关小步加速，封顶，避免老设备上快到穿砖 */
  function levelSpeed(level) {
    return Math.min(420, 250 + (Math.max(1, level) - 1) * 24);
  }

  global.BrickLogic = {
    MAX_LEVEL: MAX_LEVEL,
    GRID_COLS: GRID_COLS,
    MIN_T: MIN_T,
    MAX_T: MAX_T,
    clamp: clamp,
    lcg: lcg,
    clampDir: clampDir,
    paddleBounce: paddleBounce,
    hitBrick: hitBrick,
    brickBounce: brickBounce,
    buildLevel: buildLevel,
    levelSpeed: levelSpeed
  };
})(typeof window !== 'undefined' ? window : this);

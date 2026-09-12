/*
 * art.js —— 认知问答的「图形素材库」
 *
 * 全部由 Canvas 2D 程序化绘制，不用图片素材、不用系统 emoji
 * （目标机型 MiTV4A / Android 6 的 WebView 渲染不了彩色 emoji，会变成 □，
 *   见 h5-games/docs/STANDARD.md §6）。
 *
 * 关键设计：**低龄儿童不识字**，所以题目全部靠图形传达 ——
 * 题干是一张图（一个形状 / 一个动物 / 一堆积木），选项是四张图，孩子只需
 * 「看哪张和上面一样」就能作答，全程不需要读一个字。
 *
 * 对外接口（挂到 window.Art）：
 *   Art.COLORS / Art.SHAPES / Art.ANIMALS   素材清单
 *   Art.paint(ctx, item, x, y, r)           画一个 item（{k:'shape'|'animal'|'digit', ...}）
 *   Art.roundRect(ctx, x, y, w, h, r)       圆角矩形路径（Chrome 47 没有 ctx.roundRect）
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  // 8 个色相拉得很开的颜色。认颜色的题必须一眼能分辨，
  // 所以刻意避开「橙 vs 黄」「蓝 vs 青」这种容易混的邻近色。
  var COLORS = [
    { id: 'red', c: '#E53935' },
    { id: 'orange', c: '#FB8C00' },
    { id: 'yellow', c: '#FDD835' },
    { id: 'green', c: '#43A047' },
    { id: 'blue', c: '#1E88E5' },
    { id: 'purple', c: '#8E24AA' },
    { id: 'pink', c: '#EC407A' },
    { id: 'brown', c: '#8D6E63' }
  ];
  var COLOR_IDS = COLORS.map(function (o) { return o.id; });
  function colorOf(id) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i].c;
    return '#E53935';
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ============================================================
  //  形状（8 种）：轮廓差异要足够大，缩到卡片里也一眼能分
  // ============================================================
  var SHAPES = [
    { id: 'circle', name: '圆形' },
    { id: 'square', name: '方形' },
    { id: 'triangle', name: '三角' },
    { id: 'star', name: '星星' },
    { id: 'heart', name: '爱心' },
    { id: 'diamond', name: '菱形' },
    { id: 'hexagon', name: '六边形' },
    { id: 'cross', name: '十字' }
  ];
  var SHAPE_IDS = SHAPES.map(function (o) { return o.id; });

  var SHAPE_PAINT = {};

  SHAPE_PAINT.circle = function (ctx, x, y, r, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  };

  SHAPE_PAINT.square = function (ctx, x, y, r, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
  };

  SHAPE_PAINT.triangle = function (ctx, x, y, r, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.06);
    ctx.lineTo(x + r * 0.98, y + r * 0.72);
    ctx.lineTo(x - r * 0.98, y + r * 0.72);
    ctx.closePath();
    ctx.fill();
  };

  SHAPE_PAINT.star = function (ctx, x, y, r, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var rr = (i % 2) ? r * 0.46 : r * 1.10;
      var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };

  SHAPE_PAINT.heart = function (ctx, x, y, r, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.94);
    ctx.bezierCurveTo(x - r * 1.36, y - r * 0.14, x - r * 0.60, y - r * 1.08, x, y - r * 0.36);
    ctx.bezierCurveTo(x + r * 0.60, y - r * 1.08, x + r * 1.36, y - r * 0.14, x, y + r * 0.94);
    ctx.closePath();
    ctx.fill();
  };

  SHAPE_PAINT.diamond = function (ctx, x, y, r, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.10);
    ctx.lineTo(x + r * 0.86, y);
    ctx.lineTo(x, y + r * 1.10);
    ctx.lineTo(x - r * 0.86, y);
    ctx.closePath();
    ctx.fill();
  };

  SHAPE_PAINT.hexagon = function (ctx, x, y, r, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI / 2 + i * TAU / 6;
      var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };

  SHAPE_PAINT.cross = function (ctx, x, y, r, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x - r * 0.34, y - r, r * 0.68, r * 2);
    ctx.fillRect(x - r, y - r * 0.34, r * 2, r * 0.68);
  };

  // ============================================================
  //  动物（8 种）：头 + 标志性特征，+ 眼睛，孩子能认出来
  // ============================================================
  var ANIMALS = [
    { id: 'cat', name: '小猫' },
    { id: 'dog', name: '小狗' },
    { id: 'fish', name: '小鱼' },
    { id: 'bird', name: '小鸟' },
    { id: 'rabbit', name: '兔子' },
    { id: 'bear', name: '小熊' },
    { id: 'frog', name: '青蛙' },
    { id: 'duck', name: '鸭子' }
  ];
  var ANIMAL_IDS = ANIMALS.map(function (o) { return o.id; });

  // 眼睛统一画：位置略偏上，间距 0.6r
  function eyes(ctx, x, y, r, spread, dy) {
    ctx.fillStyle = '#263238';
    ctx.beginPath(); ctx.arc(x - r * spread, y - r * (dy || 0.12), r * 0.11, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * spread, y - r * (dy || 0.12), r * 0.11, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(x - r * spread - r * 0.04, y - r * (dy || 0.12) - r * 0.04, r * 0.04, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * spread - r * 0.04, y - r * (dy || 0.12) - r * 0.04, r * 0.04, 0, TAU); ctx.fill();
  }

  var ANIMAL_PAINT = {};

  ANIMAL_PAINT.cat = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    // 耳朵
    ctx.beginPath();
    ctx.moveTo(x - r * 0.74, y - r * 0.36); ctx.lineTo(x - r * 0.40, y - r * 1.06);
    ctx.lineTo(x - r * 0.06, y - r * 0.56); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + r * 0.74, y - r * 0.36); ctx.lineTo(x + r * 0.40, y - r * 1.06);
    ctx.lineTo(x + r * 0.06, y - r * 0.56); ctx.closePath(); ctx.fill();
    // 头
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.86, r * 0.78, 0, 0, TAU); ctx.fill();
    eyes(ctx, x, y, r, 0.30);
    // 鼻子
    ctx.fillStyle = '#ff8a80';
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.20); ctx.lineTo(x - r * 0.11, y + r * 0.02);
    ctx.lineTo(x + r * 0.11, y + r * 0.02); ctx.closePath(); ctx.fill();
    // 胡须
    ctx.strokeStyle = 'rgba(38,50,56,0.5)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.24, y + r * 0.14); ctx.lineTo(x - r * 0.72, y + r * 0.06);
    ctx.moveTo(x - r * 0.24, y + r * 0.22); ctx.lineTo(x - r * 0.70, y + r * 0.30);
    ctx.moveTo(x + r * 0.24, y + r * 0.14); ctx.lineTo(x + r * 0.72, y + r * 0.06);
    ctx.moveTo(x + r * 0.24, y + r * 0.22); ctx.lineTo(x + r * 0.70, y + r * 0.30);
    ctx.stroke();
    ctx.restore();
  };

  ANIMAL_PAINT.dog = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    // 垂耳
    ctx.beginPath(); ctx.ellipse(x - r * 0.72, y - r * 0.12, r * 0.26, r * 0.52, 0.18, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + r * 0.72, y - r * 0.12, r * 0.26, r * 0.52, -0.18, 0, TAU); ctx.fill();
    // 头
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.82, r * 0.76, 0, 0, TAU); ctx.fill();
    // 口鼻
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.34, r * 0.42, r * 0.30, 0, 0, TAU); ctx.fill();
    eyes(ctx, x, y, r, 0.28);
    // 鼻头
    ctx.fillStyle = '#263238';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.24, r * 0.15, r * 0.11, 0, 0, TAU); ctx.fill();
    ctx.restore();
  };

  ANIMAL_PAINT.fish = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.ellipse(x - r * 0.10, y, r * 0.80, r * 0.56, 0, 0, TAU); ctx.fill();
    // 尾
    ctx.beginPath();
    ctx.moveTo(x + r * 0.60, y); ctx.lineTo(x + r * 1.18, y - r * 0.52);
    ctx.lineTo(x + r * 1.18, y + r * 0.52); ctx.closePath(); ctx.fill();
    // 背鳍
    ctx.beginPath();
    ctx.moveTo(x - r * 0.20, y - r * 0.50); ctx.lineTo(x + r * 0.10, y - r * 1.02);
    ctx.lineTo(x + r * 0.34, y - r * 0.44); ctx.closePath(); ctx.fill();
    // 肚鳍
    ctx.beginPath();
    ctx.moveTo(x - r * 0.16, y + r * 0.48); ctx.lineTo(x + r * 0.06, y + r * 0.94);
    ctx.lineTo(x + r * 0.30, y + r * 0.42); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.30, y + r * 0.16, r * 0.32, r * 0.14, -0.26, 0, TAU); ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.beginPath(); ctx.arc(x - r * 0.54, y - r * 0.12, r * 0.12, 0, TAU); ctx.fill();
    ctx.restore();
  };

  ANIMAL_PAINT.bird = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    // 身体
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.10, r * 0.72, r * 0.62, 0, 0, TAU); ctx.fill();
    // 头
    ctx.beginPath(); ctx.arc(x + r * 0.10, y - r * 0.52, r * 0.42, 0, TAU); ctx.fill();
    // 翅膀
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.24, y + r * 0.14, r * 0.42, r * 0.26, -0.30, 0, TAU); ctx.fill();
    // 尾
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.62, y - r * 0.06); ctx.lineTo(x - r * 1.20, y + r * 0.18);
    ctx.lineTo(x - r * 0.58, y + r * 0.40); ctx.closePath(); ctx.fill();
    // 喙
    ctx.fillStyle = '#F9A825';
    ctx.beginPath();
    ctx.moveTo(x + r * 0.46, y - r * 0.52); ctx.lineTo(x + r * 0.86, y - r * 0.40);
    ctx.lineTo(x + r * 0.46, y - r * 0.26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.beginPath(); ctx.arc(x + r * 0.20, y - r * 0.62, r * 0.09, 0, TAU); ctx.fill();
    ctx.restore();
  };

  ANIMAL_PAINT.rabbit = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    // 长耳
    ctx.beginPath(); ctx.ellipse(x - r * 0.34, y - r * 1.00, r * 0.18, r * 0.56, 0.12, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + r * 0.34, y - r * 1.00, r * 0.18, r * 0.56, -0.12, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.34, y - r * 1.00, r * 0.09, r * 0.38, 0.12, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + r * 0.34, y - r * 1.00, r * 0.09, r * 0.38, -0.12, 0, TAU); ctx.fill();
    // 头
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.06, r * 0.72, r * 0.68, 0, 0, TAU); ctx.fill();
    eyes(ctx, x, y + r * 0.06, r, 0.26);
    // 鼻 + 门牙
    ctx.fillStyle = '#EC407A';
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.28); ctx.lineTo(x - r * 0.09, y + r * 0.14);
    ctx.lineTo(x + r * 0.09, y + r * 0.14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - r * 0.11, y + r * 0.34, r * 0.09, r * 0.20);
    ctx.fillRect(x + r * 0.02, y + r * 0.34, r * 0.09, r * 0.20);
    ctx.restore();
  };

  ANIMAL_PAINT.bear = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    // 圆耳
    ctx.beginPath(); ctx.arc(x - r * 0.62, y - r * 0.66, r * 0.28, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.62, y - r * 0.66, r * 0.28, 0, TAU); ctx.fill();
    // 头
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.02, r * 0.84, r * 0.76, 0, 0, TAU); ctx.fill();
    // 口鼻
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.34, r * 0.36, r * 0.26, 0, 0, TAU); ctx.fill();
    eyes(ctx, x, y, r, 0.28, 0.06);
    ctx.fillStyle = '#263238';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.24, r * 0.14, r * 0.10, 0, 0, TAU); ctx.fill();
    ctx.restore();
  };

  ANIMAL_PAINT.frog = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    // 身体
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.16, r * 0.86, r * 0.62, 0, 0, TAU); ctx.fill();
    // 两只鼓眼睛（长在头顶）
    ctx.beginPath(); ctx.arc(x - r * 0.42, y - r * 0.40, r * 0.30, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.42, y - r * 0.40, r * 0.30, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x - r * 0.42, y - r * 0.40, r * 0.19, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.42, y - r * 0.40, r * 0.19, 0, TAU); ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.beginPath(); ctx.arc(x - r * 0.42, y - r * 0.38, r * 0.10, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.42, y - r * 0.38, r * 0.10, 0, TAU); ctx.fill();
    // 嘴
    ctx.strokeStyle = 'rgba(38,50,56,0.6)';
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.52, y + r * 0.26);
    ctx.quadraticCurveTo(x, y + r * 0.60, x + r * 0.52, y + r * 0.26);
    ctx.stroke();
    ctx.restore();
  };

  ANIMAL_PAINT.duck = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    // 身体
    ctx.beginPath(); ctx.ellipse(x - r * 0.06, y + r * 0.30, r * 0.82, r * 0.54, 0, 0, TAU); ctx.fill();
    // 头
    ctx.beginPath(); ctx.arc(x + r * 0.28, y - r * 0.38, r * 0.44, 0, TAU); ctx.fill();
    // 尾
    ctx.beginPath();
    ctx.moveTo(x - r * 0.78, y + r * 0.10); ctx.lineTo(x - r * 1.20, y - r * 0.18);
    ctx.lineTo(x - r * 0.70, y + r * 0.44); ctx.closePath(); ctx.fill();
    // 喙（扁）
    ctx.fillStyle = '#F9A825';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.76, y - r * 0.30, r * 0.34, r * 0.15, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.beginPath(); ctx.arc(x + r * 0.30, y - r * 0.50, r * 0.09, 0, TAU); ctx.fill();
    ctx.restore();
  };

  // ============================================================
  //  统一绘制入口
  //  item = { k:'shape', id, color, size } | { k:'animal', id, color, size } | { k:'digit', n }
  // ============================================================
  var DIGIT_COLOR = '#37474F';

  function paint(ctx, item, x, y, r) {
    if (!item) return;
    var rr = r * (typeof item.size === 'number' ? item.size : 1);
    if (item.k === 'shape') {
      var fs = SHAPE_PAINT[item.id];
      if (fs) fs(ctx, x, y, rr, colorOf(item.color));
    } else if (item.k === 'animal') {
      var fa = ANIMAL_PAINT[item.id];
      if (fa) fa(ctx, x, y, rr, colorOf(item.color || 'brown'));
    } else if (item.k === 'digit') {
      ctx.save();
      ctx.fillStyle = DIGIT_COLOR;
      ctx.font = 'bold ' + Math.round(rr * 1.7) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(item.n), x, y);
      ctx.restore();
    }
  }

  global.Art = {
    COLORS: COLORS,
    COLOR_IDS: COLOR_IDS,
    colorOf: colorOf,
    SHAPES: SHAPES,
    SHAPE_IDS: SHAPE_IDS,
    ANIMALS: ANIMALS,
    ANIMAL_IDS: ANIMAL_IDS,
    roundRect: roundRect,
    paint: paint
  };
})(window);

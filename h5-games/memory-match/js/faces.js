/*
 * faces.js —— 记忆翻牌的「卡片图案库」
 *
 * 全部图案由 Canvas 2D 程序化绘制，不用图片素材、不用系统 emoji
 * （目标机型 MiTV4A / Android 6 的 WebView 渲染不了彩色 emoji，会变成 □，
 *   见 h5-games/docs/STANDARD.md §6）。
 *
 * 设计要点：
 *   1) 每种图案 = 一个独特的「形状 + 颜色」组合。记忆配对靠形状辨认，
 *      颜色只是辅助线索 —— 所以形状之间的差异比颜色差异更重要，
 *      颜色也刻意拉开色相，避免出现「两个黄色图案分不清」。
 *   2) 图案画在浅色卡面上（plate），所以月亮这类需要「挖掉一块」的图形
 *      直接用 plate 色再盖一个圆，比用两段弧拼月牙稳得多。
 *
 * 对外接口（挂到 window.Faces）：
 *   Faces.list          图案数组 [{ id, name, color, color2, paint }]
 *   Faces.count         图案种数
 *   Faces.paint(ctx, face, x, y, r, plate)   把图案画到 (x, y)，r 为半径
 *   Faces.roundRect(ctx, x, y, w, h, r)      圆角矩形路径（Chrome 47 没有 ctx.roundRect）
 *   Faces.FACE_PLATE    卡面底色（图案挖空时也用这个色）
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  // 卡面底色。月亮挖缺、云朵高光都用它，所以必须和 game.js 里画的卡面一致。
  var FACE_PLATE = '#FFFCF2';

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
  //  图案绘制原语：签名统一为 (ctx, x, y, r, color, color2, plate)
  //  x/y 为图案中心，r 为基准半径（约等于图案外接圆的一半）
  // ============================================================
  var PAINT = {};

  PAINT.sun = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.strokeStyle = c;
    ctx.lineWidth = Math.max(1.5, r * 0.17);
    ctx.lineCap = 'round';
    for (var i = 0; i < 8; i++) {
      var a = i * TAU / 8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 1.34, y + Math.sin(a) * r * 1.34);
      ctx.lineTo(x + Math.cos(a) * r * 1.76, y + Math.sin(a) * r * 1.76);
      ctx.stroke();
    }
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  PAINT.star = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
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

  // 月牙：先画整圆，再用卡面底色盖掉一块（比两段弧拼出来的形状稳）
  PAINT.moon = function (ctx, x, y, r, c, c2, plate) {
    ctx.save();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = plate || FACE_PLATE;
    ctx.beginPath();
    ctx.arc(x + r * 0.56, y - r * 0.14, r * 0.94, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  PAINT.cloud = function (ctx, x, y, r, c) {
    var parts = [[-1.00, 0.18, 0.58], [0.00, 0.00, 0.84], [0.96, 0.20, 0.54],
                 [-0.44, -0.34, 0.54], [0.46, -0.28, 0.48]];
    ctx.save();
    // 先铺一层略大的深色底衬：浅蓝云朵落在浅色卡面上也有轮廓，否则会「隐形」
    ctx.fillStyle = 'rgba(74,110,150,0.34)';
    var k;
    for (k = 0; k < parts.length; k++) {
      ctx.beginPath();
      ctx.arc(x + parts[k][0] * r, y + parts[k][1] * r, parts[k][2] * r * 1.10, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = c;
    for (k = 0; k < parts.length; k++) {
      ctx.beginPath();
      ctx.arc(x + parts[k][0] * r, y + parts[k][1] * r, parts[k][2] * r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  PAINT.tree = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(x - r * 0.17, y + r * 0.02, r * 0.34, r * 1.20);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y - r * 0.26, r * 0.96, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.62, y + r * 0.18, r * 0.60, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.62, y + r * 0.18, r * 0.60, 0, TAU); ctx.fill();
    ctx.restore();
  };

  PAINT.flower = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(x - r * 0.08, y - r * 0.10, r * 0.16, r * 1.52);
    ctx.fillStyle = c;
    for (var i = 0; i < 5; i++) {
      var a = i * TAU / 5 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.54, y + Math.sin(a) * r * 0.54, r * 0.44, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe082';
    ctx.beginPath(); ctx.arc(x, y, r * 0.31, 0, TAU); ctx.fill();
    ctx.restore();
  };

  PAINT.house = function (ctx, x, y, r, c, c2) {
    var w = r * 1.88, h = r * 1.52;
    ctx.save();
    ctx.fillStyle = c2 || '#8d5b4c';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.66, y - h * 0.44);
    ctx.lineTo(x, y - h * 1.16);
    ctx.lineTo(x + w * 0.66, y - h * 0.44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c;
    ctx.fillRect(x - w * 0.5, y - h * 0.5, w, h);
    ctx.fillStyle = 'rgba(66,44,28,0.58)';
    ctx.fillRect(x - w * 0.15, y + h * 0.06, w * 0.30, h * 0.44);
    ctx.fillStyle = '#bfe3ff';
    ctx.fillRect(x + w * 0.16, y - h * 0.34, w * 0.22, h * 0.24);
    ctx.fillRect(x - w * 0.38, y - h * 0.34, w * 0.22, h * 0.24);
    ctx.restore();
  };

  PAINT.butterfly = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.strokeStyle = '#3e2f2a';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.05, y - r * 0.50);
    ctx.quadraticCurveTo(x - r * 0.34, y - r * 1.00, x - r * 0.54, y - r * 0.86);
    ctx.moveTo(x + r * 0.05, y - r * 0.50);
    ctx.quadraticCurveTo(x + r * 0.34, y - r * 1.00, x + r * 0.54, y - r * 0.86);
    ctx.stroke();
    // 四片翅膀：左右留缝，中间的深色身体才看得见
    ctx.fillStyle = c;
    var w = [[-0.76, -0.48, 0.58, 0.42], [-0.60, 0.46, 0.44, 0.32],
             [0.76, -0.48, 0.58, 0.42], [0.60, 0.46, 0.44, 0.32]];
    for (var i = 0; i < w.length; i++) {
      ctx.beginPath();
      ctx.ellipse(x + w[i][0] * r, y + w[i][1] * r, w[i][2] * r, w[i][3] * r, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#3e2f2a';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.12, r * 0.64, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  PAINT.fish = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.12, y, r * 0.82, r * 0.52, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + r * 0.58, y);
    ctx.lineTo(x + r * 1.22, y - r * 0.52);
    ctx.lineTo(x + r * 1.22, y + r * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.24, y + r * 0.20, r * 0.34, r * 0.14, -0.28, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#20303f';
    ctx.beginPath(); ctx.arc(x - r * 0.56, y - r * 0.14, r * 0.12, 0, TAU); ctx.fill();
    ctx.restore();
  };

  PAINT.car = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x - r * 1.00, y + r * 0.30);
    ctx.lineTo(x - r * 1.00, y - r * 0.08);
    ctx.quadraticCurveTo(x - r * 0.92, y - r * 0.22, x - r * 0.64, y - r * 0.24);
    ctx.lineTo(x - r * 0.40, y - r * 0.70);
    ctx.lineTo(x + r * 0.34, y - r * 0.70);
    ctx.lineTo(x + r * 0.62, y - r * 0.24);
    ctx.lineTo(x + r * 0.96, y - r * 0.16);
    ctx.quadraticCurveTo(x + r * 1.06, y - r * 0.06, x + r * 1.04, y + r * 0.30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(236,247,255,0.92)';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.32, y - r * 0.62);
    ctx.lineTo(x + r * 0.26, y - r * 0.62);
    ctx.lineTo(x + r * 0.46, y - r * 0.30);
    ctx.lineTo(x - r * 0.46, y - r * 0.30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#37474f';
    ctx.beginPath(); ctx.arc(x - r * 0.58, y + r * 0.32, r * 0.30, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.60, y + r * 0.32, r * 0.30, 0, TAU); ctx.fill();
    ctx.fillStyle = '#cfd8dc';
    ctx.beginPath(); ctx.arc(x - r * 0.58, y + r * 0.32, r * 0.12, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.60, y + r * 0.32, r * 0.12, 0, TAU); ctx.fill();
    ctx.restore();
  };

  PAINT.bee = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = 'rgba(150,180,215,0.55)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.30, y - r * 0.56, r * 0.56, r * 0.30, -0.50, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + r * 0.30, y - r * 0.56, r * 0.56, r * 0.30, 0.50, 0, TAU);
    ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.72, r * 0.52, 0, 0, TAU);
    ctx.fill();
    // 条纹用 clip 裁在身体内，才不会溢出
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.72, r * 0.52, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#3a3027';
    ctx.fillRect(x - r * 0.22, y - r * 0.64, r * 0.20, r * 1.28);
    ctx.fillRect(x + r * 0.20, y - r * 0.64, r * 0.18, r * 1.28);
    ctx.restore();
    // 头：贴着身体左缘，而不是飘在外面
    ctx.fillStyle = '#3a3027';
    ctx.beginPath();
    ctx.arc(x - r * 0.58, y, r * 0.26, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  PAINT.mushroom = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = '#f5ead6';
    ctx.fillRect(x - r * 0.23, y - r * 0.06, r * 0.46, r * 1.00);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.06, r * 0.88, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.90)';
    ctx.beginPath(); ctx.arc(x - r * 0.37, y - r * 0.42, r * 0.17, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.31, y - r * 0.48, r * 0.14, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.02, y - r * 0.68, r * 0.11, 0, TAU); ctx.fill();
    ctx.restore();
  };

  PAINT.apple = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x - r * 0.34, y + r * 0.10, r * 0.66, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.34, y + r * 0.10, r * 0.66, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.30, r * 0.72, r * 0.54, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#6d4c41';
    ctx.lineWidth = Math.max(1.5, r * 0.15);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.44);
    ctx.quadraticCurveTo(x + r * 0.06, y - r * 0.88, x + r * 0.26, y - r * 0.96);
    ctx.stroke();
    ctx.fillStyle = '#66bb6a';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.48, y - r * 0.68, r * 0.36, r * 0.18, -0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  PAINT.heart = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.88);
    ctx.bezierCurveTo(x - r * 1.32, y - r * 0.12, x - r * 0.58, y - r * 1.04, x, y - r * 0.34);
    ctx.bezierCurveTo(x + r * 0.58, y - r * 1.04, x + r * 1.32, y - r * 0.12, x, y + r * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  PAINT.note = function (ctx, x, y, r, c) {
    ctx.save();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.36, y + r * 0.64, r * 0.44, r * 0.33, -0.32, 0, TAU);
    ctx.fill();
    ctx.fillRect(x, y - r * 0.88, r * 0.19, r * 1.54);
    ctx.beginPath();
    ctx.moveTo(x + r * 0.19, y - r * 0.88);
    ctx.quadraticCurveTo(x + r * 0.94, y - r * 0.74, x + r * 0.76, y - r * 0.16);
    ctx.quadraticCurveTo(x + r * 0.82, y - r * 0.58, x + r * 0.19, y - r * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // ============================================================
  //  图案清单：顺序即抽取优先级，color 尽量拉开色相
  // ============================================================
  var FACES = [
    { id: 'sun',       name: '太阳', color: '#FF9F1C' },
    { id: 'star',      name: '星星', color: '#FFD400' },
    { id: 'cloud',     name: '云朵', color: '#8FBEE8' },
    { id: 'tree',      name: '小树', color: '#43A047' },
    { id: 'flower',    name: '花朵', color: '#EC407A' },
    { id: 'house',     name: '房子', color: '#E53935', color2: '#8D5B4C' },
    { id: 'butterfly', name: '蝴蝶', color: '#9C6ADE' },
    { id: 'fish',      name: '小鱼', color: '#00BCD4' },
    { id: 'car',       name: '汽车', color: '#8D6E63' },
    { id: 'bee',       name: '蜜蜂', color: '#F2B705' },
    { id: 'mushroom',  name: '蘑菇', color: '#C2477C' },
    { id: 'apple',     name: '苹果', color: '#8BC34A' },
    { id: 'heart',     name: '爱心', color: '#FF7043' },
    { id: 'note',      name: '音符', color: '#5C7CFA' },
    { id: 'moon',      name: '月亮', color: '#7FA9E0' }
  ];

  global.Faces = {
    list: FACES,
    count: FACES.length,
    FACE_PLATE: FACE_PLATE,
    roundRect: roundRect,
    // face 可传索引或对象；plate 省略时用卡面底色
    paint: function (ctx, face, x, y, r, plate) {
      var f = (typeof face === 'number') ? FACES[face] : face;
      if (!f) return;
      var fn = PAINT[f.id];
      if (!fn) return;
      fn(ctx, x, y, r, f.color, f.color2, plate || FACE_PLATE);
    }
  };
})(window);

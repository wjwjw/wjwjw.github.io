/*
 * themes.js —— 推箱子主题绘制层
 *
 * 四套「角色 × 场景」配套（套装一键整配，也可自由混搭）：
 *   搬运工阿力 × 旧仓库 / 小农夫豆豆 × 果园农庄 / 企鹅波波 × 冰雪世界 / 宇航员小宇 × 太空货舱
 * 角色与场景各自只认一个 id，互不引用，因此任何组合都能画。
 *
 * 风格配置（opts，由 game.js 透传）：
 *   solid    伪 3D 立体块（顶面+侧面+投影）；false = 纯俯视平面圆角块
 *   contrast 高对比：墙/箱与地板的明度差拉大，目标点更亮，电视远看更清楚
 *
 * 所有画面都是 Canvas 2D 矢量绘制：目标电视（Android 6 / Chromium 47）没有彩色
 * emoji，也不引入外部图片；静态背景预渲染到离屏 canvas（STANDARD §10.3），
 * 渲染循环内只做平铺与纯色填充，不建渐变、不拼 rgba 字符串。
 *
 * 兼容：经典脚本 + IIFE，纯 ES5。
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var INK = '#20242e';

  // ---------- 数据：套装 / 角色 / 场景 ----------
  var PACKS = [
    { id: 'warehouse', name: '仓库搬运工', desc: '工装阿力 · 旧仓库', char: 'worker',  scene: 'warehouse', accent: '#b5722e' },
    { id: 'farm',      name: '农场小农夫', desc: '草帽豆豆 · 果园农庄', char: 'farmer',  scene: 'farm',      accent: '#6cbf5a' },
    { id: 'ice',       name: '冰雪小企鹅', desc: '企鹅波波 · 冰雪世界', char: 'penguin', scene: 'ice',       accent: '#7ec8f2' },
    { id: 'space',     name: '太空宇航员', desc: '小宇 · 太空货舱',     char: 'astro',   scene: 'space',     accent: '#a98df0' }
  ];

  var CHARACTERS = [
    { id: 'worker',  name: '搬运工阿力', desc: '戴着鸭舌帽的搬货老手', pack: 'warehouse', accent: '#b5722e' },
    { id: 'farmer',  name: '小农夫豆豆', desc: '顶着草帽推竹筐',       pack: 'farm',      accent: '#6cbf5a' },
    { id: 'penguin', name: '企鹅波波',   desc: '抱着冰块摇摇摆摆',     pack: 'ice',       accent: '#7ec8f2' },
    { id: 'astro',   name: '宇航员小宇', desc: '太空货舱里搬货箱',     pack: 'space',     accent: '#a98df0' }
  ];

  var SCENES = [
    { id: 'warehouse', name: '旧仓库',   short: '仓库', pack: 'warehouse', accent: '#b5722e' },
    { id: 'farm',      name: '果园农庄', short: '农场', pack: 'farm',      accent: '#6cbf5a' },
    { id: 'ice',       name: '冰雪世界', short: '冰雪', pack: 'ice',       accent: '#7ec8f2' },
    { id: 'space',     name: '太空货舱', short: '太空', pack: 'space',     accent: '#a98df0' }
  ];

  // ---------- 每个场景的调色板 ----------
  // floorA/floorB 棋盘交替；wall 墙；goal 目标；box 箱子主体；line 描边
  // contrast: true 时用第二组（墙更深、地板更亮、目标更醒目）
  var PAL = {
    warehouse: {
      bg0: '#39301f', bg1: '#241c11',
      floorA: '#8a6f4e', floorB: '#816850', line: '#5f4c34',
      wall: { top: '#6e5a40', side: '#4e3d28', edge: '#332718' },
      wallC: { top: '#5c4a33', side: '#3a2d1c', edge: '#241a0f' },
      goal: '#ffcf6b', goalRing: '#a97b28',
      box: { face: '#b98a4e', plank: '#8f6435', edge: '#5f4c34', onGoal: '#ffd98c' },
      dust: '#caa36b'
    },
    farm: {
      bg0: '#a9d9f2', bg1: '#8cc77c',
      floorA: '#7fbf5e', floorB: '#75b456', line: '#5c9344',
      wall: { top: '#5f8f47', side: '#466f33', edge: '#2f4d22' },
      wallC: { top: '#4a7a37', side: '#345525', edge: '#203817' },
      goal: '#b07a3f', goalRing: '#6d4a24',
      box: { face: '#d2a869', plank: '#a97f45', edge: '#7a5527', onGoal: '#ffe3a1' },
      dust: '#eef7d8'
    },
    ice: {
      bg0: '#1d4266', bg1: '#10263e',
      floorA: '#dcecf8', floorB: '#cbe1f1', line: '#9fc2da',
      wall: { top: '#a9cdec', side: '#7ba6c9', edge: '#52779a' },
      wallC: { top: '#8db8dd', side: '#618cb0', edge: '#3d5d7d' },
      goal: '#59d6ff', goalRing: '#2a7ea8',
      box: { face: '#bfe0f5', plank: '#8fc0e0', edge: '#5c8ab0', onGoal: '#eaf8ff' },
      dust: '#eaf6ff'
    },
    space: {
      bg0: '#12152e', bg1: '#0a0c1e',
      floorA: '#3c4460', floorB: '#363e58', line: '#262c42',
      wall: { top: '#5c6584', side: '#434b66', edge: '#2b3049' },
      wallC: { top: '#4d5674', side: '#373e58', edge: '#20243a' },
      goal: '#b493ff', goalRing: '#6b4fc0',
      box: { face: '#8d7ae8', plank: '#6a58c2', edge: '#453a80', onGoal: '#d9c9ff' },
      dust: '#9fb0ff'
    }
  };

  function pal(sceneId, opts) {
    var p = PAL[sceneId] || PAL.warehouse;
    return p;
  }

  // ---------- 通用绘制小工具 ----------
  function lcg(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  function rr(g, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  function disc(g, x, y, rx, ry, fill, stroke, lw) {
    g.beginPath();
    g.ellipse(x, y, Math.max(0.4, rx), Math.max(0.4, ry), 0, 0, TAU);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.lineWidth = lw || 2; g.strokeStyle = stroke; g.stroke(); }
  }

  /* 多边形（灯锥 / 光带 / 远景剪影）；只在离屏预渲染里用 */
  function poly(g, pts, fill, stroke, lw) {
    var i;
    g.beginPath();
    for (i = 0; i < pts.length; i++) {
      if (i === 0) g.moveTo(pts[i][0], pts[i][1]);
      else g.lineTo(pts[i][0], pts[i][1]);
    }
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.lineWidth = lw || 2; g.strokeStyle = stroke; g.stroke(); }
  }

  // ---------- 静态背景（预渲染，固定种子，resize 重绘不会「跳」） ----------
  function makeCanvas(w, h, dpr) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }

  function drawStars(g, w, h, n, color, seed, rMax) {
    var rnd = lcg(seed);
    var i;
    g.fillStyle = color;
    for (i = 0; i < n; i++) {
      var x = rnd() * w;
      var y = rnd() * h * 0.9;
      var r = 0.6 + rnd() * (rMax || 1.4);
      g.globalAlpha = 0.25 + rnd() * 0.6;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function drawAurora(g, w, h) {
    var i, j;
    var bands = ['#2f6d8a', '#3a7d6a', '#4a5f9e'];
    for (i = 0; i < bands.length; i++) {
      g.globalAlpha = 0.16;
      g.fillStyle = bands[i];
      g.beginPath();
      g.moveTo(0, h * (0.08 + i * 0.05));
      for (j = 0; j <= 6; j++) {
        g.quadraticCurveTo(w * (j + 0.5) / 6 - w / 12, h * (0.02 + i * 0.05), w * (j + 1) / 6, h * (0.08 + i * 0.05));
      }
      g.lineTo(w, 0);
      g.lineTo(0, 0);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function buildBackdrop(sceneId, w, h, dpr, opts) {
    opts = opts || {};
    var p = pal(sceneId);
    var c = makeCanvas(w, h, dpr);
    var g = c.getContext('2d');
    var i, j;
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, p.bg0);
    grad.addColorStop(1, p.bg1);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    if (sceneId === 'warehouse') {
      // 墙面木板横缝：让纯色背景先有材质
      var rnd = lcg(7), bx, by, bw2, lx, ly, lg;
      g.strokeStyle = 'rgba(0,0,0,0.14)';
      g.lineWidth = 2;
      for (i = 0; i < 9; i++) {
        g.beginPath();
        g.moveTo(0, h * (0.06 + i * 0.09));
        g.lineTo(w, h * (0.06 + i * 0.09));
        g.stroke();
      }
      // 两盏吊灯：柔光 + 光锥 + 灯线灯罩
      for (i = 0; i < 2; i++) {
        lx = w * (0.3 + i * 0.4);
        ly = h * 0.13;
        lg = g.createRadialGradient(lx, ly, 4, lx, ly, Math.max(w, h) * 0.30);
        lg.addColorStop(0, 'rgba(255,214,140,0.24)');
        lg.addColorStop(0.55, 'rgba(255,214,140,0.07)');
        lg.addColorStop(1, 'rgba(255,214,140,0)');
        g.fillStyle = lg;
        g.fillRect(0, 0, w, h);
        poly(g, [[lx - 12, ly + 8], [lx + 12, ly + 8], [lx + 135, h], [lx - 135, h]],
             'rgba(255,220,150,0.05)');
        g.fillStyle = 'rgba(0,0,0,0.34)';
        g.fillRect(lx - 1, 0, 2, ly - 8);
        poly(g, [[lx - 17, ly], [lx + 17, ly], [lx + 9, ly - 11], [lx - 9, ly - 11]],
             'rgba(38,28,16,0.85)');
        disc(g, lx, ly + 1, 8, 3, 'rgba(255,230,170,0.92)');
      }
      // 远处货架：层板 + 立柱 + 箱影，比单纯黑条更像仓库
      for (i = 0; i < 5; i++) {
        bx = rnd() * w;
        by = h * (0.05 + rnd() * 0.16);
        bw2 = 44 + rnd() * 62;
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.fillRect(bx, by, bw2, 5);
        g.fillRect(bx + 3, by, 4, 48);
        g.fillRect(bx + bw2 - 7, by, 4, 48);
        g.fillStyle = 'rgba(0,0,0,0.20)';
        g.fillRect(bx + 11, by + 13, 18, 21);
        g.fillRect(bx + bw2 - 30, by + 8, 16, 26);
      }
      // 地面透视线 + 浮尘
      g.strokeStyle = 'rgba(255,220,160,0.06)';
      g.lineWidth = 1;
      for (i = 0; i <= 8; i++) {
        g.beginPath();
        g.moveTo(w / 2, h * 0.70);
        g.lineTo(i * w / 8, h);
        g.stroke();
      }
      drawStars(g, w, h, 26, '#ffe4b0', 33, 1.1);
    } else if (sceneId === 'farm') {
      // 太阳三层光晕 + 云 + 远山 + 田垄 + 树影
      var rnd2 = lcg(21), cx, cy, s, tx, sx, sy;
      disc(g, w * 0.84, h * 0.14, Math.min(w, h) * 0.20, Math.min(w, h) * 0.20, 'rgba(255,239,170,0.10)');
      disc(g, w * 0.84, h * 0.14, Math.min(w, h) * 0.13, Math.min(w, h) * 0.13, 'rgba(255,239,170,0.16)');
      disc(g, w * 0.84, h * 0.14, Math.min(w, h) * 0.07, Math.min(w, h) * 0.07, '#ffe9a8');
      for (i = 0; i < 5; i++) {
        cx = rnd2() * w;
        cy = h * (0.08 + rnd2() * 0.2);
        s = 0.7 + rnd2() * 0.8;
        disc(g, cx, cy, 26 * s, 13 * s, 'rgba(255,255,255,0.88)');
        disc(g, cx - 20 * s, cy + 4 * s, 16 * s, 10 * s, 'rgba(255,255,255,0.88)');
        disc(g, cx + 18 * s, cy + 3 * s, 18 * s, 11 * s, 'rgba(255,255,255,0.88)');
        disc(g, cx - 6 * s, cy - 8 * s, 15 * s, 9 * s, 'rgba(255,255,255,0.72)');
      }
      // 远山 + 田垄（低对比，不抢棋盘）
      g.fillStyle = 'rgba(76,140,88,0.28)';
      g.beginPath();
      g.moveTo(0, h);
      for (i = 0; i <= 10; i++) {
        g.lineTo(i * w / 10, h * 0.80 - Math.sin(i * 1.25) * h * 0.05);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,255,210,0.10)';
      g.lineWidth = 3;
      for (i = 1; i <= 5; i++) {
        sy = h * (0.80 + i * 0.042);
        g.beginPath();
        g.moveTo(0, sy);
        g.lineTo(w, sy + h * 0.012);
        g.stroke();
      }
      for (i = 0; i < 8; i++) {
        tx = rnd2() * w;
        sx = 16 + rnd2() * 18;
        g.fillStyle = 'rgba(47,77,34,0.30)';
        g.fillRect(tx - 3, h * 0.90, 6, 18);
        disc(g, tx, h * 0.90, sx, sx * 0.7, 'rgba(47,77,34,0.30)');
        disc(g, tx - sx * 0.4, h * 0.91, sx * 0.6, sx * 0.45, 'rgba(70,120,55,0.26)');
      }
    } else if (sceneId === 'ice') {
      drawAurora(g, w, h);
      drawStars(g, w, h, 52, '#ffffff', 5, 1.3);
      // 远处冰山剪影 + 雪原亮带
      g.fillStyle = 'rgba(120,175,215,0.20)';
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(0, h * 0.88);
      for (i = 0; i <= 8; i++) {
        g.lineTo(i * w / 8, h * (0.80 + (i % 3) * 0.035));
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(230,246,255,0.13)';
      g.fillRect(0, h * 0.90, w, h * 0.10);
    } else if (sceneId === 'space') {
      drawStars(g, w, h, 90, '#cfe0ff', 13, 1.7);
      // 星云柔光
      var neb = g.createRadialGradient(w * 0.24, h * 0.30, 6, w * 0.24, h * 0.30, Math.max(w, h) * 0.36);
      neb.addColorStop(0, 'rgba(120,90,210,0.20)');
      neb.addColorStop(1, 'rgba(120,90,210,0)');
      g.fillStyle = neb;
      g.fillRect(0, 0, w, h);
      // 舱板结构线：横向接缝 + 角部灯带
      g.strokeStyle = 'rgba(150,165,230,0.09)';
      g.lineWidth = 2;
      for (i = 1; i <= 5; i++) {
        g.beginPath();
        g.moveTo(0, h * i / 6);
        g.lineTo(w, h * i / 6);
        g.stroke();
      }
      g.fillStyle = 'rgba(169,141,240,0.16)';
      g.fillRect(0, 0, w, 5);
      g.fillRect(0, h - 5, w, 5);
      // 远处行星 + 光环
      var pg = g.createRadialGradient(w * 0.82, h * 0.18, 4, w * 0.82, h * 0.18, Math.min(w, h) * 0.16);
      pg.addColorStop(0, '#8f70d8');
      pg.addColorStop(0.7, '#5a45a0');
      pg.addColorStop(1, '#2c2454');
      g.fillStyle = pg;
      g.beginPath();
      g.arc(w * 0.82, h * 0.18, Math.min(w, h) * 0.11, 0, TAU);
      g.fill();
      disc(g, w * 0.82 - Math.min(w, h) * 0.035, h * 0.18 - Math.min(w, h) * 0.035,
           Math.min(w, h) * 0.035, Math.min(w, h) * 0.02, 'rgba(255,255,255,0.16)');
      g.strokeStyle = 'rgba(190,160,255,0.55)';
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(w * 0.82, h * 0.18, Math.min(w, h) * 0.16, Math.min(w, h) * 0.05, -0.4, 0, TAU);
      g.stroke();
    }

    // 四周暗角，聚焦棋盘
    var vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.34)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
    return c;
  }

  // ---------- 地板 ----------
  function drawFloor(g, sceneId, x, y, s, opts) {
    var p = pal(sceneId);
    var gx = Math.round(x / s), gy = Math.round(y / s);
    var a = (gx + gy) % 2 === 0;
    g.fillStyle = a ? p.floorA : p.floorB;
    g.fillRect(x, y, s + 0.5, s + 0.5);
    // 左上受光 / 右下背光：每格像一块微凸的板
    g.fillStyle = 'rgba(255,255,255,0.11)';
    g.fillRect(x + 1, y + 1, s - 2, 2);
    g.fillRect(x + 1, y + 1, 2, s - 2);
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(x + 2, y + s - 3, s - 3, 2);
    g.fillRect(x + s - 3, y + 2, 2, s - 4);
    // 固定哈希的细碎材质点：不建对象、不拼颜色字符串
    if ((gx * 7 + gy * 13) % 5 === 0) {
      g.globalAlpha = 0.14;
      g.fillStyle = p.dust;
      g.fillRect(x + s * 0.28, y + s * 0.34, s * 0.08, s * 0.08);
      g.globalAlpha = 1;
    }
    // 板缝
    g.strokeStyle = p.line;
    g.globalAlpha = opts && opts.contrast ? 0.35 : 0.22;
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    g.globalAlpha = 1;
  }

  // ---------- 墙 ----------
  function drawWall(g, sceneId, x, y, s, opts) {
    var p = pal(sceneId);
    var solid = opts && opts.solid;
    var set = (opts && opts.contrast) ? p.wallC : p.wall;
    var lift = s * 0.18;
    if (solid) {
      g.fillStyle = 'rgba(0,0,0,0.30)';
      rr(g, x + s * 0.06, y + s * 0.10, s * 0.94, s * 0.94, s * 0.12);
      g.fill();
      g.fillStyle = set.side;
      rr(g, x, y - lift + s * 0.16, s, s - s * 0.16 + lift, s * 0.12);
      g.fill();
      // 侧面竖向材质纹 + 上缘亮线
      g.fillStyle = 'rgba(0,0,0,0.10)';
      g.fillRect(x + s * 0.26, y - lift + s * 0.20, 2, s * 0.72);
      g.fillRect(x + s * 0.72, y - lift + s * 0.20, 2, s * 0.72);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x + s * 0.05, y - lift + s * 0.18, s * 0.90, 2);
      g.fillStyle = set.top;
      rr(g, x, y - lift, s, s, s * 0.12);
      g.fill();
      // 顶面受光带：立体块的高光来源
      g.fillStyle = 'rgba(255,255,255,0.16)';
      rr(g, x + s * 0.07, y - lift + s * 0.07, s * 0.86, s * 0.17, s * 0.05);
      g.fill();
      // 阶梯错缝：砖缝 / 木板的自然转折，比规整的 T 字更耐看；
      // 降低不透明度，避免在冰雪这类浅色墙上变成刺眼的黑线。
      g.strokeStyle = set.edge;
      g.lineWidth = Math.max(1, s * 0.032);
      g.globalAlpha = 0.52;
      g.beginPath();
      g.moveTo(x + s * 0.13, y - lift + s * 0.42);
      g.lineTo(x + s * 0.53, y - lift + s * 0.42);
      g.moveTo(x + s * 0.53, y - lift + s * 0.42);
      g.lineTo(x + s * 0.53, y - lift + s * 0.69);
      g.moveTo(x + s * 0.53, y - lift + s * 0.69);
      g.lineTo(x + s * 0.87, y - lift + s * 0.69);
      g.stroke();
      g.globalAlpha = 1;
      // 四角小铆钉
      disc(g, x + s * 0.13, y - lift + s * 0.13, s * 0.035, s * 0.035, 'rgba(255,255,255,0.32)');
      disc(g, x + s * 0.87, y - lift + s * 0.13, s * 0.035, s * 0.035, 'rgba(255,255,255,0.32)');
    } else {
      g.fillStyle = set.top;
      rr(g, x + s * 0.04, y + s * 0.04, s * 0.92, s * 0.92, s * 0.14);
      g.fill();
      // 平面模式也补一道顶部高光，避免整块死板
      g.fillStyle = 'rgba(255,255,255,0.14)';
      rr(g, x + s * 0.10, y + s * 0.09, s * 0.80, s * 0.16, s * 0.05);
      g.fill();
      g.strokeStyle = set.edge;
      g.lineWidth = Math.max(1, s * 0.06);
      rr(g, x + s * 0.04, y + s * 0.04, s * 0.92, s * 0.92, s * 0.14);
      g.stroke();
    }
  }

  // ---------- 目标点 ----------
  function drawGoal(g, sceneId, x, y, s, opts, t) {
    var p = pal(sceneId);
    var cx = x + s / 2;
    var cy = y + s / 2;
    var pulse = 0.5 + 0.5 * Math.sin((t || 0) * 4.2);
    var r = s * (0.24 + pulse * 0.05);
    // 目标点柔光：两层随呼吸胀缩的光斑，远看一眼能锁定
    g.globalAlpha = 0.10 + pulse * 0.10;
    disc(g, cx, cy, s * 0.47, s * 0.47, p.goal);
    g.globalAlpha = 0.16 + pulse * 0.12;
    disc(g, cx, cy, s * 0.36, s * 0.36, p.goal);
    g.globalAlpha = 1;
    // 凹槽底
    g.fillStyle = 'rgba(0,0,0,0.28)';
    disc(g, cx, cy + s * 0.03, s * 0.30, s * 0.30, 'rgba(0,0,0,0.28)');
    g.strokeStyle = p.goalRing;
    g.lineWidth = Math.max(2, s * 0.09);
    g.beginPath();
    g.arc(cx, cy, s * 0.30, 0, TAU);
    g.stroke();
    g.strokeStyle = p.goal;
    g.lineWidth = Math.max(2, s * (opts && opts.contrast ? 0.10 : 0.07));
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.stroke();
    g.fillStyle = p.goal;
    disc(g, cx, cy, s * 0.07, s * 0.07, p.goal);
  }

  // ---------- 箱子 ----------
  function drawBox(g, sceneId, x, y, s, opts, onGoal) {
    var p = pal(sceneId);
    var solid = opts && opts.solid;
    var b = p.box;
    var lift = s * 0.16;
    var bx = x + s * 0.08;
    var by = y + s * 0.08;
    var bw = s * 0.84;
    var face = onGoal ? b.onGoal : b.face;

    if (solid) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      rr(g, bx + s * 0.05, y + s * 0.14, bw, bw * 0.96, s * 0.10);
      g.fill();
      g.fillStyle = b.edge;
      rr(g, bx, by - lift + bw * 0.16, bw, bw - bw * 0.16 + lift, s * 0.10);
      g.fill();
      g.fillStyle = face;
      rr(g, bx, by - lift, bw, bw, s * 0.10);
      g.fill();
    } else {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      rr(g, bx + s * 0.04, by + s * 0.05, bw, bw, s * 0.10);
      g.fill();
      g.fillStyle = face;
      rr(g, bx, by, bw, bw, s * 0.10);
      g.fill();
    }

    // 顶面受光 + 左亮边 + 底部暗边：箱子脱离「一个色块」
    var fy = by - (solid ? lift : 0);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    rr(g, bx + bw * 0.09, fy + bw * 0.08, bw * 0.82, bw * 0.16, s * 0.05);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.fillRect(bx + bw * 0.06, fy + bw * 0.10, bw * 0.05, bw * 0.80);
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(bx + bw * 0.09, fy + bw * 0.88, bw * 0.82, bw * 0.06);

    // 场景化箱面细节
    if (sceneId === 'warehouse') {
      g.strokeStyle = b.plank;
      g.lineWidth = Math.max(1.5, s * 0.07);
      g.beginPath();
      g.moveTo(bx + bw * 0.12, by - (solid ? lift : 0) + bw * 0.5);
      g.lineTo(bx + bw * 0.88, by - (solid ? lift : 0) + bw * 0.5);
      g.moveTo(bx + bw * 0.12, by - (solid ? lift : 0) + bw * 0.82);
      g.lineTo(bx + bw * 0.88, by - (solid ? lift : 0) + bw * 0.82);
      g.stroke();
    } else if (sceneId === 'farm') {
      // 竹筐：十字篾条 + 顶部一颗苹果
      var ty = by - (solid ? lift : 0);
      g.strokeStyle = b.plank;
      g.lineWidth = Math.max(1.5, s * 0.07);
      g.beginPath();
      g.moveTo(bx + bw * 0.5, ty + bw * 0.08);
      g.lineTo(bx + bw * 0.5, ty + bw * 0.92);
      g.moveTo(bx + bw * 0.08, ty + bw * 0.5);
      g.lineTo(bx + bw * 0.92, ty + bw * 0.5);
      g.stroke();
      disc(g, bx + bw * 0.5, ty + bw * 0.26, bw * 0.14, bw * 0.13, '#e0524f');
    } else if (sceneId === 'ice') {
      // 冰块：高光斜纹
      var iy = by - (solid ? lift : 0);
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = Math.max(1.5, s * 0.06);
      g.beginPath();
      g.moveTo(bx + bw * 0.2, iy + bw * 0.75);
      g.lineTo(bx + bw * 0.62, iy + bw * 0.16);
      g.moveTo(bx + bw * 0.42, iy + bw * 0.85);
      g.lineTo(bx + bw * 0.8, iy + bw * 0.34);
      g.stroke();
    } else if (sceneId === 'space') {
      // 货箱：警示斜条
      var sy = by - (solid ? lift : 0);
      g.save();
      rr(g, bx, sy, bw, bw, s * 0.10);
      g.clip();
      g.strokeStyle = b.plank;
      g.lineWidth = s * 0.12;
      g.beginPath();
      g.moveTo(bx - bw * 0.1, sy + bw * 1.0);
      g.lineTo(bx + bw * 0.7, sy - bw * 0.1);
      g.moveTo(bx + bw * 0.3, sy + bw * 1.1);
      g.lineTo(bx + bw * 1.1, sy + bw * 0.1);
      g.stroke();
      g.restore();
    }

    // 描边
    g.strokeStyle = b.edge;
    g.lineWidth = Math.max(1.5, s * 0.06);
    rr(g, bx, by - (solid ? lift : 0), bw, bw, s * 0.10);
    g.stroke();

    if (onGoal) {
      // 到位高亮：金色/场景色柔光 + 呼吸圈
      var pulse = 0.5 + 0.5 * Math.sin((opts && opts.t || 0) * 5);
      g.globalAlpha = 0.14 + pulse * 0.12;
      disc(g, bx + bw / 2, by - (solid ? lift : 0) + bw / 2,
           bw * 0.78, bw * 0.78, onGoalGlow(sceneId));
      g.globalAlpha = 0.35 + pulse * 0.35;
      g.strokeStyle = onGoalGlow(sceneId);
      g.lineWidth = Math.max(2, s * 0.08);
      rr(g, bx - s * 0.05, by - (solid ? lift : 0) - s * 0.05, bw + s * 0.1, bw + s * 0.1, s * 0.14);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  function onGoalGlow(sceneId) {
    if (sceneId === 'farm') return '#fff3b0';
    if (sceneId === 'ice') return '#bfefff';
    if (sceneId === 'space') return '#d9c9ff';
    return '#ffe9b0';
  }

  // ---------- 角色 ----------
  // cx,cy 为脚底中心；s 为格子尺寸；dir 'up'|'down'|'left'|'right'
  // walkT 0..1 行走相位（静止传 0）
  function drawCharacter(g, charId, cx, cy, s, dir, walkT, opts) {
    var bob = Math.sin((walkT || 0) * Math.PI) * s * 0.05;
    var bodyY = cy - s * 0.34 + bob;
    var r = s * 0.30;
    var i;

    // 影子
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.beginPath();
    g.ellipse(cx, cy - s * 0.04 + bob * 0.2, s * 0.26, s * 0.09, 0, 0, TAU);
    g.fill();

    // 腿（两个小圆，走路时前后摆）
    var legSwing = Math.cos((walkT || 0) * Math.PI * 2) * s * 0.08;
    g.fillStyle = legColor(charId);
    disc(g, cx - s * 0.10, cy - s * 0.08, s * 0.07, s * 0.09, legColor(charId));
    disc(g, cx + s * 0.10, cy - s * 0.08, s * 0.07, s * 0.09, legColor(charId));

    // 身体
    if (charId === 'worker') {
      disc(g, cx, bodyY, r, r * 1.06, '#5b7185');
      g.fillStyle = '#4a5c6e';
      g.fillRect(cx - r * 0.9, bodyY - r * 0.1, r * 1.8, r * 0.35);
    } else if (charId === 'farmer') {
      disc(g, cx, bodyY, r, r * 1.06, '#e07a5f');
    } else if (charId === 'penguin') {
      disc(g, cx, bodyY, r, r * 1.08, '#2c3644');
      disc(g, cx, bodyY + s * 0.02, r * 0.62, r * 0.8, '#f4f8fc');
    } else {
      // 宇航员
      disc(g, cx, bodyY, r, r * 1.06, '#eef2f8');
      g.fillStyle = '#c8cfdd';
      g.fillRect(cx - r * 1.1, bodyY - r * 0.35, r * 0.5, r * 0.9); // 背包
      g.fillRect(cx + r * 0.6, bodyY - r * 0.35, r * 0.5, r * 0.9);
    }

    // 身体左上受光：圆滚滚的角色不再是平面色块
    g.globalAlpha = 0.22;
    disc(g, cx - r * 0.34, bodyY - r * 0.40, r * 0.44, r * 0.20, '#ffffff');
    g.globalAlpha = 1;

    // 脸（朝向偏移）
    var fx = 0, fy = 0;
    if (dir === 'left') fx = -r * 0.22;
    else if (dir === 'right') fx = r * 0.22;
    else if (dir === 'up') fy = -r * 0.2;
    else fy = r * 0.12;
    if (charId === 'penguin') {
      // 喙当朝向
      var beak = beakDir(dir);
      disc(g, cx + beak[0] * r * 0.55, bodyY + beak[1] * r * 0.55, s * 0.07, s * 0.06, '#e8a13c');
      disc(g, cx - s * 0.08 + fx * 0.4, bodyY - s * 0.02 + fy * 0.4, s * 0.035, s * 0.045, '#20242e');
      disc(g, cx + s * 0.08 + fx * 0.4, bodyY - s * 0.02 + fy * 0.4, s * 0.035, s * 0.045, '#20242e');
    } else if (charId === 'astro') {
      // 头盔
      disc(g, cx, bodyY - s * 0.16, r * 0.78, r * 0.78, '#e8eef6', '#9aa7ba', 2);
      disc(g, cx + fx * 0.5, bodyY - s * 0.16 + fy * 0.5, r * 0.5, r * 0.5, '#6ec3f2');
      g.globalAlpha = 0.5;
      disc(g, cx + fx * 0.5 - r * 0.16, bodyY - s * 0.16 + fy * 0.5 - r * 0.16, r * 0.16, r * 0.12, '#ffffff');
      g.globalAlpha = 1;
    } else {
      // 帽子 + 眼睛
      disc(g, cx, bodyY - s * 0.16, r * 0.72, r * 0.62, '#f2c9a0');
      disc(g, cx - s * 0.09 + fx * 0.6, bodyY - s * 0.14 + fy * 0.6, s * 0.04, s * 0.05, INK);
      disc(g, cx + s * 0.09 + fx * 0.6, bodyY - s * 0.14 + fy * 0.6, s * 0.04, s * 0.05, INK);
      if (charId === 'worker') {
        g.fillStyle = '#e8b34b';
        g.beginPath();
        g.ellipse(cx, bodyY - s * 0.30, r * 0.8, r * 0.34, 0, Math.PI, TAU);
        g.fill();
        g.fillRect(cx - r * 1.0, bodyY - s * 0.32, r * 2.0, s * 0.05);
      } else {
        // 草帽
        disc(g, cx, bodyY - s * 0.26, r * 1.05, r * 0.34, '#e8c968');
        disc(g, cx, bodyY - s * 0.34, r * 0.62, r * 0.34, '#f2dc8e');
        g.strokeStyle = '#c9a44a';
        g.lineWidth = 1.5;
        g.beginPath();
        g.ellipse(cx, bodyY - s * 0.34, r * 0.62, r * 0.34, 0, 0, TAU);
        g.stroke();
      }
    }

    // 手（推箱感：朝向侧伸出）
    var push = walkT > 0 ? 1 : 0;
    var hd = handDir(dir);
    g.fillStyle = handColor(charId);
    disc(g, cx + hd[0] * (r * (0.9 + push * 0.18)), bodyY + hd[1] * r * 0.5 + s * 0.06, s * 0.06, s * 0.06, handColor(charId));
    disc(g, cx - hd[0] * r * 0.7, bodyY + s * 0.10, s * 0.055, s * 0.055, handColor(charId));
  }

  function legColor(charId) {
    if (charId === 'worker') return '#3d4c5c';
    if (charId === 'farmer') return '#4a6b8a';
    if (charId === 'penguin') return '#e8871e';
    return '#b8c2d4';
  }
  function handColor(charId) {
    if (charId === 'penguin') return '#e8871e';
    if (charId === 'astro') return '#eef2f8';
    return '#f2c9a0';
  }
  function beakDir(dir) {
    if (dir === 'left') return [-1, 0.1];
    if (dir === 'right') return [1, 0.1];
    if (dir === 'up') return [0, -0.8];
    return [0, 0.6];
  }
  function handDir(dir) {
    if (dir === 'left') return [-1, 0];
    if (dir === 'right') return [1, 0];
    if (dir === 'up') return [0.9, -0.5];
    return [0.9, 0.5];
  }

  // ---------- 导出 ----------
  function indexOf(list, id) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].id === id) return i;
    }
    return -1;
  }

  global.SokoThemes = {
    PACKS: PACKS,
    CHARACTERS: CHARACTERS,
    SCENES: SCENES,
    indexOfPack: function (id) { return indexOf(PACKS, id); },
    indexOfCharacter: function (id) { return indexOf(CHARACTERS, id); },
    indexOfScene: function (id) { return indexOf(SCENES, id); },
    buildBackdrop: buildBackdrop,
    drawFloor: drawFloor,
    drawWall: drawWall,
    drawGoal: drawGoal,
    drawBox: drawBox,
    drawCharacter: drawCharacter
  };
})(typeof window !== 'undefined' ? window : this);

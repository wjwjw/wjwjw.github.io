/*
 * themes.js —— 振翅飞行（flipping-bird）主题绘制层
 *
 * 三套「角色 × 场景」固定配套：
 *   小飞机 × 天空（云柱） / 小乌龟 × 草丛（灌木丛） / 小鲸鱼 × 海洋（珊瑚柱）
 * 角色与场景一一绑定，选角色即整套切换；绘制层仍把两者分开（各自只认一个 id），
 * 以后要加第四套只需追加数据 + 一组绘制分支。所有画面都是 Canvas 2D 矢量绘制：
 *   · 目标电视（Android 6 / Chromium 47）不支持彩色 emoji，也没有外部图片依赖；
 *   · 静态背景（渐变 / 远山 / 云带 / 光束）预渲染到离屏 canvas，每帧只 drawImage，
 *     渲染循环内不创建渐变、不拼 rgba 字符串（STANDARD §10.3）。
 *
 * 兼容：经典脚本 + IIFE，纯 ES5。
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var INK = '#2c3650';

  var CHARACTERS = [
    { id: 'plane',  name: '小飞机', desc: '螺旋桨一转，冲上云霄', scene: 'sky',    accent: '#ffd166' },
    { id: 'turtle', name: '小乌龟', desc: '背着小壳，钻过草丛',   scene: 'meadow', accent: '#7ee0b8' },
    { id: 'whale',  name: '小鲸鱼', desc: '摆摆尾巴，游进深蓝',   scene: 'ocean',  accent: '#7fb8ff' }
  ];

  var SCENES = [
    { id: 'sky',    name: '云上晴空', short: '天空', obstacle: '云柱',    accent: '#7ec8f2' },
    { id: 'meadow', name: '风起草丛', short: '草丛', obstacle: '灌木丛',  accent: '#79bf4a' },
    { id: 'ocean',  name: '深蓝海底', short: '海洋', obstacle: '珊瑚柱',  accent: '#1d6f9e' }
  ];

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
    g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.lineWidth = lw || 2; g.strokeStyle = stroke; g.stroke(); }
  }

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

  function cloud(g, x, y, s, fill, alpha) {
    var a = g.globalAlpha;
    if (alpha != null) g.globalAlpha = alpha;
    g.fillStyle = fill;
    disc(g, x, y, 22 * s, 12 * s, fill);
    disc(g, x - 16 * s, y + 3 * s, 13 * s, 9 * s, fill);
    disc(g, x + 14 * s, y + 3 * s, 15 * s, 10 * s, fill);
    disc(g, x - 4 * s, y - 8 * s, 14 * s, 10 * s, fill);
    disc(g, x + 8 * s, y - 6 * s, 11 * s, 8 * s, fill);
    g.globalAlpha = a;
  }

  function eye(g, x, y, r, lookDown) {
    disc(g, x, y, r, r, '#fffcf2', INK, 1.4);
    disc(g, x + r * 0.28, y + (lookDown ? r * 0.18 : 0), r * 0.55, r * 0.55, '#243044');
    disc(g, x + r * 0.10, y - r * 0.28, r * 0.20, r * 0.20, '#ffffff');
  }

  function smile(g, x, y, w, color) {
    g.beginPath();
    g.moveTo(x - w / 2, y);
    g.quadraticCurveTo(x, y + w * 0.52, x + w / 2, y);
    g.strokeStyle = color || INK;
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.stroke();
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

  function drawSkyBack(g, w, h) {
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#63b9ec');
    grad.addColorStop(0.55, '#a9dcf7');
    grad.addColorStop(1, '#e8f6ff');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // 太阳：柔光用三层半透明圆，不用径向渐变（离屏一次绘制，成本可忽略）
    disc(g, w * 0.82, h * 0.18, 78, 78, 'rgba(255,226,140,0.16)');
    disc(g, w * 0.82, h * 0.18, 56, 56, 'rgba(255,226,140,0.20)');
    disc(g, w * 0.82, h * 0.18, 34, 34, '#ffe89a', '#ffd166', 3);

    var rnd = lcg(20261108), i;
    for (i = 0; i < 9; i++) {
      cloud(g, rnd() * (w + 160) - 80, h * (0.10 + rnd() * 0.44),
            0.7 + rnd() * 0.85, '#ffffff', 0.30 + rnd() * 0.24);
    }
    // 远处淡蓝丘陵（贴着地平线，给「高度」一个参照）
    g.fillStyle = 'rgba(120,178,205,0.34)';
    g.beginPath();
    g.moveTo(0, h);
    for (i = 0; i <= 12; i++) {
      g.lineTo(i * w / 12, h * 0.80 - Math.sin(i * 1.7) * h * 0.045);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  }

  function drawMeadowBack(g, w, h) {
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#9fdcf0');
    grad.addColorStop(0.48, '#cdeec0');
    grad.addColorStop(1, '#f3f7cb');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    disc(g, w * 0.18, h * 0.16, 46, 46, 'rgba(255,245,190,0.28)');
    disc(g, w * 0.18, h * 0.16, 26, 26, '#fff3c4');

    var rnd = lcg(20261108), i;
    for (i = 0; i < 4; i++) {
      cloud(g, rnd() * (w + 160) - 80, h * (0.10 + rnd() * 0.24),
            0.7 + rnd() * 0.6, '#ffffff', 0.45 + rnd() * 0.20);
    }

    // 远处树丛：三层圆团树冠 + 短树干，越远越淡
    var layers = [
      { y: 0.74, r: 0.070, color: 'rgba(84,140,86,0.42)' },
      { y: 0.80, r: 0.085, color: 'rgba(60,120,70,0.55)' },
      { y: 0.87, r: 0.100, color: 'rgba(42,98,58,0.70)' }
    ];
    var li, x, cy, cr, r2;
    for (li = 0; li < layers.length; li++) {
      r2 = lcg(9100 + li * 37);
      for (i = 0; i < 9; i++) {
        x = (i + 0.35 + r2() * 0.30) * w / 9;
        cy = h * (layers[li].y + r2() * 0.03);
        cr = h * layers[li].r * (0.75 + r2() * 0.50);
        g.fillStyle = layers[li].color;
        g.fillRect(x - 3, cy + cr * 0.5, 6, cr * 0.8);
        disc(g, x, cy, cr, cr * 0.78, layers[li].color);
        disc(g, x - cr * 0.55, cy + cr * 0.20, cr * 0.65, cr * 0.55, layers[li].color);
        disc(g, x + cr * 0.55, cy + cr * 0.22, cr * 0.62, cr * 0.52, layers[li].color);
      }
    }

    // 前景草丛：三层深浅草叶，固定 LCG 种子 —— 「有草丛」的主要视觉依据
    var grass = ['#6fb257', '#549b45', '#3f8039'];
    var gi, gx, gy, gl, rg;
    for (gi = 0; gi < 3; gi++) {
      rg = lcg(4477 + gi * 61);
      for (i = 0; i < 46; i++) {
        gx = rg() * w;
        gy = h * (0.87 + gi * 0.045 + rg() * 0.08);
        gl = 14 + rg() * (18 + gi * 8);
        poly(g, [[gx - 4 - gi, gy], [gx + (rg() - 0.5) * 10, gy - gl],
                 [gx + 4 + gi, gy]], grass[gi]);
      }
    }
    // 草丛里的小野花
    var rf = lcg(7788), fx2, fy2;
    for (i = 0; i < 16; i++) {
      fx2 = rf() * w;
      fy2 = h * (0.88 + rf() * 0.10);
      disc(g, fx2, fy2, 3.4, 3.4, i % 3 === 0 ? '#ff9f9f' : '#fff0a8');
    }
  }

  function drawOceanBack(g, w, h) {
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2b86ad');
    grad.addColorStop(0.5, '#12547f');
    grad.addColorStop(1, '#082c4c');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // 水面透下来的斜光束
    var i, x0;
    for (i = 0; i < 4; i++) {
      x0 = w * (0.12 + i * 0.24);
      poly(g, [[x0, 0], [x0 + 46, 0], [x0 + 150, h * 0.86], [x0 + 96, h * 0.86]],
           'rgba(180,235,255,0.07)');
    }
    // 远处鱼群 / 水母剪影
    var rnd = lcg(4412);
    for (i = 0; i < 11; i++) {
      var fx = rnd() * w, fy = h * (0.18 + rnd() * 0.52), s = 3 + rnd() * 4;
      poly(g, [[fx - s * 1.8, fy], [fx + s, fy - s * 0.8], [fx + s, fy + s * 0.8]],
           'rgba(180,230,245,0.13)');
      poly(g, [[fx + s, fy - s * 0.8], [fx + s * 2, fy - s * 1.4], [fx + s * 2, fy + s * 1.4], [fx + s, fy + s * 0.8]],
           'rgba(180,230,245,0.13)');
    }
  }

  function buildBackdrop(sceneId, w, h, dpr) {
    var c = makeCanvas(w, h, dpr || 1);
    var g = c.getContext('2d');
    if (dpr) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sceneId === 'meadow') drawMeadowBack(g, w, h);
    else if (sceneId === 'ocean') drawOceanBack(g, w, h);
    else drawSkyBack(g, w, h);
    return c;
  }

  // ---------- 动态远景（少量大件，慢速移动；细节微粒交给 fx.setAmbient） ----------
  function drawMotion(g, sceneId, w, h, t) {
    var i, x, y, k;
    if (sceneId === 'sky') {
      for (i = 0; i < 3; i++) {
        k = (t * 13 + i * (w / 3)) % (w + 220);
        x = w + 110 - k;
        y = h * (0.16 + i * 0.13);
        cloud(g, x, y, 1.5 + i * 0.22, '#ffffff', 0.24);
      }
    } else if (sceneId === 'meadow') {
      // 飘飞的蒲公英种子：小绒球 + 三根绒毛线，相位固定，resize 后连续
      g.strokeStyle = 'rgba(255,255,255,0.62)';
      g.lineWidth = 1.4;
      for (i = 0; i < 12; i++) {
        x = (w * (i * 0.137 % 1) + Math.sin(t * 0.7 + i) * 26 + w) % w;
        y = (h * (i * 0.211 % 1) + t * (10 + i % 4 * 5)) % (h + 30) - 15;
        disc(g, x, y, 2.6, 2.6, 'rgba(255,255,255,0.78)');
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 5, y - 7);
        g.moveTo(x, y);
        g.lineTo(x + 5, y - 7);
        g.moveTo(x, y);
        g.lineTo(x, y - 9);
        g.stroke();
      }
    } else {
      // 上升的气泡串（空心圆，描边而非填充，避免糊成一片）
      g.strokeStyle = 'rgba(190,238,255,0.30)';
      g.lineWidth = 2;
      for (i = 0; i < 12; i++) {
        x = w * (i * 0.173 % 1) + Math.sin(t * 0.9 + i * 1.7) * 9;
        y = h - ((t * (22 + i % 3 * 9) + i * 47) % (h + 40));
        k = 2.5 + (i % 4);
        g.beginPath();
        g.arc(x, y, k, 0, TAU);
        g.stroke();
      }
    }
  }

  // ---------- 地面 ----------
  function drawGround(g, sceneId, w, groundY, t) {
    var h = 540 - groundY;
    var i, x, base, top, mark;
    if (sceneId === 'ocean') {
      base = '#d9b98a'; top = 'rgba(255,244,214,0.55)'; mark = 'rgba(90,70,50,0.22)';
    } else if (sceneId === 'meadow') {
      base = '#5fae63'; top = 'rgba(190,240,150,0.75)'; mark = 'rgba(30,90,50,0.26)';
    } else {
      // 天空套脚下是云海平台（不是草地），和草丛套一眼分得开
      base = '#eaf6ff'; top = 'rgba(255,255,255,0.92)'; mark = 'rgba(110,165,205,0.22)';
    }
    g.fillStyle = base;
    g.fillRect(0, groundY, w, h);
    g.fillStyle = top;
    g.fillRect(0, groundY, w, 7);
    g.fillStyle = mark;
    // 滚动纹理：让「世界在向后退」这件事有视觉依据
    var off = (t * 90) % 48;
    for (i = -1; i < Math.ceil(w / 48) + 1; i++) {
      x = i * 48 - off;
      if (sceneId === 'sky') {
        g.fillRect(x, groundY + 16, 20, 4);
        g.fillRect(x + 28, groundY + 34, 13, 4);
      } else if (sceneId === 'meadow') {
        // 草叶用竖向短条，比横线更像草
        g.fillRect(x + 4, groundY + 14, 3, 12);
        g.fillRect(x + 12, groundY + 18, 3, 9);
        g.fillRect(x + 30, groundY + 32, 3, 11);
      } else {
        g.fillRect(x + 4, groundY + 20, 16, 4);
        g.fillRect(x + 28, groundY + 36, 10, 4);
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, groundY + h - 6, w, 6);
  }

  // ---------- 障碍柱 ----------
  // 颜色表提到模块级：渲染循环里不建对象、不拼 rgba 字符串（STANDARD §10.3）
  var CAP_FILL = { sky: '#ffffff', meadow: '#7ac95a', ocean: '#e8865b' };
  var CAP_EDGE = { sky: '#5b9ec9', meadow: '#2f6b32', ocean: '#8f3f4c' };
  var GUIDE_GLOW = { sky: 'rgba(255,245,190,0.9)', meadow: 'rgba(255,250,190,0.9)', ocean: 'rgba(255,220,160,0.9)' };

  function cap(g, sceneId, x, y, pw, up) {
    var c = CAP_FILL[sceneId] || CAP_FILL.sky;
    var e = CAP_EDGE[sceneId] || CAP_EDGE.sky;
    var cy = up ? y - 12 : y;
    rr(g, x - 8, cy, pw + 16, 24, 7);
    g.fillStyle = c;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = e;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(x - 3, cy + 4, pw + 6, 4);
  }

  function drawColumn(g, sceneId, x, y0, y1, pw, isTop) {
    var h = y1 - y0;
    if (h <= 0) return;
    var i, rnd, yy;
    g.save();
    g.beginPath();
    g.rect(x, y0, pw, h);
    g.clip();

    if (sceneId === 'sky') {
      g.fillStyle = '#dcefff';
      g.fillRect(x, y0, pw, h);
      g.fillStyle = '#a9d7f4';
      g.fillRect(x + pw - 15, y0, 15, h);
      rnd = lcg(3101);
      for (yy = y0 - 10; yy < y1 + 24; yy += 25) {
        var bump = 8 + rnd() * 8;
        disc(g, x - 2, yy, bump, 13, '#ffffff', '#8fc4e8', 2);
        disc(g, x + pw - 3, yy + 12, bump, 13, '#ffffff', '#8fc4e8', 2);
      }
    } else if (sceneId === 'meadow') {
      // 灌木丛柱：深绿底 + 层层亮绿叶片 + 小野花，剪影与云柱 / 珊瑚柱明显不同
      g.fillStyle = '#3f8b46';
      g.fillRect(x, y0, pw, h);
      g.fillStyle = '#2d6b36';
      g.fillRect(x + pw - 16, y0, 16, h);
      rnd = lcg(8812);
      for (yy = y0 - 10; yy < y1 + 20; yy += 26) {
        for (i = 0; i < 3; i++) {
          var lx = x + 10 + rnd() * (pw - 20);
          var ly = yy + rnd() * 18;
          var lr = 9 + rnd() * 8;
          disc(g, lx, ly, lr, lr * 0.62, i % 2 ? '#6fbf57' : '#57a94a', '#2f6b32', 1.6);
        }
        if (rnd() > 0.55) disc(g, x + 12 + rnd() * (pw - 24), yy + 8, 3.5, 3.5, '#ffe58a');
      }
    } else {
      g.fillStyle = '#1d5f7a';
      g.fillRect(x, y0, pw, h);
      g.fillStyle = '#12455f';
      g.fillRect(x + pw - 16, y0, 16, h);
      // 珊瑚枝：粗干 + 分叉 + 圆头
      for (yy = y0 + 12; yy < y1; yy += 44) {
        g.strokeStyle = '#ef8f72';
        g.lineWidth = 8;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x + pw * 0.5, yy + 34);
        g.lineTo(x + pw * 0.5, yy + 8);
        g.moveTo(x + pw * 0.5, yy + 20);
        g.lineTo(x + 12, yy + 4);
        g.moveTo(x + pw * 0.5, yy + 16);
        g.lineTo(x + pw - 12, yy + 2);
        g.stroke();
        disc(g, x + 12, yy + 4, 6, 6, '#ffb48c');
        disc(g, x + pw - 12, yy + 2, 6, 6, '#ffb48c');
      }
      for (i = 0; i < 5; i++) {
        yy = y0 + 18 + i * 61;
        disc(g, x + 16 + (i % 3) * 18, yy, 4, 4, 'rgba(190,238,255,0.45)');
      }
    }
    g.restore();

    // 外描边：障碍边界必须一眼看清（10-foot 距离下的可玩性红线）
    g.lineWidth = 3;
    g.strokeStyle = sceneId === 'sky' ? '#5b9ec9' : (sceneId === 'meadow' ? '#2f6b32' : '#0a3348');
    g.strokeRect(x + 1.5, y0 + 1.5, pw - 3, h - 3);
    cap(g, sceneId, x, isTop ? y1 : y0, pw, isTop);
  }

  function drawPipe(g, sceneId, x, gapY, gapH, pw, groundY, t) {
    var topEnd = gapY - gapH / 2;
    var botStart = gapY + gapH / 2;
    drawColumn(g, sceneId, x, 0, topEnd, pw, true);
    drawColumn(g, sceneId, x, botStart, groundY, pw, false);

    // 缺口中央的一点微光：告诉玩家「往这里飞」。只用 globalAlpha 做脉动，不拼色值字符串
    var a = g.globalAlpha;
    g.globalAlpha = 0.10 + 0.06 * Math.sin(t * 3);
    g.fillStyle = GUIDE_GLOW[sceneId] || GUIDE_GLOW.sky;
    g.fillRect(x + pw * 0.25, gapY - 1.5, pw * 0.5, 3);
    g.globalAlpha = a;
  }

  // ---------- 角色 ----------
  function drawCharacter(g, charId, x, y, vy, t, flap, invincible) {
    var ang = vy / 760;
    if (ang < -0.38) ang = -0.38;
    if (ang > 0.52) ang = 0.52;
    var wing = Math.sin(flap * TAU) * 0.55;   // flap: 0..1，一次拍动的相位
    var a = g.globalAlpha;
    if (invincible && Math.floor(t * 9) % 2 === 0) g.globalAlpha = 0.32;

    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    if (charId === 'turtle') {
      // 后鳍（拍动）
      disc(g, -16, 10 - wing * 7, 10, 5, '#4fbf82', INK, 2);
      disc(g, 4, 12 + wing * 7, 11, 5, '#4fbf82', INK, 2);
      // 龟壳
      disc(g, -3, 0, 21, 16, '#3fa96b', INK, 2.6);
      disc(g, -3, -3, 13, 9, '#62c98b');
      poly(g, [[-13, 1], [-7, -7], [1, -7], [6, 1], [0, 9], [-8, 9]], null, 'rgba(20,80,50,0.55)', 2);
      // 头 + 脸
      disc(g, 19, 4, 11, 10, '#8ee0a8', INK, 2.4);
      eye(g, 23, 1, 3.4);
      smile(g, 23, 8, 8);
      // 小红围巾：让「会飞的乌龟」看起来是有意的设定
      poly(g, [[8, 9], [17, 10], [12, 17]], '#e0524f', INK, 1.6);
    } else if (charId === 'whale') {
      // 尾鳍（摆动）
      poly(g, [[-20, 0], [-34, -12 - wing * 7], [-30, 0], [-34, 12 + wing * 7]], '#3f7fc4', INK, 2.4);
      // 身体 + 白肚皮
      disc(g, 0, 0, 25, 15, '#4a90d9', INK, 2.6);
      disc(g, 3, 7, 19, 8, '#eaf6ff');
      // 背鳍
      poly(g, [[-6, -13], [-1, -23], [7, -12]], '#3f7fc4', INK, 2);
      // 侧鳍
      disc(g, -2, 9, 10, 5, '#3f7fc4', INK, 2);
      // 喷水
      for (var wi = 0; wi < 3; wi++) {
        disc(g, 7 + wi * 5, -20 - wi * 5 - (1 - flap) * 3, 2.2, 2.2, 'rgba(220,245,255,0.85)');
      }
      eye(g, 15, -3, 3.6);
      smile(g, 16, 6, 9, '#2c3650');
      disc(g, 9, 5, 3.5, 2.2, 'rgba(255,150,170,0.55)');
    } else {
      // 小飞机：机翼随 flap 上下摆，螺旋桨按时间旋转
      poly(g, [[-8, -6], [4, -18 - wing * 6], [10, -6]], '#e0524f', INK, 2);
      poly(g, [[-8, 6], [4, 18 + wing * 6], [10, 6]], '#e0524f', INK, 2);
      poly(g, [[-18, -4], [-25, -14], [-15, -3]], '#ffd166', INK, 2);
      disc(g, 0, 0, 24, 11, '#fffcf2', INK, 2.6);
      g.fillStyle = '#ffd166';
      g.fillRect(-13, 3, 21, 6);
      disc(g, 22, 0, 8, 9, '#ff8c42', INK, 2);
      disc(g, 3, -3, 5.2, 5.2, '#7ec8f2', INK, 1.6);
      disc(g, 2, -4.2, 1.7, 1.7, 'rgba(255,255,255,0.9)');
      // 螺旋桨：一条随时间转的短杆
      g.save();
      g.translate(30, 0);
      g.rotate(t * 22);
      g.strokeStyle = INK;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(0, -9);
      g.lineTo(0, 9);
      g.stroke();
      g.restore();
    }

    g.restore();
    g.globalAlpha = a;
  }

  // ---------- 特效参数：环境微粒 / 尾迹（按主题换材质） ----------
  function ambient(sceneId, w, h) {
    var cfg = {
      sky:      { colors: ['#ffffff', '#fff3c4'], glow: 22, size: [3, 7], speed: [7, 18], alpha: [0.10, 0.26] },
      meadow:   { colors: ['#fff7d6', '#ffffff'], glow: 18, size: [2.5, 5], speed: [8, 20], alpha: [0.14, 0.32] },
      ocean:    { colors: ['#b7ecff', '#7fd4e8'], glow: 20, size: [2.5, 6], speed: [16, 34], alpha: [0.14, 0.34] }
    };
    var o = cfg[sceneId] || cfg.sky;
    return {
      count: 14, w: w, h: h * 0.92, x0: 0, y0: 0,
      colors: o.colors, glow: o.glow, size: o.size, speed: o.speed, alpha: o.alpha, core: 0.55
    };
  }

  function trail(charId) {
    var cfg = {
      plane:  { rate: 22, colors: ['rgba(255,255,255,0.42)', 'rgba(190,225,255,0.32)'], shapes: ['dot'], speed: [8, 26], size: [2, 4.5], life: [0.28, 0.5] },
      turtle: { rate: 14, colors: ['rgba(190,255,205,0.42)', 'rgba(255,214,224,0.34)'], shapes: ['dot'], speed: [5, 18], size: [2, 4], life: [0.3, 0.55] },
      whale:  { rate: 18, colors: ['rgba(190,238,255,0.44)', 'rgba(140,210,240,0.34)'], shapes: ['dot'], speed: [10, 30], size: [2, 5], life: [0.3, 0.6] }
    };
    var o = cfg[charId] || cfg.plane;
    return {
      rate: o.rate, colors: o.colors, shapes: o.shapes,
      speed: o.speed, size: o.size, life: o.life,
      angle: Math.PI, spread: 0.7, g: charId === 'whale' ? -18 : 0, drag: 1.6, shrink: true
    };
  }

  window.FBThemes = {
    CHARACTERS: CHARACTERS,
    SCENES: SCENES,
    buildBackdrop: buildBackdrop,
    drawMotion: drawMotion,
    drawGround: drawGround,
    drawPipe: drawPipe,
    drawCharacter: drawCharacter,
    ambient: ambient,
    trail: trail,
    // 供 UI / 存档用：找下标、拼名字
    indexOfCharacter: function (id) {
      for (var i = 0; i < CHARACTERS.length; i++) if (CHARACTERS[i].id === id) return i;
      return -1;
    },
    indexOfScene: function (id) {
      for (var i = 0; i < SCENES.length; i++) if (SCENES[i].id === id) return i;
      return -1;
    },
    name: function (charIndex, sceneIndex) {
      return CHARACTERS[charIndex].name + ' × ' + SCENES[sceneIndex].short;
    }
  };
})();

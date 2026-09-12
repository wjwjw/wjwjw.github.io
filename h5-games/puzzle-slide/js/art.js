/*
 * art.js —— 滑动拼图的「图源」
 *
 * 拼图需要一整张画，切成 N×N 块。这里不用任何图片素材（外链图在电视上加载慢，
 * 且缩放会糊），改为 **Canvas 2D 程序化绘制**：先把整张画预渲染到离屏 canvas，
 * 游戏运行时只做 drawImage 切片（见 js/game.js 的 buildPicture）。
 *
 * 绘制约束（见 ../docs/STANDARD.md §6，目标 MiTV4A / Android 6 / WebView ≈ Chromium 47）：
 *   - 只用 arc / fillRect / quadraticCurveTo / createLinearGradient 这类 Chrome 47 就有的 API
 *   - 不用 emoji（真机上渲染成 □）
 *   - **色块要大、对比要强**：切成 3×3 之后，每一小块都得能看出「这是哪一角」，
 *     否则孩子拼到一半根本分不出来，只剩瞎试。所以刻意让每个场景都有
 *     「上中下三段明显不同的配色 + 一个占画面 40% 以上的主体」。
 *
 * 对外接口（挂到 window.Art）：
 *   Art.SCENES                    场景清单 [{id, name}]
 *   Art.SCENE_IDS
 *   Art.paintScene(ctx, id, S)    把一整张画绘制到 (0,0)-(S,S) 的正方形里
 *   Art.roundRect(ctx,x,y,w,h,r)  圆角矩形路径（Chrome 47 没有 ctx.roundRect）
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

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

  function disc(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function tri(ctx, ax, ay, bx, by, cx, cy) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  }

  // 云朵：三个圆叠一起，最稳的做法
  function puff(ctx, x, y, r) {
    disc(ctx, x, y, r);
    disc(ctx, x + r * 0.85, y + r * 0.15, r * 0.72);
    disc(ctx, x - r * 0.85, y + r * 0.20, r * 0.62);
    ctx.fillRect(x - r * 0.85, y, r * 1.7, r);
  }

  function ellipseFill(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fill();
  }

  // ============================================================
  //  场景 1：彩虹小屋（天蓝 / 红屋顶 / 绿草地 —— 三段配色差异极大）
  // ============================================================
  function sceneHouse(ctx, S) {
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#5EB8F0');
    g.addColorStop(0.58, '#B6E4FB');
    g.addColorStop(0.59, '#69C46E');
    g.addColorStop(1, '#3F9048');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    ctx.fillStyle = '#FFD54A';
    disc(ctx, S * 0.82, S * 0.15, S * 0.085);

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    puff(ctx, S * 0.20, S * 0.16, S * 0.085);
    puff(ctx, S * 0.44, S * 0.10, S * 0.062);

    // 房子主体
    var hx = S * 0.20, hy = S * 0.44, hw = S * 0.60, hh = S * 0.33;
    ctx.fillStyle = '#F7E3C1';
    ctx.fillRect(hx, hy, hw, hh);

    // 屋顶
    ctx.fillStyle = '#E0524F';
    tri(ctx, hx - S * 0.06, hy + 2, hx + hw / 2, hy - S * 0.24, hx + hw + S * 0.06, hy + 2);

    // 烟囱
    ctx.fillStyle = '#B93E3B';
    ctx.fillRect(hx + hw * 0.70, hy - S * 0.20, S * 0.055, S * 0.13);

    // 门
    ctx.fillStyle = '#8D5524';
    roundRect(ctx, hx + hw * 0.40, hy + hh * 0.42, hw * 0.20, hh * 0.58, S * 0.02);
    ctx.fill();
    ctx.fillStyle = '#FFD54A';
    disc(ctx, hx + hw * 0.565, hy + hh * 0.74, S * 0.012);

    // 窗（左右各一，切开后是好认的参照物）
    ctx.fillStyle = '#6EC6EA';
    ctx.fillRect(hx + hw * 0.10, hy + hh * 0.30, hw * 0.20, hh * 0.26);
    ctx.fillRect(hx + hw * 0.70, hy + hh * 0.30, hw * 0.20, hh * 0.26);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, S * 0.008);
    ctx.strokeRect(hx + hw * 0.10, hy + hh * 0.30, hw * 0.20, hh * 0.26);
    ctx.strokeRect(hx + hw * 0.70, hy + hh * 0.30, hw * 0.20, hh * 0.26);
  }

  // ============================================================
  //  场景 2：小猫（暖黄底 + 橙猫，头部占画面一半）
  // ============================================================
  function sceneCat(ctx, S) {
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#FFE2A8');
    g.addColorStop(1, '#F7C06A');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    var cx = S * 0.5, cy = S * 0.56, r = S * 0.30;

    // 耳朵（画在头之前，才不会盖住脸）
    ctx.fillStyle = '#F09233';
    tri(ctx, cx - r * 0.86, cy - r * 0.52, cx - r * 0.30, cy - r * 1.20, cx - r * 0.02, cy - r * 0.72);
    tri(ctx, cx + r * 0.86, cy - r * 0.52, cx + r * 0.30, cy - r * 1.20, cx + r * 0.02, cy - r * 0.72);

    // 头
    ctx.fillStyle = '#F7A64A';
    disc(ctx, cx, cy, r);

    // 脸部浅色区
    ctx.fillStyle = '#FFDCA8';
    ellipseFill(ctx, cx, cy + r * 0.26, r * 0.62, r * 0.46);

    // 眼睛
    ctx.fillStyle = '#3B2A20';
    disc(ctx, cx - r * 0.34, cy - r * 0.16, r * 0.115);
    disc(ctx, cx + r * 0.34, cy - r * 0.16, r * 0.115);
    ctx.fillStyle = '#FFFFFF';
    disc(ctx, cx - r * 0.30, cy - r * 0.20, r * 0.040);
    disc(ctx, cx + r * 0.38, cy - r * 0.20, r * 0.040);

    // 鼻子 + 嘴
    ctx.fillStyle = '#E4667A';
    tri(ctx, cx - r * 0.09, cy + r * 0.06, cx + r * 0.09, cy + r * 0.06, cx, cy + r * 0.20);
    ctx.strokeStyle = '#3B2A20';
    ctx.lineWidth = Math.max(2, S * 0.007);
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.20);
    ctx.quadraticCurveTo(cx - r * 0.16, cy + r * 0.34, cx - r * 0.26, cy + r * 0.16);
    ctx.moveTo(cx, cy + r * 0.20);
    ctx.quadraticCurveTo(cx + r * 0.16, cy + r * 0.34, cx + r * 0.26, cy + r * 0.16);
    ctx.stroke();

    // 胡须
    ctx.lineWidth = Math.max(1.5, S * 0.005);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.52, cy + r * 0.10);
    ctx.lineTo(cx - r * 1.02, cy + r * 0.02);
    ctx.moveTo(cx - r * 0.52, cy + r * 0.22);
    ctx.lineTo(cx - r * 1.02, cy + r * 0.26);
    ctx.moveTo(cx + r * 0.52, cy + r * 0.10);
    ctx.lineTo(cx + r * 1.02, cy + r * 0.02);
    ctx.moveTo(cx + r * 0.52, cy + r * 0.22);
    ctx.lineTo(cx + r * 1.02, cy + r * 0.26);
    ctx.stroke();

    // 领结（下半部的好认标记）
    ctx.fillStyle = '#E0524F';
    tri(ctx, cx, cy + r * 0.96, cx - r * 0.34, cy + r * 0.72, cx - r * 0.34, cy + r * 1.20);
    tri(ctx, cx, cy + r * 0.96, cx + r * 0.34, cy + r * 0.72, cx + r * 0.34, cy + r * 1.20);
    ctx.fillStyle = '#B93E3B';
    disc(ctx, cx, cy + r * 0.96, r * 0.10);
  }

  // ============================================================
  //  场景 3：向日葵（蓝天 / 黄花 / 绿茎）
  // ============================================================
  function sceneFlower(ctx, S) {
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#59B7EE');
    g.addColorStop(0.55, '#A9DDF7');
    g.addColorStop(0.56, '#4FA85A');
    g.addColorStop(1, '#2F7C3D');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    ctx.fillStyle = '#FFF07A';
    disc(ctx, S * 0.18, S * 0.16, S * 0.075);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    puff(ctx, S * 0.72, S * 0.13, S * 0.07);

    var cx = S * 0.5, cy = S * 0.42, R = S * 0.19;

    // 茎 + 叶
    ctx.strokeStyle = '#2F7C3D';
    ctx.lineWidth = Math.max(4, S * 0.028);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy + R * 0.5);
    ctx.quadraticCurveTo(cx + S * 0.05, S * 0.74, cx, S * 0.98);
    ctx.stroke();
    ctx.fillStyle = '#3F9B4C';
    ellipseFill(ctx, cx - S * 0.16, S * 0.70, S * 0.11, S * 0.045);
    ellipseFill(ctx, cx + S * 0.16, S * 0.84, S * 0.11, S * 0.045);

    // 花瓣（12 片，绕一圈）
    ctx.fillStyle = '#FFC93C';
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * TAU;
      ellipseFill(ctx, cx + Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05,
        R * 0.36, R * 0.24);
    }
    // 花盘
    ctx.fillStyle = '#8D5524';
    disc(ctx, cx, cy, R * 0.72);
    ctx.fillStyle = '#6E421B';
    disc(ctx, cx, cy, R * 0.50);
  }

  // ============================================================
  //  场景 4：小汽车（路面灰 + 红车 + 蓝窗）
  // ============================================================
  function sceneCar(ctx, S) {
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#8FD3F4');
    g.addColorStop(0.62, '#CDEEFB');
    g.addColorStop(0.63, '#6E7683');
    g.addColorStop(1, '#4C525C');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    // 远处小山
    ctx.fillStyle = '#7FB77E';
    tri(ctx, -S * 0.05, S * 0.63, S * 0.22, S * 0.28, S * 0.48, S * 0.63);
    tri(ctx, S * 0.32, S * 0.63, S * 0.62, S * 0.34, S * 0.92, S * 0.63);

    // 路面虚线
    ctx.fillStyle = 'rgba(255,240,180,0.9)';
    for (var i = 0; i < 5; i++) {
      ctx.fillRect(S * (0.04 + i * 0.20), S * 0.86, S * 0.11, S * 0.022);
    }

    // 车身
    var bx = S * 0.12, by = S * 0.50, bw = S * 0.76, bh = S * 0.26;
    ctx.fillStyle = '#E0524F';
    roundRect(ctx, bx, by, bw, bh, S * 0.045);
    ctx.fill();

    // 车顶
    ctx.fillStyle = '#E0524F';
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.20, by);
    ctx.lineTo(bx + bw * 0.34, by - S * 0.16);
    ctx.lineTo(bx + bw * 0.68, by - S * 0.16);
    ctx.lineTo(bx + bw * 0.82, by);
    ctx.closePath();
    ctx.fill();

    // 车窗
    ctx.fillStyle = '#6EC6EA';
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.25, by - S * 0.015);
    ctx.lineTo(bx + bw * 0.37, by - S * 0.135);
    ctx.lineTo(bx + bw * 0.48, by - S * 0.135);
    ctx.lineTo(bx + bw * 0.48, by - S * 0.015);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.54, by - S * 0.015);
    ctx.lineTo(bx + bw * 0.54, by - S * 0.135);
    ctx.lineTo(bx + bw * 0.65, by - S * 0.135);
    ctx.lineTo(bx + bw * 0.77, by - S * 0.015);
    ctx.closePath();
    ctx.fill();

    // 车灯
    ctx.fillStyle = '#FFE07A';
    disc(ctx, bx + bw * 0.06, by + bh * 0.42, S * 0.030);
    disc(ctx, bx + bw * 0.94, by + bh * 0.42, S * 0.030);

    // 车轮
    ctx.fillStyle = '#2E3238';
    disc(ctx, bx + bw * 0.22, by + bh, S * 0.085);
    disc(ctx, bx + bw * 0.78, by + bh, S * 0.085);
    ctx.fillStyle = '#C9CFD6';
    disc(ctx, bx + bw * 0.22, by + bh, S * 0.038);
    disc(ctx, bx + bw * 0.78, by + bh, S * 0.038);
  }

  // ============================================================
  //  场景 5：小鱼（深蓝水里 + 橙鱼 + 绿草）
  // ============================================================
  function sceneFish(ctx, S) {
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#2E86C1');
    g.addColorStop(1, '#12406B');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    // 水草（贴底，切开后是很好的方位参照）
    ctx.strokeStyle = '#2FA85C';
    ctx.lineWidth = Math.max(4, S * 0.026);
    ctx.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      var wx = S * (0.10 + i * 0.26);
      ctx.beginPath();
      ctx.moveTo(wx, S);
      ctx.quadraticCurveTo(wx + S * 0.05, S * 0.88, wx - S * 0.02, S * 0.74);
      ctx.stroke();
    }

    // 气泡
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    disc(ctx, S * 0.84, S * 0.20, S * 0.045);
    disc(ctx, S * 0.90, S * 0.34, S * 0.028);
    disc(ctx, S * 0.78, S * 0.40, S * 0.020);

    var cx = S * 0.44, cy = S * 0.52, rx = S * 0.26, ry = S * 0.17;

    // 尾巴
    ctx.fillStyle = '#F08A2E';
    tri(ctx, cx + rx * 0.82, cy, cx + rx * 1.55, cy - ry * 1.05, cx + rx * 1.55, cy + ry * 1.05);

    // 身体
    ctx.fillStyle = '#F79B3E';
    ellipseFill(ctx, cx, cy, rx, ry);

    // 背鳍 + 腹鳍
    ctx.fillStyle = '#E0722A';
    tri(ctx, cx - rx * 0.20, cy - ry * 0.92, cx + rx * 0.16, cy - ry * 1.75, cx + rx * 0.50, cy - ry * 0.86);
    tri(ctx, cx - rx * 0.10, cy + ry * 0.86, cx + rx * 0.10, cy + ry * 1.60, cx + rx * 0.44, cy + ry * 0.80);

    // 肚皮
    ctx.fillStyle = '#FFD08A';
    ellipseFill(ctx, cx - rx * 0.06, cy + ry * 0.42, rx * 0.74, ry * 0.36);

    // 眼
    ctx.fillStyle = '#FFFFFF';
    disc(ctx, cx - rx * 0.56, cy - ry * 0.20, S * 0.055);
    ctx.fillStyle = '#22303C';
    disc(ctx, cx - rx * 0.60, cy - ry * 0.20, S * 0.028);
  }

  // ============================================================
  //  场景 6：小熊（粉底 + 棕熊 + 红围巾）
  // ============================================================
  function sceneBear(ctx, S) {
    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#FFD9E0');
    g.addColorStop(1, '#F5A9BC');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    var cx = S * 0.5, cy = S * 0.48, r = S * 0.26;

    // 耳朵
    ctx.fillStyle = '#8D6242';
    disc(ctx, cx - r * 0.76, cy - r * 0.76, r * 0.34);
    disc(ctx, cx + r * 0.76, cy - r * 0.76, r * 0.34);
    ctx.fillStyle = '#C98A63';
    disc(ctx, cx - r * 0.76, cy - r * 0.76, r * 0.18);
    disc(ctx, cx + r * 0.76, cy - r * 0.76, r * 0.18);

    // 头
    ctx.fillStyle = '#A8764F';
    disc(ctx, cx, cy, r);

    // 口鼻区
    ctx.fillStyle = '#E7C3A0';
    ellipseFill(ctx, cx, cy + r * 0.34, r * 0.52, r * 0.38);
    ctx.fillStyle = '#4A3222';
    ellipseFill(ctx, cx, cy + r * 0.22, r * 0.17, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.32);
    ctx.lineTo(cx, cy + r * 0.46);
    ctx.lineWidth = Math.max(2, S * 0.006);
    ctx.strokeStyle = '#4A3222';
    ctx.stroke();

    // 眼睛
    ctx.fillStyle = '#3B2A20';
    disc(ctx, cx - r * 0.36, cy - r * 0.18, r * 0.105);
    disc(ctx, cx + r * 0.36, cy - r * 0.18, r * 0.105);
    ctx.fillStyle = '#FFFFFF';
    disc(ctx, cx - r * 0.32, cy - r * 0.23, r * 0.036);
    disc(ctx, cx + r * 0.40, cy - r * 0.23, r * 0.036);

    // 围巾（占下半部，切开后非常好认）
    ctx.fillStyle = '#E0524F';
    roundRect(ctx, cx - r * 1.05, cy + r * 0.82, r * 2.10, r * 0.42, r * 0.16);
    ctx.fill();
    ctx.fillStyle = '#B93E3B';
    ctx.fillRect(cx + r * 0.50, cy + r * 1.10, r * 0.34, r * 0.52);
  }

  var SCENE_PAINT = {
    house: sceneHouse,
    cat: sceneCat,
    flower: sceneFlower,
    car: sceneCar,
    fish: sceneFish,
    bear: sceneBear
  };

  var SCENES = [
    { id: 'house', name: '小房子' },
    { id: 'cat', name: '小猫咪' },
    { id: 'flower', name: '向日葵' },
    { id: 'car', name: '小汽车' },
    { id: 'fish', name: '小鱼儿' },
    { id: 'bear', name: '小熊' }
  ];
  var SCENE_IDS = SCENES.map(function (o) { return o.id; });

  function paintScene(ctx, id, S) {
    (SCENE_PAINT[id] || sceneHouse)(ctx, S);
  }

  global.Art = {
    SCENES: SCENES,
    SCENE_IDS: SCENE_IDS,
    paintScene: paintScene,
    roundRect: roundRect
  };
})(window);

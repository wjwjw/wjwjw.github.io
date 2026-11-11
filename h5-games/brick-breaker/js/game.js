/*
 * game.js —— 弹球打砖块（状态机 / 输入 / 物理推进 / 渲染 / 界面）
 *
 * 儿童向改造（与经典打砖块的差异）：
 *   1) 掉球不死，只掉一颗心，共 3 颗；掉光才结束。小孩不用一次失手就重来。
 *   2) 挡板宽、球速慢且逐关小步加速（封顶 420px/s），10-foot 距离下追得上。
 *   3) 每次发球前有 3-2-1 预备（掉球后缩短为 1.3s），期间挡板可以移动、按 OK 可提前发球。
 *   4) 星砖打碎会掉一颗星，接住加 30 分；接不住也没惩罚，只给一个「值得绕路」的小目标。
 *
 * 为什么适合电视遥控器（STANDARD §4）：
 *   只有左右两个方向键 + OK，不需要指针。挡板走「按住持续移动」，不是「一次按键走一格」。
 *   重点：绝不依赖 keydown 的 auto-repeat 频率 —— 老 WebView 的重复率不稳且偏慢，
 *   所以自己维护 held.left / held.right，在 rAF 里按 dt 推进（见 bindHeldKeys）。
 *
 * 物理稳定性：球速高时一帧会跨过整块砖，所以按「每子步最多走 0.7 个球半径」拆成子步，
 *   每子步独立做墙 / 挡板 / 砖块判定。反射角统一过 BrickLogic.clampDir，
 *   防止球卡在近水平的长循环里一块砖也打不到（见 js/logic.js）。
 *
 * 时间基准：动画与倒计时用 Date.now()，rAF 时间戳只用来算 dt，两者不混用。
 * 兼容目标：MiTV4A / Android 6 / WebView 约 Chromium 47 —— 经典脚本 + IIFE，纯 ES5。
 */
(function () {
  'use strict';

  var L = window.BrickLogic;
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var STATE = {
    START: 'start', READY: 'ready', PLAY: 'play', PAUSE: 'pause',
    CLEAR: 'clear', WIN: 'win', OVER: 'over'
  };
  var state = STATE.START;
  var pauseFrom = STATE.PLAY;

  var BEST_KEY = 'brick-breaker-best';
  var LIVES = 3;
  var READY_FIRST = 2400;
  var READY_RETRY = 1300;
  var CELEBRATE = 1250;      /* 先撒彩纸，延后再弹结算卡（STANDARD §10.6） */
  var PADDLE_ACCEL = 1.0;    /* 挡板速度系数，乘场地宽度 */
  var STAR_FALL = 135;
  /* 顶部 DOM 覆盖层总预留：10(hud 内边距) + 34(药丸) + 7(药丸下边距)
   * + 10(toast 上边距) + 46(toast) ≈ 107px。场地与砖区都从它之下开始，
   * 保证掉球 toast（唯一会往下伸的 HUD 元素）永远不遮第一行砖；
   * shot.js 对三个视口各有「toast 底边 <= brickTop」的量化断言。 */
  var HUD_TOP = 110;

  var audio = new AudioManager();
  var fx = FX.create();
  var vigCache = null;
  var fieldCache = null;
  /* 柔光贴图：只在 resize 时预渲染一次，渲染循环里只 drawImage（STANDARD §10.3） */
  var ballGlow = null, paddleGlow = null, starGlow = null;

  var best = 0, score = 0, level = 1, lives = LIVES;
  var combo = 0, bricksLeft = 0;
  var bricks = [];
  var stars = [];
  var trail = [];
  var ball = { x: 0, y: 0, r: 9, dx: 0.4, dy: -1 };
  var paddle = { x: 0, w: 140, h: 16, vel: 0 };
  var held = { left: false, right: false };
  var readyUntil = 0, readyFirst = true, lastCountIdx = -1;
  var clearFinal = false, clearTimer = null;
  var dbgFreeze = false;

  var viewW = 0, viewH = 0, dpr = 1;
  var layout = {
    x0: 0, y0: 0, w: 0, h: 0, gap: 6, bw: 0, bh: 0,
    cols: L.GRID_COLS, rows: 4, brickTop: 0, paddleY: 0, paddleH: 16
  };

  var el = {};
  ['hud', 'levelText', 'scoreText', 'bestText', 'leftText', 'livesText', 'toast',
   'startScreen', 'startBest', 'pauseScreen', 'pauseStat',
   'clearScreen', 'clearTag', 'clearTitle', 'clearStat', 'clearScore', 'clearTip',
   'overScreen', 'overScore', 'overLevel', 'overBest', 'overTip'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  /* ============================================================
   *  存档
   * ============================================================ */
  function loadBest() {
    try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; }
    catch (e) { best = 0; }
  }
  function saveBest() {
    if (score > best) best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ============================================================
   *  布局 / 自适应 / 预渲染
   * ============================================================ */
  function resize() {
    var ox = layout.x0, oy = layout.y0, ow = layout.w, oh = layout.h;

    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.setView(viewW, viewH);        /* fx.flash 需要视口尺寸，缺了会静默不生效 */

    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    computeLayout();

    /* 分辨率变化时把球和挡板按场地比例搬过去，否则会跑到场地外 */
    if (ow > 0 && oh > 0) {
      paddle.x = layout.x0 + (paddle.x - ox) / ow * layout.w;
      ball.x = layout.x0 + (ball.x - ox) / ow * layout.w;
      ball.y = layout.y0 + (ball.y - oy) / oh * layout.h;
      for (var i = 0; i < stars.length; i++) {
        stars[i].x = layout.x0 + (stars[i].x - ox) / ow * layout.w;
        stars[i].y = layout.y0 + (stars[i].y - oy) / oh * layout.h;
      }
    } else {
      paddle.x = layout.x0 + layout.w / 2;
      ball.x = paddle.x;
      ball.y = layout.paddleY - ball.r;
    }
    clampPaddle();
    if (state === STATE.READY) placeBallOnPaddle();

    prerenderField();
    prerenderVignette();
    ballGlow = FX.glowSprite('#ffd9a0', 40, 0.55);
    paddleGlow = FX.glowSprite('#ffd166', 56, 0.34);
    starGlow = FX.glowSprite('#ffe9a8', 28, 0.60);
    spawnMotes();
  }

  function computeLayout() {
    var side = 16;
    var top = HUD_TOP;                /* 给 DOM HUD（药丸行 + 掉球 toast）留出的高度 */
    layout.w = Math.max(320, Math.min(viewW - side * 2, 1080));
    layout.h = Math.max(220, viewH - top - 16);
    layout.x0 = Math.round((viewW - layout.w) / 2);
    layout.y0 = top;

    layout.cols = L.GRID_COLS;
    layout.rows = Math.min(6, 4 + Math.floor((level - 1) / 2));
    layout.gap = Math.max(4, Math.round(layout.w * 0.006));
    layout.bw = (layout.w - (layout.cols + 1) * layout.gap) / layout.cols;
    layout.bh = Math.max(16, Math.min(30, layout.h * 0.068));
    layout.brickTop = layout.y0 + Math.max(22, layout.h * 0.075);

    layout.paddleH = Math.max(14, Math.round(layout.h * 0.030));
    layout.paddleY = layout.y0 + layout.h - Math.max(30, layout.h * 0.075) - layout.paddleH;
    paddle.w = Math.max(96, Math.min(190, layout.w * 0.17));
    paddle.h = layout.paddleH;
    ball.r = Math.max(7, Math.min(11, layout.w * 0.010));
  }

  function rr(g, x, y, w, h, r) {
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

  /* 场地边框 / 星尘底纹是静态的：只在 resize 时画一次，每帧只 drawImage */
  function prerenderField() {
    var w = Math.round(layout.w), h = Math.round(layout.h);
    fieldCache = document.createElement('canvas');
    fieldCache.width = Math.max(1, Math.round(w * dpr));
    fieldCache.height = Math.max(1, Math.round(h * dpr));
    var g = fieldCache.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* 场地底色：上暖紫 → 下深蓝，静态预渲染，每帧只 drawImage */
    rr(g, 1, 1, w - 2, h - 2, 16);
    var bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1d2750');
    bg.addColorStop(0.45, '#121d3a');
    bg.addColorStop(1, '#080e20');
    g.fillStyle = bg;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#43598c';
    g.stroke();
    /* 内框一圈亮边，让场地像一块嵌进去的面板 */
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(150, 190, 255, 0.20)';
    rr(g, 5, 5, w - 10, h - 10, 13);
    g.stroke();

    /* 砖区背后的紫色柔光 + 顶部暖光带：把上半场的注意力聚到砖阵 */
    var glow = g.createRadialGradient(w / 2, h * 0.10, 8, w / 2, h * 0.10, w * 0.62);
    glow.addColorStop(0, 'rgba(150, 115, 235, 0.26)');
    glow.addColorStop(0.55, 'rgba(110, 100, 210, 0.10)');
    glow.addColorStop(1, 'rgba(110, 100, 210, 0)');
    g.fillStyle = glow;
    g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = 'rgba(255, 233, 168, 0.045)';
    g.fillRect(6, 6, w - 12, layout.brickTop - layout.y0 + layout.bh * layout.rows + 14);

    /* 下半场「台面」：渐变压暗 + 地平线亮线 + 透视网格，给空场一点纵深 */
    var floorY = layout.paddleY - layout.y0 - 26;
    var floor = g.createLinearGradient(0, floorY, 0, h);
    floor.addColorStop(0, 'rgba(86, 112, 180, 0.10)');
    floor.addColorStop(1, 'rgba(4, 8, 20, 0.52)');
    g.fillStyle = floor;
    g.fillRect(6, floorY, w - 12, h - floorY - 6);
    g.fillStyle = 'rgba(150, 190, 255, 0.20)';
    g.fillRect(6, floorY, w - 12, 2);
    g.strokeStyle = 'rgba(125, 155, 230, 0.075)';
    g.lineWidth = 1;
    var i, vx;
    for (i = 0; i <= 10; i++) {
      vx = 6 + (w - 12) * i / 10;
      g.beginPath();
      g.moveTo(w / 2, floorY);
      g.lineTo(vx, h - 6);
      g.stroke();
    }
    for (i = 1; i <= 5; i++) {
      var gy = floorY + (h - floorY - 8) * (i / 5) * (i / 5);
      g.beginPath();
      g.moveTo(6, gy);
      g.lineTo(w - 6, gy);
      g.stroke();
    }

    /* LCG 固定种子：resize 重绘时星尘不会整体跳一遍 */
    var rnd = L.lcg(9137);
    for (i = 0; i < 88; i++) {
      var px = 8 + rnd() * (w - 16);
      var py = 8 + rnd() * (h - 16);
      var s = 1 + rnd() * 1.7;
      if (rnd() > 0.90) {
        g.beginPath();
        g.arc(px, py, s * 2.6, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255, 225, 160, 0.10)';
        g.fill();
      }
      g.fillStyle = rnd() > 0.72 ? 'rgba(255,209,102,0.24)' : 'rgba(190,215,255,0.16)';
      g.fillRect(px, py, s, s);
    }

    /* 左右反弹墙内侧亮边，给「球会弹回来」一个视觉提示 */
    g.fillStyle = 'rgba(126, 176, 255, 0.06)';
    g.fillRect(7, 10, 14, h - 20);
    g.fillRect(w - 21, 10, 14, h - 20);
    g.fillStyle = 'rgba(126, 176, 255, 0.30)';
    g.fillRect(3, 10, 3, h - 20);
    g.fillRect(w - 6, 10, 3, h - 20);
  }

  function prerenderVignette() { vigCache = FX.vignette(viewW, viewH, { strength: 0.38 }); }

  function spawnMotes() {
    fx.setAmbient({
      count: 14, w: layout.w, h: layout.h, x0: layout.x0, y0: layout.y0,
      colors: ['#ffe9a8', '#9fd8ff'], glow: 20,
      size: [2, 5], speed: [5, 14], alpha: [0.05, 0.16], core: 0.5
    });
  }

  function brickRect(b) {
    return {
      x: layout.x0 + layout.gap + b.c * (layout.bw + layout.gap),
      y: layout.brickTop + b.r * (layout.bh + layout.gap),
      w: layout.bw, h: layout.bh
    };
  }

  function clampPaddle() {
    var half = paddle.w / 2;
    paddle.x = L.clamp(paddle.x, layout.x0 + half, layout.x0 + layout.w - half);
  }

  /* ============================================================
   *  局面初始化
   * ============================================================ */
  function initRound() {
    score = 0; level = 1; lives = LIVES; combo = 0;
    stars = []; trail = [];
    startLevel(1);
  }

  function startLevel(n) {
    level = n;
    combo = 0;
    stars = []; trail = [];
    computeLayout();
    var built = L.buildLevel(level);
    bricks = built.bricks;
    layout.cols = built.cols;
    layout.rows = built.rows;
    prerenderField();   /* 行数会变（4→5→6），砖区底纹带按新行数重画，别等到下次 resize */
    bricksLeft = bricks.length;
    paddle.x = layout.x0 + layout.w / 2;
    paddle.vel = 0;
    ball.dx = 0.4; ball.dy = -1;
    placeBallOnPaddle();
    syncHud();
  }

  function placeBallOnPaddle() {
    ball.x = paddle.x;
    ball.y = layout.paddleY - ball.r - 2;
    trail = [];
  }

  function beginReady(first) {
    readyFirst = !!first;
    readyUntil = Date.now() + (first ? READY_FIRST : READY_RETRY);
    lastCountIdx = -1;
    placeBallOnPaddle();
    state = STATE.READY;
  }

  function launch() {
    if (state !== STATE.READY) return;
    var side = (level % 2 === 0) ? -1 : 1;
    var d = L.clampDir(0.36 * side, -1);
    ball.dx = d.x; ball.dy = d.y;
    combo = 0;
    state = STATE.PLAY;
    trail = [];
    audio.sfx('launch');
  }

  /* ============================================================
   *  物理推进
   * ============================================================ */
  function movePaddle(dt) {
    var dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    var speed = layout.w * PADDLE_ACCEL;
    var old = paddle.x;
    paddle.x += dir * speed * dt;
    clampPaddle();
    paddle.vel = dt > 0 ? (paddle.x - old) / dt : 0;
  }

  function updatePlay(dt) {
    movePaddle(dt);
    var speed = L.levelSpeed(level);
    var dist = speed * dt;
    var steps = Math.ceil(dist / Math.max(2, ball.r * 0.7));
    if (steps < 1) steps = 1;
    if (steps > 8) steps = 8;
    var h = dt / steps;
    var i;
    for (i = 0; i < steps && state === STATE.PLAY; i++) stepBall(h, speed);

    if (state === STATE.PLAY) {
      trail.push({ x: ball.x, y: ball.y });
      if (trail.length > 9) trail.shift();
      updateStars(dt);
      if (bricksLeft <= 0) levelClear();
    }
    syncHud();
  }

  function stepBall(h, speed) {
    ball.x += ball.dx * speed * h;
    ball.y += ball.dy * speed * h;
    var left = layout.x0, right = layout.x0 + layout.w;
    var top = layout.y0, bottom = layout.y0 + layout.h;

    if (ball.x - ball.r < left) {
      ball.x = left + ball.r; ball.dx = Math.abs(ball.dx); audio.sfx('wall');
    } else if (ball.x + ball.r > right) {
      ball.x = right - ball.r; ball.dx = -Math.abs(ball.dx); audio.sfx('wall');
    }
    if (ball.y - ball.r < top) {
      ball.y = top + ball.r; ball.dy = Math.abs(ball.dy); audio.sfx('wall');
    }

    /* 挡板：只在向下运动、且球底刚穿过挡板面时接，避免从下方「顶」回去 */
    if (ball.dy > 0 && ball.y + ball.r >= layout.paddleY &&
        ball.y - ball.r <= layout.paddleY + paddle.h &&
        ball.x + ball.r >= paddle.x - paddle.w / 2 &&
        ball.x - ball.r <= paddle.x + paddle.w / 2) {
      ball.y = layout.paddleY - ball.r;
      var d = L.paddleBounce(ball.x, paddle.x, paddle.w, paddle.vel, ball.dx);
      ball.dx = d.x; ball.dy = d.y;
      combo = 0;
      fx.ring(ball.x, layout.paddleY, { color: '#ffd166', r1: 40, life: 0.34 });
      fx.glow(ball.x, layout.paddleY, { color: '#ffe9a8' });
      audio.sfx('paddle');
    }

    /* 每子步最多处理一块砖，避免一次跨越把一整行吃光 */
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      var rect = brickRect(b);
      if (L.hitBrick(ball, rect, ball.r)) {
        var nd = L.brickBounce(ball, rect, ball.r, ball.dx, ball.dy);
        ball.dx = nd.x; ball.dy = nd.y;
        onBrickHit(b, rect);
        break;
      }
    }

    if (ball.y - ball.r > bottom) loseBall();
  }

  function onBrickHit(b, rect) {
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    b.hp--;
    if (b.hp > 0) {
      fx.burst(cx, cy, { count: 6, colors: ['#ffffff', b.color], shapes: ['spark4'], speed: [50, 120], life: [0.25, 0.45] });
      audio.sfx('hard');
      return;
    }
    b.alive = false;
    bricksLeft--;
    combo++;
    var gain = 10 * Math.min(combo, 5);
    score += gain;
    fx.burst(cx, cy, {
      count: 12, colors: [b.color, '#fff3b0', '#ffffff'],
      shapes: ['rect', 'spark4'], speed: [70, 210], g: 240, life: [0.35, 0.7]
    });
    fx.float(cx, cy, '+' + gain, { color: '#ffd166' });
    if (combo >= 3) fx.glow(cx, cy, { color: b.color });
    audio.sfx('brick');
    if (b.star) spawnStar(cx, cy);
  }

  function spawnStar(x, y) {
    stars.push({ x: x, y: y, age: 0 });
  }

  function updateStars(dt) {
    for (var i = stars.length - 1; i >= 0; i--) {
      var s = stars[i];
      s.y += STAR_FALL * dt;
      s.age += dt;
      var caught = s.y + 10 >= layout.paddleY && s.y - 10 <= layout.paddleY + paddle.h &&
                   s.x >= paddle.x - paddle.w / 2 && s.x <= paddle.x + paddle.w / 2;
      if (caught) {
        score += 30;
        fx.burst(s.x, s.y, { count: 16, colors: ['#ffd166', '#fff3b0'], shapes: ['star'], speed: [90, 230] });
        fx.float(s.x, s.y - 12, '+30', { color: '#ffe9a8' });
        audio.sfx('star');
        stars.splice(i, 1);
      } else if (s.y > layout.y0 + layout.h + 20) {
        stars.splice(i, 1);
      }
    }
  }

  /* ============================================================
   *  关卡流转
   * ============================================================ */
  function loseBall() {
    if (state !== STATE.PLAY) return;
    lives--;
    combo = 0;
    fx.shake(4, 0.20);
    audio.sfx('lose');
    trail = [];
    if (lives <= 0) { lives = 0; gameOver(); return; }
    toast('接住球啦 · 还剩 ' + lives + ' 颗心', 'warn');
    beginReady(false);
    syncHud();
  }

  function gameOver() {
    state = STATE.OVER;
    audio.stopBGM();
    /* 先判再存：saveBest() 会把 best 抬到 score，之后再比就永远「新纪录」了 */
    var isBest = score > best && score > 0;
    saveBest();
    audio.sfx('over');
    setText(el.overScore, score);
    setText(el.overLevel, level);
    setText(el.overBest, best);
    setText(el.overTip, isBest ? '新纪录！再来一局吧' : '别急，挡板再往球那边挪一点就好');
    /* 结算文本同步写，只把覆盖层的显示延后（STANDARD §10.6） */
    show('overScreen');
    focusFirst('overScreen');
    syncHud();
  }

  function levelClear() {
    if (state !== STATE.PLAY) return;
    clearFinal = level >= L.MAX_LEVEL;
    /* 庆祝期间进入 CLEAR/WIN：pauseGame 只认 PLAY/READY，按暂停不会把结算卡锁死 */
    state = clearFinal ? STATE.WIN : STATE.CLEAR;
    audio.stopBGM();
    score += 100 + lives * 20;
    saveBest();
    audio.sfx(clearFinal ? 'win' : 'level');
    fx.confetti({ w: viewW, count: clearFinal ? 90 : 55 });
    fx.flash('#ffd166', 0.35, { alpha: 0.32 });

    setText(el.clearTag, clearFinal ? 'ALL CLEAR' : 'LEVEL ' + level);
    setText(el.clearTitle, clearFinal ? '全部通关啦！' : '第 ' + level + ' 关完成');
    setText(el.clearScore, score);
    setText(el.clearStat, '分数 ' + score + ' · 剩余 ' + lives + ' 颗心');
    setText(el.clearTip, clearFinal ? '六关全部打完，真是好眼力！' : '过关奖励 +' + (100 + lives * 20) + ' 分，休息一下再继续');
    document.getElementById('btnNext').textContent = clearFinal ? '再玩一次' : '下一关';
    syncHud();

    cancelClearTimer();
    clearTimer = setTimeout(function () {
      clearTimer = null;
      if (state === STATE.CLEAR || state === STATE.WIN) {
        show('clearScreen');
        focusFirst('clearScreen');
      }
    }, CELEBRATE);
  }

  function cancelClearTimer() {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  }

  function nextLevel() {
    hide('clearScreen');
    cancelClearTimer();
    startLevel(level + 1);
    fx.clear();
    audio.resume();
    audio.startBGM();
    beginReady(false);
  }

  /* ============================================================
   *  渲染
   * ============================================================ */
  function render(now) {
    ctx.clearRect(0, 0, viewW, viewH);
    ctx.fillStyle = '#080d1a';
    ctx.fillRect(0, 0, viewW, viewH);

    if (fieldCache) ctx.drawImage(fieldCache, layout.x0, layout.y0, layout.w, layout.h);
    fx.drawBack(ctx);

    fx.applyShake(ctx);
    drawBricks();
    drawStars(now);
    drawPaddle();
    drawTrail();
    drawBall(now);
    fx.undoShake(ctx);

    fx.drawFront(ctx);
    if (vigCache) ctx.drawImage(vigCache, 0, 0, viewW, viewH);
    drawReady(now);
  }

  function drawBricks() {
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      var r = brickRect(b);
      /* 投影 → 主体 → 三层受光 → 细描边：纯色叠出糖果砖的厚度 */
      rr(ctx, r.x + 2, r.y + 4, r.w, r.h, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.fill();
      rr(ctx, r.x, r.y, r.w, r.h, 5);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      ctx.fillRect(r.x + 4, r.y + 3, r.w - 8, Math.max(2, r.h * 0.13));
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fillRect(r.x + 3, r.y + 3 + Math.max(2, r.h * 0.13), r.w - 6, 2);
      ctx.fillRect(r.x + 2, r.y + 6, 3, r.h - 12);
      ctx.fillStyle = 'rgba(0,0,0,0.26)';
      ctx.fillRect(r.x + 3, r.y + r.h - 5, r.w - 6, 3);
      rr(ctx, r.x + 0.8, r.y + 0.8, r.w - 1.6, r.h - 1.6, 5);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.stroke();
      if (b.hp > 1) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.fillRect(r.x + 5, r.y + r.h - 7, 7, 3);
      } else if (b.hp < b.maxHp) {
        ctx.strokeStyle = 'rgba(20,20,40,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(r.x + r.w * 0.25, r.y + 2);
        ctx.lineTo(r.x + r.w * 0.55, r.y + r.h - 2);
        ctx.stroke();
      }
      if (b.star) {
        if (starGlow) ctx.drawImage(starGlow, r.x + r.w / 2 - 24, r.y + r.h / 2 - 24, 48, 48);
        FX.pathStar(ctx, r.x + r.w / 2, r.y + r.h / 2, Math.min(10, r.h * 0.40), Math.min(4, r.h * 0.16), 0);
        ctx.fillStyle = '#fff8cc';
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(255,209,102,0.90)';
        ctx.stroke();
      }
    }
  }

  function drawStars(now) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var rad = 10 + Math.sin(now / 140 + i) * 1.2;
      if (starGlow) ctx.drawImage(starGlow, s.x - 30, s.y - 30, 60, 60);
      /* 四角星芒 */
      ctx.strokeStyle = 'rgba(255, 240, 180, 0.62)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x - rad * 1.5, s.y);
      ctx.lineTo(s.x + rad * 1.5, s.y);
      ctx.moveTo(s.x, s.y - rad * 1.5);
      ctx.lineTo(s.x, s.y + rad * 1.5);
      ctx.stroke();
      FX.pathStar(ctx, s.x, s.y, rad, rad * 0.45, s.age * 2.2);
      ctx.fillStyle = '#ffe07a';
      ctx.fill();
    }
  }

  function drawPaddle() {
    var x = paddle.x - paddle.w / 2, y = layout.paddleY;
    /* 地面投影 + 柔光 */
    rr(ctx, x + 3, y + 6, paddle.w, paddle.h, paddle.h / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fill();
    if (paddleGlow) {
      ctx.drawImage(paddleGlow, paddle.x - paddle.w * 0.62, y - paddle.h * 1.7,
                    paddle.w * 1.24, paddle.h * 4.4);
    }
    /* 底沿暗色 → 主体亮黄 → 顶部高光 */
    rr(ctx, x, y, paddle.w, paddle.h, paddle.h / 2);
    ctx.fillStyle = '#b8861f';
    ctx.fill();
    rr(ctx, x, y, paddle.w, paddle.h - 4, (paddle.h - 4) / 2);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillRect(x + 9, y + 3, paddle.w - 18, 3);
    /* 中央握把 + 两端亮头 */
    rr(ctx, paddle.x - 16, y + 3, 32, paddle.h - 7, 3);
    ctx.fillStyle = '#ffe9a8';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.60)';
    ctx.fillRect(paddle.x - 12, y + 4, 24, 2);
    ctx.fillStyle = '#fff3c4';
    rr(ctx, x + 2, y + 3, 7, paddle.h - 7, 3);
    ctx.fill();
    rr(ctx, x + paddle.w - 9, y + 3, 7, paddle.h - 7, 3);
    ctx.fill();
  }

  function drawTrail() {
    for (var i = 0; i < trail.length; i++) {
      var p = trail[i];
      var k = (i + 1) / (trail.length + 1);
      ctx.globalAlpha = 0.05 + k * 0.16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ball.r * (0.35 + k * 0.55), 0, Math.PI * 2);
      ctx.fillStyle = '#ffd8a0';
      ctx.fill();
      ctx.globalAlpha = 0.10 + k * 0.30;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ball.r * (0.12 + k * 0.22), 0, Math.PI * 2);
      ctx.fillStyle = '#fff6d8';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBall(now) {
    var pulse = 1 + Math.sin(now / 180) * 0.04;
    var gr = ball.r * 4.6 * pulse;
    if (ballGlow) {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(ballGlow, ball.x - gr, ball.y - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1;
    }
    /* 暖色底沿 + 白核 + 高光点：小球不再是平面圆点 */
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = '#e8c96a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r - 1.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf2';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255,220,150,0.85)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ball.x - ball.r * 0.30, ball.y - ball.r * 0.32, ball.r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.98)';
    ctx.fill();
  }

  /* 3-2-1 倒计时的分段（READY_FIRST=2400 时每段 600ms）。
   * drawReady 画字与 loop 播「滴」声都要用它，抽成一处，改预备时长只动 READY_FIRST。 */
  function countIdx(remain) {
    return remain > 1800 ? 0 : (remain > 1200 ? 1 : (remain > 600 ? 2 : 3));
  }

  /* 暗角之上再画倒计时 / 发球提示，任何状态下都读得清（STANDARD §10.4） */
  function drawReady(now) {
    if (state !== STATE.READY) return;
    var cx = viewW / 2, cy = layout.y0 + layout.h * 0.55;
    if (readyFirst) {
      var left = readyUntil - now;
      var idx = countIdx(left);
      var text = idx < 3 ? String(3 - idx) : '开始！';
      ctx.textAlign = 'center';
      ctx.font = '700 92px sans-serif';
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(16, 12, 36, 0.72)';
      ctx.strokeText(text, cx, cy);
      ctx.fillStyle = 'rgba(255, 209, 102, 0.96)';
      ctx.fillText(text, cx, cy);
      ctx.font = '500 20px sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeText('左右移动挡板 · 按 OK 立即发球', cx, cy + 44);
      ctx.fillStyle = 'rgba(230, 240, 255, 0.88)';
      ctx.fillText('左右移动挡板 · 按 OK 立即发球', cx, cy + 44);
    } else {
      ctx.textAlign = 'center';
      ctx.font = '500 24px sans-serif';
      ctx.fillStyle = 'rgba(255, 233, 168, 0.90)';
      ctx.fillText('球回到挡板上了 · 按 OK 发球', cx, cy);
    }
    ctx.textAlign = 'left';
  }

  /* ============================================================
   *  HUD / 覆盖层
   * ============================================================ */
  function setText(node, v) {
    if (!node) return;
    var s = String(v);
    if (node.textContent !== s) node.textContent = s;
  }

  function syncHud() {
    setText(el.levelText, level);
    setText(el.scoreText, score);
    setText(el.bestText, best > score ? best : score);
    setText(el.leftText, bricksLeft);
    var h = '';
    for (var i = 0; i < LIVES; i++) h += (i < lives ? '♥' : '♡');
    setText(el.livesText, h);
    setText(el.startBest, best);
  }

  var toastTimer = null;
  function toast(text, cls) {
    el.toast.textContent = text;
    el.toast.className = cls ? cls : '';
    el.toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.add('hidden'); }, 1400);
  }

  var SCREENS = ['startScreen', 'pauseScreen', 'clearScreen', 'overScreen'];
  var animTimers = {};

  /* 重播渐入动画：先摘类 → 强制回流 → 再加类；700ms 后摘类做 JS 兜底 */
  function show(id) {
    var e = document.getElementById(id);
    if (!e) return;
    e.classList.remove('hidden');
    e.classList.remove('anim-in');
    void e.offsetWidth;
    e.classList.add('anim-in');
    if (animTimers[id]) clearTimeout(animTimers[id]);
    animTimers[id] = setTimeout(function () {
      animTimers[id] = null;
      e.classList.remove('anim-in');
    }, 700);
    /* 启动器内主动聚焦兜底，tv-controls 判断可见性时不会漏掉按钮 */
    if (window.__tvControlsInjected) {
      var first = e.querySelector('[data-tv-focus]');
      if (first && typeof first.focus === 'function') first.focus();
    }
  }

  function hide(id) {
    var e = document.getElementById(id);
    if (e) e.classList.add('hidden');
    if (animTimers[id]) { clearTimeout(animTimers[id]); animTimers[id] = null; }
  }
  function hideScreens() { for (var i = 0; i < SCREENS.length; i++) hide(SCREENS[i]); }

  function focusFirst(screenId) {
    var box = document.getElementById(screenId);
    if (!box) return;
    if (window.__tvControlsInjected) return;
    if (window.TVNav) TVNav.init(box);
  }

  function gotoStart() {
    cancelClearTimer();
    state = STATE.START;
    audio.stopBGM();
    el.hud.classList.add('hidden');
    initRound();
    fx.clear();
    hideScreens();
    show('startScreen');
    focusFirst('startScreen');
    syncHud();
  }

  function startGame() {
    audio.resume();
    audio.startBGM();
    audio.sfx('start');
    initRound();
    fx.clear();
    cancelClearTimer();
    hideScreens();
    el.hud.classList.remove('hidden');
    beginReady(true);
  }

  function pauseGame() {
    /* 只在 PLAY / READY 生效：庆祝期间按暂停不会把状态卡在 CLEAR 上（STANDARD §10.6） */
    if (state !== STATE.PLAY && state !== STATE.READY) return;
    pauseFrom = state;
    state = STATE.PAUSE;
    held.left = false; held.right = false;
    audio.stopBGM();
    setText(el.pauseStat, '第 ' + level + ' 关 · 分数 ' + score + ' · 剩余 ' + lives + ' 颗心');
    show('pauseScreen');
    focusFirst('pauseScreen');
  }

  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    hide('pauseScreen');
    audio.resume();
    audio.startBGM();
    if (pauseFrom === STATE.READY) {
      /* 倒计时里被暂停：整体后移，别一恢复就直接开跑 */
      readyUntil = Date.now() + (readyFirst ? READY_FIRST : READY_RETRY);
      lastCountIdx = -1;
      state = STATE.READY;
    } else {
      state = STATE.PLAY;
    }
  }

  /* ============================================================
   *  输入
   * ============================================================ */
  /*
   * 连续移动靠「按下状态」而不是 keydown 的 auto-repeat。
   * 除方向键 / WASD 外也认安卓 DPAD 的 keyCode 19~22，与 shared/input.js 的兜底一致。
   * blur 时必须清掉 held，否则切后台回来挡板会一直往一个方向跑。
   */
  function bindHeldKeys() {
    function apply(e, released) {
      var k = e.key, code = e.keyCode;
      var isLeft = (k === 'ArrowLeft' || k === 'a' || k === 'A' || code === 37 || code === 21);
      var isRight = (k === 'ArrowRight' || k === 'd' || k === 'D' || code === 39 || code === 22);
      if (isLeft) held.left = !released;
      if (isRight) held.right = !released;
    }
    window.addEventListener('keydown', function (e) { apply(e, false); }, false);
    window.addEventListener('keyup', function (e) { apply(e, true); }, false);
  }

  /* 鼠标 / 触屏只是附加操作方式，遥控器不依赖指针（STANDARD §4） */
  function bindPointer() {
    function move(clientX) {
      if (state !== STATE.PLAY && state !== STATE.READY) return;
      var box = canvas.getBoundingClientRect();
      paddle.x = clientX - box.left;
      clampPaddle();
      if (state === STATE.READY) placeBallOnPaddle();
    }
    canvas.addEventListener('mousemove', function (e) { move(e.clientX); }, false);
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches[0]) move(e.touches[0].clientX);
    }, false);
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches[0]) move(e.touches[0].clientX);
    }, false);
  }

  TVInput.on('dir', function (d) {
    /* 游戏中方向键归 held 管，这里只做菜单 / 结算页的焦点导航 */
    if (state === STATE.PLAY || state === STATE.READY) return;
    if (window.TVNav && !window.__tvControlsInjected) TVNav.move(d);
  });

  TVInput.on('confirm', function () {
    if (state === STATE.READY) { launch(); return; }
    if (state === STATE.PLAY) { pauseGame(); return; }
    /* standalone 下 TVInput 会把 Enter/Space 拦掉，必须补一次按钮激活 */
    if (window.TVNav && !window.__tvControlsInjected) TVNav.confirm();
  });

  TVInput.on('back', function () {
    if (state === STATE.PLAY || state === STATE.READY) pauseGame();
    else if (state === STATE.PAUSE) resumeGame();
    else if (state === STATE.OVER || state === STATE.CLEAR || state === STATE.WIN) gotoStart();
  });

  function bindClick(id, fn) {
    var e = document.getElementById(id);
    if (e) e.addEventListener('click', function (ev) { ev.preventDefault(); fn(); });
  }

  bindClick('btnStart', startGame);
  bindClick('btnResume', resumeGame);
  bindClick('btnRestart', function () { hide('pauseScreen'); startGame(); });
  bindClick('btnMute', function () {
    var m = audio.toggleMute();
    document.getElementById('btnMute').textContent = m ? '取消静音' : '声音';
  });
  bindClick('btnQuit', gotoStart);
  bindClick('btnNext', function () { if (state === STATE.WIN) startGame(); else nextLevel(); });
  bindClick('btnReplay', startGame);
  bindClick('btnOverQuit', gotoStart);

  bindHeldKeys();
  bindPointer();
  window.addEventListener('resize', resize);

  /* 切后台 / 失焦自动暂停：计时与 BGM 不在后台继续，恢复由玩家手动操作 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseGame();
  });
  window.addEventListener('blur', function () {
    held.left = false; held.right = false;
    pauseGame();
  }, false);

  /* ============================================================
   *  主循环
   * ============================================================ */
  var lastT = 0;
  function loop(t) {
    if (!lastT) lastT = t;
    var dt = (t - lastT) / 1000;
    lastT = t;
    if (dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;      /* 切后台回来不要一口气把球推很远 */

    var now = Date.now();
    fx.update(dt);

    if (state === STATE.READY) {
      movePaddle(dt);
      placeBallOnPaddle();
      if (now >= readyUntil) {
        audio.sfx('go');
        launch();
      } else if (readyFirst) {
        var ci = countIdx(readyUntil - now);
        if (ci !== lastCountIdx) { lastCountIdx = ci; audio.sfx('count'); }
      }
    } else if (state === STATE.PLAY && !dbgFreeze) {
      updatePlay(dt);
    }

    render(now);
    requestAnimationFrame(loop);
  }

  /* 浏览器返回键陷阱（仅 standalone）：每次 popstate 后都要重新占位，
     否则第二次按返回就真的离开页面。启动器内由 launcher 统一处理。 */
  function setupBackTrap() {
    if (!window.history || !window.history.pushState) return;
    if (window.__tvControlsInjected) return;
    var mark = function () {
      try { window.history.pushState({ bb: 1 }, ''); } catch (e) { /* 某些 WebView 会抛 */ }
    };
    mark();
    window.addEventListener('popstate', function () {
      if (window.__tvControlsInjected) return;
      mark();
      TVInput.trigger('back');
    });
  }

  /* ============================================================
   *  启动
   * ============================================================ */
  loadBest();
  resize();
  gotoStart();
  requestAnimationFrame(loop);
  if (document.readyState === 'complete') setupBackTrap();
  else window.addEventListener('load', setupBackTrap);

  /* 调试钩子：仅 URL 带 #debug 时挂出，供 smoke / CDP 截图驱动 */
  if (window.location && window.location.hash === '#debug') {
    window.__brick = {
      get state() { return state; },
      set state(v) { state = v; },
      get level() { return level; },
      get score() { return score; },
      get lives() { return lives; },
      get bricksLeft() { return bricksLeft; },
      get combo() { return combo; },
      get ball() { return ball; },
      get paddle() { return paddle; },
      get bricks() { return bricks; },
      get stars() { return stars; },
      get layout() { return layout; },
      get held() { return held; },
      get clearFinal() { return clearFinal; },
      get logic() { return L; },
      startNow: function () { launch(); },
      startGame: startGame,
      launch: launch,
      L: L,
      setBall: function (x, y, dx, dy) {
        ball.x = x; ball.y = y; ball.dx = dx; ball.dy = dy;
      },
      setPaddle: function (x) { paddle.x = x; clampPaddle(); },
      setLevel: function (n) { startLevel(n); },
      hold: function (dir, on) { if (dir === 'left' || dir === 'right') held[dir] = !!on; },
      movePaddle: movePaddle,
      stepBall: stepBall,
      updatePlay: updatePlay,
      forceClear: function () {
        for (var i = 0; i < bricks.length; i++) bricks[i].alive = false;
        bricksLeft = 0;
        levelClear();
      },
      loseBall: loseBall,
      freeze: function (v) { dbgFreeze = !!v; },
      clearFx: function () { fx.clear(); trail = []; stars = []; },
      render: function () { render(Date.now()); },
      syncHud: syncHud,
      toast: toast
    };
  }
})();

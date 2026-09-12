/*
 * game.js —— 贪吃蛇（主状态机 + 玩法 + 输入 + 渲染）
 *
 * 儿童向改造（与经典贪吃蛇的差异）：
 *   1) 撞墙不死 —— 从另一边钻出来（wrap）。小孩最容易在墙角翻车，一次就 game over 太挫败。
 *   2) 撞到自己不死 —— 掉一颗心，身体缩短一半，短暂无敌并闪烁，还能继续玩。共 3 颗心。
 *   3) 开局有 3-2-1 倒计时，让手来得及放到遥控器上（倒计时期间可以预先选方向）。
 *   4) 每 5 个苹果冒一颗金星（限时 7 秒，+50 分），给一个「值得绕路」的小目标。
 *
 * 为什么适合电视遥控器（见 docs/STANDARD.md §4）：
 *   只需要四个方向键，不需要指针与拖拽；蛇一直在动，方向键「改的是意图而不是位置」，
 *   孩子不用瞄准。转向做了 2 格输入队列（先上后左这种连招不会丢），并禁止 180 度掉头
 *   （否则蛇头会立刻撞到自己脖子，那是必死操作）。
 *
 * 时间基准：动画/计时统一用 Date.now()（epoch 毫秒），rAF 时间戳只用来算 dt，两者不混用。
 *
 * 兼容目标：MiTV4A / Android 6 / WebView ≈ Chromium 47 —— 经典脚本 + IIFE，不用 ES module。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var STATE = { START: 'start', READY: 'ready', PLAY: 'play', PAUSE: 'pause', OVER: 'over' };
  var state = STATE.START;
  var pauseFrom = STATE.PLAY;

  var BEST_KEY = 'snake-best';

  // 网格：20 × 13。10-foot 距离下每格约 36px，孩子看得清蛇和苹果
  var COLS = 20, ROWS = 13;

  var START_LEN = 3;
  var LIVES = 3;
  var BASE_STEP = 300;      // 初始每步毫秒（越往后越快）
  var MIN_STEP = 120;
  var STEP_DEC = 16;        // 每升一关减少
  var FOOD_PER_LEVEL = 6;   // 每吃几个苹果升一关
  var STAR_EVERY = 5;       // 每几个苹果来一次金星
  var STAR_LIFE = 7000;     // 金星存在时间
  var QUICK_MS = 2500;      // 手速奖励窗口
  var READY_DUR = 2400;     // 3-2-1-开始
  var HURT_INVINCIBLE = 1200;

  var DIRV = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
  };

  var audio = new AudioManager();

  // TA 特效库（shared/fx.js）：彩纸 / 震屏 / 环境花粉 / 暗角。
  // 注意：吃到东西的星粒 / 飘字 / 扩散环仍是本文件自带的那套（它跟蛇的格子坐标绑得更紧），
  // fx 只补它没覆盖的三种：环境氛围、受击震屏、升级彩纸。
  var fx = FX.create();
  var vigCache = null;     // 暗角

  var best = 0, score = 0, level = 1, lives = LIVES, apples = 0;
  var snake = [];           // [{x,y}]，snake[0] 是头
  var prev = [];            // 上一步的位置快照，用于帧间插值
  var dir = { x: 1, y: 0 };
  var queue = [];           // 待生效的转向（最多 2 个，避免快速连按丢输入）
  var stepMs = BASE_STEP, stepAcc = 0;
  var pendingGrow = 0;
  var apple = null, star = null;
  var readyUntil = 0, lastCountIdx = -1;
  var invUntil = 0;
  var lastEatAt = 0;
  var warped = false;
  var flash = 0;
  var particles = [];
  var floats = [];            // 飘字：{x,y,text,color,age,life}
  var rings = [];             // 吃到时的扩散圆环：{x,y,color,age,life}
  var headPulse = 0;          // 吃到东西时蛇头「吞咽」放大，1 → 0
  var levelFlash = 0;         // 升关金光，1 → 0
  var dbgFreeze = false;      // 仅 #debug：冻结自动步进，让测试能完全按步驱动

  // 蛇身色阶表：从头到尾由亮绿渐变到深绿。
  // 预生成 48 级，渲染时按索引取，避免每帧拼 'rgb(...)' 字符串（老设备 GC 压力大）。
  var GRAD_STEPS = 48;
  var GRAD = (function () {
    var a = [126, 224, 184], b = [39, 122, 86], out = [];
    for (var i = 0; i < GRAD_STEPS; i++) {
      var k = i / (GRAD_STEPS - 1);
      out.push('rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' +
                        Math.round(a[1] + (b[1] - a[1]) * k) + ',' +
                        Math.round(a[2] + (b[2] - a[2]) * k) + ')');
    }
    return out;
  })();
  var GRAD_HURT = (function () {
    var a = [255, 217, 217], b = [198, 106, 106], out = [];
    for (var i = 0; i < GRAD_STEPS; i++) {
      var k = i / (GRAD_STEPS - 1);
      out.push('rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' +
                        Math.round(a[1] + (b[1] - a[1]) * k) + ',' +
                        Math.round(a[2] + (b[2] - a[2]) * k) + ')');
    }
    return out;
  })();

  var viewW = 0, viewH = 0, dpr = 1;
  var layout = { tile: 0, x0: 0, y0: 0, w: 0, h: 0 };
  var bg = null, bgPad = 0;

  var el = {};
  ['hud', 'levelText', 'scoreText', 'bestText', 'lenText', 'livesText', 'toast',
   'startScreen', 'pauseScreen', 'overScreen',
   'startBest', 'pauseStat', 'overTitle', 'overScore', 'overLen', 'overLevel', 'overBest', 'overTip'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  // ============================================================
  //  存档
  // ============================================================
  function loadBest() {
    try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; }
    catch (e) { best = 0; }
  }
  function saveBest() {
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* 隐私模式忽略 */ }
  }

  // ============================================================
  //  布局 / 自适应
  // ============================================================
  function resize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    computeLayout();
    prerenderBoard();
    prerenderVignette();
    spawnPollen();
  }

  // TA：暗角。棋盘外那一圈死黑有了渐变压边，草地更像「被灯光照着的一块地」。
  function prerenderVignette() {
    vigCache = FX.vignette(viewW, viewH, { strength: 0.40 });
  }

  /* TA：草地上的花粉 / 小飞虫。只用 x0/y0 把它们关在棋盘矩形里 ——
   * 飘到边框外面会立刻露馅（边框是深色的，花粉在黑底上像噪点）。 */
  function spawnPollen() {
    fx.setAmbient({
      count: 12, w: layout.w, h: layout.h, x0: layout.x0, y0: layout.y0,
      colors: ['#fff3b0', '#d9ffb0'],
      glow: 22, size: [2, 5], speed: [6, 15],
      alpha: [0.07, 0.20], core: 0.6
    });
  }

  function computeLayout() {
    var pad = 16;
    var top = 74;                       // 给 DOM HUD 留出的高度
    var bottom = 14;
    var availW = Math.max(80, viewW - pad * 2);
    var availH = Math.max(80, viewH - top - bottom);
    var tile = Math.floor(Math.min(availW / COLS, availH / ROWS));
    if (tile < 8) tile = 8;
    layout.tile = tile;
    layout.w = tile * COLS;
    layout.h = tile * ROWS;
    layout.x0 = Math.round((viewW - layout.w) / 2);
    layout.y0 = Math.round(top + (availH - layout.h) / 2);
  }

  // 棋盘底纹是静态的，预渲染到离屏 canvas，每帧只 drawImage —— 老设备上省不少开销
  function prerenderBoard() {
    var B = Math.max(8, Math.round(layout.tile * 0.3));
    var w = layout.w + B * 2, h = layout.h + B * 2;
    bg = document.createElement('canvas');
    bg.width = Math.max(1, Math.round(w * dpr));
    bg.height = Math.max(1, Math.round(h * dpr));
    var g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    rr(g, 1, 1, w - 2, h - 2, 18);
    g.fillStyle = '#1b3a2a';
    g.fill();
    g.strokeStyle = '#2f5d3a';
    g.lineWidth = 2;
    g.stroke();

    rr(g, B, B, layout.w, layout.h, 8);
    g.fillStyle = '#12261b';
    g.fill();

    g.fillStyle = 'rgba(255, 255, 255, 0.022)';
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if ((x + y) % 2 === 0) g.fillRect(B + x * layout.tile, B + y * layout.tile, layout.tile, layout.tile);
      }
    }

    drawGrass(g, B);
    bgPad = B;
  }

  /*
   * 草地点缀（草叶 + 小花），只画一次到离屏 canvas。
   * 用**固定种子的 LCG** 而不是 Math.random：否则每次 resize 重绘，草的位置都会跳一遍，
   * 电视上转个分辨率 / 旋屏就会看到草皮「抖」一下。
   */
  function drawGrass(g, B) {
    var seed = 20240912;
    function rnd() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    var tile = layout.tile;
    var i, k;

    g.lineCap = 'round';
    g.strokeStyle = 'rgba(122, 205, 152, 0.17)';
    g.lineWidth = Math.max(1, tile * 0.045);
    for (i = 0; i < 44; i++) {
      var gx = B + rnd() * layout.w;
      var gy = B + rnd() * layout.h;
      var h = tile * (0.10 + rnd() * 0.15);
      for (var b = -1; b <= 1; b++) {
        g.beginPath();
        g.moveTo(gx, gy);
        g.quadraticCurveTo(gx + b * h * 0.5, gy - h * 0.7, gx + b * h * 0.95, gy - h);
        g.stroke();
      }
    }

    for (k = 0; k < 13; k++) {
      var fx = B + rnd() * layout.w, fy = B + rnd() * layout.h;
      var fr = Math.max(1.2, tile * 0.055);
      g.fillStyle = (k % 3 === 0) ? 'rgba(255,209,102,0.28)' : 'rgba(255,178,198,0.24)';
      for (var p = 0; p < 5; p++) {
        var ang = (p * Math.PI * 2) / 5;
        g.beginPath();
        g.arc(fx + Math.cos(ang) * fr, fy + Math.sin(ang) * fr, fr * 0.62, 0, Math.PI * 2);
        g.fill();
      }
    }

    // 内侧一圈亮边，让棋盘像「凹进去」的草地
    g.strokeStyle = 'rgba(160, 230, 185, 0.10)';
    g.lineWidth = Math.max(1, tile * 0.06);
    g.beginPath();
    g.moveTo(B + 1, B + layout.h - 1);
    g.lineTo(B + 1, B + 1);
    g.lineTo(B + layout.w - 1, B + 1);
    g.stroke();
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

  function cellCx(x) { return layout.x0 + x * layout.tile + layout.tile / 2; }
  function cellCy(y) { return layout.y0 + y * layout.tile + layout.tile / 2; }

  // ============================================================
  //  局面初始化
  // ============================================================
  function snapshot() {
    var a = [];
    for (var i = 0; i < snake.length; i++) a.push({ x: snake[i].x, y: snake[i].y });
    return a;
  }

  function initRound() {
    score = 0; level = 1; lives = LIVES; apples = 0;
    stepMs = BASE_STEP; stepAcc = 0; pendingGrow = 0;
    dir = { x: 1, y: 0 }; queue = [];
    invUntil = 0; lastEatAt = 0; flash = 0;
    particles = [];
    floats = []; rings = [];
    headPulse = 0; levelFlash = 0;
    star = null;

    var ry = Math.floor(ROWS / 2);
    snake = [];
    for (var i = 0; i < START_LEN; i++) snake.push({ x: 5 - i, y: ry });
    prev = snapshot();
    apple = freeCell();
    syncHud();
  }

  function freeCell() {
    var occ = {}, i;
    for (i = 0; i < snake.length; i++) occ[snake[i].x + ',' + snake[i].y] = 1;
    if (apple) occ[apple.x + ',' + apple.y] = 1;
    if (star) occ[star.x + ',' + star.y] = 1;
    var free = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) if (!occ[x + ',' + y]) free.push({ x: x, y: y });
    }
    if (!free.length) return null;
    return free[Math.floor(Math.random() * free.length)];
  }

  function spawnApple() { apple = freeCell(); }

  function spawnStar() {
    var c = freeCell();
    if (!c) return;
    star = { x: c.x, y: c.y, kind: 'star', t0: Date.now() };
  }

  // ============================================================
  //  一步逻辑
  // ============================================================
  function step() {
    if (queue.length) dir = queue.shift();

    var head = snake[0];
    var nx = head.x + dir.x, ny = head.y + dir.y;
    warped = false;
    if (nx < 0) { nx = COLS - 1; warped = true; }
    else if (nx >= COLS) { nx = 0; warped = true; }
    if (ny < 0) { ny = ROWS - 1; warped = true; }
    else if (ny >= ROWS) { ny = 0; warped = true; }

    if (Date.now() >= invUntil) {
      // 尾巴这一格「正常情况下会让出来」，所以不算撞；
      // 但正在长身体时尾巴不动，必须一起判，否则会长出重叠的一段。
      var guard = pendingGrow > 0 ? snake.length : snake.length - 1;
      for (var i = 0; i < guard; i++) {
        if (snake[i].x === nx && snake[i].y === ny) { onHurt(); return; }
      }
    }

    prev = snapshot();

    var ateStar = (star && star.x === nx && star.y === ny);
    var ateApple = !ateStar && (apple && apple.x === nx && apple.y === ny);

    snake.unshift({ x: nx, y: ny });

    if (ateStar) onEatStar();
    else if (ateApple) onEatApple();

    if (pendingGrow > 0) pendingGrow--;
    else snake.pop();
  }

  function onHurt() {
    lives--;
    audio.sfx('hit');
    flash = 1;
    // TA：原来只有一层红闪，孩子常常没察觉「掉了一条命」。补一记震屏 + 撞点星屑，
    // 让「疼」这件事在身体层面先被感觉到，再去读 HUD 上少掉的那颗心。
    if (snake.length) {
      fx.shake(Math.max(5, layout.tile * 0.22), 0.34);
      fx.burst(cellCx(snake[0].x), cellCy(snake[0].y), {
        count: 14, colors: ['#e5484d', '#ff9f9f'], shapes: ['dot', 'spark'],
        speed: [70, 220], size: [2.5, 5.5], life: [0.35, 0.7], g: 380
      });
    }
    var keep = Math.max(START_LEN, Math.floor(snake.length / 2));
    snake = snake.slice(0, keep);
    prev = snapshot();
    invUntil = Date.now() + HURT_INVINCIBLE;
    syncHud();
    if (lives <= 0) gameOver();
    else toast('咬到自己啦！剩 ' + lives + ' 颗心', 'warn');
  }

  function onEatApple() {
    var now = Date.now();
    var quick = lastEatAt > 0 && (now - lastEatAt) < QUICK_MS;
    score += quick ? 15 : 10;
    pendingGrow += 1;
    audio.sfx('eat');
    if (quick) { audio.sfx('fast'); toast('手速真快 +15', 'good'); }
    burst(apple.x, apple.y, '#e5484d', 8);
    headPulse = 1;
    ring(apple.x, apple.y, 'rgba(255,150,140,0.92)');
    floatText(apple.x, apple.y, quick ? '+15' : '+10', quick ? '#ffd166' : '#ff9f9f');

    apples++;
    if (apples % STAR_EVERY === 0) spawnStar();
    if (apples % FOOD_PER_LEVEL === 0) levelUp();
    spawnApple();
    lastEatAt = now;
    if (score > best) best = score;
    syncHud();
  }

  function onEatStar() {
    score += 50;
    pendingGrow += 2;
    audio.sfx('star');
    burst(star.x, star.y, '#ffd166', 16);
    headPulse = 1;
    ring(star.x, star.y, 'rgba(255,209,102,0.95)', true);
    floatText(star.x, star.y, '+50', '#ffd166');
    toast('金星！+50', 'good');
    star = null;
    if (score > best) best = score;
    syncHud();
  }

  function levelUp() {
    level++;
    stepMs = Math.max(MIN_STEP, stepMs - STEP_DEC);
    levelFlash = 1;
    audio.sfx('level');
    // TA：升一关是小孩少数几个「我变强了」的时刻，值得撒一把彩纸。
    // 只在棋盘宽度范围内落，不会飘到 HUD 上干扰读数。
    fx.confetti({ count: 34, x0: layout.x0, x1: layout.x0 + layout.w, w: viewW });
    toast('第 ' + level + ' 关 · 加速！', 'good');
    syncHud();
  }

  function gameOver() {
    state = STATE.OVER;
    if (score > best) best = score;
    saveBest();
    audio.sfx('over');
    audio.stopBGM();
    el.overScore.textContent = score;
    el.overLen.textContent = snake.length;
    el.overLevel.textContent = level;
    el.overBest.textContent = best;
    el.overTip.textContent = score >= best && score > 0 ? '新纪录！你太厉害了' : '再来一局，试试吃更多金星';
    hideScreens();
    show('overScreen');
    syncHud();
  }

  // ============================================================
  //  粒子
  // ============================================================
  function burst(cx, cy, color, n) {
    for (var i = 0; i < n; i++) {
      var a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      var sp = 40 + Math.random() * 90;
      particles.push({
        x: cellCx(cx), y: cellCy(cy),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.45 + Math.random() * 0.25, age: 0, color: color
      });
    }
    if (particles.length > 120) particles.splice(0, particles.length - 120);
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
    }
  }

  // ============================================================
  //  飘字 / 扩散圆环（吃到东西的即时反馈）
  // ============================================================
  function floatText(x, y, text, color) {
    floats.push({
      x: cellCx(x), y: cellCy(y) - layout.tile * 0.35,
      text: text, color: color, age: 0, life: 0.85
    });
    if (floats.length > 10) floats.shift();
  }

  function ring(x, y, color, big) {
    rings.push({ x: cellCx(x), y: cellCy(y), color: color, age: 0, life: 0.42, big: !!big });
    if (rings.length > 8) rings.shift();
  }

  function updateFx(dt) {
    var i;
    for (i = floats.length - 1; i >= 0; i--) {
      floats[i].age += dt;
      if (floats[i].age >= floats[i].life) floats.splice(i, 1);
    }
    for (i = rings.length - 1; i >= 0; i--) {
      rings[i].age += dt;
      if (rings[i].age >= rings[i].life) rings.splice(i, 1);
    }
  }

  function drawRings() {
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i], k = r.age / r.life;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.arc(r.x, r.y, layout.tile * (0.3 + (r.big ? 2.2 : 1.3) * k), 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(2, layout.tile * 0.15 * (1 - k));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloats() {
    if (!floats.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.round(layout.tile * 0.54) + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    for (var i = 0; i < floats.length; i++) {
      var f = floats[i], k = f.age / f.life;
      var y = f.y - layout.tile * 0.95 * k;
      ctx.globalAlpha = k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';       // 描边，保证浅色字在草地上也看得清
      ctx.fillText(f.text, f.x + 2, y + 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ============================================================
  //  渲染
  // ============================================================
  function render(now) {
    ctx.fillStyle = '#08120d';
    ctx.fillRect(0, 0, viewW, viewH);

    if (bg) ctx.drawImage(bg, layout.x0 - bgPad, layout.y0 - bgPad,
                          layout.w + bgPad * 2, layout.h + bgPad * 2);

    fx.drawBack(ctx);            // 花粉：草皮之上、蛇之下
    fx.applyShake(ctx);          // 受击震屏只晃棋盘内容，不晃整屏

    if (apple) drawApple(apple, now);
    if (star) drawStar(star, now);
    drawSnake(now);
    drawRings();
    drawParticles();
    drawFloats();

    if (flash > 0) {
      ctx.fillStyle = 'rgba(229, 72, 77, ' + (0.32 * flash).toFixed(3) + ')';
      ctx.fillRect(layout.x0, layout.y0, layout.w, layout.h);
    }
    if (levelFlash > 0) {
      ctx.fillStyle = 'rgba(255, 209, 102, ' + (0.20 * levelFlash).toFixed(3) + ')';
      ctx.fillRect(layout.x0, layout.y0, layout.w, layout.h);
    }

    fx.undoShake(ctx);
    fx.drawFront(ctx);           // 彩纸 / 受击星屑：最上层
    if (vigCache) ctx.drawImage(vigCache, 0, 0, viewW, viewH);

    // 倒计时与「暂停中」画在暗角之上，保证任何状态下都读得清
    if (state === STATE.READY && !dbgFreeze) drawReady(now);
    if (state === STATE.PAUSE && !dbgFreeze) drawBanner('暂停中');
  }

  // 蛇身每节在屏幕上的坐标（按 stepAcc/stepMs 做帧间插值，蛇是连续爬而不是一格格跳）
  function snakePoints(t) {
    var pts = [];
    for (var i = 0; i < snake.length; i++) {
      var cur = snake[i];
      var p = prev[Math.min(i, prev.length - 1)] || cur;
      // 穿墙的那一格直接落位，否则插值会让它横穿整个棋盘
      if (Math.abs(p.x - cur.x) > 1 || Math.abs(p.y - cur.y) > 1) p = cur;
      pts.push({
        x: layout.x0 + (p.x + (cur.x - p.x) * t) * layout.tile + layout.tile / 2,
        y: layout.y0 + (p.y + (cur.y - p.y) * t) * layout.tile + layout.tile / 2
      });
    }
    return pts;
  }

  /*
   * 蛇身 = 一条连续的锥形管，不再是 N 个独立方块：
   *   ① 整条路径先 stroke 一层深色底 → 当描边用（1 次 stroke）
   *   ② 再逐段 stroke 渐变色，段宽从 wHead 收到 wTail → 自然的锥形尾巴
   *   ③ 最后单独画头（圆头 + 高光 + 腮红 + 眼睛 + 定时吐舌）
   * 逐段而不是一次 stroke，是为了能做「头粗尾细」的渐变；穿墙那一跨直接跳过不画。
   * 绘制次数约 N+2 次（老设备可控），比之前每节 fill+stroke 的 2N 次还少。
   */
  function drawSnake(now) {
    var t = stepMs > 0 ? stepAcc / stepMs : 1;
    if (t > 1) t = 1;
    if (warped) t = 1;

    var tile = layout.tile;
    var pts = snakePoints(t);
    var n = pts.length;
    var blinking = Date.now() < invUntil && Math.floor(Date.now() / 110) % 2 === 0;
    var grad = blinking ? GRAD_HURT : GRAD;
    var edge = blinking ? '#c46a6a' : '#1f5238';
    var gap = (tile * 1.6) * (tile * 1.6);        // 超过这个距离 = 穿墙，断开

    var wHead = tile * 0.84;
    var wTail = tile * 0.52;
    var border = Math.max(2, tile * 0.11);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    /*
     * 两趟循环：先把**所有**段的描边画完，再画**所有**段的身体。
     * 不能一段一段地「描边 → 身体」交替画：圆头 lineCap 会让后一段的描边
     * 向前一段多探出 (w+border)/2，把前一段刚画好的身体啃掉一块，
     * 蛇身上会出现一格一格的深色缺口。
     * 描边宽度跟着身体一起收细，否则尾巴会变成「细绿线套在粗黑管里」。
     */
    var pass, j, a, b, ddx, ddy, k, w;
    for (pass = 0; pass < 2; pass++) {
      for (j = 0; j < n - 1; j++) {
        a = pts[j]; b = pts[j + 1];
        ddx = b.x - a.x; ddy = b.y - a.y;
        if (ddx * ddx + ddy * ddy > gap) continue;   // 穿墙那一跨不画
        k = n > 1 ? j / (n - 1) : 0;
        w = wHead + (wTail - wHead) * k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (pass === 0) {
          ctx.lineWidth = w + border;
          ctx.strokeStyle = edge;
        } else {
          ctx.lineWidth = w;
          ctx.strokeStyle = grad[Math.min(GRAD_STEPS - 1, Math.floor(k * (GRAD_STEPS - 1)))];
        }
        ctx.stroke();
      }
    }
    if (n === 1) dot(pts[0], (wHead + border) / 2, edge);

    // ③ 头
    drawHead(pts[0], wHead * 0.58 * (1 + headPulse * 0.18), now, blinking);
  }

  function dot(p, r, color) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawHead(p, r, now, blinking) {
    var tile = layout.tile;
    var ex = dir.x, ey = dir.y;

    // 舌头：每 1.9s 伸一次，画在头之前，伸出去的部分才露在外面
    var tt = now % 1900;
    if (tt < 320 && !blinking) {
      var k = tt / 320;
      var ext = Math.sin(k * Math.PI) * r * 1.15;
      var bx = p.x + ex * r * 0.70, by = p.y + ey * r * 0.70;
      var tx = bx + ex * ext, ty = by + ey * ext;
      ctx.strokeStyle = '#e5484d';
      ctx.lineWidth = Math.max(1.5, r * 0.15);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + ex * r * 0.26 - ey * r * 0.16, ty + ey * r * 0.26 + ex * r * 0.16);
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + ex * r * 0.26 + ey * r * 0.16, ty + ey * r * 0.26 - ex * r * 0.16);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = blinking ? '#ffd9d9' : GRAD[0];
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, tile * 0.060);
    ctx.strokeStyle = blinking ? '#c46a6a' : '#1f5238';
    ctx.stroke();

    if (!blinking) {
      // 顶部高光：让头看起来是圆的、有光泽
      ctx.beginPath();
      ctx.arc(p.x - r * 0.24, p.y - r * 0.32, r * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.fill();
    }

    drawFace(p, r, blinking);
  }

  function drawFace(p, r, blinking) {
    var ex = dir.x, ey = dir.y;
    var px = -ey, py = ex;                       // 垂直于前进方向
    var fx = p.x + ex * r * 0.26, fy = p.y + ey * r * 0.26;
    var off = r * 0.40;
    var er = r * 0.27;

    if (!blinking) {
      ctx.fillStyle = 'rgba(255,138,150,0.40)';   // 腮红
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        ctx.beginPath();
        ctx.ellipse(fx + px * off * s2 * 1.18, fy + py * off * s2 * 1.18 + r * 0.26,
                    r * 0.21, r * 0.13, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (var s = -1; s <= 1; s += 2) {
      var ox = fx + px * off * s, oy = fy + py * off * s;
      ctx.beginPath();
      ctx.arc(ox, oy, er, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      var qx = ox + ex * er * 0.28, qy = oy + ey * er * 0.28;
      ctx.beginPath();
      ctx.arc(qx, qy, er * 0.58, 0, Math.PI * 2);
      ctx.fillStyle = blinking ? '#a33' : '#12352a';
      ctx.fill();
      if (!blinking) {
        ctx.beginPath();                          // 瞳孔高光
        ctx.arc(qx - er * 0.24, qy - er * 0.26, er * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill();
      }
    }
  }

  function drawApple(a, now) {
    var cx = cellCx(a.x), cy = cellCy(a.y);
    var r = layout.tile * 0.31 * (1 + Math.sin(now / 220) * 0.07);

    // 外发光：让苹果在草地上「跳」出来，远看一眼就能找到
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(229,72,77,0.12)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(229,72,77,0.12)';
    ctx.fill();

    // 地面投影
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.95, r * 0.78, r * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.12, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e5484d';
    ctx.fill();
    ctx.strokeStyle = '#8f2026';
    ctx.lineWidth = Math.max(1.5, layout.tile * 0.05);
    ctx.stroke();

    // 底部暗面 + 左上高光，让苹果有体积感
    ctx.beginPath();
    ctx.arc(cx + r * 0.26, cy + r * 0.36, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx - r * 0.32, cy - r * 0.22, r * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();

    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = Math.max(2, layout.tile * 0.07);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.85);
    ctx.lineTo(cx, cy - r * 1.45);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx + r * 0.45, cy - r * 1.25, r * 0.38, r * 0.20, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#3fa96b';
    ctx.fill();
  }

  function drawStar(s, now) {
    var cx = cellCx(s.x), cy = cellCy(s.y);
    var left = 1 - (now - s.t0) / STAR_LIFE;
    if (left < 0) left = 0;
    var R = layout.tile * 0.40 * (1 + Math.sin(now / 150) * 0.09);
    var r2 = R * 0.46;

    // 金色光晕（快消失时转成红色，和孩子说「要没了」）
    ctx.beginPath();
    ctx.arc(cx, cy, R * 2.1, 0, Math.PI * 2);
    ctx.fillStyle = left < 0.3 ? 'rgba(229,72,77,0.16)' : 'rgba(255,209,102,0.15)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = left < 0.3 ? 'rgba(229,72,77,0.14)' : 'rgba(255,209,102,0.14)';
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((now / 900) % (Math.PI * 2));
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = (i % 2 === 0 ? R : r2);
      var ang = -Math.PI / 2 + (Math.PI * i) / 5;
      var x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffd166';
    ctx.fill();
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = Math.max(1.5, layout.tile * 0.05);
    ctx.stroke();
    ctx.restore();

    // 剩余时间环：快消失时变红，提示孩子赶紧去吃
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    ctx.strokeStyle = left < 0.3 ? '#e5484d' : '#ffd166';
    ctx.lineWidth = Math.max(2.5, layout.tile * 0.09);
    ctx.stroke();
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var k = 1 - p.age / p.life;
      ctx.globalAlpha = k < 0 ? 0 : k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.5, layout.tile * 0.10 * k), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawReady(now) {
    var left = readyUntil - now;
    if (left <= 0) return;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.fillRect(layout.x0, layout.y0, layout.w, layout.h);

    var seg = READY_DUR / 4;
    var idx = Math.floor((READY_DUR - left) / seg);
    if (idx < 0) idx = 0;
    if (idx > 3) idx = 3;
    if (idx !== lastCountIdx) {
      lastCountIdx = idx;
      audio.sfx(idx >= 3 ? 'go' : 'count');
    }

    var label = ['3', '2', '1', '开始！'][idx];
    var size = Math.round(layout.h * (idx >= 3 ? 0.26 : 0.38));
    ctx.font = 'bold ' + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = idx >= 3 ? '#7ee0b8' : '#ffd166';
    ctx.fillText(label, layout.x0 + layout.w / 2, layout.y0 + layout.h / 2);
  }

  function drawBanner(text) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(layout.x0, layout.y0, layout.w, layout.h);
    ctx.font = 'bold ' + Math.round(layout.h * 0.20) + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#cfe3d6';
    ctx.fillText(text, layout.x0 + layout.w / 2, layout.y0 + layout.h / 2);
  }

  // ============================================================
  //  HUD
  // ============================================================
  function setText(node, v) {
    var s = String(v);
    if (node.textContent !== s) node.textContent = s;   // 只在变化时写 DOM
  }

  function syncHud() {
    setText(el.levelText, level);
    setText(el.scoreText, score);
    setText(el.bestText, best);
    setText(el.lenText, snake.length);
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
    toastTimer = setTimeout(function () { el.toast.classList.add('hidden'); }, 1300);
  }

  // ============================================================
  //  界面切换
  // ============================================================
  var SCREENS = ['startScreen', 'pauseScreen', 'overScreen'];
  var animTimers = {};

  // 重播渐入动画：先摘类 → 强制回流 → 再加类，否则第二次显示时动画不会重播
  function show(id) {
    var e = document.getElementById(id);
    if (!e) return;
    e.classList.remove('hidden');
    e.classList.remove('anim-in');
    void e.offsetWidth;
    e.classList.add('anim-in');

    // 兜底：弱机上 CSS 动画可能长时间停在起始帧，若起始帧是 opacity:0，
    // 用户看到的就是「一张看不见的卡片」= 卡死。动画该结束后把类摘掉。
    if (animTimers[id]) clearTimeout(animTimers[id]);
    animTimers[id] = setTimeout(function () {
      animTimers[id] = null;
      e.classList.remove('anim-in');
    }, 700);
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
    if (window.__tvControlsInjected) {
      var first = box.querySelector('[data-tv-focus]');
      if (first && typeof first.focus === 'function') first.focus();
      return;
    }
    if (window.TVNav) TVNav.init(box);
  }

  function gotoStart() {
    state = STATE.START;
    audio.stopBGM();
    el.hud.classList.add('hidden');
    initRound();
    fx.clear();                    // 清掉上一局残留的彩纸 / 星屑
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
    hideScreens();
    el.hud.classList.remove('hidden');
    state = STATE.READY;
    readyUntil = Date.now() + READY_DUR;
    lastCountIdx = -1;
    stepAcc = 0;
  }

  function pauseGame() {
    if (state !== STATE.PLAY && state !== STATE.READY) return;
    pauseFrom = state;
    state = STATE.PAUSE;
    el.pauseStat.textContent = '第 ' + level + ' 关 · 分数 ' + score + ' · 长度 ' + snake.length;
    show('pauseScreen');
    focusFirst('pauseScreen');
  }

  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    hide('pauseScreen');
    if (pauseFrom === STATE.READY) {
      // 暂停发生在倒计时里：把倒计时整体后移，别一恢复就直接开跑
      readyUntil = Date.now() + READY_DUR;
      lastCountIdx = -1;
      state = STATE.READY;
    } else {
      state = STATE.PLAY;
      stepAcc = 0;
    }
  }

  // ============================================================
  //  输入
  // ============================================================
  TVInput.on('dir', function (d) {
    var nd = DIRV[d];
    if (!nd) return;
    if (state === STATE.PLAY || state === STATE.READY) {
      var last = queue.length ? queue[queue.length - 1] : dir;
      if (nd.x === -last.x && nd.y === -last.y) return;   // 禁止 180 度掉头
      if (nd.x === last.x && nd.y === last.y) return;     // 同向忽略
      if (queue.length < 2) { queue.push(nd); audio.sfx('turn'); }
      return;
    }
    if (window.TVNav && !window.__tvControlsInjected) TVNav.move(d);
  });

  TVInput.on('confirm', function () {
    // 只处理「游戏中 OK = 暂停」。覆盖层里的确认交给 tv-controls / TVNav 激活按钮，
    // 否则会出现「按 OK 继续 → 同一事件冒泡回来 → 又暂停」的死循环（见 GAME_DEV_GUIDE §2）。
    // 注意 TVInput 会对 Enter/Space 做 preventDefault，standalone 下按钮的原生 click 被拦掉了，
    // 所以这里必须显式 TVNav.confirm() 补一次，否则开始按钮按不动。
    if (state === STATE.PLAY) { pauseGame(); return; }
    if (window.TVNav && !window.__tvControlsInjected) TVNav.confirm();
  });

  TVInput.on('back', function () {
    if (state === STATE.PLAY || state === STATE.READY) pauseGame();
    else if (state === STATE.PAUSE) resumeGame();
    else if (state === STATE.OVER) gotoStart();
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
  bindClick('btnReplay', function () { hide('overScreen'); startGame(); });
  bindClick('btnOverQuit', gotoStart);

  window.addEventListener('resize', resize);

  // ============================================================
  //  主循环
  // ============================================================
  var lastT = 0;
  function loop(t) {
    if (!lastT) lastT = t;
    var dt = (t - lastT) / 1000;
    lastT = t;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;      // 切后台回来时不要一口气走很多步

    var now = Date.now();

    fx.update(dt);

    if (state === STATE.READY && now >= readyUntil) {
      state = STATE.PLAY;
      stepAcc = 0;
      lastEatAt = 0;
    }

    if (state === STATE.PLAY && !dbgFreeze) {
      stepAcc += dt * 1000;
      var guard = 0;
      while (stepAcc >= stepMs && state === STATE.PLAY && guard < 4) {
        stepAcc -= stepMs;
        step();
        guard++;
      }
      if (star && now - star.t0 > STAR_LIFE) star = null;
    }

    updateParticles(dt);
    updateFx(dt);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
    if (headPulse > 0) headPulse = Math.max(0, headPulse - dt * 3.6);
    if (levelFlash > 0) levelFlash = Math.max(0, levelFlash - dt * 1.8);

    render(now);
    requestAnimationFrame(loop);
  }

  /*
   * 浏览器返回键陷阱（仅 standalone）。
   * 遥控 BACK 在部分 WebView 里表现为「页面后退」而不是可拦截的 keydown，
   * 所以用 pushState 占位 + popstate 捕获。**每次返回后必须重新占位**，
   * 否则第二次按 BACK 就真的离开游戏了。启动器内不装（由 launcher 统一处理）。
   */
  function setupBackTrap() {
    if (!window.history || !window.history.pushState) return;
    if (window.__tvControlsInjected) return;
    var mark = function () {
      try { window.history.pushState({ sn: 1 }, ''); } catch (e) { /* 某些 WebView 会抛，忽略 */ }
    };
    mark();
    window.addEventListener('popstate', function () {
      if (window.__tvControlsInjected) return;
      mark();
      TVInput.trigger('back');
    });
  }
  if (document.readyState === 'complete') setupBackTrap();
  else window.addEventListener('load', setupBackTrap);

  // ============================================================
  //  启动
  // ============================================================
  loadBest();
  resize();
  gotoStart();
  requestAnimationFrame(loop);

  // 调试钩子：仅当 URL 带 #debug 时把内部状态挂到 window，方便 headless 测试读 / 驱动
  if (window.location && window.location.hash === '#debug') {
    window.__snake = {
      get state() { return state; },
      set state(v) { state = v; },
      get dir() { return dir; },
      get queue() { return queue; },
      get snake() { return snake; },
      get apple() { return apple; },
      get star() { return star; },
      get score() { return score; },
      get stepMs() { return stepMs; },
      get stepAcc() { return stepAcc; },
      get layout() { return layout; },
      setDir: function (x, y) { dir = { x: x, y: y }; queue = []; },
      forceApple: function (x, y) { apple = { x: x, y: y }; },
      startNow: function () {
        state = STATE.PLAY; readyUntil = 0; stepAcc = stepMs; lastCountIdx = 3;
        invUntil = 0;                       // 清掉受伤闪烁，测试里好判断颜色
      },
      setAcc: function (v) { stepAcc = v; },
      freeze: function (v) { dbgFreeze = !!v; },
      // 清掉所有会「污染」像素取色的瞬时效果（飘字 / 圆环 / 金光 / 红闪 / 受伤闪烁）
      clearFx: function () {
        floats = []; rings = []; particles = [];
        levelFlash = 0; flash = 0; headPulse = 0; invUntil = 0;
      },
      step: step,
      // 包一层：外部调用时补 Date.now()，否则 render(undefined) 会让所有
      // 依赖 now 的脉冲/发光算成 NaN，食物直接画不出来
      render: function () { render(Date.now()); }
    };
  }
})();

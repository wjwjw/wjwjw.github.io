/*
 * game.js —— 振翅飞行（flipping-bird）：状态机 + 物理 + 主题搭配 + 输入 + 渲染
 *
 * 玩法：一键拍翅膀（OK / 空格 / ↑ / 点击），躲开上下成对的障碍柱，穿过一根得 1 分。
 * 三套「角色 × 场景」固定配套（飞机·天空 / 乌龟·草丛 / 鲸鱼·海洋）在标题页用方向键选。
 * 场景下标由角色下标直接派生（sceneIndex() === charIndex），没有任何单独改场景的入口，
 * 所以「拆开搭配」在结构上就不可能发生。每套搭配各有自己的最高分存档。
 *
 * 儿童向改造（与严格版 Flappy Bird 的差异）：
 *   ① 三颗心 + 撞击后短暂无敌闪烁，撞一次不会立刻结束；
 *   ② 障碍缺口 176（比经典宽）、判定盒收缩 6px（宽容判定）；
 *   ③ 撞到天花板不致死（贴住后速度为 0），无敌期内触地也贴地站立不下沉；开局有 3-2-1 倒计时；
 *   ④ 速度有上限（280），不会越玩越不可能；
 *   ⑤ 全程下落慢 30%（重力与最大下落速度都按 70% 缩放），更好反应。
 *
 * 为什么适合电视遥控器（STANDARD §4）：只需要 OK 一个键，不需要指针与拖拽；
 * 标题页的搭配选择是普通 button，standalone 用 TVNav、启动器内由 tv-controls 做空间导航，
 * OK 激活焦点按钮。游戏开始后主动 blur 焦点，方向键 / OK 全部交回游戏。
 *
 * 坐标系：固定 960×540 逻辑世界，按 contain 缩放居中（任意视口都不变形、物理恒定）。
 * 时间基准：动画/计时统一用 Date.now()（epoch 毫秒），rAF 时间戳只用来算 dt。
 *
 * 兼容目标：MiTV4A / Android 6 / WebView ≈ Chromium 47 —— 经典脚本 + IIFE，纯 ES5。
 */
(function () {
  'use strict';

  // ---------- 常量 ----------
  var W = 960, H = 540;                 // 逻辑世界（设计基准视口）
  var GROUND_H = 66, GROUND_Y = H - GROUND_H;
  var PLAYER_X = 268, PLAYER_W = 42, PLAYER_H = 30;
  var PIPE_W = 78, GAP_H = 176;
  // 下落全程慢 30%：原基准 1350 / 720 乘 0.7；拍翅膀与免费小弹的向上速度不变。
  var GRAVITY = 945, FLAP_V = -430, MAX_FALL = 504;
  var BASE_SPEED = 190, SPEED_PER_LEVEL = 8, MAX_SPEED = 280;
  var BASE_DIST = 300, DIST_PER_LEVEL = 7, MIN_DIST = 246;
  var LIVES = 3, INV_MS = 1400, READY_DUR = 2400;
  var GROUND_BOUNCE_V = -320, GROUND_GRACE_MS = 800; // 贴地免费小弹：上抛速度与短宽限
  var PAD = 6;                          // 碰撞盒的宽容量
  var STATE = { START: 'start', READY: 'ready', PLAY: 'play', PAUSE: 'pause', OVER: 'over' };

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var preview = document.getElementById('preview');
  var pctx = preview.getContext('2d');

  var audio = new AudioManager();
  var fx = FX.create();
  var T = window.FBThemes;

  var state = STATE.START, pauseFrom = STATE.PLAY;
  var charIndex = 0;   // 唯一的状态源：场景由它派生，见 sceneIndex()
  var score = 0, level = 1, lives = LIVES, passed = 0, best = 0;
  var runStartBest = 0;             // 开局时的旧纪录，供结算判断「本局是否破纪录」
  // groundGrace：'none' 无保护 | 'inv' 扣心后的无敌期 | 'bounce' 免费小弹后的宽限期
  // 只有从 'inv' 结束且仍贴地时才免费弹一次；首次从空中摔下（'none'）照常扣心。
  var player = { y: H * 0.42, vy: 0, flap: 1, invUntil: 0, groundGrace: 'none' };
  var pipes = [];
  var speed = BASE_SPEED, dist = BASE_DIST;
  var readyUntil = 0, lastCountIdx = -1;
  var animT = 0, scrollT = 0;
  var viewW = 0, viewH = 0, dpr = 1, scale = 1, offX = 0, offY = 0;
  var backdrop = null, vig = null, trailOpts = null;
  var dbgFreeze = false;                // 仅 #debug：冻结物理步进

  var el = {};
  ['app', 'hud', 'scoreText', 'levelText', 'bestText', 'livesText', 'comboPill', 'toast',
   'comboText', 'comboBest', 'startBest', 'startScreen', 'pauseScreen', 'overScreen',
   'pauseStat', 'overTitle', 'overScore', 'overPipes', 'overLevel', 'overBest', 'overTip'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  // ============================================================
  //  搭配 & 存档
  // ============================================================
  function charId() { return T.CHARACTERS[charIndex].id; }
  /* 固定配套的核心不变式：场景永远等于「同下标角色对应的场景」。
   * 写成派生函数而不是可写变量，就不存在「角色与场景错配」这种状态。 */
  function sceneIndex() { return charIndex; }
  function sceneId() { return T.SCENES[sceneIndex()].id; }
  function bestKey() { return 'fb-best-' + charId(); }

  function loadBest() {
    var v = 0, i, n;
    try {
      v = parseInt(localStorage.getItem(bestKey()) || '0', 10) || 0;
      // 兼容早期「按角色-场景」分开存档的版本（第二套当时叫 mountain），取历史最高
      var oldScenes = ['sky', 'mountain', 'meadow', 'ocean'];
      for (i = 0; i < oldScenes.length; i++) {
        n = parseInt(localStorage.getItem('fb-best-' + charId() + '-' + oldScenes[i]) || '0', 10) || 0;
        if (n > v) v = n;
      }
    } catch (e) { v = 0; }
    best = v;
    if (v > 0) saveBest();
  }
  function saveBest() {
    try { localStorage.setItem(bestKey(), String(best)); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* 选一套搭配 = 只改 charIndex 一处，场景 / 障碍 / 配色 / 微粒 / 尾迹 / BGM 全部跟着换。 */
  function pickCombo(i, fromUser) {
    if (i < 0 || i >= T.CHARACTERS.length) return;
    charIndex = i;
    if (fromUser) audio.sfx('select');
    applyTheme();
  }

  function applyTheme() {
    var i, list;
    loadBest();
    el.app.className = 'theme-' + sceneId();
    var name = T.name(charIndex, sceneIndex());
    setText(el.comboText, name);
    setText(el.comboPill, name);
    setText(el.comboBest, '最高 ' + best);
    setText(el.startBest, best);
    backdrop = T.buildBackdrop(sceneId(), W, H, Math.min(dpr * scale || 1, 2));
    fx.setAmbient(T.ambient(sceneId(), W, H));
    trailOpts = T.trail(charId());
    list = document.querySelectorAll('#comboRow .pick');
    for (i = 0; i < list.length; i++) {
      if (i === charIndex) list[i].classList.add('sel');
      else list[i].classList.remove('sel');
    }
    drawPreview();
    syncHud();
  }

  // 标题页预览：同一套绘制函数缩到 520×140，切配套立刻看得见
  function drawPreview() {
    var pd = Math.min(dpr || 1, 2);
    // 预览按 CSS 实际高度绘制：矮屏媒体查询会把 #preview 压到 92px，
    // 若仍按 140 的坐标系出图，角色和柱子会被拉长变形。
    var ph = preview.clientHeight || 140;
    if (ph < 60) ph = 140;
    preview.width = Math.round(520 * pd);
    preview.height = Math.round(ph * pd);
    pctx.setTransform(pd, 0, 0, pd, 0, 0);
    pctx.save();
    pctx.scale(1, ph / 140);
    var back = T.buildBackdrop(sceneId(), 520, 140, 1);
    pctx.drawImage(back, 0, 0, 520, 140);
    pctx.fillStyle = sceneId() === 'ocean' ? '#d9b98a'
      : (sceneId() === 'meadow' ? '#5fae63' : '#eaf6ff');
    pctx.fillRect(0, 128, 520, 12);
    T.drawPipe(pctx, sceneId(), 350, 76, 92, 54, 128, animT);
    T.drawCharacter(pctx, charId(), 176, 72, 0, animT, 0.35, false);
    pctx.restore();
  }

  // ============================================================
  //  布局 / 自适应：contain 缩放，世界坐标恒定 960×540
  // ============================================================
  function resize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(viewW / W, viewH / H);
    if (scale <= 0) scale = 1;
    offX = (viewW - W * scale) / 2;
    offY = (viewH - H * scale) / 2;

    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';

    fx.setView(W, H);                 // 全屏闪光画在世界坐标系里
    vig = FX.vignette(W, H, { strength: 0.30 });
    backdrop = T.buildBackdrop(sceneId(), W, H, Math.min(dpr * scale, 2));
    fx.setAmbient(T.ambient(sceneId(), W, H));
    drawPreview();
  }

  function setWorldTransform() {
    // letterbox 区域先按设备像素铺一层底色，再切到世界坐标
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#06121f';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
  }

  // ============================================================
  //  局面
  // ============================================================
  function computeLevel() {
    level = 1 + Math.floor(score / 5);
    speed = Math.min(MAX_SPEED, BASE_SPEED + (level - 1) * SPEED_PER_LEVEL);
    dist = Math.max(MIN_DIST, BASE_DIST - (level - 1) * DIST_PER_LEVEL);
  }

  function spawnPipe(first) {
    var minY = GAP_H / 2 + 70;
    var maxY = GROUND_Y - GAP_H / 2 - 62;
    var prev = pipes.length ? pipes[pipes.length - 1].gapY : H * 0.5;
    var target = minY + Math.random() * (maxY - minY);
    var maxStep = 108;
    if (target > prev + maxStep) target = prev + maxStep;
    if (target < prev - maxStep) target = prev - maxStep;
    if (target < minY) target = minY;
    if (target > maxY) target = maxY;
    var x = first ? W + 110 : pipes[pipes.length - 1].x + dist;
    pipes.push({ x: x, gapY: target, passed: false });
  }

  function initRound() {
    score = 0; level = 1; lives = LIVES; passed = 0;
    runStartBest = best;            // onScore() 会把 best 实时抬到本局分数，旧值必须开局留存
    speed = BASE_SPEED; dist = BASE_DIST;
    player.y = H * 0.42; player.vy = 0; player.flap = 1; player.invUntil = 0;
    player.groundGrace = 'none';
    pipes = [];
    spawnPipe(true);
    fx.clear();
    syncHud();
  }

  function flap() {
    if (state !== STATE.PLAY) return;
    player.vy = FLAP_V;
    player.flap = 0;
    audio.sfx('flap');
    fx.burst(PLAYER_X - 18, player.y + 8, {
      count: 5, colors: ['#ffffff', '#ffd166'], shapes: ['dot'],
      speed: [24, 80], size: [1.6, 3.4], life: [0.2, 0.36], g: 60
    });
  }

  function onScore() {
    var oldLevel = level;
    score++;
    passed++;
    computeLevel();
    audio.sfx('score');
    fx.float(PLAYER_X + 34, player.y - 24, '+1', { color: '#ffd166', size: 26 });
    fx.burst(PLAYER_X + 12, player.y, {
      count: 6, colors: ['#ffffff', '#ffd166'], shapes: ['spark4'],
      speed: [30, 100], size: [3, 6], life: [0.26, 0.44], g: 0
    });
    if (level !== oldLevel) {
      audio.sfx('level');
      fx.confetti({ count: 26, x0: 90, x1: 780, w: W });
      toast('第 ' + level + ' 段 · 稍稍加速', 'good');
    }
    if (score > best) { best = score; saveBest(); }
    syncHud();
  }

  /* 撞一次不掉 gametime，只掉一颗心：无敌期间闪烁 + 把角色挪回安全位置，
   * 让孩子有时间重新看清局势（与 snake 的「撞自己只掉心」是同一套设计）。 */
  function onHit(hitPipe) {
    var now = Date.now();
    if (now < player.invUntil) return;
    lives--;
    audio.sfx('hit');
    fx.flash('#e5484d', 0.28, { alpha: 0.16 });
    fx.shake(7, 0.32);
    fx.burst(PLAYER_X, player.y, {
      count: 14, colors: ['#ff9f9f', '#ffffff'], shapes: ['dot', 'spark'],
      speed: [70, 210], size: [2.5, 5.5], life: [0.35, 0.65], g: 320
    });
    player.vy = -240;
    if (hitPipe) player.y = hitPipe.gapY;
    else player.y = GROUND_Y - 92;
    player.invUntil = now + INV_MS;
    player.groundGrace = 'inv';   // 这段无敌期结束若仍贴地，先免费弹一次而不扣心
    syncHud();
    if (lives <= 0) { gameOver(); return; }
    toast('碰到啦！还剩 ' + lives + ' 颗心', 'warn');
  }

  function gameOver() {
    state = STATE.OVER;
    audio.stopBGM();
    audio.sfx('over');
    /* 先判再存：onScore() 每得一分就把 best 抬到本局分数，结算时再比 score>=best
       会永远成立（追平旧纪录也报「新纪录」）。用开局留存的 runStartBest 判断。 */
    var isBest = score > runStartBest && score > 0;
    if (score > best) { best = score; saveBest(); }
    // 结算文本同步写（不延后），覆盖层才能读到真实数据
    setText(el.overTitle, '这趟飞完啦');
    setText(el.overScore, score);
    setText(el.overPipes, passed);
    setText(el.overLevel, level);
    setText(el.overBest, best);
    el.overTip.textContent = isBest
      ? T.name(charIndex, sceneIndex()) + ' · 新纪录！' : '换个搭配再试一次？';
    hideScreens();
    show('overScreen');
    focusFirst('overScreen');
    syncHud();
  }

  // ============================================================
  //  物理与判定
  // ============================================================
  function update(dt) {
    var i, p, px0, px1, py0, py1, topEnd, botStart;

    if (state === STATE.PLAY) {
      player.vy += GRAVITY * dt;
      if (player.vy > MAX_FALL) player.vy = MAX_FALL;
      player.y += player.vy * dt;

      if (player.y < PLAYER_H / 2 + 8) {       // 撞天花板：夹住，不致死
        player.y = PLAYER_H / 2 + 8;
        if (player.vy < 0) player.vy = 0;
      }

      for (i = pipes.length - 1; i >= 0; i--) {
        pipes[i].x -= speed * dt;
        if (pipes[i].x + PIPE_W < -30) pipes.splice(i, 1);
      }
      if (pipes.length && pipes[pipes.length - 1].x < W - dist) spawnPipe(false);
      if (!pipes.length) spawnPipe(true);

      px0 = PLAYER_X - PLAYER_W / 2 + PAD;
      px1 = PLAYER_X + PLAYER_W / 2 - PAD;
      py0 = player.y - PLAYER_H / 2 + PAD;
      py1 = player.y + PLAYER_H / 2 - PAD;

      for (i = 0; i < pipes.length; i++) {
        p = pipes[i];
        if (!p.passed && p.x + PIPE_W < px0) {
          p.passed = true;
          onScore();
        }
        if (px1 < p.x + 4 || px0 > p.x + PIPE_W - 4) continue;
        topEnd = p.gapY - GAP_H / 2;
        botStart = p.gapY + GAP_H / 2;
        if (Date.now() >= player.invUntil &&
            (py0 < topEnd - PAD || py1 > botStart + PAD)) {
          onHit(p);
          break;
        }
      }
      if (player.y + PLAYER_H / 2 >= GROUND_Y) {
        var nowGround = Date.now();
        if (nowGround < player.invUntil) {
          // 无敌 / 宽限期内贴地站立：不下沉，留出拍翅膀逃生的机会
          player.y = GROUND_Y - PLAYER_H / 2;
          if (player.vy > 0) player.vy = 0;
        } else if (player.groundGrace === 'inv') {
          /* 无敌期刚结束仍贴地：不扣心，免费小弹一次并再给一段短宽限。
             孩子看到提示后有时间拍翅膀；宽限过了还贴地才走正常扣心。 */
          player.groundGrace = 'bounce';
          player.invUntil = nowGround + GROUND_GRACE_MS;
          player.y = GROUND_Y - PLAYER_H / 2 - 2;
          player.vy = GROUND_BOUNCE_V;
          toast('快拍一下翅膀！', 'good');
        } else {
          // 'none'（首次从空中摔下）或 'bounce'（宽限用完仍贴地）：正常扣心
          onHit(null);
        }
      } else if (player.groundGrace === 'inv' && Date.now() >= player.invUntil) {
        /* 无敌期是在「空中」结束的：这次保护已经用掉了，必须清标记。
           否则孩子成功拍翅膀飞走、过了很久再失手落地，也会被误判成
           「无敌刚结束仍贴地」而白得一次免费弹 —— 保护期被无限期携带。 */
        player.groundGrace = 'none';
      }
      scrollT += dt;
    }

    if (player.flap < 1) {
      player.flap += dt * 2.4;
      if (player.flap > 1) player.flap = 1;
    }
  }

  // ============================================================
  //  渲染
  // ============================================================
  function render(now) {
    var i;
    setWorldTransform();

    if (backdrop) ctx.drawImage(backdrop, 0, 0, W, H);
    fx.drawBack(ctx);
    T.drawMotion(ctx, sceneId(), W, H, animT);

    fx.applyShake(ctx);

    for (i = 0; i < pipes.length; i++) {
      T.drawPipe(ctx, sceneId(), pipes[i].x, pipes[i].gapY, GAP_H, PIPE_W, GROUND_Y, animT);
    }
    T.drawGround(ctx, sceneId(), W, GROUND_Y, scrollT);

    var py = player.y;
    if (state === STATE.START || state === STATE.READY) {
      py = H * 0.42 + Math.sin(animT * 2.2) * 9;   // 标题页 / 倒计时：轻轻悬浮
    }
    T.drawCharacter(ctx, charId(), PLAYER_X, py,
      state === STATE.PLAY ? player.vy : 0, animT, player.flap,
      Date.now() < player.invUntil);

    fx.undoShake(ctx);
    fx.drawFront(ctx);
    if (vig) ctx.drawImage(vig, 0, 0, W, H);

    // 倒计时 / 暂停横幅画在暗角之上，任何状态下都读得清
    if (state === STATE.READY) drawReady(now);
    if (state === STATE.PAUSE) drawBanner('暂停中');
  }

  function drawReady(now) {
    var left = readyUntil - now;
    if (left <= 0) return;
    ctx.fillStyle = 'rgba(4, 14, 28, 0.30)';
    ctx.fillRect(0, 0, W, H);
    var seg = READY_DUR / 4;
    var idx = Math.floor((READY_DUR - left) / seg);
    if (idx < 0) idx = 0;
    if (idx > 3) idx = 3;
    if (idx !== lastCountIdx) {
      lastCountIdx = idx;
      audio.sfx(idx >= 3 ? 'go' : 'count');
    }
    centerText(['3', '2', '1', '起飞！'][idx], H * 0.40,
      Math.round(H * (idx >= 3 ? 0.16 : 0.22)), idx >= 3 ? '#7ee0b8' : '#ffd166');
    centerText('按 OK / 空格 / ↑ 拍翅膀', H * 0.62, 22, '#eaf6ff');
  }

  function drawBanner(text) {
    ctx.fillStyle = 'rgba(4, 14, 28, 0.45)';
    ctx.fillRect(0, 0, W, H);
    centerText(text, H * 0.46, Math.round(H * 0.16), '#dceaf7');
  }

  function centerText(text, y, size, color) {
    ctx.font = 'bold ' + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size * 0.12);
    ctx.strokeStyle = 'rgba(4,14,28,0.72)';
    ctx.strokeText(text, W / 2, y);
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, y);
  }

  // ============================================================
  //  HUD / 界面
  // ============================================================
  function setText(node, v) {
    var s = String(v);
    if (node && node.textContent !== s) node.textContent = s;
  }
  function syncHud() {
    setText(el.scoreText, score);
    setText(el.levelText, level);
    setText(el.bestText, best);
    var h = '';
    for (var i = 0; i < LIVES; i++) h += (i < lives ? '♥' : '♡');
    setText(el.livesText, h);
    setText(el.startBest, best);
    setText(el.comboBest, '最高 ' + best);
  }

  var toastTimer = null;
  function toast(text, cls) {
    el.toast.textContent = text;
    el.toast.className = cls ? cls : '';
    el.toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.add('hidden'); }, 1300);
  }

  var SCREENS = ['startScreen', 'pauseScreen', 'overScreen'];
  var animTimers = {};

  function show(id) {
    var e = document.getElementById(id);
    if (!e) return;
    e.classList.remove('hidden');
    e.classList.remove('anim-in');
    void e.offsetWidth;                 // 强制回流，否则第二次显示动画不重播
    e.classList.add('anim-in');
    if (animTimers[id]) clearTimeout(animTimers[id]);
    animTimers[id] = setTimeout(function () {
      animTimers[id] = null;
      e.classList.remove('anim-in');   // 弱机兜底：别停在半透明起始帧
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

  function blurActive() {
    // 游戏进行中把焦点交还 body，避免启动器注入的 tv-controls 抢方向键
    try {
      var ae = document.activeElement;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
    } catch (e) { /* 某些 WebView 不支持，忽略 */ }
  }

  function gotoStart() {
    state = STATE.START;
    audio.stopBGM();
    el.hud.classList.add('hidden');
    initRound();
    applyTheme();
    hideScreens();
    show('startScreen');
    focusFirst('startScreen');
    syncHud();
  }

  function startGame() {
    if (state === STATE.PLAY || state === STATE.READY) return;  // 幂等：避免 OK 与 click 双触发
    audio.resume();
    audio.startBGM(sceneIndex());
    audio.sfx('start');
    initRound();
    hideScreens();
    blurActive();
    el.hud.classList.remove('hidden');
    state = STATE.READY;
    readyUntil = Date.now() + READY_DUR;
    lastCountIdx = -1;
  }

  function pauseGame() {
    if (state !== STATE.PLAY && state !== STATE.READY) return;
    pauseFrom = state;
    state = STATE.PAUSE;
    audio.stopBGM();
    el.pauseStat.textContent = T.name(charIndex, sceneIndex()) +
      ' · 分数 ' + score + ' · 剩 ' + lives + ' 颗心';
    show('pauseScreen');
    focusFirst('pauseScreen');
  }

  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    hide('pauseScreen');
    blurActive();
    audio.resume();
    audio.startBGM(sceneIndex());
    if (pauseFrom === STATE.READY) {
      // 暂停发生在倒计时里：整体后移，别一恢复就开跑
      readyUntil = Date.now() + READY_DUR;
      lastCountIdx = -1;
      state = STATE.READY;
    } else {
      state = STATE.PLAY;
    }
  }

  // ============================================================
  //  输入
  // ============================================================
  function menuDir(d) {
    if (window.TVNav && !window.__tvControlsInjected) TVNav.move(d);
  }
  function menuConfirm() {
    // 启动器内由 tv-controls 激活焦点按钮，这里不重复处理（避免双触发）
    if (window.TVNav && !window.__tvControlsInjected) TVNav.confirm();
  }

  TVInput.on('dir', function (d) {
    if (state === STATE.PLAY) {
      if (d === 'up') flap();       // ↑ / W 也可拍翅膀，照顾不同遥控器习惯
      return;
    }
    if (state === STATE.READY) return;   // 倒计时期间忽略，避免误操作
    menuDir(d);
  });

  TVInput.on('confirm', function () {
    if (state === STATE.PLAY || state === STATE.READY) { flap(); return; }
    menuConfirm();
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
  bindClick('btnRestart', startGame);
  bindClick('btnQuit', gotoStart);
  bindClick('btnReplay', startGame);
  bindClick('btnOverQuit', gotoStart);
  bindClick('btnMute', function () {
    var m = audio.toggleMute();
    setText(document.getElementById('btnMute'), m ? '取消静音' : '声音');
    setText(document.getElementById('btnPauseMute'), m ? '取消静音' : '声音');
  });
  bindClick('btnPauseMute', function () {
    var m = audio.toggleMute();
    setText(document.getElementById('btnMute'), m ? '取消静音' : '声音');
    setText(document.getElementById('btnPauseMute'), m ? '取消静音' : '声音');
  });

  // 选固定搭配的按钮（键盘 OK 走 TVNav / tv-controls 的 click，鼠标也能直接点）
  function bindPicks(rowId, attr, fn) {
    var row = document.getElementById(rowId);
    if (!row || !row.querySelectorAll) return;
    var list = row.querySelectorAll('.pick');
    for (var i = 0; i < list.length; i++) {
      (function (node) {
        node.addEventListener('click', function (ev) {
          ev.preventDefault();
          fn(parseInt(node.getAttribute(attr), 10), true);
        });
      })(list[i]);
    }
  }
  bindPicks('comboRow', 'data-combo', pickCombo);

  // 鼠标 / 触屏：附加操作，不替代键盘（遥控器没有指针）
  function bindFlapSurface(e) {
    if (!e) return;
    e.addEventListener('click', function () { if (state === STATE.PLAY) flap(); }, false);
    e.addEventListener('touchstart', function () { if (state === STATE.PLAY) flap(); }, false);
  }
  bindFlapSurface(canvas);

  window.addEventListener('resize', resize);

  // 切后台 / 失焦自动暂停：计时与 BGM 不在后台继续，恢复由玩家手动操作
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseGame();
  }, false);
  window.addEventListener('blur', pauseGame, false);

  // ============================================================
  //  主循环
  // ============================================================
  var lastT = 0;
  function loop(t) {
    if (!lastT) lastT = t;
    var dt = (t - lastT) / 1000;
    lastT = t;
    if (dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;         // 切后台回来不要一口气飞很远
    var now = Date.now();
    animT += dt;
    fx.update(dt);

    if (state === STATE.READY && now >= readyUntil) state = STATE.PLAY;

    if (state === STATE.PLAY && !dbgFreeze && trailOpts) {
      fx.emit(PLAYER_X - 24, player.y + 4, dt, trailOpts);
    }
    // dbgFreeze 只冻结主循环的自动步进；__fb.step() 仍可按步驱动（测试要精确控制坐标）
    if (!dbgFreeze) update(dt);
    render(now);
    requestAnimationFrame(loop);
  }

  /* 浏览器返回键陷阱（仅 standalone）：每次 popstate 后都要重新占位，
   * 否则第二次按返回就真的离开页面了。启动器内由 launcher 统一处理。 */
  function setupBackTrap() {
    if (!window.history || !window.history.pushState) return;
    if (window.__tvControlsInjected) return;
    var mark = function () {
      try { window.history.pushState({ fb: 1 }, ''); } catch (e) { /* 忽略 */ }
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
  resize();
  loadBest();
  gotoStart();
  requestAnimationFrame(loop);

  // 调试钩子：仅 URL 带 #debug 时挂到 window，供纯 Node 冒烟 / CDP 驱动
  if (window.location && window.location.hash === '#debug') {
    window.__fb = {
      get state() { return state; },
      set state(v) { state = v; },
      get score() { return score; },
      get level() { return level; },
      get lives() { return lives; },
      get passed() { return passed; },
      get best() { return best; },
      get charIndex() { return charIndex; },
      get sceneIndex() { return sceneIndex(); },
      get player() { return player; },
      get pipes() { return pipes; },
      get themeName() { return T.name(charIndex, sceneIndex()); },
      get WORLD() { return { W: W, H: H, GROUND_Y: GROUND_Y, PLAYER_X: PLAYER_X, PIPE_W: PIPE_W, GAP_H: GAP_H }; },
      get gravity() { return GRAVITY; },
      get maxFall() { return MAX_FALL; },
      pickCombo: function (i) { pickCombo(i, false); },
      startNow: function () {
        state = STATE.PLAY; readyUntil = 0; lastCountIdx = 3; player.invUntil = 0;
        player.groundGrace = 'none';
        runStartBest = best;   // 调试钩子绕过 startGame，也要记录开局旧纪录
      },
      forcePipe: function (x, gapY) { pipes = [{ x: x, gapY: gapY, passed: false }]; },
      clearPipes: function () { pipes = []; },
      setPlayerY: function (y) { player.y = y; player.vy = 0; },
      clearInv: function () {
        player.invUntil = 0;
        player.groundGrace = 'none';   // 调试钩子也要保持「无敌期」与保护标记同步
      },
      flap: flap,
      step: function (dt) { update(dt); },
      render: function () { render(Date.now()); },
      freeze: function (v) { dbgFreeze = !!v; },
      pause: pauseGame,
      resume: resumeGame,
      gotoStart: gotoStart
    };
  }
})();

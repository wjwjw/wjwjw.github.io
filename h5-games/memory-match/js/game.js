/*
 * game.js —— 记忆翻牌配对（主状态机 + 玩法 + 输入 + 渲染）
 *
 * 玩法：一屏背面朝上的卡片，先用一小段时间「预览」全部图案，随后全部扣下。
 *       用方向键 / WASD 移动高亮框，OK 翻开卡片；翻开两张图案相同即配对成功
 *       （保留正面并打上绿勾），不同则短暂展示后自动扣回。全部配对即过关。
 *
 * 为什么这类玩法最适合电视遥控器（见 docs/STANDARD.md §4）：
 *   它天然就是「网格 + 时序」，不需要指针、不需要拖拽 —— 方向键在格子间移动，
 *   OK 只作用于「当前格」。翻牌动画本身就是反馈，孩子不需要读任何文字就能玩。
 *
 * 时间基准：本文件所有动画/计时统一用 Date.now()（epoch 毫秒）。
 * 主循环传进来的 rAF 时间戳只用来算 dt。两者混用会出现「动画永远停在起始帧」
 * 的诡异 bug（找不同那款踩过，见 STANDARD §6）。
 *
 * 兼容目标：MiTV4A / Android 6 / WebView ≈ Chromium 47 —— 经典脚本 + IIFE，不用 ES module。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var STATE = { START: 'start', PEEK: 'peek', PLAY: 'play', PAUSE: 'pause', CLEAR: 'clear', OVER: 'over' };
  var state = STATE.START;

  var BEST_KEY = 'memory-match-best';

  var FLIP_DUR = 260;        // 单张卡翻面耗时
  var PEEK_STAGGER = 22;     // 预览结束时逐张扣下的间隔
  var DIR_DEBOUNCE = 110;    // 方向键防抖：老 WebView 的 auto-repeat 会一次连跳多格
  var ASPECT = 1.26;         // 卡片 宽 : 高

  var audio = new AudioManager();

  // TA 特效库（shared/fx.js）：粒子 / 彩纸 / 环境气泡 / 暗角
  var fx = FX.create();
  var bgCache = null;      // 背景预渲染（渐变 + 星屑），每帧只 drawImage
  var backCache = null;    // 牌背预渲染，按当前卡片尺寸生成
  var vigCache = null;     // 暗角

  var best = 0;
  var score = 0;
  var level = 1;
  var combo = 0;
  var moves = 0;
  var matchedPairs = 0;

  var cards = [];            // [{ faceId, up, matched, f, fFrom, fTo, fT0, fDur, matchedT, peekDown }]
  var cols = 0, rows = 0, pairCount = 0;
  var cfg = null;

  var cursor = { c: 0, r: 0 };
  var firstPick = -1;
  var pending = null;        // 未配对的两张：{ a, b, until }
  var peekUntil = 0;

  var timeLeft = 0, timeTotal = 0;
  var lastTickSec = -1;
  var clearTimer = null;     // 过关延时句柄

  var viewW = 0, viewH = 0, dpr = 1;
  var layout = { cw: 0, ch: 0, gapX: 0, gapY: 0, x0: 0, y0: 0 };

  var el = {};
  ['hud', 'levelText', 'pairText', 'totalPairText', 'moveText', 'scoreText', 'bestText',
   'comboText', 'comboPill', 'timeFill', 'toast',
   'startScreen', 'pauseScreen', 'clearScreen', 'overScreen',
   'startBest', 'pauseStat', 'clearTitle', 'clearBonus', 'clearMoves', 'clearScore', 'clearTip',
   'overScore', 'overBest', 'overMoves', 'overTip'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

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
  //  关卡配置
  //   关卡越高：卡片越多 → 预览越短 → 错配翻回越快 → 时间越紧
  //   最高固定 6×4 = 24 张（12 对）。再多在 10-foot 距离下就看不清图案了。
  // ============================================================
  var LEVELS = [
    { cols: 4, rows: 3, peek: 2200, back: 1000 },   // 12 张 / 6 对
    { cols: 4, rows: 4, peek: 2000, back: 950 },    // 16 张 / 8 对
    { cols: 5, rows: 4, peek: 1800, back: 900 },    // 20 张 / 10 对
    { cols: 6, rows: 4, peek: 1600, back: 850 },    // 24 张 / 12 对
    { cols: 6, rows: 4, peek: 1200, back: 780 },
    { cols: 6, rows: 4, peek: 900,  back: 700 }
  ];
  function levelCfg(lv) {
    var i = Math.min(lv, LEVELS.length) - 1;
    var base = LEVELS[i];
    var extra = Math.max(0, lv - LEVELS.length);
    return {
      cols: base.cols,
      rows: base.rows,
      peek: Math.max(600, base.peek - extra * 80),
      back: Math.max(600, base.back - extra * 40),
      time: Math.max(60, 140 - (lv - 1) * 7)
    };
  }

  // ============================================================
  //  发牌
  // ============================================================
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // 从图案库里抽 pairCount 种互不相同的图案，每种两张，再整体打乱
  function buildDeck(pairCount) {
    var pool = [];
    for (var i = 0; i < Faces.count; i++) pool.push(i);
    shuffle(pool);
    var chosen = pool.slice(0, pairCount);
    var deck = [];
    for (var k = 0; k < chosen.length; k++) {
      deck.push(chosen[k]);
      deck.push(chosen[k]);
    }
    return shuffle(deck);
  }

  // ============================================================
  //  翻牌动画
  //   f: 0 = 背面，1 = 正面。翻转过程用「先缩到 0 再展开」模拟，
  //   在 f=0.5 处换面（见 drawCard）。
  // ============================================================
  function easeInOutQuad(p) {
    return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  }
  function flipOf(card, now) {
    if (!card.fDur) return card.f;
    var p = (now - card.fT0) / card.fDur;
    if (p >= 1) { card.f = card.fTo; card.fDur = 0; return card.f; }
    if (p < 0) p = 0;
    return card.fFrom + (card.fTo - card.fFrom) * easeInOutQuad(p);
  }
  function setFlip(card, to, now, dur) {
    var from = flipOf(card, now);
    if (from === to && !card.fDur) return;
    card.fFrom = from;
    card.fTo = to;
    card.fT0 = now;
    card.fDur = dur || FLIP_DUR;
  }

  // ============================================================
  //  布局与自适应
  // ============================================================
  function computeLayout() {
    if (!cols || !rows) return;
    var topPad = Math.min(120, Math.max(76, viewH * 0.16));   // 给 HUD 留位
    var basePad = Math.max(14, viewH * 0.035);
    var bannerReserve = state === STATE.PEEK ? 58 : 0;          // 预览阶段为倒计时条预留位置
    var bottomPad = basePad + bannerReserve;
    var sidePad = Math.max(16, viewW * 0.03);

    var boardW = viewW - sidePad * 2;
    var boardH = viewH - topPad - bottomPad;

    var gapX = Math.max(8, boardW * 0.012);
    var gapY = Math.max(8, boardH * 0.022);

    var byW = (boardW - (cols - 1) * gapX) / cols;
    var byH = (boardH - (rows - 1) * gapY) / rows;
    var cw = Math.min(byW, byH * ASPECT);
    var ch = cw / ASPECT;

    var totalW = cols * cw + (cols - 1) * gapX;
    var totalH = rows * ch + (rows - 1) * gapY;

    layout.cw = cw;
    layout.ch = ch;
    layout.gapX = gapX;
    layout.gapY = gapY;
    layout.x0 = (viewW - totalW) / 2;
    layout.y0 = topPad + (boardH - totalH) / 2;
    layout.boardBottom = layout.y0 + totalH;
    layout.bannerY = layout.boardBottom + 22;  // 文本基线，贴在棋盘下面

    renderCardBack();   // 卡片尺寸随关卡变，牌背缓存要跟着重建
  }

  function resize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';

    computeLayout();
    prerenderStatics();

    // 环境气泡：几粒缓慢上漂的柔光，让夜空背景「活」起来（微粒是运动的，resize 重建不显跳）
    fx.setAmbient({
      count: 12, w: viewW, h: viewH,
      colors: ['#7fb8ff', '#b7d0ff', '#ffffff'],
      glow: 30, size: [4, 11], speed: [6, 16],
      alpha: [0.05, 0.15], core: 0.5
    });
  }

  // ============================================================
  //  TA：预渲染缓存（背景 / 牌背 / 暗角）
  //  原实现每帧 createLinearGradient + 手画星屑，老设备上是无谓的 GC 压力；
  //  预渲染后每帧一次 drawImage，还能顺手把背景画得更讲究。
  // ============================================================
  function prerenderStatics() {
    bgCache = document.createElement('canvas');
    bgCache.width = Math.max(1, Math.round(viewW * dpr));
    bgCache.height = Math.max(1, Math.round(viewH * dpr));
    var g = bgCache.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    var grad = g.createLinearGradient(0, 0, 0, viewH);
    grad.addColorStop(0, '#17253f');
    grad.addColorStop(0.55, '#101827');
    grad.addColorStop(1, '#0a0f18');
    g.fillStyle = grad;
    g.fillRect(0, 0, viewW, viewH);

    // 底部一抹深蓝柔光，避免下半屏死黑；顶部一点冷光呼应 HUD
    var glow = FX.glowSprite('#2c4a86', 280, 0.5);
    g.globalAlpha = 0.4;
    g.drawImage(glow, viewW * 0.5 - 280, viewH - 300, 560, 560);
    g.drawImage(glow, viewW * 0.08 - 200, -220, 400, 400);
    g.globalAlpha = 1;

    // 星屑：固定种子 LCG，resize 重绘位置不跳（同 snake 草地点缀的做法）
    var rnd = FX.lcg(20260912);
    for (var i = 0; i < 46; i++) {
      var x = rnd() * viewW, y = rnd() * viewH * 0.7;
      var r = 0.7 + rnd() * 1.7;
      g.globalAlpha = 0.05 + rnd() * 0.10;
      g.fillStyle = (i % 5 === 0) ? '#bcd4ff' : '#ffffff';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    vigCache = FX.vignette(viewW, viewH, { strength: 0.36 });
  }

  /* 牌背画法（预渲染 + 兜底现画共用）：
   * 渐变底 + 外框 + 内衬线 + 四角星点 + 中央星徽（带柔光）+ 顶部斜向高光。
   * 比原来的「纯色块 + 菱形」多五层细节，但只画一次。 */
  function paintCardBack(g, x, y, w, h, radius) {
    var base = g.createLinearGradient(0, y, 0, y + h);
    base.addColorStop(0, '#3d5588');
    base.addColorStop(0.5, '#2e4069');
    base.addColorStop(1, '#25345a');
    Faces.roundRect(g, x, y, w, h, radius);
    g.fillStyle = base;
    g.fill();

    // 顶部斜向高光：像一层覆膜反光，卡片立刻有了「材质」
    g.save();
    Faces.roundRect(g, x, y, w, h, radius);
    g.clip();
    var sheen = g.createLinearGradient(x, y, x + w * 0.7, y + h * 0.8);
    sheen.addColorStop(0, 'rgba(255,255,255,0.14)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.03)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(x, y, w, h);
    g.restore();

    // 外框 + 内衬线
    Faces.roundRect(g, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(2, radius - 1.5));
    g.strokeStyle = 'rgba(158,190,240,0.75)';
    g.lineWidth = 2;
    g.stroke();
    var inset = Math.max(5, Math.min(w, h) * 0.075);
    Faces.roundRect(g, x + inset, y + inset, w - inset * 2, h - inset * 2,
                    Math.max(3, radius - inset * 0.6));
    g.strokeStyle = 'rgba(150,180,230,0.30)';
    g.lineWidth = 1.5;
    g.stroke();

    // 四角小星点
    var cd = Math.max(2.5, Math.min(w, h) * 0.030);
    var cs = Math.max(5, Math.min(w, h) * 0.075);
    g.fillStyle = 'rgba(173,200,244,0.55)';
    var corners = [
      [x + inset + cs, y + inset + cs],
      [x + w - inset - cs, y + inset + cs],
      [x + inset + cs, y + h - inset - cs],
      [x + w - inset - cs, y + h - inset - cs]
    ];
    for (var i = 0; i < corners.length; i++) {
      FX.pathStar(g, corners[i][0], corners[i][1], cd, cd * 0.45, Math.PI / 4);
      g.fill();
    }

    // 中央星徽：柔光 + 双层星
    var cx = x + w / 2, cy = y + h / 2;
    var R = Math.min(w, h) * 0.185;
    var spr = FX.glowSprite('#7fb8ff', R * 2.1, 0.35);
    g.globalAlpha = 0.55;
    g.drawImage(spr, cx - R * 2.1, cy - R * 2.1, R * 4.2, R * 4.2);
    g.globalAlpha = 1;
    FX.pathStar(g, cx, cy, R, R * 0.47);
    g.fillStyle = '#6f8fc9';
    g.fill();
    g.strokeStyle = 'rgba(219,231,255,0.85)';
    g.lineWidth = Math.max(1.5, R * 0.10);
    g.stroke();
    FX.pathStar(g, cx, cy, R * 0.52, R * 0.24);
    g.fillStyle = '#a9c4f2';
    g.fill();
  }

  function renderCardBack() {
    if (!layout.cw || !layout.ch) { backCache = null; return; }
    backCache = document.createElement('canvas');
    backCache.width = Math.max(2, Math.round(layout.cw * dpr));
    backCache.height = Math.max(2, Math.round(layout.ch * dpr));
    var g = backCache.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintCardBack(g, 0, 0, layout.cw, layout.ch,
                  Math.max(6, Math.min(layout.cw, layout.ch) * 0.12));
  }

  function cardPos(i) {
    return {
      x: layout.x0 + (i % cols) * (layout.cw + layout.gapX),
      y: layout.y0 + Math.floor(i / cols) * (layout.ch + layout.gapY)
    };
  }

  // ============================================================
  //  界面切换
  // ============================================================
  var SCREENS = ['startScreen', 'pauseScreen', 'clearScreen', 'overScreen'];
  var animTimers = {};

  // 显示覆盖层时重播一次渐入动画：先摘类 → 强制回流 → 再加类，
  // 否则同一个元素第二次显示时动画不会重播。
  function show(id) {
    var e = document.getElementById(id);
    if (!e) return;
    e.classList.remove('hidden');
    e.classList.remove('anim-in');
    void e.offsetWidth;
    e.classList.add('anim-in');

    // 兜底：老设备上主线程被绘制循环占满时 CSS 动画可能长时间停在起始帧，
    // 若起始帧是 opacity:0，用户看到的就是「一张看不见的卡片」= 卡死。
    // 动画该结束之后把类摘掉，元素回落到完全可见的基础样式。
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

  // 启动器内焦点由注入的 tv-controls.js 接管，两者不要同时强控同一焦点。
  // 但 tv-controls 的自动聚焦依赖「覆盖层可见」判定（它把 opacity:0 视为不可见），
  // 这里补一次聚焦兜底，保证暂停 / 过关界面一出现 OK 键立刻可用。
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

  // ============================================================
  //  HUD
  // ============================================================
  function updateHud() {
    el.levelText.textContent = level;
    el.pairText.textContent = matchedPairs;
    el.totalPairText.textContent = pairCount;
    el.moveText.textContent = moves;
    el.scoreText.textContent = score;
    el.bestText.textContent = best;
    el.comboText.textContent = Math.max(1, combo);
    if (combo > 1) el.comboPill.classList.remove('off');
    else el.comboPill.classList.add('off');
  }

  var toastTimer = null;
  function toast(msg, kind) {
    el.toast.textContent = msg;
    el.toast.className = kind || '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = 'hidden'; }, 900);
  }

  var lastBarSync = 0;
  function syncTimeBar(force) {
    var now = Date.now();
    if (!force && now - lastBarSync < 120) return;
    lastBarSync = now;
    var pct = timeTotal > 0 ? timeLeft / timeTotal : 0;
    if (pct < 0) pct = 0;
    if (pct > 1) pct = 1;
    // 只在值真的变了才写 DOM：属性写入会触发 tv-controls.js 的 MutationObserver，
    // 它每次都会重扫全量可聚焦元素，每秒写八次纯属浪费。
    var w = (pct * 100).toFixed(1) + '%';
    if (el.timeFill.style.width !== w) el.timeFill.style.width = w;
    var cls = pct < 0.18 ? 'danger' : (pct < 0.4 ? 'warn' : '');
    if (el.timeFill.className !== cls) el.timeFill.className = cls;
  }

  // ============================================================
  //  关卡流程
  // ============================================================
  function cancelClear() {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  }

  function startLevel(lv) {
    cancelClear();
    level = lv;
    cfg = levelCfg(lv);
    cols = cfg.cols;
    rows = cfg.rows;
    pairCount = (cols * rows) / 2;

    var deck = buildDeck(pairCount);
    cards = [];
    for (var i = 0; i < deck.length; i++) {
      cards.push({
        faceId: deck[i], up: false, matched: false,
        f: 1, fFrom: 1, fTo: 1, fT0: 0, fDur: 0,
        matchedT: 0, peekDown: false
      });
    }

    moves = 0;
    matchedPairs = 0;
    combo = 0;
    firstPick = -1;
    pending = null;
    lastTickSec = -1;
    timeTotal = cfg.time;
    timeLeft = timeTotal;
    fx.clear();

    cursor.c = Math.floor(cols / 2);
    cursor.r = Math.floor(rows / 2);

    computeLayout();

    state = STATE.PEEK;
    peekUntil = Date.now() + cfg.peek;
    hideScreens();
    show('hud');
    updateHud();
    syncTimeBar(true);
    audio.resume();
    audio.sfx('start');
    audio.sfx('peek');
    audio.startBGM();
  }

  var pausedFrom = STATE.PLAY;   // 从哪个状态暂停的（PLAY 或 PEEK）
  var pauseStart = 0;

  function pauseGame() {
    if (state !== STATE.PLAY && state !== STATE.PEEK) return;
    pausedFrom = state;
    pauseStart = Date.now();
    state = STATE.PAUSE;
    audio.stopBGM();
    el.pauseStat.textContent = '第 ' + level + ' 关 · 已配对 ' + matchedPairs + '/' + pairCount +
      ' · 剩余 ' + Math.ceil(timeLeft) + ' 秒';
    show('pauseScreen');
    focusFirst('pauseScreen');
  }

  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    // 预览阶段暂停的话，把预览剩余时间整体后移；否则恢复后会直接跳到 PLAY，
    // 牌还全部摊在正面 —— 等于白送答案。
    if (pausedFrom === STATE.PEEK) peekUntil += Date.now() - pauseStart;
    state = pausedFrom;
    hide('pauseScreen');
    audio.resume();
    audio.startBGM();
  }

  function levelClear() {
    cancelClear();
    if (state === STATE.CLEAR) return;
    state = STATE.CLEAR;
    audio.stopBGM();
    audio.sfx('clear');

    var bonus = Math.round(timeLeft) * 8;
    score += bonus;
    if (score > best) { best = score; saveBest(); }

    el.clearTitle.textContent = '第 ' + level + ' 关 · 全部配对！';
    el.clearBonus.textContent = bonus;
    el.clearMoves.textContent = moves;
    el.clearScore.textContent = score;
    el.clearTip.textContent = level >= 4
      ? '记忆力不错！下一关卡片更多、预览时间更短。'
      : '干得漂亮，下一关的卡片会多几张。';

    updateHud();
    hide('hud');
    show('clearScreen');
    focusFirst('clearScreen');
  }

  function gameOver() {
    cancelClear();
    state = STATE.OVER;
    audio.stopBGM();
    audio.sfx('over');
    if (score > best) { best = score; saveBest(); }

    el.overScore.textContent = score;
    el.overBest.textContent = best;
    el.overMoves.textContent = moves;
    el.overTip.textContent = '第 ' + level + ' 关还剩 ' + (pairCount - matchedPairs) + ' 对没配上。';

    hide('hud');
    show('overScreen');
    focusFirst('overScreen');
  }

  function gotoStart() {
    cancelClear();
    state = STATE.START;
    audio.stopBGM();
    hideScreens();
    hide('hud');
    cards = [];
    pending = null;
    firstPick = -1;
    fx.clear();                        // 清掉上一局的彩纸 / 粒子
    el.startBest.textContent = best;
    show('startScreen');
    focusFirst('startScreen');
  }

  // ============================================================
  //  玩法核心
  // ============================================================
  function idxOf(c, r) { return r * cols + c; }
  function isLocked(now) {
    if (state !== STATE.PLAY) return true;
    if (pending) return true;
    return false;
  }

  function moveCursor(dir) {
    if (state !== STATE.PLAY || pending) return;
    var now = Date.now();
    if (now - moveCursor.last < DIR_DEBOUNCE) return;
    moveCursor.last = now;

    var c = cursor.c, r = cursor.r;
    if (dir === 'left') c--;
    else if (dir === 'right') c++;
    else if (dir === 'up') r--;
    else if (dir === 'down') r++;

    if (c < 0) c = 0;
    if (c > cols - 1) c = cols - 1;
    if (r < 0) r = 0;
    if (r > rows - 1) r = rows - 1;

    cursor.c = c;
    cursor.r = r;
  }
  moveCursor.last = 0;

  function tryFlip() {
    var now = Date.now();
    if (isLocked(now)) return;
    var i = idxOf(cursor.c, cursor.r);
    var card = cards[i];
    if (!card) return;

    if (card.matched || card.up) { audio.sfx('nope'); return; }

    card.up = true;
    setFlip(card, 1, now, FLIP_DUR);
    audio.sfx('flip');

    if (firstPick < 0) { firstPick = i; return; }

    // 第二张：判定
    var a = firstPick;
    var b = i;
    moves++;

    if (cards[a].faceId === cards[b].faceId) {
      // 配对成功：两张都保留正面 + 绿勾，短暂呼吸一下
      cards[a].matched = true;
      cards[b].matched = true;
      cards[a].matchedT = now;
      cards[b].matchedT = now;
      matchedPairs++;
      combo++;
      firstPick = -1;

      var gain = 100 + (combo - 1) * 25;
      score += gain;
      timeLeft = Math.min(timeTotal, timeLeft + 2);   // 配对奖励 2 秒

      // TA：配对爆点 —— 图案色的星粒从两张牌喷出 + 同色扩散环 + 飘分
      var pa = cardPos(a), pb = cardPos(b);
      var acx = pa.x + layout.cw / 2, acy = pa.y + layout.ch / 2;
      var bcx = pb.x + layout.cw / 2, bcy = pb.y + layout.ch / 2;
      var faceColor = Faces.list[cards[a].faceId].color;
      var burstOpts = {
        count: combo > 1 ? 18 : 12,
        colors: [faceColor, '#ffd166', '#ffffff'],
        shapes: ['star', 'dot'],
        speed: [70, 220], size: [2.5, 6.5], life: [0.5, 0.95], g: 260
      };
      fx.burst(acx, acy, burstOpts);
      fx.burst(bcx, bcy, burstOpts);
      fx.ring(acx, acy, { color: faceColor, r1: layout.cw * 0.5, lw: 4 });
      fx.ring(bcx, bcy, { color: faceColor, r1: layout.cw * 0.5, lw: 4 });
      fx.float((acx + bcx) / 2, Math.min(acy, bcy) - layout.ch * 0.18,
               '+' + gain, { color: '#ffd166', size: Math.max(18, layout.ch * 0.24) });

      audio.sfx('match');
      toast('配对成功  +' + gain + (combo > 1 ? '   连击 x' + combo : ''), 'good');
      updateHud();
      syncTimeBar(true);

      if (matchedPairs >= pairCount) {
        // 全部配对：不要「啪」地弹结算卡片，先来一段彩纸雨让孩子爽一下。
        // 用 pending.finish 同时达到三个目的：锁住输入 + 冻结计时 + 拖 1.6s 再弹结算。
        fx.confetti({ count: 90, x0: 0, x1: viewW, w: viewW });
        pending = { a: -1, b: -1, until: now + 1600, finish: true };
      }
    } else {
      combo = 0;
      score = Math.max(0, score - 10);
      audio.sfx('miss');
      pending = { a: a, b: b, until: now + cfg.back, finish: false };
      updateHud();
    }
  }

  // 收尾 / 错配的延时处理
  function updatePending(now) {
    if (!pending) return;
    if (now < pending.until) return;

    if (pending.finish) {
      pending = null;
      levelClear();
      return;
    }
    setFlip(cards[pending.a], 0, now, FLIP_DUR);
    setFlip(cards[pending.b], 0, now, FLIP_DUR);
    cards[pending.a].up = false;
    cards[pending.b].up = false;
    pending = null;
    firstPick = -1;
  }

  // 预览阶段：到点后逐张扣下；全部扣完才解锁输入
  function updatePeek(now) {
    if (state !== STATE.PEEK) return;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].peekDown) continue;
      if (now >= peekUntil + i * PEEK_STAGGER) {
        cards[i].peekDown = true;
        setFlip(cards[i], 0, now, 240);
      }
    }
    if (now >= peekUntil + cards.length * PEEK_STAGGER + 300) {
      state = STATE.PLAY;      // 全部扣下才解锁输入
    }
  }

  // ============================================================
  //  输入
  // ============================================================
  var lastBackT = 0;
  function onBack() {
    var now = Date.now();
    if (now - lastBackT < 400) return;
    lastBackT = now;

    if (state === STATE.PLAY || state === STATE.PEEK) pauseGame();
    else if (state === STATE.PAUSE) resumeGame();
    else if (state === STATE.CLEAR || state === STATE.OVER) gotoStart();
  }

  var TVInput = window.TVInput;
  if (TVInput) {
    TVInput.on('dir', function (d) {
      if (state === STATE.PLAY && !pending) { moveCursor(d); return; }
      if (window.TVNav && !window.__tvControlsInjected) TVNav.move(d);
    });
    TVInput.on('confirm', function () {
      if (state === STATE.PEEK) { peekUntil = Date.now(); return; }   // OK 跳过预览
      if (state === STATE.PLAY) { tryFlip(); return; }
      if (window.TVNav && !window.__tvControlsInjected) TVNav.confirm();
    });
    TVInput.on('back', onBack);
  }

  // 鼠标 / 触屏：点哪翻哪（作为遥控之外的附加操作，不是唯一玩法）
  canvas.addEventListener('click', function (e) {
    if (state === STATE.PEEK) { peekUntil = Date.now(); return; }
    if (state !== STATE.PLAY || pending) return;
    var rect = canvas.getBoundingClientRect();
    var px = (e.clientX - rect.left) / rect.width * viewW;
    var py = (e.clientY - rect.top) / rect.height * viewH;

    for (var i = 0; i < cards.length; i++) {
      var p = cardPos(i);
      if (px >= p.x && px <= p.x + layout.cw && py >= p.y && py <= p.y + layout.ch) {
        cursor.c = i % cols;
        cursor.r = Math.floor(i / cols);
        tryFlip();
        return;
      }
    }
  });

  // ============================================================
  //  渲染
  // ============================================================
  function drawBackground() {
    if (bgCache) { ctx.drawImage(bgCache, 0, 0, viewW, viewH); return; }
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(0, 0, viewW, viewH);
  }

  function drawCardBack(x, y, w, h, radius) {
    if (backCache && Math.abs(w - layout.cw) < 0.5 && Math.abs(h - layout.ch) < 0.5) {
      ctx.drawImage(backCache, x, y, w, h);
      return;
    }
    paintCardBack(ctx, x, y, w, h, radius);   // 尺寸对不上时现画兜底
  }

  function drawCardFace(card, x, y, w, h, radius) {
    var face = Faces.list[card.faceId];

    Faces.roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = Faces.FACE_PLATE;
    ctx.fill();

    Faces.roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(2, radius - 2));
    ctx.strokeStyle = face.color;
    ctx.lineWidth = 3;
    ctx.stroke();

    Faces.paint(ctx, face, x + w / 2, y + h / 2, Math.min(w, h) * 0.30);
  }

  function drawMatchedMark(card, x, y, w, h, radius, now) {
    // 半透明暗色压一层：配好的卡明显「退到后面去」，和还扣着的卡区分开
    Faces.roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = 'rgba(12,26,22,0.34)';
    ctx.fill();

    // 刚配对成功时闪一下
    var since = now - card.matchedT;
    var flash = since < 420 ? (1 - since / 420) : 0;
    ctx.save();
    ctx.globalAlpha = 0.85 + 0.15 * (flash ? flash : 0);
    Faces.roundRect(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(2, radius - 2));
    ctx.strokeStyle = '#3ED598';
    ctx.lineWidth = 3 + flash * 4;
    ctx.stroke();
    ctx.restore();

    // 绿勾
    var cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h);
    ctx.strokeStyle = '#3ED598';
    ctx.lineWidth = Math.max(3, s * 0.09);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.30, cy + s * 0.02);
    ctx.lineTo(cx - s * 0.07, cy + s * 0.24);
    ctx.lineTo(cx + s * 0.32, cy - s * 0.26);
    ctx.stroke();
  }

  function drawBoard(now) {
    var radius = Math.max(6, Math.min(layout.cw, layout.ch) * 0.12);

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var p = cardPos(i);
      var f = flipOf(card, now);
      var sx = Math.abs(Math.cos(Math.PI * f));
      if (sx < 0.03) sx = 0.03;

      // 卡片投影：一次 fill 换来「浮在桌面上」的层次；随翻面收窄，不会穿帮
      ctx.globalAlpha = 0.30 * (0.4 + 0.6 * sx);
      Faces.roundRect(ctx, p.x - 1, p.y + 5, layout.cw, layout.ch, radius);
      ctx.fillStyle = '#04070d';
      ctx.fill();
      ctx.globalAlpha = 1;

      var sel = (state === STATE.PLAY && cursor.c === (i % cols) &&
                 cursor.r === Math.floor(i / cols));

      // 选中的卡片轻微放大，10-foot 距离下更容易锁定
      var scale = sel ? 1.045 : 1;

      ctx.save();
      ctx.translate(p.x + layout.cw / 2, p.y + layout.ch / 2);
      ctx.scale(sx * scale, scale);
      ctx.translate(-layout.cw / 2, -layout.ch / 2);

      if (f > 0.5) drawCardFace(card, 0, 0, layout.cw, layout.ch, radius);
      else drawCardBack(0, 0, layout.cw, layout.ch, radius);

      if (card.matched) drawMatchedMark(card, 0, 0, layout.cw, layout.ch, radius, now);

      ctx.restore();

      // 选中框画在缩放之外，翻牌时不会被压扁
      if (sel) {
        ctx.save();
        var pulse = 0.72 + 0.28 * Math.sin(now / 260);
        Faces.roundRect(ctx, p.x - 5, p.y - 5, layout.cw + 10, layout.ch + 10, radius + 5);
        ctx.strokeStyle = 'rgba(255,209,102,' + (0.30 * pulse).toFixed(3) + ')';
        ctx.lineWidth = 11;
        ctx.stroke();
        Faces.roundRect(ctx, p.x - 5, p.y - 5, layout.cw + 10, layout.ch + 10, radius + 5);
        ctx.strokeStyle = '#FFD166';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawPeekBanner(now) {
    var left = peekUntil - now;
    if (left < 0) left = 0;
    var total = cfg ? cfg.peek : 1;
    var pct = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;

    var bw = Math.min(viewW * 0.46, 460);
    var bh = 14;
    var by = layout.bannerY + 18;
    var bx = (viewW - bw) / 2;

    var fs = Math.max(15, Math.min(24, viewW * 0.021));
    ctx.font = 'bold ' + fs + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,209,102,0.95)';
    ctx.fillText('记住它们的位置！', viewW / 2, layout.bannerY);

    Faces.roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(28,34,48,0.9)';
    ctx.fill();
    if (pct > 0.001) {
      Faces.roundRect(ctx, bx + 2, by + 2, Math.max(4, (bw - 4) * pct), bh - 4, (bh - 4) / 2);
      ctx.fillStyle = '#FFD166';
      ctx.fill();
    }
  }

  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();
    fx.drawBack(ctx);                        // 环境气泡：卡片之下

    if (cards.length) {
      drawBoard(now);
      if (state === STATE.PEEK) drawPeekBanner(now);
    }

    fx.drawFront(ctx);                       // 粒子 / 彩纸 / 飘字：最上层
    if (vigCache) ctx.drawImage(vigCache, 0, 0, viewW, viewH);
  }

  // ============================================================
  //  主循环
  // ============================================================
  var lastT = 0;
  function loop(t) {
    if (!lastT) lastT = t;
    var dt = (t - lastT) / 1000;
    lastT = t;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;      // 切后台回来时不要一口气扣掉大量时间

    var now = Date.now();

    fx.update(dt);

    if (state === STATE.PEEK) updatePeek(now);
    if (pending) updatePending(now);

    if (state === STATE.PLAY && !pending) {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        syncTimeBar(true);
        gameOver();
      } else {
        syncTimeBar(false);
        if (timeLeft <= 10) {
          var s = Math.ceil(timeLeft);
          if (s !== lastTickSec) { lastTickSec = s; audio.sfx('tick'); }
        }
      }
    }

    render(now);
    requestAnimationFrame(loop);
  }

  // ============================================================
  //  按钮绑定
  // ============================================================
  function bindClick(id, fn) {
    var e = document.getElementById(id);
    if (e) e.addEventListener('click', function (ev) { ev.preventDefault(); fn(); });
  }

  bindClick('btnStart', function () { score = 0; startLevel(1); });
  bindClick('btnResume', resumeGame);
  bindClick('btnRestart', function () { startLevel(level); });
  bindClick('btnMute', function () {
    var m = audio.toggleMute();
    document.getElementById('btnMute').textContent = m ? '取消静音' : '声音';
  });
  bindClick('btnQuit', gotoStart);
  bindClick('btnNext', function () { startLevel(level + 1); });
  bindClick('btnClearQuit', gotoStart);
  bindClick('btnReplay', function () { score = 0; startLevel(1); });
  bindClick('btnOverQuit', gotoStart);

  window.addEventListener('resize', resize);

  /*
   * 浏览器返回键陷阱（仅 standalone）。
   *
   * 遥控 BACK 在部分 WebView 里表现为「页面后退」而不是可拦截的 keydown，
   * 所以用 pushState 占位 + popstate 捕获。**每次返回后必须重新占位**，
   * 否则第二次按 BACK 就真的离开游戏了（找不同那款最初就栽在这里）。
   *
   * 在 TV 启动器内不装：启动器把返回键交给原生层统一处理，装了会抢键。
   * tv-controls.js 是在 iframe load 之后才注入的，所以要等 load 之后再判断，
   * 并在 popstate 里再兜底判断一次。（见 docs/STANDARD.md §4）
   */
  function setupBackTrap() {
    if (!window.history || !window.history.pushState) return;
    if (window.__tvControlsInjected) return;    // 启动器内由 launcher 统一处理
    var mark = function () {
      try { window.history.pushState({ mm: 1 }, ''); } catch (e) { /* 某些 WebView 会抛，忽略 */ }
    };
    mark();
    window.addEventListener('popstate', function () {
      if (window.__tvControlsInjected) return;  // 注入可能晚于本脚本，这里再兜底一次
      mark();
      onBack();
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
})();

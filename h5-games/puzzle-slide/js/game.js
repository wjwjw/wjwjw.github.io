/*
 * game.js —— 滑动拼图（主状态机 + 输入 + 渲染）
 *
 * 玩法：一整张画切成 N×N 块打乱，用方向键把方块推回原位。
 *       **方向键 = 方块滑动的方向**（按「右」→ 空格左边的那块向右滑），
 *       这是低龄玩家最容易建立的心智模型（见 js/puzzle.js 头部说明）。
 *       按 OK 可以再看一眼原图；返回键暂停。
 *
 * 为什么适合遥控器：棋盘本身就是 N×N 网格，方向键天然对应，
 * 一次按键走一步，**完全不需要指针**（见 ../docs/STANDARD.md §4）。
 *
 * 时间基准：所有动画/计时统一用 Date.now()（epoch 毫秒），
 * 主循环传进来的 rAF 时间戳只用来算 dt，两者不混用（STANDARD §6）。
 *
 * 兼容目标：MiTV4A / Android 6 / WebView ≈ Chromium 47 —— 经典脚本 + IIFE，不用 ES module。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var STATE = { START: 'start', PEEK: 'peek', PLAY: 'play', PAUSE: 'pause', CLEAR: 'clear', OVER: 'over' };
  var state = STATE.START;

  var BEST_KEY = 'puzzle-slide-best';

  var ANIM_MS = 130;         // 方块滑动动画时长
  var DIR_DEBOUNCE = 90;     // 老 WebView 的 auto-repeat 会一次连发好几下
  var SHAKE_MS = 200;        // 滑不动时抖一下
  var PEEK_FIRST = 2200;     // 开局先看原图多久
  var PEEK_AGAIN = 1600;     // 游戏中按 OK 偷看多久

  var audio = new AudioManager();

  var best = 0;
  var score = 0;
  var level = 1;
  var moves = 0;

  var n = 3;
  var board = [];
  var sceneId = 'house';

  var anim = null;           // {to, fromR, fromC, toR, toC, start}
  var shakeT = 0;
  var snapT = 0, snapIdx = -1;

  var timeLeft = 0, timeTotal = 0;
  var lastTickSec = -1;

  var peekUntil = 0;
  var peekFrom = STATE.PLAY;

  var viewW = 0, viewH = 0, dpr = 1;
  var L = { bx: 0, by: 0, size: 0, tile: 0, m: 0, rx: 0, ry: 0, rsize: 0, hintY: 0 };

  var pic = null;            // 离屏整图（预渲染一次，运行时只做切片 drawImage）
  var picScale = 1;

  var el = {};
  ['hud', 'levelText', 'moveText', 'sizeText', 'sceneText', 'scoreText', 'bestText', 'timeFill',
   'startScreen', 'pauseScreen', 'clearScreen', 'overScreen',
   'startBest', 'pauseStat', 'clearTitle', 'clearMoves', 'clearBonus', 'clearScore', 'clearTip',
   'overMoves', 'overScore', 'overBest', 'overTip'].forEach(function (id) {
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
  //  布局与自适应
  // ============================================================
  function computeLayout() {
    var topPad = Math.min(118, Math.max(74, viewH * 0.155));
    var bottomPad = Math.max(34, viewH * 0.075);        // 底部一行操作提示
    var sidePad = Math.max(16, viewW * 0.03);

    var availW = viewW - sidePad * 2;
    var availH = viewH - topPad - bottomPad;

    // 棋盘 + 右侧缩略图一起居中。缩略图常驻，孩子随时能对照目标。
    var refRatio = 0.30, gapRatio = 0.07;
    var size = Math.min(availH, availW / (1 + gapRatio + refRatio));
    if (size < 80) size = 80;
    size = Math.floor(size);

    var rsize = Math.round(size * refRatio);
    var gap = Math.round(size * gapRatio);
    var totalW = size + gap + rsize;

    L.size = size;
    L.tile = size / n;
    L.m = Math.max(2, L.tile * 0.03);          // 块与块之间的缝
    L.bx = Math.round(sidePad + (availW - totalW) / 2);
    L.by = Math.round(topPad + (availH - size) / 2);
    L.rsize = rsize;
    L.rx = Math.round(L.bx + size + gap);
    L.ry = L.by;
    L.hintY = Math.min(viewH - 10, L.by + size + Math.max(20, viewH * 0.045));
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
    buildPicture();
  }

  // 整张画预渲染到离屏 canvas。切片时只做 drawImage，老设备上才跑得动。
  function buildPicture() {
    picScale = Math.min(dpr, 2);
    var px = Math.round(L.size * picScale);
    if (px > 1200) px = 1200;
    if (!pic) pic = document.createElement('canvas');
    pic.width = px;
    pic.height = px;
    var pctx = pic.getContext('2d');
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, px, px);
    Art.paintScene(pctx, sceneId, px);
  }

  function cellPos(i) {
    var r = Math.floor(i / n), c = i % n;
    return { x: L.bx + c * L.tile, y: L.by + r * L.tile };
  }

  // ============================================================
  //  界面切换
  // ============================================================
  var SCREENS = ['startScreen', 'pauseScreen', 'clearScreen', 'overScreen'];
  var animTimers = {};

  function show(id) {
    var e = document.getElementById(id);
    if (!e) return;
    e.classList.remove('hidden');
    e.classList.remove('anim-in');
    void e.offsetWidth;
    e.classList.add('anim-in');

    // 兜底：老设备上 CSS 动画可能被 rAF 绘制循环饿死、停在起始帧；
    // 若起始帧是 opacity:0，用户看到的就是一张看不见的卡片。
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

  // ============================================================
  //  HUD
  // ============================================================
  function updateHud() {
    el.levelText.textContent = level;
    el.moveText.textContent = moves;
    el.sizeText.textContent = n + '×' + n;
    el.sceneText.textContent = sceneName(sceneId);
    el.scoreText.textContent = score;
    el.bestText.textContent = best;
  }

  function sceneName(id) {
    for (var i = 0; i < Art.SCENES.length; i++) if (Art.SCENES[i].id === id) return Art.SCENES[i].name;
    return id;
  }

  var lastBarSync = 0;
  function syncTimeBar(force) {
    var now = Date.now();
    if (!force && now - lastBarSync < 120) return;
    lastBarSync = now;
    var pct = timeTotal > 0 ? timeLeft / timeTotal : 0;
    if (pct < 0) pct = 0;
    if (pct > 1) pct = 1;
    // 只在值真的变了才写 DOM：属性写入会触发 tv-controls.js 的 MutationObserver 全量重扫
    var w = (pct * 100).toFixed(1) + '%';
    if (el.timeFill.style.width !== w) el.timeFill.style.width = w;
    var cls = pct < 0.18 ? 'danger' : (pct < 0.4 ? 'warn' : '');
    if (el.timeFill.className !== cls) el.timeFill.className = cls;
  }

  // ============================================================
  //  关卡流程
  // ============================================================
  function startLevel(lv) {
    level = lv;
    n = Puzzle.sizeOf(lv);
    moves = 0;
    anim = null;
    shakeT = 0;
    snapIdx = -1;
    sceneId = Art.SCENE_IDS[(lv - 1) % Art.SCENE_IDS.length];

    timeTotal = Puzzle.timeOf(lv);
    timeLeft = timeTotal;
    lastTickSec = -1;

    board = Puzzle.shuffle(n, Puzzle.shuffleCountOf(lv));

    computeLayout();
    buildPicture();

    state = STATE.PEEK;
    peekFrom = STATE.PLAY;
    peekUntil = Date.now() + PEEK_FIRST;

    hideScreens();
    show('hud');
    audio.resume();
    audio.sfx('start');
    audio.startBGM();
    updateHud();
    syncTimeBar(true);
  }

  function startPeek(ms) {
    if (state !== STATE.PLAY) return;
    peekFrom = STATE.PLAY;
    state = STATE.PEEK;
    peekUntil = Date.now() + ms;
  }

  function endPeek() {
    if (state !== STATE.PEEK) return;
    state = peekFrom;
  }

  function trySlide(dir) {
    if (state !== STATE.PLAY) return;
    if (anim) anim = null;                     // 连按时直接把上一块吸到位，手感更跟手

    var res = Puzzle.move(board, n, dir);
    if (!res.ok) {
      shakeT = Date.now();
      audio.sfx('blocked');
      return;
    }

    moves++;
    var fromR = Math.floor(res.from / n), fromC = res.from % n;
    var toR = Math.floor(res.to / n), toC = res.to % n;
    anim = { to: res.to, fromR: fromR, fromC: fromC, toR: toR, toC: toC, start: Date.now() };
    audio.sfx('slide');

    // 这一块正好归位了，给一声清亮的「咔」
    if (board[res.to] === res.to + 1) {
      snapT = Date.now();
      snapIdx = res.to;
      audio.sfx('snap');
    }
    updateHud();
  }

  function pauseGame() {
    if (state !== STATE.PLAY && state !== STATE.PEEK) return;
    state = STATE.PAUSE;
    audio.stopBGM();
    el.pauseStat.textContent = '第 ' + level + ' 关 · ' + n + '×' + n +
      ' · 已走 ' + moves + ' 步 · 剩余 ' + Math.ceil(timeLeft) + ' 秒';
    show('pauseScreen');
    focusFirst('pauseScreen');
  }

  var pauseStart = 0;
  var pausedFrom = STATE.PLAY;

  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    // 暂停期间流逝的时间要还给玩家（peekUntil 也要整体后移，否则一恢复就跳过看图）
    var gap = Date.now() - pauseStart;
    if (peekUntil) peekUntil += gap;
    // 在看原图时暂停，恢复后要回到看图，不能一恢复就直接开拼
    state = (pausedFrom === STATE.PEEK && Date.now() < peekUntil) ? STATE.PEEK : STATE.PLAY;
    hide('pauseScreen');
    audio.resume();
    audio.startBGM();
  }

  function enterPause() {
    pauseStart = Date.now();
    pausedFrom = state;
    pauseGame();
  }

  function levelClear() {
    if (state === STATE.CLEAR) return;
    state = STATE.CLEAR;
    audio.stopBGM();
    audio.sfx('clear');

    var base = n * n * 100;
    var timeBonus = Math.round(timeLeft) * 6;
    var gained = Math.max(100, base - moves * 8) + timeBonus;
    score += gained;
    if (score > best) { best = score; saveBest(); }

    el.clearTitle.textContent = '第 ' + level + ' 关 · 拼好啦！';
    el.clearMoves.textContent = moves;
    el.clearBonus.textContent = timeBonus;
    el.clearScore.textContent = score;
    el.clearTip.textContent = sceneName(sceneId) + ' · ' +
      (moves <= n * n * 2 ? '好厉害，步数超少！' : (moves <= n * n * 4 ? '拼得不错，再接再厉！' : '别灰心，多玩几次就熟啦。'));

    hide('hud');
    show('clearScreen');
    focusFirst('clearScreen');
  }

  function gameOver() {
    state = STATE.OVER;
    audio.stopBGM();
    audio.sfx('over');
    if (score > best) { best = score; saveBest(); }

    el.overMoves.textContent = moves;
    el.overScore.textContent = score;
    el.overBest.textContent = best;
    el.overTip.textContent = '第 ' + level + ' 关时间用完了，' + sceneName(sceneId) + '就差一点点。';

    hide('hud');
    show('overScreen');
    focusFirst('overScreen');
  }

  function gotoStart() {
    state = STATE.START;
    audio.stopBGM();
    hideScreens();
    hide('hud');
    anim = null;
    el.startBest.textContent = best;
    show('startScreen');
    focusFirst('startScreen');
  }

  // ============================================================
  //  输入
  // ============================================================
  var lastDirT = 0;
  var lastBackT = 0;

  function onBack() {
    var now = Date.now();
    if (now - lastBackT < 400) return;
    lastBackT = now;

    if (state === STATE.PLAY || state === STATE.PEEK) enterPause();
    else if (state === STATE.PAUSE) resumeGame();
    else if (state === STATE.CLEAR || state === STATE.OVER) gotoStart();
  }

  var TVInput = window.TVInput;
  if (TVInput) {
    TVInput.on('dir', function (d) {
      if (state === STATE.PLAY) {
        var now = Date.now();
        if (now - lastDirT < DIR_DEBOUNCE) return;
        lastDirT = now;
        trySlide(d);
        return;
      }
      if (window.TVNav && !window.__tvControlsInjected) TVNav.move(d);
    });
    TVInput.on('confirm', function () {
      if (state === STATE.PEEK) { peekUntil = Date.now(); return; }   // 不想等就跳过看图
      if (state === STATE.PLAY) { startPeek(PEEK_AGAIN); return; }     // 再看一眼原图
      if (window.TVNav && !window.__tvControlsInjected) TVNav.confirm();
    });
    TVInput.on('back', onBack);
  }

  // 鼠标 / 触屏：点空格旁边的块就滑过去（附加操作，不是唯一玩法）
  canvas.addEventListener('click', function (e) {
    if (state === STATE.PEEK) { peekUntil = Date.now(); return; }
    if (state !== STATE.PLAY) return;
    var rect = canvas.getBoundingClientRect();
    var px = (e.clientX - rect.left) / rect.width * viewW;
    var py = (e.clientY - rect.top) / rect.height * viewH;
    if (px < L.bx || px > L.bx + L.size || py < L.by || py > L.by + L.size) return;

    var c = Math.floor((px - L.bx) / L.tile);
    var r = Math.floor((py - L.by) / L.tile);
    if (c < 0) c = 0; if (c > n - 1) c = n - 1;
    if (r < 0) r = 0; if (r > n - 1) r = n - 1;
    var idx = r * n + c;

    var b = Puzzle.blankIndex(board);
    if (b < 0) return;
    var br = Math.floor(b / n), bc = b % n;
    if (idx === b) return;
    if (r === br && c === bc - 1) trySlide('right');
    else if (r === br && c === bc + 1) trySlide('left');
    else if (c === bc && r === br - 1) trySlide('down');
    else if (c === bc && r === br + 1) trySlide('up');
    else { shakeT = Date.now(); audio.sfx('blocked'); }
  });

  // ============================================================
  //  渲染
  // ============================================================
  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, '#151f38');
    g.addColorStop(0.55, '#101828');
    g.addColorStop(1, '#0a0f18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    var pts = [[0.05, 0.12], [0.16, 0.26], [0.28, 0.08], [0.40, 0.21], [0.54, 0.12],
               [0.67, 0.28], [0.78, 0.07], [0.90, 0.22], [0.12, 0.38], [0.85, 0.40],
               [0.34, 0.35], [0.61, 0.37]];
    for (var i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i][0] * viewW, pts[i][1] * viewH, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 画某一块：v 是块编号（1..n*n-1），决定从整图的哪一块切
  function drawTile(v, x, y, w, h, alpha) {
    var src = pic.width / n;
    var sr = Math.floor((v - 1) / n), sc = (v - 1) % n;
    if (alpha !== undefined && alpha < 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
    }
    ctx.drawImage(pic, sc * src, sr * src, src, src, x, y, w, h);
    if (alpha !== undefined && alpha < 1) ctx.restore();
  }

  function drawBoardFrame() {
    Art.roundRect(ctx, L.bx - 8, L.by - 8, L.size + 16, L.size + 16, 14);
    ctx.fillStyle = 'rgba(30,38,62,0.92)';
    ctx.fill();
    Art.roundRect(ctx, L.bx - 8, L.by - 8, L.size + 16, L.size + 16, 14);
    ctx.strokeStyle = 'rgba(150,132,250,0.75)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawReference() {
    var r = L.rsize;
    Art.roundRect(ctx, L.rx - 6, L.ry - 6, r + 12, r + 12, 10);
    ctx.fillStyle = 'rgba(30,38,62,0.92)';
    ctx.fill();
    Art.roundRect(ctx, L.rx - 6, L.ry - 6, r + 12, r + 12, 10);
    ctx.strokeStyle = 'rgba(255,209,102,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.drawImage(pic, 0, 0, pic.width, pic.width, L.rx, L.ry, r, r);

    ctx.font = 'bold ' + Math.max(11, Math.round(r * 0.15)) +
      'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFD166';
    ctx.fillText('目标图', L.rx + r / 2, L.ry + r + Math.max(16, r * 0.22));
  }

  function drawSolvedTileMark(x, y, w, h) {
    Art.roundRect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 8);
    ctx.strokeStyle = 'rgba(62,213,152,0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawTileNumber(v, x, y, size) {
    var fs = Math.max(10, Math.round(size * 0.17));
    ctx.font = 'bold ' + fs + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(String(v), x + size * 0.11 + 1, y + size * 0.09 + 1);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(String(v), x + size * 0.11, y + size * 0.09);
  }

  function drawBoard(now) {
    var t = L.tile, m = L.m;
    var movableList = Puzzle.movable(board, n);

    for (var i = 0; i < board.length; i++) {
      var v = board[i];
      if (v === 0) continue;
      if (anim && i === anim.to) continue;          // 正在滑动的那块稍后单独画

      var p = cellPos(i);
      var x = p.x + m, y = p.y + m, w = t - m * 2, h = t - m * 2;

      drawTile(v, x, y, w, h);

      // 已经归位的块描一圈淡绿，孩子一眼能看出「这块对了」
      if (v === i + 1) drawSolvedTileMark(x, y, w, h);

      // 可以滑动的块描一圈淡黄，提示「这几个方向按得动」
      for (var k = 0; k < movableList.length; k++) {
        if (movableList[k] === i) {
          Art.roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 8);
          ctx.strokeStyle = 'rgba(255,209,102,0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();
          break;
        }
      }

      drawTileNumber(v, x, y, w);

      // 刚刚归位：闪一下
      if (i === snapIdx && now - snapT < 320) {
        var a = 1 - (now - snapT) / 320;
        Art.roundRect(ctx, x, y, w, h, 8);
        ctx.strokeStyle = 'rgba(62,213,152,' + (a * 0.9).toFixed(3) + ')';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
    }

    // 空格：画一个凹陷的暗格，让「洞在哪」一目了然
    var bi = Puzzle.blankIndex(board);
    if (bi >= 0) {
      var bp = cellPos(bi);
      Art.roundRect(ctx, bp.x + m, bp.y + m, t - m * 2, t - m * 2, 8);
      ctx.fillStyle = 'rgba(10,15,24,0.72)';
      ctx.fill();
      Art.roundRect(ctx, bp.x + m, bp.y + m, t - m * 2, t - m * 2, 8);
      ctx.strokeStyle = 'rgba(120,134,168,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 正在滑动的块
    if (anim) {
      var pr = Math.min(1, (now - anim.start) / ANIM_MS);
      var e = pr < 0.5 ? 2 * pr * pr : 1 - Math.pow(-2 * pr + 2, 2) / 2;   // easeInOutQuad
      var cx = (anim.fromC + (anim.toC - anim.fromC) * e) * t;
      var cy = (anim.fromR + (anim.toR - anim.fromR) * e) * t;
      drawTile(board[anim.to], L.bx + cx + m, L.by + cy + m, t - m * 2, t - m * 2);
      drawTileNumber(board[anim.to], L.bx + cx + m, L.by + cy + m, t - m * 2);
      if (pr >= 1) anim = null;
    }
  }

  // 看原图：把整张画盖在棋盘上，带一圈倒计时进度
  function drawPeek(now) {
    ctx.fillStyle = 'rgba(8,12,20,0.55)';
    ctx.fillRect(0, 0, viewW, viewH);

    var size = L.size;
    Art.roundRect(ctx, L.bx - 8, L.by - 8, size + 16, size + 16, 14);
    ctx.fillStyle = '#0a0f18';
    ctx.fill();
    ctx.drawImage(pic, 0, 0, pic.width, pic.width, L.bx, L.by, size, size);
    Art.roundRect(ctx, L.bx - 8, L.by - 8, size + 16, size + 16, 14);
    ctx.strokeStyle = '#FFD166';
    ctx.lineWidth = 4;
    ctx.stroke();

    var left = Math.max(0, peekUntil - now);
    var total = (state === STATE.PEEK && peekFrom === STATE.PLAY && moves === 0) ? PEEK_FIRST : PEEK_AGAIN;
    var bw = size, bh = 8;
    var by = L.by + size + 14;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    Art.roundRect(ctx, L.bx, by, bw, bh, 4);
    ctx.fill();
    ctx.fillStyle = '#FFD166';
    Art.roundRect(ctx, L.bx, by, bw * Math.max(0, Math.min(1, left / total)), bh, 4);
    ctx.fill();

    ctx.font = 'bold ' + Math.max(15, Math.round(size * 0.055)) +
      'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFD166';
    ctx.fillText('记住它的样子（按 OK 跳过）', L.bx + size / 2, L.by - 16);
  }

  function drawHint() {
    ctx.font = 'bold ' + Math.max(12, Math.min(17, viewW * 0.0145)) +
      'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#7f8ca6';
    ctx.fillText('方向键 / WASD 推动方块　·　OK 再看一眼原图　·　返回键暂停',
      viewW / 2, L.hintY);
  }

  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();
    if (state === STATE.START) return;

    // 滑不动时抖一下棋盘（比弹文字更直观）
    var shakeX = 0;
    if (shakeT && now - shakeT < SHAKE_MS) {
      shakeX = Math.sin((now - shakeT) / SHAKE_MS * Math.PI * 6) * 5 *
        (1 - (now - shakeT) / SHAKE_MS);
    }
    if (shakeX) ctx.translate(shakeX, 0);

    drawBoardFrame();
    drawBoard(now);
    drawReference();

    if (shakeX) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state === STATE.PEEK) drawPeek(now);
    if (state === STATE.PLAY || state === STATE.PEEK) drawHint();
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

    if (state === STATE.PEEK && now >= peekUntil) endPeek();

    if (state === STATE.PLAY) {
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
        if (Puzzle.isSolved(board)) levelClear();
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
   * 遥控 BACK 在部分 WebView 里表现为「页面后退」而不是可拦截的 keydown，
   * 所以用 pushState 占位 + popstate 捕获。**每次返回后必须重新占位**，
   * 否则第二次按 BACK 就真的离开游戏了（见 ../docs/STANDARD.md §4）。
   * 在 TV 启动器内不装：启动器把返回键交给原生层统一处理（会抢键）。
   */
  function setupBackTrap() {
    if (!window.history || !window.history.pushState) return;
    if (window.__tvControlsInjected) return;
    var mark = function () {
      try { window.history.pushState({ ps: 1 }, ''); } catch (e) { /* 某些 WebView 会抛，忽略 */ }
    };
    mark();
    window.addEventListener('popstate', function () {
      if (window.__tvControlsInjected) return;
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
  n = Puzzle.sizeOf(1);
  board = Puzzle.solvedBoard(n);
  sceneId = Art.SCENE_IDS[0];
  resize();
  gotoStart();
  requestAnimationFrame(loop);

  // 供测试驱动（见 test/shot.js）：暴露只读状态与一步到位的控制接口
  window.__puzzle = {
    get state() { return state; },
    get board() { return board; },
    get n() { return n; },
    get moves() { return moves; },
    get level() { return level; },
    layout: function () {
      return { bx: L.bx, by: L.by, size: L.size, tile: L.tile,
               rx: L.rx, ry: L.ry, rsize: L.rsize, hintY: L.hintY,
               vw: viewW, vh: viewH };
    },
    solve: function () { board = Puzzle.solvedBoard(n); },
    setBoard: function (b) { board = b; },
    slide: trySlide,
    skipPeek: function () { peekUntil = 0; }
  };
})();

/*
 * game.js —— 小小达人 · 认知问答（主状态机 + 出题 + 输入 + 渲染）
 *
 * 玩法：屏幕上方给出一张「题目图」，下方 2×2 四个选项。
 *       用方向键 / WASD 移动高亮框，OK 确认。
 *       答对加分加连击，答错扣分并亮出正确答案。一关 8 题，时间耗尽即结束。
 *
 * 为什么全部图形化：低龄儿童不识字（见 js/quiz.js 头部说明）。
 * 题干那行汉字是给家长看的，孩子只要「看哪张和上面一样」就能作答 ——
 * 这同时意味着**没有遥控器指针也能玩**：方向键在 2×2 里移动，OK 选中，
 * 完全不需要指向（见 docs/STANDARD.md §4）。
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

  var STATE = { START: 'start', ASK: 'ask', RESOLVE: 'resolve', PAUSE: 'pause', CLEAR: 'clear', OVER: 'over' };
  var state = STATE.START;

  var BEST_KEY = 'kids-quiz-best';

  var DIR_DEBOUNCE = 110;    // 老 WebView 的 auto-repeat 会一次连跳好几格
  var RIGHT_HOLD = 850;      // 答对后停留多久再进下一题
  var WRONG_HOLD = 1350;     // 答错要久一点：孩子得看清正确答案
  var OPT_ASPECT = 1.55;     // 选项卡 宽 : 高
  var TOAST_RESERVE = 58;    // 底部给 #toast 气泡留的高度（见 style.css）；不预留会压住下排选项

  var audio = new AudioManager();

  var best = 0;
  var score = 0;
  var level = 1;
  var combo = 0;

  var question = null;
  var lastType = '';
  var qIndex = 0;
  var rightCount = 0;

  var cursor = 0;            // 当前高亮的选项 0..3（2×2：0 1 / 2 3）
  var chosen = -1;
  var wasRight = false;
  var resolveUntil = 0;
  var resolveT = 0;

  var timeLeft = 0, timeTotal = 0;
  var lastTickSec = -1;

  var viewW = 0, viewH = 0, dpr = 1;
  var layout = { px: 0, py: 0, pw: 0, ph: 0, ox: 0, oy: 0, ow: 0, oh: 0, gx: 0, gy: 0, labelY: 0 };

  var el = {};
  ['hud', 'levelText', 'qText', 'totalQText', 'scoreText', 'bestText', 'comboText', 'comboPill',
   'timeFill', 'toast',
   'startScreen', 'pauseScreen', 'clearScreen', 'overScreen',
   'startBest', 'pauseStat', 'clearTitle', 'clearRight', 'clearBonus', 'clearScore', 'clearTip',
   'overScore', 'overBest', 'overRight', 'overTip'].forEach(function (id) {
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
  // ============================================================
  function timeOf(lv) { return Math.max(60, 110 - (lv - 1) * 5); }

  // ============================================================
  //  布局与自适应
  // ============================================================
  function computeLayout() {
    var topPad = Math.min(118, Math.max(74, viewH * 0.155));
    // 底部留白 = 安全边距 + 反馈气泡占位（气泡是绝对定位的，不预留就会压住下排选项）
    var bottomPad = Math.max(14, viewH * 0.035) + TOAST_RESERVE;
    var sidePad = Math.max(16, viewW * 0.03);

    var boardW = viewW - sidePad * 2;
    var boardH = viewH - topPad - bottomPad;

    var labelH = Math.max(22, viewH * 0.05);      // 题干文字占的高度
    var gapY = Math.max(10, boardH * 0.030);

    layout.labelY = topPad + labelH * 0.72;

    // 题目面板：上三分之一
    layout.ph = Math.min(boardH * 0.34, labelH + 220);
    layout.pw = Math.min(boardW * 0.50, layout.ph * 1.75);
    layout.px = sidePad + (boardW - layout.pw) / 2;
    layout.py = topPad + labelH;

    // 选项区：2×2，吃掉剩下的高度
    var optTop = layout.py + layout.ph + gapY;
    var optH = viewH - bottomPad - optTop;
    if (optH < 80) optH = 80;

    var gx = Math.max(10, boardW * 0.020);
    var gy = Math.max(10, optH * 0.070);

    var ow = (boardW - gx) / 2;
    var oh = (optH - gy) / 2;
    if (ow / oh > OPT_ASPECT) ow = oh * OPT_ASPECT;
    else oh = ow / OPT_ASPECT;

    layout.ow = ow;
    layout.oh = oh;
    layout.gx = gx;
    layout.gy = gy;
    layout.ox = sidePad + (boardW - (ow * 2 + gx)) / 2;
    layout.oy = optTop + (optH - (oh * 2 + gy)) / 2;
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
  }

  function optPos(i) {
    return {
      x: layout.ox + (i % 2) * (layout.ow + layout.gx),
      y: layout.oy + Math.floor(i / 2) * (layout.oh + layout.gy)
    };
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
    el.qText.textContent = Math.min(qIndex + 1, Quiz.QUESTIONS);
    el.totalQText.textContent = Quiz.QUESTIONS;
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
    toastTimer = setTimeout(function () { el.toast.className = 'hidden'; }, 1000);
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
    qIndex = 0;
    rightCount = 0;
    combo = 0;
    lastType = '';
    timeTotal = timeOf(lv);
    timeLeft = timeTotal;
    lastTickSec = -1;

    state = STATE.ASK;
    hideScreens();
    show('hud');
    audio.resume();
    audio.sfx('start');
    audio.startBGM();
    nextQuestion();
    syncTimeBar(true);
  }

  function nextQuestion() {
    if (qIndex >= Quiz.QUESTIONS) { levelClear(); return; }
    question = Quiz.generate(level, lastType);
    lastType = question.type;
    chosen = -1;
    wasRight = false;
    cursor = 0;                    // 每道题都从左上角开始，孩子不用找光标
    state = STATE.ASK;
    updateHud();
  }

  function pauseGame() {
    if (state !== STATE.ASK && state !== STATE.RESOLVE) return;
    state = STATE.PAUSE;
    audio.stopBGM();
    el.pauseStat.textContent = '第 ' + level + ' 关 · 第 ' + Math.min(qIndex + 1, Quiz.QUESTIONS) +
      '/' + Quiz.QUESTIONS + ' 题 · 剩余 ' + Math.ceil(timeLeft) + ' 秒';
    show('pauseScreen');
    focusFirst('pauseScreen');
  }

  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    state = (chosen >= 0) ? STATE.RESOLVE : STATE.ASK;
    // 暂停期间流逝的时间要还给玩家，否则暂停就成了惩罚
    if (resolveT) resolveUntil += Date.now() - resolveT;
    hide('pauseScreen');
    audio.resume();
    audio.startBGM();
  }

  function answer(i) {
    if (state !== STATE.ASK || !question) return;
    chosen = i;
    wasRight = (i === question.answer);

    if (wasRight) {
      combo++;
      rightCount++;
      score += 100 + (combo - 1) * 20;
      timeLeft = Math.min(timeTotal, timeLeft + 1);
      audio.sfx('right');
      toast('答对啦！ +' + (100 + (combo - 1) * 20) + (combo > 1 ? '   连击 x' + combo : ''), 'good');
    } else {
      combo = 0;
      score = Math.max(0, score - 20);
      timeLeft = Math.max(0, timeLeft - 3);
      audio.sfx('wrong');
      toast('再看看～  -20 分   -3 秒', 'bad');
    }

    updateHud();
    syncTimeBar(true);

    state = STATE.RESOLVE;
    resolveT = Date.now();
    resolveUntil = resolveT + (wasRight ? RIGHT_HOLD : WRONG_HOLD);
  }

  function levelClear() {
    if (state === STATE.CLEAR) return;
    state = STATE.CLEAR;
    audio.stopBGM();
    audio.sfx('clear');

    var bonus = Math.round(timeLeft) * 8;
    score += bonus;
    if (score > best) { best = score; saveBest(); }

    el.clearTitle.textContent = '第 ' + level + ' 关 · 全部答完！';
    el.clearRight.textContent = rightCount + '/' + Quiz.QUESTIONS;
    el.clearBonus.textContent = bonus;
    el.clearScore.textContent = score;
    el.clearTip.textContent = rightCount >= Quiz.QUESTIONS
      ? '全对！太厉害了，下一关会更难一点。'
      : (rightCount >= Quiz.QUESTIONS - 2 ? '答得不错，再接再厉！' : '别灰心，多玩几次就熟啦。');

    updateHud();
    hide('hud');
    show('clearScreen');
    focusFirst('clearScreen');
  }

  function gameOver() {
    state = STATE.OVER;
    audio.stopBGM();
    audio.sfx('over');
    if (score > best) { best = score; saveBest(); }

    el.overScore.textContent = score;
    el.overBest.textContent = best;
    el.overRight.textContent = rightCount + '/' + Quiz.QUESTIONS;
    el.overTip.textContent = '第 ' + level + ' 关答到第 ' + Math.min(qIndex + 1, Quiz.QUESTIONS) + ' 题时间就用完了。';

    hide('hud');
    show('overScreen');
    focusFirst('overScreen');
  }

  function gotoStart() {
    state = STATE.START;
    audio.stopBGM();
    hideScreens();
    hide('hud');
    question = null;
    chosen = -1;
    el.startBest.textContent = best;
    show('startScreen');
    focusFirst('startScreen');
  }

  // ============================================================
  //  输入
  // ============================================================
  var lastDirT = 0;
  function moveCursor(dir) {
    var now = Date.now();
    if (now - lastDirT < DIR_DEBOUNCE) return;
    lastDirT = now;

    var c = cursor % 2, r = Math.floor(cursor / 2);
    if (dir === 'left') c--;
    else if (dir === 'right') c++;
    else if (dir === 'up') r--;
    else if (dir === 'down') r++;

    if (c < 0) c = 0;
    if (c > 1) c = 1;
    if (r < 0) r = 0;
    if (r > 1) r = 1;

    var next = r * 2 + c;
    if (next !== cursor) { cursor = next; audio.sfx('focus'); }
  }

  var lastBackT = 0;
  function onBack() {
    var now = Date.now();
    if (now - lastBackT < 400) return;
    lastBackT = now;

    if (state === STATE.ASK || state === STATE.RESOLVE) pauseGame();
    else if (state === STATE.PAUSE) resumeGame();
    else if (state === STATE.CLEAR || state === STATE.OVER) gotoStart();
  }

  var TVInput = window.TVInput;
  if (TVInput) {
    TVInput.on('dir', function (d) {
      if (state === STATE.ASK) { moveCursor(d); return; }
      if (window.TVNav && !window.__tvControlsInjected) TVNav.move(d);
    });
    TVInput.on('confirm', function () {
      if (state === STATE.ASK) { answer(cursor); return; }
      if (state === STATE.RESOLVE) { resolveUntil = Date.now(); return; }   // 不想等就按 OK 跳过
      if (window.TVNav && !window.__tvControlsInjected) TVNav.confirm();
    });
    TVInput.on('back', onBack);
  }

  // 鼠标 / 触屏：点哪选哪（作为遥控之外的附加操作，不是唯一玩法）
  canvas.addEventListener('click', function (e) {
    if (state === STATE.RESOLVE) { resolveUntil = Date.now(); return; }
    if (state !== STATE.ASK || !question) return;
    var rect = canvas.getBoundingClientRect();
    var px = (e.clientX - rect.left) / rect.width * viewW;
    var py = (e.clientY - rect.top) / rect.height * viewH;
    for (var i = 0; i < 4; i++) {
      var p = optPos(i);
      if (px >= p.x && px <= p.x + layout.ow && py >= p.y && py <= p.y + layout.oh) {
        cursor = i;
        answer(i);
        return;
      }
    }
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

  function drawPrompt(q) {
    var L = layout;
    var fs = Math.max(15, Math.min(25, viewW * 0.021));

    // 题干（给家长看的一行字，孩子靠图形就能作答）
    ctx.font = 'bold ' + fs + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFD166';
    ctx.fillText(q.label, viewW / 2, L.labelY);

    // 题目面板
    Art.roundRect(ctx, L.px, L.py, L.pw, L.ph, 16);
    ctx.fillStyle = 'rgba(30,38,62,0.92)';
    ctx.fill();
    Art.roundRect(ctx, L.px, L.py, L.pw, L.ph, 16);
    ctx.strokeStyle = 'rgba(150,132,250,0.75)';
    ctx.lineWidth = 3;
    ctx.stroke();

    var cx = L.px + L.pw / 2, cy = L.py + L.ph / 2;

    if (!q.prompt) {
      // 找不同 / 比大小这类没有「题干图」，用大问号占位
      ctx.fillStyle = 'rgba(255,209,102,0.92)';
      ctx.font = 'bold ' + Math.round(Math.min(L.pw, L.ph) * 0.58) +
        'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy);
      return;
    }

    if (q.prompt.k === 'count') {
      // 一堆积木：数量随关卡递增，间距自动压缩
      var n = q.prompt.n;
      var step = Math.min(L.pw * 0.88 / n, L.ph * 0.62);
      var r = Math.min(step * 0.44, L.ph * 0.30);
      var x0 = cx - (n - 1) * step / 2;
      for (var i = 0; i < n; i++) Art.paint(ctx, q.prompt.item, x0 + i * step, cy, r);
      return;
    }

    Art.paint(ctx, q.prompt, cx, cy, Math.min(L.pw, L.ph) * 0.32);
  }

  function markCheck(x, y, s, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.30, y + s * 0.02);
    ctx.lineTo(x - s * 0.07, y + s * 0.24);
    ctx.lineTo(x + s * 0.32, y - s * 0.26);
    ctx.stroke();
  }

  function markCross(x, y, s, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.24, y - s * 0.24);
    ctx.lineTo(x + s * 0.24, y + s * 0.24);
    ctx.moveTo(x + s * 0.24, y - s * 0.24);
    ctx.lineTo(x - s * 0.24, y + s * 0.24);
    ctx.stroke();
  }

  function drawOption(i, now) {
    var L = layout;
    var p = optPos(i);
    var sel = (state === STATE.ASK && cursor === i);

    // 卡片本体
    Art.roundRect(ctx, p.x, p.y, L.ow, L.oh, 14);
    ctx.fillStyle = '#FFFCF2';
    ctx.fill();
    Art.roundRect(ctx, p.x + 1.5, p.y + 1.5, L.ow - 3, L.oh - 3, 13);
    ctx.strokeStyle = 'rgba(96,106,138,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    Art.paint(ctx, question.options[i], p.x + L.ow / 2, p.y + L.oh / 2, Math.min(L.ow, L.oh) * 0.32);

    // 判定反馈：答对绿勾 / 答错红叉，并在答错时把正确答案也圈出来
    if (state === STATE.RESOLVE) {
      var prog = Math.min(1, (now - resolveT) / 260);
      var s = Math.min(L.ow, L.oh);
      var cx = p.x + L.ow / 2, cy = p.y + L.oh / 2;

      if (i === chosen) {
        Art.roundRect(ctx, p.x + 2, p.y + 2, L.ow - 4, L.oh - 4, 12);
        ctx.strokeStyle = wasRight ? '#3ED598' : '#E5484D';
        ctx.lineWidth = 4 + (1 - prog) * 6;
        ctx.stroke();
        if (wasRight) markCheck(cx, cy, s, '#3ED598', Math.max(4, s * 0.10));
        else markCross(cx, cy, s * 0.8, '#E5484D', Math.max(4, s * 0.09));
      } else if (!wasRight && i === question.answer) {
        Art.roundRect(ctx, p.x + 2, p.y + 2, L.ow - 4, L.oh - 4, 12);
        ctx.strokeStyle = 'rgba(62,213,152,' + (0.35 + 0.65 * prog).toFixed(3) + ')';
        ctx.lineWidth = 4;
        ctx.stroke();
        markCheck(cx, cy, s, 'rgba(62,213,152,' + (0.35 + 0.65 * prog).toFixed(3) + ')', Math.max(3, s * 0.08));
      }
    }

    // 高亮框（画在最上层，判定反馈不会盖住它）
    if (sel) {
      ctx.save();
      var pulse = 0.72 + 0.28 * Math.sin(now / 260);
      Art.roundRect(ctx, p.x - 5, p.y - 5, L.ow + 10, L.oh + 10, 18);
      ctx.strokeStyle = 'rgba(255,209,102,' + (0.30 * pulse).toFixed(3) + ')';
      ctx.lineWidth = 11;
      ctx.stroke();
      Art.roundRect(ctx, p.x - 5, p.y - 5, L.ow + 10, L.oh + 10, 18);
      ctx.strokeStyle = '#FFD166';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }
  }

  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();
    if (!question) return;
    drawPrompt(question);
    for (var i = 0; i < 4; i++) drawOption(i, now);
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

    if (state === STATE.RESOLVE && now >= resolveUntil) {
      qIndex++;
      nextQuestion();
    }

    if (state === STATE.ASK) {
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
   * 遥控 BACK 在部分 WebView 里表现为「页面后退」而不是可拦截的 keydown，
   * 所以用 pushState 占位 + popstate 捕获。**每次返回后必须重新占位**，
   * 否则第二次按 BACK 就真的离开游戏了（见 docs/STANDARD.md §4）。
   * 在 TV 启动器内不装：启动器把返回键交给原生层统一处理（会抢键）。
   */
  function setupBackTrap() {
    if (!window.history || !window.history.pushState) return;
    if (window.__tvControlsInjected) return;
    var mark = function () {
      try { window.history.pushState({ kq: 1 }, ''); } catch (e) { /* 某些 WebView 会抛，忽略 */ }
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
  resize();
  gotoStart();
  requestAnimationFrame(loop);
})();

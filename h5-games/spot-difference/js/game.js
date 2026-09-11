/*
 * game.js —— 火眼金睛 · 找不同（主状态机 + 玩法 + 输入 + 渲染）
 *
 * 玩法：左右两幅画并排，右图藏着若干处差异。用方向键 / WASD 移动取景框，
 *       对准可疑之处按 OK 标记。点对得分（连击加成、回一点时间），点错扣分扣时间。
 *       全部找齐即过关，时间耗尽则结束。
 *
 * 为什么用「取景框网格」而不是鼠标式自由指针：电视遥控器没有指针（见 docs/STANDARD.md §4），
 * 网格吸附让 7×4 个格子都能用方向键可靠到达，同时保留鼠标点击作为附加操作。
 *
 * 兼容目标：MiTV4A / Android 6 / WebView ≈ Chromium 47 —— 经典脚本 + IIFE，不用 ES module。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var STATE = { START: 'start', PLAY: 'play', PAUSE: 'pause', RESOLVE: 'resolve', CLEAR: 'clear', OVER: 'over' };
  var state = STATE.START;

  var BEST_KEY = 'spot-difference-best';
  var HIT_RADIUS = 0.72;   // 取景框中心到差异点「格子距离」的命中阈值（<1 即同格必中）
  var CLEAR_DELAY = 950;   // 找齐最后一处之后，先播一段半透明过关动画，再弹结算卡片

  var audio = new AudioManager();

  var best = 0;
  var score = 0;
  var level = 1;
  var combo = 0;
  var levelData = null;
  var foundCount = 0;
  var timeLeft = 0;
  var timeTotal = 0;
  var cursor = { c: 3, r: 1 };
  var hintDiffId = -1;
  var hintUntil = 0;
  var lastTickSec = -1;
  var clearTimer = null;   // 过关动画的延时句柄
  var resolveT = 0;        // 过关动画开始的时间戳
  var lastFoundPos = null; // 最后一处差异的位置（动画从它扩散出去）

  var viewW = 0, viewH = 0, dpr = 1;
  var layout = { w: 0, h: 0, top: 0, leftX: 0, rightX: 0 };

  // 常用 DOM 引用一次性取好
  var el = {};
  ['hud', 'levelText', 'foundText', 'totalText', 'scoreText', 'bestText', 'comboText', 'comboPill',
   'timeFill', 'toast', 'startScreen', 'pauseScreen', 'clearScreen', 'overScreen',
   'startBest', 'pauseStat', 'clearTitle', 'timeBonus', 'clearScore', 'clearTip',
   'overScore', 'overBest', 'overTip'].forEach(function (id) {
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
  function resize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';

    var topPad = Math.min(126, Math.max(84, viewH * 0.17));   // 给 HUD 留位
    var bottomPad = Math.max(12, viewH * 0.03);
    var sidePad = Math.max(12, viewW * 0.018);
    var gap = Math.max(14, viewW * 0.02);

    var availW = viewW - sidePad * 2 - gap;
    var availH = viewH - topPad - bottomPad;

    var panelW = availW / 2;
    var panelH = availH;
    var ratio = 4 / 3;                       // 单幅画保持 4:3，找不同看着最舒服
    if (panelW / panelH > ratio) panelW = panelH * ratio;
    else panelH = panelW / ratio;

    layout.w = panelW;
    layout.h = panelH;
    layout.top = topPad + (availH - panelH) / 2;
    layout.leftX = sidePad + (availW / 2 - panelW) / 2;
    layout.rightX = sidePad + availW / 2 + gap + (availW / 2 - panelW) / 2;

    if (levelData) Scenes.prepare(levelData, panelW, panelH, dpr);
  }

  // ============================================================
  //  界面切换
  // ============================================================
  var SCREENS = ['startScreen', 'pauseScreen', 'clearScreen', 'overScreen'];
  var animTimers = {};

  // 显示覆盖层时重新触发一次渐入动画（先摘掉类 → 强制回流 → 再加回来，
  // 否则同一个元素第二次显示时动画不会重播）
  function show(id) {
    var e = document.getElementById(id);
    if (!e) return;
    e.classList.remove('hidden');
    e.classList.remove('anim-in');
    void e.offsetWidth;
    e.classList.add('anim-in');

    // 兜底：动画结束（或因为老设备主线程被绘制循环占满、动画没能推进）之后
    // 把动画类摘掉，元素回落到「完全可见」的基础样式 —— 绝不会停在半透明状态。
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
  // 覆盖层正在做渐入动画时可能被判成不可见而漏掉 —— 这里补一次聚焦兜底，
  // 保证暂停 / 过关界面一出现，OK 键立刻可用。
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
    el.foundText.textContent = foundCount;
    el.totalText.textContent = levelData ? levelData.diffCount : 0;
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
    // 只在值真的变了才写 DOM。属性写入会触发启动器注入的 tv-controls.js 的
    // MutationObserver，它每次都会重扫一遍全量可聚焦元素（含 getComputedStyle），
    // 每秒 8 次的无谓写入在电视盒子上纯属浪费。
    var w = (pct * 100).toFixed(1) + '%';
    if (el.timeFill.style.width !== w) el.timeFill.style.width = w;
    var cls = pct < 0.18 ? 'danger' : (pct < 0.4 ? 'warn' : '');
    if (el.timeFill.className !== cls) el.timeFill.className = cls;
  }

  // ============================================================
  //  关卡流程
  // ============================================================
  function timeOf(lv) { return Math.max(44, 84 - (lv - 1) * 5); }

  function cancelClear() {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  }

  function startLevel(lv) {
    cancelClear();
    level = lv;
    levelData = Scenes.generate(lv);
    foundCount = 0;
    combo = 0;
    hintDiffId = -1;
    hintUntil = 0;
    lastTickSec = -1;
    resolveT = 0;
    lastFoundPos = null;
    timeTotal = timeOf(lv);
    timeLeft = timeTotal;
    cursor.c = Math.floor(Scenes.GRID_COLS / 2);
    cursor.r = Math.floor(Scenes.GRID_ROWS / 2);

    Scenes.prepare(levelData, layout.w, layout.h, dpr);

    state = STATE.PLAY;
    hideScreens();
    show('hud');
    updateHud();
    syncTimeBar(true);
    audio.resume();
    audio.sfx('start');
    audio.startBGM();
  }

  function pauseGame() {
    if (state !== STATE.PLAY) return;
    state = STATE.PAUSE;
    audio.stopBGM();
    el.pauseStat.textContent = '第 ' + level + ' 关 · 还剩 ' +
      (levelData.diffCount - foundCount) + ' 处没找到 · 剩余 ' + Math.ceil(timeLeft) + ' 秒';
    show('pauseScreen');
    focusFirst('pauseScreen');
  }

  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    state = STATE.PLAY;
    hide('pauseScreen');
    audio.resume();
    audio.startBGM();
  }

  function useHint() {
    if (state !== STATE.PAUSE || !levelData) return;
    var remain = [];
    for (var i = 0; i < levelData.diffs.length; i++) {
      if (!levelData.diffs[i].found) remain.push(i);
    }
    if (!remain.length) return;
    hintDiffId = remain[Math.floor(Math.random() * remain.length)];
    hintUntil = Date.now() + 2600;
    timeLeft = Math.max(1, timeLeft - 20);   // 提示的代价：20 秒
    audio.sfx('hint');
    syncTimeBar(true);
    resumeGame();
  }

  function levelClear() {
    cancelClear();
    if (state === STATE.CLEAR) return;
    state = STATE.CLEAR;
    audio.stopBGM();

    var bonus = Math.round(timeLeft) * 10;   // 剩余时间奖励
    score += bonus;
    if (score > best) { best = score; saveBest(); }

    el.clearTitle.textContent = '第 ' + level + ' 关 · 全部找到！';
    el.timeBonus.textContent = bonus;
    el.clearScore.textContent = score;
    el.clearTip.textContent = level >= 3
      ? '眼力不错！下一关的破绽会更隐蔽，差异也会更多。'
      : '干得漂亮，继续挑战下一关吧。';

    updateHud();
    hide('hud');
    show('clearScreen');     // show() 里带了渐入动画，不会再「啪」地弹出来
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
    el.overTip.textContent = levelData
      ? ('第 ' + level + ' 关还剩 ' + (levelData.diffCount - foundCount) + ' 处没找到。')
      : '';

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
    levelData = null;
    lastFoundPos = null;
    Scenes.invalidate();
    el.startBest.textContent = best;
    show('startScreen');
    focusFirst('startScreen');
  }

  // ============================================================
  //  玩法核心：标记判定
  // ============================================================
  function cursorRect() {
    return {
      x: cursor.c / Scenes.GRID_COLS,
      y: cursor.r / Scenes.GRID_ROWS,
      w: 1 / Scenes.GRID_COLS,
      h: 1 / Scenes.GRID_ROWS
    };
  }

  function foundMarks() {
    var out = [];
    if (!levelData) return out;
    for (var i = 0; i < levelData.diffs.length; i++) {
      var d = levelData.diffs[i];
      if (!d.found) continue;
      var moved = (d.kind === 'move');
      out.push({
        x: d.x,
        y: d.y,
        rx: moved ? d.x + d.mx : d.x,
        ry: moved ? d.y + d.my : d.y
      });
    }
    return out;
  }

  function hintPos() {
    if (hintDiffId < 0 || !levelData) return null;
    if (Date.now() > hintUntil) { hintDiffId = -1; return null; }
    var d = levelData.diffs[hintDiffId];
    return d ? { x: d.x, y: d.y } : null;
  }

  // 取景框中心 → 最近的一处未找到差异，落在阈值内即算命中
  function pickTarget(cx, cy) {
    var hit = null, bestD = Infinity;
    for (var i = 0; i < levelData.diffs.length; i++) {
      var d = levelData.diffs[i];
      if (d.found) continue;
      var gx = (cx - d.x) * Scenes.GRID_COLS;
      var gy = (cy - d.y) * Scenes.GRID_ROWS;
      var dist = Math.sqrt(gx * gx + gy * gy);
      // 位移类差异：原位置与移动后的位置，点到哪边都算数
      if (d.kind === 'move') {
        var gx2 = (cx - (d.x + d.mx)) * Scenes.GRID_COLS;
        var gy2 = (cy - (d.y + d.my)) * Scenes.GRID_ROWS;
        var dist2 = Math.sqrt(gx2 * gx2 + gy2 * gy2);
        if (dist2 < dist) dist = dist2;
      }
      if (dist < bestD) { bestD = dist; hit = d; }
    }
    return (hit && bestD < HIT_RADIUS) ? hit : null;
  }

  function tryMark() {
    if (state !== STATE.PLAY || !levelData) return;
    var cx = (cursor.c + 0.5) / Scenes.GRID_COLS;
    var cy = (cursor.r + 0.5) / Scenes.GRID_ROWS;
    var target = pickTarget(cx, cy);
    if (target) onFound(target);
    else onMiss();
  }

  function onFound(d) {
    d.found = true;
    foundCount++;
    combo++;

    var gain = 100 + (combo - 1) * 30;
    score += gain;
    timeLeft = Math.min(timeTotal, timeLeft + 1.2);   // 找对有小小的续命奖励

    audio.sfx('found');
    toast('+ ' + gain + (combo > 1 ? '   连击 x' + combo : ''), 'good');
    updateHud();
    syncTimeBar(true);

    if (foundCount >= levelData.diffCount) {
      // 最后一处也找到了 —— 不要「啪」地弹结算卡片。
      // 先进入 RESOLVE 过渡态：计时冻结、输入锁住，画面上铺一层半透明过关光晕
      // （从最后一处差异扩散出去），等玩家看清那枚绿圈勾之后再淡入结算界面。
      state = STATE.RESOLVE;
      resolveT = Date.now();
      lastFoundPos = { x: d.x, y: d.y };
      audio.stopBGM();
      audio.sfx('levelclear');
      clearTimer = setTimeout(function () { clearTimer = null; levelClear(); }, CLEAR_DELAY);
    }
  }

  function onMiss() {
    combo = 0;
    score = Math.max(0, score - 30);
    timeLeft = Math.max(0, timeLeft - 3);

    audio.sfx('miss');
    toast('- 30 分   - 3 秒', 'bad');
    updateHud();
    syncTimeBar(true);

    if (timeLeft <= 0) gameOver();
  }

  // ============================================================
  //  输入
  // ============================================================
  var lastDirT = 0;
  function moveCursor(dir) {
    if (state !== STATE.PLAY) return;
    var now = Date.now();
    // 防老 WebView 方向键 auto-repeat 一次连跳好几格
    if (now - lastDirT < 110) return;
    lastDirT = now;

    var c = cursor.c, r = cursor.r;
    if (dir === 'left') c--;
    else if (dir === 'right') c++;
    else if (dir === 'up') r--;
    else if (dir === 'down') r++;

    if (c < 0) c = 0;
    if (c > Scenes.GRID_COLS - 1) c = Scenes.GRID_COLS - 1;
    if (r < 0) r = 0;
    if (r > Scenes.GRID_ROWS - 1) r = Scenes.GRID_ROWS - 1;

    cursor.c = c;
    cursor.r = r;
  }

  var lastBackT = 0;
  function onBack() {
    var now = Date.now();
    if (now - lastBackT < 400) return;
    lastBackT = now;

    if (state === STATE.PLAY) pauseGame();
    else if (state === STATE.PAUSE) resumeGame();
    else if (state === STATE.CLEAR || state === STATE.OVER) gotoStart();
    // RESOLVE（过关动画播放中）不响应返回键，避免动画被中途打断
  }

  var TVInput = window.TVInput;
  if (TVInput) {
    TVInput.on('dir', function (d) {
      if (state === STATE.PLAY) { moveCursor(d); return; }
      if (window.TVNav && !window.__tvControlsInjected) TVNav.move(d);
    });
    TVInput.on('confirm', function () {
      if (state === STATE.PLAY) { tryMark(); return; }
      if (state === STATE.RESOLVE) { levelClear(); return; }   // 不想等动画就按 OK 跳过
      if (window.TVNav && !window.__tvControlsInjected) TVNav.confirm();
    });
    TVInput.on('back', onBack);
  }

  // 鼠标 / 触屏：点哪测哪（作为遥控之外的附加操作，不是唯一玩法）
  canvas.addEventListener('click', function (e) {
    if (state === STATE.RESOLVE) { levelClear(); return; }   // 点一下也能跳过过关动画
    if (state !== STATE.PLAY || !levelData) return;
    var rect = canvas.getBoundingClientRect();
    var px = (e.clientX - rect.left) / rect.width * viewW;
    var py = (e.clientY - rect.top) / rect.height * viewH;

    var nx = -1, ny = -1;
    if (px >= layout.leftX && px <= layout.leftX + layout.w) {
      nx = (px - layout.leftX) / layout.w;
      ny = (py - layout.top) / layout.h;
    } else if (px >= layout.rightX && px <= layout.rightX + layout.w) {
      nx = (px - layout.rightX) / layout.w;
      ny = (py - layout.top) / layout.h;
    }
    if (nx < 0 || ny < 0 || ny > 1) return;

    var c = Math.floor(nx * Scenes.GRID_COLS);
    var r = Math.floor(ny * Scenes.GRID_ROWS);
    cursor.c = Math.max(0, Math.min(Scenes.GRID_COLS - 1, c));
    cursor.r = Math.max(0, Math.min(Scenes.GRID_ROWS - 1, r));
    tryMark();
  });

  // ============================================================
  //  渲染
  // ============================================================
  function paintLabels() {
    var fs = Math.max(12, Math.min(18, layout.w * 0.036));
    ctx.font = 'bold ' + fs + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var y = layout.top - fs * 1.4;
    var themeName = (levelData && levelData.theme) ? levelData.theme.name : '';
    ctx.fillStyle = 'rgba(159,176,200,0.92)';
    ctx.fillText(themeName ? ('原图 · ' + themeName) : '原图', layout.leftX + layout.w / 2, y);
    ctx.fillStyle = 'rgba(255,209,102,0.92)';
    ctx.fillText('对比图 · 找出不同', layout.rightX + layout.w / 2, y);
  }

  // 过关过渡动画：半透明绿色光晕 + 从最后一处差异扩散出去的双环 + 「全部找到！」
  // 注意时间基准：resolveT 是 Date.now()（epoch 毫秒），而主循环传进来的 now 是
  // requestAnimationFrame 的时间戳（相对导航开始），两者不能混用，这里统一用 Date.now()。
  function paintClearFlash() {
    var p = (Date.now() - resolveT) / CLEAR_DELAY;
    if (p < 0) p = 0;
    if (p > 1) p = 1;
    var ease = 1 - Math.pow(1 - p, 3);

    ctx.fillStyle = 'rgba(110,240,184,' + (0.26 * ease).toFixed(3) + ')';
    ctx.fillRect(0, 0, viewW, viewH);

    var unit = Math.min(layout.w, layout.h);
    if (lastFoundPos) {
      // 左右两幅画都要扩散，只画一边会显得不对称
      for (var s = 0; s < 2; s++) {
        var ox = s ? layout.rightX : layout.leftX;
        var px = ox + lastFoundPos.x * layout.w;
        var py = layout.top + lastFoundPos.y * layout.h;
        for (var i = 0; i < 2; i++) {
          var rr = unit * (0.10 + 0.46 * ease) * (i ? 1.62 : 1);
          ctx.strokeStyle = 'rgba(110,240,184,' + ((i ? 0.28 : 0.60) * (1 - ease)).toFixed(3) + ')';
          ctx.lineWidth = Math.max(3, unit * (i ? 0.012 : 0.022));
          ctx.beginPath();
          ctx.arc(px, py, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    var fs = Math.max(26, Math.min(56, viewW * 0.046));
    ctx.font = 'bold ' + fs + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(12,32,24,' + (0.42 * ease).toFixed(3) + ')';
    ctx.fillText('全部找到！', viewW / 2 + 2, viewH / 2 + 2);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.94 * ease).toFixed(3) + ')';
    ctx.fillText('全部找到！', viewW / 2, viewH / 2);
  }

  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, viewW, viewH);

    if (!levelData) return;

    var view = {
      marks: foundMarks(),
      hint: hintPos(),
      cursor: (state === STATE.PLAY) ? cursorRect() : null
    };

    Scenes.drawPanel(ctx, layout.leftX, layout.top, layout.w, layout.h, 'left', view, now);
    Scenes.drawPanel(ctx, layout.rightX, layout.top, layout.w, layout.h, 'right', view, now);
    paintLabels();

    if (state === STATE.RESOLVE) paintClearFlash();
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
      }
    }

    render(t);
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
  bindClick('btnHint', useHint);
  bindClick('btnRestart', function () { score = 0; startLevel(level); });
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
   * 否则第二次按 BACK 就真的离开游戏了（这是最初版本的漏洞）。
   *
   * 在 TV 启动器内不装：启动器把返回键交给原生层（MainActivity → TVLauncher.handleBack），
   * 装了反而会和启动器抢返回键。tv-controls.js 是在 iframe load 之后才注入的，
   * 所以要等 load 之后再判断，并在 popstate 里再兜底判断一次。
   * （与 maze-challenge 的处理保持一致，见 docs/STANDARD.md §4）
   */
  function setupBackTrap() {
    if (!window.history || !window.history.pushState) return;
    if (window.__tvControlsInjected) return;    // 启动器内由 launcher 统一处理
    var mark = function () {
      try { window.history.pushState({ sd: 1 }, ''); } catch (e) { /* 某些 WebView 会抛，忽略 */ }
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

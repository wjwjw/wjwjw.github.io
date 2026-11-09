/*
 * game.js —— 推箱子核心逻辑与渲染
 *
 * 结构（单文件 IIFE，纯 ES5，Chromium 47 兼容）：
 *   常量/工具 → 存档 → 音频/特效 → 关卡运行时 → 布局与渲染 →
 *   玩法（移动/推箱/撤销/胜利）→ 状态机 → 主题选择 UI → 输入绑定 → 启动
 *
 * 依赖：../shared/input.js (TVInput)、../shared/fx.js (FX)、../shared/nav.js (TVNav)、
 *       js/audio.js (AudioManager)、js/themes.js (SokoThemes)、js/levels.js (LEVELS)。
 */
(function (global) {
  'use strict';

  // ============================================================
  // 常量与工具
  // ============================================================
  var STATE = { MENU: 'menu', SELECT: 'select', PLAY: 'playing', PAUSE: 'paused', WIN: 'win' };
  var PROG_KEY = 'sokoProgress';
  var THEME_KEY = 'sokoTheme';
  var TWEEN_MS = 130;   // 格间移动补间
  var BUMP_MS = 130;    // 撞墙顶一下
  var HUD_H = 64;       // 顶部 HUD 占位（css px）

  var DIRV = {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]
  };

  function $(id) { return document.getElementById(id); }
  function show(id) { var el = $(id); if (el) el.className = el.className.replace(/\s*hidden\b/g, ''); }
  function hide(id) { var el = $(id); if (el && !/\bhidden\b/.test(el.className)) el.className += ' hidden'; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(k) { return 1 - (1 - k) * (1 - k); }

  function storeGet(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, val) {
    try { global.localStorage.setItem(key, val); } catch (e) { /* 隐身模式等场景忽略 */ }
  }
  function jsonGet(key, fallback) {
    var raw = storeGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function jsonSet(key, obj) { storeSet(key, JSON.stringify(obj)); }

  // ============================================================
  // 存档：进度 + 主题
  // ============================================================
  var progress = jsonGet(PROG_KEY, null);
  if (!progress || typeof progress.unlocked !== 'number') {
    progress = { unlocked: 1, best: {} };
  }
  if (!progress.best) progress.best = {};

  function saveProgress() { jsonSet(PROG_KEY, progress); }

  var theme = jsonGet(THEME_KEY, null) || {};
  if (!theme.charId) theme.charId = 'worker';
  if (!theme.sceneId) theme.sceneId = 'warehouse';
  if (typeof theme.solid !== 'boolean') theme.solid = true;
  if (typeof theme.contrast !== 'boolean') theme.contrast = false;
  if (typeof theme.linked !== 'boolean') theme.linked = true;

  function saveTheme() { jsonSet(THEME_KEY, theme); }

  // ============================================================
  // 音频 / 特效
  // ============================================================
  var audio = new AudioManager();
  var fx = FX.create({ maxParticles: 120, maxFloats: 6, maxRings: 8 });

  // ============================================================
  // DOM
  // ============================================================
  var canvas = $('game');
  var fxcv = $('fx2d');
  var ctx = canvas ? canvas.getContext('2d') : null;
  var fctx = fxcv ? fxcv.getContext('2d') : null;

  // ============================================================
  // 关卡运行时
  // ============================================================
  var state = STATE.MENU;
  var levelIdx = 0;
  var grid = null;          // {w,h,isWall(y,x),goals:[[x,y]..]}
  var boxes = [];           // [{x,y,fx,fy}] fx/fy 渲染插值起点
  var player = { x: 0, y: 0, fx: 0, fy: 0 };
  var moves = 0, pushes = 0;
  var history = [];         // [{dx,dy,box}] box=-1 或箱子下标
  var facing = 'down';
  var tween = null;         // {kind:'move'|'bump', dir, t0, pushBox}
  var queue = [];           // 输入缓冲（补间中最多存 2 个方向）
  var timeSec = 0;          // 目标点脉冲用的累计秒
  var celebrating = false;  // 庆祝期禁止暂停/输入打断
  var vw = 0, vh = 0, dpr = 1;
  var tile = 48, bx0 = 0, by0 = 0; // 棋盘原点与格子尺寸（css px）
  var backdrop = null, backdropKey = '';
  var lastBumpSfx = 0;

  function loadLevel(idx) {
    var lv = LEVELS[idx];
    var rows = lv.grid;
    var h = rows.length;
    var w = 0, i;
    for (i = 0; i < h; i++) w = Math.max(w, rows[i].length);
    var isWall = [];
    var goals = [];
    boxes = [];
    history = [];
    moves = 0; pushes = 0;
    queue = [];
    tween = null;
    for (var y = 0; y < h; y++) {
      isWall[y] = [];
      for (var x = 0; x < w; x++) {
        var c = x < rows[y].length ? rows[y].charAt(x) : ' ';
        if (c === '#') { isWall[y][x] = true; continue; }
        isWall[y][x] = false;
        if (c === '@' || c === '+') { player.x = x; player.y = y; }
        if (c === '$' || c === '*') boxes.push({ x: x, y: y });
        if (c === '.' || c === '*' || c === '+') goals.push([x, y]);
      }
    }
    grid = { w: w, h: h, isWall: isWall, goals: goals };
    player.fx = player.x; player.fy = player.y;
    facing = 'down';
    levelIdx = idx;
    celebrating = false;
    layoutBoard();
    updateHud();
  }

  function boxAt(x, y) {
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].x === x && boxes[i].y === y) return i;
    }
    return -1;
  }
  function isGoal(x, y) {
    for (var i = 0; i < grid.goals.length; i++) {
      if (grid.goals[i][0] === x && grid.goals[i][1] === y) return true;
    }
    return false;
  }

  // ============================================================
  // 布局与渲染
  // ============================================================
  function resize() {
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    vw = global.innerWidth;
    vh = global.innerHeight;
    if (!canvas) return;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fxcv) {
      fxcv.width = canvas.width;
      fxcv.height = canvas.height;
      fxcv.style.width = vw + 'px';
      fxcv.style.height = vh + 'px';
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    fx.setView(vw, vh);
    layoutBoard();
  }

  function layoutBoard() {
    if (!grid) return;
    var padX = 20;
    var availW = vw - padX * 2;
    var availH = vh - HUD_H - padX * 2;
    var t = Math.floor(Math.min(availW / grid.w, availH / grid.h));
    tile = clamp(t, 14, 96);
    var bw = tile * grid.w;
    var bh = tile * grid.h;
    bx0 = Math.round((vw - bw) / 2);
    by0 = Math.round((vh - bh) / 2) + Math.round(HUD_H / 2);
    rebuildBackdrop();
  }

  function rebuildBackdrop() {
    var key = SokoThemes.indexOfScene(theme.sceneId) + '|' + vw + 'x' + vh + '|' + dpr;
    if (backdrop && backdropKey === key) return;
    backdropKey = key;
    backdrop = SokoThemes.buildBackdrop(theme.sceneId, vw, vh, dpr, { contrast: theme.contrast });
  }

  function cellPx(x, y) { // 逻辑格 → css 像素左上角
    return [bx0 + x * tile, by0 + y * tile];
  }

  var optsCache = { solid: true, contrast: false, t: 0 };

  function render() {
    if (!ctx || !grid) return;
    optsCache.solid = theme.solid;
    optsCache.contrast = theme.contrast;
    optsCache.t = timeSec;

    ctx.clearRect(0, 0, vw, vh);
    if (backdrop) ctx.drawImage(backdrop, 0, 0, vw, vh);

    fx.applyShake(ctx);

    var x, y, i, px, py;
    // 1) 地板 + 目标点（平铺，无遮挡关系）
    for (y = 0; y < grid.h; y++) {
      for (x = 0; x < grid.w; x++) {
        if (grid.isWall[y][x]) continue;
        var c = cellPx(x, y);
        SokoThemes.drawFloor(ctx, theme.sceneId, c[0], c[1], tile, optsCache);
      }
    }
    for (i = 0; i < grid.goals.length; i++) {
      var gp = cellPx(grid.goals[i][0], grid.goals[i][1]);
      // 有箱子压着的目标点由箱子自己画出高亮，这里跳过避免叠太脏
      if (boxAt(grid.goals[i][0], grid.goals[i][1]) < 0) {
        SokoThemes.drawGoal(ctx, theme.sceneId, gp[0], gp[1], tile, optsCache, timeSec);
      }
    }

    // 2) 行序绘制墙与箱子（伪 3D 遮挡：下面的行盖住上面的行）
    for (y = 0; y < grid.h; y++) {
      for (x = 0; x < grid.w; x++) {
        if (grid.isWall[y][x]) {
          var wp = cellPx(x, y);
          SokoThemes.drawWall(ctx, theme.sceneId, wp[0], wp[1], tile, optsCache);
        }
      }
      for (i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        var bry = tween && tween.pushBox === i ? b.fy : b.y; // 补间中按插值行归组
        if (bry !== y) continue;
        drawBoxAt(i);
      }
    }

    // 3) 玩家（最后画，滑行时自然盖在箱子上）
    drawPlayer();

    fx.undoShake(ctx);
  }

  function boxRenderPos(i) {
    var b = boxes[i];
    var rx = b.x, ry = b.y;
    if (tween && tween.kind === 'move' && tween.pushBox === i) {
      var k = tweenK(tween);
      rx = b.fx + (b.x - b.fx) * k;
      ry = b.fy + (b.y - b.fy) * k;
    }
    return [rx, ry];
  }

  function drawBoxAt(i) {
    var rp = boxRenderPos(i);
    var c = cellPx(rp[0], rp[1]);
    SokoThemes.drawBox(ctx, theme.sceneId, c[0], c[1], tile, optsCache, isGoal(boxes[i].x, boxes[i].y));
  }

  function playerRenderPos() {
    // 无补间时渲染逻辑位置；补间从 fx,fy（出发格）插值到 x,y（目标格）。
    // 之前默认返回 fx,fy，导致每次移动动画结束后角色「弹回」出发格（纯渲染 bug）。
    var rx = player.x, ry = player.y;
    if (tween && tween.kind === 'move') {
      var k = tweenK(tween);
      rx = player.fx + (player.x - player.fx) * k;
      ry = player.fy + (player.y - player.fy) * k;
    } else if (tween && tween.kind === 'bump') {
      var k2 = tweenK(tween);
      var off = Math.sin(k2 * Math.PI) * 0.16;
      var v = DIRV[tween.dir] || [0, 0];
      rx = player.x + v[0] * off;
      ry = player.y + v[1] * off;
    }
    return [rx, ry];
  }

  function drawPlayer() {
    var rp = playerRenderPos();
    var c = cellPx(rp[0], rp[1]);
    var cx = c[0] + tile / 2;
    var cy = c[1] + tile * 0.86;
    var walk = (tween && tween.kind === 'move') ? tweenK(tween) : 0;
    SokoThemes.drawCharacter(ctx, theme.charId, cx, cy, tile, facing, walk, optsCache);
  }

  function tweenK(t) {
    var el = timeNow() - t.t0;
    return easeOut(clamp(el / (t.kind === 'bump' ? BUMP_MS : TWEEN_MS), 0, 1));
  }

  // ============================================================
  // 玩法：移动 / 推箱 / 撤销
  // ============================================================
  var perfNow = (global.performance && global.performance.now) ? function () { return global.performance.now(); } : function () { return Date.now(); };
  function timeNow() { return perfNow(); }

  function tryMove(dir) {
    if (state !== STATE.PLAY || tween || celebrating) return;
    var v = DIRV[dir];
    if (!v) return;
    facing = dir;
    var nx = player.x + v[0];
    var ny = player.y + v[1];
    if (grid.isWall[ny] && grid.isWall[ny][nx]) { bump(dir); return; }
    var bi = boxAt(nx, ny);
    if (bi >= 0) {
      var bx = nx + v[0];
      var by = ny + v[1];
      if ((grid.isWall[by] && grid.isWall[by][bx]) || boxAt(bx, by) >= 0) { bump(dir); return; }
      // 推箱
      boxes[bi].fx = nx; boxes[bi].fy = ny;
      boxes[bi].x = bx; boxes[bi].y = by;
      history.push({ dx: v[0], dy: v[1], box: bi });
      moves++; pushes++;
      tween = { kind: 'move', dir: dir, t0: timeNow(), pushBox: bi };
      audio.sfx('push');
      updateHud();
    } else {
      history.push({ dx: v[0], dy: v[1], box: -1 });
      moves++;
      tween = { kind: 'move', dir: dir, t0: timeNow(), pushBox: -1 };
      audio.sfx('step');
      updateHud();
    }
    player.fx = player.x; player.fy = player.y;
    player.x = nx; player.y = ny;
  }

  function bump(dir) {
    tween = { kind: 'bump', dir: dir, t0: timeNow(), pushBox: -1 };
    var now = timeNow();
    if (now - lastBumpSfx > 140) {
      lastBumpSfx = now;
      audio.sfx('bump');
      fx.shake(1.6, 110);
    }
  }

  function finishTween() {
    var kind = tween.kind;
    var pushBox = tween.pushBox;
    tween = null;
    if (kind === 'move') {
      if (pushBox >= 0 && isGoal(boxes[pushBox].x, boxes[pushBox].y)) {
        audio.sfx('goal');
        var c = cellPx(boxes[pushBox].x, boxes[pushBox].y);
        fx.burst(c[0] + tile / 2, c[1] + tile / 2, {
          count: 14, colors: ['#ffd98c', '#fff3b0', '#ffe9b0'],
          speed: [40, 130], size: [2, 5], life: [0.35, 0.7], g: 220
        });
      }
      checkWin();
    }
    if (state === STATE.PLAY && queue.length) {
      var d = queue.shift();
      tryMove(d);
    }
  }

  function undo() {
    if (state !== STATE.PLAY || tween || celebrating || !history.length) return;
    var e = history.pop();
    player.x -= e.dx;
    player.y -= e.dy;
    if (e.box >= 0) {
      boxes[e.box].x -= e.dx;
      boxes[e.box].y -= e.dy;
      pushes--;
    }
    moves--;
    player.fx = player.x; player.fy = player.y;
    audio.sfx('undo');
    updateHud();
  }

  function restartLevel() {
    if (state !== STATE.PLAY && state !== STATE.PAUSE) return;
    loadLevel(levelIdx);
    if (state === STATE.PAUSE) {
      state = STATE.PLAY;
      hide('pauseScreen');
      audio.startBGM(SokoThemes.indexOfScene(theme.sceneId));
    }
    audio.sfx('click');
  }

  function checkWin() {
    for (var i = 0; i < boxes.length; i++) {
      if (!isGoal(boxes[i].x, boxes[i].y)) return;
    }
    // 全部到位 -> 胜利
    celebrating = true;
    state = STATE.WIN;
    audio.stopBGM();
    audio.sfx(levelIdx >= LEVELS.length - 1 ? 'victory' : 'levelup');
    fx.confetti({ count: 70, x0: 0, x1: vw, colors: ['#ffd98c', '#8fd3ff', '#ffa1b5', '#b8f0c0', '#d9c9ff'] });

    var best = progress.best[levelIdx];
    var newBest = !best || moves < best.moves ||
      (moves === best.moves && pushes < (best.pushes != null ? best.pushes : 1e9));
    if (!best || moves < best.moves) {
      progress.best[levelIdx] = { moves: moves, pushes: pushes };
    } else if (moves === best.moves && (best.pushes == null || pushes < best.pushes)) {
      best.pushes = pushes;
    }
    if (levelIdx + 2 > progress.unlocked && levelIdx + 1 < LEVELS.length) {
      progress.unlocked = levelIdx + 2;
    }
    saveProgress();
    updateHud();

    global.setTimeout(function () {
      if (state !== STATE.WIN) return; // 庆祝窗内已离开（如立刻返回选关），不再弹层
      var isLast = levelIdx >= LEVELS.length - 1;
      $('winTitle').textContent = isLast ? '全部通关！' : '关卡完成！';
      $('winStats').textContent =
        '第 ' + (levelIdx + 1) + ' 关 · 步数 ' + moves + '（参考 ' + LEVELS[levelIdx].par + '）· 推箱 ' + pushes;
      $('winBest').textContent = newBest ? '新纪录！' :
        ('最佳 ' + (progress.best[levelIdx] ? progress.best[levelIdx].moves : moves) + ' 步');
      if (isLast) { hide('btnNext'); } else { show('btnNext'); }
      show('winScreen');
      if (window.TVNav && !global.__tvControlsInjected) TVNav.init();
    }, 700);
  }

  // ============================================================
  // 状态机
  // ============================================================
  var menuView = 'home'; // MENU 下的子视图：'home' 开始页 | 'custom' 自定义装扮

  function gotoMenu() {
    state = STATE.MENU;
    menuView = 'home';
    audio.stopBGM();
    hide('levelScreen'); hide('pauseScreen'); hide('winScreen'); hide('customScreen');
    show('startScreen'); hide('hud'); updateHud();
    refreshPickRows();
    if (window.TVNav && !global.__tvControlsInjected) TVNav.init();
  }

  function openCustom() {
    if (state !== STATE.MENU) return;
    menuView = 'custom';
    hide('startScreen');
    show('customScreen');
    refreshPickRows();
    audio.sfx('click');
    if (window.TVNav && !global.__tvControlsInjected) TVNav.init();
  }

  function closeCustom() {
    if (state !== STATE.MENU || menuView !== 'custom') return;
    menuView = 'home';
    hide('customScreen');
    show('startScreen');
    audio.sfx('click');
    if (window.TVNav && !global.__tvControlsInjected) TVNav.init();
  }

  function gotoSelect() {
    state = STATE.SELECT;
    hide('startScreen'); hide('pauseScreen'); hide('winScreen');
    buildLevelGrid();
    show('levelScreen');
    if (window.TVNav && !global.__tvControlsInjected) TVNav.init();
  }

  function startLevel(idx) {
    if (idx < 0 || idx >= LEVELS.length) return;
    if (idx + 1 > progress.unlocked) { audio.sfx('bump'); return; }
    loadLevel(idx);
    state = STATE.PLAY;
    hide('startScreen'); hide('levelScreen'); hide('pauseScreen'); hide('winScreen');
    show('hud');
    audio.resume();
    audio.sfx('start');
    audio.startBGM(SokoThemes.indexOfScene(theme.sceneId));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function pauseGame() {
    if (state !== STATE.PLAY || celebrating) return;
    state = STATE.PAUSE;
    audio.stopBGM();
    show('pauseScreen');
    if (window.TVNav && !global.__tvControlsInjected) TVNav.init();
  }

  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    state = STATE.PLAY;
    hide('pauseScreen');
    audio.startBGM(SokoThemes.indexOfScene(theme.sceneId));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function onBack() {
    audio.sfx('click');
    if (state === STATE.PLAY) pauseGame();
    else if (state === STATE.PAUSE) resumeGame();
    else if (state === STATE.SELECT) gotoMenu();
    else if (state === STATE.WIN) gotoSelect();
    else if (state === STATE.MENU && menuView === 'custom') closeCustom();
    // MENU(home)：被 history 陷阱拦住，保持不离开
  }

  // ============================================================
  // HUD
  // ============================================================
  function updateHud() {
    var lv = LEVELS[levelIdx];
    if ($('hudLevel')) $('hudLevel').textContent = lv ? lv.name : '';
    if ($('hudSteps')) $('hudSteps').textContent = '步数 ' + moves;
    if ($('hudPushes')) $('hudPushes').textContent = '推箱 ' + pushes;
    if ($('hudPar')) $('hudPar').textContent = lv ? ('参考 ' + lv.par) : '';
    var best = progress.best[levelIdx];
    if ($('hudBest')) {
      $('hudBest').textContent = best ? ('最佳 ' + best.moves + '步' + (best.pushes != null ? '/' + best.pushes + '推' : '')) : '最佳 —';
    }
  }

  // ============================================================
  // 主题选择 UI（套装 / 角色 / 场景 / 风格）
  // ============================================================
  function buildPickRow(rowId, items, selId, onPick, labelOf) {
    var row = $(rowId);
    if (!row) return;
    row.innerHTML = '';
    var i;
    for (i = 0; i < items.length; i++) {
      (function (item, index) {
        var b = document.createElement('button');
        b.className = 'pick';
        b.setAttribute('data-tv-focus', '');
        b.setAttribute('data-idx', String(index));
        var main = document.createElement('span');
        main.className = 'pick-name';
        main.textContent = labelOf(item);
        var sub = document.createElement('span');
        sub.className = 'pick-sub';
        sub.textContent = item.desc || item.short || '';
        b.appendChild(main);
        b.appendChild(sub);
        b.addEventListener('click', function () { onPick(index); });
        row.appendChild(b);
      })(items[i], i);
    }
    row.setAttribute('data-sel', selId);
  }

  function markSel(rowId, selIdx, accent) {
    var row = $(rowId);
    if (!row) return;
    var kids = row.children;
    for (var i = 0; i < kids.length; i++) {
      var on = (i === selIdx);
      kids[i].className = 'pick' + (on ? ' sel' : '');
      kids[i].style.borderColor = on ? accent : '';
      kids[i].style.color = on ? accent : '';
    }
  }

  // 行只构建一次（数据静态）：每次点选都重建会销毁被聚焦的按钮，
  // 焦点掉回 body 后 tv-controls 的方向键导航就失效了（启动器内必现）。
  function initPickRows() {
    buildPickRow('packRow', SokoThemes.PACKS, 'pack', function (i) { pickPack(i); }, function (p) { return p.name; });
    buildPickRow('charRow', SokoThemes.CHARACTERS, 'char', function (i) { pickCharacter(SokoThemes.CHARACTERS[i].id); }, function (c) { return c.name; });
    buildPickRow('sceneRow', SokoThemes.SCENES, 'scene', function (i) { pickScene(SokoThemes.SCENES[i].id); }, function (sc) { return sc.name; });
  }

  function refreshPickRows() {
    var packIdx = packIndexOfCurrent();
    var pk = SokoThemes.PACKS[packIdx] || SokoThemes.PACKS[0];
    var charIdx = SokoThemes.indexOfCharacter(theme.charId);
    var sceneIdx = SokoThemes.indexOfScene(theme.sceneId);
    markSel('packRow', packIdx >= 0 ? packIdx : 0, pk.accent);
    markSel('charRow', charIdx >= 0 ? charIdx : 0, pk.accent);
    markSel('sceneRow', sceneIdx >= 0 ? sceneIdx : 0, pk.accent);
    markStyleButtons();
  }

  function packIndexOfCurrent() {
    var i;
    for (i = 0; i < SokoThemes.PACKS.length; i++) {
      if (SokoThemes.PACKS[i].char === theme.charId && SokoThemes.PACKS[i].scene === theme.sceneId) return i;
    }
    return -1; // 自由混搭中，不属于任何套装
  }

  function pickPack(i) {
    var p = SokoThemes.PACKS[i];
    if (!p) return;
    theme.charId = p.char;
    theme.sceneId = p.scene;
    theme.linked = true;
    saveTheme();
    audio.sfx('click');
    refreshPickRows();
    rebuildBackdropForce();
  }

  function pickCharacter(id) {
    if (SokoThemes.indexOfCharacter(id) < 0) return;
    theme.charId = id;
    if (theme.linked) {
      // 联动：角色带上它所属套装的默认场景
      var i;
      for (i = 0; i < SokoThemes.PACKS.length; i++) {
        if (SokoThemes.PACKS[i].char === id) { theme.sceneId = SokoThemes.PACKS[i].scene; break; }
      }
    }
    saveTheme();
    audio.sfx('click');
    refreshPickRows();
    rebuildBackdropForce();
  }

  function pickScene(id) {
    if (SokoThemes.indexOfScene(id) < 0) return;
    theme.sceneId = id;
    theme.linked = false; // 手动改场景即解除联动
    saveTheme();
    audio.sfx('click');
    refreshPickRows();
    rebuildBackdropForce();
  }

  function relink() {
    theme.linked = true;
    // 找到与当前场景配套的套装：先把场景恢复成当前角色所属套装的场景
    var i;
    for (i = 0; i < SokoThemes.PACKS.length; i++) {
      if (SokoThemes.PACKS[i].char === theme.charId) { theme.sceneId = SokoThemes.PACKS[i].scene; break; }
    }
    saveTheme();
    audio.sfx('click');
    refreshPickRows();
    rebuildBackdropForce();
  }

  function rebuildBackdropForce() {
    backdropKey = '';
    backdrop = null;
    if (grid) rebuildBackdrop();
  }

  function markStyleButtons() {
    if ($('btnSolid')) {
      $('btnSolid').textContent = theme.solid ? '立体方块' : '平面俯视';
      $('btnSolid').style.color = '#8fd3ff';
    }
    if ($('btnContrast')) {
      $('btnContrast').textContent = theme.contrast ? '高对比：开' : '高对比：关';
      $('btnContrast').style.color = theme.contrast ? '#ffd98c' : '';
    }
  }

  // ============================================================
  // 选关
  // ============================================================
  function buildLevelGrid() {
    var wrap = $('levelGrid');
    if (!wrap) return;
    wrap.innerHTML = '';
    var i;
    for (i = 0; i < LEVELS.length; i++) {
      (function (idx) {
        var unlocked = idx + 1 <= progress.unlocked;
        var b = document.createElement('button');
        b.className = 'lv' + (unlocked ? '' : ' locked');
        b.setAttribute('data-tv-focus', '');
        var best = progress.best[idx];
        var name = LEVELS[idx].name.replace(/^L\d+\s*/, '');
        var num = document.createElement('span');
        num.className = 'lv-num';
        num.textContent = unlocked ? String(idx + 1) : '—';
        var sub = document.createElement('span');
        sub.className = 'lv-sub';
        if (!unlocked) {
          sub.textContent = '未解锁';
          b.disabled = true;
        } else if (best) {
          sub.textContent = '最佳 ' + best.moves;
        } else {
          sub.textContent = name;
        }
        b.appendChild(num);
        b.appendChild(sub);
        if (unlocked) {
          b.addEventListener('click', function () { startLevel(idx); });
        }
        wrap.appendChild(b);
      })(i);
    }
  }

  // ============================================================
  // 输入绑定
  // ============================================================
  // 设备/启动器链路可能对同一次按键双投递（真实 keydown + 转发/按键 repeat 各一发）：
  // 第一发走格、第二发在补间中排队 -> 一次点击多走一步，顶到墙就表现为「回弹」。
  // 防御：同方向 90ms 内的重复事件丢弃（补间 130ms 限速下，按住连走的供给仍然充足）；
  // 队列内不再缓存与队尾相同的方向；OK/返回键同款防抖，防「一下暂停又立即恢复」。
  var lastDirName = '', lastDirAt = 0, lastConfirmAt = 0, lastBackAt = 0;

  TVInput.on('dir', function (d) {
    audio.resume();
    var now = timeNow();
    if (d === lastDirName && now - lastDirAt < 90) { lastDirAt = now; return; }
    lastDirName = d; lastDirAt = now;
    if (state === STATE.PLAY) {
      if (tween) {
        if (queue.length < 2 && queue[queue.length - 1] !== d) queue.push(d);
      } else {
        tryMove(d);
      }
    } else if (window.TVNav && !global.__tvControlsInjected) {
      TVNav.move(d);
    }
  });

  TVInput.on('confirm', function () {
    audio.resume();
    var now = timeNow();
    if (now - lastConfirmAt < 150) return;
    lastConfirmAt = now;
    if (state === STATE.PLAY) {
      pauseGame();          // 对局中 OK = 暂停
    } else if (window.TVNav && !global.__tvControlsInjected) {
      TVNav.confirm();
    }
  });

  TVInput.on('back', function () {
    var now = timeNow();
    if (now - lastBackAt < 150) return;
    lastBackAt = now;
    onBack();
  });

  // 桌面键盘快捷键（开始页 hint 与 README 承诺的 U 撤销 / R 重开）。
  // 不走 TVInput：遥控器没有这两个物理键，且 shared/input.js 是公共层，
  // 不宜为单个游戏扩充键位表；这里只在本游戏内补一个本地监听。
  global.addEventListener('keydown', function (e) {
    var k = e.key;
    var code = e.keyCode || e.which;
    var isU = k === 'u' || k === 'U' || code === 85;
    var isR = k === 'r' || k === 'R' || code === 82;
    if (!isU && !isR) return;
    if (isU) {
      if (state !== STATE.PLAY) return;
      if (e.preventDefault) e.preventDefault();
      undo();
    } else {
      if (state !== STATE.PLAY && state !== STATE.PAUSE) return;
      if (e.preventDefault) e.preventDefault();
      restartLevel();
    }
  }, false);

  // 返回键 history 陷阱（与 number-runner 同构，STANDARD §4）
  function setupBackTrap() {
    if (!global.history || !global.history.pushState) return;
    if (global.__tvControlsInjected) return;
    function mark() { try { global.history.pushState({ sk: 1 }, ''); } catch (e) { /* 忽略 */ } }
    mark();
    global.addEventListener('popstate', function () {
      if (global.__tvControlsInjected) return;
      mark();
      onBack();
    });
  }

  // 切后台/失焦自动暂停（恢复必须玩家手动，STANDARD §9）
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseGame();
  });
  global.addEventListener('blur', function () { pauseGame(); }, false);

  // ============================================================
  // 按钮绑定
  // ============================================================
  function bind(id, fn) {
    var el = $(id);
    if (el) el.addEventListener('click', function () { audio.resume(); fn(); });
  }

  bind('btnStart', function () { startLevel(Math.min(progress.unlocked, LEVELS.length) - 1); });
  bind('btnCustom', openCustom);
  bind('btnCustomBack', closeCustom);
  bind('btnLevels', gotoSelect);
  bind('btnLink', relink);
  bind('btnSolid', function () {
    theme.solid = !theme.solid;
    saveTheme(); markStyleButtons(); audio.sfx('click');
  });
  bind('btnContrast', function () {
    theme.contrast = !theme.contrast;
    saveTheme(); markStyleButtons(); rebuildBackdropForce(); audio.sfx('click');
  });
  bind('btnMute', function () { applyMute(audio.toggleMute()); });
  bind('btnMutePause', function () { applyMute(audio.toggleMute()); });
  bind('btnLevelBack', gotoMenu);
  bind('btnResume', resumeGame);
  bind('btnRestart', restartLevel);
  bind('btnPauseLevels', gotoSelect);
  bind('btnNext', function () {
    if (levelIdx + 1 < LEVELS.length) startLevel(levelIdx + 1);
    else gotoSelect();
  });
  bind('btnReplay', function () { startLevel(levelIdx); });
  bind('btnWinBack', gotoSelect);
  bind('btnUndo', undo);
  bind('btnHudRestart', restartLevel);
  bind('btnHudPause', pauseGame);

  function applyMute(m) {
    if ($('btnMute')) $('btnMute').textContent = m ? '音效：关' : '音效：开';
    if ($('btnMutePause')) $('btnMutePause').textContent = m ? '音效：关' : '音效：开';
    audio.sfx('click');
  }

  // ============================================================
  // 主循环
  // ============================================================
  var rafLast = 0;
  function loop(ts) {
    var dt = rafLast ? Math.min(0.05, (ts - rafLast) / 1000) : 0.016;
    rafLast = ts;
    timeSec += dt;

    if (tween && timeNow() - tween.t0 >= (tween.kind === 'bump' ? BUMP_MS : TWEEN_MS)) {
      finishTween();
    }
    if (state === STATE.PLAY && !tween && queue.length) {
      tryMove(queue.shift());
    }

    render();
    fx.update(dt);
    if (fctx) {
      fctx.clearRect(0, 0, vw, vh);
      fx.drawBack(fctx);
      fx.drawFront(fctx);
    }
    global.requestAnimationFrame(loop);
  }

  // ============================================================
  // 调试钩子：仅 URL 带 #debug 时挂出（与 brick-breaker / flipping-bird 一致）
  // ============================================================
  if (global.location && global.location.hash === '#debug') {
    global.__soko = {
      state: function () { return state; },
      startLevel: startLevel,
      tryMove: tryMove,
      undo: undo,
      restart: restartLevel,
      pause: pauseGame,
      resume: resumeGame,
      progress: function () { return progress; },
      theme: function () { return theme; },
      counts: function () { return { moves: moves, pushes: pushes, history: history.length, queue: queue.length }; },
      boxes: function () { return boxes; },
      player: function () { return player; },
      renderPos: function () { var p = playerRenderPos(); return { x: p[0], y: p[1] }; },
      layout: function () {
        return { vw: vw, vh: vh, dpr: dpr, tile: tile, bx0: bx0, by0: by0,
                 cols: grid ? grid.w : 0, rows: grid ? grid.h : 0 };
      },
      setPack: pickPack,
      setChar: pickCharacter,
      setScene: pickScene,
      relink: relink,
      pump: finishTween
    };
  }

  // ============================================================
  // 启动
  // ============================================================
  global.addEventListener('resize', resize, false);
  if (document.readyState === 'complete') { setupBackTrap(); }
  else { global.addEventListener('load', setupBackTrap); }

  // 触屏设备：隐藏键盘操作提示（同 number-runner 惯例）
  if ('ontouchstart' in global || (global.navigator && global.navigator.maxTouchPoints > 0)) {
    document.body.className += ' is-touch';
  }

  resize();
  initPickRows();
  gotoMenu();
  global.requestAnimationFrame(loop);
})(typeof window !== 'undefined' ? window : this);

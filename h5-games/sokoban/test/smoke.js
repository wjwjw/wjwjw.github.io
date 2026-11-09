/* smoke.js —— 推箱子冒烟测试（纯 Node，无浏览器）
 * 运行：node h5-games/sokoban/test/smoke.js
 * 覆盖：shared 门禁（lint-shared）、index.html 脚本清单、ES5 静态扫描、
 *       关卡数据合法性、套装/混搭/风格配置、选关解锁、L1 通关流转、
 *       undo、撞墙、自动暂停、返回键陷阱。
 * 用法与其他游戏一致：canvas/DOM stub + vm 跑状态机（STANDARD §10.5）。 */
'use strict';
require('../../test/lint-shared.js');

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var GAME_DIR = path.join(__dirname, '..');
var passed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('[smoke] FAIL: ' + msg);
    process.exit(1);
  }
  passed++;
  console.log('[smoke] ok: ' + msg);
}

// ============================================================
// 1) index.html 静态检查：脚本/样式清单 + 返回键兜底
// ============================================================
var html = fs.readFileSync(path.join(GAME_DIR, 'index.html'), 'utf8');
[
  '../shared/base.css', 'style.css',
  '../shared/input.js', '../shared/fx.js', '../shared/nav.js',
  'js/audio.js', 'js/themes.js', 'js/levels.js', 'js/game.js'
].forEach(function (s) {
  assert(html.indexOf(s) !== -1, 'index.html 引用 ' + s);
});
assert(html.indexOf('TVLauncher') !== -1, 'index.html 有 TVLauncher.handleBack 兜底');

// ============================================================
// 2) ES5 / 兼容性静态扫描（游戏自身文件）
// ============================================================
var JS_BANNED = [
  [/=>/, '箭头函数'],
  [/\blet\s/, 'let'],
  [/\bconst\s/, 'const'],
  [/\bclass\s/, 'class'],
  [/`/, '模板字符串'],
  [/\.includes\(/, '.includes'],
  [/\.padStart\(|\.padEnd\(/, '.padStart/.padEnd'],
  [/Object\.assign|Object\.entries|Object\.values/, 'Object.assign/entries/values'],
  [/\.\.\./, '展开运算符'],
  [/for\s*\(\s*var\s+\w+\s+of\s/, 'for...of']
];
['js/audio.js', 'js/themes.js', 'js/game.js'].forEach(function (f) {
  var src = fs.readFileSync(path.join(GAME_DIR, f), 'utf8');
  JS_BANNED.forEach(function (b) {
    assert(!b[0].test(src), f + ' 无 ' + b[1]);
  });
});
var css = fs.readFileSync(path.join(GAME_DIR, 'style.css'), 'utf8');
[/display\s*:\s*grid/, /(^|[^-])gap\s*:/, /(^|[^-])inset\s*:/, /var\(--/, /min\(|max\(|clamp\(/, /color-mix/, /backdrop-filter/].forEach(function (re) {
  assert(!re.test(css), 'style.css 无禁用 CSS: ' + re);
});

// ============================================================
// 3) DOM / Canvas / localStorage stub
// ============================================================
function makeCtx2D() {
  var gradient = { addColorStop: function () {} };
  return {
    canvas: null,
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '', textAlign: '', textBaseline: '',
    lineCap: '', lineJoin: '', shadowBlur: 0, shadowColor: '', imageSmoothingEnabled: true,
    setTransform: function () {}, transform: function () {},
    save: function () {}, restore: function () {},
    translate: function () {}, rotate: function () {}, scale: function () {},
    clearRect: function () {}, fillRect: function () {}, strokeRect: function () {},
    drawImage: function () {},
    beginPath: function () {}, closePath: function () {},
    moveTo: function () {}, lineTo: function () {},
    arc: function () {}, ellipse: function () {},
    quadraticCurveTo: function () {}, bezierCurveTo: function () {},
    rect: function () {}, clip: function () {},
    fill: function () {}, stroke: function () {},
    fillText: function () {}, strokeText: function () {},
    measureText: function () { return { width: 10 }; },
    createLinearGradient: function () { return gradient; },
    createRadialGradient: function () { return gradient; },
    createPattern: function () { return gradient; },
    setLineDash: function () {}
  };
}
function makeCanvasEl() {
  var c = {
    width: 300, height: 150, style: {}, disabled: false,
    addEventListener: function () {}, removeEventListener: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 300, height: 150 }; },
    getContext: function () {
      var g = makeCtx2D();
      g.canvas = c;
      return g;
    }
  };
  return c;
}
function makeElement(id) {
  var listeners = {};
  var el = {
    id: id, tagName: 'DIV', style: {}, disabled: false,
    textContent: '', className: '',
    children: [], parentNode: null,
    offsetParent: {},
    classList: {
      add: function () {}, remove: function () {}, toggle: function () {},
      contains: function () { return false; }
    },
    setAttribute: function () {}, getAttribute: function () { return null; },
    appendChild: function (ch) { el.children.push(ch); ch.parentNode = el; return ch; },
    removeChild: function (ch) {
      var i = el.children.indexOf(ch);
      if (i >= 0) el.children.splice(i, 1);
    },
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: function () {},
    dispatch: function (type) {
      (listeners[type] || []).forEach(function (fn) { fn({ preventDefault: function () {} }); });
    },
    click: function () { (listeners.click || []).forEach(function (fn) { fn({ preventDefault: function () {} }); }); },
    focus: function () {}, blur: function () {},
    scrollIntoView: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 100, height: 60 }; }
  };
  var inner = '';
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return inner; },
    set: function (v) { inner = v; if (!v) el.children.length = 0; }
  });
  return el;
}

var els = {};
var docListeners = {};
var winListeners = {};
var storage = {};
var docHidden = false;
var fakeNow = 0;
var rafCb = null;

function pump(frames) {
  for (var i = 0; i < frames; i++) {
    fakeNow += 16.7;
    var cb = rafCb;
    rafCb = null;
    if (cb) cb(fakeNow);
  }
}

var documentStub = {
  readyState: 'complete',
  hidden: false,
  activeElement: null,
  body: makeElement('body'),
  getElementById: function (id) {
    if (!els[id]) {
      els[id] = (id === 'game' || id === 'fx2d') ? makeCanvasEl() : makeElement(id);
    }
    return els[id];
  },
  createElement: function (tag) { return tag === 'canvas' ? makeCanvasEl() : makeElement(tag); },
  addEventListener: function (type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener: function () {},
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; }
};

var sandboxWindow = {
  console: console,
  innerWidth: 960,
  innerHeight: 540,
  devicePixelRatio: 1,
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem: function (k, v) { storage[k] = String(v); },
    removeItem: function (k) { delete storage[k]; }
  },
  addEventListener: function (type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
  removeEventListener: function () {},
  requestAnimationFrame: function (cb) { rafCb = cb; return 1; },
  performance: { now: function () { return fakeNow; } },
  setTimeout: function (fn) { fn(); return 0; },          // 同步执行，方便断言
  clearTimeout: function () {},
  setInterval: function () { return 0; },
  clearInterval: function () {},
  history: { pushState: function () {} },
  location: { href: 'http://localhost/h5-games/sokoban/index.html#debug', search: '', hash: '#debug' },
  navigator: { userAgent: 'node-smoke', maxTouchPoints: 0 },
  document: documentStub
};
sandboxWindow.window = sandboxWindow;
sandboxWindow.self = sandboxWindow;
documentStub.hidden = false;

function load(file) {
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandboxWindow, { filename: file });
}

// ============================================================
// 4) 加载 shared + 游戏脚本（顺序与 index.html 一致）
// ============================================================
load(path.join(__dirname, '..', '..', 'shared', 'input.js'));
load(path.join(__dirname, '..', '..', 'shared', 'fx.js'));
load(path.join(__dirname, '..', '..', 'shared', 'nav.js'));
load(path.join(GAME_DIR, 'js', 'audio.js'));
load(path.join(GAME_DIR, 'js', 'themes.js'));
load(path.join(GAME_DIR, 'js', 'levels.js'));
load(path.join(GAME_DIR, 'js', 'game.js'));

var S = sandboxWindow.__soko;
assert(typeof S === 'object' && S, 'game.js 暴露 __soko 调试钩子');
assert(!!sandboxWindow.TVInput && !!sandboxWindow.FX && !!sandboxWindow.TVNav, 'shared 三件套加载');

// ============================================================
// 5) 关卡数据
// ============================================================
var LEVELS = sandboxWindow.LEVELS;
assert(LEVELS.length === 18, '共 18 关');
LEVELS.forEach(function (lv, i) {
  var boxes = 0, goals = 0, players = 0;
  lv.grid.forEach(function (row) {
    for (var c = 0; c < row.length; c++) {
      var ch = row.charAt(c);
      if (ch === '$' || ch === '*') boxes++;
      if (ch === '.' || ch === '*' || ch === '+') goals++;
      if (ch === '@' || ch === '+') players++;
    }
  });
  assert(boxes === goals && boxes > 0 && players === 1,
    '第 ' + (i + 1) + ' 关数据合法（' + lv.name + '，' + boxes + ' 箱）');
  assert(typeof lv.par === 'number' && lv.par > 0, '第 ' + (i + 1) + ' 关有参考步数');
});

// ============================================================
// 6) 主题：套装联动 / 自由混搭 / 风格持久化
// ============================================================
assert(sandboxWindow.SokoThemes.PACKS.length === 4, '4 套预设套装');
assert(sandboxWindow.SokoThemes.CHARACTERS.length === 4, '4 个角色');
assert(sandboxWindow.SokoThemes.SCENES.length === 4, '4 个场景');
sandboxWindow.SokoThemes.PACKS.forEach(function (p) {
  assert(sandboxWindow.SokoThemes.indexOfCharacter(p.char) >= 0 &&
         sandboxWindow.SokoThemes.indexOfScene(p.scene) >= 0,
    '套装 ' + p.id + ' 的角色/场景存在');
});

S.setPack(2); // 冰雪小企鹅
assert(S.theme().charId === 'penguin' && S.theme().sceneId === 'ice', '套装一键整配（冰雪）');
S.setChar('astro');
assert(S.theme().charId === 'astro' && S.theme().sceneId === 'space', '选角色联动配套场景');
S.setScene('ice');
assert(S.theme().sceneId === 'ice' && S.theme().linked === false, '手改场景解除联动');
S.relink();
assert(S.theme().sceneId === 'space' && S.theme().linked === true, '恢复配套');

els.btnSolid.click();
assert(S.theme().solid === false && JSON.parse(storage.sokoTheme).solid === false, '立体/平面切换并持久化');
els.btnContrast.click();
assert(S.theme().contrast === true, '高对比切换');
els.btnSolid.click();
els.btnContrast.click();
assert(S.theme().solid === true && S.theme().contrast === false, '风格恢复默认');

// ============================================================
// 7) 选关 / 解锁
// ============================================================
assert(S.progress().unlocked === 1, '初始只解锁第 1 关');
S.startLevel(1);
assert(S.state() === 'menu', '未解锁关卡不可进入');
els.btnLevels.click();
assert(S.state() === 'select', '进入选关页');
assert(els.levelGrid.children.length === 18, '选关页渲染 18 个按钮');
assert(els.levelGrid.children[1].disabled === true, '未解锁按钮 disabled');
els.btnLevelBack.click();
assert(S.state() === 'menu', '返回开始页');

// ============================================================
// 8) L1 通关流转（解析第 1 关布局得出唯一推箱方向）
// ============================================================
(function () {
  var g = LEVELS[0].grid;
  var px = -1, py = -1, bx = -1, by = -1, gx = -1;
  g.forEach(function (row, y) {
    for (var x = 0; x < row.length; x++) {
      var ch = row.charAt(x);
      if (ch === '@') { px = x; py = y; }
      if (ch === '$') { bx = x; by = y; }
      if (ch === '.') { gx = x; }
    }
  });
  assert(py === by && gx === bx + 1 && bx === px + 1, 'L1 是「一次右推」教学关');

  S.startLevel(0);
  assert(S.state() === 'playing', '开始第 1 关');
  pump(3);
  sandboxWindow.TVInput.trigger('dir', 'right');
  pump(14);
  assert(S.state() === 'win', '推一步后胜利');
  assert(S.counts().moves === 1 && S.counts().pushes === 1, '步数/推数记账 1/1');
  assert(S.progress().unlocked === 2, '通关解锁第 2 关');
  assert(S.progress().best[0] && S.progress().best[0].moves === 1, '写入最佳纪录');
  assert(els.winStats.textContent.indexOf('第 1 关') !== -1, '过关页显示成绩');
  els.btnNext.click();
  assert(S.state() === 'playing', '下一关按钮进入第 2 关');
})();

// ============================================================
// 9) 撤销 / 撞墙
// ============================================================
(function () {
  pump(2);
  // 第 2 关：玩家 (2,4)。向上走一步再撤销
  sandboxWindow.TVInput.trigger('dir', 'up');
  pump(14);
  assert(S.counts().moves === 1, '走一步记账');
  S.undo();
  pump(2);
  assert(S.counts().moves === 0 && S.counts().pushes === 0, '撤销还原计数');
  assert(S.player().y === 4, '撤销还原玩家位置');
  assert(els.hudSteps.textContent.indexOf('0') !== -1, 'HUD 同步刷新');

  // 向下走到边界再向下 = 撞墙（步数不增）
  sandboxWindow.TVInput.trigger('dir', 'down');
  pump(14);
  sandboxWindow.TVInput.trigger('dir', 'down');
  pump(14);
  assert(S.counts().moves === 1, '撞墙不移动不记账');
})();

// ============================================================
// 9.4) 渲染位置一致性：补间结束后角色必须停在逻辑格（回归测试：
//      playerRenderPos 曾默认返回 fx,fy 导致移动后角色「弹回」出发格）
// ============================================================
(function () {
  S.startLevel(0); // L1 玩家 (2,2)
  pump(2);
  sandboxWindow.TVInput.trigger('dir', 'up'); // (2,2)->(2,1)
  pump(6); // 补间中：渲染位置应介于出发格与目标格之间
  var mid = S.renderPos();
  assert(mid.y > 1.9 && mid.y < 2.1 || mid.y >= 1 && mid.y <= 2, '补间中渲染位置平滑');
  pump(14); // 补间结束
  assert(S.renderPos().y === 1 && S.renderPos().x === 2,
    '补间结束后渲染位置 == 逻辑格（不弹回出发格）');
  assert(S.player().y === 1, '逻辑位置一致');
  S.undo();
  pump(2);
  assert(S.renderPos().y === 2, '撤销后渲染位置 == 逻辑格');
})();

// ============================================================
// 9.5) 双投递防御：同方向快速重复事件只认一次
// ============================================================
(function () {
  S.startLevel(0); // L1 玩家 (2,2)
  pump(2);
  // 同步两发同方向（fakeNow 未推进 = 0ms 间隔）：第一发走格，第二发应被丢弃
  sandboxWindow.TVInput.trigger('dir', 'up');
  sandboxWindow.TVInput.trigger('dir', 'up');
  pump(14);
  assert(S.counts().moves === 1 && S.player().y === 1, '双投递去重：90ms 内同方向只走一步');
  assert(S.counts().queue === 0, '双投递去重：队列无堆积');

  // 超过去重窗口后的同方向事件仍有效（此处 (2,1) 上方是墙 -> bump，不记账不抛错）
  fakeNow += 300;
  sandboxWindow.TVInput.trigger('dir', 'up');
  pump(14);
  assert(S.counts().moves === 1, '窗口外事件正常受理（撞墙不记账）');

  // 队列同方向去重：补间中连续两发（间隔 >90ms）只缓存一步
  S.startLevel(0);
  pump(2);
  sandboxWindow.TVInput.trigger('dir', 'up');   // tween 开始 (2,2)->(2,1)
  fakeNow += 100;
  sandboxWindow.TVInput.trigger('dir', 'up');   // 入队
  fakeNow += 100;
  sandboxWindow.TVInput.trigger('dir', 'up');   // 队尾已是 up -> 丢弃
  assert(S.counts().queue === 1, '队列同方向去重：最多缓存一步');
  pump(30); // 结算：走一步 + 队列一步在 (2,1) 撞墙
  assert(S.counts().moves === 1 && S.player().y === 1, '队列结算后位置/计数正确');

  // 交替方向不受去重影响
  S.startLevel(0);
  pump(2);
  sandboxWindow.TVInput.trigger('dir', 'left'); // (2,2)->(1,2)
  pump(14);
  fakeNow += 100;
  sandboxWindow.TVInput.trigger('dir', 'right'); // 反向 -> (2,2)
  pump(14);
  assert(S.counts().moves === 2 && S.player().x === 2, '交替方向不被去重误杀');
})();

// ============================================================
// 10) 自动暂停 / popstate 返回
// ============================================================
docHidden = true;
documentStub.hidden = true;
(docListeners.visibilitychange || []).forEach(function (fn) { fn({}); });
assert(S.state() === 'paused', '切后台自动暂停');
docHidden = false;
documentStub.hidden = false;
S.resume();
assert(S.state() === 'playing', '手动恢复');

(winListeners.popstate || []).forEach(function (fn) { fn({}); });
assert(S.state() === 'paused', '返回键（popstate）暂停对局');
S.resume();
assert(S.state() === 'playing', '再次恢复');

// ============================================================
// 10.5) U / R 键盘快捷键（开始页 hint 与 README 都承诺了这两个键）
// ============================================================
(function () {
  function key(k, code) {
    (winListeners.keydown || []).forEach(function (fn) {
      fn({ key: k, keyCode: code, preventDefault: function () {} });
    });
  }
  S.startLevel(0); // L1 玩家 (2,2)
  pump(2);
  key('u', 85);
  assert(S.counts().moves === 0, 'U 键在无历史时不改变计数');
  sandboxWindow.TVInput.trigger('dir', 'up');
  pump(14);
  assert(S.counts().moves === 1, '先走一步供 U 撤销');
  key('U', 85);    // 大写 + keyCode 兜底
  pump(2);
  assert(S.counts().moves === 0 && S.player().y === 2, 'U 键撤销还原位置与计数');
  sandboxWindow.TVInput.trigger('dir', 'up');
  pump(14);
  key('r', 82);
  pump(2);
  assert(S.counts().moves === 0 && S.state() === 'playing', 'R 键重开本关且仍在对局中');
  key('x', 88);
  assert(S.counts().moves === 0, '无关按键不被快捷键拦截');
})();

// ============================================================
// 10.6) 无音频设备降级：AudioContext 构造抛异常不能拖垮移动与按钮
// ============================================================
(function () {
  S.startLevel(0);
  pump(2);
  sandboxWindow.AudioContext = function () { throw new Error('no audio device'); };
  var y0 = S.player().y;
  var err = null;
  try {
    sandboxWindow.TVInput.trigger('dir', 'up');  // 回调首行就是 audio.resume()
    pump(14);
  } catch (e) { err = e.message; }
  assert(!err, 'AudioContext 构造异常不应冒泡到主流程，实际 ' + err);
  assert(S.player().y === y0 - 1 && S.counts().moves === 1,
    '无音频设备时方向键仍能走格并记账（tryMove 的 sfx 在坐标赋值之前）');
  var clickErr = null;
  try { els.btnUndo.click(); } catch (e) { clickErr = e.message; }
  assert(!clickErr, '无音频设备时按钮点击不应抛异常，实际 ' + clickErr);
  delete sandboxWindow.AudioContext;
})();

// ============================================================
// 10.7) 多视口棋盘布局量化（STANDARD §9：覆盖层不遮挡 canvas 内容）
// ============================================================
(function () {
  var HUD_H = 64, PAD = 20;
  // 取格子最多的关卡做最坏情况：小视口 + 大棋盘最容易越界
  var widest = 0, maxCells = 0;
  LEVELS.forEach(function (lv, i) {
    var w = 0;
    lv.grid.forEach(function (r) { w = Math.max(w, r.length); });
    if (w * lv.grid.length > maxCells) { maxCells = w * lv.grid.length; widest = i; }
  });
  S.progress().unlocked = LEVELS.length;
  S.startLevel(widest);
  [[960, 540], [1280, 720], [640, 420], [420, 780]].forEach(function (wh) {
    sandboxWindow.innerWidth = wh[0];
    sandboxWindow.innerHeight = wh[1];
    (winListeners.resize || []).forEach(function (fn) { fn({}); });
    var L = S.layout();
    var right = L.bx0 + L.tile * L.cols;
    var bottom = L.by0 + L.tile * L.rows;
    var tag = wh.join('x') + ' / ' + L.cols + 'x' + L.rows;
    assert(L.tile >= 14 && L.tile <= 96, tag + ' 格子尺寸在钳制区间内');
    assert(L.bx0 >= PAD - 1 && right <= L.vw - PAD + 1, tag + ' 棋盘水平不越界');
    assert(L.by0 >= HUD_H / 2 + PAD - 1 && bottom <= L.vh - PAD + 1,
      tag + ' 棋盘垂直不越界且不被顶部 HUD 遮挡');
    assert(Math.abs((L.bx0 + right) / 2 - L.vw / 2) <= 1, tag + ' 棋盘水平居中');
  });
  sandboxWindow.innerWidth = 960;
  sandboxWindow.innerHeight = 540;
  (winListeners.resize || []).forEach(function (fn) { fn({}); });
  assert(S.layout().vw === 960 && S.layout().vh === 540, '恢复 960x540 基准视口');
})();

// ============================================================
// 11) 重开 / 静音按钮不抛错
// ============================================================
S.restart();
pump(2);
assert(S.state() === 'playing' && S.counts().moves === 0, '重开本关');
els.btnMute.click();
els.btnMutePause.click();
els.btnHudPause.click();
assert(S.state() === 'paused', 'HUD 暂停按钮');
S.resume();

console.log('[smoke] 全部通过：' + passed + ' 项断言');

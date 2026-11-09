/*
 * smoke.js —— 弹球打砖块冒烟测试（纯 Node，无浏览器）
 *
 * 两层断言：
 *   1) 纯逻辑层（js/logic.js）：反射角钳制、挡板反弹、砖块生成、AABB 命中、球速曲线；
 *   2) 行为层（js/game.js 在 vm + DOM stub 里跑）：开局 → OK 发球 → 挡板连续移动 →
 *      挡板反弹 → 掉球掉心 → 掉光结束 → 暂停/恢复 → 过关 / 通关 → 多次 resize。
 *
 * 之所以把逻辑拆到 logic.js，就是为了这里能直接调函数断言，而不是靠「从源码抽片段」。
 * 运行：node test/smoke.js
 */
require('../../test/lint-shared.js');   // 公共层兼容性门禁（STANDARD 第 6 节），失败即退出
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }

// ============================================================
//  最小 DOM / Canvas stub
// ============================================================
const DRAW_PRIMS = ['arc', 'ellipse', 'fillRect', 'strokeRect', 'clearRect', 'fill', 'stroke',
  'bezierCurveTo', 'quadraticCurveTo', 'fillText', 'strokeText', 'clip', 'drawImage', 'rect'];

function makeCtx() {
  const c = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    measureText() { return { width: 10 }; }
  };
  DRAW_PRIMS.forEach(k => { c[k] = function () {}; });
  return c;
}

function makeEl(id) {
  const listeners = {};
  return {
    id,
    textContent: '', className: '', style: {},
    offsetWidth: 100, offsetHeight: 40, offsetParent: {},
    width: 0, height: 0,
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    __fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || { preventDefault() {} })); },
    getContext() { return this.__ctx || (this.__ctx = makeCtx()); },
    focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; }
  };
}

const els = {};
const canvasEl = makeEl('game');
els.game = canvasEl;

const documentStub = {
  readyState: 'complete',
  hidden: false,
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement() { return makeEl('offscreen'); },   // fx.js / 场地预渲染要用
  addEventListener() {},
  querySelectorAll() { return []; }
};

let clock = 1000000;
let rafCb = null;
let timerId = 0;

const sandbox = {
  document: documentStub,
  console,
  Date: { now() { return clock; } },
  localStorage: { getItem() { return null; }, setItem() {} },
  innerWidth: 960,
  innerHeight: 540,
  devicePixelRatio: 1,
  addEventListener() {},
  requestAnimationFrame(cb) { rafCb = cb; return 1; },
  setTimeout() { return ++timerId; },     // 不执行回调：庆祝延后弹卡不会打断状态断言
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
  history: { pushState() {} },
  location: { href: 'http://x/#debug', search: '', hash: '#debug' }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// ============================================================
section('1) 脚本加载（含 shared/fx.js 与 js/logic.js）');
// ============================================================
let loadErr = null;
['../shared/input.js', '../shared/nav.js', '../shared/fx.js',
 'js/logic.js', 'js/audio.js', 'js/game.js'].forEach(rel => {
  if (loadErr) return;
  const file = path.join(ROOT, rel);
  try { vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file }); }
  catch (e) { loadErr = rel + '：' + e.message; }
});
ok(!loadErr, '所有脚本应能加载，实际 ' + loadErr);
ok(typeof sandbox.FX === 'object', 'shared/fx.js 应挂上 window.FX');
ok(typeof sandbox.BrickLogic === 'object', 'js/logic.js 应挂上 window.BrickLogic');
ok(typeof sandbox.__brick === 'object', 'game.js 应暴露 window.__brick 供测试驱动');
if (loadErr || !sandbox.__brick) {
  console.log('\n❌ FAILED  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

const W = sandbox;
const B = W.BrickLogic;
const G = W.__brick;
function frame() { const cb = rafCb; rafCb = null; if (cb) cb(clock); }
function tick(ms) { clock += ms; frame(); }

// ============================================================
section('2) 纯逻辑：反射角钳制（防止水平 / 垂直死循环）');
// ============================================================
function isUnit(d) { return Math.abs(Math.sqrt(d.x * d.x + d.y * d.y) - 1) < 1e-9; }
[[0.999, 0.001], [1, 0], [0, 1], [0, -1], [-0.99, 0.02], [0.0001, -0.0001],
 [-1, -0.001], [0.3, -0.95]].forEach(pair => {
  const d = B.clampDir(pair[0], pair[1]);
  ok(isUnit(d), 'clampDir 应返回单位向量：' + pair);
  ok(Math.abs(d.y) >= Math.sin(B.MIN_T) - 1e-9, 'clampDir 不能接近水平：' + pair);
  ok(Math.abs(d.x) >= Math.cos(B.MAX_T) - 1e-9, 'clampDir 不能接近垂直：' + pair);
  ok((d.x < 0) === (pair[0] < 0) && (d.y < 0) === (pair[1] < 0), 'clampDir 应保留方向符号：' + pair);
});

// ============================================================
section('3) 纯逻辑：挡板反弹与砖块反弹');
// ============================================================
const cHit = B.paddleBounce(500, 500, 140, 0, 1);
const lHit = B.paddleBounce(430, 500, 140, 0, 1);
const rHit = B.paddleBounce(570, 500, 140, 0, 1);
ok(cHit.y < 0 && isUnit(cHit), '挡板中心反弹应向上且为单位向量');
ok(lHit.x < 0, '挡板左边缘应把球打向左');
ok(rHit.x > 0, '挡板右边缘应把球打向右');
ok(Math.abs(lHit.x) > Math.abs(cHit.x), '边缘出球应比中心更平（更好够到边角砖）');
ok(B.paddleBounce(500, 500, 140, 800, 1).x > cHit.x, '挡板向右搓球应把出球角度带向右');

const rect = { x: 100, y: 100, w: 40, h: 20 };
ok(B.hitBrick({ x: 110, y: 105 }, rect, 5) === true, '球心在砖内应判命中');
ok(B.hitBrick({ x: 96, y: 110 }, rect, 5) === true, '圆与矩形边缘相切应判命中');
ok(B.hitBrick({ x: 10, y: 10 }, rect, 5) === false, '远离砖块不应判命中');
ok(B.brickBounce({ x: 120, y: 96 }, rect, 5, 0.4, 1).y < 0, '从上方进砖应翻 y（弹回向上）');
ok(B.brickBounce({ x: 146, y: 110 }, rect, 5, 1, 0.4).x < 0, '从右侧进砖应翻 x（弹回向左）');

// ============================================================
section('4) 纯逻辑：关卡生成与球速曲线');
// ============================================================
for (let lv = 1; lv <= 8; lv++) {
  const d = B.buildLevel(lv);
  ok(d.bricks.length > 0, '第 ' + lv + ' 关应至少有一块砖');
  ok(d.cols === B.GRID_COLS, '第 ' + lv + ' 关列数应固定');
  const stars = d.bricks.filter(b => b.star).length;
  ok(stars === 2, '第 ' + lv + ' 关应恰好两颗星砖（图案砖数恒 ≥2），实际 ' + stars);
  let valid = true;
  d.bricks.forEach(b => {
    if (b.c < 0 || b.c >= d.cols || b.r < 0 || b.r >= d.rows) valid = false;
    if (b.hp < 1 || b.hp > 2 || !b.alive || !b.color) valid = false;
  });
  ok(valid, '第 ' + lv + ' 关砖块坐标 / 血量 / 颜色应合法且可清空');
  ok(JSON.stringify(B.buildLevel(lv)) === JSON.stringify(d), '第 ' + lv + ' 关生成应可复现（固定种子）');
}
ok(B.buildLevel(1).bricks.length !== B.buildLevel(2).bricks.length ||
   JSON.stringify(B.buildLevel(1)) !== JSON.stringify(B.buildLevel(2)), '相邻关卡图案应有变化');
ok(B.levelSpeed(1) === 250, '首关球速应为 250px/s');
ok(B.levelSpeed(2) > B.levelSpeed(1), '球速应逐关递增');
ok(B.levelSpeed(99) === 420, '球速应封顶在 420px/s');

// ============================================================
section('5) 行为：开局 → OK 发球 → 挡板连续移动');
// ============================================================
tick(0);
ok(G.state === 'start', '初始应停在标题页，实际 ' + G.state);
els.btnStart.__fire('click');
tick(0);
ok(G.state === 'ready', '点开始应进入 3-2-1 预备，实际 ' + G.state);
W.TVInput.trigger('confirm');
ok(G.state === 'play', '预备中按 OK 应立即发球，实际 ' + G.state);

const x0 = G.paddle.x;
G.hold('right', true);
tick(100);
const x1 = G.paddle.x;
ok(x1 > x0, '按住右键挡板应持续右移，实际 ' + x0 + ' → ' + x1);
G.hold('right', false);
tick(100);
ok(Math.abs(G.paddle.x - x1) < 0.001, '松开后挡板应停下（不靠 auto-repeat）');
G.hold('left', true);
tick(100);
ok(G.paddle.x < x1, '按住左键挡板应左移');
G.hold('left', false);

// ============================================================
section('6) 行为：挡板接球与掉球掉心');
// ============================================================
G.setBall(G.paddle.x, G.layout.paddleY - 10, 0, 1);
G.updatePlay(0.05);
ok(G.ball.dy < 0, '球从上方接触挡板应被弹回向上，实际 dy=' + G.ball.dy);

const lives0 = G.lives;
G.setBall(G.layout.x0 + 50, G.layout.y0 + G.layout.h + 50, 0, 1);
G.updatePlay(0.016);
ok(G.lives === lives0 - 1, '掉球应只掉一颗心，实际 ' + G.lives);
ok(G.state === 'ready', '掉球后应回到发球预备，实际 ' + G.state);
G.launch();
G.setBall(G.layout.x0 + 50, G.layout.y0 + G.layout.h + 50, 0, 1);
G.updatePlay(0.016);
G.launch();
G.setBall(G.layout.x0 + 50, G.layout.y0 + G.layout.h + 50, 0, 1);
G.updatePlay(0.016);
ok(G.lives === 0 && G.state === 'over', '三颗心掉光应结束，实际 ' + G.lives + ' / ' + G.state);

// ============================================================
section('7) 行为：暂停 / 恢复 / 过关 / 通关');
// ============================================================
els.btnReplay.__fire('click');
G.launch();
W.TVInput.trigger('back');
ok(G.state === 'pause', '游戏中按返回应暂停，实际 ' + G.state);
els.btnResume.__fire('click');
ok(G.state === 'play', '点继续应回到可玩，实际 ' + G.state);

const score0 = G.score;
G.forceClear();
ok(G.state === 'clear', '清空砖块应进入过关庆祝，实际 ' + G.state);
ok(G.score > score0, '过关应有奖励分，实际 ' + G.score);
ok(G.clearFinal === false, '第 1 关不应判定为全通关');
W.TVInput.trigger('back');
ok(G.state === 'start', '过关庆祝中按返回应能回标题（不会被结算卡锁死）');

G.state = 'play';
G.setLevel(B.MAX_LEVEL);
G.forceClear();
ok(G.state === 'win' && G.clearFinal === true, '最后一关清空应判定全通关，实际 ' + G.state);

// ============================================================
section('8) resize 重建预渲染缓存（fx 相关）');
// ============================================================
let sizeErr = null;
try {
  [[640, 420], [1280, 720], [960, 540]].forEach(wh => {
    sandbox.innerWidth = wh[0];
    sandbox.innerHeight = wh[1];
    tick(16); tick(16); tick(16);
  });
} catch (e) { sizeErr = e.message; }
ok(!sizeErr, '多次 resize（重建场地底纹 / 暗角 / 微粒）不应抛异常，实际 ' + sizeErr);

// ============================================================
section('9) 源码静态约束（STANDARD 第 6 节）');
// ============================================================
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');
}
const banned = [
  [/=>/, '箭头函数'],
  [/\blet\s/, 'let 声明'],
  [/\bconst\s/, 'const 声明'],
  [/\bclass\s+\w/, 'class 声明'],
  [/`/, '模板字符串'],
  [/\bimport\s/, 'ES module import'],
  [/\bexport\s/, 'ES module export'],
  [/\bfor\s*\(\s*(?:let|const|var)\s+\w+\s+of\b/, 'for...of 循环']
];
['js/logic.js', 'js/audio.js', 'js/game.js', 'index.html'].forEach(rel => {
  const s = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  banned.forEach(([re, name]) => ok(!re.test(s), rel + ' 不应使用 ' + name));
});
const css = stripComments(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
[/display\s*:\s*grid/, /\bgap\s*:/, /\bmin\(/, /\bmax\(/, /clamp\(/, /\binset\s*:/,
 /color-mix\(/, /var\(--/, /backdrop-filter/]
  .forEach(re => ok(!re.test(css), 'style.css 不应出现 ' + re));

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

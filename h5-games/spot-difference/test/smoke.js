/*
 * smoke.js —— 火眼金睛（找不同）冒烟测试（纯 Node，无浏览器）
 *
 * 本游戏原先没有任何自动化测试。补上纯 Node 这一层，重点守住：
 *   1) 取景框判定：瞄到差异算「找对」、瞄偏算「找错」；
 *   2) 找齐全部差异后进入 RESOLVE 过渡态（而不是直接弹结算卡片）；
 *   3) 接了 shared/fx.js 之后仍能正常加载与渲染（含 resize 重建预渲染缓存）。
 *      找对 / 找错的粒子与震屏分支都要被跑到，否则 fx 接入改坏了也没人知道。
 *      相关踩坑见 ../docs/STANDARD.md §10.5。
 *
 * 运行：node test/smoke.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
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
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  // fx.js 预渲染离屏 canvas（光斑 / 暗角）用；scenes.js 也要
  createElement() { return makeEl('offscreen'); },
  addEventListener() {},
  querySelectorAll() { return []; }
};

let clock = 1000000;
let rafCb = null;

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
  setTimeout() { return 0; },
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
  history: { pushState() {} },
  location: { href: '', search: '', hash: '' }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// ============================================================
section('1) 脚本加载（含 shared/fx.js）');
// ============================================================
let loadErr = null;
['../shared/input.js', '../shared/nav.js', '../shared/fx.js', 'js/audio.js', 'js/scenes.js', 'js/game.js']
  .forEach(rel => {
    if (loadErr) return;
    const file = path.join(ROOT, rel);
    try { vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file }); }
    catch (e) { loadErr = rel + '：' + e.message; }
  });
ok(!loadErr, '所有脚本应能加载，实际 ' + loadErr);
ok(typeof sandbox.FX === 'object', 'shared/fx.js 应挂上 window.FX');
ok(typeof sandbox.__spot === 'object', 'game.js 应暴露 window.__spot 供测试驱动');
if (loadErr) { console.log('\n❌ FAILED  ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

const W = sandbox;
function frame() { const cb = rafCb; rafCb = null; if (cb) cb(clock); }
function tick(ms) { clock += ms; frame(); }

// ============================================================
section('2) 开局');
// ============================================================
tick(0);
ok(W.__spot.state === 'start', '初始应停在标题页，实际 ' + W.__spot.state);

els.btnStart.__fire('click');
tick(0);
ok(W.__spot.state === 'play', '点开始应进入可玩状态，实际 ' + W.__spot.state);
ok(W.__spot.diffCount > 0, '第 1 关应有若干处差异，实际 ' + W.__spot.diffCount);
ok(W.__spot.foundCount === 0, '开局还没找到任何差异');

// ============================================================
section('3) 找对 / 找错（含 fx 触发分支）');
// ============================================================
let hitErr = null;
try {
  // 瞄到 0 号差异 → 找对：会走 burst / ring / float 三条 fx 分支
  ok(W.__spot.aimAt(0), 'aimAt(0) 应成功把取景框挪到 0 号差异');
  W.TVInput.trigger('confirm');
  tick(16); tick(16);
} catch (e) { hitErr = e.message; }
ok(!hitErr, '找对的特效分支不应抛异常，实际 ' + hitErr);
ok(W.__spot.foundCount === 1, '找对后已找到数应为 1，实际 ' + W.__spot.foundCount);

// 挑一个离所有「还没找到」的差异都尽量远的格子，确保这一下必定判为找错
const COLS = W.Scenes.GRID_COLS, ROWS = W.Scenes.GRID_ROWS;
let farC = 0, farR = 0, farD = -1;
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS; r++) {
    const cx = (c + 0.5) / COLS, cy = (r + 0.5) / ROWS;
    let nearest = Infinity;
    W.__spot.diffs.forEach(d => {
      if (d.found) return;
      const gx = (cx - d.x) * COLS, gy = (cy - d.y) * ROWS;
      nearest = Math.min(nearest, Math.sqrt(gx * gx + gy * gy));
    });
    if (nearest > farD) { farD = nearest; farC = c; farR = r; }
  }
}
ok(farD > 1.2, '应能找到一个离所有差异都够远的空格子（最远距离 ' + farD.toFixed(2) + '）');

const scoreBeforeMiss = W.__spot.score;
let missErr = null;
try {
  W.__spot.setCursor(farC, farR);
  tick(200);                       // 跨过方向键防抖
  W.TVInput.trigger('confirm');    // 找错：走 shake + burst 分支
  tick(16); tick(16); tick(16);
} catch (e) { missErr = e.message; }
ok(!missErr, '找错（震屏 + 粒子）分支不应抛异常，实际 ' + missErr);
ok(W.__spot.foundCount === 1, '找错不应增加已找到数，实际 ' + W.__spot.foundCount);
ok(W.__spot.score < scoreBeforeMiss,
  '找错应扣分（' + scoreBeforeMiss + ' → ' + W.__spot.score + '）—— 否则说明 onMiss 根本没被跑到');

// ============================================================
section('4) 找齐全部 → 进入 RESOLVE 过渡态');
// ============================================================
let clearErr = null;
try {
  var total = W.__spot.diffCount;
  for (var i = 1; i < total; i++) {
    W.__spot.aimAt(i);
    tick(200);                       // 跨过方向键防抖
    W.TVInput.trigger('confirm');
    tick(16); tick(16);
  }
} catch (e) { clearErr = e.message; }
ok(!clearErr, '连续找齐剩余差异不应抛异常，实际 ' + clearErr);
ok(W.__spot.state === 'resolve',
  '找齐全部应进入 RESOLVE 过渡态（先播彩纸再弹结算），实际 ' + W.__spot.state);
ok(W.__spot.foundCount === W.__spot.diffCount, '已找到数应等于总差异数');

// ============================================================
section('5) resize 重建预渲染缓存（fx 相关）');
// ============================================================
let sizeErr = null;
try {
  [[640, 420], [1280, 720], [960, 540]].forEach(function (wh) {
    sandbox.innerWidth = wh[0];
    sandbox.innerHeight = wh[1];
    tick(16); tick(16); tick(16);
  });
} catch (e) { sizeErr = e.message; }
ok(!sizeErr, '多次 resize（重建背景 / 暗角）不应抛异常，实际 ' + sizeErr);

// ============================================================
section('6) 源码静态约束（STANDARD §6）');
// ============================================================
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
const banned = [
  [/=>/, '箭头函数'],
  [/\blet\s/, 'let 声明'],
  [/\bconst\s/, 'const 声明'],
  [/\bclass\s+\w/, 'class 声明'],
  [/`/, '模板字符串'],
  [/\bimport\s/, 'ES module import'],
  [/\bexport\s/, 'ES module export']
];
['js/game.js', 'js/scenes.js', 'js/audio.js', 'index.html'].forEach(rel => {
  const s = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  banned.forEach(([re, name]) => ok(!re.test(s), rel + ' 不应使用 ' + name));
});
const css = stripComments(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
[/display\s*:\s*grid/, /\bgap\s*:/, /\bmin\(/, /\bmax\(/, /\bclamp\(/, /\binset\s*:/, /color-mix\(/]
  .forEach(re => ok(!re.test(css), 'style.css 不应出现 ' + re));

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

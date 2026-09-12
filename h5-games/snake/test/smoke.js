/*
 * smoke.js —— 贪吃蛇冒烟测试（纯 Node，无浏览器）
 *
 * 这游戏原先只有基于 CDP 的 shot.js（要装 Chrome，跑得慢），没有一个「改一行就能跑」的兜底。
 * 本文件补上纯 Node 这一层，重点守住两件事：
 *   1) 状态机与基本流程：开局 → 3-2-1 → 可玩 → 转向 → 暂停/恢复；
 *   2) 接了 shared/fx.js 之后仍能正常加载与渲染（含 resize 重建预渲染缓存）。
 *      fx.js 的接入踩坑见 ../docs/STANDARD.md §10.5。
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
  // fx.js / 棋盘底纹都要预渲染离屏 canvas
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
  // game.js 的调试钩子只在 URL 带 #debug 时才挂 window.__snake
  location: { href: 'http://x/#debug', search: '', hash: '#debug' }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// ============================================================
section('1) 脚本加载（含 shared/fx.js）');
// ============================================================
let loadErr = null;
['../shared/input.js', '../shared/nav.js', '../shared/fx.js', 'js/audio.js', 'js/game.js']
  .forEach(rel => {
    if (loadErr) return;
    const file = path.join(ROOT, rel);
    try { vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file }); }
    catch (e) { loadErr = rel + '：' + e.message; }
  });
ok(!loadErr, '所有脚本应能加载，实际 ' + loadErr);
ok(typeof sandbox.FX === 'object', 'shared/fx.js 应挂上 window.FX');
ok(typeof sandbox.__snake === 'object', 'game.js 应暴露 window.__snake 供测试驱动');
if (loadErr) { console.log('\n❌ FAILED  ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

const W = sandbox;
function frame() { const cb = rafCb; rafCb = null; if (cb) cb(clock); }
function tick(ms) { clock += ms; frame(); }

// ============================================================
section('2) 开局流程');
// ============================================================
tick(0);
ok(W.__snake.state === 'start', '初始应停在标题页，实际 ' + W.__snake.state);

els.btnStart.__fire('click');
tick(0);
ok(W.__snake.state === 'ready', '点开始应进入 3-2-1 预备，实际 ' + W.__snake.state);

tick(3000);          // 跨过 READY_DUR
ok(W.__snake.state === 'play', '预备结束应进入可玩状态，实际 ' + W.__snake.state);

// ============================================================
section('3) 基本操作与渲染不崩');
// ============================================================
let runErr = null;
try {
  W.TVInput.trigger('dir', 'up');
  tick(320);
  W.TVInput.trigger('dir', 'left');
  tick(320);
  for (let i = 0; i < 40; i++) tick(50);      // 让它自己爬一会儿
} catch (e) { runErr = e.message; }
ok(!runErr, '转向 + 连续步进不应抛异常，实际 ' + runErr);
ok(W.__snake.snake.length >= 3, '蛇身长度应至少 3 节，实际 ' + W.__snake.snake.length);

// ============================================================
section('4) 暂停 / 恢复');
// ============================================================
W.TVInput.trigger('back');
tick(0);
ok(W.__snake.state === 'pause', '游戏中按返回应暂停，实际 ' + W.__snake.state);
els.btnResume.__fire('click');
tick(0);
ok(W.__snake.state === 'play', '点继续应回到可玩，实际 ' + W.__snake.state);

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
ok(!sizeErr, '多次 resize（重建暗角 / 棋盘底纹 / 花粉）不应抛异常，实际 ' + sizeErr);

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
['js/game.js', 'js/audio.js', 'index.html'].forEach(rel => {
  const s = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  banned.forEach(([re, name]) => ok(!re.test(s), rel + ' 不应使用 ' + name));
});
const css = stripComments(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
[/display\s*:\s*grid/, /\bgap\s*:/, /\bmin\(/, /\bmax\(/, /\bclamp\(/, /\binset\s*:/, /color-mix\(/]
  .forEach(re => ok(!re.test(css), 'style.css 不应出现 ' + re));

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

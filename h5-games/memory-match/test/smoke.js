/*
 * test/smoke.js —— memory-match 逻辑冒烟测试（零依赖，纯 Node 跑）
 *
 * 为什么不用 jsdom：这个游戏只依赖 canvas 2D + 少量 DOM，自己搭一层最小 DOM stub
 * 比拉一个 jsdom 更快、更可控。用 vm 把四个脚本按 <script> 的真实顺序跑起来，
 * 再用 TVInput.trigger 驱动真实流程 —— 测的是产品代码本身，不是复制出来的副本。
 *
 * 断言的核心思路：**用 Faces.paint 的调用记录反推牌面**。
 * 预览阶段所有卡片正面朝上，一帧之内每个图案恰好画两次 → 直接验证发牌正确；
 * 之后「某一帧里画了几张图案」就等于「此刻有几张牌正面朝上」→ 用来验证翻牌、
 * 配对保留、错配扣回、过关全亮等状态迁移。
 *
 * 跑法：node test/smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }

// ============================================================
//  最小 DOM / Canvas stub
// ============================================================
const DRAW_PRIMS = ['arc', 'ellipse', 'fillRect', 'strokeRect', 'fill', 'stroke',
                    'bezierCurveTo', 'quadraticCurveTo', 'fillText', 'clip'];

function makeCtx() {
  const c = {
    save() {}, restore() {}, translate() {}, scale() {}, setTransform() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    drawImage() {}, setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    measureText() { return { width: 10 }; }
  };
  DRAW_PRIMS.forEach(k => { c[k] = function () {}; });
  return c;
}
const ctx2d = makeCtx();

function makeEl(id) {
  const listeners = {};
  return {
    id,
    textContent: '',
    className: '',
    style: {},
    offsetWidth: 100,
    offsetParent: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    __fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || { preventDefault() {} })); },
    focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; }
  };
}

const els = {};
const canvasEl = makeEl('game');
canvasEl.getContext = function () { return ctx2d; };
els.game = canvasEl;

const documentStub = {
  readyState: 'loading',
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
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
  clearInterval() {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);

['../shared/input.js', '../shared/nav.js', 'js/audio.js', 'js/faces.js', 'js/game.js']
  .forEach(rel => {
    const file = path.join(ROOT, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  });

const W = sandbox;
function frame() { const cb = rafCb; rafCb = null; if (cb) cb(clock); }
function tick(ms) { clock += ms; frame(); }

// 记录每次图案绘制，用于反推牌面
const paintLog = [];
const origPaint = W.Faces.paint;
W.Faces.paint = function (c, face, x, y, r, plate) {
  paintLog.push(typeof face === 'number' ? W.Faces.list[face].id : face.id);
  return origPaint.call(W.Faces, c, face, x, y, r, plate);
};
// 「此刻正面朝上的牌」= 先推进 adv 毫秒让翻面动画走完 → 清空计数 → 走一帧 → 看画了几张
function upFaces(adv) {
  clock += (adv || 0);
  paintLog.length = 0;
  frame();
  return paintLog.slice();
}

// ============================================================
section('1) faces.js —— 图案库');
ok(W.Faces.count === 15, '图案种数应为 15，实际 ' + W.Faces.count);
const ids = W.Faces.list.map(f => f.id);
ok(new Set(ids).size === ids.length, '图案 id 必须唯一');
W.Faces.list.forEach((f, i) => {
  const before = paintLog.length;
  W.Faces.paint(ctx2d, i, 100, 100, 30);
  ok(paintLog.length === before + 1, f.id + ' 应当被绘制');
  ok(typeof f.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(f.color), f.id + ' 颜色应为 #RRGGBB');
});
// 形状是主线索，但颜色也不能撞得太狠
const colorCount = {};
W.Faces.list.forEach(f => { colorCount[f.color] = (colorCount[f.color] || 0) + 1; });
ok(Object.keys(colorCount).length === W.Faces.count, '每个图案应有互不相同的颜色');

// ============================================================
section('2) 发牌 —— 预览一帧反推牌面');
W.document.getElementById('btnStart').__fire('click');
tick(0);

const COLS = 4, ROWS = 3, N = COLS * ROWS, PAIRS = N / 2;
const peek = upFaces();
ok(peek.length === N, '预览一帧应画出 ' + N + ' 张牌面，实际 ' + peek.length);
const tally = {};
peek.forEach(id => { tally[id] = (tally[id] || 0) + 1; });
ok(Object.keys(tally).length === PAIRS, '应有 ' + PAIRS + ' 种不同图案，实际 ' + Object.keys(tally).length);
ok(Object.values(tally).every(v => v === 2), '每种图案应恰好 2 张（成对）');

// ============================================================
section('3) 预览结束 → 全部扣下');
tick(2200 + N * 22 + 400);          // 越过预览 + 逐张扣下动画
ok(upFaces(320).length === 0, '正式玩法开始时所有牌都该扣着');

// ============================================================
section('4) 方向键 + OK 翻牌');
let cc = Math.floor(COLS / 2), cr = Math.floor(ROWS / 2);
function step(dir) {
  clock += 200;                      // 超过 110ms 防抖
  W.TVInput.trigger('dir', dir);
  if (dir === 'left') cc--; else if (dir === 'right') cc++;
  else if (dir === 'up') cr--; else if (dir === 'down') cr++;
  clock += 20;
  frame();
}
function goto(c, r) {
  while (cc > c) step('left');
  while (cc < c) step('right');
  while (cr > r) step('up');
  while (cr < r) step('down');
}
// 翻一张牌，返回「翻面动画结束后这一帧正面朝上的牌」
function flipAt(c, r) {
  goto(c, r);
  clock += 60;
  W.TVInput.trigger('confirm');
  clock += 300;                      // 走完 FLIP_DUR(260ms)
  return upFaces();
}

// peek[i] 即第 i 张卡的图案 —— 由此反推出「哪两张是一对」
const firstSeen = {}, pairOf = {};
peek.forEach((id, i) => {
  if (firstSeen[id] === undefined) firstSeen[id] = i; else pairOf[id] = [firstSeen[id], i];
});
const pairIds = Object.keys(pairOf);
ok(pairIds.length === PAIRS, '应能反推出 ' + PAIRS + ' 对，实际 ' + pairIds.length);

const p0 = pairOf[pairIds[0]];
const a = p0[0], b = p0[1];

const afterA = flipAt(a % COLS, Math.floor(a / COLS));
ok(afterA.length === 1, '翻开第一张后应有 1 张正面，实际 ' + afterA.length);
ok(afterA[0] === peek[a], '翻出的图案应与预览一致');

const afterB = flipAt(b % COLS, Math.floor(b / COLS));
ok(afterB.length === 2, '配对成功后两张都应保持正面，实际 ' + afterB.length);

tick(1500);
ok(upFaces().length === 2, '配对结果应稳定保持（不会自己扣回）');

// ============================================================
section('5) 配错 → 延时后自动扣回');
const used = new Set(p0);
let x = -1, y = -1;
for (let i = 0; i < N && x < 0; i++) {
  if (used.has(i)) continue;
  for (let j = i + 1; j < N; j++) {
    if (used.has(j)) continue;
    if (peek[i] !== peek[j]) { x = i; y = j; break; }
  }
}
ok(x >= 0 && y >= 0, '应能找出两张不同图案的未配对牌');

ok(flipAt(x % COLS, Math.floor(x / COLS)).length === 3, '翻开错配的第一张：已配对 2 张 + 新翻 1 张');
ok(flipAt(y % COLS, Math.floor(y / COLS)).length === 4, '错配的两张在展示期内仍朝上（共 4 张）');
tick(1400);                          // 超过 L1 的 1000ms 翻回延迟
ok(upFaces(320).length === 2, '错配的两张应已自动扣回，只剩已配对的 2 张');

// ============================================================
section('6) 全部配对 → 过关');
const matched = new Set(p0);
pairIds.slice(1).forEach(id => {
  const m = pairOf[id][0], n = pairOf[id][1];
  if (matched.has(m)) return;
  flipAt(m % COLS, Math.floor(m / COLS));
  flipAt(n % COLS, Math.floor(n / COLS));
  matched.add(m); matched.add(n);
  tick(400);
});
tick(900);                           // 等收尾动画 → levelClear
ok(upFaces().length === N, '全部配对后所有 ' + N + ' 张牌都应朝上');
ok(/全部配对/.test(els.clearTitle.textContent),
   '过关标题应被写入，实际 "' + els.clearTitle.textContent + '"');
ok(els.clearScore.textContent === '1050' || Number(els.clearScore.textContent) > 0,
   '过关分数应被写入，实际 "' + els.clearScore.textContent + '"');

// ============================================================
section('7) 源码静态约束（STANDARD §6）');
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
['js/game.js', 'js/faces.js', 'js/audio.js', 'index.html'].forEach(rel => {
  const s = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  banned.forEach(([re, name]) => ok(!re.test(s), rel + ' 不应使用 ' + name));
});
const css = stripComments(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
[/display\s*:\s*grid/, /\bgap\s*:/, /\bmin\(/, /\bmax\(/, /\bclamp\(/, /\binset\s*:/, /color-mix\(/]
  .forEach(re => ok(!re.test(css), 'style.css 不应出现 ' + re));

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

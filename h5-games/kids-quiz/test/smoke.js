/*
 * test/smoke.js —— kids-quiz 逻辑冒烟测试（零依赖，纯 Node 跑）
 *
 * 思路与 memory-match/test/smoke.js 一致：用 vm 把五个脚本按 <script> 的真实顺序
 * 跑在最小 DOM stub 上，再用 TVInput.trigger 驱动真实流程 —— 测的是产品代码本身。
 *
 * 两层验证：
 *   ① 出题器（js/quiz.js）——7 种题型各跑 300 局，断言「答案唯一、干扰项不撞答案、
 *      单一维度防蒙」这些真正决定孩子体验的性质。
 *   ② 游戏流程（js/game.js）——包一层 Quiz.generate 拿到每题答案，
 *      用方向键 + OK 真的把一关 8 题全答对，验证状态机、计分、过关结算。
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
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    drawImage() {}, setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    strokeText() {},
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
  // fx.js 预渲染离屏 canvas（光斑 / 暗角）用
  createElement() { return { width: 0, height: 0, getContext() { return makeCtx(); } }; },
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

['../shared/input.js', '../shared/nav.js', '../shared/fx.js', 'js/audio.js', 'js/art.js', 'js/quiz.js', 'js/game.js']
  .forEach(rel => {
    const file = path.join(ROOT, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  });

const W = sandbox;
function frame() { const cb = rafCb; rafCb = null; if (cb) cb(clock); }
function tick(ms) { clock += ms; frame(); }

// ============================================================
section('1) art.js —— 图形素材库');
ok(W.Art.SHAPES.length === 8, '应有 8 种形状，实际 ' + W.Art.SHAPES.length);
ok(W.Art.ANIMALS.length === 8, '应有 8 种动物，实际 ' + W.Art.ANIMALS.length);
ok(W.Art.COLORS.length === 8, '应有 8 种颜色，实际 ' + W.Art.COLORS.length);
ok(new Set(W.Art.COLOR_IDS).size === 8, '颜色 id 必须唯一');
W.Art.SHAPES.forEach(s => {
  let drew = false;
  const spy = new Proxy(ctx2d, {});   // 只需要不抛异常即可
  try { W.Art.paint(spy, { k: 'shape', id: s.id, color: 'red', size: 1 }, 50, 50, 20); drew = true; }
  catch (e) { /* 记为失败 */ }
  ok(drew, '形状 ' + s.id + ' 应能绘制且不抛异常');
});
W.Art.ANIMALS.forEach(a => {
  let drew = false;
  try { W.Art.paint(ctx2d, { k: 'animal', id: a.id, color: 'brown', size: 1 }, 50, 50, 20); drew = true; }
  catch (e) { /* 记为失败 */ }
  ok(drew, '动物 ' + a.id + ' 应能绘制且不抛异常');
});
[1, 2, 5, 6].forEach(n => {
  let drew = false;
  try { W.Art.paint(ctx2d, { k: 'digit', n: n }, 50, 50, 20); drew = true; } catch (e) {}
  ok(drew, '数字 ' + n + ' 应能绘制且不抛异常');
});

// ============================================================
section('2) quiz.js —— 出题器');
// item 的唯一键：用于判断两个选项是否「长得一样」
function key(it) {
  if (!it) return 'null';
  if (it.k === 'digit') return 'digit:' + it.n;
  return it.k + ':' + it.id + ':' + (it.color || '-') + ':' + (it.size || 1);
}
function shapes(opts) { return opts.map(o => key(o)); }

const GEN = W.Quiz._gen;
const TYPES = Object.keys(GEN);
ok(TYPES.length === 7, '应有 7 种题型，实际 ' + TYPES.length);

TYPES.forEach(t => {
  let bad = 0, badMsg = '';
  for (let i = 0; i < 300; i++) {
    const lv = 1 + (i % 8);
    const q = GEN[t](lv);
    if (!q || q.options.length !== 4) { bad++; badMsg = '选项数不是 4'; break; }
    if (!(q.answer >= 0 && q.answer <= 3)) { bad++; badMsg = 'answer 越界'; break; }
    if (typeof q.label !== 'string' || !q.label.length) { bad++; badMsg = '缺少题干'; break; }

    const ks = shapes(q.options);
    const ansKey = ks[q.answer];

    if (t === 'sameShape') {
      // 只能靠形状分辨：所有选项颜色都不同于题干色；且恰好一个选项形状与题干相同
      if (q.options.some(o => o.color === q.prompt.color)) { bad++; badMsg = '选项颜色撞题干色，能靠颜色蒙'; break; }
      const same = q.options.filter(o => o.id === q.prompt.id);
      if (same.length !== 1 || q.options[q.answer].id !== q.prompt.id) { bad++; badMsg = '形状匹配项不唯一'; break; }
    } else if (t === 'sameColor') {
      // 只能靠颜色分辨：所有选项形状相同；且恰好一个选项颜色与题干相同
      if (new Set(q.options.map(o => o.id)).size !== 1) { bad++; badMsg = '选项形状不一致，能靠形状蒙'; break; }
      if (q.options.some(o => o.id === q.prompt.id)) { bad++; badMsg = '选项形状撞题干形状'; break; }
      const same = q.options.filter(o => o.color === q.prompt.color);
      if (same.length !== 1 || q.options[q.answer].color !== q.prompt.color) { bad++; badMsg = '颜色匹配项不唯一'; break; }
    } else if (t === 'sameAnimal') {
      const same = q.options.filter(o => o.id === q.prompt.id);
      if (same.length !== 1 || q.options[q.answer].id !== q.prompt.id) { bad++; badMsg = '动物匹配项不唯一'; break; }
    } else if (t === 'size') {
      const sizes = q.options.map(o => o.size);
      if (new Set(sizes).size !== 4) { bad++; badMsg = '尺寸有重复，最大/最小不唯一'; break; }
      const ans = sizes[q.answer];
      const isMax = ans === Math.max.apply(null, sizes);
      const isMin = ans === Math.min.apply(null, sizes);
      if (!isMax && !isMin) { bad++; badMsg = '答案既不是最大也不是最小'; break; }
      if (isMax && q.label.indexOf('最大') < 0) { bad++; badMsg = '题干与答案不符（最大）'; break; }
      if (isMin && q.label.indexOf('最小') < 0) { bad++; badMsg = '题干与答案不符（最小）'; break; }
    } else if (t === 'oddOne' || t === 'oddAnimal') {
      // 「找不同」：三同一异，且异类必须唯一
      const counts = {};
      ks.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
      const vals = Object.keys(counts).map(k => counts[k]).sort();
      if (vals.length !== 2 || vals[0] !== 1 || vals[1] !== 3) { bad++; badMsg = '不是「三同一异」'; break; }
      if (counts[ansKey] !== 1) { bad++; badMsg = '答案不是那个唯一的异类'; break; }
    } else if (t === 'count') {
      if (q.options[q.answer].k !== 'digit' || q.options[q.answer].n !== q.prompt.n) {
        bad++; badMsg = '答案与数量不符'; break;
      }
      const ns = q.options.map(o => o.n);
      if (new Set(ns).size !== 4) { bad++; badMsg = '数字选项有重复'; break; }
      if (q.prompt.n < 1 || q.prompt.n > 6) { bad++; badMsg = '数量超出 1..6'; break; }
    }
  }
  ok(bad === 0, t + ' 300 局出题异常：' + badMsg);
});

// 关卡题型池随关卡递增，且第一关只有最基础的两种
ok(JSON.stringify(W.Quiz.poolOf(1)) === JSON.stringify(['sameShape', 'sameColor']),
   '第 1 关只出认形状/认颜色，实际 ' + JSON.stringify(W.Quiz.poolOf(1)));
ok(W.Quiz.poolOf(6).length === 7, '第 6 关应解锁全部 7 种题型，实际 ' + W.Quiz.poolOf(6).length);
ok(W.Quiz.poolOf(2).length < W.Quiz.poolOf(4).length, '题型池应随关卡变多');

// generate() 不抛异常、答案始终合法
let genBad = 0;
for (let i = 0; i < 500; i++) {
  const q = W.Quiz.generate(1 + (i % 8), null);
  if (!q || !(q.answer >= 0 && q.answer <= 3) || q.options.length !== 4) genBad++;
}
ok(genBad === 0, 'generate() 500 次应全部合法，异常 ' + genBad + ' 次');

// ============================================================
section('3) 游戏流程 —— 一关 8 题全答对');
// 包一层 generate，拿到每题答案，才能用遥控器「真的」选对
let lastQ = null;
const origGen = W.Quiz.generate;
W.Quiz.generate = function (lv, lt) {
  const q = origGen.call(W.Quiz, lv, lt);
  lastQ = q;
  return q;
};

W.document.getElementById('btnStart').__fire('click');
tick(0);
ok(!!lastQ, '开局应立刻出第一题');

// 光标每题从 0（左上）开始，用方向键走到目标格子再按 OK
function select(i) {
  if (i === 1 || i === 3) { clock += 200; W.TVInput.trigger('dir', 'right'); }
  if (i === 2 || i === 3) { clock += 200; W.TVInput.trigger('dir', 'down'); }
  clock += 60;
  W.TVInput.trigger('confirm');
}

const QN = W.Quiz.QUESTIONS;
let answered = 0;
for (let i = 0; i < QN; i++) {
  ok(!!lastQ, '第 ' + (i + 1) + ' 题应已生成');
  select(lastQ.answer);
  answered++;
  tick(950);                       // 越过答对后的 RIGHT_HOLD(850ms)
  frame();
}
ok(answered === QN, '应完成 ' + QN + ' 题，实际 ' + answered);
ok(Number(els.scoreText.textContent) >= QN * 100,
   '全对应至少 ' + (QN * 100) + ' 分，实际 ' + els.scoreText.textContent);
ok(/全部答完/.test(els.clearTitle.textContent),
   '应触发过关，实际 "' + els.clearTitle.textContent + '"');
ok(els.clearRight.textContent === QN + '/' + QN,
   '过关答对数应为 ' + QN + '/' + QN + '，实际 ' + els.clearRight.textContent);
ok(Number(els.clearBonus.textContent) > 0, '时间奖励应 > 0，实际 ' + els.clearBonus.textContent);

// ============================================================
section('4) 答错 —— 扣分并把正确答案圈出来');
W.document.getElementById('btnReplay').__fire('click');
tick(0);
// 先答对一题把分数攒起来，否则 0 分再扣还是 0，看不出「扣分」这件事
select(lastQ.answer);
tick(950);
const before = Number(els.scoreText.textContent);
ok(before > 0, '答对一题后分数应 > 0，实际 ' + before);

// 再故意选一个错的（答案在 0 就选 3，否则选 0）
const wrongIdx = lastQ.answer === 0 ? 3 : 0;
select(wrongIdx);
tick(100);
ok(Number(els.scoreText.textContent) < before,
   '答错应扣分（' + before + ' → ' + els.scoreText.textContent + '）');
ok(els.comboPill.className === 'off' || Number(els.comboText.textContent) === 1,
   '答错应清零连击');
// 答错后停留更久（WRONG_HOLD 1350ms），期间不能翻页
const qBefore = els.qText.textContent;
tick(600);
ok(els.qText.textContent === qBefore, '答错后应停留展示正确答案，不能立刻翻页');
tick(900);
ok(els.qText.textContent !== qBefore, '停留结束后应进入下一题');

// ============================================================
section('5) 源码静态约束（STANDARD §6）');
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
['js/game.js', 'js/quiz.js', 'js/art.js', 'js/audio.js', 'index.html'].forEach(rel => {
  const s = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  banned.forEach(([re, name]) => ok(!re.test(s), rel + ' 不应使用 ' + name));
});
const css = stripComments(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
[/display\s*:\s*grid/, /\bgap\s*:/, /\bmin\(/, /\bmax\(/, /\bclamp\(/, /\binset\s*:/, /color-mix\(/]
  .forEach(re => ok(!re.test(css), 'style.css 不应出现 ' + re));

// ---- 反馈气泡 #toast 的排版约束 ----
// 坑：气泡原本放在 #hud 内部，走文档流，会把 canvas 上绘制的题干文字顶下去/盖住；
// 移出 #hud 后又必须绝对定位 + 在布局里预留底部空间，否则会反过来压住下排选项。
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const hudToToast = html.slice(html.indexOf('id="hud"'), html.indexOf('id="toast"'));
ok(/id="toast"/.test(html), 'index.html 应有 #toast 反馈气泡');
ok(/<\/div>/.test(hudToToast), '#toast 不应嵌套在 #hud 内（文档流会顶掉 canvas 上的题干文字）');
ok(/#toast\s*\{[^}]*position\s*:\s*absolute/.test(css),
   '#toast 应绝对定位（脱离 #hud 文档流，避免与 canvas 题干重叠）');
ok(/TOAST_RESERVE/.test(fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8')),
   'game.js 应为 #toast 预留底部空间（TOAST_RESERVE），否则气泡压住下排选项');

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

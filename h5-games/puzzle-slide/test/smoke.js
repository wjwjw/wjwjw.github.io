/*
 * test/smoke.js —— puzzle-slide 逻辑冒烟测试（零依赖，纯 Node 跑）
 *
 * 思路与 kids-quiz/test/smoke.js 一致：用 vm 把产品脚本按 <script> 的真实顺序
 * 跑在最小 DOM stub 上，再用 TVInput.trigger 驱动真实流程 —— 测的是产品代码本身。
 *
 * 三层验证：
 *   ① 棋盘逻辑（js/puzzle.js）——方向语义、打乱必定可解、判定完成不误判。
 *   ② 图源（js/art.js）——6 个场景都能画出来不抛异常。
 *   ③ 游戏流程（js/game.js）——真的按键滑动、走一步就过关、时间耗尽结束。
 *
 * 跑法：node test/smoke.js [重复次数]
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
                    'bezierCurveTo', 'quadraticCurveTo', 'fillText', 'clip', 'drawImage'];

function makeCtx() {
  const c = {
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
    clearRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    setLineDash() {},
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
    width: 0,
    height: 0,
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    __fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || { preventDefault() {} })); },
    getContext() { return ctx2d; },
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
  readyState: 'loading',
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
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
  clearInterval() {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);

['../shared/input.js', '../shared/nav.js', '../shared/fx.js', 'js/audio.js', 'js/art.js', 'js/puzzle.js', 'js/game.js']
  .forEach(rel => {
    const file = path.join(ROOT, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  });

const W = sandbox;
const P = W.Puzzle;
function frame() { const cb = rafCb; rafCb = null; if (cb) cb(clock); }
function tick(ms) { clock += ms; frame(); }

// 可重复的随机源（LCG），跑测时才稳定
function rng(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 15-puzzle 可解性判定（标准结论）：
//   N 为奇数：逆序数为偶数
//   N 为偶数：逆序数 + 空格所在行（自底向上 1-based）为奇数
function isSolvable(board, n) {
  const arr = board.filter(v => v !== 0);
  let inv = 0;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) if (arr[i] > arr[j]) inv++;
  }
  const blankRowFromBottom = n - Math.floor(board.indexOf(0) / n);
  return n % 2 === 1 ? (inv % 2 === 0) : ((inv + blankRowFromBottom) % 2 === 1);
}

const RUNS = Number(process.argv[2] || 1);

for (let run = 0; run < RUNS; run++) {

  // ============================================================
  section('1) puzzle.js —— 棋盘逻辑');

  ok(P.sizeOf(1) === 3 && P.sizeOf(3) === 3, '前 3 关应为 3×3');
  ok(P.sizeOf(4) === 4 && P.sizeOf(9) === 4, '第 4 关起应为 4×4');
  ok(P.timeOf(9) >= 90, '时间下限 90 秒，实际 ' + P.timeOf(9));

  const s3 = P.solvedBoard(3);
  ok(s3.join(',') === '1,2,3,4,5,6,7,8,0', '3×3 完成态 = 1..8 + 空格');
  ok(P.isSolved(s3), '完成态判定为已完成');
  ok(P.blankIndex(s3) === 8, '完成态空格在最后一格');
  ok(!P.isSolved(P.solvedBoard(4).slice(0, 8).concat([0, 9, 10, 11, 12, 13, 14, 15])),
     '打乱后不应判定为完成');

  // ---- 方向语义：dir 是「方块滑动的方向」----
  // 3×3 完成态的空格在 (2,2)。按「右」→ 应该是 (2,1) 那块（编号 8）向右滑。
  {
    const b = P.solvedBoard(3);
    ok(P.sourceIndex(b, 3, 'right') === 7, '按「右」应取空格左邻（下标 7，编号 8）');
    ok(P.sourceIndex(b, 3, 'up') === -1, '空格在最后一行，按「上」无块可滑');
    ok(P.canMove(b, 3, 'down') === true, '空格上方有块，按「下」可以滑');

    const r = P.move(b, 3, 'right');
    ok(r.ok && r.from === 7 && r.to === 8, '移动应把下标 7 的块换到下标 8');
    ok(b[8] === 8 && b[7] === 0, '移动后 8 号块到位、7 号位变空格');
    ok(P.blankIndex(b) === 7, '空格跟着挪到 7');

    // 逆操作回到原状
    P.move(b, 3, 'left');
    ok(P.isSolved(b), '「右」的逆操作是「左」，走回去应还原');
  }

  // ---- movable：空格四邻 ----
  {
    const b = P.solvedBoard(3);
    const mv = P.movable(b, 3).sort((x, y) => x - y);
    ok(mv.join(',') === '5,7', '角上空格的可动块应是 5 和 7，实际 ' + mv.join(','));
    const b2 = [1, 2, 3, 4, 0, 6, 7, 8, 5];
    ok(P.movable(b2, 3).length === 4, '中心空格应有 4 个可动块，实际 ' + P.movable(b2, 3).length);
  }

  // ---- 打乱：必定可解、不重复、不丢失、不是完成态 ----
  [3, 4].forEach(n => {
    let bad = 0, solvedCnt = 0, unsolvable = 0;
    for (let i = 0; i < 200; i++) {
      const b = P.shuffle(n, P.shuffleCountOf(i % 8 + 1), rng(i * 7919 + n));
      const seen = {};
      let dup = false;
      b.forEach(v => { if (seen[v]) dup = true; seen[v] = 1; });
      if (dup || b.length !== n * n) bad++;
      if (P.isSolved(b)) solvedCnt++;
      if (!isSolvable(b, n)) unsolvable++;
    }
    ok(bad === 0, n + '×' + n + ' 打乱后不应有重复/缺失（' + bad + ' 次异常）');
    ok(unsolvable === 0, n + '×' + n + ' 打乱后必须 100% 可解（' + unsolvable + ' 次无解）');
    ok(solvedCnt === 0, n + '×' + n + ' 打乱后不应正好是完成态（' + solvedCnt + ' 次）');
  });

  // ---- 随机走 N 步再原路返回，一定能回到完成态（等价于「可解」的实证） ----
  {
    const n = 3;
    const opp = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const dirs = ['up', 'down', 'left', 'right'];
    let okAll = true;
    for (let t = 0; t < 100; t++) {
      const r = rng(t + 12345);
      const b = P.solvedBoard(n);
      const trail = [];
      for (let s = 0; s < 30; s++) {
        const pool = dirs.filter(d => P.canMove(b, n, d));
        const d = pool[Math.floor(r() * pool.length) % pool.length];
        P.move(b, n, d);
        trail.push(d);
      }
      for (let s = trail.length - 1; s >= 0; s--) P.move(b, n, opp[trail[s]]);
      if (!P.isSolved(b)) { okAll = false; break; }
    }
    ok(okAll, '走 30 步再逐步回退，应能回到完成态');
  }

  // ============================================================
  section('2) art.js —— 图源');

  ok(W.Art.SCENES.length === 6, '应有 6 个场景，实际 ' + W.Art.SCENES.length);
  ok(new Set(W.Art.SCENE_IDS).size === 6, '场景 id 必须唯一');
  W.Art.SCENES.forEach(sc => {
    let threw = null;
    try { W.Art.paintScene(ctx2d, sc.id, 300); } catch (e) { threw = e; }
    ok(!threw, '场景「' + sc.name + '」绘制不应抛异常' + (threw ? '：' + threw.message : ''));
  });

  // ============================================================
  section('3) 游戏流程 —— 按键滑动到过关');

  els.btnStart.__fire('click');
  tick(0);
  ok(W.__puzzle.state === 'peek', '开局应先进入看图状态，实际 ' + W.__puzzle.state);
  ok(W.__puzzle.n === 3, '第 1 关棋盘应为 3×3');
  ok(W.__puzzle.moves === 0, '开局步数应为 0');

  // 跳过看图
  W.TVInput.trigger('confirm');
  tick(0);
  ok(W.__puzzle.state === 'play', '按 OK 应跳过看图进入拼图，实际 ' + W.__puzzle.state);

  const b0 = W.__puzzle.board.slice();
  ok(!P.isSolved(b0), '开局棋盘应该是打乱的');

  // 走一步：选一个合法方向
  // 注意：game.js 有 90ms 方向键防抖，两次 trigger 之间必须把时钟推过去，
  // 否则第二次会被直接丢掉（测出来的「步数没变」是假阳性）。
  {
    const dirs = ['up', 'down', 'left', 'right'].filter(d => P.canMove(b0, 3, d));
    tick(120);
    W.TVInput.trigger('dir', dirs[0]);
    tick(0);
    ok(W.__puzzle.moves === 1, '滑动一次步数应为 1，实际 ' + W.__puzzle.moves);
    ok(W.__puzzle.board.join(',') !== b0.join(','), '滑动后棋盘应变化');
  }

  // 非法方向：不增加步数
  {
    const before = W.__puzzle.moves;
    const bad = ['up', 'down', 'left', 'right'].filter(d => !P.canMove(W.__puzzle.board, 3, d));
    if (bad.length) {
      tick(120);
      W.TVInput.trigger('dir', bad[0]);
      tick(0);
      ok(W.__puzzle.moves === before, '滑不动的方向不应增加步数');
    } else {
      ok(true, '滑不动的方向不应增加步数（本局四向皆可，跳过）');
    }
  }

  // 走到「只差一步」再拼好 → 应过关
  {
    const b = P.solvedBoard(3);
    P.move(b, 3, 'right');                       // 只差一步：逆操作是 left
    W.__puzzle.setBoard(b.slice());
    const scoreBefore = Number(els.scoreText.textContent);
    tick(120);
    W.TVInput.trigger('dir', 'left');
    tick(0);
    tick(20);
    ok(W.__puzzle.state === 'clear', '拼好后应进入过关状态，实际 ' + W.__puzzle.state);
    ok(Number(els.clearMoves.textContent) > 0, '过关界面应显示步数');
    ok(Number(els.clearBonus.textContent) > 0, '过关界面应显示时间奖励');
    ok(Number(els.clearScore.textContent) > scoreBefore, '过关后分数应增加');
  }

  // 下一关：第 4 关起棋盘变 4×4
  els.btnNext.__fire('click');
  tick(0);
  ok(W.__puzzle.level === 2, '点「下一关」应进入第 2 关');
  W.__puzzle.skipPeek();
  tick(0);
  ok(W.__puzzle.state === 'play', '第 2 关跳过看图后应可玩');

  // ============================================================
  section('4) 时间耗尽 —— 结束');

  {
    let guard = 0;
    while (W.__puzzle.state === 'play' && guard < 4000) { tick(100); guard++; }
    ok(W.__puzzle.state === 'over', '时间耗尽应进入结束状态，实际 ' + W.__puzzle.state);
    ok(Number(els.overScore.textContent) >= 0, '结束界面应显示分数');
  }

  // 结束后回标题
  els.btnOverQuit.__fire('click');
  tick(0);
  ok(W.__puzzle.state === 'start', '结束后返回标题应回到 start，实际 ' + W.__puzzle.state);

  // ============================================================
  section('5) 源码静态约束（STANDARD §6）');
}

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
['js/game.js', 'js/puzzle.js', 'js/art.js', 'js/audio.js', 'index.html'].forEach(rel => {
  const s = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  banned.forEach(([re, name]) => ok(!re.test(s), rel + ' 不应使用 ' + name));
});
const css = stripComments(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
[/display\s*:\s*grid/, /\bgap\s*:/, /\bmin\(/, /\bmax\(/, /\bclamp\(/, /\binset\s*:/, /color-mix\(/]
  .forEach(re => ok(!re.test(css), 'style.css 不应出现 ' + re));

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

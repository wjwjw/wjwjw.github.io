/*
 * smoke.js —— 振翅飞行（flipping-bird）冒烟测试（纯 Node，无浏览器）
 *
 * 覆盖：
 *   1) 脚本加载（含 shared/fx.js）+ 主题数据完整性（3 角色 / 3 场景 / 固定配套映射）
 *   2) 三套「角色 × 场景」固定配套的绘制分支都不崩 —— 每套走不同绘制分支，
 *      只测默认套装等于另外两套没测
 *   3) 固定配套：选角色即整套切换（场景由角色下标派生，结构上无法拆开）
 *   4) 开局 3-2-1 → 拍翅膀物理 → 穿柱得分 → 撞柱掉心 → 掉光结算
 *   5) 地面触地：首次触地扣一颗心；无敌期结束仍贴地先免费小弹一次（不扣心），
 *      宽限后再贴地才扣下一颗；贴地不下沉出屏幕
 *   6) 暂停 / 恢复 / 切后台自动暂停 / resize / 返回键
 *   7) 源码静态约束（STANDARD §6，ES5 + CSS 兼容）
 *
 * 运行：node test/smoke.js
 */
require('../../test/lint-shared.js');   // 公共层兼容性门禁，失败即退出
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
    focus() {}, blur() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; }
  };
}

const els = {};
els.game = makeEl('game');
els.preview = makeEl('preview');

const docListeners = {};
const store = {};
const documentStub = {
  readyState: 'complete',
  hidden: false,
  activeElement: null,
  body: {},
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement() { return makeEl('offscreen'); },   // fx / 背景预渲染用
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  __fire(type, ev) { (docListeners[type] || []).forEach(fn => fn(ev || { preventDefault() {} })); },
  querySelectorAll() { return []; }
};

let clock = 1000000;
let rafCb = null;
const winListeners = {};

const sandbox = {
  document: documentStub,
  console,
  Date: { now() { return clock; } },
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }
  },
  innerWidth: 960,
  innerHeight: 540,
  devicePixelRatio: 1,
  addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
  __fire(type, ev) { (winListeners[type] || []).forEach(fn => fn(ev || { preventDefault() {} })); },
  requestAnimationFrame(cb) { rafCb = cb; return 1; },
  setTimeout() { return 0; },
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
  history: { pushState() {} },
  location: { href: 'http://x/#debug', search: '', hash: '#debug' }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// ============================================================
section('1) 脚本加载 & 主题数据');
// ============================================================
let loadErr = null;
['../shared/input.js', '../shared/nav.js', '../shared/fx.js',
 'js/audio.js', 'js/themes.js', 'js/game.js']
  .forEach(rel => {
    if (loadErr) return;
    const file = path.join(ROOT, rel);
    try { vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file }); }
    catch (e) { loadErr = rel + '：' + e.message; }
  });
ok(!loadErr, '所有脚本应能加载，实际 ' + loadErr);
ok(typeof sandbox.FX === 'object', 'shared/fx.js 应挂上 window.FX');
ok(typeof sandbox.FBThemes === 'object', 'themes.js 应挂上 window.FBThemes');
ok(typeof sandbox.AudioManager === 'function', 'audio.js 应挂上 window.AudioManager');
ok(typeof sandbox.TVInput === 'object', 'shared/input.js 应挂上 window.TVInput');
ok(typeof sandbox.__fb === 'object', 'game.js 应暴露 window.__fb 供测试驱动');
if (loadErr) { console.log('\n❌ FAILED  ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

const W = sandbox;
const T = W.FBThemes;
function frame() { const cb = rafCb; rafCb = null; if (cb) cb(clock); }
function tick(ms) { clock += ms; frame(); }

ok(T.CHARACTERS.length === 3, '应有 3 个角色，实际 ' + T.CHARACTERS.length);
ok(T.SCENES.length === 3, '应有 3 个场景，实际 ' + T.SCENES.length);
let pairOk = true;
for (let i = 0; i < 3; i++) {
  if (T.CHARACTERS[i].scene !== T.SCENES[i].id) pairOk = false;
}
ok(pairOk, '三套固定配套应一一对应（飞机/天空、乌龟/草丛、鲸鱼/海洋）');

// ============================================================
section('2) 三套固定配套的绘制分支都不崩');
// ============================================================
let comboErr = null;
try {
  for (let c = 0; c < 3; c++) {
    W.__fb.pickCombo(c);
    W.__fb.render();            // 背景 / 柱子 / 角色 / 地面 / 特效全走一遍
    tick(16);
  }
} catch (e) { comboErr = e.message; }
ok(!comboErr, '三套固定配套均应能渲染，实际 ' + comboErr);
ok(W.__fb.sceneIndex === 2, '上面循环结束时应停在最后一个配套，实际 ' + W.__fb.sceneIndex);
W.__fb.pickCombo(0);   // 复位，section 3 从默认配套开始验证

// ============================================================
section('3) 固定配套：选角色即整套切换');
// ============================================================
ok(W.__fb.state === 'start', '初始应停在标题页，实际 ' + W.__fb.state);
ok(W.__fb.themeName === '小飞机 × 天空', '默认应为小飞机 × 天空，实际 ' + W.__fb.themeName);
W.__fb.pickCombo(1);
ok(W.__fb.sceneIndex === 1, '换到乌龟时场景应固定为草丛（下标跟随角色），实际 ' + W.__fb.sceneIndex);
ok(W.__fb.themeName === '小乌龟 × 草丛', '固定配套名，实际 ' + W.__fb.themeName);
W.__fb.pickCombo(2);
ok(W.__fb.sceneIndex === 2, '换到鲸鱼时场景应固定为海洋');
ok(W.__fb.themeName === '小鲸鱼 × 海洋', '固定配套名，实际 ' + W.__fb.themeName);
W.__fb.pickCombo(0);
ok(W.__fb.themeName === '小飞机 × 天空', '恢复默认搭配');

// 每套配套独立最高分：切配套后 best 重新从该 key 读
ok(W.__fb.best === 0, '新配套的最高分应为 0，实际 ' + W.__fb.best);

// ============================================================
section('4) 开局 / 倒计时 / 拍翅膀');
// ============================================================
tick(0);
els.btnStart.__fire('click');
tick(0);
ok(W.__fb.state === 'ready', '点开始应进入 3-2-1 预备，实际 ' + W.__fb.state);
tick(3000);
ok(W.__fb.state === 'play', '预备结束应进入可玩状态，实际 ' + W.__fb.state);

W.__fb.freeze(true);              // 冻结主循环的物理，改由 __fb.step 按步驱动
W.__fb.setPlayerY(240);
W.TVInput.trigger('confirm');
ok(W.__fb.player.vy === -430, '按 OK 拍翅膀应给 -430 的向上速度，实际 ' + W.__fb.player.vy);
const y0 = W.__fb.player.y;
W.__fb.step(0.05);
ok(W.__fb.player.y < y0, '拍翅膀后应向上移动，实际 ' + y0 + ' -> ' + W.__fb.player.y);

// ============================================================
section('5) 穿柱得分 / 撞柱掉心 / 结算');
// ============================================================
W.__fb.clearPipes();
W.__fb.forcePipe(PLAYER_X_FOR_TEST(), 240);
W.__fb.setPlayerY(240);
for (let i = 0; i < 20; i++) {
  W.__fb.step(0.05);
  W.__fb.setPlayerY(240);          // 每步把角色放回缺口中央，模拟连续拍翅膀
}
ok(W.__fb.score >= 1, '柱子移过角色后应得分，实际 ' + W.__fb.score);
ok(W.__fb.passed >= 1, '飞过的柱子数应同步增加，实际 ' + W.__fb.passed);
ok(W.__fb.best >= 1, '最高分应随得分更新，实际 ' + W.__fb.best);

function PLAYER_X_FOR_TEST() { return W.__fb.WORLD.PLAYER_X + 30; }

W.__fb.clearPipes();
W.__fb.forcePipe(W.__fb.WORLD.PLAYER_X - 20, 240);
W.__fb.setPlayerY(80);           // 上柱区域
W.__fb.clearInv();
const lives0 = W.__fb.lives;
W.__fb.step(0.016);
ok(W.__fb.lives === lives0 - 1, '撞柱应只掉一颗心，实际 ' + lives0 + ' -> ' + W.__fb.lives);
ok(W.__fb.player.invUntil > clock, '撞击后应进入短暂无敌');
W.__fb.step(0.016);
ok(W.__fb.lives === lives0 - 1, '无敌期间不应重复掉心');
ok(W.__fb.state === 'play', '掉一颗心不应直接结束，实际 ' + W.__fb.state);

// 连续撞到掉光为止
W.__fb.clearPipes();
for (let i = 0; i < 4 && W.__fb.state === 'play'; i++) {
  W.__fb.forcePipe(W.__fb.WORLD.PLAYER_X - 20, 240);
  W.__fb.setPlayerY(80);
  W.__fb.clearInv();
  W.__fb.step(0.016);
}
ok(W.__fb.state === 'over', '三颗心掉光应进入结算，实际 ' + W.__fb.state);
ok(els.overScore.textContent === String(W.__fb.score), '结算分数应同步写入覆盖层文本');
ok(els.overBest.textContent === String(W.__fb.best), '结算最高分应同步写入覆盖层文本');

W.TVInput.trigger('back');
ok(W.__fb.state === 'start', '结算页按返回应回标题，实际 ' + W.__fb.state);

// ============================================================
section('5.5) 结算：追平旧纪录不误报新纪录，真正破纪录才报');
// ============================================================
const BEST_KEY = 'fb-best-' + T.CHARACTERS[0].id;

// 走一局：得 1 分后把三颗心撞光，触发 gameOver 结算文案
function runOnePoint() {
  W.__fb.gotoStart();          // loadBest() 读取 store 里的旧纪录
  W.__fb.clearPipes();
  W.__fb.startNow();           // 记录 runStartBest
  W.__fb.forcePipe(W.__fb.WORLD.PLAYER_X + 30, 240);
  W.__fb.setPlayerY(240);
  for (let i = 0; i < 30 && W.__fb.score < 1; i++) {
    W.__fb.step(0.05);
    W.__fb.setPlayerY(240);
  }
  W.__fb.clearPipes();
  for (let i = 0; i < 4 && W.__fb.state === 'play'; i++) {
    W.__fb.forcePipe(W.__fb.WORLD.PLAYER_X - 20, 240);
    W.__fb.setPlayerY(80);
    W.__fb.clearInv();
    W.__fb.step(0.016);
  }
}

store[BEST_KEY] = '1';         // 旧纪录 1 分
runOnePoint();
ok(W.__fb.score === 1, '平局场景应恰好得 1 分，实际 ' + W.__fb.score);
ok(W.__fb.state === 'over', '平局场景应进入结算，实际 ' + W.__fb.state);
ok(els.overTip.textContent.indexOf('新纪录') === -1,
  '追平旧纪录不应报「新纪录」，实际文案：' + els.overTip.textContent);

store[BEST_KEY] = '0';         // 旧纪录 0 分
runOnePoint();
ok(els.overTip.textContent.indexOf('新纪录') !== -1,
  '真正破纪录应报「新纪录」，实际文案：' + els.overTip.textContent);
store[BEST_KEY] = '0';         // 还原，避免影响后续段落

// ============================================================
section('6) 地面：首次触地扣一颗心，无敌结束仍贴地免费小弹一次');
// ============================================================
const GY = W.__fb.WORLD.GROUND_Y;

// 场景 A：触地后立刻拍翅膀逃离——整个无敌期只掉一颗心，游戏继续
W.__fb.gotoStart();
W.__fb.clearPipes();
W.__fb.startNow();
W.__fb.setPlayerY(GY - 16);
W.__fb.clearInv();
W.__fb.freeze(false);                 // 改用真实时钟驱动：tick(50) 每帧推 50ms
const recLives0 = W.__fb.lives;
let recSank = false;
for (let i = 0; i < 30; i++) {
  if (i % 10 === 5) W.__fb.flap();    // 无敌期内持续拍翅膀
  tick(50);
  if (W.__fb.player.y > GY) recSank = true;
}
ok(!recSank, '持续拍翅膀时角色不应沉到地面以下（GROUND_Y=' + GY + '）');
ok(W.__fb.lives === recLives0 - 1, '触地一次 + 持续拍翅膀应只掉一颗心，实际 ' + recLives0 + ' -> ' + W.__fb.lives);
ok(W.__fb.state === 'play', '成功恢复后游戏应继续，实际 ' + W.__fb.state);

// 场景 B：无敌期结束仍贴地 → 免费小弹一次（不扣心），此时拍翅膀能直接救回
W.__fb.gotoStart();
W.__fb.clearPipes();
W.__fb.startNow();
W.__fb.setPlayerY(GY - 16);
W.__fb.clearInv();
let bounceAt = -1;
for (let i = 0; i < 40; i++) {
  tick(50);
  if (W.__fb.player.groundGrace === 'bounce') { bounceAt = i; break; }
}
ok(bounceAt >= 0, '无敌期结束仍贴地应触发免费小弹（groundGrace=bounce）');
const livesAtBounce = W.__fb.lives;
ok(livesAtBounce === recLives0 - 1,
  '首次触地照常扣一颗心、免费小弹不额外扣心，实际 ' + recLives0 + ' -> ' + livesAtBounce);
for (let i = 0; i < 20; i++) {
  if (i % 5 === 0) W.__fb.flap();
  tick(50);
}
ok(W.__fb.lives === livesAtBounce && W.__fb.state === 'play',
  '免费小弹后拍翅膀应能救回且不再掉心，实际 lives=' + W.__fb.lives + ' state=' + W.__fb.state);

// 场景 C：全程不操作——贴地站立不沉出屏幕；宽限过了仍贴地才扣下一颗，最终三心耗尽
W.__fb.gotoStart();
W.__fb.clearPipes();
W.__fb.startNow();
W.__fb.setPlayerY(GY - 16);
W.__fb.clearInv();
let idleSank = false, hits = 0, prevLives = W.__fb.lives, maxY = 0, bounceSeen = false;
const hitTicks = [];
for (let i = 0; i < 140 && W.__fb.state === 'play'; i++) {
  tick(50);
  if (W.__fb.player.y > maxY) maxY = W.__fb.player.y;
  if (W.__fb.player.y > GY) idleSank = true;
  if (W.__fb.player.groundGrace === 'bounce') bounceSeen = true;
  if (W.__fb.lives < prevLives) { hits++; hitTicks.push(i); prevLives = W.__fb.lives; }
}
ok(!idleSank, '全程角色不应沉到地面以下，实际最低点 y=' + Math.round(maxY) + '（GROUND_Y=' + GY + '）');
ok(bounceSeen, '不操作时也应先出现免费小弹的宽限期');
ok(hitTicks.length >= 2 && hitTicks[1] - hitTicks[0] >= 40,
  '两次扣心之间应多出免费小弹 + 宽限（≥2s），实际间隔 ' +
  (hitTicks.length >= 2 ? (hitTicks[1] - hitTicks[0]) * 50 + 'ms' : '不足两次'));
ok(W.__fb.state === 'over' && hits === 3,
  '宽限过后仍贴地才逐颗扣心，最终三心耗尽结算，实际 state=' + W.__fb.state + ' / 掉心 ' + hits + ' 次');
const idleScore = W.__fb.score;   // 诊断：贴地不操作期间柱子滚过是否白送分
// 场景 D：无敌期内成功飞离地面，很久以后再摔下来，保护期不该被无限期携带
W.__fb.gotoStart();
W.__fb.clearPipes();
W.__fb.startNow();
W.__fb.setPlayerY(GY - 16);
W.__fb.clearInv();
tick(50);                                  // 首次触地：扣一颗心，进入 'inv'
const afterFirstHit = W.__fb.lives;
for (let i = 0; i < 40; i++) {             // 飞满 2s，越过 1.4s 无敌期，全程不贴地
  if (i % 5 === 0) W.__fb.flap();
  tick(50);
}
ok(W.__fb.player.y + 15 < GY, '场景 D 前置：此时角色应在空中');
W.__fb.setPlayerY(GY - 16);
const beforeLateFall = W.__fb.lives;
tick(50);
ok(W.__fb.lives === beforeLateFall - 1,
  '飞离地面后很久再摔下应正常扣心，实际 ' + afterFirstHit + ' -> ' + beforeLateFall + ' -> ' + W.__fb.lives);
W.__fb.gotoStart();

console.log('  · 落地时间线 ' + JSON.stringify({
  bounceAt: bounceAt, livesAtBounce: livesAtBounce,
  hitTicks: hitTicks, hitGapsMs: hitTicks.slice(1).map(function (t, k) {
    return (t - hitTicks[k]) * 50;
  }), idleScore: idleScore
}));
W.__fb.freeze(true);                  // 还原冻结，后续段维持原 step 驱动方式
W.TVInput.trigger('back');            // 结算页回标题，复位给下一段

// ============================================================
section('7) 暂停 / 恢复 / 切后台 / resize');
// ============================================================
els.btnStart.__fire('click');
tick(0);
W.TVInput.trigger('back');
ok(W.__fb.state === 'pause', '预备 / 游戏中按返回应暂停，实际 ' + W.__fb.state);
els.btnResume.__fire('click');
ok(W.__fb.state === 'ready' || W.__fb.state === 'play', '点继续应回到游戏，实际 ' + W.__fb.state);

W.__fb.startNow();
documentStub.hidden = true;
documentStub.__fire('visibilitychange');
ok(W.__fb.state === 'pause', '切后台应自动暂停，实际 ' + W.__fb.state);
documentStub.hidden = false;
els.btnResume.__fire('click');
ok(W.__fb.state === 'play', '手动继续应回到可玩，实际 ' + W.__fb.state);

sandbox.__fire('blur');
ok(W.__fb.state === 'pause', '窗口失焦应自动暂停，实际 ' + W.__fb.state);
els.btnResume.__fire('click');

let sizeErr = null;
try {
  [[640, 420], [1280, 720], [960, 540], [420, 780]].forEach(function (wh) {
    sandbox.innerWidth = wh[0];
    sandbox.innerHeight = wh[1];
    sandbox.__fire('resize');
    tick(16); tick(16);
  });
} catch (e) { sizeErr = e.message; }
ok(!sizeErr, '多次 resize（重建预渲染背景 / 微粒 / 预览）不应抛异常，实际 ' + sizeErr);

// ============================================================
section('8) 源码静态约束（STANDARD §6）');
// ============================================================
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const banned = [
  [/=>/, '箭头函数'],
  [/\blet\s/, 'let 声明'],
  [/\bconst\s/, 'const 声明'],
  [/\bclass\s+\w/, 'class 声明'],
  [/`/, '模板字符串'],
  [/\bimport\s/, 'ES module import'],
  [/\bexport\s/, 'ES module export'],
  [/\.includes\s*\(/, 'Array.prototype.includes'],
  [/Object\.entries\s*\(/, 'Object.entries'],
  [/Object\.values\s*\(/, 'Object.values']
];
['js/game.js', 'js/themes.js', 'js/audio.js', 'index.html'].forEach(rel => {
  const s = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  banned.forEach(([re, name]) => ok(!re.test(s), rel + ' 不应使用 ' + name));
});
const css = stripComments(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
[/display\s*:\s*grid/, /\bgap\s*:/, /\bmin\(/, /\bmax\(/, /\bclamp\(/, /\binset\s*:/,
 /color-mix\(/, /var\(--/, /backdrop-filter/]
  .forEach(re => ok(!re.test(css), 'style.css 不应出现 ' + re));

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

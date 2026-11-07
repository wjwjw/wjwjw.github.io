/*
 * smoke.js —— 迷宫闯关「STANDARD §6 兼容性」冒烟测试（纯 Node，无浏览器）
 *
 * 为什么单开一个文件：maze-challenge 是仓库里最早的游戏，一度用 ES6 写成
 * （class / const / let / 箭头函数 / 模板字符串 / for...of / CSS 变量 / flex gap），
 * 在目标设备 WebView ≈ Chromium 47 上会直接解析失败或样式整条失效。
 * 现已整体转成 ES5，本文件就是**防止 ES6 回潮**的门禁 —— 改一行就会被拦下。
 *
 * 注意：本游戏另有一份 test_engine.js（引擎逻辑 / 关卡可解性），两者互补：
 *   test_engine.js 管「玩得对不对」，smoke.js 管「在电视上跑不跑得起来」。
 *
 * 运行：node test/smoke.js
 */
require('../../test/lint-shared.js');   // 公共层兼容性门禁（STANDARD §6），失败即退出
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

// 去掉块注释、HTML 注释，以及「整行 // 注释」。
// 只 strip 整行注释（^\s*//）而不动行内的 //，避免误伤 URL 之类的字符串；
// 代码里解释「为什么不能用某语法」的注释就写在整行注释或块注释里，正好被去掉。
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

function read(rel) { return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }

// ============================================================
section('1) JS 语法约束（Chromium 47 不支持的 ES6 语法）');
// ============================================================
const bannedSyntax = [
  [/=>/, '箭头函数'],
  [/\blet\s/, 'let 声明'],
  [/\bconst\s/, 'const 声明'],
  [/\bclass\s+\w/, 'class 声明'],
  [/`/, '模板字符串'],
  [/\bimport\s/, 'ES module import'],
  [/\bexport\s/, 'ES module export'],
  [/\bfor\s*\(\s*(?:let|const|var)\s+\w+\s+of\b/, 'for...of 循环'],
  [/\bfor\s*\(\s*(?:let|const|var)\s*\[/, 'for...of 解构'],
];
['js/levels.js', 'js/audio.js', 'js/engine.js', 'js/main.js', '../shared/fx.js'].forEach(rel => {
  const s = read(rel);
  bannedSyntax.forEach(([re, name]) => ok(!re.test(s), rel + ' 不应使用 ' + name));
});

// ============================================================
section('2) 运行时 API 约束（Chromium 47 上没有 / 会静默出错的）');
// ============================================================
const bannedApi = [
  [/\.includes\s*\(/, 'Array.prototype.includes（Chrome 47 没有，用 indexOf !== -1）'],
  [/Object\.entries\s*\(/, 'Object.entries（Chrome 54+）'],
  [/Object\.values\s*\(/, 'Object.values（Chrome 54+）'],
  [/\.padStart\s*\(/, 'String.prototype.padStart（Chrome 57+）'],
  [/\.padEnd\s*\(/, 'String.prototype.padEnd（Chrome 57+）'],
  // 老 WebView 不理解 options 对象，会把 { passive: true } 当成 capture=true
  [/passive\s*:\s*true/, 'addEventListener 的 { passive: true }（老 WebView 会误判为 capture）'],
  [/\bBacktickTest\b/, '占位'],
];
['js/levels.js', 'js/audio.js', 'js/engine.js', 'js/main.js'].forEach(rel => {
  const s = read(rel);
  bannedApi.forEach(([re, name]) => {
    if (name === '占位') return;
    ok(!re.test(s), rel + ' 不应使用 ' + name);
  });
});

// ============================================================
section('3) CSS 约束（STANDARD §6）');
// ============================================================
const css = read('style.css');
[/display\s*:\s*grid/, /\bgap\s*:/, /\bmin\(/, /\bmax\(/, /\bclamp\(/, /\binset\s*:/, /color-mix\(/, /backdrop-filter/]
  .forEach(re => ok(!re.test(css), 'style.css 不应出现 ' + re));
// CSS 自定义属性要 Chrome 49+；失效时按钮底色/阴影会整条变透明，是静默故障
ok(!/var\(--/.test(css), 'style.css 不应使用 CSS 自定义属性 var(--x)（Chrome 49+ 才支持）');

// ============================================================
section('4) HTML 约束（STANDARD §6）');
// ============================================================
const html = read('index.html');
ok(!/type\s*=\s*["']module["']/.test(html), 'index.html 不应使用 ES module');
ok(!/<script[^>]*\bimport\b/.test(html), 'index.html 不应在 script 里用 import');
// 彩色 emoji 在电视上会渲染成 □；文字符号（★☆♪✦✕）与 inline SVG 是允许的
ok(!/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/u.test(html), 'index.html 不应含彩色 emoji');
// 特效公共层必须在 engine.js 之前加载（engine 构造 Game 时就用到 FX）
ok(/<script src="\.\.\/shared\/fx\.js"><\/script>/.test(html), 'index.html 应引入 ../shared/fx.js');

// ============================================================
section('5) 关卡数据');
// ============================================================
let levels = null;
try { levels = require(path.join(ROOT, 'js/levels.js')); }
catch (e) { /* 下面断言会报出来 */ }
ok(Array.isArray(levels) && levels.length > 0, 'levels.js 应导出非空关卡数组');
if (Array.isArray(levels)) {
  let shapeOk = true, startOk = true, endOk = true;
  levels.forEach(function (lv) {
    if (!lv.grid || !lv.grid.length || !lv.name) shapeOk = false;
    const flat = (lv.grid || []).join('');
    if (flat.indexOf('@') < 0) startOk = false;
    if (flat.indexOf('E') < 0) endOk = false;
  });
  ok(shapeOk, '每关都应有 name 与非空 grid');
  ok(startOk, '每关都应有起点 @');
  ok(endOk, '每关都应有终点 E');
}

// ============================================================
section('6) 脚本可被解析（语法完整性）');
// ============================================================
['js/levels.js', 'js/audio.js', 'js/engine.js', 'js/main.js'].forEach(rel => {
  let err = null;
  try { new vm.Script(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel }); }
  catch (e) { err = e.message; }
  ok(!err, rel + ' 应能被解析，实际 ' + err);
});

// ============================================================
section('7) 暂停/恢复 BGM 成对启停（vm 抽取 pauseGameUI / resumeGameUI 真实源码）');
// ============================================================
// 修复前各暂停/恢复调用点散落 game.pause()/resume()，漏掉 stopBGM/startBGM，
// 暂停、切后台、通关 BGM 都继续播（STANDARD §9）。统一入口的配对行为在这里固化。
{
  const raw = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  const s0 = raw.indexOf('function pauseGameUI');
  const s1 = raw.indexOf('function handleBack', s0);
  ok(s0 > 0 && s1 > s0, '应能按标记切出 pauseGameUI/resumeGameUI 片段（门禁自身基准）');
  if (s0 > 0 && s1 > s0) {
    const calls = { stopBGM: 0, startBGM: 0, audioResume: 0, paused: 0, resumed: 0, shown: '', hidAll: 0 };
    const mz = {
      game: null,
      Focus: {},
      audio: {
        stopBGM() { calls.stopBGM++; },
        startBGM() { calls.startBGM++; },
        resume() { calls.audioResume++; }
      },
      show(id) { calls.shown = id; },
      hideAll() { calls.hidAll++; },
      setHud() {}
    };
    vm.createContext(mz);
    vm.runInContext(raw.slice(s0, s1), mz, { filename: 'pause-resume-extract' });
    const mkGame = (state) => ({
      state,
      pause() { calls.paused++; this.state = 'paused'; },
      resume() { if (this.state === 'paused') { calls.resumed++; this.state = 'playing'; } }
    });

    // 通关庆祝("win")期间不暂停：BGM 也不该被收（守卫见 STANDARD §10.6）
    mz.game = mkGame('win');
    mz.pauseGameUI();
    ok(calls.paused === 0 && calls.stopBGM === 0, '非 playing 态不应暂停、不应收 BGM');

    // playing → 暂停：game.pause() + stopBGM() + 弹暂停层，三件事必须成对
    mz.game = mkGame('playing');
    mz.pauseGameUI();
    ok(calls.paused === 1 && calls.stopBGM === 1 && calls.shown === 'pauseScreen',
       '暂停应成对执行 game.pause() + stopBGM() + show(pauseScreen)');

    // 恢复：resume() + 音频 resume() + startBGM() 成对
    mz.resumeGameUI();
    ok(calls.resumed === 1 && calls.audioResume === 1 && calls.startBGM === 1 &&
       calls.hidAll === 1 && mz.Focus.screen === 'game',
       '恢复应成对执行 game.resume() + audio.resume() + startBGM() 并回游戏界面');

    // 不在 paused 态恢复（如已 idle）：引擎不会真正恢复 → 不得误起 BGM
    mz.game = mkGame('idle');
    const startBGM0 = calls.startBGM;
    const resumed0 = calls.resumed;
    mz.resumeGameUI();
    ok(calls.startBGM === startBGM0 && calls.resumed === resumed0,
       '引擎未真正恢复（非 paused→playing）时不应起 BGM');
  }
}

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

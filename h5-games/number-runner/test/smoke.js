/*
 * smoke.js —— 数字跑酷 3D「STANDARD §6 兼容性」冒烟测试（纯 Node，无浏览器）
 *
 * number-runner 是七个游戏里最大、迭代最频繁的文件（game.js 1700+ 行，three.js 3D），
 * 也是最后一个补门禁的：任何一个 const / 箭头函数混进去，目标电视 WebView ≈ Chromium 47
 * 上就是整页白屏。本文件防 ES6 回潮 + 防特效层/3D 依赖被误删。
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

// 去掉块注释、HTML 注释，以及「整行 // 注释」——解释「为什么不能用某语法」的注释写在
// 整行注释或块注释里，正好被去掉，不会误报（与 maze-challenge/test/smoke.js 同一套）。
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
['js/game.js', 'js/audio.js', '../shared/fx.js'].forEach(rel => {
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
  [/passive\s*:\s*true/, 'addEventListener 的 { passive: true }（老 WebView 会误判为 capture）'],
];
['js/game.js', 'js/audio.js', '../shared/fx.js'].forEach(rel => {
  const s = read(rel);
  bannedApi.forEach(([re, name]) => ok(!re.test(s), rel + ' 不应使用 ' + name));
});

// ============================================================
section('3) 表现红线（fx.js 约定，见 docs/STANDARD.md §10.3）');
// ============================================================
const gameJs = read('js/game.js');
// 红线#3：震屏必须 sin/cos 相位确定性抖动——随机抖在弱机上表现为「闪」，轨迹不可复现
ok(!/Math\.random\(\)\s*-\s*0\.5\)\s*\*\s*shake/.test(gameJs),
  '震屏偏移不应使用 Math.random（fx 红线#3，用 shakeClock + sin/cos 相位）');
// 红线#1：update()/render() 函数体内不得创建渐变（每帧建渐变对象 = GC 掉帧主因）。
// 一次性的 CanvasTexture 生成（模型贴图、地面，init/缓存路径）是合法的，按函数体圈定。
function functionBody(src, name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  if (start < 0) return '';
  let depth = 0, i = src.indexOf('{', start);
  const begin = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(begin, i + 1); }
  }
  return '';
}
['update', 'render'].forEach(fn => {
  const body = functionBody(gameJs, fn);
  ok(body.length > 0, 'game.js 应存在 ' + fn + '()（门禁自身基准）');
  ok(!/create(Radial|Linear)Gradient\(/.test(body),
    fn + '() 循环体内不应出现 createXxxGradient（预渲染到离屏再 drawImage）');
});

// ============================================================
section('4) CSS 约束（STANDARD §6）');
// ============================================================
const css = read('style.css');
[/display\s*:\s*grid/, /\bgap\s*:/, /\bmin\(/, /\bmax\(/, /\bclamp\(/, /\binset\s*:/, /color-mix\(/, /backdrop-filter/]
  .forEach(re => ok(!re.test(css), 'style.css 不应出现 ' + re));
ok(!/var\(--/.test(css), 'style.css 不应使用 CSS 自定义属性 var(--x)（Chrome 49+ 才支持）');
// 屏幕空间特效层契约：#fx2d 叠在 WebGL 之上、HUD 之下，且不接指针
ok(/#fx2d\s*\{[^}]*pointer-events\s*:\s*none/.test(css), 'style.css 的 #fx2d 必须 pointer-events:none');
ok(/#fx2d\s*\{[^}]*z-index\s*:\s*5/.test(css), 'style.css 的 #fx2d 应在 z-index:5（HUD=6 之下、画布之上）');

// ============================================================
section('5) HTML 约束（STANDARD §6）');
// ============================================================
const html = read('index.html');
ok(!/type\s*=\s*["']module["']/.test(html), 'index.html 不应使用 ES module');
ok(!/<script[^>]*\bimport\b/.test(html), 'index.html 不应在 script 里用 import');
ok(!/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/u.test(html), 'index.html 不应含彩色 emoji');
// 3D 与特效层依赖必须在场（顺序：three → fx → 游戏代码）
ok(/<script src="\.\.\/assets\/vendor\/three\.min\.js">/.test(html), 'index.html 应引入 three.min.js（r128 本地同域 vendor）');
ok(/<script src="\.\.\/shared\/fx\.js">/.test(html), 'index.html 应引入 ../shared/fx.js（屏幕空间特效层）');
ok(/<canvas id="fx2d">/.test(html), 'index.html 应有 #fx2d 覆盖画布');
ok(/<canvas id="game">/.test(html), 'index.html 应有 #game 渲染画布');

// ============================================================
section('6) 依赖文件在盘（本地同域 vendor，不跨域）');
// ============================================================
ok(fs.existsSync(path.join(ROOT, '../assets/vendor/three.min.js')), '../assets/vendor/three.min.js 应存在');

// ============================================================
section('7) 脚本可被解析（语法完整性）');
// ============================================================
['js/game.js', 'js/audio.js', '../shared/fx.js'].forEach(rel => {
  let err = null;
  try { new vm.Script(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel }); }
  catch (e) { err = e.message; }
  ok(!err, rel + ' 应能被解析，实际 ' + err);
});

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

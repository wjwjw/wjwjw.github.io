/*
 * smoke.js —— 数字跑酷 3D「STANDARD §6 兼容性」冒烟测试（纯 Node，无浏览器）
 *
 * number-runner 是七个游戏里最大、迭代最频繁的文件（game.js 1700+ 行，three.js 3D），
 * 也是最后一个补门禁的：任何一个 const / 箭头函数混进去，目标电视 WebView ≈ Chromium 47
 * 上就是整页白屏。本文件防 ES6 回潮 + 防特效层/3D 依赖被误删。
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

// ============================================================
section('8) HUD 缓存状态机（vm 抽取真实源码 + 假 DOM / 假时钟）');
// ============================================================
// updateHUD 有「值变才写 + 120ms 节流 + comboTag 标记复位」的非平凡状态逻辑，
// 但整个游戏进不了 vm（three.js / WebGL）。从 game.js 原文按标记切出
// hudEls / hudLast / hudLastT / updateHUD 片段，配假 DOM（写入计数）+ 假时钟执行，
// 把节流、值变、连击标签起落、重开局立即刷新全部变成行为断言。
const nrRaw = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');
const hudStart = nrRaw.indexOf('var hudEls = null;');
const hudEnd = nrRaw.indexOf('// ---------- 渲染', hudStart);
ok(hudStart > 0 && hudEnd > hudStart, '应能按标记切出 updateHUD 片段（门禁自身基准）');
if (hudStart > 0 && hudEnd > hudStart) {
  let clock = 1000000;
  let lookups = 0;
  const els = {};
  function makeEl() {
    const st = { text: '', hidden: false, writes: 0 };
    return {
      get textContent() { return st.text; },
      set textContent(v) { st.text = v; st.writes++; },
      classList: {
        add(c) { if (c === 'hidden') st.hidden = true; },
        remove(c) { if (c === 'hidden') st.hidden = false; }
      },
      __st: st
    };
  }
  ['valueText', 'scoreText', 'bestText', 'comboTag'].forEach(id => { els[id] = makeEl(); });
  const sb = {
    document: { getElementById(id) { lookups++; return els[id] || (els[id] = makeEl()); } },
    Date: { now() { return clock; } },
    player: { value: 2 },
    score: 0, best: 0, combo: 0, boss: null
  };
  vm.createContext(sb);
  vm.runInContext(nrRaw.slice(hudStart, hudEnd), sb, { filename: 'updateHUD-extract' });

  // 首帧：全量写入，元素引用进缓存，combo>=2 复位标记
  clock += 200;
  sb.score = 120; sb.player.value = 8; sb.combo = 3; sb.best = 500;
  sb.updateHUD();
  ok(els.scoreText.__st.writes === 1 && els.valueText.textContent === 8 && els.scoreText.textContent === 120,
     '首次调用应写入正确的 value/score');
  ok(els.comboTag.__st.hidden === false, 'combo>=2 时不应隐藏连击标签');
  ok(sb.hudLast.comboHidden === false, 'combo>=2 应复位 comboHidden 标记（否则断连击后收不回）');
  lookups = 0;

  // 120ms 节流窗口内：不查 DOM、不写 DOM
  clock += 50; sb.score = 130;
  sb.updateHUD();
  ok(els.scoreText.__st.writes === 1 && lookups === 0, '120ms 内不应重复查/写 DOM（元素引用应已缓存）');

  // Boss 受击脉冲是 3D 动画，不走节流
  sb.boss = { baseScale: 1.2, mesh: { scale: { x: 1, y: 1, z: 1 } } };
  clock += 10;
  sb.updateHUD();
  ok(sb.boss.mesh.scale.x > 1, 'Boss 脉冲在节流窗口内仍应每帧执行（不碰 DOM，不参与节流）');
  sb.boss = null;

  // 越过窗口：补写被节流期间变化的值；值未变不写；值变才写
  clock += 200; sb.updateHUD();
  ok(els.scoreText.__st.writes === 2 && els.scoreText.textContent === 130, '越过节流窗口应补写变化的值');
  clock += 200; sb.updateHUD();
  ok(els.scoreText.__st.writes === 2, '值未变不应写');
  sb.score = 140; clock += 200; sb.updateHUD();
  ok(els.scoreText.__st.writes === 3, '值变了应写');

  // 连击标签全链路：combo>=2（复位标记 + doMerge 外部摘 hidden）→ 断连击收回
  clock += 200; sb.combo = 0; sb.updateHUD();
  ok(els.comboTag.__st.hidden === true, '断连击应隐藏标签');
  sb.combo = 4; clock += 200; sb.updateHUD();
  els.comboTag.classList.remove('hidden');            // 模拟 doMerge 的显示侧
  ok(sb.hudLast.comboHidden === false, 'combo>=2 再次复位标记');
  sb.combo = 0; clock += 200; sb.updateHUD();
  ok(els.comboTag.__st.hidden === true, '外部摘掉 hidden 后再断连击，标签仍应收回');

  // 重开局：执行从 startLevel 源码抽出的「真实」复位片段（不是手写模拟），
  // 即使正落在节流窗口内也必须立即显示新一局的值
  const slBody = functionBody(stripComments(nrRaw), 'startLevel');
  const resetMatch = slBody.match(/hudLast\s*=\s*\{[^}]*\};\s*hudLastT\s*=\s*0;/);
  ok(!!resetMatch, 'startLevel 应复位 hudLast/hudLastT（模块级缓存跨局保留，重开落在节流窗口内会短暂显示上一局数字）');
  ok(/updateHUD\(\)/.test(slBody), 'startLevel 复位后应立即调一次 updateHUD，不等 120ms 节流');
  // 行为断言无条件执行：复位块在 → 跑真实复位片段；缺失 → 按「不复位」对照跑同一条
  // 断言，此刻必然失败。核心断言不允许被 if 跳过、只剩两条源码结构断言兜底。
  clock += 10;                         // 距上次写入 < 120ms，正落在节流窗口内
  sb.score = 0; sb.player.value = 2; sb.combo = 0; sb.best = 500;
  if (resetMatch) vm.runInContext(resetMatch[0], sb);
  vm.runInContext('updateHUD();', sb);
  ok(els.valueText.textContent === 2 && els.scoreText.textContent === 0,
     '重开局（节流窗口内）应立即显示新 value=2 / score=0，实际 ' +
     els.valueText.textContent + ' / ' + els.scoreText.textContent);
}

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

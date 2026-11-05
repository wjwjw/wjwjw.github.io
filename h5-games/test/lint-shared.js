/*
 * lint-shared.js —— shared/ 公共层兼容性门禁（STANDARD §6）
 *
 * 七个游戏的 smoke 只静态扫各自的 js/game.js + index.html + style.css，
 * shared/ 里除 fx.js 外从未被扫描过：input.js 曾漏出 { passive: true }
 * （Chrome 47 把 options 对象当成 capture=true，七个游戏全部受影响）。
 *
 * 用法：任意游戏 `node test/smoke.js` 会在 require 时自动跑一遍；
 *      也可单独跑 `node h5-games/test/lint-shared.js`。
 * 失败即 process.exit(1)，让宿主 smoke 一起红。
 */
var fs = require('fs');
var path = require('path');

var SHARED = path.resolve(__dirname, '..', 'shared');
var pass = 0;
var fail = 0;

// 与各游戏 smoke 同一套剥离规则：块注释 / HTML 注释 / 整行 // 注释。
// 文档里「不要用 const / 箭头函数」这类说明文字不该被当成违规。
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');
}
function read(name) {
  return stripComments(fs.readFileSync(path.join(SHARED, name), 'utf8'));
}
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  X ' + msg); }
}

var bannedSyntax = [
  [/=>/, '箭头函数'],
  [/\blet\s/, 'let 声明'],
  [/\bconst\s/, 'const 声明'],
  [/\bclass\s+\w/, 'class 声明'],
  [/`/, '模板字符串'],
  [/\bimport\s/, 'ES module import'],
  [/\bexport\s/, 'ES module export'],
  [/\bfor\s*\(\s*(?:let|const|var)\s+\w+\s+of\b/, 'for...of 循环']
];
var bannedApi = [
  [/\.includes\s*\(/, 'Array.prototype.includes（用 indexOf !== -1）'],
  [/Object\.entries\s*\(/, 'Object.entries（Chrome 54+）'],
  [/Object\.values\s*\(/, 'Object.values（Chrome 54+）'],
  [/\.padStart\s*\(/, 'String.prototype.padStart（Chrome 57+）'],
  [/\.padEnd\s*\(/, 'String.prototype.padEnd（Chrome 57+）'],
  [/passive\s*:\s*true/, "addEventListener 的 { passive: true }（Chrome 47 当成 capture=true）"]
];
var bannedCss = [
  [/display\s*:\s*grid/, 'display:grid'],
  [/\bgap\s*:/, 'flex/grid gap'],
  [/var\(--/, 'CSS 自定义属性 var(--x)（Chrome 49+）'],
  [/\bmin\(/, 'min()'],
  [/\bmax\(/, 'max()'],
  [/clamp\(/, 'clamp()'],
  [/\binset\s*:/, 'inset'],
  [/color-mix\(/, 'color-mix()'],
  [/backdrop-filter/, 'backdrop-filter']
];

['input.js', 'nav.js', 'fx.js'].forEach(function (f) {
  ok(fs.existsSync(path.join(SHARED, f)), 'shared/' + f + ' 应存在');
  var s = read(f);
  bannedSyntax.forEach(function (pair) {
    ok(!pair[0].test(s), 'shared/' + f + ' 不应使用 ' + pair[1]);
  });
  bannedApi.forEach(function (pair) {
    ok(!pair[0].test(s), 'shared/' + f + ' 不应使用 ' + pair[1]);
  });
});

ok(fs.existsSync(path.join(SHARED, 'base.css')), 'shared/base.css 应存在');
var css = read('base.css');
bannedCss.forEach(function (pair) {
  ok(!pair[0].test(css), 'shared/base.css 不应出现 ' + pair[1]);
});

if (fail) {
  console.error('shared lint: FAILED  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
} else if (require.main === module) {
  console.log('OK shared lint ALL PASS  ' + pass + ' passed, 0 failed');
}

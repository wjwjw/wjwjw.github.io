/*
 * test/in-launcher.js —— 端到端：在「掌中灵 TV 游戏厅」里真的打开 puzzle-slide
 *
 * 冒烟测试只能证明游戏自己能跑；这个脚本证明**接入是对的**：
 * 启动器菜单里能翻到它、点进去 iframe 加载的是 puzzle-slide/index.html、
 * 并且 iframe 里的 Art / Puzzle / TVInput 三个全局都挂上了（脚本没 404）。
 *
 * 用法：先起静态服务器（仓库根目录 python -m http.server 8010），然后
 *   node test/in-launcher.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
// 本地模式：启动器从 localServer 拼 /h5-games/<folder>/<entry>
const PAGE = 'http://127.0.0.1:8010/tv-h5-app/index.html?local=http://127.0.0.1:8010';

const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

async function waitForVersion(tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(150);
  }
  throw new Error('Chrome 调试端口未就绪');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const waiting = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const w = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error.message));
      else w.resolve(msg.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  return { ready, send, close: () => ws.close() };
}

(async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'ps-chrome-launcher'),
    'about:blank'
  ], { stdio: 'ignore' });

  let client = null;
  try {
    await waitForVersion(60);
    const target = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank',
      { method: 'PUT' })).json();
    client = connect(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    const evalJs = async expr => {
      const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result && r.result.value;
    };

    await client.send('Page.navigate', { url: PAGE });
    await sleep(1800);

    // ① 菜单里应出现「拼图乐园」
    const titles = await evalJs(
      "(function(){var a=[];var n=document.querySelectorAll('[data-game-id], .game-item, .card');" +
      "for(var i=0;i<n.length;i++){var t=n[i].getAttribute('data-game-id')||n[i].textContent||'';" +
      "a.push(t.replace(/\\s+/g,' ').slice(0,40));}return a.join(' | ');})()");
    ok(/拼图乐园/.test(titles), '启动器菜单应出现「拼图乐园」（实际：' + titles.slice(0, 160) + '）');

    // ② 直接用启动器自己的地址拼装规则取 URL，验证路径对得上真实文件
    const built = await evalJs(
      "(function(){var c=window.APP_CONFIG;var g=null;" +
      "for(var i=0;i<c.games.length;i++){if(c.games[i].id==='puzzle-slide')g=c.games[i];}" +
      "if(!g)return '';" +
      "var root=(c.useRemote?c.remoteBase:c.localServer)+'/h5-games';" +
      "return root+'/'+g.folder+'/'+(g.entry||'index.html');})()");
    ok(/puzzle-slide\/index\.html$/.test(built), 'config 拼出的地址应指向 puzzle-slide（实际 ' + built + '）');

    // ③ 直接让 iframe 装载该地址，看游戏内部是否真的起来了
    await evalJs(
      "(function(){var f=document.createElement('iframe');f.id='__probe';" +
      "f.style.width='960px';f.style.height='540px';f.src='" + built + "';" +
      "document.body.appendChild(f);return 'APPENDED';})()");
    await sleep(2200);

    const inner = await evalJs(
      "(function(){try{var w=document.getElementById('__probe').contentWindow;" +
      "var d=w.document;" +
      "return {art:!!w.Art,puzzle:!!w.Puzzle,input:!!w.TVInput," +
      "title:d.title,start:!!d.getElementById('btnStart')," +
      "canvas:!!d.getElementById('game')," +
      "scenes:w.Art?w.Art.SCENES.length:0};}catch(e){return {err:String(e)};}})()");

    ok(!inner.err, '应能访问 iframe 内部（' + (inner.err || 'no error') + '）');
    ok(inner.art && inner.puzzle && inner.input,
      'iframe 内 Art/Puzzle/TVInput 应全部就绪（' + inner.art + '/' + inner.puzzle + '/' + inner.input + '）');
    ok(inner.scenes === 6, 'iframe 内应有 6 个场景，实际 ' + inner.scenes);
    ok(inner.start && inner.canvas, 'iframe 内应有 #game canvas 与「开始拼图」按钮');
    ok(/滑动拼图/.test(inner.title || ''), 'iframe 标题应为滑动拼图页（实际「' + inner.title + '」）');

    console.log('\n' + (fail === 0 ? '✅ IN-LAUNCHER OK' : '❌ IN-LAUNCHER FAILED') +
      '  ' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    if (client) client.close();
    chrome.kill();
  }
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });

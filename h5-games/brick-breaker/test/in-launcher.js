/*
 * test/in-launcher.js —— 启动器接入验收（CDP）
 *
 * smoke.js 只证明「游戏自己能跑」，这里证明「接进电视启动器也是对的」：
 * config.js 里有条目且 completed、菜单渲染出标题、图标路径能取到、
 * 以及按 folder/entry 拼出来的地址真的能在 iframe 里加载出全部脚本（不是 404 页）。
 * 参考 kids-quiz/test/in-launcher.js 与 STANDARD.md 第 9 节。
 *
 * 用法：先在仓库根起静态服务器（python -m http.server 8010），然后
 *   node test/in-launcher.js
 * 环境变量：BB_HTTP_PORT（默认 8010）、BB_CDP_PORT（默认 9224）、CHROME_PATH。
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = Number(process.env.BB_HTTP_PORT || 8010);
const PORT = Number(process.env.BB_LAUNCHER_CDP_PORT || 9224);
const BASE = 'http://127.0.0.1:' + HTTP_PORT;
const LAUNCHER = BASE + '/tv-h5-app/index.html?local=' + encodeURIComponent(BASE);

const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  → ' + extra : ''));
  if (!ok) failures++;
}

async function waitForVersion(tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(150);
  }
  throw new Error('Chrome 调试端口 ' + PORT + ' 未就绪');
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
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,820', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'brick-breaker-chrome-launcher-' + PORT),
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
      const r = await client.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result && r.result.value;
    };

    await client.send('Page.navigate', { url: LAUNCHER });
    await sleep(1100);

    const cfg = await evalJs(
      '(function(){var g=window.APP_CONFIG&&APP_CONFIG.games||[],r=null;' +
      'for(var i=0;i<g.length;i++)if(g[i].id==="brick-breaker")r=g[i];' +
      'return {found:!!r,cfg:r,total:g.length,' +
      'menuText:(document.body.textContent||"").indexOf("弹球打砖块")>=0,' +
      'hasFlipping:g.some(function(x){return x.id==="flipping-bird";})};})()');
    check('config.js 里存在 brick-breaker 条目', cfg.found === true, JSON.stringify(cfg.cfg));
    check('completed 为 true 且 folder/entry/icon 已填',
      !!cfg.cfg && cfg.cfg.completed === true && cfg.cfg.folder === 'brick-breaker' &&
      cfg.cfg.entry === 'index.html' && /brick-breaker\.svg$/.test(cfg.cfg.icon),
      cfg.cfg ? cfg.cfg.folder + '/' + cfg.cfg.entry : 'null');
    check('卡片主题色与图标 accent 一致', !!cfg.cfg && cfg.cfg.color === '#b84ad6',
      cfg.cfg ? cfg.cfg.color : 'null');
    check('菜单里渲染出了游戏标题', cfg.menuText === true);
    check('其余游戏条目未被覆盖', cfg.total >= 9 && cfg.hasFlipping === true,
      'total=' + cfg.total + ' hasFlipping=' + cfg.hasFlipping);

    const iconStatus = await evalJs(
      'fetch(' + JSON.stringify(BASE + '/h5-games/assets/icons/brick-breaker.svg') +
      ').then(function(r){return r.status;})');
    check('图标资源可访问（无 404）', iconStatus === 200, String(iconStatus));

    // 按 config 的 folder/entry 拼地址，塞进同源 iframe 验证脚本真正加载
    const loaded = await evalJs(
      '(function(){return new Promise(function(resolve){' +
      'var f=document.createElement("iframe");' +
      'f.style.cssText="position:absolute;left:-9999px;width:960px;height:540px";' +
      'f.src=' + JSON.stringify(BASE + '/h5-games/brick-breaker/index.html#debug') + ';' +
      'var done=function(){setTimeout(function(){' +
      'var w=f.contentWindow,d=f.contentDocument;' +
      'resolve({title:d&&d.title,canvas:d&&d.querySelectorAll("canvas").length,' +
      'TVInput:!!(w&&w.TVInput),FX:!!(w&&w.FX),Logic:!!(w&&w.BrickLogic),' +
      'Audio:!!(w&&w.AudioManager),Nav:!!(w&&w.TVNav),hook:!!(w&&w.__brick),' +
      'state:w&&w.__brick?w.__brick.state:""});},600);};' +
      'f.onload=done;document.body.appendChild(f);' +
      'setTimeout(function(){resolve({timeout:true});},6000);});})()');
    console.log('  · iframe: ' + JSON.stringify(loaded));
    check('iframe 内入口不是 404 页且脚本全部加载',
      !loaded.timeout && loaded.canvas === 1 && loaded.TVInput && loaded.FX &&
      loaded.Logic && loaded.Audio && loaded.Nav && loaded.hook,
      JSON.stringify(loaded));
    check('iframe 内游戏停在标题页', loaded.state === 'start', loaded.state);

    console.log(failures ? '\n  FAILED: ' + failures + ' 项未通过' : '\n  全部通过');
  } finally {
    if (client) client.close();
    chrome.kill();
  }
  if (failures) process.exit(1);
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });

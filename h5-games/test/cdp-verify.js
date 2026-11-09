/*
 * h5-games/test/cdp-verify.js —— 新游戏真实 Chrome 验收（CDP，STANDARD §9）
 *
 * 补上纯 Node smoke 覆盖不到的两件事：
 *   1) 真浏览器里脚本全部加载、无 404 / 无未捕获异常、多视口布局不越界、
 *      遥控器语义键（方向 / U / R / OK）真的能驱动游戏；
 *   2) 接进 tv-h5-app 启动器后 config 条目 / 菜单标题 / 图标 / 同源 iframe 都对。
 *
 * 自起静态服务与 headless Chrome，不依赖外部已起的 8010 / 9222，
 * 端口和 Chrome 路径可用环境变量覆盖：
 *   CDP_HTTP_PORT（默认 8011）、CDP_PORT（默认 9225）、CHROME_PATH
 *
 * 用法（在仓库任意目录执行）：
 *   node h5-games/test/cdp-verify.js                        # 三款全验
 *   node h5-games/test/cdp-verify.js sokoban                # 只验一款
 *   node h5-games/test/cdp-verify.js all E:/tmp/cdp-shots   # 指定截图目录
 * 截图默认写系统临时目录，不污染仓库。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const HTTP = Number(process.env.CDP_HTTP_PORT || 8011);
const PORT = Number(process.env.CDP_PORT || 9225);
const BASE = 'http://127.0.0.1:' + HTTP;
const ONLY = process.argv[2] || 'all';
const OUT = process.argv[3] || path.join(os.tmpdir(), 'h5-games-cdp-shots');

const GAMES = {
  'sokoban': {
    title: '推箱子', hook: '__soko', canvases: 2, color: '#b5722e',
    globals: ['TVInput', 'FX', 'TVNav', 'AudioManager', 'SokoThemes', 'LEVELS']
  },
  'flipping-bird': {
    title: '振翅飞行', hook: '__fb', canvases: 2, color: '#a4c639',
    globals: ['TVInput', 'FX', 'TVNav', 'AudioManager', 'FBThemes']
  },
  'brick-breaker': {
    title: '弹球打砖块', hook: '__brick', canvases: 1, color: '#b84ad6',
    globals: ['TVInput', 'FX', 'TVNav', 'AudioManager', 'BrickLogic']
  }
};

const IDS = ONLY === 'all' ? Object.keys(GAMES) : [ONLY];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const errors = [], bad = [];

function check(name, ok, extra) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  → ' + extra : ''));
  if (!ok) failures++;
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
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push((msg.params.exceptionDetails.exception || {}).description ||
                  msg.params.exceptionDetails.text);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' &&
               msg.params.entry.text.indexOf('Failed to load resource') < 0) {
      // 资源加载失败由下面的 Network.responseReceived 统一判定（favicon 404 不算）
      errors.push(msg.params.entry.text);
    } else if (msg.method === 'Network.responseReceived' &&
               msg.params.response.status >= 400 &&
               msg.params.response.url.indexOf('favicon.ico') < 0) {
      bad.push(msg.params.response.status + ' ' + msg.params.response.url);
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
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }
  return { ready: ready, send: send, close: function () { ws.close(); } };
}

async function waitPort(tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('Chrome 调试端口 ' + PORT + ' 未就绪');
}

// python -m http.server 比 Chrome 慢半拍，首屏导航过早会落在 404 页上
async function waitHttp(tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + '/index.html');
      if (r.ok) return;
    } catch (e) { /* 还没起来 */ }
    await sleep(150);
  }
  throw new Error('静态服务 ' + HTTP + ' 未就绪');
}

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('python', ['-m', 'http.server', String(HTTP)],
    { cwd: ROOT, stdio: 'ignore' });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--window-size=1280,820',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'h5-games-cdp-' + PORT),
    'about:blank'
  ], { stdio: 'ignore' });

  let client = null;
  try {
    await waitPort(60);
    await waitHttp(40);
    const target = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank',
      { method: 'PUT' })).json();
    client = connect(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('Log.enable');

    const evalJs = async expr => {
      const r = await client.send('Runtime.evaluate',
        { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result && r.result.value;
    };
    const shot = async name => {
      const r = await client.send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(OUT, name + '.png');
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      console.log('  · 截图 ' + f);
    };
    const pressKey = async (key, code, vk) => {
      for (const type of ['keyDown', 'keyUp']) {
        await client.send('Input.dispatchKeyEvent', {
          type: type, key: key, code: code,
          windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
        });
      }
    };
    const setViewport = async (w, h) => {
      await client.send('Emulation.setDeviceMetricsOverride',
        { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(280);
    };

    // ---------- 1) 每款游戏：真浏览器加载 / 多视口 / 键盘语义 ----------
    for (const id of IDS) {
      const g = GAMES[id];
      if (!g) throw new Error('未知游戏 id：' + id);
      errors.length = 0; bad.length = 0;
      console.log('\n[' + id + '] ' + BASE + '/h5-games/' + id + '/index.html#debug');

      const pageUrl = BASE + '/h5-games/' + id + '/index.html#debug';
      await client.send('Page.navigate', { url: pageUrl });
      let booted = false;
      for (let i = 0; i < 80; i++) {
        try {
          booted = await evalJs('!!window.' + g.hook +
            ' && document.querySelectorAll("canvas").length > 0');
        } catch (e) { booted = false; }
        if (booted) break;
        if (i === 25) await client.send('Page.navigate', { url: pageUrl }); // 兜底重导航
        await sleep(200);
      }
      check(id + ' 入口加载出 #debug 钩子与 canvas', booted);
      if (!booted) continue;
      await sleep(800);   // 覆盖层渐入 + JS 兜底摘类

      const bootExpr = '(function(){var w=window;return {' +
        g.globals.map(function (k) { return k + ':!!w.' + k; }).join(',') +
        ',canvases:document.querySelectorAll("canvas").length,title:document.title};})()';
      const boot = await evalJs(bootExpr);
      check(id + ' shared 与游戏脚本全部挂载',
        g.globals.every(function (k) { return boot[k] === true; }), JSON.stringify(boot));
      check(id + ' canvas 数量符合入口契约', boot.canvases === g.canvases,
        boot.canvases + ' / 期望 ' + g.canvases);
      check(id + ' title 为「游戏名 · 副标题」',
        boot.title.indexOf('·') > 0 && boot.title.indexOf('游戏厅') < 0, boot.title);

      // 推箱子停在标题页时 grid 尚未建立，布局量化必须先进入一关
      if (id === 'sokoban') {
        await evalJs('window.__soko.startLevel(0); true');
        await sleep(200);
      }

      for (const wh of [[960, 540], [1280, 720], [420, 780]]) {
        await setViewport(wh[0], wh[1]);
        const tag = wh.join('x');
        if (id === 'sokoban') {
          const L = await evalJs('(function(){var L=window.__soko.layout();' +
            'return {vw:L.vw,vh:L.vh,x:L.bx0,y:L.by0,tile:L.tile,' +
            'r:L.bx0+L.tile*L.cols,b:L.by0+L.tile*L.rows};})()');
          check(id + ' ' + tag + ' 棋盘不越界 / 不被 HUD 遮挡',
            L.vw === wh[0] && L.vh === wh[1] && L.x >= 19 &&
            L.r <= L.vw - 19 && L.y >= 51 && L.b <= L.vh - 19,
            JSON.stringify(L));
        } else {
          const d = await evalJs('(function(){var c=document.getElementById("game")' +
            '.getBoundingClientRect();return {vw:innerWidth,vh:innerHeight,' +
            'sw:document.documentElement.scrollWidth,cw:c.width,ch:c.height};})()');
          check(id + ' ' + tag + ' 无横向溢出且 canvas 铺满视口',
            d.vw === wh[0] && d.sw <= d.vw + 1 && d.cw > 0 && d.ch > 0,
            JSON.stringify(d));
        }
        if (wh[0] === 960) await shot(id + '-960x540');
      }
      await client.send('Emulation.clearDeviceMetricsOverride');
      await sleep(200);

      if (id === 'sokoban') {
        // 用第 2 关：第 1 关「一次右推」即通关，按 U/R 时已是 win 状态（设计上不响应）
        await evalJs('window.__keyProbe=[];window.addEventListener("keydown",' +
          'function(e){window.__keyProbe.push(e.key+":"+e.keyCode+":"+e.which);});' +
          'window.__soko.progress().unlocked = 18; window.__soko.startLevel(1); true');
        await sleep(200);
        await pressKey('ArrowUp', 'ArrowUp', 38);
        await sleep(600);
        const moved = await evalJs('window.__soko.counts().moves');
        check('sokoban 方向键真机可走格', moved === 1, 'moves=' + moved);
        await pressKey('u', 'KeyU', 85);
        await sleep(250);
        const undone = await evalJs('window.__soko.counts().moves');
        check('sokoban U 键真机可撤销', undone === 0, 'moves=' + undone);
        await pressKey('r', 'KeyR', 82);
        await sleep(250);
        const restarted = await evalJs('window.__soko.counts().moves');
        check('sokoban R 键真机可重开', restarted === 0, 'moves=' + restarted);
        const diag = await evalJs('(function(){return {keys:window.__keyProbe,' +
          'state:window.__soko.state(),counts:window.__soko.counts()};})()');
        console.log('  · 按键诊断 ' + JSON.stringify(diag));
      }
      if (id === 'flipping-bird') {
        await evalJs('window.__fb.startNow(); true');
        await sleep(120);
        await pressKey(' ', 'Space', 32);
        await sleep(140);
        const vy = await evalJs('window.__fb.player.vy');
        check('flipping-bird OK 键真机可拍翅膀', vy < 0, 'vy=' + vy);

        // 模拟「无敌期刚结束、角色仍贴地」：应免费小弹一次而不是扣心
        // 真机 rAF 约 16ms/帧，必须把角色放在「已经贴地」的位置（GROUND_Y-10），
        // 否则第一帧还没越过触地阈值，会被判成「无敌期在空中结束」而清掉保护标记。
        const guardLives = await evalJs('(function(){var w=window.__fb,p=w.player;' +
          'p.y=w.WORLD.GROUND_Y-10;p.vy=0;p.invUntil=Date.now()-1;' +
          'p.groundGrace="inv";return w.lives;})()');
        await sleep(160);
        const bounce = await evalJs('(function(){var w=window.__fb,p=w.player;' +
          'return {grace:p.groundGrace,vy:p.vy,lives:w.lives};})()');
        check('flipping-bird 无敌结束仍贴地免费小弹且不扣心',
          bounce.grace === 'bounce' && bounce.vy < 0 && bounce.lives === guardLives,
          JSON.stringify(bounce));
      }
      check(id + ' 无未捕获异常 / console error', errors.length === 0,
        errors.slice(0, 3).join(' | '));
      check(id + ' 无 >=400 资源请求', bad.length === 0, bad.slice(0, 3).join(' | '));
    }

    // ---------- 2) 启动器内实测（STANDARD §9） ----------
    console.log('\n[tv-h5-app] ' + BASE + '/tv-h5-app/index.html?local=...');
    errors.length = 0; bad.length = 0;
    await client.send('Page.navigate',
      { url: BASE + '/tv-h5-app/index.html?local=' + encodeURIComponent(BASE) });
    await sleep(1300);
    const menu = await evalJs('(function(){var g=(window.APP_CONFIG&&window.APP_CONFIG.games)||[];' +
      'return {total:g.length,ids:g.map(function(x){return x.id;}),' +
      'text:document.body.textContent||""};})()');
    check('启动器 config 含三款新游戏',
      IDS.every(function (id) { return menu.ids.indexOf(id) >= 0; }),
      'total=' + menu.total + ' ids=' + menu.ids.join(','));

    for (const id of IDS) {
      const g = GAMES[id];
      const cfg = await evalJs('(function(){var a=(window.APP_CONFIG&&window.APP_CONFIG.games)||[];' +
        'for(var i=0;i<a.length;i++)if(a[i].id===' + JSON.stringify(id) + ')return a[i];' +
        'return null;})()');
      check(id + ' config 条目 completed / folder / entry / icon / color',
        !!cfg && cfg.completed === true && cfg.folder === id &&
        cfg.entry === 'index.html' && cfg.icon.indexOf(id + '.svg') > 0 &&
        cfg.color === g.color, JSON.stringify(cfg));
      check(id + ' 启动器菜单渲染出标题', menu.text.indexOf(g.title) >= 0);
      const iconStatus = await evalJs('fetch(' +
        JSON.stringify(BASE + '/h5-games/assets/icons/' + id + '.svg') +
        ').then(function(r){return r.status;})');
      check(id + ' 图标资源 200（无 404）', iconStatus === 200, String(iconStatus));

      const iframeUrl = BASE + '/h5-games/' + id + '/index.html#debug';
      const loaded = await evalJs('(function(){return new Promise(function(resolve){' +
        'var f=document.createElement("iframe");' +
        'f.style.cssText="position:absolute;left:-9999px;width:960px;height:540px";' +
        'f.src=' + JSON.stringify(iframeUrl) + ';' +
        'f.onload=function(){setTimeout(function(){var w=f.contentWindow,d=f.contentDocument;' +
        'resolve({title:d&&d.title,canvas:d&&d.querySelectorAll("canvas").length,' +
        'TVInput:!!(w&&w.TVInput),FX:!!(w&&w.FX),Audio:!!(w&&w.AudioManager),' +
        'Nav:!!(w&&w.TVNav),hook:!!(w&&w.' + g.hook + ')});},700);};' +
        'document.body.appendChild(f);' +
        'setTimeout(function(){resolve({timeout:true});},8000);});})()');
      check(id + ' 同源 iframe 内脚本全部加载（不是 404 页）',
        !loaded.timeout && loaded.canvas >= 1 && loaded.TVInput && loaded.FX &&
        loaded.Audio && loaded.Nav && loaded.hook, JSON.stringify(loaded));
    }
    await shot('launcher');

    console.log('\n' + (failures ? '❌ FAILED  ' + failures + ' 项未通过' : '✅ ALL PASS'));
    console.log('截图目录：' + OUT);
  } finally {
    if (client) client.close();
    chrome.kill();
    server.kill();
  }
  if (failures) process.exit(1);
})().catch(function (e) {
  console.error('CDP FAILED: ' + e.message);
  process.exit(1);
});

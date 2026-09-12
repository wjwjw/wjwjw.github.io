/*
 * test/layout.js —— 排版几何校验（CDP）
 *
 * 拼图的版面是「棋盘 + 右侧目标缩略图」两块，都画在 canvas 上、由 computeLayout 算出来。
 * 纯 Node 冒烟测不到几何，截图又要靠肉眼，所以这里把「量」取回来做断言：
 *
 *   1. 用 window.__puzzle.layout() 拿棋盘 / 缩略图 / 提示行的矩形（CSS 像素）；
 *   2. 用 getImageData 在棋盘区域采样，**统计不同颜色的数量** —— 证明那里真的画了
 *      一张有内容的画，而不是一块纯色矩形（drawImage 切片失败时最容易出现的哑火）；
 *   3. 断言矩形都在视口内、互不重叠、单块尺寸够大（10-foot UI ≥44px）。
 *
 * 用法：先起静态服务器（仓库根目录 python -m http.server 8010），然后
 *   node test/layout.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const PAGE = 'http://127.0.0.1:8010/h5-games/puzzle-slide/index.html';

// 三种视口：桌面、电视 10-foot 基准（960×540）、小窗
const CASES = [
  { w: 1280, h: 720, name: '1280x720 桌面' },
  { w: 960, h: 540, name: '960x540  电视基准' },
  { w: 640, h: 420, name: '640x420  小窗' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('    ✓ ' + msg); }
  else { fail++; console.log('    ✗ ' + msg); }
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

// 在棋盘区域采样 8×8 个点，统计不同颜色的数量
const SAMPLE_BOARD = `(function(L){
  var c = document.getElementById('game');
  var ctx = c.getContext('2d');
  var s = c.width / window.innerWidth;
  var seen = {}, n = 0;
  for (var i = 0; i < 8; i++) {
    for (var j = 0; j < 8; j++) {
      var x = Math.round((L.bx + L.size * (i + 0.5) / 8) * s);
      var y = Math.round((L.by + L.size * (j + 0.5) / 8) * s);
      var d = ctx.getImageData(x, y, 1, 1).data;
      var k = d[0] + ',' + d[1] + ',' + d[2];
      if (!seen[k]) { seen[k] = 1; n++; }
    }
  }
  return n;
})(window.__puzzle.layout())`;

(async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'ps-chrome-layout'),
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
    await sleep(900);
    const boot = await evalJs('!!window.Art + "/" + !!window.Puzzle + "/" + !!window.TVInput');
    if (boot !== 'true/true/true') throw new Error('脚本未正确加载：' + boot);

    // ---- 图源自检：6 个场景都得画出「有内容的画」----
    // 拼图的画面全靠程序化绘制，某个场景写错（比如全画成背景色）在截图里很难一眼看出，
    // 这里用「采样点的颜色种类数」量化：只有 1~2 种颜色 = 画成了一块纯色矩形。
    console.log('\n  【图源自检】');
    const sceneColors = await evalJs(
      "(function(){var out={};Art.SCENE_IDS.forEach(function(id){" +
      "var c=document.createElement('canvas');c.width=240;c.height=240;" +
      "var x=c.getContext('2d');Art.paintScene(x,id,240);" +
      "var seen={},n=0;" +
      "for(var i=0;i<10;i++){for(var j=0;j<10;j++){" +
      "var d=x.getImageData(Math.round((i+0.5)*24),Math.round((j+0.5)*24),1,1).data;" +
      "var k=d[0]+','+d[1]+','+d[2];if(!seen[k]){seen[k]=1;n++;}}}" +
      "out[id]=n;});return out;})()");
    Object.keys(sceneColors).forEach(id => {
      ok(sceneColors[id] >= 8,
        '场景「' + id + '」应画出有内容的画（采样 100 点得到 ' + sceneColors[id] + ' 种颜色）');
    });

    for (const c of CASES) {
      console.log('\n  【' + c.name + '】');

      await client.send('Emulation.setDeviceMetricsOverride', {
        width: c.w, height: c.h, deviceScaleFactor: 1, mobile: false
      });
      await client.send('Page.navigate', { url: PAGE });
      await sleep(800);

      await evalJs('document.getElementById("btnStart").click()');
      await sleep(400);
      await evalJs('TVInput.trigger("confirm")');      // 跳过看图
      await sleep(300);

      const L = await evalJs('window.__puzzle.layout()');
      ok(!!L && L.size > 0, '应能取到布局（棋盘边长 ' + (L ? L.size : '?') + 'px）');

      ok(L.bx >= 0 && L.by >= 0, '棋盘左上角应在视口内（' + L.bx + ',' + L.by + '）');
      ok(L.bx + L.size <= L.vw + 0.5 && L.by + L.size <= L.vh + 0.5,
        '棋盘右下角应在视口内（' + (L.bx + L.size).toFixed(0) + ',' + (L.by + L.size).toFixed(0) +
        ' / ' + L.vw + '×' + L.vh + '）');
      ok(L.rx >= L.bx + L.size - 0.5,
        '目标缩略图不应与棋盘重叠（棋盘右边 ' + (L.bx + L.size).toFixed(0) +
        ' ≤ 缩略图左边 ' + L.rx + '）');
      ok(L.rx + L.rsize <= L.vw + 0.5,
        '目标缩略图应在视口内（右边 ' + (L.rx + L.rsize).toFixed(0) + ' ≤ ' + L.vw + '）');
      ok(L.rsize >= 60, '目标缩略图不应太小（' + L.rsize + 'px，10-foot 下要看得清图案）');
      ok(L.tile >= 44, '单块尺寸应 ≥44px（实测 ' + L.tile.toFixed(1) + 'px）');
      ok(L.hintY <= L.vh, '底部提示行应在视口内（' + L.hintY.toFixed(0) + ' ≤ ' + L.vh + '）');

      const colors = await evalJs(SAMPLE_BOARD);
      ok(colors >= 6,
        '棋盘区域应画出有内容的画（采样 64 点得到 ' + colors + ' 种颜色，' +
        '若切片失败会退化成 1~2 种）');
    }

    console.log('\n' + (fail === 0 ? '✅ LAYOUT OK' : '❌ LAYOUT FAILED') +
      '  ' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    if (client) client.close();
    chrome.kill();
  }
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });

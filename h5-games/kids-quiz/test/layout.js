/*
 * test/layout.js —— 排版几何校验（CDP）。
 *
 * 为什么需要它：#toast（答题反馈气泡）曾经放在 #hud 里走文档流，把 canvas 上
 * 绘制的题干文字顶下去；移出 #hud 改成绝对定位后，又可能反过来压住下排选项。
 * 这类「两个坐标系打架」的问题，冒烟测试（纯 Node + DOM stub）测不到，
 * 截图又要靠肉眼，所以这里做一次性量化断言：
 *
 *   1. 用 getBoundingClientRect 拿到 #toast 的 DOM 矩形；
 *   2. 用 getImageData 扫描 canvas，按 #FFFCF2（选项卡填充色）找出卡片的包围盒；
 *      —— 不依赖 game.js 内部的 layout 变量，像素是最终真相；
 *   3. 断言两者不相交，且卡片高度满足 10-foot UI 的 ≥44px 可聚焦标准。
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
const PAGE = 'http://127.0.0.1:8010/h5-games/kids-quiz/index.html';

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

// 在页面里扫描 canvas：#FFFCF2 是选项卡填充色（drawOption 里的 ctx.fillStyle）
const SCAN_CARDS = `(function(){
  var c = document.getElementById('game');
  var ctx = c.getContext('2d');
  var W = c.width, H = c.height;
  var d = ctx.getImageData(0, 0, W, H).data;
  var minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
  for (var y = 0; y < H; y += 2) {
    for (var x = 0; x < W; x += 2) {
      var i = (y * W + x) * 4;
      if (d[i] > 240 && d[i+1] > 235 && d[i+2] > 220) {
        n++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxY < 0) return null;
  var s = W / window.innerWidth;          // canvas 设备像素 / CSS 像素
  return {
    left: minX / s, top: minY / s,
    right: maxX / s, bottom: maxY / s,
    w: (maxX - minX) / s, h: (maxY - minY) / s,
    px: n
  };
})()`;

(async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'kq-chrome-layout'),
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
    const boot = await evalJs('!!window.Art + "/" + !!window.Quiz + "/" + !!window.TVInput');
    if (boot !== 'true/true/true') throw new Error('脚本未正确加载：' + boot);

    for (const c of CASES) {
      console.log('\n  【' + c.name + '】');

      await client.send('Emulation.setDeviceMetricsOverride', {
        width: c.w, height: c.h, deviceScaleFactor: 1, mobile: false
      });
      await client.send('Page.navigate', { url: PAGE });
      await sleep(800);

      // 装题目窃听器（同 shot.js），才能按「真答案」触发一次判定反馈
      await evalJs(
        'window.__force=null;var g=Quiz.generate;' +
        'Quiz.generate=function(lv,lt){' +
        'var q=window.__force?Quiz._gen[window.__force](lv):g(lv,lt);' +
        'window.__lastQ=q;return q;};');
      await evalJs('document.getElementById("btnStart").click()');
      await sleep(500);

      const ans = await evalJs('window.__lastQ.answer');
      // 走到正确答案那一格（2×2：0 1 / 2 3）
      if (ans === 1 || ans === 3) { await evalJs('TVInput.trigger("dir","right")'); await sleep(200); }
      if (ans === 2 || ans === 3) { await evalJs('TVInput.trigger("dir","down")'); await sleep(200); }
      await evalJs('TVInput.trigger("confirm")');
      await sleep(320);                       // 判定反馈期间 #toast 可见

      // 注意：#toast 只显示 1s（game.js 里的 toastTimer），这几步要一气呵成
      const toast = await evalJs("(function(){" +
        "var t=document.getElementById('toast');var r=t.getBoundingClientRect();" +
        "return {hidden:t.className.indexOf('hidden')>=0,top:r.top,bottom:r.bottom," +
        "left:r.left,right:r.right,h:r.height,text:t.textContent};})()");
      const cards = await evalJs(SCAN_CARDS);
      const vw = await evalJs('window.innerWidth');
      const vh = await evalJs('window.innerHeight');

      ok(!toast.hidden && toast.h > 0,
        '#toast 答题后应可见（"' + toast.text + '"，高 ' + Math.round(toast.h) + 'px）');
      ok(cards && cards.px > 0, 'canvas 上应能扫到选项卡片（白色像素 ' + (cards ? cards.px : 0) + ' 个）');
      if (!cards) continue;

      ok(cards.bottom <= toast.top + 0.5,
        '下排选项底边（' + cards.bottom.toFixed(1) + '）不应压到气泡顶边（' +
        toast.top.toFixed(1) + '）');
      ok(toast.bottom <= vh + 0.5,
        '气泡应在视口内（底边 ' + toast.bottom.toFixed(1) + ' ≤ ' + vh + '）');
      ok(cards.h / 2 >= 44,
        '单张卡片高度应 ≥44px（实测 ' + (cards.h / 2).toFixed(1) + 'px，选项区总高 ' +
        cards.h.toFixed(1) + '）');
      ok(cards.top >= 0 && cards.left >= 0 && cards.right <= vw + 0.5,
        '选项区应完整落在视口内（' + cards.left.toFixed(0) + '..' + cards.right.toFixed(0) +
        ' / 宽 ' + vw + '）');
    }

    console.log('\n' + (fail === 0 ? '✅ LAYOUT OK' : '❌ LAYOUT FAILED') +
      '  ' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    if (client) client.close();
    chrome.kill();
  }
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });

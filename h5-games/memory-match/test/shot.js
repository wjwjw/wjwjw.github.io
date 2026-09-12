/*
 * test/shot.js —— 用 Chrome DevTools 协议给 memory-match 截图（视觉验证）
 *
 * 为什么不直接用 `chrome --headless --screenshot --virtual-time-budget`：
 * 实测（Chrome 14x / headless=new）虚拟时间只会推进 setTimeout 与 Date.now()，
 * **requestAnimationFrame 完全不触发**（frames=0）。而这个游戏的主循环、翻牌动画、
 * 预览倒计时全都挂在 rAF + Date.now() 上 —— 结果就是「牌永远摊在正面、动画停在第一帧」。
 * 所以改成：真实时钟 + CDP 驱动（Runtime.evaluate 模拟按键，Page.captureScreenshot 截图）。
 *
 * 用法：先起静态服务器（仓库根目录 python -m http.server 8010），然后
 *   node test/shot.js <输出目录>
 * 会产出 start / peek / play / flip 四张 PNG。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const PAGE = 'http://127.0.0.1:8010/h5-games/memory-match/index.html';
const OUT = process.argv[2] || path.join(__dirname, '..', '_shots');

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  fs.mkdirSync(OUT, { recursive: true });

  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,820',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'mm-chrome-cdp'),
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
    const shot = async name => {
      const r = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('  ✓ ' + name + '.png  (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
    };

    await client.send('Page.navigate', { url: PAGE });
    await sleep(900);                       // 等页面脚本 + 首帧

    const boot = await evalJs(
      '!!window.Faces + "/" + !!window.TVInput + "/" + document.querySelectorAll("canvas").length');
    console.log('  boot: Faces/TVInput/canvas = ' + boot);

    // ① 开始界面
    await shot('shot-1-start');

    // ② 预览阶段（牌全亮，带倒计时条）
    await evalJs('document.getElementById("btnStart").click()');
    await sleep(700);
    await shot('shot-2-peek');

    // ③ 正式玩法（牌全扣 + 高亮框）
    await evalJs('TVInput.trigger("confirm")');   // 跳过预览
    await sleep(1200);
    await shot('shot-3-play');

    // ④ 翻两张牌（走两步再翻，让两张都朝上）
    await evalJs('TVInput.trigger("dir","right")');
    await sleep(250);
    await evalJs('TVInput.trigger("confirm")');
    await sleep(500);
    await evalJs('TVInput.trigger("dir","down")');
    await sleep(250);
    await evalJs('TVInput.trigger("confirm")');
    await sleep(600);
    await shot('shot-4-flip');

    // 顺带把「当前正面朝上的牌」数量读出来做断言
    const info = await evalJs(
      '(function(){var s=document.getElementById("scoreText").textContent;' +
      'var p=document.getElementById("pairText").textContent;' +
      'var m=document.getElementById("moveText").textContent;' +
      'return "分数="+s+" 配对="+p+" 步数="+m;})()');
    console.log('  ' + info);
  } finally {
    if (client) client.close();
    chrome.kill();
  }
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });

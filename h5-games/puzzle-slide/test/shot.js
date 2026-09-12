/*
 * test/shot.js —— 用 Chrome DevTools 协议给 puzzle-slide 截图（视觉验证）
 *
 * 为什么不用 `chrome --headless --screenshot --virtual-time-budget`：
 * 实测（Chrome 14x / headless=new）虚拟时间只推进 setTimeout 与 Date.now()，
 * **requestAnimationFrame 完全不触发**（frames=0）。而这个游戏的绘制主循环、
 * 滑块动画、倒计时条全都挂在 rAF 上 —— 结果就是画面停在第一帧。
 * 所以改成真实时钟 + CDP 驱动。与 kids-quiz/test/shot.js 是同一套脚手架。
 *
 * 怎么驱动到指定画面：game.js 暴露了 window.__puzzle（state/board/moves/
 * slide/skipPeek/solve），可以精确走到「看图 / 拼了一会 / 拼好」这几个状态。
 *
 * 用法：先起静态服务器（仓库根目录 python -m http.server 8010），然后
 *   node test/shot.js [输出目录]
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const PAGE = 'http://127.0.0.1:8010/h5-games/puzzle-slide/index.html';
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
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'ps-chrome-cdp'),
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
    const press = async (type, payload) => {
      const arg = payload ? '"' + type + '","' + payload + '"' : '"' + type + '"';
      await evalJs('TVInput.trigger(' + arg + ')');
    };

    await client.send('Page.navigate', { url: PAGE });
    await sleep(900);

    const boot = await evalJs(
      '!!window.Art + "/" + !!window.Puzzle + "/" + !!window.TVInput');
    console.log('  boot: Art/Puzzle/TVInput = ' + boot);
    if (boot !== 'true/true/true') throw new Error('脚本未正确加载：' + boot);

    // ① 开始界面
    await shot('shot-1-start');

    // ② 看图状态（整张原图盖在棋盘上 + 倒计时条）
    await evalJs('document.getElementById("btnStart").click()');
    await sleep(600);
    const st = await evalJs('window.__puzzle.state');
    console.log('  开局状态：' + st);
    await shot('shot-2-peek');

    // ③ 拼图中（滑几步，出现黄边可动提示 + 绿边归位提示）
    await press('confirm');            // 跳过看图
    await sleep(300);
    const dirs = ['right', 'down', 'left', 'up', 'right', 'down'];
    for (const d of dirs) { await press('dir', d); await sleep(200); }
    const after = await evalJs(
      '({state: __puzzle.state, moves: __puzzle.moves, board: __puzzle.board.join(",")})');
    console.log('  拼图 ' + after.moves + ' 步：' + after.board);
    await shot('shot-3-play');

    // ④ 马上要拼好（只差一步，能同时看到绿边归位与黄边可动）
    await evalJs(
      '(function(){var b=Puzzle.solvedBoard(__puzzle.n);Puzzle.move(b,__puzzle.n,"right");' +
      '__puzzle.setBoard(b);return b.join(",");})()');
    await sleep(300);
    await shot('shot-4-almost');

    // ⑤ 过关
    await press('dir', 'left');
    await sleep(700);
    const cleared = await evalJs('window.__puzzle.state');
    console.log('  拼好后状态：' + cleared);
    await shot('shot-5-clear');
  } finally {
    if (client) client.close();
    chrome.kill();
  }
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });

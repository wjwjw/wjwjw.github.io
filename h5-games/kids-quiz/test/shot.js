/*
 * test/shot.js —— 用 Chrome DevTools 协议给 kids-quiz 截图（视觉验证）
 *
 * 为什么不用 `chrome --headless --screenshot --virtual-time-budget`：
 * 实测（Chrome 14x / headless=new）虚拟时间只推进 setTimeout 与 Date.now()，
 * **requestAnimationFrame 完全不触发**（frames=0）。而这个游戏的绘制主循环、
 * 答题反馈动画、光标呼吸全都挂在 rAF 上 —— 结果就是画面停在第一帧。
 * 所以改成真实时钟 + CDP 驱动。与 memory-match/test/shot.js 是同一套脚手架。
 *
 * 怎么拿到正确答案：包一层 `Quiz.generate`，生成时把题目记到 window.__lastQ，
 * 就能反过来驱动遥控按键「真的选对 / 真的选错」，截到判定反馈那一帧。
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
const PAGE = 'http://127.0.0.1:8010/h5-games/kids-quiz/index.html';
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
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'kq-chrome-cdp'),
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
      '!!window.Art + "/" + !!window.Quiz + "/" + !!window.TVInput');
    console.log('  boot: Art/Quiz/TVInput = ' + boot);
    if (boot !== 'true/true/true') throw new Error('脚本未正确加载：' + boot);

    // ① 开始界面
    await shot('shot-1-start');

    // 装上「题目窃听器」，才能反推正确答案。
    // 注意：窃听器必须常驻，后面强制题型时只改 __force 开关，
    // 不能直接覆盖 Quiz.generate —— 那样会把窃听器本身顶掉，__lastQ 就再也不更新了。
    await evalJs(
      'window.__qs=[];window.__force=null;' +
      'var g=Quiz.generate;' +
      'Quiz.generate=function(lv,lt){' +
      'var q=window.__force?Quiz._gen[window.__force](lv):g(lv,lt);' +
      'window.__qs.push(q);window.__lastQ=q;return q;};');
    await evalJs('document.getElementById("btnStart").click()');
    await sleep(500);

    // ② 出题（题干图 + 四个选项 + 左上角高亮框）
    const q1 = await evalJs('({type: __lastQ.type, label: __lastQ.label, answer: __lastQ.answer})');
    console.log('  第 1 题：' + q1.type + '「' + q1.label + '」答案=' + q1.answer);
    await shot('shot-2-ask');

    // ③ 答对（绿勾）
    if (q1.answer === 1 || q1.answer === 3) { await press('dir', 'right'); await sleep(220); }
    if (q1.answer === 2 || q1.answer === 3) { await press('dir', 'down'); await sleep(220); }
    await press('confirm');
    await sleep(420);
    await shot('shot-3-right');

    // ④ 答错（红叉 + 把正确答案圈出来）
    await sleep(1000);                           // 让上一题翻页
    const q2 = await evalJs('({type: __lastQ.type, label: __lastQ.label, answer: __lastQ.answer})');
    console.log('  下一题：' + q2.type + '「' + q2.label + '」答案=' + q2.answer);
    const wrong = q2.answer === 0 ? 3 : 0;
    if (wrong === 1 || wrong === 3) { await press('dir', 'right'); await sleep(220); }
    if (wrong === 2 || wrong === 3) { await press('dir', 'down'); await sleep(220); }
    await press('confirm');
    await sleep(500);
    await shot('shot-4-wrong');

    // ⑤ 数一数（强制题型，验证「一堆积木」的排版）
    await sleep(1200);                           // 等答错那题翻页
    await evalJs('window.__force="count";');
    await press('confirm');                      // 顺手答掉当前题 → 下一题被强制成 count
    await sleep(1600);
    const qc = await evalJs(
      '({type: __lastQ.type, label: __lastQ.label, n: __lastQ.prompt && __lastQ.prompt.n})');
    console.log('  数一数：' + qc.type + '「' + qc.label + '」数量=' + qc.n);
    await shot('shot-5-count');
  } finally {
    if (client) client.close();
    chrome.kill();
  }
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });

/*
 * test/shot.js —— 贪吃蛇冒烟测试 + 截图（Chrome DevTools 协议，按步驱动）
 *
 * URL 带 #debug：游戏把内部状态 / step() / setDir / forceApple 挂到 window.__snake，
 * 测试直接调一步、校验蛇头位置和 HUD，绕过 headless 下不稳定的 rAF 节奏。
 * 截图前手动 __snake.render() + 把 stepAcc 拨到半格，画出「走到一半」的画面。
 *
 * 用法：先在仓库根目录起静态服务器（python -m http.server 8010），然后
 *   node test/shot.js [输出目录]
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const PAGE = 'http://127.0.0.1:8010/h5-games/snake/index.html#debug';
const OUT = process.argv[2] || path.join(__dirname, '..', '_shots');

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

// 把 stepAcc 拨到半格并强制 render，截图前保证画面在「中间帧」
async function commit(evalJs) {
  await evalJs('__snake.setAcc(__snake.stepMs * 0.5); __snake.render()');
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
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'snake-chrome-cdp'),
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
      console.log('  · ' + name + '.png (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
    };
    const hud = async () => evalJs(
      '({score:document.getElementById("scoreText").textContent,' +
      'len:document.getElementById("lenText").textContent,' +
      'lives:document.getElementById("livesText").textContent,' +
      'level:document.getElementById("levelText").textContent,' +
      'hudHidden:document.getElementById("hud").className.indexOf("hidden")>=0,' +
      'pauseHidden:document.getElementById("pauseScreen").className.indexOf("hidden")>=0,' +
      'overHidden:document.getElementById("overScreen").className.indexOf("hidden")>=0})');
    const head = async () => evalJs(
      '({x:__snake.snake[0].x, y:__snake.snake[0].y})');

    await client.send('Page.navigate', { url: PAGE });
    await sleep(700);

    const boot = await evalJs(
      '!!window.TVInput + "/" + !!window.AudioManager + "/" + !!window.TVNav + "/" + ' +
      '!!window.__snake + "/" + document.querySelectorAll("canvas").length');
    console.log('  boot: TVInput/AudioManager/TVNav/__snake/canvas = ' + boot);
    check('脚本加载（含 #debug 钩子）', boot === 'true/true/true/true/1', boot);

    // ① 开始界面
    await shot('shot-1-start');
    let h = await hud();
    check('开始界面 HUD 隐藏', h.hudHidden === true);

    // ② 开局 → 进入 READY（倒计时）
    await evalJs('document.getElementById("btnStart").click()');
    h = await hud();
    check('点击开始后 HUD 显示、长度 3', h.hudHidden === false && h.len === '3', JSON.stringify(h));
    await commit(evalJs);
    await shot('shot-2-ready');
    const st = await evalJs('__snake.state');
    check('开始后进入 READY 倒计时', st === 'ready', st);

    // 跳过倒计时进入 PLAY，并冻结自动步进 —— 否则真实循环会继续自动走，
    // 测试里按步算好的坐标会被它抢先一步（headless 下 rAF 慢但确实在跑）
    await evalJs('__snake.startNow(); __snake.freeze(true)');
    check('startNow 后状态为 PLAY', (await evalJs('__snake.state')) === 'play');

    // ③ 初始位置截图
    await commit(evalJs);
    await shot('shot-3-play');

    // ④ 吃第一个苹果：把苹果钉在蛇头正上方
    await evalJs('__snake.forceApple(__snake.snake[0].x, __snake.snake[0].y - 1)');
    await evalJs('__snake.setDir(0, -1)');
    await evalJs('__snake.step()');
    let hh = await head();
    h = await hud();
    check('吃第一个苹果：分数 10、长度 4', hh.x === 5 && hh.y === 5 && Number(h.score) === 10 && h.len === '4',
      JSON.stringify({ head: hh, hud: h }));
    check('苹果自动重生', (await evalJs('!!__snake.apple')) === true);
    await commit(evalJs);
    await shot('shot-4-eat');

    // ⑤ 再吃一个
    await evalJs('__snake.forceApple(__snake.snake[0].x, __snake.snake[0].y - 1)');
    await evalJs('__snake.setDir(0, -1)');
    await evalJs('__snake.step()');
    h = await hud();
    check('再吃一个：长度 5、分数 ≥ 20（手速奖励 +15 会叠加到 25）',
      h.len === '5' && Number(h.score) >= 20, JSON.stringify(h));

    // ⑥ 撞自己：当前 dir=up，头 (5,4)。改 down → 目标 (5,5)，身体里有 (5,5) → 自咬
    await evalJs('__snake.setDir(0, 1)');
    await evalJs('__snake.step()');
    h = await hud();
    check('撞到自己：生命 3→2、身体缩短到 3', h.lives === '♥♥♡' && h.len === '3', JSON.stringify(h));
    await commit(evalJs);
    await shot('shot-5-hurt');

    // ⑦ 暂停 / 继续
    await evalJs('TVInput.trigger("back")');
    h = await hud();
    check('返回键进入暂停', h.pauseHidden === false, JSON.stringify(h));
    await commit(evalJs);
    await shot('shot-6-pause');
    await evalJs('document.getElementById("btnResume").click()');
    await sleep(150);
    h = await hud();
    check('继续后暂停层消失', h.pauseHidden === true, JSON.stringify(h));

    // ⑧ 渲染健壮性：一路吃成一条长蛇。
    // 注意不能「一直往右吃」：吃得比走得快时蛇尾是不动的，蛇绕一圈回来会咬到自己
    // （这是正确的游戏行为），长度就会被截断。所以到边界就拐弯向下走蛇形。
    await evalJs('__snake.startNow(); __snake.freeze(true)');
    for (var i = 0; i < 16; i++) {
      await evalJs(
        '(function(){var s=__snake,h=s.snake[0];' +
        'if(h.x+1>19){s.setDir(0,1);s.forceApple(h.x,h.y+1);}else{s.setDir(1,0);s.forceApple(h.x+1,h.y);}' +
        's.step();})()');
    }
    h = await hud();
    check('连吃 16 次不崩、长度持续增长', Number(h.len) >= 18, 'len=' + h.len);
    await commit(evalJs);
    await shot('shot-7-long');

    // ⑨ 像素探针：把 stepAcc 拨到满格（t=1，元素正好落在格子中心）后强制渲染，
    //    再直接读 canvas 像素，用客观颜色验证「蛇头是绿的 / 苹果是红的 / 草地是暗的」
    await evalJs('__snake.clearFx(); __snake.setAcc(__snake.stepMs); __snake.render()');
    const probe = await evalJs(
      '(function(){' +
      'var c=document.getElementById("game"), g=c.getContext("2d");' +
      'var s=c.width/parseFloat(c.style.width);' +
      'var L=__snake.layout;' +
      'function px(x,y){var d=g.getImageData(Math.round(x*s),Math.round(y*s),1,1).data;' +
      'return [d[0],d[1],d[2]];}' +
      'function cc(x,y){return [L.x0+x*L.tile+L.tile/2, L.y0+y*L.tile+L.tile/2];}' +
      'var h=__snake.snake[0], hp=cc(h.x,h.y);' +
      'var ap=__snake.apple?cc(__snake.apple.x,__snake.apple.y):null;' +
      'var occ={};for(var i=0;i<__snake.snake.length;i++)' +
      'occ[__snake.snake[i].x+","+__snake.snake[i].y]=1;' +
      'if(__snake.apple)occ[__snake.apple.x+","+__snake.apple.y]=1;' +
      'var empty=null;' +
      'for(var y=0;y<13&&!empty;y++)for(var x=0;x<20&&!empty;x++)' +
      'if(!occ[x+","+y])empty=[x,y];' +
      'var ep=empty?cc(empty[0],empty[1]):null;' +
      'return {head:px(hp[0],hp[1]), apple:ap?px(ap[0],ap[1]):null,' +
      'grass:ep?px(ep[0],ep[1]):null};})()');
    console.log('  · pixel probe: ' + JSON.stringify(probe));
    check('蛇头像素是亮绿（g 明显大于 r、b）',
      probe.head[1] > 140 && probe.head[1] > probe.head[0] + 40 && probe.head[1] > probe.head[2] + 20,
      'rgb(' + probe.head.join(',') + ')');
    check('苹果像素是红色（r 明显大于 g、b）',
      !!probe.apple && probe.apple[0] > 150 && probe.apple[0] > probe.apple[1] + 60,
      probe.apple ? 'rgb(' + probe.apple.join(',') + ')' : 'null');
    check('空草地像素是暗绿（整体偏暗且 g 最大）',
      !!probe.grass && probe.grass[1] < 110 && probe.grass[1] >= probe.grass[0] && probe.grass[1] >= probe.grass[2],
      probe.grass ? 'rgb(' + probe.grass.join(',') + ')' : 'null');

    console.log(failures ? '\n  FAILED: ' + failures + ' 项未通过' : '\n  全部通过');
  } finally {
    if (client) client.close();
    chrome.kill();
  }
  if (failures) process.exit(1);
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
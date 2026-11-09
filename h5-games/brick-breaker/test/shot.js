/*
 * test/shot.js —— 弹球打砖块真实浏览器验收（Chrome DevTools 协议）
 *
 * 与纯 Node 的 smoke.js 互补：这里验证「真 Chrome 里脚本能加载、遥控器键盘事件能
 * 驱动挡板、像素真的画出来了、覆盖层不会被动画卡住、多视口布局不越界、
 * HUD toast 与 canvas 砖区不交叠」。
 * URL 带 #debug 时游戏把内部状态挂到 window.__brick，测试用 __brick.freeze(true)
 * 冻住自动物理推进后手动 stepBall，绕开 headless 下 rAF 时钟失真的老问题。
 *
 * 用法：先在仓库根目录起静态服务器（python -m http.server 8010），然后
 *   node test/shot.js [输出目录]
 * 环境变量：BB_HTTP_PORT（默认 8010）、BB_CDP_PORT（默认 9223，避开其它游戏的 9222）、
 *           CHROME_PATH。
 * 默认截图写到系统临时目录，不污染仓库；传参可改。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const HTTP_PORT = Number(process.env.BB_HTTP_PORT || 8010);
const PORT = Number(process.env.BB_CDP_PORT || 9223);
const PAGE = 'http://127.0.0.1:' + HTTP_PORT + '/h5-games/brick-breaker/index.html#debug';
const OUT = process.argv[2] || path.join(os.tmpdir(), 'brick-breaker-shots');

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
  throw new Error('Chrome 调试端口 ' + PORT + ' 未就绪（静态服务器是否已起？）');
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
    '--user-data-dir=' + path.join(os.tmpdir(), 'brick-breaker-chrome-cdp-' + PORT),
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
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error((d.exception && d.exception.description) || d.text);
      }
      return r.result && r.result.value;
    };
    const shot = async name => {
      const r = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('  · ' + name + '.png (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
    };
    const key = (type, k, code) => client.send('Input.dispatchKeyEvent', {
      type: type, key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code
    });
    const ui = () => evalJs(
      '({start:document.getElementById("startScreen").className,' +
      'pause:document.getElementById("pauseScreen").className,' +
      'clear:document.getElementById("clearScreen").className,' +
      'over:document.getElementById("overScreen").className,' +
      'hud:document.getElementById("hud").className,' +
      'score:document.getElementById("scoreText").textContent,' +
      'lives:document.getElementById("livesText").textContent,' +
      'left:document.getElementById("leftText").textContent})');
    const hidden = cls => cls.indexOf('hidden') >= 0;

    await client.send('Page.navigate', { url: PAGE });
    await sleep(900);

    const boot = await evalJs(
      '!!window.TVInput + "/" + !!window.AudioManager + "/" + !!window.TVNav + "/" + ' +
      '!!window.FX + "/" + !!window.BrickLogic + "/" + !!window.__brick + "/" + ' +
      'document.querySelectorAll("canvas").length');
    console.log('  boot: TVInput/AudioManager/TVNav/FX/BrickLogic/__brick/canvas = ' + boot);
    check('脚本全部加载（含 #debug 钩子）', boot === 'true/true/true/true/true/true/1', boot);

    // ① 标题页
    await shot('shot-1-start');
    let u = await ui();
    check('标题页 HUD 隐藏', hidden(u.hud));

    // ② 开局 → 3-2-1 预备
    await evalJs('document.getElementById("btnStart").click()');
    check('点击开始进入 READY', (await evalJs('__brick.state')) === 'ready');
    u = await ui();
    check('开局后 HUD 显示', !hidden(u.hud));
    await evalJs('__brick.render()');
    await shot('shot-2-ready');

    // ③ OK 发球 + 真实键盘「按住」驱动挡板
    await evalJs('TVInput.trigger("confirm"); __brick.freeze(true)');
    check('OK 立即发球进入 PLAY', (await evalJs('__brick.state')) === 'play');

    const x0 = await evalJs('__brick.paddle.x');
    await key('keyDown', 'ArrowRight', 39);
    const heldOn = await evalJs('__brick.held.right');
    const x1 = await evalJs('(function(){for(var i=0;i<10;i++)__brick.movePaddle(0.016);return __brick.paddle.x;})()');
    check('真实 keydown 应置位 held.right', heldOn === true);
    check('按住右键时挡板连续右移', x1 > x0, x0.toFixed(1) + ' → ' + x1.toFixed(1));
    await key('keyUp', 'ArrowRight', 39);
    check('keyup 应清掉 held（松手不滑行）', (await evalJs('__brick.held.right')) === false);

    // ④ 打碎一块砖：把球放进砖内手动走一子步
    const hit = await evalJs(
      '(function(){var g=__brick,L=g.layout,b=null,i;' +
      'for(i=0;i<g.bricks.length;i++){if(g.bricks[i].alive&&!g.bricks[i].star){b=g.bricks[i];break;}}' +
      'if(!b)return null;' +
      'var rx=L.x0+L.gap+b.c*(L.bw+L.gap),ry=L.brickTop+b.r*(L.bh+L.gap);' +
      'var before={score:g.score,left:g.bricksLeft};' +
      'g.setBall(rx+L.bw/2,ry+L.bh/2,0.4,-1);' +
      'g.stepBall(0.001,250);' +
      'return {before:before,score:g.score,left:g.bricksLeft};})()');
    check('球碰砖后砖块数 -1', !!hit && hit.left === hit.before.left - 1,
      hit ? JSON.stringify(hit) : 'null');
    check('打碎砖块加分', !!hit && hit.score > hit.before.score,
      hit ? hit.before.score + ' → ' + hit.score : 'null');

    // ⑤ 像素探针：先清掉会染色的粒子，再强制渲染一帧
    await evalJs('__brick.clearFx(); __brick.render()');
    await shot('shot-3-play');
    const probe = await evalJs(
      '(function(){var c=document.getElementById("game"),g=c.getContext("2d");' +
      'var s=c.width/parseFloat(c.style.width),B=__brick,L=B.layout;' +
      'function px(x,y){var d=g.getImageData(Math.round(x*s),Math.round(y*s),1,1).data;' +
      'return [d[0],d[1],d[2]];}' +
      'return {paddle:px(B.paddle.x,L.paddleY+B.paddle.h/2-4),' +
      'ball:px(B.ball.x,B.ball.y),' +
      'field:px(L.x0+L.w*0.5,L.y0+L.h*0.72)};})()');
    console.log('  · pixel probe: ' + JSON.stringify(probe));
    check('挡板像素是金色（r 高、b 低）',
      probe.paddle[0] > 190 && probe.paddle[1] > 120 && probe.paddle[2] < 150,
      'rgb(' + probe.paddle.join(',') + ')');
    check('场地空白像素是深蓝底（整体偏暗）',
      probe.field[0] < 90 && probe.field[2] >= probe.field[0],
      'rgb(' + probe.field.join(',') + ')');

    // ⑥ 掉球掉心
    await evalJs(
      '(function(){var g=__brick,L=g.layout;' +
      'g.setBall(L.x0+60,L.y0+L.h+50,0,1);g.stepBall(0.001,250);})()');
    u = await ui();
    check('掉球只掉一颗心', u.lives === '♥♥♡', u.lives);
    check('掉球后回到发球预备', (await evalJs('__brick.state')) === 'ready');

    // ⑦ 暂停 / 继续
    await evalJs('__brick.launch(); TVInput.trigger("back")');
    check('返回键进入暂停', (await evalJs('__brick.state')) === 'pause');
    await shot('shot-4-pause');
    await evalJs('document.getElementById("btnResume").click()');
    check('继续后回到可玩', (await evalJs('__brick.state')) === 'play');

    // ⑧ 过关：结算文本同步写、覆盖层延后弹（真实 setTimeout）
    await evalJs('__brick.forceClear()');
    check('清空砖块进入庆祝态', (await evalJs('__brick.state')) === 'clear');
    check('结算标题在庆祝当帧就写好了',
      (await evalJs('document.getElementById("clearTitle").textContent')) === '第 1 关完成');
    await sleep(1500);
    u = await ui();
    check('庆祝结束后结算卡显示', !hidden(u.clear), u.clear);
    check('结算卡分数与实得分数一致',
      (await evalJs('Number(document.getElementById("clearScore").textContent)')) ===
      (await evalJs('__brick.score')));
    await shot('shot-5-clear');

    // ⑨ 多视口布局量化验收
    const viewports = [[1280, 720], [960, 540], [640, 420]];
    for (const wh of viewports) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: wh[0], height: wh[1], deviceScaleFactor: 1, mobile: false
      });
      await sleep(180);
      const m = await evalJs(
        '(function(){var c=document.getElementById("game"),B=__brick,L=B.layout;' +
        'var r=document.getElementById("btnNext").getBoundingClientRect();' +
        'return {cssW:parseFloat(c.style.width),cssH:parseFloat(c.style.height),' +
        'bufW:c.width,bufH:c.height,w:L.w,h:L.h,' +
        'px:B.paddle.x,x0:L.x0,right:L.x0+L.w,' +
        'btnW:r.width,btnH:r.height,btnRight:r.right,vw:window.innerWidth};})()');
      check(wh[0] + '×' + wh[1] + ' 画布随窗口自适应',
        Math.abs(m.cssW - wh[0]) < 2 && Math.abs(m.cssH - wh[1]) < 2 && m.bufW > 0,
        JSON.stringify({ cssW: m.cssW, cssH: m.cssH }));
      check(wh[0] + '×' + wh[1] + ' 挡板仍在场地内',
        m.px >= m.x0 && m.px <= m.right,
        'paddle=' + m.px.toFixed(1) + ' field=' + m.x0 + '..' + m.right.toFixed(1));
      check(wh[0] + '×' + wh[1] + ' 可聚焦按钮 ≥44px 且不越界',
        m.btnH >= 44 && m.btnW >= 44 && m.btnRight <= m.vw + 1,
        JSON.stringify({ btnW: m.btnW, btnH: m.btnH, btnRight: m.btnRight, vw: m.vw }));
      // HUD toast（唯一会往下伸的 DOM 元素）不得遮住 canvas 第一行砖
      // （STANDARD §6 末尾：DOM 覆盖层与 canvas 两边都要显式留位）
      await evalJs('__brick.toast("验收探针", "warn")');
      const t = await evalJs(
        '(function(){var r=document.getElementById("toast").getBoundingClientRect();' +
        'return {bottom:r.bottom,brickTop:__brick.layout.brickTop};})()');
      check(wh[0] + '×' + wh[1] + ' 掉球 toast 不遮挡第一行砖',
        t.bottom <= t.brickTop + 0.5, JSON.stringify(t));
    }
    await client.send('Emulation.clearDeviceMetricsOverride');

    console.log(failures ? '\n  FAILED: ' + failures + ' 项未通过' : '\n  全部通过');
  } finally {
    if (client) client.close();
    chrome.kill();
  }
  if (failures) process.exit(1);
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });

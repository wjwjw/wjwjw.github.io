/* 无头逻辑测试（开发用，验证引擎不崩、机制正确、关卡可解）。非游戏运行代码。 */
global.window = global;
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

global.LEVELS = require("./js/levels.js");
require("./js/audio.js");
require("./js/engine.js");

function makeCtx() {
  const noop = () => {};
  return {
    clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop,
    moveTo: noop, lineTo: noop, closePath: noop, fill: noop, arc: noop,
    ellipse: noop, arcTo: noop, fillText: noop, setTransform: noop, save: noop,
    restore: noop, translate: noop, scale: noop, rotate: noop, quadraticCurveTo: noop,
    stroke: noop, clip: noop, rect: noop,
    clip: noop, rect: noop,
    fillStyle: "", strokeStyle: "", font: "", textAlign: "", textBaseline: "", imageSmoothingEnabled: false,
  };
}
const canvas = { width: 0, height: 0, style: {}, getContext: () => makeCtx(), addEventListener: () => {} };

function newGame(idx) {
  const g = new Game(canvas, new AudioManager(), {
    onHearts: () => {}, onWin: (s) => { g._won = s; }, onLose: () => { g._lost = true; },
  });
  g.load(idx, CHARACTERS[0]);
  g.start();
  return g;
}

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "OK  " : "FAIL ") + name); cond ? pass++ : fail++; }

// 模拟真实输入节奏：每次按键前推进 0.5s（移动冷却时长），避免连按被冷却拦截
const STEP = 0.5;

// 注入自定义机关测试关
function addCustom(gridArr, monsters) {
  LEVELS.push({ name: "TEST", grid: gridArr, monsters: monsters || [] });
  return LEVELS.length - 1;
}

// ---- 地刺：阻挡 + 扣血，不前进 ----
{
  const idx = addCustom(["######", "#@S.E#", "######"]);
  const g = newGame(idx);
  const h0 = g.hearts;
  g.attemptMove("right"); // 目标 (2,1)=S
  check("地刺：不前进", g.px === 1 && g.py === 1);
  check("地刺：扣血 -1", g.hearts === h0 - 1);
  check("地刺：触发受击反馈(hurtFlash/shake)", g.hurtFlash > 0 && g.shakeT > 0);
}

// ---- 连续香蕉：连锁前进 ----
{
  const idx = addCustom(["#######", "#@BBB.#", "#######"]);
  const g = newGame(idx);
  g.attemptMove("right"); // 踩 B 连锁到 (5,1)
  check("香蕉：连续连锁前进到 (5,1)", g.px === 5 && g.py === 1);
  check("香蕉：无伤", g.hearts === 5);
}

// ---- 弹簧：退后 2 格 + 动画 ----
{
  const idx = addCustom(["########", "#@.P...#", "########"]);
  const g = newGame(idx);
  g.attemptMove("right"); // -> (2,1) 普通
  g.update(STEP);         // 冷却结束
  g.attemptMove("right"); // -> (3,1)=P 退后2到 (1,1)
  check("弹簧：退后 2 格回到 (1,1)", g.px === 1 && g.py === 1);
  check("弹簧：播放 boing 动画(springAnim>0)", g.springAnim > 0);
}

// ---- 移动冷却：0.5s 内连按只移动一次，0.5s 后才可再移动 ----
{
  const idx = addCustom(["######", "#@...#", "######"]);
  const g = newGame(idx);
  g.attemptMove("right"); // -> (2,1)
  const first = g.px === 2 && g.py === 1;
  g.attemptMove("right"); // 冷却中，应被拦截，停在 (2,1)
  const blocked = g.px === 2 && g.py === 1;
  g.update(STEP);         // 冷却结束
  g.attemptMove("right"); // -> (3,1)
  const second = g.px === 3 && g.py === 1;
  check("移动冷却：0.5s 内连按只移动一次", first && blocked && second);
}

// ---- L1 通关（BFS 安全路径驱动） ----
function safePath(grid, s, goal) {
  const h = grid.length, w = grid[0].length;
  const blocked = new Set();
  const nb = (x, y) => [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => [x+dx,y+dy]);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    const c=grid[y][x];
    if (c==='S'||c==='B'||c==='P') blocked.add(x+','+y);
    if (c==='F'||c==='I') nb(x,y).forEach(([nx,ny])=> blocked.add(nx+','+ny));
  }
  const q=[[s]], seen=new Set([s[0]+','+s[1]]);
  while(q.length){ const p=q.shift(); if(p[p.length-1][0]===goal[0]&&p[p.length-1][1]===goal[1]) return p;
    const [x,y]=p[p.length-1];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=x+dx,ny=y+dy,k=nx+','+ny;
      if(nx<0||ny<0||nx>=w||ny>=h) continue; if(grid[ny][nx]==='#'||grid[ny][nx]==='F'||grid[ny][nx]==='I') continue;
      if(blocked.has(k)||seen.has(k)) continue; seen.add(k); q.push(p.concat([[nx,ny]])); } }
  return null;
}
{
  const g = newGame(0);
  let ex=-1,ey=-1;
  for(let y=0;y<g.rows;y++)for(let x=0;x<g.cols;x++){ if(g.grid[y][x]==='E'){ex=x;ey=y;} }
  const path = safePath(g.grid, [g.px,g.py], [ex,ey]);
  check("L1 求得安全路径", !!path);
  for (let i=1;i<path.length;i++){ const [px,py]=path[i], [qx,qy]=path[i-1];
    const d = px>qx?'right':px<qx?'left':py>qy?'down':'up'; g.update(STEP); g.attemptMove(d); }
  check("L1 到达终点并通关", g.state === "win" && g.px === 7 && g.py === 7);
  check("L1 满血通关(5心)", g.hearts === 5);
}

// ---- 撞墙不移动、不扣血 ----
{
  const g = newGame(0);
  const h0 = g.hearts;
  g.attemptMove("up"); // (1,1) 上方是墙
  check("撞墙不扣血", g.hearts === h0 && g.px === 1 && g.py === 1);
}

// ---- L11 香蕉桥（必用关）引擎内可通关 ----
{
  const g = newGame(10);
  for (const d of ["down","down","down","right","down","down","down","down","down"]) { g.update(STEP); g.attemptMove(d); }
  check("L11 香蕉桥可通关(引擎内)", g.state === "win");
}

// ---- L10 香蕉弹簧迷宫：可移动不崩 ----
{
  const g = newGame(9);
  let moved = 0;
  for (const d of ["right","right","right","right","right","right","right","down","down","down"]) {
    g.update(STEP); const px = g.px, py = g.py; g.attemptMove(d); if (g.px !== px || g.py !== py) moved++;
  }
  check("L10 可移动且未崩溃", g.state === "playing" && moved > 0);
}

// ---- 怪兽 update 200 帧不崩 ----
for (const idx of [5, 14, 19]) {
  const g = newGame(idx);
  let ok = true;
  for (let f = 0; f < 200; f++) { g.update(0.016); if (!g.monsters.every(m => Number.isInteger(m.cell[0]) && Number.isInteger(m.cell[1]))) ok = false; }
  check(`L${idx+1} 怪兽 update 200 帧正常`, ok && g.state === "playing");
}

// ---- 火墙邻接扣血 + 冰墙冻结 ----
{
  const g = newGame(12); // L13 冰火两重天（含 F/I）
  g.burnImmune = 0; g.hearts = 5;
  let fx=-1,fy=-1;
  for (let y=0;y<g.rows;y++) for (let x=0;x<g.cols;x++) if (g.grid[y][x]==='F'){fx=x;fy=y;}
  g.px=fx+1; g.py=fy;
  g.checkHazard();
  check("火墙邻接扣血", g.hearts === 4);
  // 冰墙：找 I，邻格触发冻结
  g.burnImmune = 0; g.hearts = 5; g.freezeTimer = 0;
  let ix=-1,iy=-1;
  for (let y=0;y<g.rows;y++) for (let x=0;x<g.cols;x++) if (g.grid[y][x]==='I'){ix=x;iy=y;}
  g.px=ix+1; g.py=iy;
  g.checkHazard();
  check("冰墙邻接冻结3s", g.freezeTimer > 0 && g.hearts === 4);
}

// ---- 渲染不崩（动效代码覆盖各元素：墙/地刺/爱心/香蕉/弹簧/火墙/冰墙/终点/怪兽） ----
for (const idx of [0, 4, 9, 11, 12, 14, 19]) {
  let ok = true, err = "";
  try { const g = newGame(idx); for (let f = 0; f < 30; f++) { g.update(0.016); g.render(); } }
  catch (e) { ok = false; err = e.message; }
  check(`L${idx + 1} 渲染 30 帧不崩`, ok, err);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);

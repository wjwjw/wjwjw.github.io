/* engine.js — 迷宫游戏核心引擎（网格 / 移动 / 机关 / 怪兽 / 渲染）
 * 字符映射：# 墙  F 火墙  I 冰墙  . 地板  @ 起点  E 终点  S 地刺  H 爱心  B 香蕉  P 弹簧
 * 数值为纸面原型提案值，未经儿童实测，标 [PLACEHOLDER]（见 GAME_DESIGN.md §10）。
 *
 * 机关规则（v0.2 修订）：
 *  - 地刺 S：阻挡 + 扣 1 血，不前进（不可踏入）。
 *  - 香蕉 B：踏入后朝当前面向"前进 1 格"；若落点是香蕉则继续连锁（连续香蕉连滑）。
 *  - 弹簧 P：踏入后沿面向反方向"退后 2 格"（带 boing 动画）；落点若仍是香蕉则继续连锁。
 *  - 火墙 F / 冰墙 I：阻挡；相邻则扣 1 血 + 红屏3s(火) / 冻结3s(冰)。
 *  - 怪兽：固定路径往返，撞到扣 1 血并击退。
 *  - 所有伤害：扣血时角色变红 + 震动（hurtFlash / shakeT），火墙额外红屏。 */
(function (global) {
  const DIRS = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  };
  const OPP = { up: "down", down: "up", left: "right", right: "left" };

  // 移动冷却：成功移动一格后，需间隔 MOVE_COOLDOWN 秒才能再移动（防止连按瞬移，手感更稳）
  // [PLACEHOLDER] 0.5s 为提案值，未经儿童实测，可按手感微调。
  const MOVE_COOLDOWN = 0.5;

  const CHARACTERS = [
    { id: "dino", name: "小恐龙", color: "#6bcb77" },
    { id: "cat", name: "小猫", color: "#ffd93d" },
    { id: "dog", name: "小狗", color: "#fca311" },
    { id: "alien", name: "外星人", color: "#9b5de5" },
    { id: "shield", name: "刀盾狗", color: "#4d96ff" },
  ];

  // ---- 颜色工具：按主色派生高光/阴影，用于程序化像素角色 ----
  function hexToRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, f) {
    const [r, g, b] = hexToRgb(hex);
    const t = f < 0 ? 0 : 255, a = Math.abs(f);
    return `rgb(${Math.round(r + (t - r) * a)},${Math.round(g + (t - g) * a)},${Math.round(b + (t - b) * a)})`;
  }
  const LIGHT = (hex, f) => shade(hex, f);
  const DARK = (hex, f) => shade(hex, -f);

  class Game {
    constructor(canvas, audio, callbacks) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.audio = audio;
      this.cb = callbacks || {};
      this.TILE = 32;
      this.state = "idle";
      this._raf = null;
      this.moveLock = 0; // 移动冷却剩余时间（秒）
    }

    load(levelIndex, character) {
      const lv = LEVELS[levelIndex];
      this.levelIndex = levelIndex;
      this.level = lv;
      this.cols = lv.grid[0].length;
      this.rows = lv.grid.length;
      this.grid = lv.grid.map((r) => r.split(""));
      this.character = character || CHARACTERS[0];
      // 找起点
      let sx = 1, sy = 1;
      for (let y = 0; y < this.rows; y++)
        for (let x = 0; x < this.cols; x++)
          if (this.grid[y][x] === "@") { sx = x; sy = y; this.grid[y][x] = "."; }
      this.px = sx; this.py = sy;
      this.fromX = sx; this.fromY = sy; this.animT = 1; this.animDur = 0.12;
      this.facing = "down";
      this.hearts = 5;
      this.freezeTimer = 0; this.burnImmune = 0; this.hitInvuln = 0;
      this.redFlash = 0; this.hurtFlash = 0; this.shakeT = 0; this.springAnim = 0;
      this.moveLock = 0;
      this.time = 0; // 全局动画时钟（地形/怪兽/角色常驻动效）
      // 怪兽
      this.monsters = (lv.monsters || []).map((m) => {
        const path = m.path.map((p) => [p[0], p[1]]);
        const segLens = [];
        for (let i = 0; i < path.length - 1; i++)
          segLens.push(Math.abs(path[i + 1][0] - path[i][0]) + Math.abs(path[i + 1][1] - path[i][1]));
        return { path, segLens, speed: m.speed || 1.5, seg: 0, dir: 1, t: 0, rx: path[0][0], ry: path[0][1], cell: [path[0][0], path[0][1]], face: "right" };
      });
      this.resize();
      if (this.cb.onHearts) this.cb.onHearts(this.hearts);
    }

    resize() {
      const maxW = Math.min(window.innerWidth * 0.96, 1100);
      const maxH = window.innerHeight * 0.8;
      let tile = Math.floor(Math.min(maxW / this.cols, maxH / this.rows));
      tile = Math.max(20, Math.min(72, tile));
      this.TILE = tile;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = this.cols * tile * dpr;
      this.canvas.height = this.rows * tile * dpr;
      this.canvas.style.width = this.cols * tile + "px";
      this.canvas.style.height = this.rows * tile + "px";
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
    }

    start() { this.state = "playing"; this.last = performance.now(); this.loop(); }
    pause() { if (this.state === "playing") this.state = "paused"; if (this._raf) cancelAnimationFrame(this._raf); }
    resume() { if (this.state === "paused") { this.state = "playing"; this.last = performance.now(); this.loop(); } }
    stop() { this.state = "idle"; if (this._raf) cancelAnimationFrame(this._raf); }

    loop() {
      if (this.state !== "playing") return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.render();
      this._raf = requestAnimationFrame(() => this.loop());
    }

    cellAt(x, y) {
      if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return null;
      return this.grid[y][x];
    }

    attemptMove(dir) {
      if (this.state !== "playing" || this.freezeTimer > 0 || this.moveLock > 0) return;
      this.facing = dir;
      const d = DIRS[dir];
      const tx = this.px + d.x, ty = this.py + d.y;
      const t = this.cellAt(tx, ty);
      // 硬阻挡：墙 / 火墙 / 冰墙 / 越界
      if (t === "#" || t === "F" || t === "I" || t === null) { this.audio.sfx("bump"); return; }
      // 地刺：扣血但不前进（阻挡，不可踏入）
      if (t === "S") {
        this.damage("spike");
        this.fromX = this.px; this.fromY = this.py; this.animT = 1; this.shakeT = 0.3;
        return;
      }
      const ox = this.px, oy = this.py;
      this.px = tx; this.py = ty;
      this.audio.sfx("step");
      // 香蕉 / 弹簧推力（连锁：连续香蕉 / 弹簧落点再触发）
      const dist = this.resolveForced(dir);
      // 落地结算：爱心
      const ft = this.cellAt(this.px, this.py);
      if (ft === "H") {
        this.hearts = Math.min(5, this.hearts + 1);
        this.grid[this.py][this.px] = ".";
        this.audio.sfx("heart");
        if (this.cb.onHearts) this.cb.onHearts(this.hearts);
      }
      this.checkHazard();
      this.checkMonster();
      // 动画：推力距离越大滑得越久
      this.fromX = ox; this.fromY = oy;
      this.animDur = Math.max(0.12, dist * 0.12);
      this.animT = 0;
      this.moveLock = MOVE_COOLDOWN; // 启动移动冷却：0.5s 内不可再移动
      if (dist > 0) this.shakeT = Math.max(this.shakeT, 0.22);
      if (this.cellAt(this.px, this.py) === "E") { this.win(); return; }
      if (this.hearts <= 0) { this.lose(); return; }
    }

    // 处理落点上的香蕉/弹簧连锁，返回累计移动格数（用于动画时长与震动）
    resolveForced(dir) {
      let dist = 0, guard = 0;
      while (guard++ < 64) {
        const c = this.cellAt(this.px, this.py);
        if (c === "B") {
          const d = DIRS[dir];
          const at = this.cellAt(this.px + d.x, this.py + d.y);
          if (at === "#" || at === "F" || at === "I" || at === null) break;
          if (at === "S") { this.damage("spike"); break; }
          this.px += d.x; this.py += d.y; dist++;
          this.audio.sfx("banana");
          continue; // 连续香蕉继续前进
        } else if (c === "P") {
          this.springAnim = 0.42;
          this.audio.sfx("spring");
          const b = OPP[dir];
          const d = DIRS[b];
          let steps = 0;
          while (steps < 2) {
            const at = this.cellAt(this.px + d.x, this.py + d.y);
            if (at === "#" || at === "F" || at === "I" || at === null) break;
            if (at === "S") { this.damage("spike"); break; }
            this.px += d.x; this.py += d.y; dist++; steps++;
          }
          continue; // 落点若仍是香蕉/弹簧则继续连锁
        } else {
          break;
        }
      }
      return dist;
    }

    damage(src) {
      if (this.hitInvuln > 0) return;
      this.hearts -= 1;
      if (this.cb.onHearts) this.cb.onHearts(this.hearts);
      this.hurtFlash = 0.45; // 角色变红
      this.shakeT = 0.32;    // 角色震动
      if (src === "spike") this.audio.sfx("spike");
      else if (src === "monster") this.audio.sfx("monster");
      this.hitInvuln = 0.6;
    }

    checkHazard() {
      let hit = false, ice = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = this.cellAt(this.px + dx, this.py + dy);
        if (c === "F" || c === "I") { hit = true; if (c === "I") ice = true; }
      }
      if (hit && this.burnImmune <= 0) {
        this.hearts -= 1;
        if (this.cb.onHearts) this.cb.onHearts(this.hearts);
        this.burnImmune = 3; this.redFlash = 0.35; this.hitInvuln = 0.6;
        this.hurtFlash = 0.45; this.shakeT = 0.32; // 受火/冰也变红震动
        if (ice) { this.freezeTimer = 3; this.audio.sfx("ice"); }
        else this.audio.sfx("fire");
      }
    }

    checkMonster() {
      for (const m of this.monsters) {
        if (m.cell[0] === this.px && m.cell[1] === this.py && this.hitInvuln <= 0) {
          this.hearts -= 1;
          if (this.cb.onHearts) this.cb.onHearts(this.hearts);
          this.hurtFlash = 0.45; this.shakeT = 0.32; this.hitInvuln = 0.6;
          this.audio.sfx("monster");
          const kx = this.px + (this.px - m.cell[0]);
          const ky = this.py + (this.py - m.cell[1]);
          const kt = this.cellAt(kx, ky);
          if (kt && kt !== "#" && kt !== "F" && kt !== "I") { this.px = kx; this.py = ky; }
          if (this.hearts <= 0) { this.lose(); return; }
        }
      }
    }

    updateMonster(m, dt) {
      const segLen = m.segLens[m.seg] || 1;
      m.t += (m.speed * dt) / segLen;
      let guard = 0;
      while (m.t >= 1 && guard++ < 10) {
        m.t -= 1;
        m.seg += m.dir;
        if (m.seg >= m.path.length - 1) { m.seg = m.path.length - 1; m.dir = -1; }
        if (m.seg <= 0) { m.seg = 0; m.dir = 1; }
      }
      const a = m.path[m.seg];
      const b = m.path[m.seg + m.dir];
      m.rx = a[0] + (b[0] - a[0]) * m.t;
      m.ry = a[1] + (b[1] - a[1]) * m.t;
      m.cell = [Math.round(m.rx), Math.round(m.ry)];
      m.face = b[0] !== a[0] ? (b[0] > a[0] ? "right" : "left") : (b[1] > a[1] ? "down" : "up");
    }

    update(dt) {
      this.time += dt; // 推进动画时钟
      if (this.freezeTimer > 0) this.freezeTimer = Math.max(0, this.freezeTimer - dt);
      if (this.burnImmune > 0) this.burnImmune = Math.max(0, this.burnImmune - dt);
      if (this.hitInvuln > 0) this.hitInvuln = Math.max(0, this.hitInvuln - dt);
      if (this.redFlash > 0) this.redFlash = Math.max(0, this.redFlash - dt);
      if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt);
      if (this.springAnim > 0) this.springAnim = Math.max(0, this.springAnim - dt);
      if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
      if (this.moveLock > 0) this.moveLock = Math.max(0, this.moveLock - dt);
      if (this.animT < 1) this.animT = Math.min(1, this.animT + dt / this.animDur);
      for (const m of this.monsters) this.updateMonster(m, dt);
      this.checkMonster();
    }

    win() {
      this.state = "win";
      if (this._raf) cancelAnimationFrame(this._raf);
      this.audio.sfx("win");
      const stars = this.hearts >= 5 ? 3 : this.hearts >= 3 ? 2 : 1;
      if (this.cb.onWin) this.cb.onWin(stars);
    }
    lose() {
      this.state = "lose";
      if (this._raf) cancelAnimationFrame(this._raf);
      this.audio.sfx("lose");
      if (this.cb.onLose) this.cb.onLose();
    }

    // ---------- 渲染 ----------
    render() {
      const T = this.TILE, ctx = this.ctx;
      ctx.clearRect(0, 0, this.cols * T, this.rows * T);
      ctx.save();
      // 全局震动（受击时整屏晃一下）：确定性阻尼振荡，避免随机闪
      if (this.shakeT > 0) {
        const k = this.shakeT / 0.32;
        ctx.translate(Math.sin(this.time * 38) * k * T * 0.08, Math.cos(this.time * 34) * k * T * 0.06);
      }
      for (let y = 0; y < this.rows; y++)
        for (let x = 0; x < this.cols; x++)
          this.drawTile(ctx, x, y, this.grid[y][x], T);
      for (const m of this.monsters) this.drawMonster(ctx, m, T);
      this.drawPlayer(ctx, T);
      ctx.restore();
      // 状态染色（不受震动影响，铺满全屏）
      if (this.burnImmune > 0) { ctx.fillStyle = "rgba(255,60,40,0.18)"; ctx.fillRect(0, 0, this.cols * T, this.rows * T); }
      if (this.freezeTimer > 0) { ctx.fillStyle = "rgba(120,200,255,0.22)"; ctx.fillRect(0, 0, this.cols * T, this.rows * T); }
    }

    // 每格独立相位，避免所有元素同步抖动
    _phase(x, y) { return x * 12.9898 + y * 78.233; }

    drawTile(ctx, x, y, c, T) {
      const px = x * T, py = y * T;
      const cx = px + T / 2, cy = py + T / 2;
      const ph = this._phase(x, y);
      const t = this.time;
      // 地板（棋盘格草绿）
      const floor = (x + y) % 2 === 0 ? "#cdeeb0" : "#bfe6a0";
      ctx.fillStyle = floor; ctx.fillRect(px, py, T, T);
      // 地面微光（偶发 twinkle，点缀不喧宾）
      const tw = Math.sin(t * 2 + ph * 1.3) * 0.5 + 0.5;
      if (tw > 0.86) {
        ctx.fillStyle = `rgba(255,255,255,${((tw - 0.86) / 0.14) * 0.5})`;
        const tx = cx + Math.sin(ph) * T * 0.22, ty = cy + Math.cos(ph) * T * 0.22;
        ctx.beginPath(); ctx.arc(tx, ty, T * 0.03, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = "rgba(120,170,90,.25)"; ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
      if (c === "#") {
        ctx.fillStyle = "#7a5c3e"; ctx.fillRect(px, py, T, T);
        ctx.fillStyle = "#8d6a47"; ctx.fillRect(px + 2, py + 2, T - 4, T - 6);
        // 顶部高光脉动，砖块"呼吸"
        ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.05 * Math.sin(t * 2 + ph)})`;
        ctx.fillRect(px + 2, py + 2, T - 4, T * 0.18);
        // 部分墙顶长苔藓，轻轻摇摆
        if (((x * 7 + y * 13) % 5) === 0) {
          const sway = Math.sin(t * 2 + ph) * T * 0.03;
          ctx.fillStyle = "#8fd66f";
          ctx.beginPath(); ctx.ellipse(cx + sway, py + T * 0.12, T * 0.08, T * 0.05, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
      else if (c === "F") {
        // 火墙：跳动火焰 + 上升火星 + 暖光晕
        ctx.fillStyle = `rgba(255,120,40,${0.22 + 0.08 * Math.sin(t * 6 + ph)})`;
        ctx.beginPath(); ctx.arc(cx, cy, T * 0.62 * (1 + 0.06 * Math.sin(t * 6 + ph)), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ff7a3c"; ctx.fillRect(px, py, T, T);
        const tongues = 3;
        for (let i = 0; i < tongues; i++) {
          const fx = cx + (i - 1) * T * 0.22;
          const h = T * 0.52 * (0.7 + 0.3 * Math.sin(t * 9 + ph + i * 1.7));
          const w = T * 0.15;
          ctx.beginPath();
          ctx.moveTo(fx - w, cy + T * 0.32);
          ctx.quadraticCurveTo(fx - w, cy - h * 0.3, fx, cy - h);
          ctx.quadraticCurveTo(fx + w, cy - h * 0.3, fx + w, cy + T * 0.32);
          ctx.closePath();
          ctx.fillStyle = i % 2 ? "#ffb347" : "#ff5e2b"; ctx.fill();
        }
        for (let i = 0; i < 3; i++) {
          const e = (t * 0.6 + ph * 0.1 + i * 0.37) % 1;
          const ex = cx + Math.sin(t * 3 + i) * T * 0.2;
          const ey = cy + T * 0.3 - e * T * 0.7;
          ctx.fillStyle = `rgba(255,${150 + Math.floor(80 * (1 - e))},40,${0.6 * (1 - e)})`;
          ctx.beginPath(); ctx.arc(ex, ey, T * 0.04, 0, Math.PI * 2); ctx.fill();
        }
      }
      else if (c === "I") {
        // 冰墙：冷光描边 + 斜向流光 + 旋转闪点
        ctx.fillStyle = "#7fd4ff"; ctx.fillRect(px, py, T, T);
        ctx.lineWidth = 2; ctx.strokeStyle = `rgba(180,235,255,${0.35 + 0.3 * Math.sin(t * 2 + ph)})`;
        ctx.strokeRect(px + 2, py + 2, T - 4, T - 4);
        const sweep = (t * 0.5 + ph * 0.05) % 1;
        ctx.save(); ctx.beginPath(); ctx.rect(px, py, T, T); ctx.clip();
        const sx = px - T + sweep * 2 * T;
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath();
        ctx.moveTo(sx, py); ctx.lineTo(sx + T * 0.25, py);
        ctx.lineTo(sx + T * 0.05, py + T); ctx.lineTo(sx - T * 0.2, py + T);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        // 冰晶：六角雪花（矢量，避免 emoji 在旧电视上成方框）
        ctx.save(); ctx.translate(cx, cy);
        ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = Math.max(2, T * 0.05);
        const R = T * 0.3;
        for (let k = 0; k < 6; k++) {
          ctx.rotate(Math.PI / 3);
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.lineTo(0, -R);
          ctx.moveTo(0, -R * 0.6); ctx.lineTo(-R * 0.18, -R * 0.78);
          ctx.moveTo(0, -R * 0.6); ctx.lineTo(R * 0.18, -R * 0.78);
          ctx.stroke();
        }
        ctx.restore();
        for (let i = 0; i < 2; i++) {
          const a = t * 1.5 + ph + i * Math.PI;
          const rr = T * 0.3;
          const tw2 = Math.sin(t * 4 + ph + i) * 0.5 + 0.5;
          this.sparkle(ctx, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, T * 0.09 * tw2);
        }
      }
      else if (c === "S") {
        // 地刺：危险红光脉动 + 轻微起伏 + 随机 glint（提示"别踩"）
        ctx.fillStyle = `rgba(255,60,60,${0.1 + 0.12 * Math.sin(t * 4 + ph)})`;
        ctx.fillRect(px, py, T, T);
        const lift = 1 + 0.06 * Math.sin(t * 4 + ph);
        ctx.fillStyle = "#9aa0a6";
        for (let i = 0; i < 3; i++) {
          const bx = px + T * (0.2 + i * 0.3);
          const top = py + T * 0.25 / lift;
          ctx.beginPath();
          ctx.moveTo(bx - T * 0.12, py + T * 0.8);
          ctx.lineTo(bx, top);
          ctx.lineTo(bx + T * 0.12, py + T * 0.8);
          ctx.closePath(); ctx.fill();
        }
        const gl = Math.sin(t * 5 + ph);
        if (gl > 0.7) { ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(cx, cy - T * 0.05, T * 0.04, 0, Math.PI * 2); ctx.fill(); }
      }
      else if (c === "H") {
        // 爱心：漂浮 + 心跳脉冲 + 偶发闪光
        const bob = Math.sin(t * 3 + ph) * T * 0.05;
        const pulse = 1 + 0.08 * Math.sin(t * 4 + ph);
        ctx.fillStyle = `rgba(255,80,120,${0.14 + 0.1 * Math.sin(t * 3 + ph)})`;
        ctx.beginPath(); ctx.arc(cx, cy + bob, T * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(cx, cy + bob); ctx.scale(pulse, pulse);
        // 爱心（矢量心形）
        ctx.fillStyle = "#ff4d6d";
        const s = T * 0.3;
        ctx.beginPath();
        ctx.arc(-s * 0.5, -s * 0.15, s * 0.55, 0, Math.PI * 2);
        ctx.arc(s * 0.5, -s * 0.15, s * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-s * 0.95, -s * 0.05);
        ctx.lineTo(0, s * 0.7);
        ctx.lineTo(s * 0.95, -s * 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        const sp = Math.sin(t * 3 + ph + 2.0);
        if (sp > 0.6) this.sparkle(ctx, cx + T * 0.22, cy + bob - T * 0.22, T * 0.1 * (sp - 0.6) / 0.4);
      }
      else if (c === "B") {
        // 香蕉：左右摇摆（像在逗你踩）
        const ang = Math.sin(t * 2.5 + ph) * 0.22;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
        // 香蕉（黄色弯月矢量）
        ctx.lineCap = "round";
        ctx.strokeStyle = "#ffd93d"; ctx.lineWidth = T * 0.16;
        ctx.beginPath(); ctx.arc(0, T * 0.12, T * 0.3, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        ctx.strokeStyle = "#caa21f"; ctx.lineWidth = T * 0.05;
        ctx.beginPath(); ctx.arc(0, T * 0.12, T * 0.3, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        ctx.fillStyle = "#8a6a2a";
        ctx.beginPath(); ctx.arc(-T * 0.27, T * 0.3, T * 0.05, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(T * 0.27, T * 0.3, T * 0.05, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      else if (c === "P") {
        // 弹簧：待机时轻微压缩回弹；触发时走 boing（springAnim）
        let sy1 = 1, sx1 = 1;
        if (this.springAnim > 0) {
          const p = this.springAnim / 0.42, k = Math.sin(p * Math.PI);
          sy1 = 1 - 0.4 * k; sx1 = 1 + 0.28 * k;
        } else {
          const k = Math.sin(t * 3 + ph);
          sy1 = 1 - 0.12 * k; sx1 = 1 + 0.08 * k;
        }
        ctx.save(); ctx.translate(cx, cy); ctx.scale(sx1, sy1);
        ctx.strokeStyle = "#5a8dee"; ctx.lineWidth = Math.max(2, T * 0.08);
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const yy = -T * 0.18 + i * (T * 0.36 / 6);
          const xx = (i % 2 ? -1 : 1) * T * 0.12;
          if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.restore();
      }
      else if (c === "E") {
        // 终点：光环脉动 + 旗杆 + 飘动旗帜
        ctx.fillStyle = `rgba(255,220,80,${0.1 + 0.1 * Math.sin(t * 3 + ph)})`;
        ctx.beginPath(); ctx.arc(cx, cy, T * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff3b0"; ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
        ctx.fillStyle = "#8d6a47"; ctx.fillRect(cx - T * 0.04, cy - T * 0.3, T * 0.08, T * 0.6);
        const fx0 = cx + T * 0.04, fy0 = cy - T * 0.28, fw = T * 0.3, fh = T * 0.2;
        const wv = Math.sin(t * 6 + ph) * T * 0.05;
        ctx.fillStyle = "#ff5e7a";
        ctx.beginPath();
        ctx.moveTo(fx0, fy0);
        ctx.lineTo(fx0 + fw, fy0 + wv);
        ctx.lineTo(fx0 + fw, fy0 + fh + wv);
        ctx.lineTo(fx0, fy0 + fh);
        ctx.closePath(); ctx.fill();
      }
    }

    // 四角星闪光（冰墙闪点 / 爱心闪光复用）
    sparkle(ctx, x, y, r) {
      if (r <= 0.2) return;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.25, y - r * 0.25);
      ctx.lineTo(x + r, y); ctx.lineTo(x + r * 0.25, y + r * 0.25);
      ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.25, y + r * 0.25);
      ctx.lineTo(x - r, y); ctx.lineTo(x - r * 0.25, y - r * 0.25);
      ctx.closePath(); ctx.fill();
    }

    drawMonster(ctx, m, T) {
      const ph = this._phase(m.cell[0], m.cell[1]);
      const t = this.time;
      const cx0 = m.rx * T + T / 2;
      const cy0 = m.ry * T + T / 2;
      const bob = Math.sin(t * 3 + ph) * T * 0.03;
      const cx = cx0, cy = cy0 + bob;
      // 影子
      ctx.fillStyle = "rgba(0,0,0,.12)";
      ctx.beginPath(); ctx.ellipse(cx, cy0 + T * 0.32, T * 0.3, T * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      // 呼吸缩放
      const breathe = 1 + 0.05 * Math.sin(t * 3.5 + ph);
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(1, breathe);
      ctx.fillStyle = "#b15de0";
      this.roundRect(ctx, -T * 0.32, -T * 0.34, T * 0.64, T * 0.64, T * 0.18); ctx.fill();
      // 眼睛（朝移动方向）+ 眨眼
      const ex = m.face === "left" ? -1 : m.face === "right" ? 1 : 0;
      const ey = m.face === "up" ? -1 : m.face === "down" ? 1 : 0;
      const blinkPhase = (t + ph) % 2.8;
      const blinking = blinkPhase > 2.55;
      for (const s of [-1, 1]) {
        const exx = s * T * 0.12 + ex * T * 0.04;
        const eyy = -T * 0.04 + ey * T * 0.04;
        if (blinking) {
          ctx.strokeStyle = "#222"; ctx.lineWidth = T * 0.05;
          ctx.beginPath(); ctx.moveTo(exx - T * 0.1, eyy); ctx.lineTo(exx + T * 0.1, eyy); ctx.stroke();
        } else {
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(exx, eyy, T * 0.1, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(exx + ex * T * 0.04, eyy + ey * T * 0.04, T * 0.05, 0, Math.PI * 2); ctx.fill();
        }
      }
      // 小脚丫摆动
      ctx.fillStyle = "#8e3fc0";
      const legw = T * 0.1, legSwing = Math.sin(t * 6 + ph) * T * 0.05;
      ctx.beginPath(); ctx.ellipse(-T * 0.14 + legSwing, T * 0.34, legw, legw * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(T * 0.14 - legSwing, T * 0.34, legw, legw * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 近身警示 "!"（玩家 2 格内）
      const d = Math.abs(m.cell[0] - this.px) + Math.abs(m.cell[1] - this.py);
      if (d <= 2) {
        const ay = cy - T * 0.5 + Math.sin(t * 8) * T * 0.04;
        ctx.fillStyle = "#ff3b3b"; ctx.font = `${T * 0.4}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("!", cx, ay);
      }
    }

    drawPlayer(ctx, T) {
      let ix = this.fromX + (this.px - this.fromX) * this.animT;
      let iy = this.fromY + (this.py - this.fromY) * this.animT;
      let cx = ix * T + T / 2, cy = iy * T + T / 2;
      const cx0 = cx, cy0 = cy; // 地面锚点（影子固定）
      // 角色自身震动（受击/推力）：确定性阻尼振荡，避免随机抖动造成的"闪"
      if (this.shakeT > 0) {
        const k = this.shakeT / 0.32;                 // 1 -> 0，随时间收敛
        const m = k * T * 0.14;
        cx += Math.sin(this.time * 38) * m;
        cy += Math.cos(this.time * 34) * m * 0.6;
      }
      // 静止呼吸：原地轻轻起伏 + 微摆（移动/受击/弹簧时不叠加）
      let bx = cx0, by = cy0;
      if (this.animT >= 1 && this.shakeT <= 0 && this.springAnim <= 0) {
        by += Math.sin(this.time * 3) * T * 0.02;
        bx += Math.cos(this.time * 1.7) * T * 0.01;
      }
      // 弹簧 boing 动画：压扁回弹 + 扩散环（画在地面锚点，不随呼吸飘）
      let sx = 1, sy = 1;
      if (this.springAnim > 0) {
        const p = this.springAnim / 0.42;        // 1 -> 0
        const k = Math.sin(p * Math.PI);          // 0 -> 1 -> 0
        sy = 1 - 0.4 * k; sx = 1 + 0.28 * k;
        ctx.strokeStyle = `rgba(255,255,255,${0.7 * p})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx0, cy0, T * 0.5 * (1 + (1 - p) * 0.7), 0, Math.PI * 2); ctx.stroke();
      }
      // 影子
      ctx.fillStyle = "rgba(0,0,0,.15)";
      ctx.beginPath(); ctx.ellipse(cx0, cy0 + T * 0.34, T * 0.3, T * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      // 程序化像素角色（按角色类型区分外形）
      ctx.save();
      ctx.translate(bx, by); ctx.scale(sx, sy); ctx.translate(-bx, -by);
      this.drawChar(ctx, this.character, bx, by, T, this.facing);
      ctx.restore();
      // 受击变红：alpha 平滑淡出（不再硬切全红→瞬无，消除闪烁）
      const hurtA = this.hurtFlash > 0 ? Math.min(1, this.hurtFlash / 0.45) : 0;
      if (hurtA > 0) {
        ctx.save();
        ctx.globalAlpha = hurtA * 0.7;
        ctx.fillStyle = "#ff3b3b";
        this.roundRect(ctx, cx0 - T * 0.34, cy0 - T * 0.46, T * 0.68, T * 0.9, T * 0.22); ctx.fill();
        ctx.restore();
      }
      if (this.freezeTimer > 0) {
        ctx.fillStyle = "rgba(160,220,255,.55)";
        this.roundRect(ctx, cx0 - T * 0.38, cy0 - T * 0.4, T * 0.76, T * 0.76, T * 0.2); ctx.fill();
      }
    }

    // 程序化绘制像素风小怪兽，按 character.id 区分外形；facing=眼睛朝向；受击变红由调用方叠层
    drawChar(ctx, ch, cx, cy, T, facing) {
      const base = ch.color;
      const dark = DARK(ch.color, 0.22);
      const light = LIGHT(ch.color, 0.28);
      const id = ch.id;
      // 朝向偏移（眼睛/特征看向移动方向）
      const fx = facing === "left" ? -1 : facing === "right" ? 1 : 0;
      const fy = facing === "up" ? -1 : facing === "down" ? 1 : 0;
      // ---- 类型特征（先画在身体之后的"背后"部件：尾巴/耳朵等）----
      if (id === "dino") {
        // 尾巴（右侧小三角）
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(cx + T * 0.28, cy + T * 0.18);
        ctx.lineTo(cx + T * 0.46, cy + T * 0.26);
        ctx.lineTo(cx + T * 0.28, cy + T * 0.34);
        ctx.closePath(); ctx.fill();
        // 背刺（顶部三枚）
        ctx.fillStyle = light;
        for (const dx of [-0.12, 0, 0.12]) {
          ctx.beginPath();
          ctx.moveTo(cx + dx * T - T * 0.05, cy - T * 0.3);
          ctx.lineTo(cx + dx * T, cy - T * 0.44);
          ctx.lineTo(cx + dx * T + T * 0.05, cy - T * 0.3);
          ctx.closePath(); ctx.fill();
        }
      } else if (id === "cat") {
        // 尖耳
        ctx.fillStyle = base;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + s * T * 0.16, cy - T * 0.28);
          ctx.lineTo(cx + s * T * 0.3, cy - T * 0.46);
          ctx.lineTo(cx + s * T * 0.32, cy - T * 0.24);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = "#ff9bb0"; // 耳内粉
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + s * T * 0.19, cy - T * 0.29);
          ctx.lineTo(cx + s * T * 0.28, cy - T * 0.4);
          ctx.lineTo(cx + s * T * 0.29, cy - T * 0.27);
          ctx.closePath(); ctx.fill();
        }
      } else if (id === "dog") {
        // 垂耳
        ctx.fillStyle = dark;
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.ellipse(cx + s * T * 0.3, cy - T * 0.06, T * 0.1, T * 0.18, s * 0.3, 0, Math.PI * 2); ctx.fill();
        }
      } else if (id === "alien") {
        // 触角（头顶 + 灯泡）
        ctx.strokeStyle = dark; ctx.lineWidth = T * 0.05;
        ctx.beginPath(); ctx.moveTo(cx, cy - T * 0.32); ctx.lineTo(cx, cy - T * 0.46); ctx.stroke();
        ctx.fillStyle = "#ffe14d";
        ctx.beginPath(); ctx.arc(cx, cy - T * 0.48, T * 0.07, 0, Math.PI * 2); ctx.fill();
      } else if (id === "shield") {
        // 头盔尖角
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.moveTo(cx - T * 0.08, cy - T * 0.34);
        ctx.lineTo(cx, cy - T * 0.48);
        ctx.lineTo(cx + T * 0.08, cy - T * 0.34);
        ctx.closePath(); ctx.fill();
      }
      // ---- 身体（圆角块 + 顶部高光 + 底部阴影）----
      ctx.fillStyle = base;
      this.roundRect(ctx, cx - T * 0.3, cy - T * 0.32, T * 0.6, T * 0.62, T * 0.22); ctx.fill();
      ctx.fillStyle = light; // 顶部高光
      this.roundRect(ctx, cx - T * 0.3, cy - T * 0.32, T * 0.6, T * 0.22, T * 0.22); ctx.fill();
      ctx.fillStyle = dark;  // 底部阴影
      this.roundRect(ctx, cx - T * 0.3, cy + T * 0.12, T * 0.6, T * 0.18, T * 0.18); ctx.fill();
      // 肚皮
      ctx.fillStyle = "#fff7e6";
      ctx.beginPath(); ctx.ellipse(cx, cy + T * 0.12, T * 0.18, T * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      // ---- 眼睛（朝移动方向偏移）----
      const eyeY = cy - T * 0.06;
      for (const s of [-1, 1]) {
        const exx = cx + s * T * 0.12;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(exx, eyeY, T * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#222";
        ctx.beginPath(); ctx.arc(exx + fx * T * 0.04, eyeY + fy * T * 0.03, T * 0.05, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; // 眼神光
        ctx.beginPath(); ctx.arc(exx + fx * T * 0.04 - T * 0.02, eyeY + fy * T * 0.03 - T * 0.02, T * 0.018, 0, Math.PI * 2); ctx.fill();
      }
      // 腮红
      ctx.fillStyle = "rgba(255,140,160,0.6)";
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * T * 0.2, cy + T * 0.08, T * 0.06, T * 0.04, 0, 0, Math.PI * 2); ctx.fill(); }
      // 嘴
      ctx.strokeStyle = "#7a4a2a"; ctx.lineWidth = T * 0.03;
      ctx.beginPath(); ctx.arc(cx, cy + T * 0.04, T * 0.06, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      // ---- 类型前景特征 ----
      if (id === "dog") {
        // 吐舌
        ctx.fillStyle = "#ff7a9c";
        this.roundRect(ctx, cx - T * 0.04, cy + T * 0.1, T * 0.08, T * 0.1, T * 0.03); ctx.fill();
      } else if (id === "cat") {
        // 胡须
        ctx.strokeStyle = "rgba(90,70,50,0.7)"; ctx.lineWidth = T * 0.018;
        for (const s of [-1, 1]) for (const o of [-0.03, 0.03]) {
          ctx.beginPath();
          ctx.moveTo(cx + s * T * 0.1, cy + T * 0.06 + o * T);
          ctx.lineTo(cx + s * T * 0.32, cy + T * 0.02 + o * T);
          ctx.stroke();
        }
      } else if (id === "shield") {
        // 胸前护盾（圆角块 + 十字）
        ctx.fillStyle = "#cfe0ff";
        this.roundRect(ctx, cx - T * 0.12, cy + T * 0.02, T * 0.24, T * 0.22, T * 0.05); ctx.fill();
        ctx.fillStyle = "#4d96ff";
        ctx.fillRect(cx - T * 0.02, cy + T * 0.06, T * 0.04, T * 0.14);
        ctx.fillRect(cx - T * 0.08, cy + T * 0.1, T * 0.16, T * 0.04);
      }
      // ---- 脚丫 ----
      ctx.fillStyle = dark;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * T * 0.14, cy + T * 0.34, T * 0.08, T * 0.06, 0, 0, Math.PI * 2); ctx.fill(); }
    }

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  global.Game = Game;
  global.CHARACTERS = CHARACTERS;
})(window);

/*
 * fx.js —— 共享特效库（技术美术向，连接美术与开发的公共层）
 *
 * 提供四类可复用效果，各游戏按需取用：
 *   1) 粒子爆发 / 全屏彩纸（star / heart / dot / spark / rect 五种形状）
 *   2) 飘字 / 扩散环（得分与命中反馈）
 *   3) 环境漂浮微粒（萤火虫 / 尘埃 / 气泡，让背景「活」起来）
 *   4) 预渲染资产：柔光光斑 glowSprite、暗角 vignette
 *
 * 性能约定（老设备 = MiTV4A / Android 6 / WebView ≈ Chromium 47）：
 *   - 所有渐变 / 光斑 / 暗角都预渲染成离屏 canvas，每帧只 drawImage；
 *     绝不在渲染循环里创建渐变对象或拼接 rgba 字符串（GC 压力是掉帧主因）。
 *   - 粒子总量有硬上限（默认 150），超限时丢最老的，不设「熔断」就不怕爆炸场景。
 *   - 震屏用 sin 相位（确定性），不走 Math.random —— 与 snake / maze 的震屏一致，
 *     帧率波动时抖动轨迹也可复现，测试截图稳定。
 *
 * 用法（游戏侧通常三行接入）：
 *   var fx = FX.create();
 *   每帧：  fx.update(dt); …… fx.drawBack(ctx)（场景元素之下）; fx.drawFront(ctx)（最上层）;
 *   触发：  fx.burst(x, y, {colors:['#ffd166'], shapes:['star']});
 *           fx.confetti({w: viewW});            过关彩纸雨
 *           fx.float(x, y, '+50', {color:'#ffd166'});
 *           fx.ring(x, y, {color:'#7ee0b8'});
 *           fx.shake(6, 0.3);                   配合 fx.applyShake(ctx) / undoShake(ctx)
 *   资产：  var glow = FX.glowSprite('#ffd166', 64);   光斑（玩家光环、灯光）
 *           var vig  = FX.vignette(viewW, viewH);      暗角（resize 时重建）
 *
 * 兼容：经典脚本 + IIFE，纯 ES5，不依赖 DOM 结构，只依赖 canvas 2D。
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  // 节庆彩纸默认色板（暖金 + 糖果色，电视上饱和度拉高才看得清）
  var PALETTE = ['#ffd166', '#ff8fa3', '#7ee0b8', '#7fb8ff', '#c792ff', '#ff9f68'];

  // ---------- 基础工具 ----------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b + 1)); }
  function easeOutCubic(k) { return 1 - (1 - k) * (1 - k) * (1 - k); }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /* 确定性随机（LCG）：给「每次 resize 重排都一样」的静态装饰用。
   * Math.random 版本在转屏 / 改分辨率重绘时会整体跳一遍，电视上很显眼。 */
  function lcg(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  // ---------- 预渲染资产 ----------
  /* 径向柔光光斑：白核 → 主色 → 透明。玩家光环 / 灯光 / 环境微粒共用。
   * 返回离屏 canvas，用法：ctx.drawImage(spr, x - r, y - r, r * 2, r * 2)。 */
  function glowSprite(color, radius, coreAlpha) {
    var r = Math.max(2, Math.round(radius));
    var c = makeCanvas(r * 2, r * 2);
    var g = c.getContext('2d');
    var rgb = hexToRgb(color);
    var ca = coreAlpha == null ? 0.85 : coreAlpha;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,' + ca + ')');
    grad.addColorStop(0.3, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (ca * 0.85).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, r * 2, r * 2);
    return c;
  }

  /* 暗角：中心透明 → 边缘压暗。固定低分辨率生成、每帧拉伸 drawImage，
   * 渐变拉伸无损观感，却把生成开销和内存都压到最低（960×540 直出的暗角要 2MB 显存）。 */
  function vignette(w, h, opts) {
    opts = opts || {};
    var strength = opts.strength != null ? opts.strength : 0.42;
    var rgb = hexToRgb(opts.color || '#000000');
    var c = makeCanvas(192, 108);
    var g = c.getContext('2d');
    var cx = c.width / 2, cy = c.height / 2;
    var inner = opts.inner != null ? opts.inner : 0.52;
    var grad = g.createRadialGradient(cx, cy, Math.min(cx, cy) * inner, cx, cy,
                                      Math.sqrt(cx * cx + cy * cy));
    grad.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0)');
    grad.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + strength + ')');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // ---------- 矢量形状（以 x, y 为中心，size 为「半径」量级） ----------
  function pathStar(ctx, x, y, R, r, rot) {
    var i, ang, rad;
    if (rot == null) rot = 0;
    ctx.beginPath();
    for (i = 0; i < 10; i++) {
      rad = (i % 2 === 0) ? R : r;
      ang = rot - Math.PI / 2 + (Math.PI * i) / 5;
      if (i === 0) ctx.moveTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
      else ctx.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
    }
    ctx.closePath();
  }

  function pathHeart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.95);                                            // 底尖
    ctx.bezierCurveTo(x - s * 1.2, y + s * 0.15, x - s * 0.62, y - s * 0.85, x, y - s * 0.30);
    ctx.bezierCurveTo(x + s * 0.62, y - s * 0.85, x + s * 1.2, y + s * 0.15, x, y + s * 0.95);
    ctx.closePath();
  }

  // ---------- 特效实例 ----------
  function create(opts) {
    opts = opts || {};
    var maxParticles = opts.maxParticles || 150;
    var maxFloats = opts.maxFloats || 12;
    var maxRings = opts.maxRings || 10;

    var parts = [];      // 爆发粒子 + 彩纸共用一个池（彩纸只是带摆动/翻滚的 rect 粒子）
    var floats = [];
    var rings = [];
    var motes = [];      // 环境微粒
    var ambCfg = null;
    var ambSprites = [];
    var time = 0;        // 实例内部时钟（秒），震屏/摆动都基于它，保证确定性

    var shakeT = 0, shakeDur = 0, shakePow = 0;

    // ---- 触发 ----
    /* 径向粒子爆发。opts: {count, colors, shapes, speed:[min,max], size:[min,max],
     * life:[min,max], g(重力), drag(阻尼), angle(主方向弧度,缺省全向), spread(角度抖动)} */
    function burst(x, y, o) {
      o = o || {};
      var count = o.count || 14;
      var colors = o.colors || PALETTE;
      var shapes = o.shapes || ['dot'];
      var sp0 = o.speed ? o.speed[0] : 60, sp1 = o.speed ? o.speed[1] : 190;
      var s0 = o.size ? o.size[0] : 3, s1 = o.size ? o.size[1] : 6;
      var l0 = o.life ? o.life[0] : 0.5, l1 = o.life ? o.life[1] : 0.9;
      var i;
      for (i = 0; i < count; i++) {
        var a = (o.angle != null)
          ? o.angle + rand(-(o.spread != null ? o.spread : 0.5), (o.spread != null ? o.spread : 0.5))
          : rand(0, TAU);
        var sp = rand(sp0, sp1);
        parts.push({
          x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          g: o.g != null ? o.g : 320,
          drag: o.drag != null ? o.drag : 1.6,
          age: 0, life: rand(l0, l1),
          size: rand(s0, s1),
          color: colors[randi(0, colors.length - 1)],
          shape: shapes[randi(0, shapes.length - 1)],
          rot: rand(0, TAU), vrot: rand(-7, 7),
          tumble: 0, vtumble: 0, swayAmp: 0, phase: 0,
          shrink: o.shrink !== false, fadeEnd: false
        });
      }
      while (parts.length > maxParticles) parts.shift();
    }

    /* 全屏彩纸雨（过关 / 通关）。opts: {count, x0, x1, y, colors, life} */
    function confetti(o) {
      o = o || {};
      var count = o.count || 60;
      var x0 = o.x0 != null ? o.x0 : 0;
      var x1 = o.x1 != null ? o.x1 : (o.w || 0);
      var y = o.y != null ? o.y : -12;
      var colors = o.colors || PALETTE;
      for (var i = 0; i < count; i++) {
        parts.push({
          x: rand(x0, x1), y: y + rand(-50, 30),
          vx: rand(-45, 45), vy: rand(50, 140),
          g: 150, drag: 0.25,
          age: 0, life: (o.life ? o.life : 2.2) + rand(-0.5, 0.6),
          size: rand(4.5, 8),
          color: colors[randi(0, colors.length - 1)],
          shape: 'rect',
          rot: rand(0, TAU), vrot: rand(-6, 6),
          tumble: rand(0, TAU), vtumble: rand(4, 9),
          swayAmp: rand(14, 36), phase: rand(0, TAU),
          shrink: false, fadeEnd: true
        });
      }
      while (parts.length > maxParticles) parts.shift();
    }

    /* 扩散环（命中点的「波」）。opts: {r0, r1, life, color, lw} */
    function ring(x, y, o) {
      o = o || {};
      rings.push({
        x: x, y: y,
        r0: o.r0 != null ? o.r0 : 6,
        r1: o.r1 != null ? o.r1 : 46,
        age: 0, life: o.life || 0.45,
        color: o.color || '#ffd166',
        lw: o.lw || 4
      });
      if (rings.length > maxRings) rings.shift();
    }

    /* 飘字（+10 / 连击 x2）。opts: {color, size, life, stroke(默认带描边)} */
    function floatText(x, y, text, o) {
      o = o || {};
      floats.push({
        x: x, y: y, text: text,
        color: o.color || '#ffd166',
        age: 0, life: o.life || 0.9,
        size: o.size || 20,
        stroke: o.stroke !== false
      });
      if (floats.length > maxFloats) floats.shift();
    }

    /* 环境微粒（萤火虫 / 尘埃 / 气泡 / 花粉）。
     * opts: {count, w, h, x0, y0(限定区域左上角，缺省 0), colors, glow(光斑半径),
     *        size:[min,max], speed:[min,max], alpha:[min,max]}
     *        —— 微粒自下而上缓漂 + sin 横摆 + 明暗闪烁。
     * x0/y0 用于把微粒关进某个矩形（如 snake 只让花粉飘在草地里，别飘到黑板边框上）。
     * resize 后重调一次即可（微粒是运动的，重建不会像静态纹理那样「跳」）。 */
    function setAmbient(o) {
      ambCfg = o || null;
      motes = [];
      ambSprites = [];
      if (!o || !o.count) return;
      var colors = o.colors || ['#ffffff'];
      var glow = o.glow || 26;
      for (var i = 0; i < colors.length; i++) {
        ambSprites.push(glowSprite(colors[i], glow, o.core != null ? o.core : 0.55));
      }
      var s0 = o.size ? o.size[0] : 3, s1 = o.size ? o.size[1] : 9;
      var v0 = o.speed ? o.speed[0] : 5, v1 = o.speed ? o.speed[1] : 15;
      var a0 = o.alpha ? o.alpha[0] : 0.10, a1 = o.alpha ? o.alpha[1] : 0.30;
      var x0 = o.x0 || 0, y0 = o.y0 || 0;
      for (i = 0; i < o.count; i++) {
        motes.push({
          bx: x0 + rand(0, o.w), by: y0 + rand(0, o.h),
          size: rand(s0, s1),
          spd: rand(v0, v1),
          amp: rand(6, 26), ph: rand(0, TAU), wob: rand(0.3, 0.9),
          a: rand(a0, a1), tw: rand(0.5, 1.6), twp: rand(0, TAU),
          si: i % ambSprites.length
        });
      }
    }

    /* 震屏：fx.shake(强度px, 时长s)；绘制外层用 applyShake/undoShake 包住。
     * sin 相位确定性抖动（与 snake/maze 一致），幅度平方衰减，结尾不「振尾」。 */
    function shake(pow, dur) {
      shakePow = pow || 6;
      shakeDur = dur || 0.3;
      shakeT = shakeDur;
    }
    function applyShake(ctx) {
      ctx.save();
      if (shakeT > 0 && shakeDur > 0) {
        var k = shakeT / shakeDur;
        var m = shakePow * k * k;
        ctx.translate(Math.sin(time * 49) * m, Math.cos(time * 41) * m * 0.8);
      }
    }
    function undoShake(ctx) { ctx.restore(); }

    /* 清空瞬时效果（切场景 / 重开一局时调用；环境微粒保留） */
    function clear() {
      parts = []; floats = []; rings = [];
      shakeT = 0;
    }

    // ---- 每帧推进 ----
    function update(dt) {
      time += dt;
      if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);

      var i, p;
      for (i = parts.length - 1; i >= 0; i--) {
        p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        if (p.swayAmp) p.vx = Math.sin(time * 3 + p.phase) * p.swayAmp;   // 彩纸横摆
        p.vy += p.g * dt;
        var d = 1 - p.drag * dt;
        if (d < 0) d = 0;
        p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        if (p.vtumble) p.tumble += p.vtumble * dt;
      }
      for (i = floats.length - 1; i >= 0; i--) {
        floats[i].age += dt;
        if (floats[i].age >= floats[i].life) floats.splice(i, 1);
      }
      for (i = rings.length - 1; i >= 0; i--) {
        rings[i].age += dt;
        if (rings[i].age >= rings[i].life) rings.splice(i, 1);
      }
      if (ambCfg) {
        var ax0 = ambCfg.x0 || 0, ay0 = ambCfg.y0 || 0;
        for (i = 0; i < motes.length; i++) {
          motes[i].by -= motes[i].spd * dt;
          if (motes[i].by < ay0 - 30) {                // 漂出顶部后从底部重生
            motes[i].by = ay0 + ambCfg.h + 20;
            motes[i].bx = ax0 + rand(0, ambCfg.w);
          }
        }
      }
    }

    // ---- 绘制：环境层（画在场景元素之下） ----
    function drawBack(ctx) {
      if (!ambCfg) return;
      var i, m, x, a;
      for (i = 0; i < motes.length; i++) {
        m = motes[i];
        x = m.bx + Math.sin(time * m.wob + m.ph) * m.amp;
        a = m.a * (0.55 + 0.45 * Math.sin(time * m.tw + m.twp));      // 明暗闪烁
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(ambSprites[m.si], x - m.size, m.by - m.size, m.size * 2, m.size * 2);
      }
      ctx.globalAlpha = 1;
    }

    // ---- 绘制：前景层（环 → 粒子/彩纸 → 飘字，画在最上层） ----
    function drawFront(ctx) {
      var i, k;

      for (i = 0; i < rings.length; i++) {
        var r = rings[i];
        k = r.age / r.life;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * easeOutCubic(k), 0, TAU);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = Math.max(1.5, r.lw * (1 - k * 0.6));
        ctx.stroke();
      }

      for (i = 0; i < parts.length; i++) {
        var p = parts[i];
        k = p.age / p.life;
        var a = p.fadeEnd
          ? (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3)
          : (1 - k) * (k < 0.08 ? k / 0.08 : 1);                       // 爆发粒子先弹入再淡出
        if (a <= 0.01) continue;
        var s = p.shrink ? p.size * (1 - k * 0.7) : p.size;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
          // 彩纸：绕轴翻滚（cos 模拟投影）+ 自转，两行代码给出「纸片在飘」的错觉
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, 0.3 + 0.7 * Math.abs(Math.cos(p.tumble)));
          ctx.fillRect(-s / 2, -s * 0.31, s, s * 0.62);
          ctx.restore();
        } else if (p.shape === 'star') {
          pathStar(ctx, p.x, p.y, s, s * 0.45, p.rot);
          ctx.fill();
        } else if (p.shape === 'heart') {
          pathHeart(ctx, p.x, p.y, s);
          ctx.fill();
        } else if (p.shape === 'spark') {
          // 速度方向拉出的短光线
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1.2, s * 0.5);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.8, s), 0, TAU);
          ctx.fill();
        }
      }

      if (floats.length) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + Math.round(floats[0].size) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
        for (i = 0; i < floats.length; i++) {
          var f = floats[i];
          k = f.age / f.life;
          var fy = f.y - f.size * 1.7 * easeOutCubic(k);
          ctx.globalAlpha = k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35);
          if (f.stroke) {
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';      // 深色描边：浅色字在亮背景上也看得清
            ctx.lineWidth = Math.max(2, f.size * 0.14);
            ctx.strokeText(f.text, f.x, fy);
          }
          ctx.fillStyle = f.color;
          ctx.fillText(f.text, f.x, fy);
        }
      }
      ctx.globalAlpha = 1;
    }

    return {
      update: update,
      drawBack: drawBack,
      drawFront: drawFront,
      burst: burst,
      confetti: confetti,
      ring: ring,
      float: floatText,
      setAmbient: setAmbient,
      shake: shake,
      applyShake: applyShake,
      undoShake: undoShake,
      clear: clear
    };
  }

  window.FX = {
    create: create,
    glowSprite: glowSprite,
    vignette: vignette,
    pathStar: pathStar,
    pathHeart: pathHeart,
    hexToRgb: hexToRgb,
    lcg: lcg,
    PALETTE: PALETTE
  };
})();

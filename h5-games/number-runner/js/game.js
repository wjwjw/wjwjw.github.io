/* game.js —— 数字跑酷 3D（Number Runner 3D）核心引擎
 *
 * 玩法：三车道 3D 跑酷 + 数字合并（2048 式翻倍）。
 *   - 玩家持有一个数值（初始 2），沿赛道向前跑（世界向镜头移动）。
 *   - 左右（方向键/WASD/滑动）切换车道，去撞「和自己身上一样的数字」→ 数值翻倍、得分。
 *   - 撞到不一样的数字或炸弹 → 扣一条命（共 3 条）。
 *   - 香蕉：碰到滑倒并扣分（不扣命，短暂减速）。
 *   - 传送门：进入后触发冲刺动画（加速掠过 + 镜头拉伸 + 全屏闪光）+ 短无敌 + 加分。
 *   - 变小药水：限时缩小玩家，可躲过横扫的大摆锤。
 *   - 大摆锤：横摆的重力锤，未缩小且被扫到扣命。
 *   - 多关卡：每关跑到里程后进入 Boss 战；靠合并数字累计伤害击败 Boss，
 *     共 3 个 Boss：摆锤魔 / 传送门法师 / 数字泰坦。最终关胜利。
 *
 * 约束（见 h5-games/docs/STANDARD.md）：经典脚本（IIFE），不依赖 ES module；
 * 3D 用本地同域 three.min.js（r128，已验证 Chrome 47 兼容）；不依赖 emoji（数字用 CanvasTexture）。
 */
(function () {
  "use strict";

  var canvas = document.getElementById("game");
  var audio = new AudioManager();

  // ---------- TA 屏幕空间特效层（../shared/fx.js + 2D 覆盖画布） ----------
  // fx.js 是 Canvas 2D 库，画不进 WebGL 场景；用一块叠在渲染画布之上的 2D 画布
  // 做屏幕空间特效：3D 世界坐标先经 project() 投到屏幕像素，再喷粒子/飘字/彩纸。
  var fx = (window.FX ? FX.create() : null);
  var fxCanvas = document.getElementById("fx2d");
  var fx2 = fxCanvas ? fxCanvas.getContext("2d") : null;
  var _v3 = null;   // 复用的投影向量，避免每帧新建（GC 压力）

  // ---------- WebGL / three.js 初始化 ----------
  var renderer, scene, camera, threeOK = false;
  var groundTex = null;
  var warpOverlay = null;
  var LANES = 3;
  var LANE_SP = 2.6;
  var laneX = [-LANE_SP, 0, LANE_SP];
  var playerZ = 4;
  var spawnZ = -54;
  var despawnZ = 11;
  var ENT_Y = 0.95;
  var decor = [];          // 两侧滚动光球（scrollWorld 统一驱动，见 buildLightOrbs）
  var playerShadow = null; // 玩家假投影：独立对象，不随玩家缩放/倒下一起变形
  var blinkTexCache = {};  // 「闭眼」面牌贴图缓存（与 texCache 分开，避免互串）
  var playerBlinkT = 3;    // 距下次眨眼秒数
  var playerBlinkLeft = 0; // 眨眼剩余闭合时长

  function initThree() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b0e14);
      scene.fog = new THREE.Fog(0x0b0e14, 22, 60);
      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
      camera.position.set(0, 4.4, 12.5);
      camera.lookAt(0, 1.1, -14);

      scene.add(new THREE.AmbientLight(0xffffff, 0.62));
      var dir = new THREE.DirectionalLight(0xffffff, 0.85);
      dir.position.set(-6, 12, 8);
      scene.add(dir);
      var rim = new THREE.DirectionalLight(0x6f8cff, 0.35);
      rim.position.set(0, 6, -20);
      scene.add(rim);

      buildGround();
      threeOK = true;
      return true;
    } catch (e) {
      threeOK = false;
      return false;
    }
  }

  function buildGround() {
    var c = document.createElement("canvas");
    c.width = 256; c.height = 512;
    var g = c.getContext("2d");
    // 底色
    var grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#10161f");
    grad.addColorStop(1, "#0a0d13");
    g.fillStyle = grad; g.fillRect(0, 0, 256, 512);
    // 三车道微差
    var lw = 256 / 3;
    for (var i = 0; i < 3; i++) {
      g.fillStyle = (i % 2 === 0) ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)";
      g.fillRect(i * lw, 0, lw, 512);
    }
    // 车道分隔虚线：青色 + shadowBlur 辉光（贴图只画一次，老设备无每帧成本）
    g.shadowColor = "rgba(120,220,255,0.9)";
    g.shadowBlur = 12;
    g.fillStyle = "rgba(150,170,210,0.5)";
    for (var d = 0; d < 2; d++) {
      var x = (d + 1) * lw;
      for (var y = 0; y < 512; y += 64) g.fillRect(x - 3, y, 6, 34);
    }
    // 赛道外沿实线：更亮的青光，勾出跑道边界
    g.fillStyle = "rgba(120,220,255,0.55)";
    g.fillRect(2, 0, 4, 512); g.fillRect(250, 0, 4, 512);
    g.shadowBlur = 0;
    // 前行箭头（chevron）：每车道一个、低透明度，强化「向前跑」的方向感
    g.fillStyle = "rgba(255,255,255,0.05)";
    for (var cy = 32; cy < 512; cy += 128) {
      for (var l = 0; l < 3; l++) {
        var cx = l * lw + lw / 2;
        g.beginPath();
        g.moveTo(cx - 24, cy); g.lineTo(cx + 8, cy + 22); g.lineTo(cx - 24, cy + 44);
        g.lineTo(cx - 15, cy + 22); g.closePath(); g.fill();
      }
    }
    groundTex = new THREE.CanvasTexture(c);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(1, 9);
    var groundGeo = new THREE.PlaneGeometry(LANE_SP * 3, 78);
    var groundMatLocal = new THREE.MeshLambertMaterial({ map: groundTex });
    groundMat = groundMatLocal;
    var ground = new THREE.Mesh(groundGeo, groundMatLocal);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -22);
    scene.add(ground);

    // 两侧护栏 + 顶部 Neon 光带（MeshBasic 自发光色，给赛道镶一道青光边）
    var railGeo = geo("rail", function () { return new THREE.BoxGeometry(0.3, 1.0, 78); });
    var railMat = mat("rail", function () { return new THREE.MeshLambertMaterial({ color: 0x2c3650 }); });
    var stripGeo = geo("rail-strip", function () { return new THREE.BoxGeometry(0.09, 0.05, 78); });
    var stripMat = mat("rail-strip", function () { return new THREE.MeshBasicMaterial({ color: 0x54d8ff }); });
    for (var s = 0; s < 2; s++) {
      var sx = (s === 0 ? -1 : 1) * (LANE_SP * 1.5 + 0.2);
      var rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(sx, 0.5, -22);
      scene.add(rail);
      var strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(sx, 1.03, -22);
      scene.add(strip);
    }

    // 远景四件套：渐变天幕 / 星点 / 楼影 / 两侧光球。
    // 纯色背景在 3D 里「一览无余」，有远景才有纵深——全部静态、一次建好。
    buildSky();
    buildStars();
    buildSkyline();
    buildLightOrbs();
  }

  // 天幕：竖向渐变（天顶 #05070c → 地平线辉光 → 线以下远处雾霭），
  // 与 scene.background / fog 同色系，地面远端淡入时不露接缝
  function buildSky() {
    var c = document.createElement("canvas");
    c.width = 8; c.height = 256;
    var g = c.getContext("2d");
    var grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#05070c");
    grad.addColorStop(0.45, "#0b0e14");
    grad.addColorStop(0.6, "#1a2340");
    grad.addColorStop(0.68, "#141b31");
    grad.addColorStop(1, "#0d1322");
    g.fillStyle = grad; g.fillRect(0, 0, 8, 256);
    var plane = new THREE.Mesh(
      new THREE.PlaneGeometry(460, 300),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), fog: false, depthWrite: false }));
    plane.position.set(0, 30, -95);
    scene.add(plane);
  }

  // 星点：Points 一次画完。fog:false 否则会被跑道雾气吞掉；
  // sizeAttenuation:false 让星星不随距离缩放（本来就是「无穷远」）
  function buildStars() {
    var n = 240, arr = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 340;
      arr[i * 3 + 1] = 10 + Math.random() * 110;
      arr[i * 3 + 2] = -42 - Math.random() * 52;
    }
    var bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    scene.add(new THREE.Points(bg, new THREE.PointsMaterial({
      color: 0xcfe0ff, size: 2, sizeAttenuation: false,
      transparent: true, opacity: 0.85, fog: false, depthWrite: false
    })));
  }

  // 楼影：两侧远景剪影，亮窗走同一张立面贴图（clone 后各自 repeat）。
  // fog:false —— 楼在雾距之外，不吃雾才能保持剪影的深色
  function buildSkyline() {
    var tex = buildingTexture();
    var unitBox = new THREE.BoxGeometry(1, 1, 1);
    for (var i = 0; i < 12; i++) {
      var side = (i % 2 === 0) ? -1 : 1;
      var w = 5 + Math.random() * 7;
      var h = 8 + Math.random() * 26;
      var t = tex.clone();
      t.needsUpdate = true;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 5)));
      var b = new THREE.Mesh(unitBox,
        new THREE.MeshBasicMaterial({ map: t, color: 0x8f98bd, fog: false }));
      b.scale.set(w, h, 5 + Math.random() * 5);
      b.position.set(side * (17 + Math.random() * 32), h / 2 - 3, -68 - Math.random() * 22);
      scene.add(b);
    }
  }

  // 两侧滚动光球：每帧只改 position.z 并循环，是最便宜的「速度感」来源
  // （地面贴图 offset 是一层视差，光球贴脸过是第二层——近景糊一下才觉得快）
  function buildLightOrbs() {
    var n = 10, span = 76;
    for (var i = 0; i < n; i++) {
      for (var s = 0; s < 2; s++) {
        var orb = glowSprite((i + s) % 2 === 0 ? 0x59e0ff : 0x7a5cff,
          1 + Math.random() * 0.5, 0.5 + Math.random() * 0.25);
        orb.position.set((s === 0 ? -1 : 1) * (LANE_SP * 1.5 + 1.1),
          2.4 + Math.random() * 1.2,
          14 - (i + (s === 0 ? 0 : 0.5)) * (span / n));
        scene.add(orb);
        decor.push(orb);
      }
    }
  }

  // ---------- 画布自适应 ----------
  var W = 0, H = 0;
  var dpr = 1;   // fx2d 背景存储放大倍数：与 renderer.setPixelRatio 同一策略，上限 2
  function resize() {
    var maxW = Math.min(window.innerWidth, 1280);
    var maxH = window.innerHeight;
    W = maxW; H = maxH;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    if (fxCanvas) {
      // 背景存储按 dpr 放大（高分屏上粒子才不会比 WebGL 画面糊），
      // CSS 宽高必须钉回 W×H，覆盖层才和 #game 重叠对齐；每帧绘制前 setTransform(dpr,...)。
      fxCanvas.width = Math.round(W * dpr);
      fxCanvas.height = Math.round(H * dpr);
      fxCanvas.style.width = W + "px";
      fxCanvas.style.height = H + "px";
    }
    if (fx) {
      fx.setView(W, H);
      // 环境浮尘：极淡的冷色微粒在镜头前漂浮，给深色跑道加「空气感」
      fx.setAmbient({
        count: 14, w: W, h: H,
        colors: ["#7fb8ff", "#ffffff"], glow: 22,
        size: [2, 6], speed: [4, 10], alpha: [0.04, 0.12], core: 0.5
      });
    }
    if (threeOK) {
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }
  }
  window.addEventListener("resize", resize);

  // 3D 世界坐标 → 屏幕像素坐标（fx2d 覆盖层用）。目标在镜头之后（v.z > 1）返回 null。
  function project(x, y, z) {
    if (!threeOK || !fx2) return null;
    if (!_v3) _v3 = new THREE.Vector3();
    _v3.set(x, y, z).project(camera);
    if (_v3.z > 1) return null;
    return { x: (_v3.x + 1) / 2 * W, y: (1 - _v3.y) / 2 * H };
  }

  // 传送动画用的全屏彩色闪光层（动态创建，避免改 HTML）
  function ensureWarpOverlay() {
    if (warpOverlay) return;
    warpOverlay = document.createElement("div");
    warpOverlay.id = "warpOverlay";
    warpOverlay.style.cssText =
      "position:fixed;left:0;top:0;width:100%;height:100%;" +
      "background:radial-gradient(circle at 50% 62%,#7fe9ff 0%,rgba(122,92,255,0.6) 55%,rgba(11,14,20,0) 100%);" +
      "opacity:0;pointer-events:none;z-index:6;";
    document.body.appendChild(warpOverlay);
  }

  // 全屏闪光：默认蓝色（传送），通关时切金色。仅改 background + opacity，不新增 DOM
  var ORIG_WARP_BG = "radial-gradient(circle at 50% 62%,#7fe9ff 0%,rgba(122,92,255,0.6) 55%,rgba(11,14,20,0) 100%)";
  function flashScreen() {
    if (!warpOverlay) return;
    warpOverlay.style.background = "radial-gradient(circle at 50% 55%, rgba(255,228,130,0.9) 0%, rgba(255,176,40,0.4) 55%, rgba(11,14,20,0) 100%)";
    warpOverlay.style.opacity = "0.8";
  }
  function restoreWarpBg() {
    if (!warpOverlay) return;
    warpOverlay.style.background = ORIG_WARP_BG;
    warpOverlay.style.opacity = "0";
  }
  // 死亡瞬间用的红色闪光（复用 warpOverlay 这一层），与金色闪光对称
  function flashRed() {
    if (!warpOverlay) return;
    warpOverlay.style.background = "radial-gradient(circle at 50% 50%, rgba(255,70,70,0.85) 0%, rgba(150,20,20,0.5) 55%, rgba(11,14,20,0) 100%)";
    warpOverlay.style.opacity = "0.7";
  }

  // ---------- 工具：数值取色 ----------
  function valueColor(v) {
    var p = Math.round(Math.log(v) / Math.log(2));
    var hue = (p * 38) % 360;
    return "hsl(" + hue + ",72%,56%)";
  }
  function roundRectCtx(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ---------- 资源缓存 ----------
  // 实体是高频生成的（正常约每秒 1~2 行），几何/材质/贴图一律只建一次、全场共享。
  // ⚠️ 缓存材质是「只读共享」：任何按实例改色的需求必须先 clone()，否则同值实体一起变色。
  var geoCache = {};
  var matCache = {};
  function geo(key, factory) {
    var g = geoCache[key];
    if (!g) { g = factory(); geoCache[key] = g; }
    return g;
  }
  function mat(key, factory) {
    var m = matCache[key];
    if (!m) { m = factory(); matCache[key] = m; }
    return m;
  }

  // 数值 → 色相：指数取色（2→0°, 4→38°, 8→76°…）。同值永远同色，合并后「长大变色」可感知。
  function valueHue(v) { return (Math.round(Math.log(v) / Math.log(2)) * 38) % 360; }
  function valueColorA(v, a) { return "hsla(" + valueHue(v) + ",72%,56%," + a + ")"; }

  // "#rrggbb" → "rgba(...)"（Canvas 渐变要带透明度）
  function withAlpha(hex, a) {
    var h = hex.charAt(0) === "#" ? hex.slice(1) : hex;
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  // THREE 色值 → {r,g,b}（0~255，画布渐变用）
  function hexRGB(color) {
    var col = new THREE.Color(color);
    return { r: Math.round(col.r * 255), g: Math.round(col.g * 255), b: Math.round(col.b * 255) };
  }

  // 圆角盒：把 BoxGeometry 顶点按「内盒 + 半径」外推（面心不动、棱角收圆），
  // 再重算法线。比 ExtrudeGeometry 的 bevel 行为可靠，立方体模型立刻「玩具化」。
  function roundedBoxGeo(w, h, d, r, seg) {
    var s = seg || 4;
    var g = new THREE.BoxGeometry(w, h, d, s, s, s);
    var pos = g.attributes.position;
    var hx = w / 2, hy = h / 2, hz = d / 2;
    var rr = Math.min(r, hx, hy, hz);
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var cx = Math.max(-hx + rr, Math.min(hx - rr, x));
      var cy = Math.max(-hy + rr, Math.min(hy - rr, y));
      var cz = Math.max(-hz + rr, Math.min(hz - rr, z));
      var dx = x - cx, dy = y - cy, dz = z - cz;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 0.0001) {
        var k = rr / len;
        pos.setXYZ(i, cx + dx * k, cy + dy * k, cz + dz * k);
      }
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }

  // 描边（inverted hull）：同几何体放大一档 + BackSide 单色，给模型一圈「贴纸感」亮边。
  // 比 EdgesGeometry 便宜（不建线段缓冲），曲面也有一致轮廓。
  // 注意：返回的 mesh 要加到「与源 mesh 相同的父节点」，position 已按源 mesh 复制。
  function outlineOf(mesh, color, scale) {
    var o = new THREE.Mesh(mesh.geometry, mat("outline" + color, function () {
      return new THREE.MeshBasicMaterial({ color: color, side: THREE.BackSide });
    }));
    o.position.copy(mesh.position);
    o.scale.setScalar(scale || 1.06);
    return o;
  }

  // 径向柔光贴图（按色缓存，一次生成）：Sprite + Additive 做「自发光」光晕
  var glowTexCache = {};
  function glowTexture(color) {
    var key = "g" + color;
    if (glowTexCache[key]) return glowTexCache[key];
    var rgb = hexRGB(color);
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.22, "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0.55)");
    grad.addColorStop(1, "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0)");
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c);
    glowTexCache[key] = t;
    return t;
  }
  function glowSprite(color, scale, opacity) {
    var op = opacity === undefined ? 0.8 : opacity;
    var sp = new THREE.Sprite(mat("glow" + color + "_" + op, function () {
      return new THREE.SpriteMaterial({
        map: glowTexture(color), transparent: true, opacity: op,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
    }));
    sp.scale.set(scale || 2, scale || 2, 1);
    return sp;
  }

  // 假投影：径向黑斑贴在实体脚下。深色跑道上「落地感」几乎全靠它，
  // 比真阴影（shadowMap）便宜一个数量级，老设备无感。
  var shadowTex = null;
  function shadowSprite(scale, opacity) {
    if (!shadowTex) {
      var c = document.createElement("canvas");
      c.width = c.height = 128;
      var g = c.getContext("2d");
      var grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
      grad.addColorStop(0, "rgba(0,0,0,0.6)");
      grad.addColorStop(0.55, "rgba(0,0,0,0.25)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      shadowTex = new THREE.CanvasTexture(c);
    }
    var op = opacity === undefined ? 0.85 : opacity;
    var sp = new THREE.Sprite(mat("shadow" + op, function () {
      return new THREE.SpriteMaterial({ map: shadowTex, transparent: true, opacity: op, depthWrite: false });
    }));
    var sz = scale || 1.6;
    sp.scale.set(sz, sz * 0.55, 1);
    return sp;
  }

  // 传送门漩涡盘：双螺旋臂 + 亮核（additive 混合，像「门在吸」）
  var swirlTex = null;
  function swirlTexture() {
    if (swirlTex) return swirlTex;
    var c = document.createElement("canvas");
    c.width = c.height = 256;
    var g = c.getContext("2d");
    g.clearRect(0, 0, 256, 256);
    g.translate(128, 128);
    g.lineCap = "round";
    for (var arm = 0; arm < 2; arm++) {
      g.save();
      g.rotate(arm * Math.PI);
      var grad = g.createLinearGradient(0, 0, 108, 0);
      grad.addColorStop(0, "rgba(170,242,255,0.9)");
      grad.addColorStop(1, "rgba(122,92,255,0)");
      g.strokeStyle = grad;
      g.lineWidth = 15;
      g.beginPath();
      for (var t = 0; t <= 1.001; t += 0.04) {
        var ang = t * 2.6, rad = 8 + t * 100;
        var px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
        if (t === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
      g.restore();
    }
    var core = g.createRadialGradient(0, 0, 2, 0, 0, 42);
    core.addColorStop(0, "rgba(255,255,255,0.95)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = core;
    g.fillRect(-128, -128, 256, 256);
    swirlTex = new THREE.CanvasTexture(c);
    return swirlTex;
  }

  // 楼体立面（见 buildSkyline）：暗底 + 零星亮窗，一次性生成
  function buildingTexture() {
    var c = document.createElement("canvas");
    c.width = 64; c.height = 128;
    var g = c.getContext("2d");
    g.fillStyle = "#18203a"; g.fillRect(0, 0, 64, 128);
    for (var y = 6; y < 122; y += 12) {
      for (var x = 6; x < 58; x += 12) {
        g.fillStyle = (Math.random() < 0.32) ? "rgba(255,214,130,0.9)" : "rgba(96,110,158,0.16)";
        g.fillRect(x, y, 7, 8);
      }
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // 世界滚动统一入口：地面纹理 offset + 两侧光球循环。
  // 主循环、死亡演出、通关演出共用——否则「减速停下」时地面停了光球还在飞，很出戏。
  function scrollWorld(dz) {
    if (groundTex) groundTex.offset.y -= dz * 0.018;
    for (var i = 0; i < decor.length; i++) {
      var o = decor[i];
      o.position.z += dz;
      if (o.position.z > 14) o.position.z -= 76;
    }
  }

  // 数字贴图缓存（CanvasTexture，不用 emoji）
  // 贴图四层：数值色光晕 → 脸（眼/微笑）→ 彩色描边数字 → 白填充。
  // 数字块全是「活物」，撞上去有生命感；blink=true 画闭眼（玩家专用，见 setPlayerFace）。
  var texCache = {};
  function numTexture(value, blink) {
    var cache = blink ? blinkTexCache : texCache;
    if (cache[value]) return cache[value];
    var c = document.createElement("canvas");
    c.width = c.height = 256;
    var g = c.getContext("2d");
    var txt = String(value);
    // 长数字自适应：先按位数选基准字号，再用 measureText 实测宽度收缩到画布内，
    // 避免 5 位以上（如 16384）横向溢出被裁切。
    var fs = txt.length >= 5 ? 84 : (txt.length === 4 ? 104 : (txt.length === 3 ? 128 : 150));
    var fontOf = function (s) { return "bold " + s + "px 'PingFang SC','Microsoft YaHei',system-ui,sans-serif"; };
    g.font = fontOf(fs);
    var maxW = 236;
    var w = g.measureText(txt).width;
    if (w > maxW) { fs = Math.max(42, Math.floor(fs * maxW / w)); g.font = fontOf(fs); }
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round";
    // ① 光晕：数值色径向渐变，像数字块在自发光（是光不是背板，深色跑道也醒目）
    var halo = g.createRadialGradient(128, 128, 8, 128, 128, 120);
    halo.addColorStop(0, valueColorA(value, 0.5));
    halo.addColorStop(0.45, valueColorA(value, 0.18));
    halo.addColorStop(1, valueColorA(value, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, 256, 256);
    // ② 脸：眼睛在数字上方、微笑在下方（闭眼态两眼各一道横线）
    if (blink) {
      g.strokeStyle = "#1c2230";
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(74, 52); g.lineTo(102, 52);
      g.moveTo(154, 52); g.lineTo(182, 52);
      g.stroke();
    } else {
      drawEye(g, 88, 52);
      drawEye(g, 168, 52);
    }
    // ③ 数字本体：彩色描边（保留数值大小的颜色身份）+ 白色填充，深色背景上清晰可见
    g.lineWidth = Math.max(8, Math.round(fs * 0.15));
    g.strokeStyle = valueColor(value);
    g.strokeText(txt, 128, 146);
    g.fillStyle = "#fff";
    g.fillText(txt, 128, 146);
    // ④ 微笑：数字底边下一道弧，「脸」才完整
    g.strokeStyle = "rgba(28,34,48,0.85)";
    g.lineWidth = 6;
    g.beginPath(); g.arc(128, 202, 20, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    var t = new THREE.CanvasTexture(c);
    if (renderer) t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    cache[value] = t;
    return t;
  }
  // 一只眼：白底 + 深色瞳孔 + 高光点（远看也读得出是「脸」）
  function drawEye(g, x, y) {
    g.fillStyle = "#ffffff";
    g.beginPath(); g.ellipse(x, y, 15, 18, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1c2230";
    g.beginPath(); g.arc(x + 2, y + 2, 7.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath(); g.arc(x - 2, y - 4, 2.6, 0, Math.PI * 2); g.fill();
  }

  function makeLabelSprite(text, color, size) {
    var c = document.createElement("canvas");
    c.width = c.height = 256;
    var g = c.getContext("2d");
    // 底部柔光：与数字块同思路，标签（X/蕉/门/小）在暗处也读得出
    var halo = g.createRadialGradient(128, 128, 8, 128, 128, 116);
    halo.addColorStop(0, withAlpha(color, 0.4));
    halo.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, 256, 256);
    g.font = "bold 200px system-ui,sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round";
    // 不要背板：彩色描边 + 白色填充
    g.lineWidth = 22;
    g.strokeStyle = color || "#ff5d5d";
    g.strokeText(text, 128, 140);
    g.fillStyle = "#fff";
    g.fillText(text, 128, 140);
    var t = new THREE.CanvasTexture(c);
    if (renderer) t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
    var s = size || 1.9;
    sp.scale.set(s, s, s);
    return sp;
  }

  // ---------- 玩家 ----------
  // 结构：grp（站位/光环）→ body（跑动时微颠）→ 机身/亮边/面牌/天线/腿
  var player = null;
  function buildPlayer() {
    var grp = new THREE.Group();
    var bodyGrp = new THREE.Group();
    // 机身：圆角盒（BoxGeometry 顶点球面化，见 roundedBoxGeo）+ 白色亮边
    var boxGeo = geo("player-box", function () { return roundedBoxGeo(1.7, 1.7, 1.7, 0.34, 4); });
    var boxMat = new THREE.MeshLambertMaterial({ color: 0x4c8bf5 });
    var box = new THREE.Mesh(boxGeo, boxMat);
    box.position.y = ENT_Y;
    bodyGrp.add(box);
    bodyGrp.add(outlineOf(box, 0xffffff, 1.05));
    // 头顶天线：末端小球颜色 = 当前数值色，合并瞬间「唰」地变色（refreshPlayerVisual）
    var antenna = new THREE.Mesh(geo("player-antenna", function () { return new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5); }),
      mat("player-antenna", function () { return new THREE.MeshLambertMaterial({ color: 0xdfe9ff }); }));
    antenna.position.y = ENT_Y + 1.08;
    bodyGrp.add(antenna);
    var tipMat = new THREE.MeshBasicMaterial({ color: 0xffd93d });
    var tip = new THREE.Mesh(geo("player-tip", function () { return new THREE.SphereGeometry(0.13, 10, 8); }), tipMat);
    tip.position.y = ENT_Y + 1.38;
    bodyGrp.add(tip);
    // 小短腿：pivot 已平移到髋部（几何体下移），rotation.x 摆动即跑动
    var footGeo = geo("player-foot", function () {
      var fg = roundedBoxGeo(0.44, 0.5, 0.62, 0.16, 2);
      fg.translate(0, -0.25, 0);
      return fg;
    });
    var feet = [];
    for (var f = 0; f < 2; f++) {
      var foot = new THREE.Mesh(footGeo, mat("player-foot", function () {
        return new THREE.MeshLambertMaterial({ color: 0x2c5fd0 });
      }));
      foot.position.set(f === 0 ? -0.44 : 0.44, 0.42, 0.12);
      bodyGrp.add(foot);
      feet.push(foot);
    }
    // 数字面牌：dedicated=true —— 玩家要单独换「闭眼」贴图，不能和场上数字块共享材质
    var sprite = makeNumSprite(2, true);
    sprite.position.set(0, ENT_Y, 0.9);
    bodyGrp.add(sprite);
    grp.add(bodyGrp);
    // 护盾 / 无敌光环
    var ringMat = new THREE.MeshBasicMaterial({ color: 0x36c6d3, transparent: true, opacity: 0.8 });
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 8, 28), ringMat);
    ring.position.y = ENT_Y; ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    grp.add(ring);
    // 假投影：独立场景对象（不随玩家缩小/倒下变形），位置每帧在 update 里跟随
    var sh = shadowSprite(2.1, 0.9);
    sh.position.set(0, 0.03, playerZ);
    sh.visible = false; // 菜单态不显示，startGame 开场再亮出
    scene.add(sh);
    playerShadow = sh;
    grp.visible = false;
    scene.add(grp);
    player = {
      lane: 1, x: laneX[1], value: 2, mesh: grp, body: bodyGrp, box: box, boxMat: boxMat,
      sprite: sprite, ring: ring, ringMat: ringMat, tip: tip, tipMat: tipMat, feet: feet
    };
  }
  // dedicated=true 时新建材质（玩家专用）；否则按数值缓存共享（数字块用）
  function makeNumSprite(value, dedicated) {
    var m;
    if (dedicated) {
      m = new THREE.SpriteMaterial({ map: numTexture(value), transparent: true, depthWrite: false, depthTest: false });
    } else {
      m = mat("numspr" + value, function () {
        return new THREE.SpriteMaterial({ map: numTexture(value), transparent: true, depthWrite: false, depthTest: false });
      });
    }
    var sp = new THREE.Sprite(m);
    sp.scale.set(1.75, 1.75, 1.75);
    return sp;
  }
  // 眨眼面牌切换（贴图级，无额外 draw call）
  function setPlayerFace(closed) {
    var t = closed ? numTexture(player.value, true) : numTexture(player.value);
    if (player.sprite.material.map !== t) {
      player.sprite.material.map = t;
      player.sprite.material.needsUpdate = true;
    }
  }
  function refreshPlayerVisual() {
    player.boxMat.color.set(valueColor(player.value));
    player.tipMat.color.set(valueColor(player.value)); // 天线尖端跟着数值变色
    setPlayerFace(false);
    playerBlinkT = 2 + Math.random() * 2; // 刚合并完，缓一缓再眨
  }

  // ---------- 实体工厂 ----------
  // 统一结构：grp（站位 + 假投影，钉在地面）→ fly（悬浮呼吸，自身不转）→ 零件（各自旋转）。
  // 这样面牌/标签不跟模型乱转、假投影不随呼吸漂、碰撞判定（lane + z 窗口）完全不受影响。
  function makeNum(lane, value) {
    var grp = new THREE.Group();
    var fly = new THREE.Group();
    var boxGeo = geo("num-box", function () { return roundedBoxGeo(1.5, 1.5, 1.5, 0.3, 4); });
    var col = new THREE.Color(valueColor(value));
    var box = new THREE.Mesh(boxGeo, mat("num" + value, function () {
      // emissive 取同色 28%：数字块「自带一点光」，和贴图里的光晕方向一致
      return new THREE.MeshLambertMaterial({ color: col.clone(), emissive: col.clone().multiplyScalar(0.28) });
    }));
    box.position.y = ENT_Y;
    fly.add(box);
    fly.add(outlineOf(box, 0xffffff, 1.06));
    var sp = makeNumSprite(value);
    sp.position.set(0, ENT_Y, 0.82);
    fly.add(sp);
    grp.add(shadowSprite(1.5, 0.8));
    grp.add(fly);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return { type: "num", lane: lane, value: value, z: spawnZ, x: laneX[lane], mesh: grp, model: box, fly: fly, hit: false, dead: false, spin: 0 };
  }
  function makeBomb(lane) {
    var grp = new THREE.Group();
    var fly = new THREE.Group();
    // 弹体：油亮黑球（Phong 高光）+ 金属箍 + 弯引线 + 末端火花（火花闪烁见 update）
    var ball = new THREE.Mesh(geo("bomb-ball", function () { return new THREE.SphereGeometry(0.82, 18, 14); }),
      mat("bomb-ball", function () {
        // 深灰偏亮一档：纯黑在暗色跑道上只剩一个红 X，抬亮点才读得出「球」
        return new THREE.MeshPhongMaterial({ color: 0x353542, shininess: 90, specular: 0x666677 });
      }));
    ball.position.y = ENT_Y;
    fly.add(ball);
    var band = new THREE.Mesh(geo("bomb-band", function () { return new THREE.TorusGeometry(0.84, 0.09, 8, 22); }),
      mat("bomb-band", function () {
        return new THREE.MeshPhongMaterial({ color: 0x8e2f23, shininess: 60, specular: 0x997755 });
      }));
    band.position.y = ENT_Y; band.rotation.x = Math.PI / 2;
    fly.add(band);
    var fuse = new THREE.Mesh(geo("bomb-fuse", function () {
      // 引线是条弯管（CatmullRom），从弹顶拐出去
      var curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, ENT_Y + 0.7, 0),
        new THREE.Vector3(0.24, ENT_Y + 1.05, 0.1),
        new THREE.Vector3(0.55, ENT_Y + 1.12, 0.02),
        new THREE.Vector3(0.68, ENT_Y + 1.42, 0.12)
      ]);
      return new THREE.TubeGeometry(curve, 16, 0.05, 6, false);
    }), mat("bomb-fuse", function () { return new THREE.MeshLambertMaterial({ color: 0x6b4a1f }); }));
    fly.add(fuse);
    var spark = glowSprite(0xffb03a, 0.55, 0.95);
    spark.position.set(0.68, ENT_Y + 1.42, 0.12);
    fly.add(spark);
    var sp = makeLabelSprite("X", "#ff5d5d", 1.6);
    sp.position.set(0, ENT_Y, 0.86);
    fly.add(sp);
    grp.add(shadowSprite(1.4, 0.8));
    grp.add(fly);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return { type: "bomb", lane: lane, z: spawnZ, x: laneX[lane], mesh: grp, model: ball, fly: fly, spark: spark, hit: false, dead: false, spin: Math.random() * 6 };
  }
  function makeBanana(lane) {
    var grp = new THREE.Group();
    var fly = new THREE.Group();
    // body 作为旋转体（弯月+果柄+熟蒂），标签挂 fly 上不跟着晃
    var body = new THREE.Group();
    var tube = new THREE.Mesh(geo("banana-tube", function () {
      // 弯月形曲线（XY 平面）：两端上翘、中段下垂，比圆环弧更像真香蕉
      var curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.8, 0.42, 0),
        new THREE.Vector3(-0.42, -0.26, 0),
        new THREE.Vector3(0.0, -0.5, 0),
        new THREE.Vector3(0.42, -0.26, 0),
        new THREE.Vector3(0.8, 0.42, 0)
      ]);
      return new THREE.TubeGeometry(curve, 32, 0.21, 12, false);
    }), mat("banana-tube", function () {
      // Phong + 微自发光：蕉皮油亮，暗处也黄得醒目
      return new THREE.MeshPhongMaterial({ color: 0xf6d23a, shininess: 60, specular: 0xffeeaa, emissive: 0x2a2405 });
    }));
    body.add(tube);
    // 棕色果柄（一头）
    var stem = new THREE.Mesh(geo("banana-stem", function () { return new THREE.CylinderGeometry(0.05, 0.085, 0.32, 6); }),
      mat("banana-stem", function () { return new THREE.MeshLambertMaterial({ color: 0x6b4a1f }); }));
    stem.position.set(-0.8, 0.6, 0); stem.rotation.z = 0.55;
    body.add(stem);
    // 另一头的深色熟蒂尖
    var btip = new THREE.Mesh(geo("banana-tip", function () { return new THREE.SphereGeometry(0.07, 7, 6); }),
      mat("banana-tip", function () { return new THREE.MeshLambertMaterial({ color: 0x4a3414 }); }));
    btip.position.set(0.8, 0.42, 0);
    body.add(btip);
    body.position.y = ENT_Y;
    fly.add(body);
    var tag = makeLabelSprite("蕉", "#e0b400", 1.05);
    tag.position.set(0, ENT_Y + 1.25, 0);
    fly.add(tag);
    grp.add(shadowSprite(1.5, 0.8));
    grp.add(fly);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return { type: "banana", lane: lane, z: spawnZ, x: laneX[lane], mesh: grp, model: body, fly: fly, hit: false, dead: false, spin: 0 };
  }
  function makePortal(lane) {
    var grp = new THREE.Group();
    var fly = new THREE.Group();
    var pg = new THREE.Group();
    // 三圈异色环 + 漩涡盘 + 大光晕；内外环差速自转（e.rings 在 update 里驱动）
    var r1 = new THREE.Mesh(geo("portal-r1", function () { return new THREE.TorusGeometry(1.0, 0.16, 10, 30); }),
      mat("portal-r1", function () { return new THREE.MeshBasicMaterial({ color: 0x59e0ff }); }));
    var r2 = new THREE.Mesh(geo("portal-r2", function () { return new THREE.TorusGeometry(0.72, 0.12, 10, 26); }),
      mat("portal-r2", function () { return new THREE.MeshBasicMaterial({ color: 0x7a5cff }); }));
    var r3 = new THREE.Mesh(geo("portal-r3", function () { return new THREE.TorusGeometry(0.46, 0.09, 8, 22); }),
      mat("portal-r3", function () { return new THREE.MeshBasicMaterial({ color: 0xffffff }); }));
    pg.add(r1); pg.add(r2); pg.add(r3);
    var disc = new THREE.Mesh(geo("portal-disc", function () { return new THREE.CircleGeometry(0.68, 28); }),
      new THREE.MeshBasicMaterial({
        map: swirlTexture(), transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }));
    pg.add(disc);
    pg.position.y = 1.5; // 把旋转中心抬到门心，绕自身轴自转而非绕底部摆动
    fly.add(pg);
    var halo = glowSprite(0x59e0ff, 3.2, 0.45);
    halo.position.y = 1.5;
    fly.add(halo);
    var tag = makeLabelSprite("门", "#1fa8c8", 1.05);
    tag.position.set(0, 2.7, 0);
    fly.add(tag);
    grp.add(shadowSprite(1.8, 0.7));
    grp.add(fly);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return {
      type: "portal", lane: lane, z: spawnZ, x: laneX[lane], mesh: grp, model: pg, fly: fly,
      rings: [{ m: r2, sp: -1.6 }, { m: r3, sp: 2.4 }, { m: disc, sp: 1.1 }],
      hit: false, dead: false, spin: 0
    };
  }
  function makeShrink(lane) {
    var grp = new THREE.Group();
    var fly = new THREE.Group();
    var sg = new THREE.Group();
    // 瓶身：LatheGeometry 旋转成型（药水瓶轮廓），半透明绿玻璃
    var bottle = new THREE.Mesh(geo("shrink-bottle", function () {
      var profile = [[0, 0], [0.3, 0], [0.33, 0.08], [0.36, 0.3], [0.3, 0.55], [0.15, 0.72], [0.14, 0.86], [0.19, 0.92], [0.19, 1.02], [0, 1.02]];
      var pts = [];
      for (var i = 0; i < profile.length; i++) pts.push(new THREE.Vector2(profile[i][0], profile[i][1]));
      return new THREE.LatheGeometry(pts, 18);
    }), new THREE.MeshPhongMaterial({
      color: 0x2fbf7a, transparent: true, opacity: 0.85, shininess: 80, specular: 0xffffff, side: THREE.DoubleSide
    }));
    bottle.position.y = 0.2;
    sg.add(bottle);
    // 液面亮环 + 木塞
    var liquid = new THREE.Mesh(geo("shrink-liquid", function () { return new THREE.CylinderGeometry(0.3, 0.31, 0.34, 16); }),
      mat("shrink-liquid", function () { return new THREE.MeshBasicMaterial({ color: 0x8ff5c0 }); }));
    liquid.position.y = 0.5;
    sg.add(liquid);
    var cork = new THREE.Mesh(geo("shrink-cork", function () { return new THREE.CylinderGeometry(0.16, 0.18, 0.16, 10); }),
      mat("shrink-cork", function () { return new THREE.MeshLambertMaterial({ color: 0x9a6b3a }); }));
    cork.position.y = 1.3;
    sg.add(cork);
    // 两颗上升气泡（y 在 update 里驱动）
    var bubbles = [];
    for (var b = 0; b < 2; b++) {
      var bub = new THREE.Mesh(geo("shrink-bubble", function () { return new THREE.SphereGeometry(0.055, 8, 6); }),
        mat("shrink-bubble", function () {
          return new THREE.MeshBasicMaterial({ color: 0xd6ffe9, transparent: true, opacity: 0.9 });
        }));
      bub.userData.off = b * 0.5;
      sg.add(bub);
      bubbles.push(bub);
    }
    sg.position.y = 0.1;
    fly.add(sg);
    var halo = glowSprite(0x3ad17a, 2.4, 0.4);
    halo.position.y = 0.8;
    fly.add(halo);
    var tag = makeLabelSprite("小", "#1f9e57", 0.95);
    tag.position.set(0, 1.8, 0);
    fly.add(tag);
    grp.add(shadowSprite(1.2, 0.8));
    grp.add(fly);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return { type: "shrink", lane: lane, z: spawnZ, x: laneX[lane], mesh: grp, model: sg, fly: fly, bubbles: bubbles, hit: false, dead: false, spin: 0 };
  }
  // 大摆锤：横摆的重力锤（x 方向摆动，覆盖多车道），缩小可躲
  function makePendulum(lane) {
    var grp = new THREE.Group();
    // 吊臂 + 顶部横梁（给出「挂在上面」的出处，比光杆一根有信息量）
    var rod = new THREE.Mesh(geo("pend-rod", function () { return new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8); }),
      mat("pend-rod", function () { return new THREE.MeshLambertMaterial({ color: 0x555a66 }); }));
    rod.position.y = ENT_Y + 1.5;
    grp.add(rod);
    var beam = new THREE.Mesh(geo("pend-beam", function () { return new THREE.BoxGeometry(3.4, 0.22, 0.22); }),
      mat("pend-beam", function () { return new THREE.MeshLambertMaterial({ color: 0x3a4152 }); }));
    beam.position.y = ENT_Y + 3.1;
    grp.add(beam);
    // 锤头：低面数球 + flatShading 出砺石棱角，配金属箍（比纯球更「重」）
    var head = new THREE.Mesh(geo("pend-head", function () { return new THREE.IcosahedronGeometry(0.88, 0); }),
      mat("pend-head", function () {
        return new THREE.MeshPhongMaterial({ color: 0xc0392b, shininess: 40, specular: 0x775544, flatShading: true });
      }));
    head.position.y = ENT_Y - 0.25;
    grp.add(head);
    var band = new THREE.Mesh(geo("pend-band", function () { return new THREE.TorusGeometry(0.52, 0.09, 6, 16); }),
      mat("pend-band", function () { return new THREE.MeshPhongMaterial({ color: 0x77211a, shininess: 70, specular: 0xaa9977 }); }));
    band.position.y = ENT_Y - 0.25; band.rotation.x = Math.PI / 2;
    grp.add(band);
    grp.add(shadowSprite(1.9, 0.85));
    grp.position.set(0, 0, spawnZ);
    scene.add(grp);
    return {
      type: "pendulum", lane: -1, z: spawnZ, x: 0, mesh: grp, hit: false, dead: false,
      phase: Math.random() * Math.PI * 2, amp: LANE_SP * 1.15, spin: 0
    };
  }

  // ---------- 关卡 / Boss 配置 ----------
  var LEVELS = [
    { name: "第 1 关 · 启程", dist: 520, speed: 9, boss: null },
    { name: "第 2 关 · 摆锤魔", dist: 640, speed: 11, boss: "pendulum" },
    { name: "第 3 关 · 传送门法师", dist: 760, speed: 13, boss: "portal" },
    { name: "第 4 关 · 数字泰坦", dist: 880, speed: 15, boss: "titan" }
  ];
  // Boss HP = 入场时玩家数值 × hpMul。
  // 关键：玩家数字指数滚雪球（2→4→8…），绝对血量会被一次合并秒掉；
  // 改为「当前数值的倍数」后，击杀所需合并次数恒定 ≈ log2(hpMul/2)，
  // 与数字多大无关，最终 Boss 不再是 2 下通关。
  // [PLACEHOLDER · 待 playtest] 目标单场 Boss 战：摆锤魔≈12s / 法师≈16s / 泰坦≈20s
  var BOSSCFG = {
    pendulum: { name: "摆锤魔", hpMul: 96, color: 0xb8455a, attacks: ["pendulum", "bomb", "banana"] },
    portal: { name: "传送门法师", hpMul: 384, color: 0x7a5cff, attacks: ["portal", "bomb", "banana"] },
    titan: { name: "数字泰坦", hpMul: 1500, color: 0xff8c42, attacks: ["bomb", "pendulum", "banana"] }
  };

  // 死亡演出时长（秒）。[PLACEHOLDER · 待 playtest] 与 startDeathSeq 里 cinemaTimer 初值保持一致
  var DEATH_DUR = 1.8;
  var VICTORY_DUR = 3.0; // [PLACEHOLDER · 待 playtest] 通关演出时长；原 2.2s 偏快，加长到 3.0s 让切胜利不再突兀

  // ---------- 游戏状态 ----------
  var STATE = { MENU: "menu", SELECT: "select", PLAY: "playing", PAUSE: "paused", OVER: "gameover", VICTORY: "victory" };
  var state = STATE.MENU;

  var entities, distance, score, best, lives, combo, actionScore, mergeBump, cinematic, cinemaTimer, cinemaKind, levelNav, selNav;
  var gameClock, spawnTimer, shieldEnd, invincibleEnd, shrinkEnd, slipEnd, warpTimer;
  var speedMul, shake, bossPhase, boss, bossHP, bossMaxHP, bossAttackTimer, groundMat, boostActive;
  var currentLevel, maxUnlocked;
  var BEST_KEY = "numberRunnerBest";
  var UNLOCK_KEY = "numberRunnerUnlocked";

  function loadBest() {
    try { best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0; }
    catch (e) { best = 0; }
    try { maxUnlocked = parseInt(localStorage.getItem(UNLOCK_KEY) || "0", 10) || 0; }
    catch (e) { maxUnlocked = 0; }
  }
  function saveBest() { try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {} }
  function saveUnlocked() { try { localStorage.setItem(UNLOCK_KEY, String(maxUnlocked)); } catch (e) {} }

  function clearEntities() {
    if (!entities) { entities = []; return; }
    for (var i = 0; i < entities.length; i++) scene.remove(entities[i].mesh);
    entities = [];
  }

  function startLevel(idx) {
    currentLevel = idx;
    var cfg = LEVELS[idx];
    clearEntities();
    if (boss) { scene.remove(boss.mesh); boss = null; }
    bossPhase = false;
    distance = 0;
    score = (typeof score === "number") ? score : 0;
    lives = 3; // 与 HUD 的 3 格血量、howto 文案「共 3 条」保持一致，消除隐形命
    combo = 0;
    actionScore = (typeof actionScore === "number") ? actionScore : 0; // 跨关卡累计的操作分
    mergeBump = -1;
    cinematic = false; cinemaTimer = 0; cinemaKind = "";
    player.value = 2; player.lane = 1; player.x = laneX[1];
    player.mesh.position.set(player.x, 0, playerZ);
    player.mesh.rotation.set(0, 0, 0);
    player.mesh.scale.set(1, 1, 1);
    player.mesh.visible = true;
    playerBlinkT = 2 + Math.random() * 2; // 开场缓一缓再眨眼
    playerBlinkLeft = 0;
    if (playerShadow) {
      playerShadow.position.x = laneX[1];
      playerShadow.scale.set(2.1, 2.1 * 0.55, 1);
      playerShadow.visible = true;
    }
    refreshPlayerVisual();
    gameClock = 0; spawnTimer = 1.1;
    shieldEnd = 0; invincibleEnd = 0; shrinkEnd = 0; slipEnd = 0; warpTimer = 0;
    if (warpOverlay) { warpOverlay.style.opacity = "0"; warpOverlay.style.background = ORIG_WARP_BG; }
    boostActive = false;
    var bReset = document.getElementById("boostBar");
    if (bReset) { bReset.classList.add("hidden"); bReset.classList.remove("warn"); }
    if (camera) { camera.fov = 60; camera.updateProjectionMatrix(); }
    speedMul = 1; shake = 0;
    hide("bossBar");
    state = STATE.PLAY;
    hide("startScreen"); hide("levelScreen"); hide("pauseScreen");
    hide("gameoverScreen"); hide("victoryScreen");
    show("hud");
    document.getElementById("levelName").textContent = cfg.name;
    updateLives();
    audio.resume(); audio.sfx("start"); audio.startBGM();
    toast(cfg.name, 1100);
  }

  function levelSpeed() {
    var cfg = LEVELS[currentLevel];
    return cfg.speed + Math.min(distance * 0.008, 6);
  }

  // ---------- 生成波次 ----------
  function decoyValue() {
    var cands = [];
    for (var v = 2; v <= player.value * 2; v *= 2) if (v !== player.value) cands.push(v);
    if (!cands.length) cands.push(2);
    return cands[Math.floor(Math.random() * cands.length)];
  }
  function spawnRow() {
    var target = Math.floor(Math.random() * LANES);
    entities.push(makeNum(target, player.value)); // 保证一条可合并的道
    var oc = Math.min(0.10 + distance * 0.00003, 0.22);
    for (var i = 0; i < LANES; i++) {
      if (i === target) continue;
      var r = Math.random();
      if (r < oc) entities.push(makeBomb(i));
      else if (r < oc + 0.16) entities.push(makeNum(i, decoyValue()));
      else if (r < oc + 0.24) entities.push(makeBanana(i));
      else if (r < oc + 0.28) entities.push(makeShrink(i));
      else if (r < oc + 0.315 && currentLevel >= 1) entities.push(makePortal(i));
      // 其余留空
    }
    if (currentLevel >= 1 && Math.random() < 0.025) entities.push(makePendulum(target));
    if (Math.random() < 0.04) entities.push(makeShrink((target + 1) % LANES));
  }

  function spawnBossAttack(cfg) {
    // 保证一波里有一个可合并的数字（用于累积伤害打 Boss），与攻击分开放不同车道
    var numLane = Math.floor(Math.random() * LANES);
    entities.push(makeNum(numLane, player.value));
    var atkLane = (numLane + 1 + Math.floor(Math.random() * (LANES - 1))) % LANES;
    var t = cfg.attacks[Math.floor(Math.random() * cfg.attacks.length)];
    if (t === "pendulum") entities.push(makePendulum(atkLane));
    else if (t === "portal") entities.push(makePortal(atkLane));
    else if (t === "banana") entities.push(makeBanana(atkLane));
    else entities.push(makeBomb(atkLane));
    // 偶尔给一颗变小药水，便于躲摆锤
    if (Math.random() < 0.3) entities.push(makeShrink((atkLane + 1) % LANES));
  }

  // ---------- 更新 ----------
  function update(dt) {
    gameClock += dt;
    // 终局演出：世界继续向前滑行，但不刷怪、不判定、不计分；金色闪屏淡出后切胜利
    if (cinematic) {
      cinemaTimer -= dt;
      if (cinemaKind === "victory") {
        // 通关演出：世界继续向前滑行，金色闪屏淡出，结束切 victory()
        var cSpd = levelSpeed();
        distance += cSpd * dt;
        scrollWorld(cSpd * dt);
        var txV = laneX[player.lane];
        player.x += (txV - player.x) * Math.min(1, dt * 14);
        player.mesh.position.x = player.x;
        if (warpOverlay && warpOverlay.style.opacity !== "0") {
          var opV = parseFloat(warpOverlay.style.opacity) - dt * 0.45;
          warpOverlay.style.opacity = (opV < 0 ? 0 : opV).toFixed(2);
        }
        updateHUD();
        if (cinemaTimer <= 0) { cinematic = false; restoreWarpBg(); victory(); }
        return;
      }
      // 死亡演出：世界惯性缓停 + 玩家倒下 + 红屏淡出，结束切 gameOver()
      var dSpd = levelSpeed() * Math.max(0, cinemaTimer) / DEATH_DUR;
      distance += dSpd * dt;
      scrollWorld(dSpd * dt);
      var txD = laneX[player.lane];
      player.x += (txD - player.x) * Math.min(1, dt * 14);
      player.mesh.position.x = player.x;
      var dp = 1 - Math.max(0, cinemaTimer) / DEATH_DUR; // 0→1 演出进度
      player.mesh.rotation.z = dp * 1.5;        // 翻倒
      player.mesh.position.y = -dp * 1.4;       // 沉下去
      var dsc = 1 - dp * 0.4; player.mesh.scale.set(dsc, dsc, dsc); // 缩小
      if (warpOverlay && warpOverlay.style.opacity !== "0") {
        var opD = parseFloat(warpOverlay.style.opacity) - dt * 0.5;
        warpOverlay.style.opacity = (opD < 0 ? 0 : opD).toFixed(2);
      }
      // 死亡瞬间一震（cinematic 分支跳过了主循环里的 shake 应用，这里手动做）
      shake = Math.max(0, shake - dt * 0.6);
      camera.position.x = (Math.random() - 0.5) * shake * 2;
      camera.position.y = 3.4 + (Math.random() - 0.5) * shake * 2;
      updateHUD();
      if (cinemaTimer <= 0) { cinematic = false; restoreWarpBg(); gameOver(); }
      return;
    }
    var warping = warpTimer > 0;
    if (warping) warpTimer -= dt;
    var spd = levelSpeed() * (gameClock < slipEnd ? 0.45 : 1) * (warping ? 3.2 : 1);
    // 传送动画：镜头拉宽 + 全屏闪光 + 跑道发光 + HUD 加速条，让「加速何时结束」清晰可见
    if (warping) {
      camera.fov = 74; camera.updateProjectionMatrix();
      var wp = 1 - warpTimer / 0.85;
      if (warpOverlay) warpOverlay.style.opacity = (Math.sin(wp * Math.PI) * 0.6).toFixed(2);
      if (groundMat) groundMat.emissive.setHex(0x2a3a8a); // 跑道被「传送能量」点亮
      var bp = Math.max(0, warpTimer / 0.85); // 剩余比例 1→0
      var bEl = document.getElementById("boostBar");
      if (bEl) {
        bEl.classList.remove("hidden");
        document.getElementById("boostFill").style.width = (bp * 100).toFixed(1) + "%";
        if (warpTimer < 0.25) bEl.classList.add("warn"); else bEl.classList.remove("warn");
      }
      boostActive = true;
      // TA：加速速度线 —— 屏幕上方随机拉出的向下短光痕，强化「世界在飞掠」
      if (fx) fx.emit(W * 0.5, H * 0.18, dt, {
        rate: 70, angle: Math.PI / 2, spread: 0.35,
        speed: [520, 900], size: [2, 4], life: [0.22, 0.4],
        colors: ["#7fe9ff", "#ffffff", "#9f7fff"], shapes: ["spark"],
        g: 0, drag: 0.5, shrink: false, jitter: [W * 0.5, H * 0.16]
      });
    } else {
      if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
      if (warpOverlay && warpOverlay.style.opacity !== "0") warpOverlay.style.opacity = "0";
      if (groundMat) groundMat.emissive.setHex(0x000000);
      if (boostActive) { // 加速刚结束：收起 HUD 条并提示，明确「已回到常速」
        boostActive = false;
        var bEl2 = document.getElementById("boostBar");
        if (bEl2) bEl2.classList.add("hidden");
        toast("加速结束", 700);
      }
    }
    distance += spd * dt;

    // 地面 + 两侧光球滚动（统一入口，演出与主循环共用）
    scrollWorld(spd * dt);

    // 玩家横向平滑移动 + 缩小/光环
    var tx = laneX[player.lane];
    player.x += (tx - player.x) * Math.min(1, dt * 14);
    player.mesh.position.x = player.x;
    var shrunk = gameClock < shrinkEnd;
    var bump = 1;
    if (gameClock - mergeBump < 0.18) bump = 1 + 0.25 * (1 - (gameClock - mergeBump) / 0.18);
    var sc = (shrunk ? 0.5 : 1) * bump;
    player.mesh.scale.set(sc, sc, sc);
    var shield = gameClock < shieldEnd, inv = gameClock < invincibleEnd;
    player.ring.visible = shield || inv;
    if (shield) { player.ringMat.color.set(0x36c6d3); player.ringMat.opacity = 0.7 + 0.2 * Math.sin(gameClock * 8); }
    else if (inv) { player.ringMat.color.set(0xffd93d); player.ringMat.opacity = 0.7 + 0.2 * Math.sin(gameClock * 10); }

    // 跑动演出：小腿交替摆 + 身体微颠 + 天线尖端呼吸。
    // 死亡/通关演出在 cinematic 分支里自管（玩家正在倒下，不掺和）。
    var runF = gameClock * 13;
    player.feet[0].rotation.x = Math.sin(runF) * 0.55;
    player.feet[1].rotation.x = -Math.sin(runF) * 0.55;
    player.body.position.y = Math.abs(Math.sin(runF)) * 0.05;
    player.tip.scale.setScalar(1 + 0.2 * Math.sin(gameClock * 6));
    if (playerShadow) {
      playerShadow.position.x = player.x;
      playerShadow.scale.set(2.1 * sc, 2.1 * sc * 0.55, 1);
    }
    // 眨眼：面牌在「睁眼/闭眼」贴图间切换（贴图级，无额外 draw call）
    if (playerBlinkLeft > 0) {
      playerBlinkLeft -= dt;
      if (playerBlinkLeft <= 0) setPlayerFace(false);
    } else {
      playerBlinkT -= dt;
      if (playerBlinkT <= 0) {
        setPlayerFace(true);
        playerBlinkLeft = 0.12;
        playerBlinkT = 2.4 + Math.random() * 2.4;
      }
    }

    // 生成：Boss 战只由攻击波驱动，避免与常规波次叠加导致拥挤
    if (bossPhase) {
      bossAttackTimer -= dt;
      if (bossAttackTimer <= 0) {
        spawnBossAttack(BOSSCFG[LEVELS[currentLevel].boss]);
        bossAttackTimer = 2.3;
      }
    } else {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnRow();
        spawnTimer = Math.max(1.0 - distance * 0.00015, 0.55);
      }
    }

    // 移动 / 碰撞
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      e.z += spd * dt;
      e.spin += dt;
      if (e.type === "pendulum") {
        e.phase += dt * 2.4;
        e.x = Math.sin(e.phase) * e.amp;
        e.mesh.position.x = e.x;
        e.mesh.rotation.z = Math.sin(e.phase) * 0.5;
      }
      e.mesh.position.z = e.z;
      // 悬浮呼吸 / 引线火花 / 门环差速 / 气泡上升：全部由 e.spin 与 gameClock 推导，
      // 不引入新随机源（弱机上轨迹可复现，截图与测试才稳）
      if (e.fly) e.fly.position.y = Math.sin(e.spin * 2.2) * 0.07;
      if (e.spark) e.spark.scale.setScalar(0.5 + 0.4 * Math.abs(Math.sin(e.spin * 22)));
      if (e.rings) {
        for (var ri = 0; ri < e.rings.length; ri++) e.rings[ri].m.rotation.z += dt * e.rings[ri].sp;
      }
      if (e.bubbles) {
        for (var bi = 0; bi < e.bubbles.length; bi++) {
          var bub = e.bubbles[bi];
          bub.position.y = 0.45 + ((gameClock * 0.35 + bub.userData.off) % 1) * 0.6;
          bub.position.x = Math.sin(gameClock * 3 + bub.userData.off * 6) * 0.1;
        }
      }
      if (e.model) {
        if (e.type === "portal") e.model.rotation.z += dt * 3;
        else if (e.type === "shrink") e.model.rotation.y += dt * 2;
        else if (e.type === "banana") e.model.rotation.z = Math.sin(e.spin * 2.5) * 0.3; // 平面内轻轻摇晃，像浮着的香蕉
        else e.model.rotation.y += dt * 1.2;
      }

      if (!e.hit && e.z >= playerZ - 1.1 && e.z <= playerZ + 1.4) {
        if (e.type === "pendulum") {
          if (Math.abs(player.x - e.x) < 1.05 && !shrunk && !inv && gameClock >= shieldEnd) {
            e.hit = true; resolveHit(e);
          } else if (Math.abs(player.x - e.x) < 1.05 && shrunk) {
            // 缩小成功躲过（不触发）
          }
        } else if (e.lane === player.lane) {
          e.hit = true; resolveHit(e);
        }
      }
      if (e.z > despawnZ) e.dead = true;
    }
    // 清理
    var kept = [];
    for (var j = 0; j < entities.length; j++) {
      if (entities[j].dead) scene.remove(entities[j].mesh);
      else kept.push(entities[j]);
    }
    entities = kept;

    // 真实分数 = 距离基线 + 操作分（合并加分 / 惩罚扣分 / 奖励）；操作分永久生效，不再被距离覆盖
    score = Math.max(0, Math.floor(distance / 6) + actionScore);

    // Boss 阶段 / 过关判定
    if (bossPhase) {
      animateBoss(dt);
    } else if (distance >= LEVELS[currentLevel].dist && LEVELS[currentLevel].boss) {
      enterBossPhase();
    } else if (distance >= LEVELS[currentLevel].dist && !LEVELS[currentLevel].boss) {
      levelClear();
    }

    updateHUD();
  }

  // 实体身上一点的屏幕坐标（数字块/炸弹中心略偏上）
  function entPos(e) { return project(e.x, ENT_Y + 0.6, e.z); }

  function resolveHit(e) {
    if (e.type === "shield") { shieldEnd = gameClock + 6; audio.sfx("shield"); toast("护盾!", 700); return; }
    if (e.type === "shrink") {
      shrinkEnd = gameClock + 5; audio.sfx("shrink"); toast("变小! 可躲摆锤", 900);
      // TA：药水生效 —— 绿色四角星从身上散开
      if (fx) {
        var sp = entPos(e);
        if (sp) fx.burst(sp.x, sp.y, {
          count: 12, colors: ["#3ad17e", "#bff5d6", "#ffffff"],
          shapes: ["spark4", "dot"], speed: [60, 190], size: [2.5, 5], life: [0.4, 0.75], g: 240
        });
      }
      return;
    }
    if (e.type === "portal") {
      audio.sfx("portal");
      invincibleEnd = gameClock + 1.9;
      // 触发“传送”动画：冲刺加速 + 镜头拉伸 + 全屏闪光，世界快速掠过而非瞬移坐标
      if (warpTimer <= 0) warpTimer = 0.85;
      actionScore += 120;
      toast("传送! +120", 900);
      // TA：传送门吸入 —— 青紫色的菱形/星光向玩家收拢
      if (fx) {
        var pp = project(player.x, ENT_Y + 0.6, playerZ);
        if (pp) {
          fx.burst(pp.x, pp.y, {
            count: 20, colors: ["#59e0ff", "#7a5cff", "#ffffff"],
            shapes: ["diamond", "spark4", "dot"],
            speed: [70, 230], size: [2.5, 6], life: [0.4, 0.8], g: 0, drag: 1.8
          });
          fx.ring(pp.x, pp.y, { color: "#59e0ff", r0: 12, r1: 90, life: 0.5, lw: 4 });
          fx.glow(pp.x, pp.y, { color: "#59e0ff", r0: 16, r1: 64, life: 0.55, alpha: 0.9 });
        }
      }
      return;
    }
      if (e.type === "banana") {
      slipEnd = gameClock + 1.4;
      actionScore = Math.max(actionScore - 40, -Math.floor(distance / 6));
      audio.sfx("banana");
      toast("滑倒! -40", 900);
      // TA：打滑 —— 脚下黄色碎屑向两侧溅开
      if (fx) {
        var fp = project(player.x, ENT_Y * 0.5, playerZ);
        if (fp) fx.burst(fp.x, fp.y, {
          count: 10, colors: ["#f6d23a", "#ffffff"], shapes: ["dot"],
          speed: [50, 160], size: [2, 4], life: [0.3, 0.6], g: 380, angle: -Math.PI / 2, spread: 1.4
        });
      }
      return;
    }
    var safe = gameClock < shieldEnd || gameClock < invincibleEnd;
    if (e.type === "num") {
      if (e.value === player.value) { doMerge(); }
      else if (!safe) {
        combo = 0; audio.sfx("wrong"); toast("数字不符 -15", 700); actionScore = Math.max(actionScore - 15, -Math.floor(distance / 6));
        // TA：撞错数字 —— 少量红色碎屑（轻惩罚不吓人）
        if (fx) {
          var wp = entPos(e);
          if (wp) fx.burst(wp.x, wp.y, {
            count: 6, colors: ["#e5484d"], shapes: ["dot"],
            speed: [40, 140], size: [2, 4], life: [0.3, 0.55], g: 320
          });
        }
      }
    } else if (e.type === "bomb") {
      if (safe) return;
      combo = 0; audio.sfx("hit"); toast("炸弹!", 700); shake = 0.35; loseLife();
      // TA：炸弹 —— 橙黄火花炸开
      if (fx) {
        var bp = entPos(e);
        if (bp) fx.burst(bp.x, bp.y, {
          count: 18, colors: ["#ff8c42", "#ffd166", "#ffffff"],
          shapes: ["spark", "dot"], speed: [120, 320], size: [2.5, 6], life: [0.35, 0.7], g: 300
        });
      }
    } else if (e.type === "pendulum") {
      if (safe) return;
      combo = 0; audio.sfx("pendulum"); toast("被摆锤击中!", 800); shake = 0.4; loseLife();
      // TA：被摆锤砸中 —— 红色重击粒子
      if (fx) {
        var kp = project(player.x, ENT_Y + 0.4, playerZ);
        if (kp) fx.burst(kp.x, kp.y, {
          count: 14, colors: ["#c0392b", "#ff8fa3", "#ffffff"],
          shapes: ["dot", "spark"], speed: [90, 260], size: [2.5, 6], life: [0.35, 0.7], g: 340
        });
      }
    }
  }

  function doMerge() {
    var gained = player.value + combo * 2;
    actionScore += gained;
    combo++;
    var prevColor = valueColor(player.value);
    player.value *= 2;
    refreshPlayerVisual();
    audio.sfx("merge");
    mergeBump = gameClock;
    // TA：合并反馈 —— 旧值色粒子在玩家身上炸开 + 新值色扩散环 + 飘字。
    // 3D 场景景深大、粒子显小，参数比 2D 游戏大一档（count/size 上调）才够「炸」。
    if (fx) {
      var pp = project(player.x, ENT_Y + 0.6, playerZ);
      if (pp) {
        fx.burst(pp.x, pp.y, {
          count: combo >= 2 ? 30 : 20,
          colors: [prevColor, "#ffd166", "#ffffff"],
          shapes: ["star", "diamond", "dot"],
          speed: [110, 320], size: [4, 9], life: [0.55, 1.05], g: 300
        });
        fx.ring(pp.x, pp.y, { color: valueColor(player.value), r0: 12, r1: 80, life: 0.5, lw: 5 });
        fx.glow(pp.x, pp.y, { color: "#ffd166", r0: 16, r1: 72, life: 0.55, alpha: 0.95 });
        fx.float(pp.x, pp.y - 36, "+" + gained, { color: "#ffd166", size: 28 });
      }
      if (bossPhase && boss) {
        // Boss 战合并即伤害：Boss 身上同步迸出受击火花
        var bp = project(boss.mesh.position.x, 2.5, boss.mesh.position.z);
        if (bp) fx.burst(bp.x, bp.y, {
          count: 12, colors: ["#ff5d5d", "#ffd166", "#ffffff"],
          shapes: ["spark", "dot"], speed: [100, 280], size: [2.5, 5.5], life: [0.35, 0.7], g: 260
        });
      }
    }
    if (combo >= 2) {
      var ct = document.getElementById("comboTag");
      ct.textContent = "连击 x" + combo + "!";
      ct.classList.remove("hidden");
    }
    if (bossPhase && boss) {
      // 连击放大对 Boss 的伤害：每多 1 连击 +50%，奖励无伤连击
      var dmg = player.value * (1 + (combo - 1) * 0.5);
      bossHP -= dmg;
      updateBossBar();
      pulseBoss();
      if (bossHP <= 0) bossDefeated();
    }
  }

  function loseLife() {
    lives--;
    updateLives();
    if (lives <= 0) startDeathSeq();
  }
  // 死亡演出入口：不再硬切 gameoverScreen，而是先放一段「倒下」演出
  function startDeathSeq() {
    cinematic = true; cinemaKind = "death"; cinemaTimer = DEATH_DUR; // [PLACEHOLDER · 待 playtest] 时长见 DEATH_DUR
    clearEntities();
    shake = 0.5;
    audio.stopBGM(); audio.sfx("over");
    flashRed();
    toast("游戏结束", 1400);
  }

  // ---------- Boss ----------
  function enterBossPhase() {
    bossPhase = true;
    var key = LEVELS[currentLevel].boss;
    var cfg = BOSSCFG[key];
    bossMaxHP = Math.max(1, Math.round(player.value * cfg.hpMul)); bossHP = bossMaxHP;
    document.getElementById("bossName").textContent = cfg.name;
    updateBossBar();
    show("bossBar");
    audio.sfx("boss");
    toast(cfg.name + " 出现了!", 1300);
    buildBossMesh(cfg);
    bossAttackTimer = 1.6;
    // 清掉场上普通障碍，给玩家喘息
    for (var i = 0; i < entities.length; i++) scene.remove(entities[i].mesh);
    entities = [];
  }
  function buildBossMesh(cfg) {
    var grp = new THREE.Group();
    var bodyMat = new THREE.MeshLambertMaterial({ color: cfg.color });
    if (LEVELS[currentLevel].boss === "pendulum") {
      // 摆锤魔：核心魔球（尖刺 + 犄角 + 怒目）+ 三只轨道摆锤
      var core = new THREE.Mesh(geo("boss-p-core", function () { return new THREE.SphereGeometry(2.0, 22, 18); }), bodyMat);
      core.position.y = 3.0; grp.add(core);
      grp.add(outlineOf(core, 0x3d1420, 1.05));
      // 球面尖刺：深色小锥绕核心一周，轮廓带刺
      var spike = new THREE.Mesh(geo("boss-p-spike", function () { return new THREE.ConeGeometry(0.2, 0.75, 7); }),
        mat("boss-p-spike", function () { return new THREE.MeshLambertMaterial({ color: 0x4a1622 }); }));
      for (var s = 0; s < 6; s++) {
        var ang = s * 1.05 + 0.4;
        var sp2 = new THREE.Mesh(spike.geometry, spike.material);
        sp2.position.set(Math.cos(ang) * 1.55, 3.0 + 1.45, Math.sin(ang) * 1.0);
        sp2.rotation.z = -Math.cos(ang) * 0.5;
        sp2.rotation.x = Math.sin(ang) * 0.5;
        grp.add(sp2);
      }
      // 犄角：头顶三根大锥
      for (var hn = 0; hn < 3; hn++) {
        var ha = hn * 2.094 + 0.5;
        var horn = new THREE.Mesh(geo("boss-p-horn", function () { return new THREE.ConeGeometry(0.26, 1.0, 8); }),
          mat("boss-p-horn", function () { return new THREE.MeshLambertMaterial({ color: 0x6e2233 }); }));
        horn.position.set(Math.cos(ha) * 0.95, 4.85, Math.sin(ha) * 0.6);
        horn.rotation.z = -Math.cos(ha) * 0.45;
        horn.rotation.x = Math.sin(ha) * 0.45;
        grp.add(horn);
      }
      // 怒目：两颗亮黄发光球（animateBoss 里脉冲）——红躯干上红眼会糊，必须高对比
      var eyes = [];
      for (var ey = 0; ey < 2; ey++) {
        var eye = new THREE.Mesh(geo("boss-p-eye", function () { return new THREE.SphereGeometry(0.32, 12, 10); }),
          mat("boss-p-eye", function () { return new THREE.MeshBasicMaterial({ color: 0xffe066 }); }));
        eye.position.set(ey === 0 ? -0.75 : 0.75, 3.52, 1.83); // 球心距 2.05 ≈ 半径 2.0，眼球探出一截才看得见
        grp.add(eye); eyes.push(eye);
      }
      grp.userData.eyes = eyes;
      // 三只轨道摆锤：臂 + 链 + 锤头，绕核心差速公转
      var arms = [];
      for (var a = 0; a < 3; a++) {
        var arm = new THREE.Group();
        var chain = new THREE.Mesh(geo("boss-p-chain", function () { return new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6); }),
          mat("boss-p-chain", function () { return new THREE.MeshLambertMaterial({ color: 0x6a7180 }); }));
        chain.rotation.z = Math.PI / 2; chain.position.x = 2.2;
        arm.add(chain);
        var ham = new THREE.Mesh(geo("boss-p-ham", function () { return new THREE.IcosahedronGeometry(0.85, 0); }),
          mat("boss-p-ham", function () {
            return new THREE.MeshPhongMaterial({ color: 0xc0392b, shininess: 50, specular: 0x886655, flatShading: true });
          }));
        ham.position.x = 4.3;
        arm.add(ham);
        var hamBand = new THREE.Mesh(geo("pend-band", function () { return new THREE.TorusGeometry(0.52, 0.09, 6, 16); }),
          mat("pend-band", function () { return new THREE.MeshPhongMaterial({ color: 0x77211a, shininess: 70, specular: 0xaa9977 }); }));
        hamBand.position.x = 4.3; hamBand.rotation.y = Math.PI / 2;
        arm.add(hamBand);
        arm.position.y = 3.0;
        arm.rotation.y = a * 2.094;
        arm.userData.sp = 0.5 + a * 0.14;
        grp.add(arm);
        arms.push(arm);
      }
      grp.userData.arms = arms;
    } else if (LEVELS[currentLevel].boss === "portal") {
      // 传送门法师：符文塔 + 双符环 + 环绕碎片 + 顶端晶石
      var tower = new THREE.Mesh(geo("boss-m-tower", function () { return new THREE.CylinderGeometry(1.3, 1.8, 4.4, 14); }), bodyMat);
      tower.position.y = 2.4; grp.add(tower);
      grp.add(outlineOf(tower, 0x241a4d, 1.04));
      var ring = new THREE.Mesh(geo("boss-m-ring1", function () { return new THREE.TorusGeometry(1.75, 0.22, 12, 30); }),
        mat("boss-m-ring1", function () { return new THREE.MeshBasicMaterial({ color: 0x59e0ff }); }));
      ring.position.y = 2.6; ring.rotation.x = Math.PI / 2; grp.add(ring);
      grp.userData.spinRing = ring;
      var ring2 = new THREE.Mesh(geo("boss-m-ring2", function () { return new THREE.TorusGeometry(2.05, 0.13, 10, 30); }),
        mat("boss-m-ring2", function () { return new THREE.MeshBasicMaterial({ color: 0x7a5cff }); }));
      ring2.position.y = 1.9; ring2.rotation.x = Math.PI / 2 - 0.35; grp.add(ring2);
      // 塔身正面一颗「法眼」
      var mEye = new THREE.Mesh(geo("boss-m-eye", function () { return new THREE.SphereGeometry(0.36, 12, 10); }),
        mat("boss-m-eye", function () { return new THREE.MeshBasicMaterial({ color: 0x9ff2ff }); }));
      mEye.position.set(0, 2.8, 1.68); // 塔身该高度半径约 1.7，眼睛突出半截
      grp.add(mEye);
      grp.userData.eyes = [mEye];
      // 顶端晶石 + 光晕
      var crystal = new THREE.Mesh(geo("boss-m-crystal", function () { return new THREE.OctahedronGeometry(0.55, 0); }),
        mat("boss-m-crystal", function () { return new THREE.MeshBasicMaterial({ color: 0xd6f7ff }); }));
      crystal.position.y = 5.1;
      grp.add(crystal);
      var halo = glowSprite(0x59e0ff, 2.6, 0.55);
      halo.position.y = 5.1;
      grp.add(halo);
      // 环绕碎片：四枚小八面体差速公转（animateBoss 里驱动）
      var orbit = [];
      for (var o = 0; o < 4; o++) {
        var shard = new THREE.Mesh(geo("boss-m-shard", function () { return new THREE.OctahedronGeometry(0.3, 0); }),
          mat("boss-m-shard", function () {
            return new THREE.MeshPhongMaterial({ color: 0x8f7bff, shininess: 70, specular: 0xffffff, flatShading: true });
          }));
        grp.add(shard);
        orbit.push({ m: shard, r: 2.7 + (o % 2) * 0.5, y: 2.2 + (o % 3) * 0.9, a: o * 1.57, sp: 0.7 + o * 0.18 });
      }
      grp.userData.orbit = orbit;
    } else {
      // 数字泰坦：圆角躯干 + 胸甲铆钉 + 双怒目 + 倒八眉 + 肩甲 + 巨拳
      var tit = new THREE.Mesh(geo("boss-t-body", function () { return roundedBoxGeo(3.2, 3.4, 2.8, 0.55, 4); }), bodyMat);
      tit.position.y = 2.3; grp.add(tit);
      grp.add(outlineOf(tit, 0x5a2410, 1.04));
      // 胸甲：略大的深色圆角片 + 四颗亮铆钉
      var armor = new THREE.Mesh(geo("boss-t-armor", function () { return roundedBoxGeo(2.2, 2.4, 0.5, 0.3, 3); }),
        mat("boss-t-armor", function () { return new THREE.MeshLambertMaterial({ color: 0xd96b28 }); }));
      armor.position.set(0, 2.5, 1.35);
      grp.add(armor);
      var bolts = [[-0.8, 3.3], [0.8, 3.3], [-0.8, 1.7], [0.8, 1.7]];
      for (var bt = 0; bt < bolts.length; bt++) {
        var bolt = new THREE.Mesh(geo("boss-t-bolt", function () { return new THREE.SphereGeometry(0.12, 8, 6); }),
          mat("boss-t-bolt", function () { return new THREE.MeshPhongMaterial({ color: 0xffd9a0, shininess: 90, specular: 0xffffff }); }));
        bolt.position.set(bolts[bt][0], bolts[bt][1], 1.62);
        grp.add(bolt);
      }
      // 怒目 + 倒八眉
      var tEyes = [];
      for (var te = 0; te < 2; te++) {
        var tEye = new THREE.Mesh(geo("boss-t-eye", function () { return new THREE.SphereGeometry(0.34, 12, 10); }),
          mat("boss-t-eye", function () { return new THREE.MeshBasicMaterial({ color: 0xfff2a8 }); }));
        tEye.position.set(te === 0 ? -0.72 : 0.72, 3.1, 1.52);
        grp.add(tEye); tEyes.push(tEye);
        var brow = new THREE.Mesh(geo("boss-t-brow", function () { return new THREE.BoxGeometry(0.9, 0.16, 0.3); }),
          mat("boss-t-brow", function () { return new THREE.MeshLambertMaterial({ color: 0x8a3c12 }); }));
        brow.position.set(tEye.position.x, 3.55, 1.5);
        brow.rotation.z = te === 0 ? 0.35 : -0.35; // 倒八眉，越怒
        grp.add(brow);
      }
      grp.userData.eyes = tEyes;
      // 肩甲 + 巨拳
      for (var pd = 0; pd < 2; pd++) {
        var pad = new THREE.Mesh(geo("boss-t-pad", function () { return new THREE.SphereGeometry(0.85, 14, 10); }),
          mat("boss-t-pad", function () { return new THREE.MeshLambertMaterial({ color: 0xe07a2e }); }));
        pad.position.set(pd === 0 ? -1.95 : 1.95, 3.5, 0);
        grp.add(pad);
        var fist = new THREE.Mesh(geo("boss-t-fist", function () { return new THREE.SphereGeometry(0.62, 12, 10); }),
          mat("boss-t-fist", function () { return new THREE.MeshLambertMaterial({ color: 0xc85a1e }); }));
        fist.position.set(pd === 0 ? -2.15 : 2.15, 1.5, 0.35);
        grp.add(fist);
      }
    }
    // 拉近 + 放大：Boss 是关卡高潮，站在 -30 外只有一小团（实测截图确认存在感不足）
    grp.scale.set(1.6, 1.6, 1.6);
    grp.position.set(0, 0, -20);
    scene.add(grp);
    boss = { mesh: grp, baseY: 0, t: 0, key: LEVELS[currentLevel].boss, baseScale: 1.6 };
  }
  function animateBoss(dt) {
    if (!boss) return;
    boss.t += dt;
    boss.mesh.position.y = Math.sin(boss.t * 1.5) * 0.4;
    boss.mesh.rotation.y += dt * 0.6;
    if (boss.mesh.userData.spinRing) boss.mesh.userData.spinRing.rotation.z += dt * 2;
    // 摆锤魔：三只轨道摆锤差速公转
    if (boss.mesh.userData.arms) {
      var arms = boss.mesh.userData.arms;
      for (var i = 0; i < arms.length; i++) arms[i].rotation.y += dt * arms[i].userData.sp;
    }
    // 法师：环绕碎片公转 + 上下浮沉
    if (boss.mesh.userData.orbit) {
      var orb = boss.mesh.userData.orbit;
      for (var j = 0; j < orb.length; j++) {
        var o = orb[j];
        o.a += dt * o.sp;
        o.m.position.set(Math.cos(o.a) * o.r, o.y + Math.sin(o.a * 2) * 0.35, Math.sin(o.a) * o.r);
        o.m.rotation.x += dt * 1.5; o.m.rotation.y += dt * 2;
      }
    }
    // 双目/法眼怒光脉冲（受击时另有整体 scale 脉冲，见 pulseBoss）
    if (boss.mesh.userData.eyes) {
      var eyes = boss.mesh.userData.eyes;
      var pulse = 1 + 0.15 * Math.sin(boss.t * 5);
      for (var k = 0; k < eyes.length; k++) eyes[k].scale.setScalar(pulse);
    }
  }
  function pulseBoss() {
    if (boss) boss.mesh.scale.setScalar((boss.baseScale || 1) * 1.12);
  }
  function bossDefeated() {
    audio.sfx("levelup");
    // TA：击败 Boss —— 全屏彩纸（终局另有金色闪屏+演出，彩纸会在演出期间继续下落）
    if (fx) fx.confetti({ count: 90, x0: 0, x1: W, w: W });
    var isFinal = currentLevel >= LEVELS.length - 1;
    var name = BOSSCFG[LEVELS[currentLevel].boss].name;
    hide("bossBar");
    if (boss) { scene.remove(boss.mesh); boss = null; }
    bossPhase = false;
    if (isFinal) {
      // 终局：清场 + 金色闪屏 + 2.2s 演出，再切胜利界面，避免硬切
      clearEntities();
      cinematic = true; cinemaTimer = VICTORY_DUR; // 通关演出：延长到 3.0s，避免切胜利太突兀
      audio.sfx("victory");
      flashScreen();
      toast("击败 " + name + "！通关！", 2200);
      return;
    }
    actionScore += 250;
    maxUnlocked = Math.max(maxUnlocked, currentLevel + 1); saveUnlocked();
    toast("击败 " + name + "! 进入下一关", 1500);
    currentLevel++;
    startLevel(currentLevel);
  }
  function levelClear() {
    toast("过关!", 1200);
    if (fx) fx.confetti({ count: 50, x0: 0, x1: W, w: W });   // 彩纸会自然延续到下一关开场
    if (currentLevel >= LEVELS.length - 1) { victory(); return; }
    maxUnlocked = Math.max(maxUnlocked, currentLevel + 1); saveUnlocked();
    currentLevel++;
    startLevel(currentLevel);
  }

  function updateBossBar() {
    var pct = Math.max(0, Math.min(1, bossHP / bossMaxHP));
    document.getElementById("bossFill").style.width = (pct * 100) + "%";
  }

  // ---------- HUD ----------
  function updateLives() {
    var el = document.getElementById("lives");
    var html = "";
    for (var i = 0; i < 3; i++) html += '<span class="pip' + (i < lives ? "" : " off") + '"></span>';
    el.innerHTML = html;
  }
  function updateHUD() {
    document.getElementById("valueText").textContent = player.value;
    document.getElementById("scoreText").textContent = score;
    document.getElementById("bestText").textContent = Math.max(best, score);
    if (combo < 2) document.getElementById("comboTag").classList.add("hidden");
    if (boss) {
      // Boss 受击脉冲衰减回基础缩放（baseScale，见 buildBossMesh）
      var bs = boss.baseScale || 1;
      boss.mesh.scale.x += (bs - boss.mesh.scale.x) * 0.2;
      boss.mesh.scale.y = boss.mesh.scale.z = boss.mesh.scale.x;
    }
  }

  // ---------- 渲染 ----------
  function render() {
    if (!threeOK) return;
    // 命中震屏
    if (shake > 0) {
      shake = Math.max(0, shake - 0.03);
      camera.position.x = (Math.random() - 0.5) * shake * 2;
      camera.position.y = 3.4 + (Math.random() - 0.5) * shake * 2;
    } else {
      camera.position.x = 0; camera.position.y = 3.4;
    }
    camera.lookAt(0, 0.8, -12);
    renderer.render(scene, camera);
    // TA：屏幕空间特效层（环境浮尘 + 粒子/彩纸/飘字），画在 WebGL 之上。
    // 特效坐标仍是 CSS 像素（project() 返回 W×H 空间），由 setTransform 映射到 dpr 背景
    if (fx2 && fx) {
      fx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      fx2.clearRect(0, 0, W, H);
      fx.drawBack(fx2);
      fx.drawFront(fx2);
    }
  }

  // ---------- 主循环 ----------
  var lastT = 0;
  function loop(t) {
    if (!lastT) lastT = t;
    var dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.05) dt = 0.05;
    if (fx) fx.update(dt);   // 特效推进独立于游戏状态（菜单里环境浮尘也要动）
    // boss 受击缩放回弹
    if (state === STATE.PLAY) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- 界面切换 ----------
  function show(id) { var el = document.getElementById(id); if (el) el.classList.remove("hidden"); }
  function hide(id) { var el = document.getElementById(id); if (el) el.classList.add("hidden"); }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, ms || 1000);
  }

  function gotoMenu() {
    state = STATE.MENU;
    audio.stopBGM();
    hide("hud"); hide("pauseScreen"); hide("gameoverScreen");
    hide("victoryScreen"); hide("levelScreen"); hide("bossBar");
    hide("comboTag");
    if (player) player.mesh.visible = false;
    if (playerShadow) playerShadow.visible = false;
    document.getElementById("startBest").textContent = best;
    show("startScreen");
    if (window.TVNav && !window.__tvControlsInjected) TVNav.focusFirst();
  }

  function openLevelSelect() {
    state = STATE.SELECT;
    audio.stopBGM();
    hide("hud"); hide("startScreen"); hide("pauseScreen");
    hide("gameoverScreen"); hide("victoryScreen"); hide("bossBar");
    hide("comboTag");
    if (player) player.mesh.visible = false;
    if (playerShadow) playerShadow.visible = false;
    var grid = document.getElementById("levelGrid");
    grid.innerHTML = "";
    for (var i = 0; i < LEVELS.length; i++) {
      (function (idx) {
        var cfg = LEVELS[idx];
        var btn = document.createElement("div");
        btn.className = "level-btn tv-focus" + (cfg.boss ? " boss" : "") + (idx > maxUnlocked ? " locked" : "");
        btn.setAttribute("data-tv-focus", "");
        btn.setAttribute("data-idx", idx);
        var tag = cfg.boss ? ("Boss: " + BOSSCFG[cfg.boss].name) : "普通关";
        btn.innerHTML = '<div class="lv-no">' + (idx + 1) + '</div>' +
          '<div class="lv-name">' + cfg.name.replace(/^第 \d+ 关 · /, "") + '</div>' +
          '<div class="lv-tag">' + tag + '</div>';
        if (idx <= maxUnlocked) {
          btn.addEventListener("click", function (e) { e.preventDefault(); startLevel(idx); });
        }
        grid.appendChild(btn);
      })(i);
    }
    show("levelScreen");
    // 选关改为「按序号线性导航」：左/上=上一关，右/下=下一关，末尾落到「返回」，
    // 不再依赖空间就近导航（2×2 布局下按右会卡在右边缘）。DOM 焦点由本模块自管。
    levelNav = Array.prototype.slice.call(grid.querySelectorAll(".level-btn"));
    levelNav.push(document.getElementById("btnLevelBack"));
    selNav = Math.min((typeof currentLevel === "number" ? currentLevel : 0), levelNav.length - 1);
    // 用显式 .sel 类做高亮：这些按钮是「无 tabindex 的 div」，WebView 上 .focus() 是空操作，:focus 不触发，
    // 必须手动切类。确认键仍走 levelNav[selNav].click()，与高亮位置一致。
    levelNav.forEach(function (b, i) { b.classList.toggle("sel", i === selNav); });
    if (levelNav[selNav]) { try { levelNav[selNav].focus(); } catch (e) {} }
  }

  function pauseGame() {
    if (state !== STATE.PLAY) return;
    state = STATE.PAUSE;
    audio.stopBGM();
    hide("comboTag");
    show("pauseScreen");
    if (window.TVNav && !window.__tvControlsInjected) TVNav.focusFirst();
  }
  function resumeGame() {
    if (state !== STATE.PAUSE) return;
    state = STATE.PLAY;
    hide("pauseScreen");
    audio.startBGM();
  }

  function gameOver() {
    state = STATE.OVER;
    // 音效与 BGM 停止已在 startDeathSeq（死亡瞬间）触发，这里不再重复，避免双响
    if (score > best) { best = score; saveBest(); }
    document.getElementById("finalScore").textContent = score;
    document.getElementById("bestScore").textContent = best;
    var tip = "";
    if (player.value >= 256) tip = "数字已经合到 " + player.value + " 了，很强！";
    else if (player.value >= 64) tip = "不错，数字合到了 " + player.value + "。";
    else tip = "多吃和自己一样的数字，数字就会翻倍变大。";
    document.getElementById("overTip").textContent = tip;
    hide("hud"); hide("comboTag");
    show("gameoverScreen");
    if (window.TVNav && !window.__tvControlsInjected) TVNav.focusFirst();
  }

  function victory() {
    state = STATE.VICTORY;
    audio.stopBGM(); audio.sfx("victory");
    if (score > best) { best = score; saveBest(); }
    maxUnlocked = LEVELS.length - 1; saveUnlocked();
    var finalName = BOSSCFG[LEVELS[LEVELS.length - 1].boss].name;
    document.getElementById("victoryTip").textContent = "你击败了 " + finalName + "，恭喜通关！";
    document.getElementById("victoryScore").textContent = score;
    hide("hud"); hide("comboTag");
    show("victoryScreen");
    if (window.TVNav && !window.__tvControlsInjected) TVNav.focusFirst();
  }

  // ---------- 输入 ----------
  function moveLane(dir) {
    if (state !== STATE.PLAY || !player) return;
    if (dir === "left") player.lane = Math.max(0, player.lane - 1);
    else if (dir === "right") player.lane = Math.min(LANES - 1, player.lane + 1);
  }

  var lastDirNavT = 0;
  function navLevel(d) {
    if (!levelNav.length) return;
    var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (now - lastDirNavT < 130) return; // 防 WebView 方向键 auto-repeat 连跳多格
    lastDirNavT = now;
    var step = (d === "left" || d === "up") ? -1 : 1;
    var n = selNav + step;
    if (n < 0) n = 0;
    if (n > levelNav.length - 1) n = levelNav.length - 1;
    if (n === selNav) return;
    if (levelNav[selNav]) levelNav[selNav].classList.remove("sel");
    selNav = n;
    if (levelNav[selNav]) { levelNav[selNav].classList.add("sel"); try { levelNav[selNav].focus(); } catch (e) {} }
  }
  var TVInput = window.TVInput;
  if (TVInput) {
    TVInput.on("dir", function (d) {
      if (state === STATE.PLAY) moveLane(d);
      else if (state === STATE.SELECT) navLevel(d); // 选关：按序号线性导航
      else if (window.TVNav && !window.__tvControlsInjected) TVNav.move(d);
    });
    TVInput.on("confirm", function () {
      if (state === STATE.PLAY) return; // 游戏中 OK 不触发顶栏按钮
      if (state === STATE.SELECT) { if (levelNav[selNav]) levelNav[selNav].click(); return; }
      if (window.TVNav && !window.__tvControlsInjected) TVNav.confirm();
    });
    TVInput.on("back", function () { onBack(); });
  }

  var lastBackT = 0;
  function onBack() {
    var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (now - lastBackT < 400) return;
    lastBackT = now;
    if (state === STATE.PLAY) pauseGame();
    else if (state === STATE.PAUSE) openLevelSelect();
    else if (state === STATE.OVER || state === STATE.VICTORY || state === STATE.SELECT) gotoMenu();
  }

  // 鼠标/触屏兜底
  function bindClick(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("click", function (e) { e.preventDefault(); fn(); });
  }
  bindClick("btnStart", openLevelSelect);
  bindClick("btnLevelBack", gotoMenu);
  bindClick("btnResume", resumeGame);
  bindClick("btnRestartPause", function () { score = 0; actionScore = 0; startLevel(currentLevel); });
  bindClick("btnMenuPause", openLevelSelect);
  bindClick("btnMutePause", function () {
    var m = audio.toggleMute();
    document.getElementById("btnMutePause").textContent = m ? "取消静音" : "声音";
  });
  bindClick("btnReplay", function () { score = 0; actionScore = 0; startLevel(currentLevel); });
  bindClick("btnMenu", openLevelSelect);
  bindClick("btnVictoryMenu", openLevelSelect);

  canvas.addEventListener("click", function (e) {
    if (state !== STATE.PLAY) return;
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    if (x < rect.width * 0.4) moveLane("left");
    else if (x > rect.width * 0.6) moveLane("right");
  });

  if ("ontouchstart" in window || (navigator.maxTouchPoints > 0)) {
    document.body.classList.add("is-touch");
  }

  // 返回键 history 陷阱
  if (window.history && window.history.pushState) {
    try { window.history.pushState({ nr: 1 }, ""); } catch (e) {}
    window.addEventListener("popstate", function () { onBack(); });
  }

  // ---------- 启动 ----------
  loadBest();
  if (!initThree()) {
    // WebGL 不可用：只显示降级提示，避免和开始界面叠在一起
    hide("startScreen"); hide("levelScreen"); hide("pauseScreen");
    hide("gameoverScreen"); hide("victoryScreen"); hide("bossBar");
    hide("hud"); hide("comboTag");
    show("nowebgl");
  } else {
    buildPlayer();
    ensureWarpOverlay();
    resize();
    gotoMenu();
    requestAnimationFrame(loop);
  }
})();

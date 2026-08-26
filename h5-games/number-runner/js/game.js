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
    // 车道分隔虚线
    g.fillStyle = "rgba(150,170,210,0.45)";
    for (var d = 0; d < 2; d++) {
      var x = (d + 1) * lw;
      for (var y = 0; y < 512; y += 64) g.fillRect(x - 3, y, 6, 34);
    }
    groundTex = new THREE.CanvasTexture(c);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(1, 9);
    var geo = new THREE.PlaneGeometry(LANE_SP * 3, 78);
    var mat = new THREE.MeshLambertMaterial({ map: groundTex });
    groundMat = mat;
    var ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -22);
    scene.add(ground);

    // 两侧护栏（增强纵深）
    var railMat = new THREE.MeshLambertMaterial({ color: 0x2c3650 });
    for (var s = 0; s < 2; s++) {
      var rg = new THREE.BoxGeometry(0.3, 1.0, 78);
      var rail = new THREE.Mesh(rg, railMat);
      rail.position.set((s === 0 ? -1 : 1) * (LANE_SP * 1.5 + 0.2), 0.5, -22);
      scene.add(rail);
    }
  }

  // ---------- 画布自适应 ----------
  var W = 0, H = 0;
  function resize() {
    var maxW = Math.min(window.innerWidth, 1280);
    var maxH = window.innerHeight;
    W = maxW; H = maxH;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    if (threeOK) {
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }
  }
  window.addEventListener("resize", resize);

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

  // 数字贴图缓存（CanvasTexture，不用 emoji）
  var texCache = {};
  function numTexture(value) {
    if (texCache[value]) return texCache[value];
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
    // 不要背板：彩色描边（保留数值大小的颜色身份）+ 白色填充，深色背景上清晰可见
    g.lineWidth = Math.max(8, Math.round(fs * 0.15));
    g.strokeStyle = valueColor(value);
    g.strokeText(txt, 128, 138);
    g.fillStyle = "#fff";
    g.fillText(txt, 128, 138);
    var t = new THREE.CanvasTexture(c);
    if (renderer) t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    texCache[value] = t;
    return t;
  }

  function makeLabelSprite(text, color, size) {
    var c = document.createElement("canvas");
    c.width = c.height = 256;
    var g = c.getContext("2d");
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
  var player = null;
  function buildPlayer() {
    var grp = new THREE.Group();
    var boxMat = new THREE.MeshLambertMaterial({ color: 0x4c8bf5 });
    var box = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), boxMat);
    box.position.y = ENT_Y;
    grp.add(box);
    var sprite = makeNumSprite(2);
    sprite.position.set(0, ENT_Y, 1.05);
    sprite.scale.set(1.8, 1.8, 1.8);
    grp.add(sprite);
    // 护盾 / 无敌光环
    var ringMat = new THREE.MeshBasicMaterial({ color: 0x36c6d3, transparent: true, opacity: 0.8 });
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 8, 28), ringMat);
    ring.position.y = ENT_Y; ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    grp.add(ring);
    grp.visible = false;
    scene.add(grp);
    player = {
      lane: 1, x: laneX[1], value: 2, mesh: grp, box: box, boxMat: boxMat,
      sprite: sprite, ring: ring, ringMat: ringMat
    };
  }
  function makeNumSprite(value) {
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: numTexture(value), transparent: true, depthWrite: false, depthTest: false }));
    sp.scale.set(1.75, 1.75, 1.75);
    return sp;
  }
  function refreshPlayerVisual() {
    player.boxMat.color.set(valueColor(player.value));
    player.sprite.material.map = numTexture(player.value);
    player.sprite.material.needsUpdate = true;
  }

  // ---------- 实体工厂 ----------
  function makeNum(lane, value) {
    var grp = new THREE.Group();
    var mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(valueColor(value)) });
    var box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), mat);
    box.position.y = ENT_Y;
    grp.add(box);
    var sp = makeNumSprite(value);
    sp.position.set(0, ENT_Y, 0.8);
    grp.add(sp);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return { type: "num", lane: lane, value: value, z: spawnZ, x: laneX[lane], mesh: grp, model: box, hit: false, dead: false, spin: 0 };
  }
  function makeBomb(lane) {
    var grp = new THREE.Group();
    var ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), new THREE.MeshLambertMaterial({ color: 0x2a2a33 }));
    ball.position.y = ENT_Y;
    grp.add(ball);
    var sp = makeLabelSprite("X", "#ff5d5d", 1.6);
    sp.position.set(0, ENT_Y, 0.95);
    grp.add(sp);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return { type: "bomb", lane: lane, z: spawnZ, x: laneX[lane], mesh: grp, model: ball, hit: false, dead: false, spin: Math.random() * 6 };
  }
  function makeBanana(lane) {
    var grp = new THREE.Group();
    // body 作为旋转体（弯月+果柄+尖），标签单独挂在 grp 上不跟着转
    var body = new THREE.Group();
    // 弯月形曲线（XY 平面）：两端上翘、中段下垂，比圆环弧更像真香蕉
    var curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.8, 0.42, 0),
      new THREE.Vector3(-0.42, -0.26, 0),
      new THREE.Vector3(0.0, -0.5, 0),
      new THREE.Vector3(0.42, -0.26, 0),
      new THREE.Vector3(0.8, 0.42, 0)
    ]);
    var geo = new THREE.TubeGeometry(curve, 32, 0.21, 12, false);
    var mat = new THREE.MeshLambertMaterial({ color: 0xf6d23a });
    var tube = new THREE.Mesh(geo, mat);
    body.add(tube);
    // 棕色果柄（一头）
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.32, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b4a1f }));
    stem.position.set(-0.8, 0.6, 0); stem.rotation.z = 0.55;
    body.add(stem);
    // 另一头的深色熟蒂尖
    var tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 6),
      new THREE.MeshLambertMaterial({ color: 0x4a3414 }));
    tip.position.set(0.8, 0.42, 0);
    body.add(tip);
    body.position.y = ENT_Y;
    grp.add(body);
    var tag = makeLabelSprite("蕉", "#e0b400", 1.05);
    tag.position.set(0, ENT_Y + 1.25, 0);
    grp.add(tag);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return { type: "banana", lane: lane, z: spawnZ, x: laneX[lane], mesh: grp, model: body, hit: false, dead: false, spin: 0 };
  }
  function makePortal(lane) {
    var grp = new THREE.Group();
    var pg = new THREE.Group();
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.18, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0x59e0ff }));
    pg.add(ring);
    var disc = new THREE.Mesh(new THREE.CircleGeometry(0.92, 24),
      new THREE.MeshBasicMaterial({ color: 0x7a5cff, transparent: true, opacity: 0.45 }));
    pg.add(disc);
    pg.position.y = 1.5; // 把旋转中心抬到门心，绕自身轴自转而非绕底部摆动
    grp.add(pg);
    var tag = makeLabelSprite("门", "#1fa8c8", 1.05);
    tag.position.set(0, 2.7, 0);
    grp.add(tag);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return { type: "portal", lane: lane, z: spawnZ, x: laneX[lane], mesh: grp, model: pg, hit: false, dead: false, spin: 0 };
  }
  function makeShrink(lane) {
    var grp = new THREE.Group();
    var sg = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.1, 12),
      new THREE.MeshLambertMaterial({ color: 0x3ad17a }));
    body.position.y = ENT_Y - 0.1;
    sg.add(body);
    var top = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xbff5d6 }));
    top.position.y = ENT_Y + 0.55;
    sg.add(top);
    grp.add(sg);
    var tag = makeLabelSprite("小", "#1f9e57", 0.95);
    tag.position.set(0, ENT_Y + 1.3, 0);
    grp.add(tag);
    grp.position.set(laneX[lane], 0, spawnZ);
    scene.add(grp);
    return { type: "shrink", lane: lane, z: spawnZ, x: laneX[lane], mesh: grp, model: sg, hit: false, dead: false, spin: 0 };
  }
  // 大摆锤：横摆的重力锤（x 方向摆动，覆盖多车道），缩小可躲
  function makePendulum(lane) {
    var grp = new THREE.Group();
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.0, 8),
      new THREE.MeshLambertMaterial({ color: 0x555a66 }));
    rod.position.y = ENT_Y + 1.4;
    grp.add(rod);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 12),
      new THREE.MeshLambertMaterial({ color: 0xc0392b }));
    head.position.y = ENT_Y - 0.2;
    grp.add(head);
    var head2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4),
      new THREE.MeshLambertMaterial({ color: 0x922b21 }));
    head2.position.y = ENT_Y - 0.2;
    grp.add(head2);
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
        if (groundTex) groundTex.offset.y -= cSpd * dt * 0.018;
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
      if (groundTex) groundTex.offset.y -= dSpd * dt * 0.018;
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

    // 地面滚动
    if (groundTex) groundTex.offset.y -= spd * dt * 0.018;

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

  function resolveHit(e) {
    if (e.type === "shield") { shieldEnd = gameClock + 6; audio.sfx("shield"); toast("护盾!", 700); return; }
    if (e.type === "shrink") { shrinkEnd = gameClock + 5; audio.sfx("shrink"); toast("变小! 可躲摆锤", 900); return; }
    if (e.type === "portal") {
      audio.sfx("portal");
      invincibleEnd = gameClock + 1.9;
      // 触发“传送”动画：冲刺加速 + 镜头拉伸 + 全屏闪光，世界快速掠过而非瞬移坐标
      if (warpTimer <= 0) warpTimer = 0.85;
      actionScore += 120;
      toast("传送! +120", 900);
      return;
    }
      if (e.type === "banana") {
      slipEnd = gameClock + 1.4;
      actionScore = Math.max(actionScore - 40, -Math.floor(distance / 6));
      audio.sfx("banana");
      toast("滑倒! -40", 900);
      return;
    }
    var safe = gameClock < shieldEnd || gameClock < invincibleEnd;
    if (e.type === "num") {
      if (e.value === player.value) { doMerge(); }
      else if (!safe) { combo = 0; audio.sfx("wrong"); toast("数字不符 -15", 700); actionScore = Math.max(actionScore - 15, -Math.floor(distance / 6)); }
    } else if (e.type === "bomb") {
      if (safe) return;
      combo = 0; audio.sfx("hit"); toast("炸弹!", 700); shake = 0.35; loseLife();
    } else if (e.type === "pendulum") {
      if (safe) return;
      combo = 0; audio.sfx("pendulum"); toast("被摆锤击中!", 800); shake = 0.4; loseLife();
    }
  }

  function doMerge() {
    var gained = player.value + combo * 2;
    actionScore += gained;
    combo++;
    player.value *= 2;
    refreshPlayerVisual();
    audio.sfx("merge");
    mergeBump = gameClock;
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
      var core = new THREE.Mesh(new THREE.SphereGeometry(2.0, 18, 16), bodyMat);
      core.position.y = 3.0; grp.add(core);
      for (var a = 0; a < 3; a++) {
        var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.5, 8),
          new THREE.MeshLambertMaterial({ color: 0x555a66 }));
        arm.position.set(Math.cos(a * 2.1) * 2.4, 1.4, Math.sin(a * 2.1) * 2.4);
        arm.rotation.z = 0.5; grp.add(arm);
        var ham = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10),
          new THREE.MeshLambertMaterial({ color: 0xc0392b }));
        ham.position.set(Math.cos(a * 2.1) * 4.6, 0.2, Math.sin(a * 2.1) * 4.6);
        grp.add(ham);
      }
    } else if (LEVELS[currentLevel].boss === "portal") {
      var tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 4.2, 14), bodyMat);
      tower.position.y = 2.4; grp.add(tower);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.28, 12, 28),
        new THREE.MeshBasicMaterial({ color: 0x59e0ff }));
      ring.position.y = 2.4; ring.rotation.x = Math.PI / 2; grp.add(ring);
      grp.userData.spinRing = ring;
    } else {
      var tit = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 3.4), bodyMat);
      tit.position.y = 2.4; grp.add(tit);
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xfff2a8 }));
      eye.position.set(0, 3.0, 1.8); grp.add(eye);
    }
    grp.position.set(0, 0, -30);
    scene.add(grp);
    boss = { mesh: grp, baseY: 0, t: 0, key: LEVELS[currentLevel].boss };
  }
  function animateBoss(dt) {
    if (!boss) return;
    boss.t += dt;
    boss.mesh.position.y = Math.sin(boss.t * 1.5) * 0.4;
    boss.mesh.rotation.y += dt * 0.6;
    if (boss.mesh.userData.spinRing) boss.mesh.userData.spinRing.rotation.z += dt * 2;
  }
  function pulseBoss() {
    if (boss) boss.mesh.scale.set(1.12, 1.12, 1.12);
  }
  function bossDefeated() {
    audio.sfx("levelup");
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
    if (boss) { boss.mesh.scale.x += (1 - boss.mesh.scale.x) * 0.2; boss.mesh.scale.y = boss.mesh.scale.z = boss.mesh.scale.x; }
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
  }

  // ---------- 主循环 ----------
  var lastT = 0;
  function loop(t) {
    if (!lastT) lastT = t;
    var dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.05) dt = 0.05;

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

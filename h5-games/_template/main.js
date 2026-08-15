/* _template/main.js —— 最小可玩示例，示范「输入契约 + 兼容约束」 */
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var player = { x: 0, y: 0, size: 40, color: '#5a8dee' };
  var target = { x: 200, y: 120, size: 30, color: '#ffd93d' };
  var score = 0;
  var state = 'menu'; // 'menu' | 'play'

  // 画布随窗口自适应（见 STANDARD.md §5）
  function resize() {
    var maxW = Math.min(window.innerWidth * 0.9, 900);
    var maxH = Math.min(window.innerHeight * 0.7, 560);
    canvas.style.width = maxW + 'px';
    canvas.style.height = maxH + 'px';
    canvas.width = maxW;
    canvas.height = maxH;
  }
  window.addEventListener('resize', resize);
  resize();

  function start() {
    if (state === 'play') return;
    state = 'play';
    document.getElementById('startScreen').classList.add('hidden');
    player.x = canvas.width / 2;
    player.y = canvas.height / 2;
    loop();
  }

  function move(dir) {
    if (state !== 'play') return;
    var step = 24;
    if (dir === 'up') player.y -= step;
    if (dir === 'down') player.y += step;
    if (dir === 'left') player.x -= step;
    if (dir === 'right') player.x += step;
    player.x = Math.max(0, Math.min(canvas.width, player.x));
    player.y = Math.max(0, Math.min(canvas.height, player.y));
    var dx = player.x - target.x, dy = player.y - target.y;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) {
      score++;
      target.x = 40 + Math.random() * (canvas.width - 80);
      target.y = 40 + Math.random() * (canvas.height - 80);
    }
  }

  function loop() {
    if (state !== 'play') return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 目标（用 canvas 形状，不用 emoji，见 STANDARD.md §6）
    ctx.fillStyle = target.color;
    ctx.fillRect(target.x - target.size / 2, target.y - target.size / 2, target.size, target.size);
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x - player.size / 2, player.y - player.size / 2, player.size, player.size);
    ctx.fillStyle = '#fff';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('得分: ' + score, 16, 28);
    requestAnimationFrame(loop);
  }

  // 输入：用 shared/input.js 的 TVInput（方向键/WASD/OK 归一化）
  var TVInput = window.TVInput;
  if (TVInput) {
    TVInput.on('dir', function (d) {
      if (state === 'menu') { if (window.TVNav) TVNav.move(d); } // 菜单：焦点导航
      else move(d);                                              // 游戏中：移动
    });
    TVInput.on('confirm', function () {
      if (state === 'menu') { if (window.TVNav) TVNav.confirm(); } // 点「开始游戏」
      // 游戏中 OK 可扩展（如暂停）
    });
  }

  // 鼠标兜底（不替代键盘，仅附加）
  document.getElementById('btnStart').addEventListener('click', start);

  // standalone 焦点导航（启动器内由 tv-controls 自动接管，这里仅桌面直接打开时有效）
  if (window.TVNav && !window.__tvControlsInjected) {
    TVNav.init(document.getElementById('startScreen'));
  }
})();

/*
 * puzzle.js —— 滑动拼图的「棋盘逻辑」（与绘制、输入完全解耦）
 *
 * 单独拆成一个文件，是为了让 test/smoke.js 能直接断言这些**真正决定体验的性质**：
 * 打乱后一定可解、滑动方向语义正确、判定完成不会误判 —— 不用去驱动状态机。
 *
 * 表示法：
 *   board 是一个长度 n*n 的数组，board[i] 表示第 i 格放的块编号；
 *   编号 1..n*n-1 是图案块，**0 表示空格**。
 *   完成态 = [1, 2, ..., n*n-1, 0]。
 *
 * 方向语义（重要，别搞反）：
 *   dir 指的是**方块滑动的方向**，不是空格移动的方向。
 *   按「右」= 有一块向右滑进空格 —— 那块一定在空格的**左边**。
 *   这是给用户的心智模型：「我想让这块往右走」，低龄玩家最容易理解。
 *
 * 兼容：经典脚本 + IIFE，无 ES module / 无 let/const/箭头（Chromium 47）。
 */
(function (global) {
  'use strict';

  // 关卡 → 棋盘尺寸。低龄向：前 3 关都是 3×3，第 4 关起升到 4×4。
  function sizeOf(level) {
    return level >= 4 ? 4 : 3;
  }

  // 打乱步数：从完成态反向走这么多步，天然保证**一定可解**
  function shuffleCountOf(level) {
    return Math.min(60 + level * 25, 260);
  }

  function timeOf(level) {
    return Math.max(90, 200 - (level - 1) * 14);
  }

  function solvedBoard(n) {
    var b = [];
    for (var i = 0; i < n * n - 1; i++) b.push(i + 1);
    b.push(0);
    return b;
  }

  function blankIndex(board) {
    for (var i = 0; i < board.length; i++) if (board[i] === 0) return i;
    return -1;
  }

  function isSolved(board) {
    for (var i = 0; i < board.length - 1; i++) {
      if (board[i] !== i + 1) return false;
    }
    return board[board.length - 1] === 0;
  }

  /*
   * 返回「按 dir 时会滑动的那一块」所在的下标；不可滑返回 -1。
   * dir = 方块滑动方向：
   *   right → 取空格左邻 ；left → 取空格右邻
   *   down  → 取空格上邻 ；up   → 取空格下邻
   */
  function sourceIndex(board, n, dir) {
    var b = blankIndex(board);
    if (b < 0) return -1;
    var r = Math.floor(b / n), c = b % n;
    if (dir === 'right') return c > 0 ? r * n + (c - 1) : -1;
    if (dir === 'left') return c < n - 1 ? r * n + (c + 1) : -1;
    if (dir === 'down') return r > 0 ? (r - 1) * n + c : -1;
    if (dir === 'up') return r < n - 1 ? (r + 1) * n + c : -1;
    return -1;
  }

  function canMove(board, n, dir) {
    return sourceIndex(board, n, dir) >= 0;
  }

  /*
   * 执行一次滑动。成功返回 {ok:true, from, to}（board 原地修改）；
   * 方向非法返回 {ok:false}。
   */
  function move(board, n, dir) {
    var from = sourceIndex(board, n, dir);
    if (from < 0) return { ok: false };
    var to = blankIndex(board);
    board[to] = board[from];
    board[from] = 0;
    return { ok: true, from: from, to: to };
  }

  // 当前可以滑动的块（空格的四邻），用来在画面上给「能动的那几块」加提示
  function movable(board, n) {
    var b = blankIndex(board);
    if (b < 0) return [];
    var r = Math.floor(b / n), c = b % n;
    var out = [];
    if (c > 0) out.push(b - 1);
    if (c < n - 1) out.push(b + 1);
    if (r > 0) out.push(b - n);
    if (r < n - 1) out.push(b + n);
    return out;
  }

  /*
   * 打乱：**从完成态出发走 steps 步合法移动**，所以结果必然可解。
   * （如果改成「随机排列再判奇偶」，一半的局面是无解的，孩子会永远拼不出来。）
   * 另外刻意不走「上一步的反向」，否则原地来回抖、等于没打乱。
   */
  function shuffle(n, steps, rnd) {
    var rand = rnd || Math.random;
    var board = solvedBoard(n);
    var dirs = ['up', 'down', 'left', 'right'];
    var opposite = { up: 'down', down: 'up', left: 'right', right: 'left' };
    var last = '';

    for (var s = 0; s < steps; s++) {
      var pool = [];
      for (var i = 0; i < dirs.length; i++) {
        var d = dirs[i];
        if (d === last) continue;                 // 不立刻走回头路
        if (canMove(board, n, d)) pool.push(d);
      }
      if (!pool.length) { last = ''; continue; }  // 理论上不会发生，兜底
      var pick = pool[Math.floor(rand() * pool.length) % pool.length];
      move(board, n, pick);
      last = opposite[pick];
    }

    // 极小概率走回完成态，再补几步
    var guard = 0;
    while (isSolved(board) && guard < 20) {
      move(board, n, dirs[Math.floor(rand() * 4) % 4]);
      guard++;
    }
    return board;
  }

  global.Puzzle = {
    sizeOf: sizeOf,
    shuffleCountOf: shuffleCountOf,
    timeOf: timeOf,
    solvedBoard: solvedBoard,
    blankIndex: blankIndex,
    isSolved: isSolved,
    sourceIndex: sourceIndex,
    canMove: canMove,
    move: move,
    movable: movable,
    shuffle: shuffle
  };
})(window);

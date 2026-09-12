/*
 * quiz.js —— 认知问答的「出题器」
 *
 * 核心约束：**低龄儿童不识字**。所以题目一律「图形化」——
 * 题干是一张图（一个形状 / 一个动物 / 一堆积木），选项是四张图，
 * 孩子只要「看哪张和上面一样」就能答。题干那行汉字是给家长看的，
 * 孩子不需要读。
 *
 * 生成原则：
 *   1) **答案必须唯一**。干扰项不能和正确答案重合，也不能互相重合，
 *      否则孩子选了「看起来也对」的那个却被判错，体验极差。
 *   2) **单一维度**。考形状时，所有选项的颜色都不同（没法靠颜色蒙）；
 *      考颜色时，所有选项的形状都相同（没法靠形状蒙）。
 *
 * 对外接口（挂到 window.Quiz）：
 *   Quiz.QUESTIONS      每关题数
 *   Quiz.poolOf(level)  该关会出哪些题型
 *   Quiz.generate(level, lastType)  生成一题
 *
 * Question = { type, label, prompt, options: [Item ×4], answer: 0..3 }
 * Item     = { k:'shape'|'animal'|'digit', id, color, size, n }
 */
(function (global) {
  'use strict';

  var QUESTIONS = 8;

  // 题型按关卡逐步解锁：先形状/颜色这类最基础的，再上动物、大小，
  // 最后才是「找不同」「数一数」这种需要对比/点数的高阶题。
  var TYPES = [
    { id: 'sameShape', from: 1 },
    { id: 'sameColor', from: 1 },
    { id: 'sameAnimal', from: 2 },
    { id: 'size', from: 3 },
    { id: 'oddOne', from: 4 },
    { id: 'count', from: 5 },
    { id: 'oddAnimal', from: 6 }
  ];
  function poolOf(level) {
    var out = [];
    for (var i = 0; i < TYPES.length; i++) if (level >= TYPES[i].from) out.push(TYPES[i].id);
    return out;
  }

  // ---------- 小工具 ----------
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function pickExcept(a, v) {
    var b = [];
    for (var i = 0; i < a.length; i++) if (a[i] !== v) b.push(a[i]);
    return pick(b.length ? b : a);
  }
  function pickN(a, n) { return shuffle(a.slice()).slice(0, n); }
  function pickNExcept(a, v, n) {
    var b = [];
    for (var i = 0; i < a.length; i++) if (a[i] !== v) b.push(a[i]);
    return shuffle(b).slice(0, n);
  }
  // 把正确答案和三个干扰项打乱，返回 { options, answer }
  function build(label, type, prompt, correct, wrongs) {
    var opts = [correct].concat(wrongs);
    shuffle(opts);
    return {
      type: type,
      label: label,
      prompt: prompt,
      options: opts,
      answer: opts.indexOf(correct)
    };
  }

  function shape(id, color, size) {
    return { k: 'shape', id: id, color: color, size: size || 1 };
  }
  function animal(id, color) {
    return { k: 'animal', id: id, color: color || 'brown' };
  }

  // ---------- 题型 1：认形状 ----------
  // 选项颜色全部不同于题干色 → 只能靠形状分辨
  function qSameShape() {
    var id = pick(Art.SHAPE_IDS);
    var pc = pick(Art.COLOR_IDS);
    var prompt = shape(id, pc, 1);
    var correct = shape(id, pickExcept(Art.COLOR_IDS, pc), 1);
    var wrongs = pickNExcept(Art.SHAPE_IDS, id, 3).map(function (sid) {
      return shape(sid, pickExcept(Art.COLOR_IDS, pc), 1);
    });
    return build('找出形状一样的', 'sameShape', prompt, correct, wrongs);
  }

  // ---------- 题型 2：认颜色 ----------
  // 选项形状全部相同（且不同于题干形状）→ 只能靠颜色分辨
  function qSameColor() {
    var c = pick(Art.COLOR_IDS);
    var ps = pick(Art.SHAPE_IDS);
    var os = pickExcept(Art.SHAPE_IDS, ps);
    var prompt = shape(ps, c, 1);
    var correct = shape(os, c, 1);
    var wrongs = pickNExcept(Art.COLOR_IDS, c, 3).map(function (cc) {
      return shape(os, cc, 1);
    });
    return build('找出颜色一样的', 'sameColor', prompt, correct, wrongs);
  }

  // ---------- 题型 3：认动物 ----------
  function qSameAnimal() {
    var id = pick(Art.ANIMAL_IDS);
    var pc = pick(Art.COLOR_IDS);
    var prompt = animal(id, pc);
    var correct = animal(id, pc);
    var wrongs = pickNExcept(Art.ANIMAL_IDS, id, 3).map(function (aid) {
      return animal(aid, pc);
    });
    return build('找出一样的小动物', 'sameAnimal', prompt, correct, wrongs);
  }

  // ---------- 题型 4：比大小 ----------
  function qSize() {
    var wantBig = Math.random() < 0.5;
    var id = pick(Art.SHAPE_IDS);
    var c = pick(Art.COLOR_IDS);
    var sizes = shuffle([0.56, 0.78, 1.02, 1.30]);
    var opts = sizes.map(function (s) { return shape(id, c, s); });
    var ai = 0;
    for (var i = 1; i < opts.length; i++) {
      if (wantBig && opts[i].size > opts[ai].size) ai = i;
      if (!wantBig && opts[i].size < opts[ai].size) ai = i;
    }
    return {
      type: 'size',
      label: wantBig ? '哪个最大？' : '哪个最小？',
      prompt: null,
      options: opts,
      answer: ai
    };
  }

  // ---------- 题型 5：找不同（形状类） ----------
  function qOddOne() {
    var byColor = Math.random() < 0.5;
    var id = pick(Art.SHAPE_IDS);
    var c = pick(Art.COLOR_IDS);
    var diff = byColor
      ? shape(id, pickExcept(Art.COLOR_IDS, c), 1)
      : shape(pickExcept(Art.SHAPE_IDS, id), c, 1);
    var wrongs = [shape(id, c, 1), shape(id, c, 1), shape(id, c, 1)];
    return build('哪个不一样？', 'oddOne', null, diff, wrongs);
  }

  // ---------- 题型 6：找不同（动物类） ----------
  function qOddAnimal() {
    var id = pick(Art.ANIMAL_IDS);
    var c = pick(Art.COLOR_IDS);
    var diff = animal(pickExcept(Art.ANIMAL_IDS, id), c);
    var wrongs = [animal(id, c), animal(id, c), animal(id, c)];
    return build('哪个不一样？', 'oddAnimal', null, diff, wrongs);
  }

  // ---------- 题型 7：数一数 ----------
  function qCount(level) {
    var maxN = Math.min(3 + Math.floor(level / 2), 6);
    var n = 1 + Math.floor(Math.random() * maxN);
    var item = shape(pick(Art.SHAPE_IDS), pick(Art.COLOR_IDS), 1);
    var prompt = { k: 'count', n: n, item: item };
    // 干扰项从 1..maxN+2 里取，且互不相同、也不等于答案
    var cand = [];
    for (var v = 1; v <= maxN + 2; v++) if (v !== n) cand.push(v);
    var wrongs = pickN(cand, 3).map(function (v) { return { k: 'digit', n: v }; });
    return build('一共有几个？', 'count', prompt, { k: 'digit', n: n }, wrongs);
  }

  var GEN = {
    sameShape: qSameShape,
    sameColor: qSameColor,
    sameAnimal: qSameAnimal,
    size: qSize,
    oddOne: qOddOne,
    oddAnimal: qOddAnimal,
    count: qCount
  };

  // 尽量不连着出同一题型（同一题型连出三次会显得很单调）
  function generate(level, lastType) {
    var pool = poolOf(level);
    var choice = pick(pool);
    if (lastType && pool.length > 1 && choice === lastType) choice = pick(pool);
    return GEN[choice](level);
  }

  global.Quiz = {
    QUESTIONS: QUESTIONS,
    poolOf: poolOf,
    generate: generate,
    // 供测试用
    _gen: GEN,
    _shuffle: shuffle
  };
})(window);

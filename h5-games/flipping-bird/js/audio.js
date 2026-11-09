/*
 * audio.js —— 振翅飞行：程序化音效与 BGM（Web Audio API，无外部音频文件）
 *
 * 与仓库其它游戏一致：音效用振荡器合成，BGM 是轻快的五声音阶 chiptune 循环。
 * 三套场景各用一组音阶（天空明亮、草丛轻快、海洋低沉），换套装时听感也跟着换。
 *
 * 浏览器自动播放策略：AudioContext 必须在用户手势内 resume()，见 resume()。
 * 无音频设备 / 老 WebView 构造失败时静默降级，声音不该把游戏拖崩。
 */
(function (global) {
  'use strict';

  function AudioManager() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.bgmTimer = null;
    this.step = 0;
    this.nextNoteTime = 0;
    this.scene = 0;
  }

  AudioManager.prototype.ensure = function () {
    if (this.ctx) return;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; this.master = null; }
  };

  AudioManager.prototype.resume = function () {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  AudioManager.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  };

  AudioManager.prototype.toggleMute = function () {
    this.setMuted(!this.muted);
    return this.muted;
  };

  AudioManager.prototype.blip = function (freq, t, dur, type, vol, glideTo) {
    if (!this.ctx) return;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  AudioManager.prototype.noise = function (t, dur, vol) {
    if (!this.ctx) return;
    var n = Math.floor(this.ctx.sampleRate * dur);
    var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = this.ctx.createBufferSource();
    src.buffer = buf;
    var g = this.ctx.createGain();
    g.gain.value = vol || 0.18;
    var f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  };

  AudioManager.prototype.sfx = function (type) {
    this.resume();
    if (!this.ctx) return;
    var t = this.ctx.currentTime;

    switch (type) {
      case 'flap':          // 拍翅膀：极短的上滑，按得再快也不糊
        this.blip(430, t, 0.06, 'triangle', 0.18, 720);
        break;
      case 'select':        // 换套装
        this.blip(660, t, 0.05, 'sine', 0.14);
        this.blip(880, t + 0.04, 0.07, 'sine', 0.12);
        break;
      case 'score':         // 穿过一根柱子：清脆「叮」
        this.blip(784, t, 0.08, 'triangle', 0.24);
        this.blip(1175, t + 0.06, 0.12, 'sine', 0.20);
        break;
      case 'level':         // 升一级：上行三音
        this.blip(523, t, 0.09, 'square', 0.22);
        this.blip(659, t + 0.08, 0.09, 'square', 0.22);
        this.blip(880, t + 0.16, 0.18, 'square', 0.22);
        break;
      case 'hit':           // 撞到：低频闷响，不刺耳、不吓人
        this.blip(196, t, 0.16, 'sawtooth', 0.15, 120);
        this.noise(t, 0.13, 0.09);
        break;
      case 'count':
        this.blip(740, t, 0.07, 'square', 0.16);
        break;
      case 'go':
        this.blip(880, t, 0.14, 'square', 0.24);
        this.blip(1175, t + 0.10, 0.18, 'square', 0.22);
        break;
      case 'over':
        this.blip(440, t, 0.18, 'triangle', 0.24);
        this.blip(330, t + 0.15, 0.18, 'triangle', 0.24);
        this.blip(247, t + 0.30, 0.28, 'triangle', 0.24);
        break;
      case 'start':
        this.blip(523, t, 0.10, 'square', 0.22);
        this.blip(659, t + 0.08, 0.10, 'square', 0.22);
        this.blip(784, t + 0.16, 0.16, 'square', 0.22);
        break;
    }
  };

  // 轻快循环 BGM：三套场景各一组五声音阶，八拍一循环
  var BGM = [
    { bass: [196.0, 196.0, 220.0, 220.0, 174.6, 174.6, 164.8, 164.8],
      lead: [587, 659, 784, 659, 523, 587, 659, 587] },      // 天空：明亮
    { bass: [174.6, 174.6, 196.0, 196.0, 146.8, 146.8, 164.8, 164.8],
      lead: [523, 587, 659, 587, 440, 523, 587, 523] },      // 草丛：轻快
    { bass: [164.8, 164.8, 146.8, 146.8, 130.8, 130.8, 146.8, 146.8],
      lead: [440, 523, 587, 523, 392, 440, 523, 440] }       // 海洋：低沉
  ];

  AudioManager.prototype.startBGM = function (sceneIndex) {
    this.resume();
    if (!this.ctx || this.bgmTimer) return;
    if (sceneIndex != null) this.scene = sceneIndex;
    var set = BGM[this.scene] || BGM[0];
    var bass = set.bass, lead = set.lead;
    var spb = 0.30;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.12;
    var self = this;
    this.bgmTimer = setInterval(function () {
      if (!self.ctx) return;
      while (self.nextNoteTime < self.ctx.currentTime + 0.2) {
        var t = self.nextNoteTime;
        var i = self.step % 8;
        self.blip(bass[i], t, spb * 0.8, 'triangle', 0.075);
        if (i % 2 === 0) self.blip(lead[i], t, spb * 0.6, 'sine', 0.042);
        self.step++;
        self.nextNoteTime += spb;
      }
    }, 50);
  };

  AudioManager.prototype.stopBGM = function () {
    if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
  };

  global.AudioManager = AudioManager;
})(window);

/*
 * audio.js —— 程序化音效与 BGM（Web Audio API，无外部音频文件）
 * 设计：事件音效用振荡器合成；BGM 用三角波 + 方波做轻柔的 chiptune 循环，
 *       音量刻意压低，避免干扰「找不同」时需要的专注。
 * 浏览器自动播放策略：AudioContext 必须在用户手势内 resume()，见 resume()。
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
  }

  AudioManager.prototype.ensure = function () {
    if (this.ctx) return;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
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

  // 单个音符：type 为波形，glideTo 为滑音终点
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
    g.gain.value = vol || 0.22;
    var f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  };

  AudioManager.prototype.sfx = function (type) {
    this.resume();
    if (!this.ctx) return;
    var t = this.ctx.currentTime;

    switch (type) {
      case 'found':        // 找到一处：清脆上行双音
        this.blip(659, t, 0.09, 'triangle', 0.30);
        this.blip(988, t + 0.07, 0.13, 'triangle', 0.26);
        break;

      case 'miss':         // 点错：短促下滑低音
        this.blip(196, t, 0.14, 'sawtooth', 0.20, 130);
        break;

      case 'hint':         // 提示：闪烁高音
        this.blip(1319, t, 0.07, 'sine', 0.26);
        this.blip(1760, t + 0.07, 0.09, 'sine', 0.22);
        break;

      case 'tick':         // 倒计时紧张感
        this.blip(880, t, 0.05, 'square', 0.14);
        break;

      case 'levelclear':   // 过关：上行琶音
        this.blip(523, t, 0.11, 'square', 0.26);
        this.blip(659, t + 0.10, 0.11, 'square', 0.26);
        this.blip(784, t + 0.20, 0.11, 'square', 0.26);
        this.blip(1046, t + 0.30, 0.20, 'square', 0.26);
        break;

      case 'over':         // 时间到：下行三音
        this.blip(440, t, 0.18, 'triangle', 0.26);
        this.blip(330, t + 0.15, 0.18, 'triangle', 0.26);
        this.blip(247, t + 0.30, 0.26, 'triangle', 0.26);
        break;

      case 'start':        // 开始：上行三音
        this.blip(523, t, 0.10, 'square', 0.24);
        this.blip(659, t + 0.08, 0.10, 'square', 0.24);
        this.blip(784, t + 0.16, 0.14, 'square', 0.24);
        break;
    }
  };

  // 轻柔循环 BGM：五声音阶，低音量，四拍一循环
  AudioManager.prototype.startBGM = function () {
    this.resume();
    if (!this.ctx || this.bgmTimer) return;
    var bass = [196.0, 196.0, 220.0, 220.0, 174.6, 174.6, 164.8, 164.8];
    var lead = [587, 659, 784, 659, 523, 587, 659, 587];
    var spb = 0.30;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.12;
    var self = this;
    this.bgmTimer = setInterval(function () {
      if (!self.ctx) return;
      while (self.nextNoteTime < self.ctx.currentTime + 0.2) {
        var t = self.nextNoteTime;
        var i = self.step % 8;
        self.blip(bass[i], t, spb * 0.85, 'triangle', 0.10);
        if (i % 2 === 0) self.blip(lead[i], t, spb * 0.7, 'sine', 0.055);
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

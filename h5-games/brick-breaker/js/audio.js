/*
 * audio.js —— 程序化音效与 BGM（Web Audio API，零外部音频文件）
 *
 * 与仓库其它游戏一致：全部用振荡器/噪声合成。打砖块的反馈重点是「敲击」——
 * 砖块碎裂是短促木鱼音、挡板是厚实的低音弹、掉球是下行闷响（不刺耳、不吓小孩）。
 * 自动播放限制：AudioContext 必须在用户手势里 resume()，见 resume()。
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
    /* 无音频设备的 WebView 可能在构造时抛异常，声音不该把游戏拖崩 */
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
    f.frequency.value = 1200;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  };

  AudioManager.prototype.sfx = function (type) {
    this.resume();
    if (!this.ctx) return;
    var t = this.ctx.currentTime;

    switch (type) {
      case 'paddle':   /* 挡板接球：厚实的低音弹 */
        this.blip(300, t, 0.08, 'triangle', 0.26, 430);
        break;
      case 'wall':     /* 撞墙：极轻，只是触感 */
        this.blip(520, t, 0.028, 'sine', 0.055);
        break;
      case 'brick':    /* 砖块碎裂：木鱼般的短促上滑 */
        this.blip(720, t, 0.055, 'square', 0.20, 980);
        this.noise(t, 0.045, 0.055);
        break;
      case 'hard':     /* 加固砖第一下：闷一点，提示还没碎 */
        this.blip(330, t, 0.07, 'triangle', 0.18);
        break;
      case 'star':     /* 接住星星：明亮琶音 */
        this.blip(784, t, 0.08, 'triangle', 0.24);
        this.blip(988, t + 0.07, 0.08, 'triangle', 0.22);
        this.blip(1319, t + 0.14, 0.18, 'triangle', 0.20);
        break;
      case 'launch':   /* 发球 */
        this.blip(440, t, 0.09, 'triangle', 0.20, 880);
        break;
      case 'lose':     /* 掉球：下行两音，不刺耳 */
        this.blip(392, t, 0.14, 'sine', 0.20, 260);
        this.blip(294, t + 0.12, 0.20, 'sine', 0.16, 196);
        break;
      case 'count':
        this.blip(740, t, 0.07, 'square', 0.16);
        break;
      case 'go':
        this.blip(880, t, 0.14, 'square', 0.24);
        this.blip(1175, t + 0.10, 0.18, 'square', 0.22);
        break;
      case 'level':    /* 过关：上行三音 */
        this.blip(523, t, 0.10, 'square', 0.22);
        this.blip(659, t + 0.09, 0.10, 'square', 0.22);
        this.blip(880, t + 0.18, 0.22, 'square', 0.22);
        break;
      case 'win':      /* 全通关：加长版 */
        this.blip(523, t, 0.12, 'square', 0.24);
        this.blip(659, t + 0.12, 0.12, 'square', 0.24);
        this.blip(784, t + 0.24, 0.12, 'square', 0.24);
        this.blip(1047, t + 0.36, 0.42, 'triangle', 0.26);
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

  /* 轻快循环 BGM：大调五声音阶、低音量、八拍一循环 */
  AudioManager.prototype.startBGM = function () {
    this.resume();
    if (!this.ctx || this.bgmTimer) return;
    var bass = [174.6, 174.6, 196.0, 196.0, 220.0, 220.0, 196.0, 164.8];
    var lead = [659, 784, 880, 784, 659, 587, 659, 523];
    var spb = 0.28;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.12;
    var self = this;
    this.bgmTimer = setInterval(function () {
      if (!self.ctx) return;
      while (self.nextNoteTime < self.ctx.currentTime + 0.2) {
        var t = self.nextNoteTime;
        var i = self.step % 8;
        self.blip(bass[i], t, spb * 0.8, 'triangle', 0.070);
        if (i % 2 === 0) self.blip(lead[i], t, spb * 0.6, 'sine', 0.040);
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

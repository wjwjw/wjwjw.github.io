/*
 * audio.js —— 程序化音效与 BGM（Web Audio API，无外部音频文件）
 *
 * 与其它游戏一致：音效用振荡器合成，BGM 是轻柔的五声音阶 chiptune 循环，
 * 音量刻意压低 —— 记忆类玩法需要安静，BGM 只做背景不抢戏。
 *
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

  // 单个音符：glideTo 为滑音终点
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
    f.type = 'highpass';
    f.frequency.value = 1100;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  };

  AudioManager.prototype.sfx = function (type) {
    this.resume();
    if (!this.ctx) return;
    var t = this.ctx.currentTime;

    switch (type) {
      case 'flip':          // 翻牌：干脆的短促上行
        this.blip(720, t, 0.055, 'triangle', 0.20);
        this.blip(980, t + 0.035, 0.06, 'triangle', 0.14);
        break;

      case 'match':         // 配对成功：明亮三连音
        this.blip(784, t, 0.09, 'triangle', 0.28);
        this.blip(988, t + 0.075, 0.09, 'triangle', 0.26);
        this.blip(1319, t + 0.15, 0.16, 'triangle', 0.24);
        break;

      case 'miss':          // 没配上：两声闷响
        this.blip(262, t, 0.10, 'sawtooth', 0.16, 200);
        this.blip(196, t + 0.10, 0.13, 'sawtooth', 0.14, 150);
        break;

      case 'nope':          // 无效操作（点已翻开的牌）
        this.blip(180, t, 0.07, 'square', 0.12);
        break;

      case 'peek':          // 预览开始：轻柔提示音
        this.blip(587, t, 0.12, 'sine', 0.20);
        this.blip(880, t + 0.10, 0.16, 'sine', 0.16);
        break;

      case 'tick':          // 倒计时紧张感
        this.blip(880, t, 0.05, 'square', 0.13);
        break;

      case 'clear':         // 过关：上行琶音
        this.blip(523, t, 0.11, 'square', 0.26);
        this.blip(659, t + 0.10, 0.11, 'square', 0.26);
        this.blip(784, t + 0.20, 0.11, 'square', 0.26);
        this.blip(1046, t + 0.30, 0.22, 'square', 0.26);
        break;

      case 'over':          // 时间到：下行三音
        this.blip(440, t, 0.18, 'triangle', 0.26);
        this.blip(330, t + 0.15, 0.18, 'triangle', 0.26);
        this.blip(247, t + 0.30, 0.26, 'triangle', 0.26);
        break;

      case 'start':         // 开始：上行三音
        this.blip(523, t, 0.10, 'square', 0.24);
        this.blip(659, t + 0.08, 0.10, 'square', 0.24);
        this.blip(784, t + 0.16, 0.14, 'square', 0.24);
        break;
    }
  };

  // 轻柔循环 BGM：五声音阶、低音量、八拍一循环
  AudioManager.prototype.startBGM = function () {
    this.resume();
    if (!this.ctx || this.bgmTimer) return;
    var bass = [174.6, 174.6, 196.0, 196.0, 155.6, 155.6, 146.8, 146.8];
    var lead = [523, 587, 659, 587, 494, 523, 587, 523];
    var spb = 0.34;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.12;
    var self = this;
    this.bgmTimer = setInterval(function () {
      if (!self.ctx) return;
      while (self.nextNoteTime < self.ctx.currentTime + 0.2) {
        var t = self.nextNoteTime;
        var i = self.step % 8;
        self.blip(bass[i], t, spb * 0.85, 'triangle', 0.085);
        if (i % 2 === 0) self.blip(lead[i], t, spb * 0.7, 'sine', 0.045);
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

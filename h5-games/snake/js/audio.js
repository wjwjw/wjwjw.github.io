/*
 * audio.js —— 程序化音效与 BGM（Web Audio API，无外部音频文件）
 *
 * 与仓库其它游戏一致：音效用振荡器合成，BGM 是轻快的五声音阶 chiptune 循环。
 * 贪吃蛇的反馈要点是「吃」——所以 eat 做成短促上滑音，star 做成明亮琶音，
 * hit（撞到自己）用低频闷响 + 噪声，避免吓到小孩。
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
    // 个别 WebView / 无音频设备的环境会在构造时抛异常，声音不该把游戏拖崩
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
      case 'turn':          // 转向：极轻的一点，只作触感反馈
        this.blip(520, t, 0.035, 'sine', 0.07);
        break;

      case 'eat':           // 吃到苹果：短促上滑
        this.blip(660, t, 0.07, 'triangle', 0.24, 990);
        break;

      case 'fast':          // 手速奖励
        this.blip(1180, t + 0.05, 0.09, 'sine', 0.18);
        break;

      case 'star':          // 金星星：明亮四连音
        this.blip(784, t, 0.08, 'triangle', 0.26);
        this.blip(988, t + 0.07, 0.08, 'triangle', 0.24);
        this.blip(1319, t + 0.14, 0.08, 'triangle', 0.22);
        this.blip(1568, t + 0.21, 0.20, 'triangle', 0.20);
        break;

      case 'level':         // 升关：上行三音
        this.blip(523, t, 0.09, 'square', 0.22);
        this.blip(659, t + 0.08, 0.09, 'square', 0.22);
        this.blip(880, t + 0.16, 0.18, 'square', 0.22);
        break;

      case 'hit':           // 撞到自己：低频闷响，不要刺耳
        this.blip(196, t, 0.16, 'sawtooth', 0.16, 120);
        this.noise(t, 0.14, 0.10);
        break;

      case 'count':         // 倒计时滴答
        this.blip(740, t, 0.07, 'square', 0.16);
        break;

      case 'go':            // 开始
        this.blip(880, t, 0.14, 'square', 0.24);
        this.blip(1175, t + 0.10, 0.18, 'square', 0.22);
        break;

      case 'over':          // 结束：下行三音
        this.blip(440, t, 0.18, 'triangle', 0.24);
        this.blip(330, t + 0.15, 0.18, 'triangle', 0.24);
        this.blip(247, t + 0.30, 0.28, 'triangle', 0.24);
        break;

      case 'start':         // 从标题进入
        this.blip(523, t, 0.10, 'square', 0.22);
        this.blip(659, t + 0.08, 0.10, 'square', 0.22);
        this.blip(784, t + 0.16, 0.16, 'square', 0.22);
        break;
    }
  };

  // 轻快循环 BGM：五声音阶、低音量、八拍一循环
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

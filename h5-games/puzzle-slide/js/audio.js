/*
 * audio.js —— 程序化音效与 BGM（Web Audio API，无外部音频文件）
 *
 * 与其它游戏同一套骨架（见 kids-quiz/js/audio.js）。拼图这边的关键是**滑动要有触感**：
 * 每滑一下给一个很短的「哒」，方向非法给一个闷响 —— 不看画面也知道自己那一下
 * 到底滑没滑动。BGM 音量压得很低，拼图需要安静思考。
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

  AudioManager.prototype.sfx = function (type) {
    this.resume();
    if (!this.ctx) return;
    var t = this.ctx.currentTime;

    switch (type) {
      case 'slide':        // 滑动：极短的木质「哒」，音高随步数微升，连滑有节奏感
        this.blip(420, t, 0.05, 'square', 0.13, 560);
        break;

      case 'blocked':      // 这个方向滑不动：闷响，短且不刺耳
        this.blip(150, t, 0.09, 'sine', 0.16, 110);
        break;

      case 'snap':         // 有一块归位了：清亮一声，正反馈
        this.blip(880, t, 0.07, 'triangle', 0.20);
        this.blip(1318, t + 0.05, 0.10, 'triangle', 0.16);
        break;

      case 'tick':         // 倒计时紧张感
        this.blip(880, t, 0.05, 'square', 0.13);
        break;

      case 'clear':        // 拼好了：上行琶音
        this.blip(523, t, 0.11, 'square', 0.26);
        this.blip(659, t + 0.10, 0.11, 'square', 0.26);
        this.blip(784, t + 0.20, 0.11, 'square', 0.26);
        this.blip(1046, t + 0.30, 0.22, 'square', 0.26);
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

  // 轻柔循环 BGM：五声音阶、低音量、八拍一循环
  AudioManager.prototype.startBGM = function () {
    this.resume();
    if (!this.ctx || this.bgmTimer) return;
    var bass = [196.0, 196.0, 220.0, 220.0, 174.6, 174.6, 164.8, 164.8];
    var lead = [587, 659, 784, 659, 523, 587, 659, 587];
    var spb = 0.34;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.12;
    var self = this;
    this.bgmTimer = setInterval(function () {
      if (!self.ctx) return;
      while (self.nextNoteTime < self.ctx.currentTime + 0.2) {
        var t = self.nextNoteTime;
        var i = self.step % 8;
        self.blip(bass[i], t, spb * 0.85, 'triangle', 0.07);
        if (i % 2 === 0) self.blip(lead[i], t, spb * 0.7, 'sine', 0.036);
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

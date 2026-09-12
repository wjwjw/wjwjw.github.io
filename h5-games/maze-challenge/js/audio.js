/* audio.js — 程序化电子音乐与音效（Web Audio API）
 * 设计：BGM 用方波/三角波做轻快 chiptune 循环；事件音效各有音色。
 * 浏览器自动播放策略：AudioContext 必须在用户手势内 resume()。
 *
 * 兼容：目标设备 WebView ≈ Chromium 47 不支持 class / const / let / 箭头函数 /
 * 默认参数，这里统一用「构造函数 + prototype + var + function」，
 * 见 ../docs/STANDARD.md §6。
 */
(function (global) {
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
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  };

  AudioManager.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  };

  AudioManager.prototype.toggleMute = function () {
    this.setMuted(!this.muted);
    return this.muted;
  };

  // 单个音符（type/vol/glideTo 缺省值在函数体内补，ES5 没有默认参数）
  AudioManager.prototype.blip = function (freq, t, dur, type, vol, glideTo) {
    if (!this.ctx) return;
    if (type === undefined) type = "square";
    if (vol === undefined) vol = 0.3;
    if (glideTo === undefined) glideTo = null;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  };

  AudioManager.prototype.noise = function (t, dur, vol) {
    if (!this.ctx) return;
    if (vol === undefined) vol = 0.25;
    var n = Math.floor(this.ctx.sampleRate * dur);
    var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = this.ctx.createBufferSource(); src.buffer = buf;
    var g = this.ctx.createGain(); g.gain.value = vol;
    var f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 800;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  };

  AudioManager.prototype.sfx = function (type) {
    this.resume();
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    // forEach 的第二个参数是 thisArg（ES5 就有），省掉一层 var self = this
    switch (type) {
      case "step":   this.blip(440, t, 0.06, "square", 0.12); break;
      case "bump":   this.blip(160, t, 0.08, "square", 0.18, 110); break;
      case "heart":  this.blip(660, t, 0.1, "triangle", 0.3); this.blip(990, t + 0.08, 0.12, "triangle", 0.3); break;
      case "spike":  this.noise(t, 0.18, 0.3); this.blip(200, t, 0.15, "sawtooth", 0.2, 90); break;
      case "banana": this.blip(500, t, 0.14, "square", 0.25, 900); break;
      case "spring": this.blip(700, t, 0.16, "square", 0.25, 300); break;
      case "fire":   this.noise(t, 0.25, 0.3); this.blip(300, t, 0.2, "sawtooth", 0.2, 120); break;
      case "ice":    this.blip(1200, t, 0.2, "triangle", 0.25, 500); this.noise(t, 0.15, 0.15); break;
      case "monster":this.blip(150, t, 0.18, "sawtooth", 0.28, 80); break;
      case "win":    [523, 659, 784, 1046].forEach(function (f, i) { this.blip(f, t + i * 0.12, 0.18, "square", 0.3); }, this); break;
      case "lose":   [400, 330, 260].forEach(function (f, i) { this.blip(f, t + i * 0.14, 0.2, "triangle", 0.28); }, this); break;
    }
  };

  // 轻快 chiptune 循环：C 大调五声，bass + 主旋律
  AudioManager.prototype.startBGM = function () {
    this.resume();
    if (!this.ctx || this.bgmTimer) return;
    var bass = [130.8, 130.8, 174.6, 174.6, 196.0, 196.0, 174.6, 146.8];
    var lead = [523, 659, 784, 659, 587, 784, 880, 784];
    var spb = 0.22; // 每步秒数（约 136 BPM 的八分音）
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    var self = this;
    this.bgmTimer = setInterval(function () {
      if (!self.ctx) return;
      while (self.nextNoteTime < self.ctx.currentTime + 0.15) {
        var t = self.nextNoteTime;
        var i = self.step % 8;
        self.blip(bass[i], t, spb * 0.9, "triangle", 0.18);
        if (i % 2 === 0) self.blip(lead[i], t, spb * 0.8, "square", 0.12);
        self.step++;
        self.nextNoteTime += spb;
      }
    }, 40);
  };

  AudioManager.prototype.stopBGM = function () {
    if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
  };

  global.AudioManager = AudioManager;
})(window);

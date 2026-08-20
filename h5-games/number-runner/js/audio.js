/* audio.js —— 程序化电子音效与 BGM（Web Audio API，无外部音频文件）
 * 设计：事件音效用振荡器合成；BGM 用方波/三角波做轻快 chiptune 循环。
 * 浏览器自动播放策略：AudioContext 必须在用户手势内 resume()。 */
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

  AudioManager.prototype.blip = function (freq, t, dur, type, vol, glideTo) {
    if (!this.ctx) return;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  };
  AudioManager.prototype.noise = function (t, dur, vol) {
    if (!this.ctx) return;
    var n = Math.floor(this.ctx.sampleRate * dur);
    var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = this.ctx.createBufferSource(); src.buffer = buf;
    var g = this.ctx.createGain(); g.gain.value = vol || 0.25;
    var f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 800;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  };

  // 事件音效
  AudioManager.prototype.sfx = function (type) {
    this.resume();
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    switch (type) {
      case "merge":   // 合并：上行双音，越合越大越亮
        this.blip(523, t, 0.10, "square", 0.30, 784);
        this.blip(784, t + 0.06, 0.12, "square", 0.26, 1046);
        break;
      case "wrong":   // 吃错数字：短促低音
        this.blip(180, t, 0.14, "sawtooth", 0.22, 120);
        break;
      case "hit":     // 撞炸弹：噪声 + 下滑
        this.noise(t, 0.20, 0.30);
        this.blip(220, t, 0.18, "sawtooth", 0.22, 90);
        break;
      case "shield":  // 吃护盾：清脆亮音
        this.blip(660, t, 0.10, "triangle", 0.30);
        this.blip(990, t + 0.08, 0.14, "triangle", 0.28);
        break;
      case "over":    // 结束：下行三音
        this.blip(440, t, 0.18, "triangle", 0.28);
        this.blip(330, t + 0.14, 0.18, "triangle", 0.28);
        this.blip(247, t + 0.28, 0.24, "triangle", 0.28);
        break;
      case "start":   // 开始：上行琶音
        this.blip(523, t, 0.10, "square", 0.26);
        this.blip(659, t + 0.08, 0.10, "square", 0.26);
        this.blip(784, t + 0.16, 0.14, "square", 0.26);
        break;
      case "banana":  // 香蕉滑倒：滑稽下滑
        this.blip(400, t, 0.18, "sawtooth", 0.20, 150);
        this.blip(150, t + 0.10, 0.16, "square", 0.16, 90);
        break;
      case "portal":  // 传送门：上行 whoosh
        this.blip(330, t, 0.10, "sine", 0.26, 1320);
        this.blip(660, t + 0.08, 0.14, "sine", 0.22, 1760);
        break;
      case "shrink":  // 变小药水：下行
        this.blip(880, t, 0.16, "triangle", 0.26, 330);
        break;
      case "pendulum": // 大摆锤击中：低沉重击
        this.blip(110, t, 0.22, "sawtooth", 0.30, 60);
        this.noise(t, 0.12, 0.20);
        break;
      case "boss":    // Boss 登场：低沉号角
        this.blip(98, t, 0.5, "sawtooth", 0.26, 110);
        this.blip(147, t + 0.18, 0.5, "square", 0.18);
        break;
      case "levelup": // 过关：上行号角
        this.blip(523, t, 0.12, "square", 0.28);
        this.blip(659, t + 0.10, 0.12, "square", 0.28);
        this.blip(784, t + 0.20, 0.14, "square", 0.28);
        this.blip(1046, t + 0.30, 0.20, "square", 0.28);
        break;
      case "victory": // 胜利：更长琶音
        var self = this;
        [523, 659, 784, 1046, 1318].forEach(function (f, i) {
          self.blip(f, t + i * 0.12, 0.20, "square", 0.28);
        });
        break;
    }
  };

  // 轻快 chiptune 循环（五声音阶，bass + 主旋律）
  AudioManager.prototype.startBGM = function () {
    this.resume();
    if (!this.ctx || this.bgmTimer) return;
    var bass = [130.8, 130.8, 174.6, 174.6, 196.0, 196.0, 174.6, 146.8];
    var lead = [523, 659, 784, 659, 587, 784, 880, 784];
    var spb = 0.22;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    var self = this;
    this.bgmTimer = setInterval(function () {
      if (!self.ctx) return;
      while (self.nextNoteTime < self.ctx.currentTime + 0.15) {
        var t = self.nextNoteTime;
        var i = self.step % 8;
        self.blip(bass[i], t, spb * 0.9, "triangle", 0.16);
        if (i % 2 === 0) self.blip(lead[i], t, spb * 0.8, "square", 0.10);
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

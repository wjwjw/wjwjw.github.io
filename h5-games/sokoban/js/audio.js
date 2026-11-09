/* audio.js —— 推箱子程序化音效与 BGM（Web Audio API，无外部音频文件）
 * 模式与 number-runner/flipping-bird 一致：事件音效用振荡器合成；
 * BGM 用方波/三角波 chiptune 循环，音阶随场景套装变化（startBGM(sceneIdx)）。
 * 自动播放策略：AudioContext 必须在用户手势内 resume()。
 * 兼容：经典脚本 + 构造函数原型，纯 ES5；无 AudioContext 时全部静默降级。 */
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
    /* 无音频设备的 WebView 可能在构造时抛异常，声音不该把游戏拖崩：
       resume() 被 sfx()/startBGM()/输入回调反复调用，这里抛会连带打断移动与按钮 */
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; this.master = null; }
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
  AudioManager.prototype.thud = function (t, dur, vol, freq) {
    // 低频“咚”声：用于推箱/撞墙的分量感
    if (!this.ctx) return;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq || 130, t);
    o.frequency.exponentialRampToValueAtTime(55, t + dur);
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  };

  // 事件音效
  AudioManager.prototype.sfx = function (type) {
    this.resume();
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    switch (type) {
      case "step":   // 空手走一步：极轻的嗒
        this.blip(240, t, 0.05, "triangle", 0.10, 200);
        break;
      case "push":   // 推箱：低频 + 摩擦
        this.thud(t, 0.12, 0.30, 150);
        this.blip(140, t, 0.10, "sawtooth", 0.10, 100);
        break;
      case "bump":   // 撞墙：闷响
        this.thud(t, 0.10, 0.24, 95);
        break;
      case "goal":   // 箱子入位：清脆叮
        this.blip(880, t, 0.09, "triangle", 0.30);
        this.blip(1320, t + 0.07, 0.12, "triangle", 0.26);
        break;
      case "undo":   // 撤销：短下滑
        this.blip(520, t, 0.10, "triangle", 0.18, 300);
        break;
      case "click":  // 界面点按
        this.blip(660, t, 0.05, "square", 0.14);
        break;
      case "start":  // 开局：上行琶音
        this.blip(523, t, 0.09, "square", 0.24);
        this.blip(659, t + 0.08, 0.09, "square", 0.24);
        this.blip(784, t + 0.16, 0.14, "square", 0.24);
        break;
      case "levelup": // 过关：号角
        this.blip(523, t, 0.12, "square", 0.26);
        this.blip(659, t + 0.10, 0.12, "square", 0.26);
        this.blip(784, t + 0.20, 0.14, "square", 0.26);
        this.blip(1046, t + 0.30, 0.20, "square", 0.26);
        break;
      case "victory": // 全部通关：长琶音
        var self = this;
        [523, 659, 784, 1046, 1318, 1568].forEach(function (f, i) {
          self.blip(f, t + i * 0.11, 0.20, "square", 0.26);
        });
        break;
    }
  };

  // chiptune BGM：五声音阶，bass + 主旋律；sceneIdx 换音阶/调高
  // 0 仓库(暖) 1 农场(明快) 2 冰雪(空灵) 3 太空(电音)
  AudioManager.prototype.startBGM = function (sceneIdx) {
    this.resume();
    if (!this.ctx || this.bgmTimer) return;
    var CFG = [
      { root: 0,   bass: [130.8, 130.8, 174.6, 174.6, 196.0, 196.0, 174.6, 146.8],
        lead: [523, 587, 659, 784, 659, 587, 523, 659], spb: 0.24 },
      { root: 0,   bass: [146.8, 146.8, 196.0, 196.0, 220.0, 220.0, 196.0, 164.8],
        lead: [659, 784, 880, 988, 880, 784, 659, 880], spb: 0.20 },
      { root: 0,   bass: [110.0, 110.0, 146.8, 146.8, 164.8, 164.8, 146.8, 123.5],
        lead: [440, 523, 659, 587, 523, 659, 440, 523], spb: 0.27 },
      { root: 0,   bass: [98.0, 98.0, 130.8, 130.8, 155.6, 155.6, 130.8, 116.5],
        lead: [392, 466, 587, 466, 392, 466, 587, 698], spb: 0.22 }
    ];
    var cfg = CFG[sceneIdx] || CFG[0];
    var spb = cfg.spb;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    var self = this;
    this.bgmTimer = setInterval(function () {
      if (!self.ctx) return;
      while (self.nextNoteTime < self.ctx.currentTime + 0.15) {
        var t = self.nextNoteTime;
        var i = self.step % 8;
        self.blip(cfg.bass[i], t, spb * 0.9, "triangle", 0.14);
        if (i % 2 === 0) self.blip(cfg.lead[i], t, spb * 0.8, "square", 0.09);
        if (i === 6) self.blip(cfg.lead[i] * 2, t, spb * 0.5, "sine", 0.05); // 点缀泛音
        self.step++;
        self.nextNoteTime += spb;
      }
    }, 40);
  };
  AudioManager.prototype.stopBGM = function () {
    if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
  };

  global.AudioManager = AudioManager;
})(typeof window !== 'undefined' ? window : this);

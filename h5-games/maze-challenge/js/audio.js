/* audio.js — 程序化电子音乐与音效（Web Audio API）
 * 设计：BGM 用方波/三角波做轻快 chiptune 循环；事件音效各有音色。
 * 浏览器自动播放策略：AudioContext 必须在用户手势内 resume()。 */
(function (global) {
  class AudioManager {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.bgmTimer = null;
      this.step = 0;
      this.nextNoteTime = 0;
    }
    ensure() {
      if (this.ctx) return;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    resume() {
      this.ensure();
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    }
    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
    }
    toggleMute() { this.setMuted(!this.muted); return this.muted; }

    // 单个音符
    blip(freq, t, dur, type = "square", vol = 0.3, glideTo = null) {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    noise(t, dur, vol = 0.25) {
      if (!this.ctx) return;
      const n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const g = this.ctx.createGain(); g.gain.value = vol;
      const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 800;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t);
    }

    sfx(type) {
      this.resume();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
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
        case "win":    [523, 659, 784, 1046].forEach((f, i) => this.blip(f, t + i * 0.12, 0.18, "square", 0.3)); break;
        case "lose":   [400, 330, 260].forEach((f, i) => this.blip(f, t + i * 0.14, 0.2, "triangle", 0.28)); break;
      }
    }

    // 轻快 chiptune 循环：C 大调五声，bass + 主旋律
    startBGM() {
      this.resume();
      if (!this.ctx || this.bgmTimer) return;
      const bass = [130.8, 130.8, 174.6, 174.6, 196.0, 196.0, 174.6, 146.8];
      const lead = [523, 659, 784, 659, 587, 784, 880, 784];
      const spb = 0.22; // 每步秒数（约 136 BPM 的八分音）
      this.step = 0;
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      this.bgmTimer = setInterval(() => {
        if (!this.ctx) return;
        while (this.nextNoteTime < this.ctx.currentTime + 0.15) {
          const t = this.nextNoteTime;
          const i = this.step % 8;
          this.blip(bass[i], t, spb * 0.9, "triangle", 0.18);
          if (i % 2 === 0) this.blip(lead[i], t, spb * 0.8, "square", 0.12);
          this.step++;
          this.nextNoteTime += spb;
        }
      }, 40);
    }
    stopBGM() {
      if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
    }
  }
  global.AudioManager = AudioManager;
})(window);

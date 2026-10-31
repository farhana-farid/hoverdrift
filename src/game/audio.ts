// ---------------------------------------------------------------------------
// Procedural WebAudio SFX — zero asset downloads, instant load, tiny bundle.
// Everything is synthesised from oscillators and one shared noise buffer.
// ---------------------------------------------------------------------------

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private boostSrc: AudioBufferSourceNode | null = null;
  private boostGain: GainNode | null = null;
  private volume = 0.6;
  private boostOn = false;

  /** Must be called from a user gesture (click / key / touch). */
  resume() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private init() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    this.master = master;

    const len = Math.floor(ctx.sampleRate * 1.2);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain = 0.15,
    slideTo?: number,
  ) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = this.now();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, gain: number, filterFreq: number, q = 1, sweepTo?: number) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, t);
    filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  shoot(overdrive = false) {
    if (!this.ctx) return;
    this.tone(overdrive ? 620 : 480, 0.09, 'square', 0.05, overdrive ? 180 : 140);
    this.noiseBurst(0.06, 0.06, 2400, 1.2, 600);
  }

  hit() {
    this.tone(880, 0.05, 'triangle', 0.05, 1320);
  }

  damaged() {
    this.noiseBurst(0.18, 0.16, 420, 0.9, 140);
    this.tone(140, 0.14, 'sawtooth', 0.06, 70);
  }

  explode() {
    this.noiseBurst(0.7, 0.35, 900, 0.6, 90);
    this.tone(90, 0.5, 'sine', 0.2, 35);
  }

  pickup(kind: 'health' | 'energy' | 'overdrive') {
    if (kind === 'health') {
      this.tone(520, 0.1, 'sine', 0.09, 620);
      setTimeout(() => this.tone(780, 0.14, 'sine', 0.08, 900), 70);
    } else if (kind === 'energy') {
      this.tone(440, 0.1, 'triangle', 0.08, 880);
    } else {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'square', 0.05), i * 55));
    }
  }

  kill() {
    [660, 880, 1180].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.08), i * 70));
  }

  ui(up = true) {
    this.tone(up ? 640 : 380, 0.05, 'sine', 0.05, up ? 820 : 300);
  }

  roundEnd(win: boolean) {
    const seq = win ? [523, 659, 784, 1046] : [392, 330, 262];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'triangle', 0.09), i * 160));
  }

  setBoost(on: boolean) {
    if (on === this.boostOn) return;
    this.boostOn = on;
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    if (on) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.14, ctx.currentTime, 0.06);
      src.connect(filter).connect(g).connect(this.master);
      src.start();
      this.boostSrc = src;
      this.boostGain = g;
    } else if (this.boostSrc && this.boostGain) {
      const g = this.boostGain;
      const src = this.boostSrc;
      g.gain.setTargetAtTime(0, this.now(), 0.08);
      setTimeout(() => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      }, 400);
      this.boostSrc = null;
      this.boostGain = null;
    }
  }

  silence() {
    this.setBoost(false);
  }
}

export const audio = new AudioEngine();

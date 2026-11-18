/** Tiny procedural sound effects (WebAudio oscillators, no assets).
 *  The context is created lazily on the first user gesture to satisfy
 *  autoplay policies. All calls are fail-safe. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private lastCrash = 0;

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType = 'square',
    gain = 0.06,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  enterCar(): void {
    this.tone(220, 0, 0.08, 'square', 0.05);
    this.tone(330, 0.07, 0.1, 'square', 0.05);
  }

  exitCar(): void {
    this.tone(330, 0, 0.07, 'square', 0.04);
    this.tone(220, 0.06, 0.09, 'square', 0.04);
  }

  missionStart(): void {
    this.tone(523, 0, 0.12, 'triangle', 0.07);
    this.tone(659, 0.12, 0.12, 'triangle', 0.07);
    this.tone(784, 0.24, 0.2, 'triangle', 0.07);
  }

  missionPass(): void {
    this.tone(523, 0, 0.12, 'triangle', 0.08);
    this.tone(659, 0.11, 0.12, 'triangle', 0.08);
    this.tone(784, 0.22, 0.12, 'triangle', 0.08);
    this.tone(1046, 0.33, 0.35, 'triangle', 0.08);
  }

  missionFail(): void {
    this.tone(330, 0, 0.18, 'sawtooth', 0.06);
    this.tone(233, 0.17, 0.18, 'sawtooth', 0.06);
    this.tone(165, 0.34, 0.4, 'sawtooth', 0.06);
  }

  wanted(): void {
    this.tone(880, 0, 0.1, 'square', 0.06);
    this.tone(880, 0.15, 0.1, 'square', 0.06);
    this.tone(880, 0.3, 0.1, 'square', 0.06);
  }

  busted(): void {
    this.tone(196, 0, 0.3, 'sawtooth', 0.07);
    this.tone(147, 0.28, 0.5, 'sawtooth', 0.07);
  }

  crash(strength: number): void {
    const now = performance.now();
    if (now - this.lastCrash < 150) return;
    this.lastCrash = now;
    const f = 90 + Math.min(strength, 20) * 8;
    this.tone(f, 0, 0.16, 'sawtooth', 0.05 + Math.min(strength, 16) * 0.003);
  }

  objective(): void {
    this.tone(740, 0, 0.09, 'triangle', 0.05);
    this.tone(988, 0.09, 0.14, 'triangle', 0.05);
  }
}

/**
 * Motor de sonido del cliente. Los efectos se sintetizan con la Web Audio API
 * (sin ficheros de audio) para que funcionen desde el primer momento; más
 * adelante se pueden sustituir por muestras reales sin cambiar la interfaz.
 *
 * El contexto de audio se crea tras un gesto del usuario (entrar en la sala)
 * para cumplir la política de autoplay de los navegadores.
 */

export class SoundEngine {
  private ctx: AudioContext | null = null;

  /** Debe llamarse desde un manejador de evento de usuario (clic/tecla). */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Reproduce un tono. `pan` va de -1 (izquierda) a 1 (derecha) para dar
   * sensación de dirección al mover la ficha.
   */
  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    pan = 0,
    startAt = 0,
    gain = 0.2,
  ): void {
    if (!this.ctx) return;
    const t = this.now() + startAt;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    osc.type = type;
    osc.frequency.value = freq;
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(panner).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** Ráfaga de ruido corta, para el traqueteo del dado. */
  private noise(duration: number, gain = 0.15): void {
    if (!this.ctx) return;
    const t = this.now();
    const frames = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    const amp = this.ctx.createGain();
    amp.gain.value = gain;
    src.buffer = buffer;
    src.connect(amp).connect(this.ctx.destination);
    src.start(t);
  }

  dice(): void {
    this.noise(0.35);
    this.tone(180, 0.08, 'square', 0, 0.05, 0.12);
    this.tone(140, 0.08, 'square', 0, 0.15, 0.12);
  }

  /** Paso de ficha; `pan` sitúa el sonido según la dirección. */
  move(pan = 0): void {
    this.tone(520, 0.09, 'triangle', pan, 0, 0.15);
  }

  correct(): void {
    this.tone(660, 0.12, 'sine', 0, 0, 0.22);
    this.tone(880, 0.16, 'sine', 0, 0.1, 0.22);
  }

  wrong(): void {
    this.tone(220, 0.18, 'sawtooth', 0, 0, 0.18);
    this.tone(160, 0.24, 'sawtooth', 0, 0.12, 0.18);
  }

  wedge(): void {
    this.tone(523, 0.15, 'sine', 0, 0, 0.2);
    this.tone(659, 0.15, 'sine', 0, 0.08, 0.2);
    this.tone(784, 0.25, 'sine', 0, 0.16, 0.2);
  }

  win(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.3, 'sine', 0, i * 0.18, 0.24));
  }

  /** Logro conseguido: arpegio ascendente y brillante, distinto del queso. */
  achievement(): void {
    const notes = [784, 988, 1175, 1568];
    notes.forEach((f, i) => this.tone(f, 0.22, 'triangle', 0, i * 0.09, 0.2));
  }
}

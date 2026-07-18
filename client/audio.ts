/**
 * Motor de sonido del cliente: reproduce muestras de audio (`.ogg`) desde
 * `public/sounds/` con la Web Audio API.
 *
 * El contexto de audio se crea tras un gesto del usuario (entrar en la sala)
 * para cumplir la política de autoplay de los navegadores; ahí mismo se precargan
 * y decodifican las muestras. Todo es best-effort: si una muestra no carga o el
 * navegador no sabe decodificarla, ese sonido simplemente no suena, nunca rompe
 * la partida (el juego no depende del audio: cada sonido tiene su anuncio de
 * texto equivalente para el lector de pantalla).
 */

/** Nombre lógico de cada efecto y el fichero que lo produce. */
const SOUND_FILES = {
  dice: 'dice.ogg',
  step1: 'step1.ogg',
  step2: 'step2.ogg',
  step3: 'step3.ogg',
  correct: 'correct.ogg',
  wrong: 'wrong.ogg',
  wedge: 'wedge.ogg',
  achievement: 'achievement.ogg',
  win: 'win.ogg',
  join: 'join.ogg',
  turn: 'turn.ogg',
  start: 'start.ogg',
} as const;

type SoundName = keyof typeof SOUND_FILES;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private stepIndex = 0;

  /** Debe llamarse desde un manejador de evento de usuario (clic/tecla). */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      void this.preload();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Descarga y decodifica todas las muestras en paralelo. */
  private async preload(): Promise<void> {
    if (!this.ctx) return;
    await Promise.all(
      (Object.keys(SOUND_FILES) as SoundName[]).map(async (name) => {
        try {
          const response = await fetch(`sounds/${SOUND_FILES[name]}`);
          const data = await response.arrayBuffer();
          this.buffers.set(name, await this.ctx!.decodeAudioData(data));
        } catch {
          /* muestra no disponible o no decodificable: ese sonido no sonará */
        }
      }),
    );
  }

  /**
   * Reproduce una muestra. `pan` va de -1 (izquierda) a 1 (derecha), para dar
   * sensación de dirección al mover la ficha; `gain` ajusta el volumen relativo.
   */
  private play(name: SoundName, pan = 0, gain = 1): void {
    const buffer = this.buffers.get(name);
    if (!this.ctx || !buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const amp = this.ctx.createGain();
    amp.gain.value = gain;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(amp).connect(panner).connect(this.ctx.destination);
    source.start();
  }

  dice(): void {
    this.play('dice');
  }

  /** Paso de ficha; `pan` sitúa el sonido según la dirección, y rota entre las
   * tres variantes para que un recorrido largo no suene monótono. */
  move(pan = 0): void {
    const variants: SoundName[] = ['step1', 'step2', 'step3'];
    this.play(variants[this.stepIndex % variants.length], pan);
    this.stepIndex += 1;
  }

  correct(): void {
    this.play('correct');
  }

  wrong(): void {
    this.play('wrong');
  }

  wedge(): void {
    this.play('wedge');
  }

  win(): void {
    this.play('win');
  }

  achievement(): void {
    this.play('achievement');
  }

  /** Otro jugador entra en la sala. */
  join(): void {
    this.play('join', 0, 0.7);
  }

  /** Empieza a ser tu turno. */
  turn(): void {
    this.play('turn', 0, 0.7);
  }

  /** Arranca la partida. */
  start(): void {
    this.play('start');
  }
}

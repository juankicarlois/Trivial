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
  correct: 'correct.ogg',
  wrong: 'wrong.ogg',
  wedge: 'wedge.ogg',
  achievement: 'achievement.ogg',
  win: 'win.ogg',
  join: 'join.ogg',
  turn: 'turn.ogg',
  start: 'start.ogg',
  rebound: 'rebound.ogg',
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

  /**
   * Reproduce una muestra situada en un punto del plano de la rueda, con el
   * oyente en el centro. Usa un `PannerNode` con HRTF: el eje X va a los lados y
   * el plano del tablero se mapea a delante/detrás, de modo que al moverse la
   * ficha el sonido orbita alrededor del oyente (recorrido por el anillo) o se
   * acerca y aleja (entrada y salida del centro).
   *
   * Es refuerzo, no el canal principal: el texto ya dice la casilla exacta. El
   * HRTF de la web distingue bien izquierda/derecha y la distancia; el
   * delante/detrás es más flojo (limitación conocida sin audio biaural dedicado).
   *
   * @param name Muestra a reproducir.
   * @param x Coordenada horizontal de la casilla (centro 0, anillo ±1).
   * @param y Coordenada vertical de la casilla (norte +1, sur −1).
   */
  private playPositioned(name: SoundName, x: number, y: number): void {
    const buffer = this.buffers.get(name);
    if (!this.ctx || !buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 0.6; // dentro de este radio, sin apenas atenuación
    panner.maxDistance = 3;
    panner.rolloffFactor = 0.8; // atenuación suave: el aviso principal es la dirección
    // Plano del tablero → espacio del oyente: x a la derecha, "norte" (y) al
    // frente (en Web Audio el frente es −Z).
    panner.positionX.value = x;
    panner.positionY.value = 0;
    panner.positionZ.value = -y;

    source.connect(panner).connect(this.ctx.destination);
    source.start();
  }

  dice(): void {
    this.play('dice');
  }

  /**
   * Paso de ficha situado en la casilla de destino `(x, y)` del tablero (oyente
   * en el centro). Alterna dos variantes (como pisadas) para que un recorrido
   * largo no suene monótono.
   */
  move(x = 0, y = 0): void {
    const variants: SoundName[] = ['step1', 'step2'];
    this.playPositioned(variants[this.stepIndex % variants.length], x, y);
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

  /**
   * Se abre el pulsador del rebote. Si la muestra propia no cargara, suena el
   * aviso de turno: ya significa "te toca reaccionar", y es preferible a
   * quedarse en silencio justo cuando hay que correr.
   */
  rebound(): void {
    if (this.buffers.has('rebound')) this.play('rebound');
    else this.play('turn');
  }
}

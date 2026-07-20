/**
 * Dado visual: dibuja la última tirada como una cara de dado con sus puntos y
 * dice quién la ha hecho. Es un complemento para quien ve y se marca
 * `aria-hidden`: el resultado ya llega al lector por el anuncio de la tirada
 * ("Fulano saca un 4"), que es la fuente de verdad.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Lado de la cara en unidades del viewBox. */
const FACE = 100;
/** Duración del volteo antes de asentar el número, en milisegundos. */
const ROLL_MS = 640;
/** Cada cuánto cambia de cara mientras rueda, en milisegundos. */
const FLIP_MS = 80;

/**
 * Posición de los puntos de cada cara, en fracciones del lado. Se describen una
 * a una en vez de calcularlas: son seis y así se leen de un vistazo.
 */
const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
};

/** true si quien mira ha pedido que no haya animaciones. */
function prefiereSinMovimiento(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class DiceView {
  private readonly root: HTMLElement;
  private readonly face: SVGSVGElement;
  private readonly pipLayer: SVGGElement;
  private readonly caption: HTMLParagraphElement;
  /** Temporizadores del volteo, para poder cortarlo si llega otra tirada. */
  private timers: number[] = [];

  /**
   * @param container Elemento donde vive el dado (se vacía y se rellena).
   */
  constructor(container: HTMLElement) {
    this.root = container;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true; // sin tirada todavía no hay nada que enseñar

    this.face = document.createElementNS(SVG_NS, 'svg');
    this.face.setAttribute('viewBox', `0 0 ${FACE} ${FACE}`);
    this.face.setAttribute('class', 'dice-face');
    this.face.setAttribute('role', 'presentation');

    const body = document.createElementNS(SVG_NS, 'rect');
    body.setAttribute('x', '4');
    body.setAttribute('y', '4');
    body.setAttribute('width', String(FACE - 8));
    body.setAttribute('height', String(FACE - 8));
    body.setAttribute('rx', '16');
    body.setAttribute('class', 'dice-body');
    this.face.appendChild(body);

    this.pipLayer = document.createElementNS(SVG_NS, 'g');
    this.face.appendChild(this.pipLayer);

    this.caption = document.createElement('p');
    this.caption.className = 'dice-caption';

    this.root.replaceChildren(this.face, this.caption);
  }

  /**
   * @brief Enseña una tirada: vuelca caras al azar un momento y asienta el
   *        resultado.
   *
   * El volteo dura lo mismo que el sonido del dado, así que lo que se ve y lo
   * que se oye acaban a la vez. Si llega otra tirada antes de terminar, la
   * anterior se corta para no encadenar dos animaciones.
   *
   * @param value Número sacado, de 1 a 6.
   * @param playerName Nombre de quien ha tirado.
   */
  show(value: number, playerName: string): void {
    this.stopRolling();
    this.root.hidden = false;
    this.caption.textContent = `${playerName}: ${value}`;

    if (prefiereSinMovimiento()) {
      this.drawFace(value);
      return;
    }

    this.face.classList.add('rolling');
    for (let t = 0; t < ROLL_MS; t += FLIP_MS) {
      this.timers.push(
        window.setTimeout(() => this.drawFace(1 + Math.floor(Math.random() * 6)), t),
      );
    }
    this.timers.push(
      window.setTimeout(() => {
        this.face.classList.remove('rolling');
        this.drawFace(value);
      }, ROLL_MS),
    );
  }

  /** @brief Esconde el dado (al empezar una partida no hay tirada que enseñar). */
  clear(): void {
    this.stopRolling();
    this.face.classList.remove('rolling');
    this.root.hidden = true;
    this.caption.textContent = '';
    this.pipLayer.replaceChildren();
  }

  private stopRolling(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
  }

  private drawFace(value: number): void {
    const pips = PIPS[value] ?? [];
    this.pipLayer.replaceChildren();
    for (const [fx, fy] of pips) {
      const pip = document.createElementNS(SVG_NS, 'circle');
      pip.setAttribute('cx', String(fx * FACE));
      pip.setAttribute('cy', String(fy * FACE));
      pip.setAttribute('r', '8');
      pip.setAttribute('class', 'dice-pip');
      this.pipLayer.appendChild(pip);
    }
  }
}

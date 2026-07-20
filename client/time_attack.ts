/**
 * Pantalla del modo contrarreloj: preguntas encadenadas contra el reloj, en
 * solitario. Sustituye a la pantalla de partida mientras dura la sesión.
 *
 * El reloj es lo delicado en un juego que se juega **oyendo**: un número que
 * baja en pantalla no sirve de nada. Por eso el tiempo se avisa por voz en
 * momentos concretos (un minuto, medio minuto, diez segundos) y se puede
 * preguntar cuando se quiera; el resto del tiempo, silencio, para no pisar la
 * pregunta que se está leyendo.
 */

import { categoryById } from '../shared/categories.js';
import type { TimeAttackResult, TimeAttackView } from '../shared/protocol.js';

/** "1 acierto" / "3 aciertos": el texto se oye, y el plural mal canta. */
function aciertos(n: number): string {
  return n === 1 ? '1 acierto' : `${n} aciertos`;
}

/** Segundos restantes en los que se avisa por voz, de mayor a menor. */
const AVISOS = [60, 30, 10];

export interface TimeAttackHooks {
  /** Manda una respuesta al servidor. */
  answer(optionIndex: number): void;
  /** Abandona la sesión. */
  quit(): void;
  /** Anuncia texto por el lector de pantalla. */
  announce(text: string): void;
  /** Sonidos de acierto/fallo/aviso. */
  sound: { correct(): void; wrong(): void; turn(): void };
}

export class TimeAttackScreen {
  private readonly screen: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly hooks: TimeAttackHooks;

  /** Momento local en que se acaba el tiempo, según el último estado recibido. */
  private deadline = 0;
  private ticker: number | null = null;
  /** Avisos ya dados en esta sesión, para no repetirlos. */
  private avisados = new Set<number>();
  private view: TimeAttackView | null = null;

  constructor(screen: HTMLElement, statusLine: HTMLElement, actions: HTMLElement, hooks: TimeAttackHooks) {
    this.screen = screen;
    this.statusLine = statusLine;
    this.actions = actions;
    this.hooks = hooks;
  }

  /** true si la sesión está en marcha (la pantalla es la suya). */
  get active(): boolean {
    return this.view !== null;
  }

  /**
   * @brief Refleja el estado recibido del servidor.
   * @param view Estado de la sesión, o null si ya no hay ninguna.
   */
  update(view: TimeAttackView | null): void {
    const empezaba = this.view === null && view !== null;
    this.view = view;

    if (!view) {
      this.stop();
      return;
    }

    this.screen.hidden = false;
    this.deadline = Date.now() + view.secondsLeft * 1000;

    if (empezaba) {
      this.avisados.clear();
      this.hooks.announce(
        `Contrarreloj. ${view.secondsLeft} segundos. Cada acierto suma un punto y cada fallo te quita ` +
          `${view.penaltySeconds}. Tu récord: ${view.best}.`,
      );
      this.startTicker();
    } else if (view.lastAnswer) {
      if (view.lastAnswer.correct) this.hooks.sound.correct();
      else this.hooks.sound.wrong();
    }

    this.render(view);
  }

  /** @brief Anuncia el resultado final y devuelve la pantalla a la partida. */
  finish(result: TimeAttackResult): void {
    this.stop();
    const cierre = result.endedEarly ? 'Contrarreloj dejado.' : 'Se acabó el tiempo.';
    const marca = result.isRecord
      ? `¡Nuevo récord! ${aciertos(result.score)}, superas tu ${result.previousBest}.`
      : `${aciertos(result.score)}. Tu récord sigue siendo ${result.previousBest}.`;
    this.hooks.announce(`${cierre} ${marca} Mejor racha: ${result.bestStreak}.`);
  }

  /** @brief Avisa de cuánto queda; lo usa el botón de consultar tiempo. */
  announceRemaining(): void {
    if (!this.view) return;
    this.hooks.announce(`Quedan ${this.secondsLeft()} segundos. Llevas ${aciertos(this.view.score)}.`);
  }

  private secondsLeft(): number {
    return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
  }

  /**
   * Reloj local: solo sirve para pintar los segundos y dar los avisos por voz.
   * Quien manda es el servidor, que es quien cierra la sesión.
   */
  private startTicker(): void {
    this.stopTicker();
    this.ticker = window.setInterval(() => {
      const quedan = this.secondsLeft();
      if (this.view) this.renderStatus(this.view, quedan);
      for (const aviso of AVISOS) {
        if (quedan <= aviso && !this.avisados.has(aviso)) {
          this.avisados.add(aviso);
          this.hooks.sound.turn();
          this.hooks.announce(aviso >= 60 ? 'Un minuto.' : `${aviso} segundos.`);
        }
      }
    }, 1000);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  /** Cierra la pantalla y deja de contar. */
  private stop(): void {
    this.stopTicker();
    this.view = null;
    this.screen.hidden = true;
    this.actions.replaceChildren();
    this.statusLine.textContent = '';
  }

  private renderStatus(view: TimeAttackView, quedan = this.secondsLeft()): void {
    this.statusLine.textContent = `${quedan} s · ${aciertos(view.score)} · récord ${view.best}`;
  }

  private render(view: TimeAttackView): void {
    this.renderStatus(view);
    this.actions.replaceChildren();

    const heading = document.createElement('p');
    heading.className = 'question-text';
    heading.textContent = `${categoryById(view.question.category).name}: ${view.question.text}`;
    this.actions.append(heading);

    const opts = document.createElement('div');
    opts.className = 'options';
    view.question.options.forEach((text, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${index + 1}. ${text}`;
      btn.addEventListener('click', () => this.hooks.answer(index));
      opts.append(btn);
      if (index === 0) queueMicrotask(() => btn.focus());
    });
    this.actions.append(opts);

    const row = document.createElement('div');
    row.className = 'action-row';
    const tiempo = document.createElement('button');
    tiempo.type = 'button';
    tiempo.className = 'secondary';
    tiempo.textContent = 'Cuánto tiempo queda';
    tiempo.addEventListener('click', () => this.announceRemaining());
    const salir = document.createElement('button');
    salir.type = 'button';
    salir.className = 'secondary';
    salir.textContent = 'Dejarlo';
    salir.addEventListener('click', () => this.hooks.quit());
    row.append(tiempo, salir);
    this.actions.append(row);

    // La pregunta se lee entera con sus opciones: aquí no hay tablero ni turnos
    // que den contexto, y hay prisa. Antes va el resultado de la anterior, que
    // es lo que dice si hay que cambiar de ritmo.
    const previo = view.lastAnswer
      ? view.lastAnswer.correct
        ? '¡Bien! '
        : `Fallo, era ${view.lastAnswer.correctText}. Menos ${view.penaltySeconds} segundos. `
      : '';
    const opciones = view.question.options.map((o, i) => `${i + 1}, ${o}`).join('. ');
    this.hooks.announce(`${previo}${view.question.text}. Opciones: ${opciones}`);
  }
}

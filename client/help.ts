/**
 * Manual del juego: muestra la pantalla de ayuda por encima de la que hubiera y
 * la devuelve al cerrarse. El contenido es HTML estático (en `index.html`); aquí
 * solo se gestiona abrir, cerrar y el foco.
 *
 * El foco es lo que hace la ayuda usable con lector de pantalla: al abrir se
 * lleva al título (para leer desde el principio) y al cerrar se devuelve al
 * botón que la abrió, para no perder el sitio.
 */

/** Pantallas entre las que se alterna; la ayuda tapa a la que estuviera activa. */
export interface HelpScreens {
  help: HTMLElement;
  /** Todas las pantallas que la ayuda puede tapar (para restaurar la visible). */
  others: HTMLElement[];
}

export class HelpScreen {
  private readonly help: HTMLElement;
  private readonly others: HTMLElement[];
  /** Pantalla que estaba visible al abrir la ayuda, para restaurarla al cerrar. */
  private previous: HTMLElement | null = null;
  /** Botón que abrió la ayuda, para devolverle el foco al cerrar. */
  private opener: HTMLElement | null = null;

  constructor(screens: HelpScreens) {
    this.help = screens.help;
    this.others = screens.others;

    // Cualquier botón con data-help-close cierra (hay uno arriba y otro abajo).
    for (const btn of this.help.querySelectorAll<HTMLElement>('[data-help-close]')) {
      btn.addEventListener('click', () => this.close());
    }
    // Escape cierra, como es de esperar en una pantalla de ayuda.
    this.help.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
    });
  }

  /** true si la ayuda está abierta. */
  get open(): boolean {
    return !this.help.hidden;
  }

  /**
   * @brief Abre el manual tapando la pantalla visible.
   * @param opener Botón que lo abre; recuperará el foco al cerrarse.
   */
  show(opener: HTMLElement): void {
    if (this.open) return;
    this.opener = opener;
    this.previous = this.others.find((s) => !s.hidden) ?? null;
    if (this.previous) this.previous.hidden = true;
    this.help.hidden = false;
    this.help.focus(); // el título tiene tabindex -1: el lector empieza por él
  }

  /** @brief Cierra el manual y restaura la pantalla anterior y el foco. */
  close(): void {
    if (!this.open) return;
    this.help.hidden = true;
    if (this.previous) this.previous.hidden = false;
    this.previous = null;
    this.opener?.focus();
    this.opener = null;
  }
}

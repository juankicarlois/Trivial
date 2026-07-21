/**
 * Historial de los avisos que ha oído el jugador.
 *
 * La región de anuncios es efímera: si el lector pisa un aviso, o el jugador se
 * distrae medio segundo, ese mensaje se pierde y no hay forma de recuperarlo
 * (quien ve la pantalla, en cambio, siempre puede releer). Aquí se guardan los
 * últimos avisos para poder repetirlos a demanda con Alt+número.
 *
 * Sin DOM, para poder probarlo.
 */

/** Avisos que se recuerdan; uno por tecla de la fila de números. */
export const HISTORY_SIZE = 10;

export class MessageHistory {
  /** Del más reciente al más antiguo, como los pide el jugador. */
  private items: string[] = [];

  /** Guarda un aviso recién anunciado, descartando el más viejo si sobra. */
  record(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.items.unshift(clean);
    if (this.items.length > HISTORY_SIZE) this.items.length = HISTORY_SIZE;
  }

  /** Cuántos avisos hay guardados. */
  get size(): number {
    return this.items.length;
  }

  /**
   * @brief Frase para repetir el aviso número `n`, contando desde el último.
   *
   * Se antepone el número porque, oyendo varios seguidos, sin él no se sabe en
   * qué punto del historial se está.
   *
   * @param n 1 es el último aviso, 10 el más antiguo que se guarda.
   * @return El aviso listo para anunciar, o el motivo por el que no está.
   */
  recall(n: number): string {
    if (n < 1 || n > HISTORY_SIZE) return 'No hay ningún mensaje con ese número.';
    const text = this.items[n - 1];
    if (text) return `Mensaje ${n}. ${text}`;
    if (this.items.length === 0) return 'Todavía no hay mensajes.';
    const total = this.items.length;
    return `No hay mensaje ${n}. Solo hay ${total} mensaje${total === 1 ? '' : 's'}.`;
  }
}

/**
 * @brief Traduce una tecla de la fila de números al número de aviso.
 *
 * El 0 es el décimo: es la tecla que sigue al 9 en la fila, y así los diez
 * caben en una pasada de izquierda a derecha.
 *
 * Con Alt pulsado hay teclados en los que `key` no es el dígito sino el símbolo
 * que Alt produce, así que se mira también `code`, que es la tecla física.
 *
 * @param key Valor de `KeyboardEvent.key`.
 * @param code Valor de `KeyboardEvent.code`, si se tiene.
 * @return Número de aviso (1..10), o null si la tecla no es un dígito.
 */
export function historyIndexFromKey(key: string, code = ''): number | null {
  const digit =
    key.length === 1 && key >= '0' && key <= '9'
      ? Number(key)
      : /^(Digit|Numpad)[0-9]$/.test(code)
        ? Number(code.slice(-1))
        : null;
  if (digit === null) return null;
  return digit === 0 ? HISTORY_SIZE : digit;
}

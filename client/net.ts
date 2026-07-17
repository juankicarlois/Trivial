/**
 * Conexión WebSocket con el servidor. Reconecta automáticamente si se cae la
 * conexión, para no perder la partida por un corte breve.
 */

import type { ClientMessage, ServerMessage } from '../shared/protocol.js';

export interface NetHandlers {
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  onClose(): void;
}

export class Net {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly handlers: NetHandlers;
  private reconnectTimer: number | null = null;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = `${proto}://${location.host}/ws`;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('open', () => this.handlers.onOpen());
    this.ws.addEventListener('message', (ev) => {
      try {
        this.handlers.onMessage(JSON.parse(ev.data as string) as ServerMessage);
      } catch {
        /* mensaje ilegible: se ignora */
      }
    });
    this.ws.addEventListener('close', () => {
      this.handlers.onClose();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  /**
   * @brief Envía un mensaje al servidor si hay conexión.
   * @param message Mensaje a enviar.
   * @return true si se envió; false si no había conexión y se ha descartado.
   *
   * Quien llama debe atender al `false`: descartar en silencio deja mandos que
   * no responden y sin ninguna explicación para el jugador.
   */
  send(message: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

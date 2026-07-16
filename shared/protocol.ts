/**
 * Protocolo de red entre cliente y servidor (WebSocket, JSON).
 *
 * El servidor es la autoridad: mantiene el estado de la sala, valida cada acción
 * y difunde el estado resultante junto con eventos puntuales (para sonidos y
 * anuncios). El cliente solo renderiza estado y reproduce eventos.
 */

import type { CategoryId } from './categories.js';

/** Pregunta tal como la ve el cliente: sin la respuesta correcta. */
export interface PublicQuestion {
  id: string;
  category: CategoryId;
  text: string;
  /** Opciones de respuesta (múltiple opción, accesible por teclado). */
  options: string[];
  /** true si es la pregunta del centro para ganar la partida. */
  forWin: boolean;
}

export type TurnPhase =
  /** En el vestíbulo, esperando a que empiece la partida. */
  | 'lobby'
  /** Turno del jugador actual: debe tirar el dado. */
  | 'awaitRoll'
  /** Movimiento en curso: el jugador elige dirección paso a paso. */
  | 'moving'
  /** Pregunta planteada: se espera respuesta del jugador actual. */
  | 'awaitAnswer'
  /** Partida terminada. */
  | 'gameOver';

export interface PlayerView {
  id: string;
  name: string;
  /** Nodo del tablero donde está la ficha. */
  nodeId: string;
  /** Categorías cuyo queso ya ha ganado. */
  wedges: CategoryId[];
  connected: boolean;
}

/** Estado público de la sala que reciben todos los clientes. */
export interface GameView {
  roomCode: string;
  phase: TurnPhase;
  players: PlayerView[];
  /** Índice del jugador cuyo turno es (en `players`). */
  currentPlayerIndex: number;
  /** Movimiento en curso, si `phase === 'moving'`. */
  movement?: {
    remaining: number;
    /** Nodos a los que el jugador puede avanzar en este paso. */
    options: string[];
  };
  /** Pregunta activa, si `phase === 'awaitAnswer'`. */
  question?: PublicQuestion;
  winnerId?: string;
}

/** Eventos puntuales para sonidos y anuncios; no llevan estado, lo refuerzan. */
export type GameEvent =
  | { kind: 'playerJoined'; playerId: string; name: string }
  | { kind: 'gameStarted' }
  | { kind: 'diceRolled'; playerId: string; value: number }
  | { kind: 'moved'; playerId: string; toNodeId: string }
  | { kind: 'landed'; playerId: string; nodeId: string; category: CategoryId }
  /** `correctText` permite a la mesa saber cuál era la respuesta buena. */
  | { kind: 'answered'; playerId: string; correct: boolean; correctText: string }
  | { kind: 'wedgeEarned'; playerId: string; category: CategoryId }
  | { kind: 'turnChanged'; playerId: string }
  | { kind: 'gameWon'; playerId: string };

/** Mensajes que el cliente envía al servidor. */
export type ClientMessage =
  | { type: 'join'; roomCode: string; name: string }
  | { type: 'start' }
  | { type: 'roll' }
  | { type: 'move'; toNodeId: string }
  | { type: 'answer'; optionIndex: number };

/** Mensajes que el servidor envía al cliente. */
export type ServerMessage =
  | { type: 'joined'; playerId: string }
  | { type: 'state'; state: GameView }
  | { type: 'event'; event: GameEvent }
  | { type: 'error'; message: string };

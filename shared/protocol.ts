/**
 * Protocolo de red entre cliente y servidor (WebSocket, JSON).
 *
 * El servidor es la autoridad: mantiene el estado de la sala, valida cada acción
 * y difunde el estado resultante junto con eventos puntuales (para sonidos y
 * anuncios). El cliente solo renderiza estado y reproduce eventos.
 */

import type { CategoryId } from './categories.js';
import type { ProfileStats } from './progress.js';
import type { BotDifficulty } from './bot.js';

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
  /**
   * El jugador actual ha llegado al centro con los seis quesos: se espera a que
   * un rival elija la categoría de la pregunta final.
   */
  | 'awaitFinalCategory'
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
  /** true si lo maneja el servidor (no es una persona). */
  isBot: boolean;
  /** Dificultad, solo si es bot. */
  difficulty?: BotDifficulty;
}

/** Un pack temático tal como lo ve la sala. */
export interface PackView {
  id: string;
  name: string;
  description: string;
  /**
   * Lo ha desbloqueado alguien de la sala, así que puede activarse aquí: quien
   * se lo ha ganado lo trae a la mesa para todos.
   */
  unlocked: boolean;
  /** Está activo para esta partida. */
  enabled: boolean;
  /** Nombre del logro que hace falta para desbloquearlo. */
  requires: string;
}

/** Un logro con el progreso del jugador que lo consulta. */
export interface AchievementView {
  id: string;
  name: string;
  description: string;
  unlocked: boolean;
  /** Valor actual de la estadística medida. */
  progress: number;
  /** Valor necesario para conseguirlo. */
  target: number;
}

/** Estado público de la sala que reciben todos los clientes. */
export interface GameView {
  roomCode: string;
  phase: TurnPhase;
  players: PlayerView[];
  /** Índice del jugador cuyo turno es (en `players`). */
  currentPlayerIndex: number;
  /** Packs temáticos y su estado en esta sala. */
  packs: PackView[];
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
  /** Ha completado los seis quesos: su objetivo pasa a ser volver al centro. */
  | { kind: 'allWedgesEarned'; playerId: string }
  | { kind: 'turnChanged'; playerId: string }
  /** Ha alcanzado el tope de aciertos seguidos en un turno y cede la vez. */
  | { kind: 'turnLimitReached'; playerId: string; limit: number }
  | { kind: 'gameWon'; playerId: string }
  /** `playerId` va a por la victoria; sus rivales deben elegir la categoría. */
  | { kind: 'awaitingFinalCategory'; playerId: string }
  /** Un rival ha elegido la categoría de la pregunta final. */
  | { kind: 'finalCategoryChosen'; byPlayerId: string; category: CategoryId }
  | { kind: 'achievementUnlocked'; playerId: string; name: string; description: string }
  | { kind: 'packUnlocked'; playerId: string; packName: string };

/** Mensajes que el cliente envía al servidor. */
export type ClientMessage =
  /** `profileId` identifica al jugador entre partidas para guardar su progreso. */
  | { type: 'join'; roomCode: string; name: string; profileId: string }
  | { type: 'start' }
  | { type: 'roll' }
  | { type: 'move'; toNodeId: string }
  | { type: 'answer'; optionIndex: number }
  /** Un rival elige la categoría de la pregunta final del jugador actual. */
  | { type: 'chooseFinalCategory'; category: CategoryId }
  /** Añade un bot a la sala (solo en el vestíbulo). */
  | { type: 'addBot'; difficulty: BotDifficulty }
  /** Quita un bot de la sala (solo en el vestíbulo). */
  | { type: 'removeBot'; playerId: string }
  | { type: 'setPack'; packId: string; enabled: boolean };

/** Mensajes que el servidor envía al cliente. */
export type ServerMessage =
  | { type: 'joined'; playerId: string }
  | { type: 'state'; state: GameView }
  /** Progreso propio; solo se envía a su dueño. */
  | { type: 'profile'; stats: ProfileStats; achievements: AchievementView[] }
  | { type: 'event'; event: GameEvent }
  | { type: 'error'; message: string };

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
  /**
   * El jugador del turno ha fallado y la pregunta queda en el aire: cualquier
   * rival puede pulsar para quedársela, durante un tiempo limitado.
   */
  | 'awaitRebound'
  /** Partida terminada. */
  | 'gameOver';

/**
 * Modo de la sala, que fija quien la crea. No se mezclan: o todos juegan por su
 * cuenta, o todos en equipos.
 */
export type GameMode = 'individual' | 'teams';

/** Número máximo de equipos en una partida por equipos. */
export const MAX_TEAMS = 4;

/**
 * Bando que juega: en modo individual hay uno por jugador; en equipos, uno por
 * equipo. La **ficha y los quesos son del bando**, no de la persona: en un
 * equipo se comparten.
 */
export interface TeamView {
  id: string;
  /** "Equipo 1"… en equipos; el nombre del jugador en individual. */
  name: string;
  /** Nodo del tablero donde está su ficha. */
  nodeId: string;
  /** Categorías cuyo queso ya ha ganado el bando. */
  wedges: CategoryId[];
  /** Jugadores que lo forman, en orden de rotación al responder. */
  memberIds: string[];
}

/**
 * Comodines de un jugador. Cada uno se puede usar una vez por partida. De
 * momento solo hay uno; el tipo es un enum para poder añadir más sin tocar el
 * andamiaje (inventario, mensajes, vista).
 *
 * - `changeQuestion`: descarta la pregunta actual y plantea otra de la misma
 *   categoría. Para cuando no tienes ni idea del tema que te ha tocado.
 */
export type WildcardId = 'changeQuestion';

/** Todos los comodines que existen, en el orden en que se ofrecen. */
export const WILDCARDS: readonly WildcardId[] = ['changeQuestion'];

export interface PlayerView {
  id: string;
  name: string;
  connected: boolean;
  /** true si lo maneja el servidor (no es una persona). */
  isBot: boolean;
  /** Dificultad, solo si es bot. */
  difficulty?: BotDifficulty;
  /** Equipo elegido en el vestíbulo (1..MAX_TEAMS); null si aún no ha elegido. */
  team: number | null;
  /** Comodines que le quedan por gastar en esta partida. */
  wildcards: WildcardId[];
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
  /** Modo de juego; lo fija quien crea la sala, antes de empezar. */
  mode: GameMode;
  /** Jugador que creó la sala: el único que puede cambiar el modo. */
  hostId: string | null;
  phase: TurnPhase;
  players: PlayerView[];
  /** Bandos en juego (uno por jugador en individual, uno por equipo en equipos). */
  teams: TeamView[];
  /** Índice del bando cuyo turno es (en `teams`). */
  currentTeamIndex: number;
  /** Jugador al que le toca actuar: el miembro de turno del bando actual. */
  actingPlayerId: string | null;
  /** Packs temáticos y su estado en esta sala. */
  packs: PackView[];
  /** Movimiento en curso, si `phase === 'moving'`. */
  movement?: {
    remaining: number;
    /** Nodos a los que puede avanzar la ficha en este paso. */
    options: string[];
  };
  /** Pregunta activa, si `phase === 'awaitAnswer'` o `'awaitRebound'`. */
  question?: PublicQuestion;
  /** Rebote abierto, si `phase === 'awaitRebound'`. */
  rebound?: {
    /** Bandos que pueden pulsar (todos menos el que ha fallado). */
    eligibleTeamIds: string[];
    /** Segundos que dura el pulsador desde que se abre. */
    seconds: number;
  };
  /** Bando ganador, si la partida ha terminado. */
  winnerTeamId?: string;
}

/**
 * Eventos puntuales para sonidos y anuncios; no llevan estado, lo refuerzan.
 *
 * Los que afectan al bando llevan `teamId` además de `playerId`: en equipos hay
 * que decir de qué equipo se trata y quién responde por él.
 */
export type GameEvent =
  | { kind: 'playerJoined'; playerId: string; name: string }
  | { kind: 'gameStarted' }
  | { kind: 'diceRolled'; playerId: string; value: number }
  | { kind: 'moved'; playerId: string; toNodeId: string }
  | { kind: 'landed'; playerId: string; nodeId: string; category: CategoryId }
  /**
   * `correctText` permite a la mesa saber cuál era la respuesta buena. **Se
   * omite si la pregunta va a rebotar**: cantarla ahí sería regalársela a quien
   * puede quedársela. En ese caso llega después, por `answerRevealed`.
   */
  | { kind: 'answered'; playerId: string; correct: boolean; correctText?: string }
  /**
   * Se destapa la respuesta de una pregunta que quedó en el aire. Va a toda la
   * mesa cuando el rebote se resuelve, y en privado a quien falló mientras el
   * rebote sigue abierto (él ya no puede volver a contestarla).
   */
  | { kind: 'answerRevealed'; correctText: string }
  /** `playerId` ha usado un comodín; la interfaz lo anuncia. */
  | { kind: 'wildcardUsed'; playerId: string; wildcard: WildcardId }
  | { kind: 'wedgeEarned'; teamId: string; playerId: string; category: CategoryId }
  /** El bando ha completado los seis quesos: ahora debe volver al centro. */
  | { kind: 'allWedgesEarned'; teamId: string }
  /** Empieza el turno de `teamId`; responde por él `playerId`. */
  | { kind: 'turnChanged'; teamId: string; playerId: string }
  /** Ha alcanzado el tope de aciertos seguidos en un turno y cede la vez. */
  | { kind: 'turnLimitReached'; teamId: string; limit: number }
  /** La pregunta fallada queda libre: los rivales pueden pulsar `seconds` segundos. */
  | { kind: 'reboundOpened'; failedTeamId: string; seconds: number }
  /** `playerId` ha pulsado primero: la pregunta es suya. */
  | { kind: 'reboundClaimed'; teamId: string; playerId: string }
  /** Nadie ha pulsado a tiempo: la pregunta se pierde y sigue el juego. */
  | { kind: 'reboundExpired' }
  /**
   * Rebote acertado: el bando salta a la casilla del que falló (`nodeId`) y, si
   * era una sede cuyo queso le faltaba, se lo lleva (llega aparte en
   * `wedgeEarned`).
   */
  | { kind: 'reboundWon'; teamId: string; playerId: string; nodeId: string }
  | { kind: 'gameWon'; teamId: string }
  /** `teamId` va a por la victoria; sus rivales deben elegir la categoría. */
  | { kind: 'awaitingFinalCategory'; teamId: string }
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
  /** Pulsador del rebote: quien llega primero se queda la pregunta fallada. */
  | { type: 'buzz' }
  /** Usa un comodín sobre la pregunta en curso. */
  | { type: 'useWildcard'; wildcard: WildcardId }
  /** Empieza una sesión de contrarreloj (en solitario, al margen de la sala). */
  | { type: 'startTimeAttack' }
  | { type: 'answerTimeAttack'; optionIndex: number }
  /** Deja el contrarreloj antes de que se acabe el tiempo. */
  | { type: 'quitTimeAttack' }
  /** Un rival elige la categoría de la pregunta final del bando actual. */
  | { type: 'chooseFinalCategory'; category: CategoryId }
  /** Fija el modo de la sala; solo lo puede hacer quien la creó. */
  | { type: 'setMode'; mode: GameMode }
  /** Elige tu equipo (1..MAX_TEAMS) o null para dejarlo sin elegir. */
  | { type: 'chooseTeam'; team: number | null }
  /** Asigna equipo a un bot (los bots no eligen solos). */
  | { type: 'setBotTeam'; playerId: string; team: number | null }
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
  /** Estado del contrarreloj propio; `null` cuando no hay sesión en marcha. */
  | { type: 'timeAttack'; view: TimeAttackView | null }
  /** Se acabó el contrarreloj: marca final y si es récord. */
  | { type: 'timeAttackResult'; result: TimeAttackResult }
  | { type: 'error'; message: string };

/**
 * Estado de una sesión de contrarreloj. Es **de un solo jugador**: no viaja a la
 * sala, solo a quien la está jugando.
 */
export interface TimeAttackView {
  /** Segundos que quedan (ya descontadas las penalizaciones por fallo). */
  secondsLeft: number;
  /** Aciertos acumulados en esta sesión. */
  score: number;
  /** Pregunta que hay que contestar ahora. */
  question: PublicQuestion;
  /** Mejor marca del jugador antes de esta sesión, para saber qué batir. */
  best: number;
  /** Segundos que cuesta cada fallo. */
  penaltySeconds: number;
  /**
   * Cómo fue la respuesta anterior, para poder cantarla al plantear la
   * siguiente. Ausente en la primera pregunta de la sesión.
   */
  lastAnswer?: { correct: boolean; correctText: string };
}

/** Resultado de una sesión de contrarreloj terminada. */
export interface TimeAttackResult {
  score: number;
  /** Mejor marca previa (la que había que batir). */
  previousBest: number;
  /** true si esta sesión ha establecido un récord nuevo. */
  isRecord: boolean;
  /** Aciertos seguidos más largos de la sesión. */
  bestStreak: number;
  /** true si se dejó a medias en vez de agotarse el tiempo. */
  endedEarly: boolean;
}

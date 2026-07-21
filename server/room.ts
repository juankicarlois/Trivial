/**
 * Sala de juego: mantiene el estado de una partida y aplica las reglas. Es la
 * autoridad — valida cada acción y difunde el estado resultante más eventos
 * puntuales (para sonidos y anuncios en el cliente).
 *
 * **Bandos.** La ficha y los quesos pertenecen a un *bando*, no a una persona.
 * En modo individual hay un bando por jugador; en modo por equipos, un bando por
 * equipo y sus miembros **rotan**: cada turno responde uno distinto. Así hay una
 * sola ruta de código para ambos modos, sin duplicar reglas.
 *
 * También lleva el progreso de los jugadores: actualiza sus estadísticas,
 * comprueba los logros y expone los packs temáticos que la mesa puede activar.
 *
 * El transporte (envío por WebSocket) se inyecta para poder testear la lógica
 * sin red.
 */

import { buildBoard, type Board } from '../shared/board.js';
import { CATEGORIES, type CategoryId } from '../shared/categories.js';
import type { Question } from '../shared/questions.js';
import { earnedAchievements, statValue } from '../shared/progress.js';
import {
  MAX_TEAMS,
  WILDCARDS,
  type AchievementView,
  type GameEvent,
  type GameMode,
  type GameSummaryView,
  type GameView,
  type PackView,
  type PlayerView,
  type PublicQuestion,
  type ServerMessage,
  type TeamView,
  type TurnPhase,
  type WildcardId,
} from '../shared/protocol.js';
import { legalMoves, rollDie } from './engine.js';
import { botAnswerIndex, botBuzzDelayMs, chooseBotFinalCategory, chooseBotMove } from './bot.js';
import type { QuestionRepository } from './questions_repo.js';
import type { GameContent } from './content.js';
import type { Profile, ProfileStore } from './profiles.js';
import type { BotDifficulty } from '../shared/bot.js';

/**
 * Programa una acción diferida y devuelve una función para cancelarla (por
 * defecto, con setTimeout). Inyectable para test.
 */
export type Scheduler = (action: () => void, delayMs: number) => () => void;

/**
 * Retardo de las acciones de los bots, para que la mesa las pueda seguir. Se
 * sortea en cada acción dentro de esta franja: con un retardo fijo los bots
 * juegan a un tictac mecánico que atropella la conversación de la mesa, y quien
 * escucha con lector de pantalla no llega a enterarse de lo que ha pasado.
 */
const BOT_DELAY_MIN_MS = 10_000;
const BOT_DELAY_MAX_MS = 15_000;

/**
 * Aciertos seguidos que puede encadenar un bando en un mismo turno antes de
 * ceder la vez. Sin tope, quien domina el juego puede acaparar la partida
 * entera y el resto se aburre esperando.
 */
const MAX_CORRECT_PER_TURN = 3;

/**
 * Tiempo que los rivales tienen para pulsar el rebote. Se cuenta desde que se
 * anuncia, no desde que se planteó la pregunta: así todos arrancan a la vez y
 * quien navega con lector de pantalla no sale perdiendo por leer más despacio.
 * Ocho segundos dan margen a oír el aviso y reaccionar sin que la mesa se pare.
 */
const REBOUND_MS = 8000;

/** Envío de mensajes a los clientes de la sala. */
export interface Transport {
  broadcast(message: ServerMessage): void;
  /** Envía solo a un jugador (para datos suyos, como su progreso). */
  sendTo(playerId: string, message: ServerMessage): void;
}

interface InternalPlayer {
  id: string;
  name: string;
  /** Identidad persistente, para acumular estadísticas y logros. */
  profileId: string;
  connected: boolean;
  /** Aciertos seguidos en la partida en curso (para la racha del perfil). */
  streak: number;
  /** true si lo maneja el servidor (bot); los bots no tienen perfil ni logros. */
  isBot: boolean;
  /** Dificultad, solo si es bot. */
  difficulty?: BotDifficulty;
  /** Equipo elegido en el vestíbulo (1..MAX_TEAMS); null si no ha elegido. */
  team: number | null;
  /** Comodines que le quedan por gastar en la partida en curso. */
  wildcards: WildcardId[];
  /** Marcador de la partida en curso, para el resumen final. */
  game: PlayerGameStats;
}

/** Lo que se cuenta de un jugador durante una partida, para su resumen final. */
interface PlayerGameStats {
  answered: number;
  correct: number;
  correctByCategory: Record<CategoryId, number>;
  wrongByCategory: Record<CategoryId, number>;
  bestStreak: number;
  wedges: number;
  reboundsWon: number;
  wildcardsUsed: number;
}

/** @brief Marcador de partida a cero, con todas las categorías presentes. */
function emptyGameStats(): PlayerGameStats {
  const porCategoria = (): Record<CategoryId, number> => {
    const map = {} as Record<CategoryId, number>;
    for (const cat of CATEGORIES) map[cat.id] = 0;
    return map;
  };
  return {
    answered: 0,
    correct: 0,
    correctByCategory: porCategoria(),
    wrongByCategory: porCategoria(),
    bestStreak: 0,
    wedges: 0,
    reboundsWon: 0,
    wildcardsUsed: 0,
  };
}

/** Bando en juego: dueño de la ficha y de los quesos. */
interface InternalTeam {
  id: string;
  name: string;
  nodeId: string;
  wedges: CategoryId[];
  memberIds: string[];
  /** Miembro que responde en el próximo turno del bando (van rotando). */
  activeMemberIndex: number;
}

/**
 * Pregunta fallada que sigue en el aire. Mientras el pulsador está abierto
 * (`claimedByTeamIndex === null`) cualquier bando de `eligibleTeamIndices` puede
 * quedársela; luego responde solo quien pulsó.
 */
interface Rebound {
  /** Pregunta que se quedó sin acertar. */
  question: Question;
  /** Casilla donde estaba quien falló: el premio si el rebote se acierta. */
  nodeId: string;
  /** Bandos que pueden pulsar (todos menos el que falló). */
  eligibleTeamIndices: number[];
  /** Bando que ha pulsado primero; null mientras el pulsador sigue abierto. */
  claimedByTeamIndex: number | null;
  /** Miembro que responde por el bando que pulsó. */
  claimedByPlayerId: string | null;
}

interface Movement {
  remaining: number;
  /** Nodo del que se viene (para no oscilar); null en el primer paso. */
  cameFrom: string | null;
  /** Direcciones disponibles cuando se espera elección. */
  options: string[];
}

export class Room {
  readonly code: string;
  private readonly board: Board = buildBoard();
  private readonly repo: QuestionRepository;
  private readonly content: GameContent;
  private readonly profiles: ProfileStore;
  private readonly transport: Transport;

  private players: InternalPlayer[] = [];
  private teams: InternalTeam[] = [];
  private mode: GameMode = 'individual';
  private hostId: string | null = null;
  private phase: TurnPhase = 'lobby';
  private currentTeamIndex = 0;
  private movement: Movement | null = null;
  private question: (Question & { forWin: boolean }) | null = null;
  /** Opciones descartadas por el 50/50 en la pregunta actual (índices). */
  private eliminatedOptions: number[] = [];
  private winnerTeamId: string | null = null;
  /** Packs temáticos activos en esta partida. */
  private enabledPacks = new Set<string>();
  /** Preguntas ya planteadas en la partida, para no repetirlas. */
  private askedThisGame = new Set<string>();
  /** Aciertos encadenados por el bando en el turno actual (tope por turno). */
  private correctThisTurn = 0;
  /** Rebote en curso, si la pregunta fallada sigue en el aire. */
  private rebound: Rebound | null = null;
  /** Cancela el cierre del pulsador del rebote, si está abierto. */
  private cancelRebound: (() => void) | null = null;
  /** Cancela la pulsación programada de un bot, si la hay. */
  private cancelBotBuzz: (() => void) | null = null;
  private readonly schedule: Scheduler;
  private readonly botDelayMinMs: number;
  private readonly botDelayMaxMs: number;
  private readonly reboundMs: number;
  /** Cancela la próxima acción de bot pendiente, si la hay. */
  private cancelBot: (() => void) | null = null;
  private botCounter = 0;

  constructor(
    code: string,
    repo: QuestionRepository,
    content: GameContent,
    profiles: ProfileStore,
    transport: Transport,
    options: {
      scheduler?: Scheduler;
      botDelayMinMs?: number;
      botDelayMaxMs?: number;
      reboundMs?: number;
    } = {},
  ) {
    this.code = code;
    this.repo = repo;
    this.content = content;
    this.profiles = profiles;
    this.transport = transport;
    this.schedule =
      options.scheduler ??
      ((action, delayMs) => {
        const handle = setTimeout(action, delayMs);
        return () => clearTimeout(handle);
      });
    this.botDelayMinMs = options.botDelayMinMs ?? BOT_DELAY_MIN_MS;
    this.botDelayMaxMs = options.botDelayMaxMs ?? BOT_DELAY_MAX_MS;
    this.reboundMs = options.reboundMs ?? REBOUND_MS;
  }

  /** Libera recursos al descartar la sala (temporizadores pendientes). */
  dispose(): void {
    if (this.cancelBot) {
      this.cancelBot();
      this.cancelBot = null;
    }
    this.closeReboundWindow();
  }

  // --- Gestión de jugadores -------------------------------------------------

  get playerCount(): number {
    return this.players.length;
  }

  hasConnectedPlayers(): boolean {
    return this.players.some((p) => p.connected);
  }

  /** Personas conectadas (los bots no cuentan como presencia real). */
  hasConnectedHumans(): boolean {
    return this.players.some((p) => p.connected && !p.isBot);
  }

  /**
   * @brief Añade un jugador o reconecta a uno que se había caído.
   * @param name Nombre mostrado.
   * @param profileId Identidad persistente del jugador.
   * @return Id del jugador en la sala, o null si la partida ya empezó.
   */
  addOrReattach(name: string, profileId: string): string | null {
    const existing = this.players.find((p) => p.profileId === profileId);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      this.sync();
      return existing.id;
    }
    if (this.phase !== 'lobby') return null;

    const player: InternalPlayer = {
      id: crypto.randomUUID(),
      name,
      profileId,
      connected: true,
      streak: 0,
      isBot: false,
      team: null,
      wildcards: [...WILDCARDS],
      game: emptyGameStats(),
    };
    this.players.push(player);
    // Quien crea la sala (primera persona en entrar) decide el modo de juego.
    if (this.hostId === null) this.hostId = player.id;
    this.profiles.getOrCreate(profileId, name);
    this.emit({ kind: 'playerJoined', playerId: player.id, name });
    this.sync();
    return player.id;
  }

  /**
   * @brief Envía a un jugador su progreso.
   *
   * Lo llama el servidor una vez ha asociado el socket al jugador: durante
   * `addOrReattach` todavía no sabe a dónde mandarlo y el mensaje se perdería.
   *
   * @param playerId Jugador destinatario.
   */
  sendProfileTo(playerId: string): void {
    const player = this.players.find((p) => p.id === playerId);
    if (player) this.sendProfile(player);
  }

  /**
   * @brief Fija el modo de juego. Solo quien creó la sala y solo antes de jugar.
   * @param playerId Quien lo intenta.
   * @param mode Modo deseado.
   */
  setMode(playerId: string, mode: GameMode): void {
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') {
      return this.reject('El modo se cambia antes de empezar.');
    }
    if (playerId !== this.hostId) return this.reject('Solo quien creó la sala elige el modo.');
    this.mode = mode;
    // Al volver a individual, las elecciones de equipo dejan de tener sentido.
    if (mode === 'individual') for (const p of this.players) p.team = null;
    this.sync();
  }

  /**
   * @brief Elige el equipo de un jugador (solo en modo por equipos).
   * @param playerId Jugador que elige.
   * @param team Número de equipo (1..MAX_TEAMS) o null para dejarlo sin elegir.
   */
  chooseTeam(playerId: string, team: number | null): void {
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') {
      return this.reject('Los equipos se eligen antes de empezar.');
    }
    if (this.mode !== 'teams') return this.reject('Esta partida es individual.');
    if (team !== null && (!Number.isInteger(team) || team < 1 || team > MAX_TEAMS)) {
      return this.reject('Ese equipo no existe.');
    }
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return this.reject('No estás en la sala.');
    player.team = team;
    this.sync();
  }

  /**
   * @brief Añade un bot a la sala. Solo en el vestíbulo.
   * @param difficulty Dificultad del bot (afecta a su acierto).
   */
  addBot(difficulty: BotDifficulty): void {
    if (this.phase !== 'lobby') return this.reject('Los bots se añaden antes de empezar.');
    this.botCounter += 1;
    const player: InternalPlayer = {
      id: crypto.randomUUID(),
      name: `Bot ${this.botCounter}`,
      profileId: `bot:${crypto.randomUUID()}`,
      connected: true,
      streak: 0,
      isBot: true,
      difficulty,
      team: null,
      wildcards: [...WILDCARDS],
      game: emptyGameStats(),
    };
    this.players.push(player);
    this.emit({ kind: 'playerJoined', playerId: player.id, name: player.name });
    this.sync();
  }

  /**
   * @brief Cambia el equipo de un bot (solo en el vestíbulo y en modo equipos).
   * @param playerId Bot a mover.
   * @param team Equipo destino o null.
   */
  setBotTeam(playerId: string, team: number | null): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || !player.isBot) return this.reject('Ese jugador no es un bot.');
    this.chooseTeam(playerId, team);
  }

  /**
   * @brief Quita un bot de la sala. Solo en el vestíbulo.
   * @param playerId Bot a quitar.
   */
  removeBot(playerId: string): void {
    if (this.phase !== 'lobby') return this.reject('Los bots se quitan antes de empezar.');
    const player = this.players.find((p) => p.id === playerId);
    if (!player || !player.isBot) return this.reject('Ese jugador no es un bot.');
    this.players = this.players.filter((p) => p.id !== playerId);
    this.sync();
  }

  markDisconnected(playerId: string): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;
    player.connected = false;

    // En el vestíbulo, un jugador que se va desaparece de la lista.
    if (this.phase === 'lobby') {
      this.players = this.players.filter((p) => p.id !== playerId);
      if (this.hostId === playerId) {
        // La sala se queda sin anfitrión: lo hereda la siguiente persona.
        this.hostId = this.players.find((p) => !p.isBot)?.id ?? null;
      }
      this.sync();
      return;
    }

    // En partida, si se va justo quien tenía que actuar, hay que pasar turno o
    // la partida se queda clavada: nadie más podría hacerlo. Se descarta la
    // acción a medias (movimiento o pregunta).
    const gameActive =
      this.phase === 'awaitRoll' ||
      this.phase === 'moving' ||
      this.phase === 'awaitAnswer' ||
      this.phase === 'awaitRebound' ||
      this.phase === 'awaitFinalCategory';

    if (gameActive) {
      // Si quien actuaba tenía compañeros conectados, el equipo sigue jugando:
      // le sustituye el siguiente miembro. Solo se pasa turno si el bando entero
      // se queda sin nadie, o la partida se quedaría clavada.
      // Durante el rebote no actúa el bando del turno, así que su ausencia no
      // bloquea nada: el pulsador sigue vivo para los rivales.
      if (this.phase !== 'awaitRebound' && this.currentTeamHasNoConnectedMembers() && this.anyTeamPlayable()) {
        this.movement = null;
        this.question = null;
        this.nextTurn();
        return;
      }
      // Si se cae el último rival mientras elegía la categoría de la pregunta
      // final, se resuelve al azar para que el bando líder pueda jugársela.
      if (this.phase === 'awaitFinalCategory' && this.connectedRivals().length === 0) {
        this.askQuestion(this.randomCategory(), true);
        return;
      }
      // Si quien había pulsado el rebote se cae, nadie puede responder por él:
      // la pregunta se pierde y sigue la partida.
      if (this.phase === 'awaitRebound' && this.rebound?.claimedByPlayerId === playerId) {
        const { question } = this.rebound;
        this.rebound = null;
        this.emit({ kind: 'reboundExpired' });
        this.emit({ kind: 'answerRevealed', correctText: question.options[question.answerIndex] });
        this.nextTurn();
        return;
      }
    }
    this.sync();
  }

  // --- Packs temáticos ------------------------------------------------------

  /**
   * @brief Activa o desactiva un pack temático para las partidas de esta sala.
   * @param packId Pack a cambiar.
   * @param enabled true para activarlo.
   *
   * Solo se permite en el vestíbulo: cambiar el repertorio a mitad de partida
   * sería injusto para quien ya ha respondido.
   */
  setPack(packId: string, enabled: boolean): void {
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') {
      return this.reject('Los packs solo se cambian antes de empezar.');
    }
    const pack = this.content.packs.find((p) => p.id === packId);
    if (!pack) return this.reject('Ese pack no existe.');
    if (enabled && !this.unlockedInRoom().has(pack.unlockedBy)) {
      return this.reject(`El pack "${pack.name}" todavía no está desbloqueado.`);
    }
    if (enabled) this.enabledPacks.add(packId);
    else this.enabledPacks.delete(packId);
    this.sync();
  }

  /** Logros conseguidos por cualquiera de los jugadores presentes. */
  private unlockedInRoom(): Set<string> {
    const ids = new Set<string>();
    for (const player of this.players) {
      if (player.isBot) continue;
      for (const id of this.profileOf(player).achievements) ids.add(id);
    }
    return ids;
  }

  private packViews(): PackView[] {
    const unlocked = this.unlockedInRoom();
    return this.content.packs.map((pack) => {
      const requirement = this.content.achievements.find((a) => a.id === pack.unlockedBy);
      return {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        unlocked: unlocked.has(pack.unlockedBy),
        enabled: this.enabledPacks.has(pack.id),
        requires: requirement?.name ?? pack.unlockedBy,
      };
    });
  }

  // --- Acciones -------------------------------------------------------------

  /**
   * @brief Empieza (o reinicia) la partida, formando los bandos.
   *
   * En individual, cada jugador es su propio bando. En equipos, un bando por
   * cada equipo con miembros; todos deben haber elegido equipo (no se mezclan
   * modos, así que nadie se queda fuera).
   */
  start(): void {
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') {
      return this.reject('La partida ya está en curso.');
    }
    this.players = this.players.filter((p) => p.connected);
    if (this.players.length < 1) return this.reject('No hay jugadores conectados.');

    if (this.mode === 'teams') {
      const sinEquipo = this.players.filter((p) => p.team === null);
      if (sinEquipo.length > 0) {
        return this.reject(
          `Falta elegir equipo: ${sinEquipo.map((p) => p.name).join(', ')}.`,
        );
      }
    }

    // Quien desbloqueó un pack puede haberse ido: no se juega con packs que ya
    // nadie de la mesa tiene.
    const unlocked = this.unlockedInRoom();
    for (const packId of [...this.enabledPacks]) {
      const pack = this.content.packs.find((p) => p.id === packId);
      if (!pack || !unlocked.has(pack.unlockedBy)) this.enabledPacks.delete(packId);
    }

    this.teams = this.buildTeams();
    if (this.teams.length === 0) return this.reject('No hay bandos para jugar.');

    for (const p of this.players) {
      p.streak = 0;
      p.wildcards = [...WILDCARDS]; // cada partida se juega con todos los comodines
      p.game = emptyGameStats(); // marcador limpio para el resumen final
    }
    this.currentTeamIndex = 0;
    this.movement = null;
    this.question = null;
    this.winnerTeamId = null;
    this.askedThisGame.clear();
    this.correctThisTurn = 0;
    this.phase = 'awaitRoll';
    this.emit({ kind: 'gameStarted' });
    this.announceTurn();
    this.sync();
  }

  /** Crea los bandos según el modo: uno por jugador, o uno por equipo. */
  private buildTeams(): InternalTeam[] {
    const start = this.board.startNodeId;
    if (this.mode === 'individual') {
      return this.players.map((p) => ({
        id: `side-${p.id}`,
        name: p.name,
        nodeId: start,
        wedges: [],
        memberIds: [p.id],
        activeMemberIndex: 0,
      }));
    }
    const numbers = [...new Set(this.players.map((p) => p.team))]
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
    return numbers.map((n) => ({
      id: `team-${n}`,
      name: `Equipo ${n}`,
      nodeId: start,
      wedges: [],
      memberIds: this.players.filter((p) => p.team === n).map((p) => p.id),
      activeMemberIndex: 0,
    }));
  }

  roll(playerId: string): void {
    if (!this.isActing(playerId)) return this.reject('No es tu turno.');
    if (this.phase !== 'awaitRoll') return this.reject('No puedes tirar ahora.');
    const value = rollDie();
    this.emit({ kind: 'diceRolled', playerId, value });
    this.beginMovement(value);
  }

  move(playerId: string, toNodeId: string): void {
    if (!this.isActing(playerId)) return this.reject('No es tu turno.');
    if (this.phase !== 'moving' || !this.movement) return this.reject('No hay movimiento en curso.');
    if (!this.movement.options.includes(toNodeId)) {
      return this.reject('Esa casilla no es una dirección válida.');
    }
    this.stepTo(toNodeId);
    this.continueMovement();
  }

  answer(playerId: string, optionIndex: number): void {
    // La pregunta rebotada la responde quien pulsó, no quien tiene el turno.
    if (this.phase === 'awaitRebound') return this.answerRebound(playerId, optionIndex);

    if (!this.isActing(playerId)) return this.reject('No es tu turno.');
    if (this.phase !== 'awaitAnswer' || !this.question) return this.reject('No hay pregunta activa.');

    const player = this.playerById(playerId)!;
    const team = this.currentTeam()!;
    const failed = this.question;
    const correct = optionIndex === this.question.answerIndex;
    const forWin = this.question.forWin;
    const category = this.question.category;
    const correctText = this.question.options[this.question.answerIndex];
    const node = this.board.nodes[team.nodeId];
    this.question = null;

    player.streak = correct ? player.streak + 1 : 0;
    this.recordGameAnswer(player, category, correct);
    // Estadísticas y racha se guardan solo para personas: los bots no tienen perfil.
    if (!player.isBot) {
      const profile = this.profileOf(player);
      profile.stats.questionsAnswered += 1;
      if (correct) {
        profile.stats.questionsCorrect += 1;
        profile.stats.correct[category] += 1;
        profile.stats.bestStreak = Math.max(profile.stats.bestStreak, player.streak);
      }
    }

    if (!correct) {
      this.saveProgressOf(player);
      // Si la pregunta va a rebotar, la respuesta buena NO se canta todavía:
      // sería regalársela a quien puede quedársela. Se destapa al resolverse.
      const rebota = !forWin && this.reboundTeams(team).length > 0;
      this.emit({ kind: 'answered', playerId, correct, ...(rebota ? {} : { correctText }) });
      if (rebota) {
        // A quien ha fallado sí se le dice, en privado: ya no puede contestarla.
        this.emitTo(playerId, { kind: 'answerRevealed', correctText });
        this.openRebound(failed, team);
        return;
      }
      this.nextTurn();
      return;
    }

    this.emit({ kind: 'answered', playerId, correct, correctText });

    if (forWin) {
      this.winnerTeamId = team.id;
      this.phase = 'gameOver';
      for (const p of this.players) if (!p.isBot) this.profileOf(p).stats.gamesPlayed += 1;
      // La victoria es del bando: la suman todos sus miembros.
      for (const memberId of team.memberIds) {
        const member = this.playerById(memberId);
        if (member && !member.isBot) this.profileOf(member).stats.gamesWon += 1;
      }
      this.emit({ kind: 'gameWon', teamId: team.id });
      for (const p of this.players) if (!p.isBot) this.checkAchievements(p);
      this.sendSummaries(team.id);
      this.profiles.scheduleSave();
      this.sync();
      return;
    }

    // Acertar en una sede otorga su queso al bando (bots incluidos).
    if (node.kind === 'hq' && node.category && !team.wedges.includes(node.category)) {
      team.wedges.push(node.category);
      player.game.wedges += 1;
      if (!player.isBot) this.profileOf(player).stats.wedgesEarned += 1;
      this.emit({ kind: 'wedgeEarned', teamId: team.id, playerId, category: node.category });
      // Completar los seis cambia el objetivo (ahora hay que volver al centro):
      // hay que decirlo, o se sigue jugando sin saber que ya se va a por la victoria.
      if (team.wedges.length === CATEGORIES.length) {
        this.emit({ kind: 'allWedgesEarned', teamId: team.id });
      }
    }

    this.saveProgressOf(player);

    // Tope de aciertos por turno: aun acertando, se cede la vez para que no se
    // acapare la partida.
    this.correctThisTurn += 1;
    if (this.correctThisTurn >= MAX_CORRECT_PER_TURN) {
      this.emit({ kind: 'turnLimitReached', teamId: team.id, limit: MAX_CORRECT_PER_TURN });
      this.nextTurn();
      return;
    }

    // Acertar da turno extra: el mismo bando vuelve a tirar.
    this.phase = 'awaitRoll';
    this.sync();
  }

  // --- Comodines ------------------------------------------------------------

  /**
   * @brief Usa un comodín sobre la pregunta en curso.
   * @param playerId Quien lo usa.
   * @param wildcard Comodín a gastar.
   *
   * Solo lo puede usar el jugador del turno y solo sobre una pregunta normal en
   * juego (no la final, que decide la partida). Cada comodín es de un solo uso
   * por partida.
   */
  useWildcard(playerId: string, wildcard: WildcardId): void {
    if (!this.isActing(playerId)) return this.reject('No es tu turno.');
    if (this.phase !== 'awaitAnswer' || !this.question) return this.reject('No hay pregunta que cambiar.');
    if (this.question.forWin) return this.reject('En la pregunta final no valen comodines.');

    const player = this.playerById(playerId)!;
    if (!player.wildcards.includes(wildcard)) return this.reject('Ese comodín ya lo has gastado.');

    if (wildcard === 'changeQuestion') {
      this.spendWildcard(player, wildcard);
      // Otra pregunta de la misma categoría, sin re-anunciar la caída: no te has
      // movido, solo cambias de pregunta. La actual ya está en askedThisGame, así
      // que no vuelve a salir mientras quede alguna sin usar en la categoría.
      const category = this.question.category;
      const picked = this.repo.pick(category, {
        packIds: [...this.enabledPacks],
        askedThisGame: this.askedThisGame,
      });
      this.askedThisGame.add(picked.id);
      this.question = { ...picked, forWin: false };
      this.eliminatedOptions = []; // pregunta nueva: los descartes previos ya no aplican
      this.emit({ kind: 'wildcardUsed', playerId, wildcard });
      this.sync();
    } else if (wildcard === 'fiftyFifty') {
      if (this.eliminatedOptions.length > 0) return this.reject('Ya has usado el 50/50 en esta pregunta.');
      this.spendWildcard(player, wildcard);
      this.eliminatedOptions = this.pickTwoWrongOptions(this.question);
      this.emit({ kind: 'wildcardUsed', playerId, wildcard });
      this.sync();
    }
  }

  /**
   * Elige dos opciones incorrectas al azar para descartarlas con el 50/50,
   * dejando siempre la correcta y una mala. Asume 4 opciones (todo el banco lo
   * cumple); si hubiera menos de 3, descarta las que pueda sin tocar la correcta.
   */
  private pickTwoWrongOptions(question: Question): number[] {
    const wrong = question.options
      .map((_, index) => index)
      .filter((index) => index !== question.answerIndex);
    for (let i = wrong.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
    }
    return wrong.slice(0, 2);
  }

  /** Retira un comodín del inventario del jugador (un solo uso por partida). */
  private spendWildcard(player: InternalPlayer, wildcard: WildcardId): void {
    player.wildcards = player.wildcards.filter((w) => w !== wildcard);
    player.game.wildcardsUsed += 1;
  }

  // --- Resumen final --------------------------------------------------------

  /** Anota una respuesta en el marcador de la partida (para el resumen final). */
  private recordGameAnswer(player: InternalPlayer, category: CategoryId, correct: boolean): void {
    const g = player.game;
    g.answered += 1;
    if (correct) {
      g.correct += 1;
      g.correctByCategory[category] += 1;
      g.bestStreak = Math.max(g.bestStreak, player.streak);
    } else {
      g.wrongByCategory[category] += 1;
    }
  }

  /** Categoría con el recuento más alto (>0); null si todas están a cero. */
  private topCategory(counts: Record<CategoryId, number>): CategoryId | null {
    let best: CategoryId | null = null;
    let max = 0;
    for (const cat of CATEGORIES) {
      if (counts[cat.id] > max) {
        max = counts[cat.id];
        best = cat.id;
      }
    }
    return best;
  }

  /** Compone el resumen de la partida para un jugador. */
  private buildSummary(player: InternalPlayer, won: boolean): GameSummaryView {
    const g = player.game;
    return {
      won,
      answered: g.answered,
      correct: g.correct,
      accuracy: g.answered > 0 ? Math.round((g.correct / g.answered) * 100) : 0,
      bestStreak: g.bestStreak,
      strongestCategory: this.topCategory(g.correctByCategory),
      weakestCategory: this.topCategory(g.wrongByCategory),
      wedges: g.wedges,
      reboundsWon: g.reboundsWon,
      wildcardsUsed: g.wildcardsUsed,
    };
  }

  /** Envía a cada persona conectada su resumen de la partida recién acabada. */
  private sendSummaries(winnerTeamId: string): void {
    const winner = this.teams.find((t) => t.id === winnerTeamId);
    for (const player of this.players) {
      if (player.isBot || !player.connected) continue;
      const won = winner?.memberIds.includes(player.id) ?? false;
      this.transport.sendTo(player.id, { type: 'gameSummary', summary: this.buildSummary(player, won) });
    }
  }

  // --- Rebote ---------------------------------------------------------------

  /**
   * @brief Pulsa el rebote: quien llega primero se queda la pregunta fallada.
   * @param playerId Jugador que pulsa.
   *
   * Solo vale una pulsación: la primera cierra el pulsador y las demás se
   * rechazan. No puede pulsar el bando que ha fallado (sería contestar dos veces
   * a la misma pregunta) ni un bando que ya haya pulsado.
   */
  buzz(playerId: string): void {
    if (this.phase !== 'awaitRebound' || !this.rebound) return this.reject('No hay ningún rebote abierto.');
    if (this.rebound.claimedByTeamIndex !== null) return this.reject('El rebote ya es de otro.');

    const player = this.playerById(playerId);
    if (!player?.connected) return this.reject('No estás en la partida.');
    const teamIndex = this.teams.findIndex((t) => t.memberIds.includes(playerId));
    if (!this.rebound.eligibleTeamIndices.includes(teamIndex)) {
      return this.reject('Tu bando no puede rebotar esta pregunta.');
    }

    this.closeReboundWindow();
    this.rebound.claimedByTeamIndex = teamIndex;
    this.rebound.claimedByPlayerId = playerId;
    this.emit({ kind: 'reboundClaimed', teamId: this.teams[teamIndex].id, playerId });
    this.sync();
  }

  /**
   * Abre el pulsador para los rivales del bando que ha fallado.
   *
   * @param question Pregunta que se ha fallado.
   * @param failedTeam Bando que la ha fallado (no puede rebotar la suya).
   * @return true si el rebote queda abierto; false si no hay a quién ofrecérselo
   *         y el turno debe seguir su curso.
   */
  private openRebound(question: Question, failedTeam: InternalTeam): boolean {
    const eligible = this.reboundTeams(failedTeam);
    if (eligible.length === 0) return false;

    this.rebound = {
      question,
      nodeId: failedTeam.nodeId,
      eligibleTeamIndices: eligible,
      claimedByTeamIndex: null,
      claimedByPlayerId: null,
    };
    this.phase = 'awaitRebound';
    this.emit({
      kind: 'reboundOpened',
      failedTeamId: failedTeam.id,
      seconds: Math.round(this.reboundMs / 1000),
    });
    this.cancelRebound = this.schedule(() => {
      this.cancelRebound = null;
      this.expireRebound();
    }, this.reboundMs);
    this.scheduleBotBuzz(eligible);
    this.sync();
    return true;
  }

  /**
   * Programa la pulsación del bot más rápido de entre los bandos que pueden
   * rebotar. Solo se programa uno: en cuanto alguien pulsa, el pulsador se
   * cierra, así que los demás no llegarían a nada.
   */
  private scheduleBotBuzz(eligibleTeamIndices: readonly number[]): void {
    let bestPlayerId: string | null = null;
    let bestDelay = Infinity;

    for (const index of eligibleTeamIndices) {
      for (const memberId of this.teams[index].memberIds) {
        const member = this.playerById(memberId);
        if (!member?.isBot || !member.connected) continue;
        const delay = botBuzzDelayMs(member.difficulty ?? 'normal', this.reboundMs);
        if (delay !== null && delay < bestDelay) {
          bestDelay = delay;
          bestPlayerId = member.id;
        }
      }
    }

    if (bestPlayerId === null) return;
    const playerId = bestPlayerId;
    this.cancelBotBuzz = this.schedule(() => {
      this.cancelBotBuzz = null;
      if (this.phase === 'awaitRebound' && this.rebound?.claimedByTeamIndex === null) {
        this.buzz(playerId);
      }
    }, bestDelay);
  }

  /**
   * Índices de los bandos que podrían rebotar una pregunta fallada por
   * `failedTeam`: todos los que tengan a alguien conectado, menos él mismo.
   */
  private reboundTeams(failedTeam: InternalTeam): number[] {
    return this.teams
      .map((team, index) => ({ team, index }))
      .filter(({ team }) => team.id !== failedTeam.id && this.teamHasConnectedMember(team))
      .map(({ index }) => index);
  }

  /** Nadie ha pulsado a tiempo: la pregunta se pierde y sigue la partida. */
  private expireRebound(): void {
    if (this.phase !== 'awaitRebound' || !this.rebound || this.rebound.claimedByTeamIndex !== null) return;
    const { question } = this.rebound;
    this.rebound = null;
    this.emit({ kind: 'reboundExpired' });
    // Ya no la puede contestar nadie: ahora sí se destapa para toda la mesa.
    this.emit({ kind: 'answerRevealed', correctText: question.options[question.answerIndex] });
    this.nextTurn();
  }

  /**
   * Resuelve la respuesta de quien pulsó el rebote. Acertar le da la casilla del
   * que falló (y su queso, si era una sede que le faltaba); fallar no le cuesta
   * nada, porque quien no arriesga nunca pulsaría.
   */
  private answerRebound(playerId: string, optionIndex: number): void {
    const rebound = this.rebound;
    if (!rebound || rebound.claimedByPlayerId === null) return this.reject('Aún no has pulsado el rebote.');
    if (rebound.claimedByPlayerId !== playerId) return this.reject('El rebote es de otro jugador.');

    const player = this.playerById(playerId)!;
    const team = this.teams[rebound.claimedByTeamIndex!];
    const correct = optionIndex === rebound.question.answerIndex;
    const correctText = rebound.question.options[rebound.question.answerIndex];
    const node = this.board.nodes[rebound.nodeId];
    this.rebound = null;

    player.streak = correct ? player.streak + 1 : 0;
    this.recordGameAnswer(player, rebound.question.category, correct);
    if (!player.isBot) {
      const profile = this.profileOf(player);
      profile.stats.questionsAnswered += 1;
      if (correct) {
        profile.stats.questionsCorrect += 1;
        profile.stats.correct[rebound.question.category] += 1;
        profile.stats.bestStreak = Math.max(profile.stats.bestStreak, player.streak);
      }
    }

    this.emit({ kind: 'answered', playerId, correct, correctText });

    if (correct) {
      // El premio es quedarse el sitio del que falló, con su queso si lo había.
      player.game.reboundsWon += 1;
      team.nodeId = rebound.nodeId;
      this.emit({ kind: 'reboundWon', teamId: team.id, playerId, nodeId: rebound.nodeId });
      if (node.kind === 'hq' && node.category && !team.wedges.includes(node.category)) {
        team.wedges.push(node.category);
        player.game.wedges += 1;
        if (!player.isBot) this.profileOf(player).stats.wedgesEarned += 1;
        this.emit({ kind: 'wedgeEarned', teamId: team.id, playerId, category: node.category });
        if (team.wedges.length === CATEGORIES.length) {
          this.emit({ kind: 'allWedgesEarned', teamId: team.id });
        }
      }
    }

    this.saveProgressOf(player);
    this.nextTurn();
  }

  /** Para los temporizadores del pulsador (cierre y pulsación de bot). */
  private closeReboundWindow(): void {
    if (this.cancelRebound) {
      this.cancelRebound();
      this.cancelRebound = null;
    }
    if (this.cancelBotBuzz) {
      this.cancelBotBuzz();
      this.cancelBotBuzz = null;
    }
  }

  /** Comprueba logros y guarda, solo si el jugador es una persona. */
  private saveProgressOf(player: InternalPlayer): void {
    if (player.isBot) return;
    this.checkAchievements(player);
    this.profiles.scheduleSave();
  }

  // --- Progreso -------------------------------------------------------------

  private profileOf(player: InternalPlayer): Profile {
    return this.profiles.getOrCreate(player.profileId, player.name);
  }

  /**
   * Comprueba si el jugador acaba de conseguir logros nuevos y, en tal caso,
   * los anuncia junto con el pack que desbloqueen.
   */
  private checkAchievements(player: InternalPlayer): void {
    const profile = this.profileOf(player);
    const earned = earnedAchievements(profile.stats, this.content.achievements);
    const fresh = earned.filter((id) => !profile.achievements.includes(id));
    if (fresh.length === 0) return;

    for (const id of fresh) {
      profile.achievements.push(id);
      const def = this.content.achievements.find((a) => a.id === id);
      if (!def) continue;
      this.emit({
        kind: 'achievementUnlocked',
        playerId: player.id,
        name: def.name,
        description: def.description,
      });
      const pack = this.content.packs.find((p) => p.unlockedBy === id);
      if (pack) {
        this.emit({ kind: 'packUnlocked', playerId: player.id, packName: pack.name });
      }
    }
    this.sendProfile(player);
  }

  private achievementViews(profile: Profile): AchievementView[] {
    return this.content.achievements.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      unlocked: profile.achievements.includes(def.id),
      progress: statValue(profile.stats, def.stat),
      target: def.atLeast,
    }));
  }

  /** Envía a un jugador su propio progreso (nadie más lo recibe). */
  private sendProfile(player: InternalPlayer): void {
    if (player.isBot) return;
    const profile = this.profileOf(player);
    this.transport.sendTo(player.id, {
      type: 'profile',
      stats: profile.stats,
      achievements: this.achievementViews(profile),
    });
  }

  // --- Movimiento -----------------------------------------------------------

  private beginMovement(steps: number): void {
    this.movement = { remaining: steps, cameFrom: null, options: [] };
    this.phase = 'moving';
    this.continueMovement();
  }

  /**
   * Avanza automáticamente los pasos con una única salida y se detiene cuando
   * hay que elegir dirección o cuando se acaban los pasos (entonces se aterriza).
   */
  private continueMovement(): void {
    const team = this.currentTeam();
    if (!team) return;
    while (this.movement && this.movement.remaining > 0) {
      const options = legalMoves(this.board, team.nodeId, this.movement.cameFrom);
      if (options.length === 1) {
        this.stepTo(options[0]);
      } else {
        this.movement.options = options;
        this.sync();
        return;
      }
    }
    this.land();
  }

  private stepTo(toNodeId: string): void {
    const team = this.currentTeam();
    const acting = this.actingPlayer();
    if (!team || !acting) return;
    const from = team.nodeId;
    team.nodeId = toNodeId;
    this.movement!.cameFrom = from;
    this.movement!.remaining -= 1;
    this.emit({ kind: 'moved', playerId: acting.id, toNodeId });
  }

  private land(): void {
    const team = this.currentTeam();
    if (!team) return;
    const node = this.board.nodes[team.nodeId];
    this.movement = null;

    if (node.kind === 'hub') {
      if (team.wedges.length === CATEGORIES.length) {
        this.beginFinalQuestion();
      } else {
        // Centro sin todos los quesos: casilla libre, se vuelve a tirar.
        this.phase = 'awaitRoll';
        this.sync();
      }
      return;
    }

    this.askQuestion(node.category!, false);
  }

  /**
   * Arranca la pregunta final. Como en el Trivial de mesa, la categoría la
   * eligen los rivales (para poner difícil al líder). Si no hay rivales
   * conectados se elige al azar, para no dejar la partida atascada esperando
   * una elección que nadie puede hacer.
   */
  private beginFinalQuestion(): void {
    const team = this.currentTeam();
    if (!team) return;
    if (this.connectedRivals().length === 0) {
      this.askQuestion(this.randomCategory(), true);
      return;
    }
    this.phase = 'awaitFinalCategory';
    this.emit({ kind: 'awaitingFinalCategory', teamId: team.id });
    this.sync();
  }

  /**
   * @brief Un rival elige la categoría de la pregunta final.
   * @param playerId Rival que elige.
   * @param category Categoría elegida.
   *
   * La elige quien NO juega en el bando que va a por la victoria.
   */
  chooseFinalCategory(playerId: string, category: CategoryId): void {
    if (this.phase !== 'awaitFinalCategory') return this.reject('No hay pregunta final pendiente.');
    const team = this.currentTeam();
    if (team?.memberIds.includes(playerId)) {
      return this.reject('La categoría la eligen vuestros rivales, no vosotros.');
    }
    const chooser = this.playerById(playerId);
    if (!chooser || !chooser.connected) return this.reject('No puedes elegir ahora.');
    if (!CATEGORIES.some((c) => c.id === category)) return this.reject('Categoría desconocida.');

    this.emit({ kind: 'finalCategoryChosen', byPlayerId: playerId, category });
    this.askQuestion(category, true);
  }

  /** Jugadores conectados que no juegan en el bando del turno. */
  private connectedRivals(): InternalPlayer[] {
    const team = this.currentTeam();
    if (!team) return [];
    return this.players.filter((p) => p.connected && !team.memberIds.includes(p.id));
  }

  private randomCategory(): CategoryId {
    return CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].id;
  }

  private askQuestion(category: CategoryId, forWin: boolean): void {
    const team = this.currentTeam();
    const acting = this.actingPlayer();
    if (!team || !acting) return;
    const picked = this.repo.pick(category, {
      packIds: [...this.enabledPacks],
      askedThisGame: this.askedThisGame,
    });
    this.askedThisGame.add(picked.id);
    this.question = { ...picked, forWin };
    this.eliminatedOptions = []; // pregunta nueva, sin descartes previos
    this.phase = 'awaitAnswer';
    this.emit({ kind: 'landed', playerId: acting.id, nodeId: team.nodeId, category });
    this.sync();
  }

  /** Pasa el turno al siguiente bando jugable, rotando el miembro que responde. */
  private nextTurn(): void {
    // Cualquier rebote pendiente muere con el turno que lo abrió.
    this.closeReboundWindow();
    this.rebound = null;
    if (!this.anyTeamPlayable()) return;

    // El bando que acaba de jugar rota su miembro: así responden todos.
    const current = this.currentTeam();
    if (current && current.memberIds.length > 1) {
      current.activeMemberIndex = (current.activeMemberIndex + 1) % current.memberIds.length;
    }

    const total = this.teams.length;
    let idx = this.currentTeamIndex;
    for (let i = 0; i < total; i++) {
      idx = (idx + 1) % total;
      if (this.teamHasConnectedMember(this.teams[idx])) break;
    }
    this.currentTeamIndex = idx;
    this.correctThisTurn = 0; // el tope es por turno
    this.phase = 'awaitRoll';
    this.announceTurn();
    this.sync();
  }

  private announceTurn(): void {
    const team = this.currentTeam();
    const acting = this.actingPlayer();
    if (team && acting) this.emit({ kind: 'turnChanged', teamId: team.id, playerId: acting.id });
  }

  // --- Bandos y turno -------------------------------------------------------

  private playerById(id: string): InternalPlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  private currentTeam(): InternalTeam | undefined {
    return this.teams[this.currentTeamIndex];
  }

  private teamHasConnectedMember(team: InternalTeam): boolean {
    return team.memberIds.some((id) => this.playerById(id)?.connected);
  }

  private anyTeamPlayable(): boolean {
    return this.teams.some((t) => this.teamHasConnectedMember(t));
  }

  private currentTeamHasNoConnectedMembers(): boolean {
    const team = this.currentTeam();
    return team ? !this.teamHasConnectedMember(team) : false;
  }

  /**
   * Jugador que debe actuar: el miembro de turno del bando actual. Si ese
   * miembro se ha caído, le sustituye el siguiente conectado, para que la
   * ausencia de uno no bloquee a todo el equipo.
   */
  private actingPlayer(): InternalPlayer | undefined {
    const team = this.currentTeam();
    if (!team) return undefined;
    const size = team.memberIds.length;
    for (let i = 0; i < size; i++) {
      const id = team.memberIds[(team.activeMemberIndex + i) % size];
      const player = this.playerById(id);
      if (player?.connected) return player;
    }
    return undefined;
  }

  private isActing(playerId: string): boolean {
    return this.actingPlayer()?.id === playerId;
  }

  // --- Utilidades -----------------------------------------------------------

  private emit(event: GameEvent): void {
    this.transport.broadcast({ type: 'event', event });
  }

  /** Evento para un solo jugador (lo que no debe oír el resto de la mesa). */
  private emitTo(playerId: string, event: GameEvent): void {
    this.transport.sendTo(playerId, { type: 'event', event });
  }

  private reject(message: string): void {
    this.transport.broadcast({ type: 'error', message });
  }

  private sync(): void {
    this.transport.broadcast({ type: 'state', state: this.toView() });
    // Cada estado ya asentado es un punto de decisión: si le toca a un bot,
    // se programa su acción.
    this.maybeDriveBot();
  }

  // --- Bots -----------------------------------------------------------------

  /**
   * Programa la próxima acción de bot, si el estado actual la requiere. Se
   * recalcula al dispararse (el estado puede cambiar por una desconexión), así
   * que solo se guarda el cancelador.
   */
  private maybeDriveBot(): void {
    if (this.cancelBot) {
      this.cancelBot();
      this.cancelBot = null;
    }
    if (!this.botAction()) return;
    this.cancelBot = this.schedule(() => {
      this.cancelBot = null;
      const action = this.botAction();
      if (action) action();
    }, this.botDelay());
  }

  /** Retardo sorteado para la próxima acción de bot, dentro de la franja. */
  private botDelay(): number {
    const span = this.botDelayMaxMs - this.botDelayMinMs;
    return Math.round(this.botDelayMinMs + Math.random() * span);
  }

  /**
   * Devuelve la acción que debe ejecutar un bot en el estado actual, o null si
   * no toca ninguna (turno de una persona, vestíbulo, fin de partida…).
   */
  private botAction(): (() => void) | null {
    const acting = this.actingPlayer();
    const team = this.currentTeam();

    if (this.phase === 'awaitRoll' && acting?.isBot) {
      return () => this.roll(acting.id);
    }
    if (this.phase === 'moving' && acting?.isBot && this.movement && team) {
      const options = this.movement.options;
      const steps = this.movement.remaining;
      const from = team.nodeId;
      const wedges = team.wedges;
      return () => this.move(acting.id, chooseBotMove(this.board, from, options, steps, wedges));
    }
    if (this.phase === 'awaitAnswer' && acting?.isBot && this.question) {
      const question = this.question;
      const difficulty = acting.difficulty ?? 'normal';
      return () => this.answer(acting.id, botAnswerIndex(question, difficulty));
    }
    // Rebote pulsado por un bot: contesta él, no el jugador del turno.
    if (this.phase === 'awaitRebound' && this.rebound?.claimedByPlayerId) {
      const claimer = this.playerById(this.rebound.claimedByPlayerId);
      if (claimer?.isBot) {
        const question = this.rebound.question;
        const difficulty = claimer.difficulty ?? 'normal';
        return () => this.answer(claimer.id, botAnswerIndex(question, difficulty));
      }
    }
    if (this.phase === 'awaitFinalCategory') {
      // La categoría la eligen los rivales. Si hay algún rival humano conectado
      // se le deja elegir; si solo hay bots, elige un bot.
      const rivals = this.connectedRivals();
      if (!rivals.some((p) => !p.isBot)) {
        const botRival = rivals.find((p) => p.isBot);
        if (botRival) return () => this.chooseFinalCategory(botRival.id, chooseBotFinalCategory());
      }
    }
    return null;
  }

  /** Proyecta el estado interno a la vista pública (sin datos secretos). */
  toView(): GameView {
    const players: PlayerView[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isBot: p.isBot,
      team: p.team,
      wildcards: [...p.wildcards],
      ...(p.difficulty ? { difficulty: p.difficulty } : {}),
    }));

    const teams: TeamView[] = this.teams.map((t) => ({
      id: t.id,
      // En individual el bando se llama como su jugador, y el nombre puede haber
      // cambiado al reconectar: se toma el actual.
      name:
        this.mode === 'individual'
          ? (this.playerById(t.memberIds[0])?.name ?? t.name)
          : t.name,
      nodeId: t.nodeId,
      wedges: [...t.wedges],
      memberIds: [...t.memberIds],
    }));

    const view: GameView = {
      roomCode: this.code,
      mode: this.mode,
      hostId: this.hostId,
      phase: this.phase,
      players,
      teams,
      currentTeamIndex: this.currentTeamIndex,
      // En el rebote responde quien pulsó, no el jugador del turno; mientras el
      // pulsador sigue abierto no actúa nadie todavía.
      actingPlayerId:
        this.phase === 'awaitRebound'
          ? (this.rebound?.claimedByPlayerId ?? null)
          : (this.actingPlayer()?.id ?? null),
      packs: this.packViews(),
    };

    if (this.phase === 'moving' && this.movement) {
      view.movement = {
        remaining: this.movement.remaining,
        options: [...this.movement.options],
      };
    }

    if (this.phase === 'awaitAnswer' && this.question) {
      const publicQuestion: PublicQuestion = {
        id: this.question.id,
        category: this.question.category,
        text: this.question.text,
        options: [...this.question.options],
        forWin: this.question.forWin,
        ...(this.eliminatedOptions.length > 0 ? { eliminatedOptions: [...this.eliminatedOptions] } : {}),
      };
      view.question = publicQuestion;
    }

    // En el rebote sigue en pantalla la misma pregunta: es la que está en juego.
    if (this.phase === 'awaitRebound' && this.rebound) {
      view.question = {
        id: this.rebound.question.id,
        category: this.rebound.question.category,
        text: this.rebound.question.text,
        options: [...this.rebound.question.options],
        forWin: false,
      };
      view.rebound = {
        eligibleTeamIds: this.rebound.eligibleTeamIndices.map((i) => this.teams[i].id),
        seconds: Math.round(this.reboundMs / 1000),
      };
    }

    if (this.winnerTeamId) view.winnerTeamId = this.winnerTeamId;

    return view;
  }
}

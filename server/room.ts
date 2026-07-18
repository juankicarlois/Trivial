/**
 * Sala de juego: mantiene el estado de una partida y aplica las reglas. Es la
 * autoridad — valida cada acción y difunde el estado resultante más eventos
 * puntuales (para sonidos y anuncios en el cliente).
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
import type {
  AchievementView,
  GameEvent,
  GameView,
  PackView,
  PlayerView,
  PublicQuestion,
  ServerMessage,
  TurnPhase,
} from '../shared/protocol.js';
import { legalMoves, rollDie } from './engine.js';
import type { QuestionRepository } from './questions_repo.js';
import type { GameContent } from './content.js';
import type { Profile, ProfileStore } from './profiles.js';

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
  nodeId: string;
  wedges: CategoryId[];
  connected: boolean;
  /** Aciertos seguidos en la partida en curso. */
  streak: number;
}

interface Movement {
  remaining: number;
  /** Nodo del que se viene (para no oscilar); null en el primer paso. */
  cameFrom: string | null;
  /** Direcciones disponibles cuando se espera elección del jugador. */
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
  private phase: TurnPhase = 'lobby';
  private currentPlayerIndex = 0;
  private movement: Movement | null = null;
  private question: (Question & { forWin: boolean }) | null = null;
  private winnerId: string | null = null;
  /** Packs temáticos activos en esta partida. */
  private enabledPacks = new Set<string>();
  /** Preguntas ya planteadas en la partida, para no repetirlas. */
  private askedThisGame = new Set<string>();

  constructor(
    code: string,
    repo: QuestionRepository,
    content: GameContent,
    profiles: ProfileStore,
    transport: Transport,
  ) {
    this.code = code;
    this.repo = repo;
    this.content = content;
    this.profiles = profiles;
    this.transport = transport;
  }

  // --- Gestión de jugadores -------------------------------------------------

  get playerCount(): number {
    return this.players.length;
  }

  hasConnectedPlayers(): boolean {
    return this.players.some((p) => p.connected);
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
      nodeId: this.board.startNodeId,
      wedges: [],
      connected: true,
      streak: 0,
    };
    this.players.push(player);
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

  markDisconnected(playerId: string): void {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index < 0) return;
    const player = this.players[index];
    player.connected = false;

    // En el vestíbulo, un jugador que se va desaparece de la lista.
    if (this.phase === 'lobby') {
      this.players = this.players.filter((p) => p.id !== playerId);
      this.sync();
      return;
    }

    // En partida, si se va justo el jugador con el turno, hay que pasarlo o la
    // partida se queda clavada: nadie más podría actuar. Se descarta cualquier
    // acción a medias (movimiento o pregunta) y pasa al siguiente conectado.
    const gameActive =
      this.phase === 'awaitRoll' ||
      this.phase === 'moving' ||
      this.phase === 'awaitAnswer' ||
      this.phase === 'awaitFinalCategory';
    if (gameActive && index === this.currentPlayerIndex && this.hasConnectedPlayers()) {
      this.movement = null;
      this.question = null;
      this.nextTurn();
      return;
    }

    // Si se cae un rival mientras elegía la categoría de la pregunta final y ya
    // no queda ningún rival que pueda elegir, se resuelve al azar para que el
    // líder (que sigue conectado) pueda jugar su turno de victoria.
    if (this.phase === 'awaitFinalCategory' && this.connectedRivals().length === 0) {
      this.askQuestion(this.randomCategory(), true);
      return;
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
   * @brief Empieza (o reinicia) la partida.
   *
   * Se permite tanto desde el vestíbulo como al terminar (botón "Jugar otra
   * vez"). Antes de arrancar se descartan los jugadores desconectados para que
   * ningún fantasma se quede con el turno y bloquee la mesa.
   */
  start(): void {
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') {
      return this.reject('La partida ya está en curso.');
    }
    this.players = this.players.filter((p) => p.connected);
    if (this.players.length < 1) return this.reject('No hay jugadores conectados.');

    // Quien desbloqueó un pack puede haberse ido: no se juega con packs que ya
    // nadie de la mesa tiene.
    const unlocked = this.unlockedInRoom();
    for (const packId of [...this.enabledPacks]) {
      const pack = this.content.packs.find((p) => p.id === packId);
      if (!pack || !unlocked.has(pack.unlockedBy)) this.enabledPacks.delete(packId);
    }

    for (const p of this.players) {
      p.nodeId = this.board.startNodeId;
      p.wedges = [];
      p.streak = 0;
    }
    this.currentPlayerIndex = 0;
    this.movement = null;
    this.question = null;
    this.winnerId = null;
    this.askedThisGame.clear();
    this.phase = 'awaitRoll';
    this.emit({ kind: 'gameStarted' });
    this.emit({ kind: 'turnChanged', playerId: this.current().id });
    this.sync();
  }

  roll(playerId: string): void {
    if (!this.isCurrent(playerId)) return this.reject('No es tu turno.');
    if (this.phase !== 'awaitRoll') return this.reject('No puedes tirar ahora.');
    const value = rollDie();
    this.emit({ kind: 'diceRolled', playerId, value });
    this.beginMovement(value);
  }

  move(playerId: string, toNodeId: string): void {
    if (!this.isCurrent(playerId)) return this.reject('No es tu turno.');
    if (this.phase !== 'moving' || !this.movement) return this.reject('No hay movimiento en curso.');
    if (!this.movement.options.includes(toNodeId)) {
      return this.reject('Esa casilla no es una dirección válida.');
    }
    this.stepTo(toNodeId);
    this.continueMovement();
  }

  answer(playerId: string, optionIndex: number): void {
    if (!this.isCurrent(playerId)) return this.reject('No es tu turno.');
    if (this.phase !== 'awaitAnswer' || !this.question) return this.reject('No hay pregunta activa.');

    const player = this.current();
    const profile = this.profileOf(player);
    const correct = optionIndex === this.question.answerIndex;
    const forWin = this.question.forWin;
    const category = this.question.category;
    const correctText = this.question.options[this.question.answerIndex];
    const node = this.board.nodes[player.nodeId];
    this.question = null;

    profile.stats.questionsAnswered += 1;
    if (correct) {
      profile.stats.questionsCorrect += 1;
      profile.stats.correct[category] += 1;
      player.streak += 1;
      profile.stats.bestStreak = Math.max(profile.stats.bestStreak, player.streak);
    } else {
      player.streak = 0;
    }

    this.emit({ kind: 'answered', playerId, correct, correctText });

    if (!correct) {
      this.checkAchievements(player);
      this.profiles.scheduleSave();
      this.nextTurn();
      return;
    }

    if (forWin) {
      this.winnerId = player.id;
      this.phase = 'gameOver';
      for (const p of this.players) this.profileOf(p).stats.gamesPlayed += 1;
      profile.stats.gamesWon += 1;
      this.emit({ kind: 'gameWon', playerId });
      for (const p of this.players) this.checkAchievements(p);
      this.profiles.scheduleSave();
      this.sync();
      return;
    }

    // Acertar en una sede otorga su queso (si aún no se tenía).
    if (node.kind === 'hq' && node.category && !player.wedges.includes(node.category)) {
      player.wedges.push(node.category);
      profile.stats.wedgesEarned += 1;
      this.emit({ kind: 'wedgeEarned', playerId, category: node.category });
    }

    this.checkAchievements(player);
    this.profiles.scheduleSave();
    // Acertar da turno extra: el mismo jugador vuelve a tirar.
    this.phase = 'awaitRoll';
    this.sync();
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
    const player = this.current();
    while (this.movement && this.movement.remaining > 0) {
      const options = legalMoves(this.board, player.nodeId, this.movement.cameFrom);
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
    const player = this.current();
    const from = player.nodeId;
    player.nodeId = toNodeId;
    this.movement!.cameFrom = from;
    this.movement!.remaining -= 1;
    this.emit({ kind: 'moved', playerId: player.id, toNodeId });
  }

  private land(): void {
    const player = this.current();
    const node = this.board.nodes[player.nodeId];
    this.movement = null;

    if (node.kind === 'hub') {
      if (player.wedges.length === CATEGORIES.length) {
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
   * conectados —partida en solitario o todos caídos— se elige al azar, para no
   * dejar la partida atascada esperando una elección que nadie puede hacer.
   */
  private beginFinalQuestion(): void {
    if (this.connectedRivals().length === 0) {
      this.askQuestion(this.randomCategory(), true);
      return;
    }
    this.phase = 'awaitFinalCategory';
    this.emit({ kind: 'awaitingFinalCategory', playerId: this.current().id });
    this.sync();
  }

  /**
   * @brief Un rival elige la categoría de la pregunta final.
   * @param playerId Rival que elige.
   * @param category Categoría elegida.
   *
   * La elige quien NO va a por la victoria: el jugador del turno no puede
   * escoger su propia pregunta.
   */
  chooseFinalCategory(playerId: string, category: CategoryId): void {
    if (this.phase !== 'awaitFinalCategory') return this.reject('No hay pregunta final pendiente.');
    if (this.isCurrent(playerId)) return this.reject('La categoría la eligen tus rivales, no tú.');
    const chooser = this.players.find((p) => p.id === playerId);
    if (!chooser || !chooser.connected) return this.reject('No puedes elegir ahora.');
    if (!CATEGORIES.some((c) => c.id === category)) return this.reject('Categoría desconocida.');

    this.emit({ kind: 'finalCategoryChosen', byPlayerId: playerId, category });
    this.askQuestion(category, true);
  }

  /** Rivales del jugador del turno que siguen conectados. */
  private connectedRivals(): InternalPlayer[] {
    return this.players.filter((p, index) => index !== this.currentPlayerIndex && p.connected);
  }

  private randomCategory(): CategoryId {
    return CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].id;
  }

  private askQuestion(category: CategoryId, forWin: boolean): void {
    const picked = this.repo.pick(category, {
      packIds: [...this.enabledPacks],
      askedThisGame: this.askedThisGame,
    });
    this.askedThisGame.add(picked.id);
    this.question = { ...picked, forWin };
    this.phase = 'awaitAnswer';
    this.emit({
      kind: 'landed',
      playerId: this.current().id,
      nodeId: this.current().nodeId,
      category,
    });
    this.sync();
  }

  private nextTurn(): void {
    if (!this.hasConnectedPlayers()) return; // nadie a quien pasar el turno
    const total = this.players.length;
    let idx = this.currentPlayerIndex;
    for (let i = 0; i < total; i++) {
      idx = (idx + 1) % total;
      if (this.players[idx].connected) break;
    }
    this.currentPlayerIndex = idx;
    this.phase = 'awaitRoll';
    this.emit({ kind: 'turnChanged', playerId: this.current().id });
    this.sync();
  }

  // --- Utilidades -----------------------------------------------------------

  private current(): InternalPlayer {
    return this.players[this.currentPlayerIndex];
  }

  private isCurrent(playerId: string): boolean {
    return this.players.length > 0 && this.current().id === playerId;
  }

  private emit(event: GameEvent): void {
    this.transport.broadcast({ type: 'event', event });
  }

  private reject(message: string): void {
    this.transport.broadcast({ type: 'error', message });
  }

  private sync(): void {
    this.transport.broadcast({ type: 'state', state: this.toView() });
  }

  /** Proyecta el estado interno a la vista pública (sin datos secretos). */
  toView(): GameView {
    const players: PlayerView[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      nodeId: p.nodeId,
      wedges: [...p.wedges],
      connected: p.connected,
    }));

    const view: GameView = {
      roomCode: this.code,
      phase: this.phase,
      players,
      currentPlayerIndex: this.currentPlayerIndex,
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
      };
      view.question = publicQuestion;
    }

    if (this.winnerId) view.winnerId = this.winnerId;

    return view;
  }
}

/**
 * Sala de juego: mantiene el estado de una partida y aplica las reglas. Es la
 * autoridad — valida cada acción y difunde el estado resultante más eventos
 * puntuales (para sonidos y anuncios en el cliente).
 *
 * El transporte (envío por WebSocket) se inyecta para poder testear la lógica
 * sin red.
 */

import { buildBoard, type Board } from '../shared/board.js';
import { CATEGORIES, type CategoryId } from '../shared/categories.js';
import type { Question } from '../shared/questions.js';
import type {
  GameEvent,
  GameView,
  PlayerView,
  PublicQuestion,
  ServerMessage,
  TurnPhase,
} from '../shared/protocol.js';
import { legalMoves, rollDie } from './engine.js';
import type { QuestionRepository } from './questions_repo.js';

/** Difusor de mensajes a los clientes de la sala. */
export interface Transport {
  broadcast(message: ServerMessage): void;
}

interface InternalPlayer {
  id: string;
  name: string;
  nodeId: string;
  wedges: CategoryId[];
  connected: boolean;
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
  private readonly transport: Transport;

  private players: InternalPlayer[] = [];
  private phase: TurnPhase = 'lobby';
  private currentPlayerIndex = 0;
  private movement: Movement | null = null;
  private question: (Question & { forWin: boolean }) | null = null;
  private winnerId: string | null = null;

  constructor(code: string, repo: QuestionRepository, transport: Transport) {
    this.code = code;
    this.repo = repo;
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
   * @param name Nombre elegido (identifica al jugador para reconexión).
   * @return Id del jugador, o null si la partida ya empezó y no es reconexión.
   */
  addOrReattach(name: string): string | null {
    const existing = this.players.find((p) => p.name === name);
    if (existing) {
      existing.connected = true;
      this.sync();
      return existing.id;
    }
    if (this.phase !== 'lobby') return null;
    const player: InternalPlayer = {
      id: crypto.randomUUID(),
      name,
      nodeId: this.board.startNodeId,
      wedges: [],
      connected: true,
    };
    this.players.push(player);
    this.emit({ kind: 'playerJoined', playerId: player.id, name });
    this.sync();
    return player.id;
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
    // partida se queda clavada: nadie más podría tirar. Se descarta cualquier
    // acción a medias (movimiento o pregunta) y pasa al siguiente conectado.
    const gameActive = this.phase === 'awaitRoll' || this.phase === 'moving' || this.phase === 'awaitAnswer';
    if (gameActive && index === this.currentPlayerIndex && this.hasConnectedPlayers()) {
      this.movement = null;
      this.question = null;
      this.nextTurn();
      return;
    }
    this.sync();
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

    for (const p of this.players) {
      p.nodeId = this.board.startNodeId;
      p.wedges = [];
    }
    this.currentPlayerIndex = 0;
    this.movement = null;
    this.question = null;
    this.winnerId = null;
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
    const correct = optionIndex === this.question.answerIndex;
    const forWin = this.question.forWin;
    const node = this.board.nodes[player.nodeId];
    this.question = null;
    this.emit({ kind: 'answered', playerId, correct });

    if (!correct) {
      this.nextTurn();
      return;
    }

    if (forWin) {
      this.winnerId = player.id;
      this.phase = 'gameOver';
      this.emit({ kind: 'gameWon', playerId });
      this.sync();
      return;
    }

    // Acertar en una sede otorga su queso (si aún no se tenía).
    if (node.kind === 'hq' && node.category && !player.wedges.includes(node.category)) {
      player.wedges.push(node.category);
      this.emit({ kind: 'wedgeEarned', playerId, category: node.category });
    }
    // Acertar da turno extra: el mismo jugador vuelve a tirar.
    this.phase = 'awaitRoll';
    this.sync();
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
        // Pregunta final: en el futuro la categoría la elegirán los rivales.
        const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].id;
        this.askQuestion(category, true);
      } else {
        // Centro sin todos los quesos: casilla libre, se vuelve a tirar.
        this.phase = 'awaitRoll';
        this.sync();
      }
      return;
    }

    this.askQuestion(node.category!, false);
  }

  private askQuestion(category: CategoryId, forWin: boolean): void {
    const picked = this.repo.pick(category);
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

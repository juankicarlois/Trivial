/**
 * Modo contrarreloj: una sesión **en solitario**, contra el reloj y contra tu
 * propia marca. No pasa por la sala ni por el tablero — no hay turnos, dado ni
 * quesos: solo preguntas encadenadas mientras quede tiempo.
 *
 * Vive en su propio módulo (y no dentro de `Room`) precisamente porque no
 * comparte nada con la partida de mesa salvo el banco de preguntas y el perfil:
 * meterlo en la sala habría obligado a que cada regla del tablero preguntara
 * antes "¿y si es contrarreloj?".
 *
 * Se desbloquea con un logro, así que quien no lo tenga no puede empezarla: la
 * comprobación se hace aquí, no solo en el cliente.
 */

import { CATEGORIES, type CategoryId } from '../shared/categories.js';
import type { ServerMessage, TimeAttackView } from '../shared/protocol.js';
import {
  earnedAchievements,
  TIME_ATTACK_ACHIEVEMENT,
  type AchievementDef,
} from '../shared/progress.js';
import type { Question } from '../shared/questions.js';
import type { QuestionRepository } from './questions_repo.js';
import type { Profile, ProfileStore } from './profiles.js';
import type { Scheduler } from './room.js';

/** Duración de una sesión. */
const DURATION_MS = 180_000;

/**
 * Lo que cuesta fallar. Se descuenta del reloj en vez de terminar la sesión: un
 * fallo tonto no debe echarte de la partida, pero tiene que doler.
 */
const PENALTY_MS = 10_000;

export interface TimeAttackOptions {
  /** Temporizador inyectable (para test). */
  scheduler?: Scheduler;
  durationMs?: number;
  penaltyMs?: number;
}

/**
 * @brief Comprueba si un perfil tiene desbloqueado el contrarreloj.
 * @param profile Perfil del jugador.
 * @param defs Definiciones de logros cargadas del contenido.
 * @return true si puede jugar el modo.
 */
export function canPlayTimeAttack(profile: Profile, defs: readonly AchievementDef[]): boolean {
  if (profile.achievements.includes(TIME_ATTACK_ACHIEVEMENT)) return true;
  // También vale si ya cumple el umbral pero aún no se le ha anotado el logro
  // (por ejemplo, si lo alcanzó jugando y todavía no se ha guardado el perfil).
  return earnedAchievements(profile.stats, defs).includes(TIME_ATTACK_ACHIEVEMENT);
}

export class TimeAttackSession {
  private readonly repo: QuestionRepository;
  private readonly profiles: ProfileStore;
  private readonly profileId: string;
  private readonly achievementDefs: readonly AchievementDef[];
  private readonly send: (message: ServerMessage) => void;
  private readonly schedule: Scheduler;
  private readonly durationMs: number;
  private readonly penaltyMs: number;

  /** Momento (epoch ms) en que se acaba el tiempo; se adelanta al fallar. */
  private deadline = 0;
  private cancelEnd: (() => void) | null = null;
  private question: Question | null = null;
  private asked = new Set<string>();
  private score = 0;
  private streak = 0;
  private bestStreak = 0;
  /** Marca a batir, congelada al empezar: si no, batirla la cambiaría a media sesión. */
  private previousBest = 0;
  private finished = false;
  /** Cómo fue la última respuesta, para cantarla al plantear la siguiente. */
  private lastAnswer: { correct: boolean; correctText: string } | undefined;

  constructor(
    repo: QuestionRepository,
    profiles: ProfileStore,
    profileId: string,
    achievementDefs: readonly AchievementDef[],
    send: (message: ServerMessage) => void,
    options: TimeAttackOptions = {},
  ) {
    this.repo = repo;
    this.profiles = profiles;
    this.profileId = profileId;
    this.achievementDefs = achievementDefs;
    this.send = send;
    this.schedule =
      options.scheduler ??
      ((action, delayMs) => {
        const handle = setTimeout(action, delayMs);
        return () => clearTimeout(handle);
      });
    this.durationMs = options.durationMs ?? DURATION_MS;
    this.penaltyMs = options.penaltyMs ?? PENALTY_MS;
  }

  /** @brief Arranca el reloj y plantea la primera pregunta. */
  start(): void {
    const profile = this.profiles.getOrCreate(this.profileId, 'Jugador');
    this.previousBest = profile.stats.timeAttackBest;
    this.deadline = Date.now() + this.durationMs;
    this.nextQuestion();
    this.armTimer();
  }

  /**
   * @brief Responde la pregunta en curso.
   * @param optionIndex Opción elegida.
   *
   * Acertar suma un punto y encadena; fallar descuenta tiempo del reloj. En
   * ambos casos entra otra pregunta sin pausa: el modo va de ritmo.
   */
  answer(optionIndex: number): void {
    if (this.finished || !this.question) return;

    const correct = optionIndex === this.question.answerIndex;
    const category = this.question.category;
    this.lastAnswer = {
      correct,
      correctText: this.question.options[this.question.answerIndex],
    };
    if (correct) {
      this.score += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.countAnswer(category, true);
    } else {
      this.streak = 0;
      this.countAnswer(category, false);
      this.deadline -= this.penaltyMs;
    }

    if (Date.now() >= this.deadline) {
      this.finish();
      return;
    }
    this.nextQuestion();
    this.armTimer(); // el reloj ha podido adelantarse por la penalización
  }

  /** @brief Abandona la sesión: cuenta lo conseguido hasta ahora. */
  quit(): void {
    if (!this.finished) this.finish(true);
  }

  /** Libera el temporizador pendiente (al cerrarse la conexión). */
  dispose(): void {
    this.clearTimer();
    this.finished = true;
  }

  /** true si la sesión sigue viva. */
  get running(): boolean {
    return !this.finished;
  }

  /** Vuelve a mandar el estado (al reconectar la vista, por ejemplo). */
  sync(): void {
    if (this.finished || !this.question) return;
    const view: TimeAttackView = {
      secondsLeft: Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000)),
      score: this.score,
      question: {
        id: this.question.id,
        category: this.question.category,
        text: this.question.text,
        options: [...this.question.options],
        forWin: false,
      },
      best: this.previousBest,
      penaltySeconds: Math.round(this.penaltyMs / 1000),
      ...(this.lastAnswer ? { lastAnswer: this.lastAnswer } : {}),
    };
    this.send({ type: 'timeAttack', view });
  }

  /** Suma la respuesta a las estadísticas del perfil (cuentan como cualquier otra). */
  private countAnswer(category: CategoryId, correct: boolean): void {
    const profile = this.profiles.getOrCreate(this.profileId, 'Jugador');
    profile.stats.questionsAnswered += 1;
    if (correct) {
      profile.stats.questionsCorrect += 1;
      profile.stats.correct[category] += 1;
      profile.stats.bestStreak = Math.max(profile.stats.bestStreak, this.streak);
    }
  }

  private nextQuestion(): void {
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].id;
    this.question = this.repo.pick(category, { askedThisGame: this.asked });
    this.asked.add(this.question.id);
    this.sync();
  }

  /** (Re)programa el fin de la sesión para cuando venza el reloj. */
  private armTimer(): void {
    this.clearTimer();
    this.cancelEnd = this.schedule(() => {
      this.cancelEnd = null;
      this.finish();
    }, Math.max(0, this.deadline - Date.now()));
  }

  private clearTimer(): void {
    if (this.cancelEnd) {
      this.cancelEnd();
      this.cancelEnd = null;
    }
  }

  /**
   * Cierra la sesión, guarda la marca si es récord y manda el resultado.
   *
   * @param endedEarly true si se deja a medias (no se agotó el tiempo).
   */
  private finish(endedEarly = false): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimer();
    this.question = null;

    const profile = this.profiles.getOrCreate(this.profileId, 'Jugador');
    const isRecord = this.score > this.previousBest;
    if (isRecord) profile.stats.timeAttackBest = this.score;

    // Los aciertos del contrarreloj cuentan como cualquier otro, así que aquí
    // también pueden caer logros (y con ellos, packs). Se anotan sin anunciarlos
    // uno a uno: al acabar la sesión ya se le manda su progreso actualizado.
    for (const id of earnedAchievements(profile.stats, this.achievementDefs)) {
      if (!profile.achievements.includes(id)) profile.achievements.push(id);
    }
    this.profiles.scheduleSave();

    this.send({ type: 'timeAttack', view: null });
    this.send({
      type: 'timeAttackResult',
      result: {
        score: this.score,
        previousBest: this.previousBest,
        isRecord,
        bestStreak: this.bestStreak,
        endedEarly,
      },
    });
  }
}

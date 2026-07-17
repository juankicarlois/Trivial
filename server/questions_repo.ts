/**
 * Repositorio de preguntas: banco base más packs temáticos.
 *
 * Cada sala elige qué packs tiene activos, así que el repositorio no guarda
 * "el" conjunto de preguntas: al pedir una, se le indican los packs activos y
 * se sortea entre el banco base y los de esos packs.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CategoryId } from '../shared/categories.js';
import type { Question, QuestionBank } from '../shared/questions.js';
import type { PackDef } from '../shared/progress.js';
import { CONTENT_DIR } from './content.js';

/** Baraja una copia del array (Fisher–Yates). */
function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Qué packs entran en el sorteo y qué preguntas conviene no repetir. */
export interface PickOptions {
  /** Packs activos que se suman al banco base. */
  packIds?: readonly string[];
  /** Preguntas que el jugador ya ha acertado alguna vez. */
  mastered?: ReadonlySet<string>;
  /** Preguntas ya planteadas en la partida en curso. */
  askedThisGame?: ReadonlySet<string>;
}

/** Agrupa preguntas por categoría. */
function byCategory(questions: readonly Question[]): Map<CategoryId, Question[]> {
  const map = new Map<CategoryId, Question[]>();
  for (const q of questions) {
    const list = map.get(q.category) ?? [];
    list.push(q);
    map.set(q.category, list);
  }
  return map;
}

export class QuestionRepository {
  private base = new Map<CategoryId, Question[]>();
  private packs = new Map<string, Map<CategoryId, Question[]>>();

  /**
   * @brief Carga el banco base desde un JSON `{ questions: [...] }`.
   * @param filePath Ruta del fichero.
   */
  loadBaseFile(filePath: string): void {
    const bank = JSON.parse(readFileSync(filePath, 'utf-8')) as QuestionBank;
    for (const [category, list] of byCategory(bank.questions)) {
      this.base.set(category, [...(this.base.get(category) ?? []), ...list]);
    }
  }

  /** Registra un pack temático para poder activarlo en las salas. */
  addPack(pack: PackDef): void {
    this.packs.set(pack.id, byCategory(pack.questions));
  }

  /**
   * @brief Preguntas disponibles de una categoría.
   * @param category Categoría.
   * @param packIds Packs activos que se suman al banco base.
   * @return Lista combinada (no barajada).
   */
  private pool(category: CategoryId, packIds: readonly string[]): Question[] {
    const pool = [...(this.base.get(category) ?? [])];
    for (const packId of packIds) {
      const pack = this.packs.get(packId);
      if (pack) pool.push(...(pack.get(category) ?? []));
    }
    return pool;
  }

  /** Número de preguntas disponibles de una categoría con esos packs activos. */
  count(category: CategoryId, packIds: readonly string[] = []): number {
    return this.pool(category, packIds).length;
  }

  /**
   * @brief Sortea una pregunta de la categoría, con las opciones barajadas y el
   *        índice de la respuesta correcta recalculado.
   *
   * Se evitan las preguntas que el jugador ya domina y las que ya han salido en
   * la partida. Son **preferencias, no condiciones**: el banco es finito, y
   * quedarse sin pregunta que ofrecer dejaría la partida atascada. Si no queda
   * ninguna candidata se van relajando, primero volviendo a admitir las
   * dominadas y en último extremo repitiendo alguna de la partida.
   *
   * @param category Categoría solicitada.
   * @param options Packs activos y preguntas a evitar.
   * @return Pregunta lista para plantear.
   * @throws Error si la categoría no tiene ninguna pregunta cargada.
   */
  pick(category: CategoryId, options: PickOptions = {}): Question {
    const { packIds = [], mastered, askedThisGame } = options;
    const pool = this.pool(category, packIds);
    if (pool.length === 0) throw new Error(`Sin preguntas para la categoría ${category}`);

    const fresh = pool.filter((q) => !mastered?.has(q.id) && !askedThisGame?.has(q.id));
    // Si ya se dominan todas, mejor repetir una sabida que una de esta partida.
    const unseenThisGame = pool.filter((q) => !askedThisGame?.has(q.id));
    const candidates = pick(fresh, unseenThisGame, pool);

    return shuffleOptions(candidates[Math.floor(Math.random() * candidates.length)]);
  }
}

/** Primera lista no vacía. */
function pick(...lists: Question[][]): Question[] {
  return lists.find((list) => list.length > 0) ?? [];
}

/** Baraja las opciones recalculando dónde queda la respuesta correcta. */
function shuffleOptions(question: Question): Question {
  const correctText = question.options[question.answerIndex];
  const options = shuffle(question.options);
  return { ...question, options, answerIndex: options.indexOf(correctText) };
}

/**
 * @brief Crea un repositorio con el banco base y todos los packs registrados.
 * @param packs Packs temáticos a registrar (por defecto, ninguno).
 * @return Repositorio listo para usar.
 */
export function createDefaultRepository(packs: readonly PackDef[] = []): QuestionRepository {
  const repo = new QuestionRepository();
  repo.loadBaseFile(join(CONTENT_DIR, 'questions.base.json'));
  for (const pack of packs) repo.addPack(pack);
  return repo;
}

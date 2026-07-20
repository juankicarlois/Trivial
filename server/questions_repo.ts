/**
 * Repositorio de preguntas: banco base más packs temáticos.
 *
 * Cada sala elige qué packs tiene activos, así que el repositorio no guarda
 * "el" conjunto de preguntas: al pedir una, se le indican los packs activos y
 * se sortea entre el banco base y los de esos packs.
 */

import { readFileSync, readdirSync } from 'node:fs';
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
  /** Preguntas ya planteadas en la partida en curso. */
  askedThisGame?: ReadonlySet<string>;
  /** Fuente de aleatoriedad; inyectable para test. */
  random?: () => number;
}

/**
 * Proporción de preguntas que salen de los packs activos con **un** pack puesto.
 *
 * Sin cuota, los packs eran invisibles: un pack aporta 2 preguntas por categoría
 * frente a las ~205 del banco base, así que salía una del pack el 1 % de las
 * veces — en una partida entera, ninguna. Quien desbloquea un pack quiere notarlo.
 */
const PACK_SHARE_BASE = 0.25;

/** Cuánto sube la cuota por cada pack activo de más. */
const PACK_SHARE_STEP = 0.05;

/**
 * Tope de la cuota. Con muchos packs activos la partida seguiría siendo de
 * cultura general: el banco base nunca baja del 60 %.
 */
const PACK_SHARE_MAX = 0.4;

/**
 * @brief Proporción de preguntas que deben salir de los packs activos.
 * @param packCount Número de packs activos con preguntas de la categoría.
 * @return Proporción entre 0 y `PACK_SHARE_MAX`.
 */
export function packShare(packCount: number): number {
  if (packCount <= 0) return 0;
  return Math.min(PACK_SHARE_MAX, PACK_SHARE_BASE + PACK_SHARE_STEP * (packCount - 1));
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
    return [...(this.base.get(category) ?? []), ...this.packPool(category, packIds)];
  }

  /** Preguntas de esa categoría aportadas por los packs activos. */
  private packPool(category: CategoryId, packIds: readonly string[]): Question[] {
    const pool: Question[] = [];
    for (const packId of packIds) {
      const pack = this.packs.get(packId);
      if (pack) pool.push(...(pack.get(category) ?? []));
    }
    return pool;
  }

  /** Packs activos que aportan alguna pregunta de esa categoría. */
  private packsWithQuestions(category: CategoryId, packIds: readonly string[]): number {
    return packIds.filter((id) => (this.packs.get(id)?.get(category)?.length ?? 0) > 0).length;
  }

  /** Número de preguntas disponibles de una categoría con esos packs activos. */
  count(category: CategoryId, packIds: readonly string[] = []): number {
    return this.pool(category, packIds).length;
  }

  /**
   * @brief Sortea una pregunta de la categoría, con las opciones barajadas y el
   *        índice de la respuesta correcta recalculado.
   *
   * El sorteo es en dos pasos: primero **de dónde** sale (banco base o packs
   * activos, según `packShare`) y luego **cuál**. Sorteando sobre los dos
   * montones juntos, las 2 preguntas por categoría de un pack se perdían entre
   * las ~205 del banco y no salía ninguna en toda la partida.
   *
   * Se evitan las preguntas ya planteadas en la partida en curso: como la carta
   * usada del Trivial de mesa, no vuelve al montón. Es una **preferencia, no una
   * condición**: el banco es finito y una partida larga puede agotar una
   * categoría; quedarse sin pregunta que ofrecer dejaría la partida atascada, así
   * que llegado el caso se repite antes que fallar. Por eso, si la fuente que
   * tocaba está agotada, se tira de la otra antes de repetir.
   *
   * @param category Categoría solicitada.
   * @param options Packs activos y preguntas ya salidas en la partida.
   * @return Pregunta lista para plantear.
   * @throws Error si la categoría no tiene ninguna pregunta cargada.
   */
  pick(category: CategoryId, options: PickOptions = {}): Question {
    const { packIds = [], askedThisGame, random = Math.random } = options;
    const base = this.base.get(category) ?? [];
    const fromPacks = this.packPool(category, packIds);
    if (base.length === 0 && fromPacks.length === 0) {
      throw new Error(`Sin preguntas para la categoría ${category}`);
    }

    // Primero se decide de dónde sale (cuota de packs), y solo después qué
    // pregunta: sorteando sobre el montón junto, los packs no aparecerían nunca.
    const share = packShare(this.packsWithQuestions(category, packIds));
    const tocaPack = fromPacks.length > 0 && random() < share;

    // Si la fuente elegida ya está agotada en esta partida, se tira de la otra
    // antes que repetir una pregunta ya vista.
    const preferida = tocaPack ? fromPacks : base;
    const alternativa = tocaPack ? base : fromPacks;
    const sinVer = (list: readonly Question[]) => list.filter((q) => !askedThisGame?.has(q.id));

    const candidates =
      sinVer(preferida).length > 0
        ? sinVer(preferida)
        : sinVer(alternativa).length > 0
          ? sinVer(alternativa)
          : [...preferida, ...alternativa];

    return shuffleOptions(candidates[Math.floor(random() * candidates.length)]);
  }
}

/** Baraja las opciones recalculando dónde queda la respuesta correcta. */
function shuffleOptions(question: Question): Question {
  const correctText = question.options[question.answerIndex];
  const options = shuffle(question.options);
  return { ...question, options, answerIndex: options.indexOf(correctText) };
}

/**
 * @brief Lista los ficheros del banco base: todo `content/questions*.json`.
 *
 * El banco se reparte en varios ficheros (uno por categoría además del base)
 * para que ampliarlo sea añadir un fichero, sin editar uno gigante.
 *
 * @param contentDir Directorio de contenido.
 * @return Rutas de los ficheros del banco, en orden estable.
 */
export function baseQuestionFiles(contentDir: string = CONTENT_DIR): string[] {
  return readdirSync(contentDir)
    .filter((f) => f.startsWith('questions') && f.endsWith('.json'))
    .sort()
    .map((f) => join(contentDir, f));
}

/**
 * @brief Crea un repositorio con todo el banco base y los packs registrados.
 * @param packs Packs temáticos a registrar (por defecto, ninguno).
 * @return Repositorio listo para usar.
 */
export function createDefaultRepository(packs: readonly PackDef[] = []): QuestionRepository {
  const repo = new QuestionRepository();
  for (const file of baseQuestionFiles()) repo.loadBaseFile(file);
  for (const pack of packs) repo.addPack(pack);
  return repo;
}

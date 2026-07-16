/**
 * Repositorio de preguntas: carga el banco desde JSON y sirve preguntas
 * aleatorias por categoría, barajando las opciones para que la posición de la
 * respuesta correcta no sea predecible.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CategoryId } from '../shared/categories.js';
import type { Question, QuestionBank } from '../shared/questions.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Baraja una copia del array (Fisher–Yates). */
function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class QuestionRepository {
  private byCategory = new Map<CategoryId, Question[]>();

  /**
   * @brief Carga un banco de preguntas desde un archivo JSON.
   * @param filePath Ruta al JSON con forma `{ questions: Question[] }`.
   */
  loadFile(filePath: string): void {
    const raw = readFileSync(filePath, 'utf-8');
    const bank = JSON.parse(raw) as QuestionBank;
    for (const q of bank.questions) {
      const list = this.byCategory.get(q.category) ?? [];
      list.push(q);
      this.byCategory.set(q.category, list);
    }
  }

  /** Número de preguntas cargadas para una categoría. */
  count(category: CategoryId): number {
    return this.byCategory.get(category)?.length ?? 0;
  }

  /**
   * @brief Devuelve una pregunta aleatoria de la categoría, con las opciones
   *        barajadas y el índice de la respuesta correcta recalculado.
   * @param category Categoría solicitada.
   * @return Pregunta lista para plantear.
   * @throws Error si no hay preguntas de esa categoría.
   */
  pick(category: CategoryId): Question {
    const list = this.byCategory.get(category);
    if (!list || list.length === 0) {
      throw new Error(`Sin preguntas para la categoría ${category}`);
    }
    const base = list[Math.floor(Math.random() * list.length)];
    const correctText = base.options[base.answerIndex];
    const options = shuffle(base.options);
    return {
      ...base,
      options,
      answerIndex: options.indexOf(correctText),
    };
  }
}

/** Crea un repositorio cargado con el banco base incluido en `content/`. */
export function createDefaultRepository(): QuestionRepository {
  const repo = new QuestionRepository();
  repo.loadFile(join(here, '..', 'content', 'questions.base.json'));
  return repo;
}

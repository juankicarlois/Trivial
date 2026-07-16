/**
 * Tipo interno de pregunta (incluye la respuesta correcta). El servidor nunca
 * envía este tipo al cliente tal cual: expone `PublicQuestion` sin `answerIndex`.
 */

import type { CategoryId } from './categories.js';

export interface Question {
  id: string;
  category: CategoryId;
  text: string;
  /** Opciones de respuesta; se barajan al plantear la pregunta. */
  options: string[];
  /** Índice de la opción correcta dentro de `options`. */
  answerIndex: number;
  /** Dificultad 1 (fácil) a 3 (difícil). Opcional. */
  difficulty?: 1 | 2 | 3;
}

/** Conjunto de preguntas cargado desde JSON. */
export interface QuestionBank {
  questions: Question[];
}

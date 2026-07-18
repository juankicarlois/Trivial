/**
 * Dificultad de los bots. La dificultad afecta a la **probabilidad de acertar**
 * las preguntas (la palanca que de verdad se nota); la navegación por el tablero
 * es igual de sensata en todos los niveles.
 */

export type BotDifficulty = 'facil' | 'normal' | 'dificil';

export interface BotDifficultyInfo {
  id: BotDifficulty;
  /** Nombre mostrado. */
  label: string;
  /** Probabilidad de acertar una pregunta (0..1). */
  accuracy: number;
}

export const BOT_DIFFICULTIES: readonly BotDifficultyInfo[] = [
  { id: 'facil', label: 'Fácil', accuracy: 0.4 },
  { id: 'normal', label: 'Normal', accuracy: 0.65 },
  { id: 'dificil', label: 'Difícil', accuracy: 0.9 },
];

/** Probabilidad de acierto de una dificultad; 0.5 si es desconocida. */
export function botAccuracy(difficulty: BotDifficulty): number {
  return BOT_DIFFICULTIES.find((d) => d.id === difficulty)?.accuracy ?? 0.5;
}

/** true si el id corresponde a una dificultad válida. */
export function isBotDifficulty(value: string): value is BotDifficulty {
  return BOT_DIFFICULTIES.some((d) => d.id === value);
}

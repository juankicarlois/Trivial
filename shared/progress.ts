/**
 * Progreso del jugador: estadísticas, logros y packs temáticos.
 *
 * Un **logro** se mide siempre contra una estadística acumulada del perfil
 * (`stat`) y un umbral (`atLeast`). Este modelo, deliberadamente simple, permite
 * añadir logros nuevos editando JSON, sin tocar código.
 *
 * Un **pack** es un bloque de preguntas temáticas que se desbloquea al
 * conseguir un logro concreto.
 */

import { CATEGORIES, type CategoryId } from './categories.js';
import type { Question } from './questions.js';

/**
 * Logro que desbloquea el modo contrarreloj. Vive aquí, y no en el servidor,
 * porque el cliente también lo necesita para saber si enseñar el acceso al modo
 * (la comprobación de verdad la hace el servidor al empezar la sesión).
 */
export const TIME_ATTACK_ACHIEVEMENT = 'contrarreloj';

/** Estadísticas acumuladas de un perfil, a lo largo de todas sus partidas. */
export interface ProfileStats {
  gamesPlayed: number;
  gamesWon: number;
  wedgesEarned: number;
  questionsAnswered: number;
  questionsCorrect: number;
  /** Mayor número de aciertos seguidos logrado en una partida. */
  bestStreak: number;
  /** Aciertos por categoría. */
  correct: Record<CategoryId, number>;
  /** Mejor marca en el modo contrarreloj (aciertos en una sola sesión). */
  timeAttackBest: number;
}

/** Estadística sobre la que se mide un logro. */
export type StatKey =
  | 'gamesPlayed'
  | 'gamesWon'
  | 'wedgesEarned'
  | 'questionsAnswered'
  | 'questionsCorrect'
  | 'bestStreak'
  | 'timeAttackBest'
  | `correct.${CategoryId}`;

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Estadística que se mide. */
  stat: StatKey;
  /** Valor a partir del cual el logro se considera conseguido. */
  atLeast: number;
}

export interface PackDef {
  id: string;
  name: string;
  description: string;
  /** Id del logro que lo desbloquea. */
  unlockedBy: string;
  questions: Question[];
}

/** @brief Crea unas estadísticas a cero, con todas las categorías presentes. */
export function emptyStats(): ProfileStats {
  const correct = {} as Record<CategoryId, number>;
  for (const cat of CATEGORIES) correct[cat.id] = 0;
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    wedgesEarned: 0,
    questionsAnswered: 0,
    questionsCorrect: 0,
    bestStreak: 0,
    correct,
    timeAttackBest: 0,
  };
}

/**
 * @brief Lee el valor actual de una estadística por su clave.
 * @param stats Estadísticas del perfil.
 * @param key Clave, plana (`gamesWon`) o por categoría (`correct.arte`).
 * @return Valor actual; 0 si la clave no corresponde a nada conocido.
 */
export function statValue(stats: ProfileStats, key: StatKey): number {
  if (key.startsWith('correct.')) {
    const category = key.slice('correct.'.length) as CategoryId;
    return stats.correct[category] ?? 0;
  }
  const value = (stats as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * @brief Decide qué logros cumple ya un perfil.
 * @param stats Estadísticas del perfil.
 * @param defs Definiciones de logros cargadas del JSON.
 * @return Ids de todos los logros cuyo umbral se alcanza.
 */
export function earnedAchievements(stats: ProfileStats, defs: readonly AchievementDef[]): string[] {
  return defs.filter((def) => statValue(stats, def.stat) >= def.atLeast).map((def) => def.id);
}

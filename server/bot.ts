/**
 * Decisiones de los bots, en funciones puras y testeables (sin estado ni red).
 * La sala se encarga de ejecutarlas con temporizadores para que el bot juegue a
 * un ritmo seguible.
 */

import { distancesFrom, HUB_ID, previewMove, type Board } from '../shared/board.js';
import { CATEGORIES, type CategoryId } from '../shared/categories.js';
import { botAccuracy, type BotDifficulty } from '../shared/bot.js';

/**
 * @brief Elige hacia dónde mover el bot entre las direcciones disponibles.
 *
 * Prioridad: (1) si una dirección cae justo en una sede cuyo queso le falta, la
 * toma; (2) si ya tiene los seis quesos, tira hacia el centro; (3) si no, hacia
 * la sede que le falta más cercana. Como último recurso, la primera opción.
 *
 * @param board Tablero.
 * @param from Casilla actual del bot.
 * @param options Direcciones disponibles (ids de casilla).
 * @param steps Pasos que le quedan por gastar.
 * @param wedges Quesos ya conseguidos.
 * @return Id de la casilla elegida.
 */
export function chooseBotMove(
  board: Board,
  from: string,
  options: readonly string[],
  steps: number,
  wedges: readonly CategoryId[],
): string {
  if (options.length === 0) throw new Error('No hay direcciones para el bot.');

  const missing = CATEGORIES.filter((c) => !wedges.includes(c.id));

  // (1) Coger un queso que falta, si cae justo al final del movimiento.
  for (const option of options) {
    const landing = previewMove(board, from, option, steps).landingNodeId;
    if (landing && missing.some((c) => landing === `hq-${c.id}`)) return option;
  }

  // (2)/(3) Objetivo hacia el que acercarse: el centro si ya están los seis
  // quesos; si no, la sede que falta más cercana desde la casilla actual.
  const target = targetNode(board, from, missing);
  if (!target) return options[0];

  // Elegir la dirección que deja al bot más cerca del objetivo.
  let best = options[0];
  let bestDistance = Infinity;
  for (const option of options) {
    const distance = distancesFrom(board, option).get(target) ?? Infinity;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

/**
 * @brief Decide si un bot pulsa el rebote y cuánto tarda en hacerlo.
 *
 * Pulsa con la misma probabilidad con la que acierta: un bot fácil se lanza
 * pocas veces, uno difícil casi siempre. El retardo reparte la ventana para que
 * el mejor sea también el más rápido, pero **nunca antes de un tercio** de la
 * ventana: si los bots pulsaran al instante, una persona no llegaría jamás y el
 * pulsador sería decorativo.
 *
 * @param difficulty Dificultad del bot.
 * @param windowMs Duración del pulsador.
 * @param random Fuente de aleatoriedad (inyectable para test).
 * @return Milisegundos hasta pulsar, o null si este bot no pulsa.
 */
export function botBuzzDelayMs(
  difficulty: BotDifficulty,
  windowMs: number,
  random: () => number = Math.random,
): number | null {
  const accuracy = botAccuracy(difficulty);
  if (random() > accuracy) return null;

  // Cuanto mejor es el bot, antes reacciona dentro del margen permitido.
  const earliest = windowMs / 3;
  const latest = windowMs * 0.9;
  const span = latest - earliest;
  const speed = 1 - accuracy; // 0 el mejor, 1 el peor
  return Math.round(earliest + span * speed * random());
}

/** Casilla objetivo del bot: el centro con todos los quesos, o la sede que falta más cercana. */
function targetNode(
  board: Board,
  from: string,
  missing: readonly { id: CategoryId }[],
): string | null {
  if (missing.length === 0) return HUB_ID;
  const distances = distancesFrom(board, from);
  let target: string | null = null;
  let best = Infinity;
  for (const cat of missing) {
    const id = `hq-${cat.id}`;
    const distance = distances.get(id) ?? Infinity;
    if (distance < best) {
      best = distance;
      target = id;
    }
  }
  return target;
}

/**
 * @brief Decide qué opción responde el bot.
 *
 * Con probabilidad `botAccuracy(difficulty)` acierta; si no, elige una opción
 * incorrecta al azar. Así la dificultad se nota en los aciertos.
 *
 * @param question Pregunta con la respuesta correcta y sus opciones.
 * @param difficulty Dificultad del bot.
 * @param random Fuente de aleatoriedad (inyectable para test).
 * @return Índice de la opción que elige el bot.
 */
export function botAnswerIndex(
  question: { options: readonly string[]; answerIndex: number },
  difficulty: BotDifficulty,
  random: () => number = Math.random,
): number {
  if (random() < botAccuracy(difficulty)) return question.answerIndex;

  const wrong = question.options
    .map((_option, index) => index)
    .filter((index) => index !== question.answerIndex);
  if (wrong.length === 0) return question.answerIndex;
  return wrong[Math.floor(random() * wrong.length)];
}

/**
 * @brief Categoría que un bot rival elige para la pregunta final.
 * @param random Fuente de aleatoriedad (inyectable para test).
 * @return Id de categoría.
 */
export function chooseBotFinalCategory(random: () => number = Math.random): CategoryId {
  return CATEGORIES[Math.floor(random() * CATEGORIES.length)].id;
}

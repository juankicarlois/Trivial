/**
 * Lógica pura del tablero y las reglas de movimiento. Sin estado global ni red:
 * funciones testeables que operan sobre el tablero y devuelven resultados.
 */

import type { Board } from '../shared/board.js';

/**
 * @brief Calcula los nodos a los que se puede avanzar desde una casilla.
 *
 * Se excluye la casilla de la que se acaba de venir para no oscilar en el sitio,
 * salvo que sea la única salida (caso imposible en este tablero, pero seguro).
 *
 * @param board Tablero.
 * @param nodeId Nodo actual.
 * @param cameFrom Nodo del que se viene, o null si es el primer paso del turno.
 * @return Lista de ids de nodos adyacentes válidos.
 */
export function legalMoves(board: Board, nodeId: string, cameFrom: string | null): string[] {
  const node = board.nodes[nodeId];
  if (!node) throw new Error(`Nodo desconocido: ${nodeId}`);
  const filtered = node.neighbors.filter((n) => n !== cameFrom);
  return filtered.length > 0 ? filtered : [...node.neighbors];
}

/** Resultado de tirar el dado: valor 1..6. */
export function rollDie(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * 6);
}

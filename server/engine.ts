/**
 * Lógica pura del tablero y las reglas de movimiento. Sin estado global ni red:
 * funciones testeables que operan sobre el tablero y devuelven resultados.
 */

import { forwardMoves, type Board } from '../shared/board.js';

/**
 * @brief Calcula los nodos a los que se puede avanzar desde una casilla.
 *
 * Delega en `forwardMoves` (compartida con el cliente): la regla de por dónde se
 * puede avanzar debe ser una sola. El cliente la necesita para adelantar al
 * jugador dónde caería, y si hubiera dos implementaciones acabarían diciendo
 * cosas distintas.
 *
 * @param board Tablero.
 * @param nodeId Nodo actual.
 * @param cameFrom Nodo del que se viene, o null si es el primer paso del turno.
 * @return Lista de ids de nodos adyacentes válidos.
 */
export function legalMoves(board: Board, nodeId: string, cameFrom: string | null): string[] {
  return forwardMoves(board, nodeId, cameFrom);
}

/** Resultado de tirar el dado: valor 1..6. */
export function rollDie(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * 6);
}

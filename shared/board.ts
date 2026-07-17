/**
 * Construcción del tablero de la rueda estilo Pursuit como un grafo de nodos.
 *
 * Estructura (ver docs/DISENO.md):
 *  - 1 hub central.
 *  - Anillo exterior de 42 casillas: 6 segmentos de 6 casillas normales + 1 sede
 *    (HQ) de categoría al final de cada segmento.
 *  - 6 radios de 3 casillas cada uno, que conectan cada sede con el hub.
 *
 * El movimiento se resuelve como recorrido por adyacencias; los cruces (sedes y
 * hub) ofrecen varias direcciones y el jugador elige.
 */

import { CATEGORIES, type CategoryId } from './categories.js';

export type NodeKind = 'hub' | 'ring' | 'hq' | 'spoke';

export interface BoardNode {
  /** Identificador estable del nodo (p. ej. 'hub', 'ring-7', 'hq-geografia'). */
  id: string;
  kind: NodeKind;
  /** Categoría de la casilla; el hub no tiene. */
  category?: CategoryId;
  /** Ids de nodos adyacentes. */
  neighbors: string[];
  /** Etiqueta accesible ("Sede de Geografía", "Casilla de Historia"…). */
  label: string;
}

export interface Board {
  nodes: Record<string, BoardNode>;
  /** Nodo donde empiezan todas las fichas (el centro). */
  startNodeId: string;
}

/**
 * Resultado de asomarse a una dirección antes de moverse: dónde acabarías si
 * gastases ahí todos los pasos que te quedan.
 *
 * Es la información que un jugador que ve obtiene de un vistazo contando
 * casillas, y que sin esto un jugador ciego no tiene forma de conocer.
 */
export interface MovePreview {
  /** Casilla inmediata en esa dirección. */
  nextNodeId: string;
  /**
   * Casilla donde caerías, si el camino no se bifurca antes de gastar los pasos.
   * `null` si antes llegas a un cruce y tendrás que volver a elegir.
   */
  landingNodeId: string | null;
  /** Cruce donde tendrás que elegir de nuevo, si lo hay. */
  junctionNodeId: string | null;
  /** Pasos que te quedarían al llegar a ese cruce. */
  stepsAtJunction: number;
}

export const HUB_ID = 'hub';
export const RING_SIZE = 42;
/** Casillas del anillo entre una sede y la siguiente (sin contar la sede). */
export const SEGMENT_LENGTH = 7;
export const SPOKE_LENGTH = 3;

const HUB_ID_LOCAL = HUB_ID;

/** Id del nodo del anillo en la posición dada (0..41). */
function ringId(position: number): string {
  return `ring-${((position % RING_SIZE) + RING_SIZE) % RING_SIZE}`;
}

/** Id de la casilla k (1..SPOKE_LENGTH) del radio de la categoría dada. */
function spokeId(categoryIndex: number, k: number): string {
  return `spoke-${CATEGORIES[categoryIndex].id}-${k}`;
}

/** Id de la sede de la categoría en el índice dado. */
function hqId(categoryIndex: number): string {
  return `hq-${CATEGORIES[categoryIndex].id}`;
}

/**
 * @brief Construye el grafo completo del tablero.
 * @return Tablero con todos los nodos y adyacencias resueltas.
 */
export function buildBoard(): Board {
  const nodes: Record<string, BoardNode> = {};

  const add = (node: BoardNode): void => {
    nodes[node.id] = node;
  };

  // Hub central. Sus vecinos (los extremos de los radios) se añaden abajo.
  add({ id: HUB_ID_LOCAL, kind: 'hub', neighbors: [], label: 'Centro de la rueda' });

  // Anillo exterior: 42 casillas en ciclo. Las posiciones múltiplo de SEGMENT_LENGTH
  // son sedes de categoría; el resto, casillas normales.
  for (let pos = 0; pos < RING_SIZE; pos++) {
    const isHq = pos % SEGMENT_LENGTH === 0;
    const segmentIndex = Math.floor(pos / SEGMENT_LENGTH) % CATEGORIES.length;
    const category: CategoryId = isHq
      ? CATEGORIES[segmentIndex].id
      : CATEGORIES[pos % CATEGORIES.length].id;

    const neighbors = [ringId(pos - 1), ringId(pos + 1)];

    if (isHq) {
      // La sede se identifica por su categoría; el nodo del anillo apunta a ella.
      const id = hqId(segmentIndex);
      neighbors.push(spokeId(segmentIndex, 1));
      add({
        id,
        kind: 'hq',
        category,
        neighbors,
        label: `Sede de ${CATEGORIES[segmentIndex].name}`,
      });
    } else {
      add({
        id: ringId(pos),
        kind: 'ring',
        category,
        neighbors,
        label: `Casilla de ${CATEGORIES[pos % CATEGORIES.length].name}`,
      });
    }
  }

  // Fija las adyacencias del anillo hacia las sedes: los vecinos calculados arriba
  // usan ring-<pos>, pero las sedes tienen id hq-<categoria>. Reescribimos las
  // referencias a posiciones de sede por su id real.
  const hqPositionToId = new Map<string, string>();
  for (let seg = 0; seg < CATEGORIES.length; seg++) {
    hqPositionToId.set(ringId(seg * SEGMENT_LENGTH), hqId(seg));
  }
  for (const node of Object.values(nodes)) {
    node.neighbors = node.neighbors.map((n) => hqPositionToId.get(n) ?? n);
  }

  // Radios: cada uno conecta su sede con el hub pasando por SPOKE_LENGTH casillas.
  for (let seg = 0; seg < CATEGORIES.length; seg++) {
    for (let k = 1; k <= SPOKE_LENGTH; k++) {
      const prev = k === 1 ? hqId(seg) : spokeId(seg, k - 1);
      const next = k === SPOKE_LENGTH ? HUB_ID_LOCAL : spokeId(seg, k + 1);
      // Todo el radio pertenece a la categoría de su sede: así, al elegir "Radio
      // de Geografía" desde un cruce, el jugador sabe que lleva a esa sede. La
      // coherencia de navegación es clave en un juego que se juega de oído.
      add({
        id: spokeId(seg, k),
        kind: 'spoke',
        category: CATEGORIES[seg].id,
        neighbors: [prev, next],
        label: `Radio de ${CATEGORIES[seg].name}`,
      });
    }
  }
  // El hub conecta con el extremo interior de cada radio.
  nodes[HUB_ID_LOCAL].neighbors = Array.from(
    { length: CATEGORIES.length },
    (_unused, seg) => spokeId(seg, SPOKE_LENGTH),
  );

  return { nodes, startNodeId: HUB_ID_LOCAL };
}

/**
 * @brief Casillas a las que se puede avanzar desde una, sin dar marcha atrás.
 *
 * Se excluye la casilla de la que se acaba de venir para no oscilar en el sitio,
 * salvo que sea la única salida (caso imposible en este tablero, pero seguro).
 *
 * @param board Tablero.
 * @param nodeId Casilla actual.
 * @param cameFrom Casilla de la que se viene, o null en el primer paso del turno.
 * @return Ids de las casillas a las que se puede avanzar.
 * @throws Error si la casilla no existe.
 */
export function forwardMoves(board: Board, nodeId: string, cameFrom: string | null): string[] {
  const node = board.nodes[nodeId];
  if (!node) throw new Error(`Nodo desconocido: ${nodeId}`);
  const filtered = node.neighbors.filter((n) => n !== cameFrom);
  return filtered.length > 0 ? filtered : [...node.neighbors];
}

/**
 * @brief Calcula dónde acabarías al tomar una dirección con los pasos dados.
 *
 * Recorre el camino sin dar marcha atrás. Los tramos sin desvío se recorren
 * solos, así que el destino es único hasta que se llega a un cruce (una sede o
 * el centro) con pasos de sobra: ahí habría que volver a elegir y el destino ya
 * no está determinado.
 *
 * @param board Tablero.
 * @param from Casilla actual.
 * @param to Primera casilla de la dirección que se quiere sopesar.
 * @param steps Pasos que quedan por gastar (contando el que lleva a `to`).
 * @return Qué pasaría al tomar esa dirección.
 */
export function previewMove(board: Board, from: string, to: string, steps: number): MovePreview {
  let previous = from;
  let current = to;
  let used = 1;

  while (used < steps) {
    const options = forwardMoves(board, current, previous);
    if (options.length !== 1) {
      return {
        nextNodeId: to,
        landingNodeId: null,
        junctionNodeId: current,
        stepsAtJunction: steps - used,
      };
    }
    previous = current;
    current = options[0];
    used += 1;
  }

  return { nextNodeId: to, landingNodeId: current, junctionNodeId: null, stepsAtJunction: 0 };
}

/**
 * @brief Distancia (en casillas) desde una casilla a todas las demás.
 *
 * Recorrido en anchura sobre el grafo. No aplica la regla de no dar marcha
 * atrás: sirve para orientarse ("la sede de Ciencia está a 4"), no para validar
 * un movimiento concreto.
 *
 * @param board Tablero.
 * @param from Casilla de partida.
 * @return Distancia mínima a cada casilla alcanzable, incluida `from` (0).
 */
export function distancesFrom(board: Board, from: string): Map<string, number> {
  const distances = new Map<string, number>([[from, 0]]);
  const queue: string[] = [from];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const distance = distances.get(current)!;
    for (const neighbor of board.nodes[current].neighbors) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, distance + 1);
      queue.push(neighbor);
    }
  }
  return distances;
}

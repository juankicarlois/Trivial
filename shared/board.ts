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

/**
 * Categorías base del juego (2026). El orden define su posición alrededor de la
 * rueda y el orden en que se muestran los quesos.
 */

export type CategoryId =
  | 'geografia'
  | 'historia'
  | 'arte'
  | 'ciencia'
  | 'deportes'
  | 'cultura';

export interface Category {
  /** Identificador estable usado en datos y protocolo. */
  id: CategoryId;
  /** Nombre mostrado y anunciado por el lector. */
  name: string;
  /** Color del queso/casilla (solo apoyo visual; nunca canal único). */
  color: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: 'geografia', name: 'Geografía', color: '#1e6fd9' },
  { id: 'historia', name: 'Historia', color: '#e0a80d' },
  { id: 'arte', name: 'Arte y Literatura', color: '#8a3ffc' },
  { id: 'ciencia', name: 'Ciencia y Naturaleza', color: '#159c5b' },
  { id: 'deportes', name: 'Deportes y Ocio', color: '#e05a0d' },
  { id: 'cultura', name: 'Cultura y Tecnología', color: '#d61f69' },
];

/** Devuelve la categoría por su id, o lanza si no existe (dato corrupto). */
export function categoryById(id: CategoryId): Category {
  const found = CATEGORIES.find((c) => c.id === id);
  if (!found) throw new Error(`Categoría desconocida: ${id}`);
  return found;
}

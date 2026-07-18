/**
 * Narración: convierte el estado del juego en las frases que oye el jugador.
 *
 * Este módulo es la parte más importante de la accesibilidad: quien no ve el
 * tablero solo dispone de estas frases para saber dónde está, hacia dónde puede
 * ir y qué le espera. Va aparte de la interfaz, sin tocar el DOM, para poder
 * probarlo: una frase mal redactada aquí (un "a 0 casillas", un plural mal
 * puesto) deja a alguien sin poder jugar, y sin tests no se detecta.
 */

import { distancesFrom, previewMove, HUB_ID, type Board, type BoardNode } from '../shared/board.js';
import { CATEGORIES, categoryById, type CategoryId } from '../shared/categories.js';
import type { AchievementView, TeamView } from '../shared/protocol.js';

/** Distancia en palabras. El caso 0 importa: "a 0 casillas" no se entiende. */
export function distanceText(distance: number): string {
  if (distance === 0) return 'estás en ella';
  if (distance === 1) return 'a 1 casilla';
  return `a ${distance} casillas`;
}

/** Apostilla sobre lo que te espera en la casilla de destino. */
function landingHint(landing: BoardNode, myWedges: readonly CategoryId[]): string {
  if (landing.kind === 'hub') {
    return myWedges.length === CATEGORIES.length
      ? ' ¡Pregunta final para ganar!'
      : ' Casilla libre: vuelves a tirar.';
  }
  if (landing.kind === 'hq' && landing.category) {
    return myWedges.includes(landing.category) ? ' Queso que ya tienes.' : ' ¡Queso que te falta!';
  }
  return '';
}

/**
 * @brief Describe una dirección diciendo dónde acabarías si la tomas.
 *
 * Quien ve el tablero cuenta casillas y sabe al instante dónde va a caer. Con
 * solo el nombre de la casilla de al lado ("Casilla de Historia") esa
 * información se pierde y hay que elegir a ciegas, así que aquí se dice el
 * destino y si allí hay algo que interese.
 *
 * @param board Tablero.
 * @param from Casilla donde está la ficha.
 * @param toNodeId Dirección que se describe.
 * @param steps Pasos que quedan por gastar.
 * @param myWedges Quesos ya conseguidos, para señalar los que faltan.
 * @return Frase para el botón de esa dirección.
 */
export function describeDirection(
  board: Board,
  from: string,
  toNodeId: string,
  steps: number,
  myWedges: readonly CategoryId[],
): string {
  const nextLabel = board.nodes[toNodeId]?.label ?? toNodeId;
  if (!board.nodes[from]) return nextLabel;

  const preview = previewMove(board, from, toNodeId, steps);

  // El camino se bifurca antes de gastar los pasos: no se puede prometer destino.
  if (!preview.landingNodeId) {
    const junction = board.nodes[preview.junctionNodeId ?? '']?.label ?? 'un cruce';
    const left = preview.stepsAtJunction;
    return `${nextLabel}. Llegas a ${junction} y eliges de nuevo con ${left} paso${left === 1 ? '' : 's'}.`;
  }

  const landing = board.nodes[preview.landingNodeId];
  if (!landing) return nextLabel;
  const hint = landingHint(landing, myWedges);
  return preview.landingNodeId === toNodeId
    ? `${nextLabel}. Caes aquí.${hint}`
    : `${nextLabel}. Caes en: ${landing.label}.${hint}`;
}

/**
 * @brief Resume a qué distancia queda cada sede que falta, desde la posición
 *        actual. Permite hacerse un mapa mental del tablero sin verlo.
 * @param board Tablero.
 * @param player Jugador que consulta.
 * @return Frase con la posición y las sedes pendientes, de más cerca a más lejos.
 */
export function boardRadarSummary(board: Board, team: TeamView): string {
  const distances = distancesFrom(board, team.nodeId);
  const parts = [`Estás en ${board.nodes[team.nodeId]?.label ?? ''}.`];

  const missing = CATEGORIES.filter((c) => !team.wedges.includes(c.id));
  if (missing.length === 0) {
    parts.push(`Tienes los seis quesos: el centro está ${distanceText(distances.get(HUB_ID) ?? 0)}. Ve a ganar.`);
    return parts.join(' ');
  }

  const sedes = missing
    .map((cat) => ({ cat, distance: distances.get(`hq-${cat.id}`) ?? 0 }))
    .sort((a, b) => a.distance - b.distance)
    .map(({ cat, distance }) => `${cat.name}, ${distanceText(distance)}`);
  parts.push(`Sedes que te faltan: ${sedes.join('; ')}.`);
  return parts.join(' ');
}

/**
 * @brief Resume dónde está cada rival y cómo va, para no depender de ver el
 *        tablero. Un vidente lo capta de un vistazo: posición de cada ficha,
 *        quesos conseguidos y quién amenaza con ganar.
 *
 * Se conserva el orden de la partida (el mismo de la lista de jugadores y de los
 * turnos), para que el jugador construya un mapa mental estable.
 *
 * @param board Tablero, para nombrar la casilla de cada rival.
 * @param players Todos los jugadores de la partida.
 * @param myId Id propio, para excluirse.
 * @return Frase con cada rival, o aviso si no hay ninguno.
 */
export function rivalsSummary(
  board: Board,
  teams: readonly TeamView[],
  myTeamId: string | null,
): string {
  const rivals = teams.filter((t) => t.id !== myTeamId);
  if (rivals.length === 0) return 'No hay rivales en la partida.';

  const parts = rivals.map((rival) => {
    const where = board.nodes[rival.nodeId]?.label ?? 'una casilla';
    const count = rival.wedges.length;
    const wedges =
      count === 0 ? 'sin quesos' : count === 1 ? '1 queso' : `${count} quesos`;
    const nearWin =
      count === CATEGORIES.length - 1 ? ', ¡le falta un queso para ir a ganar!' : '';
    return `${rival.name}, en ${where}, ${wedges}${nearWin}`;
  });
  return `Rivales: ${parts.join('. ')}.`;
}

/** @brief Resume los quesos del bando: cuáles tiene y cuáles le faltan. */
export function wedgesSummary(team: TeamView | undefined): string {
  if (!team) return 'Todavía no estás en una partida.';
  const earned = team.wedges.map((id) => categoryById(id).name);
  const missing = CATEGORIES.filter((c) => !team.wedges.includes(c.id)).map((c) => c.name);
  if (earned.length === 0) return `No tienes ningún queso. Te faltan los seis: ${missing.join(', ')}.`;
  if (missing.length === 0) return '¡Tienes los seis quesos! Vuelve al centro para ganar.';
  return `Tienes ${earned.length} de ${CATEGORIES.length} quesos: ${earned.join(', ')}. Te faltan: ${missing.join(', ')}.`;
}

/** @brief Resume los logros, incluyendo el que se tiene más a mano. */
export function achievementsSummary(achievements: readonly AchievementView[]): string {
  if (achievements.length === 0) return 'Todavía no se han cargado tus logros.';
  const unlocked = achievements.filter((a) => a.unlocked);
  const pending = achievements
    .filter((a) => !a.unlocked)
    .sort((a, b) => b.progress / b.target - a.progress / a.target);

  const parts = [`Tienes ${unlocked.length} de ${achievements.length} logros.`];
  if (unlocked.length > 0) parts.push(`Conseguidos: ${unlocked.map((a) => a.name).join(', ')}.`);
  const next = pending[0];
  if (next) {
    parts.push(
      `El más cerca: ${next.name}. ${next.description} Llevas ${Math.min(next.progress, next.target)} de ${next.target}.`,
    );
  }
  return parts.join(' ');
}

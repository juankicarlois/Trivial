import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, HUB_ID } from '../shared/board.js';
import { CATEGORIES, type CategoryId } from '../shared/categories.js';
import type { AchievementView, PlayerView } from '../shared/protocol.js';
import {
  achievementsSummary,
  boardRadarSummary,
  describeDirection,
  distanceText,
  rivalsSummary,
  wedgesSummary,
} from './narration.js';

const board = buildBoard();

function player(nodeId: string, wedges: CategoryId[] = []): PlayerView {
  return { id: 'p1', name: 'Ana', nodeId, wedges, connected: true, isBot: false };
}

/** Jugador con id y nombre concretos, para las pruebas de rivales. */
function named(
  id: string,
  name: string,
  nodeId: string,
  wedges: CategoryId[] = [],
  connected = true,
): PlayerView {
  return { id, name, nodeId, wedges, connected, isBot: false };
}

// --- Distancias -------------------------------------------------------------

test('la distancia se dice con unidades y sin "0 casillas"', () => {
  assert.equal(distanceText(0), 'estás en ella');
  assert.equal(distanceText(1), 'a 1 casilla');
  assert.equal(distanceText(4), 'a 4 casillas');
});

// --- Direcciones ------------------------------------------------------------

test('una dirección dice en qué casilla vas a caer', () => {
  // Desde el centro, 4 pasos por el radio de Geografía caen en su sede.
  const text = describeDirection(board, HUB_ID, 'spoke-geografia-3', 4, []);
  assert.match(text, /Radio de Geografía/, 'debe nombrar la casilla inmediata');
  assert.match(text, /Caes en: Sede de Geografía/, 'debe decir dónde se cae');
});

test('avisa de que un queso que te falta está en el destino', () => {
  const text = describeDirection(board, HUB_ID, 'spoke-geografia-3', 4, []);
  assert.match(text, /Queso que te falta/);
});

test('no promete un queso que ya tienes', () => {
  const text = describeDirection(board, HUB_ID, 'spoke-geografia-3', 4, ['geografia']);
  assert.match(text, /Queso que ya tienes/);
  assert.doesNotMatch(text, /te falta/);
});

test('si el camino se bifurca antes, lo dice en vez de prometer destino', () => {
  // 5 pasos: se llega a la sede (a 4) y sobra 1, donde hay que volver a elegir.
  const text = describeDirection(board, HUB_ID, 'spoke-geografia-3', 5, []);
  assert.match(text, /Llegas a Sede de Geografía/);
  assert.match(text, /eliges de nuevo con 1 paso\./, 'un paso, en singular');
  assert.doesNotMatch(text, /Caes en/, 'no puede prometer dónde caes');
});

test('el plural de los pasos restantes es correcto', () => {
  const text = describeDirection(board, HUB_ID, 'spoke-geografia-3', 6, []);
  assert.match(text, /con 2 pasos\./);
});

test('con un solo paso, se cae en la casilla elegida', () => {
  const text = describeDirection(board, HUB_ID, 'spoke-geografia-3', 1, []);
  assert.match(text, /Caes aquí/);
});

test('al caer dentro de un radio, origen y destino se distinguen', () => {
  // El caso que sonaba raro: antes las casillas del radio se llamaban igual y
  // salía "Radio de Geografía. Caes en: Radio de Geografía". Ahora el
  // calificador de posición las diferencia.
  const text = describeDirection(board, HUB_ID, 'spoke-geografia-3', 2, []);
  assert.match(text, /Radio de Geografía, junto al centro\. Caes en: Radio de Geografía, a medio camino/);
});

test('el centro avisa de pregunta final solo si tienes los seis quesos', () => {
  const todos = CATEGORIES.map((c) => c.id);
  const conTodos = describeDirection(board, 'spoke-geografia-3', HUB_ID, 1, todos);
  assert.match(conTodos, /Pregunta final para ganar/);

  const sinTodos = describeDirection(board, 'spoke-geografia-3', HUB_ID, 1, ['geografia']);
  assert.match(sinTodos, /Casilla libre/);
  assert.doesNotMatch(sinTodos, /Pregunta final/);
});

// --- Brújula ----------------------------------------------------------------

test('la brújula dice dónde estás y las sedes que faltan, de más cerca a más lejos', () => {
  const text = boardRadarSummary(board, player(HUB_ID));
  assert.match(text, /Estás en Centro de la rueda/);
  // Desde el centro todas las sedes están a 4.
  assert.match(text, /a 4 casillas/);
  for (const cat of CATEGORIES) {
    assert.ok(text.includes(cat.name), `debería mencionar ${cat.name}`);
  }
});

test('la brújula omite las sedes cuyo queso ya tienes', () => {
  const text = boardRadarSummary(board, player(HUB_ID, ['geografia', 'historia']));
  assert.doesNotMatch(text, /Geografía/);
  assert.doesNotMatch(text, /Historia/);
  assert.match(text, /Ciencia y Naturaleza/);
});

test('la brújula ordena las sedes por cercanía', () => {
  // Desde la sede de Geografía, la de Historia (7 por el anillo) está más cerca
  // que las del otro lado, que salen a 8 pasando por el centro.
  const text = boardRadarSummary(board, player('hq-geografia', ['geografia']));
  const posHistoria = text.indexOf('Historia');
  const posCiencia = text.indexOf('Ciencia');
  assert.ok(posHistoria > 0 && posCiencia > 0);
  assert.ok(posHistoria < posCiencia, 'la sede más cercana debe anunciarse antes');
});

test('estando sobre una sede que te falta, no dice "a 0 casillas"', () => {
  const text = boardRadarSummary(board, player('hq-ciencia'));
  assert.match(text, /Ciencia y Naturaleza, estás en ella/);
  assert.doesNotMatch(text, /a 0 casillas/);
});

test('con los seis quesos, la brújula manda al centro', () => {
  const todos = CATEGORIES.map((c) => c.id);
  const text = boardRadarSummary(board, player('hq-geografia', todos));
  assert.match(text, /el centro está a 4 casillas/);
  assert.match(text, /Ve a ganar/);
});

// --- Rivales ----------------------------------------------------------------

test('los rivales se anuncian con su posición y sus quesos, y me excluyen a mí', () => {
  const players = [
    named('yo', 'Ana', HUB_ID),
    named('p2', 'Bea', 'hq-historia', ['historia', 'geografia']),
    named('p3', 'Solrac', 'ring-3'),
  ];
  const text = rivalsSummary(board, players, 'yo');
  assert.doesNotMatch(text, /Ana/, 'no debe incluirme a mí');
  assert.match(text, /Bea, en Sede de Historia, 2 quesos/);
  assert.match(text, /Solrac, en Casilla de .*, sin quesos/);
});

test('un rival con un solo queso usa el singular', () => {
  const players = [named('yo', 'Ana', HUB_ID), named('p2', 'Bea', HUB_ID, ['arte'])];
  assert.match(rivalsSummary(board, players, 'yo'), /Bea,.*, 1 queso\b/);
});

test('avisa del rival al que le falta un queso para ir a ganar', () => {
  const cinco = CATEGORIES.slice(0, 5).map((c) => c.id);
  const players = [named('yo', 'Ana', HUB_ID), named('p2', 'Bea', 'hq-cultura', cinco)];
  assert.match(rivalsSummary(board, players, 'yo'), /le falta un queso para ir a ganar/);
});

test('un rival desconectado se marca como tal', () => {
  const players = [named('yo', 'Ana', HUB_ID), named('p2', 'Bea', HUB_ID, [], false)];
  assert.match(rivalsSummary(board, players, 'yo'), /Bea,.*desconectado/);
});

test('sin rivales, lo dice en vez de dar una lista vacía', () => {
  assert.match(rivalsSummary(board, [named('yo', 'Ana', HUB_ID)], 'yo'), /No hay más jugadores/);
});

// --- Quesos y logros --------------------------------------------------------

test('el resumen de quesos distingue ninguno, algunos y todos', () => {
  assert.match(wedgesSummary(player(HUB_ID)), /No tienes ningún queso/);
  assert.match(wedgesSummary(player(HUB_ID, ['arte'])), /Tienes 1 de 6 quesos: Arte y Literatura/);
  assert.match(
    wedgesSummary(player(HUB_ID, CATEGORIES.map((c) => c.id))),
    /Tienes los seis quesos/,
  );
  assert.match(wedgesSummary(undefined), /Todavía no estás en una partida/);
});

test('el resumen de logros señala el que tienes más a mano', () => {
  const achievements: AchievementView[] = [
    { id: 'a', name: 'Primer queso', description: 'Gana un queso.', unlocked: true, progress: 1, target: 1 },
    { id: 'b', name: 'Lejano', description: 'Acierta 50.', unlocked: false, progress: 5, target: 50 },
    { id: 'c', name: 'Cercano', description: 'Juega 5 partidas.', unlocked: false, progress: 4, target: 5 },
  ];
  const text = achievementsSummary(achievements);
  assert.match(text, /Tienes 1 de 3 logros/);
  assert.match(text, /Conseguidos: Primer queso/);
  assert.match(text, /El más cerca: Cercano/, 'debe elegir el de mayor progreso relativo');
  assert.match(text, /Llevas 4 de 5/);
});

test('sin logros cargados, el resumen no revienta', () => {
  assert.match(achievementsSummary([]), /Todavía no se han cargado/);
});

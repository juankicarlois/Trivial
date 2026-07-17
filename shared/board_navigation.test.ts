import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, distancesFrom, forwardMoves, previewMove, HUB_ID } from './board.js';
import { CATEGORIES } from './categories.js';

const board = buildBoard();

test('desde el centro, cada sede está a 4 casillas (3 de radio + la sede)', () => {
  const distances = distancesFrom(board, HUB_ID);
  for (const cat of CATEGORIES) {
    assert.equal(distances.get(`hq-${cat.id}`), 4, `la sede de ${cat.name} debería estar a 4`);
  }
});

test('distancesFrom alcanza todas las casillas del tablero', () => {
  const distances = distancesFrom(board, HUB_ID);
  assert.equal(distances.size, Object.keys(board.nodes).length);
});

test('la distancia a uno mismo es cero', () => {
  assert.equal(distancesFrom(board, 'ring-1').get('ring-1'), 0);
});

test('con los pasos justos se cae exactamente en la sede', () => {
  // Desde el centro, 4 pasos por el radio de Geografía llegan a su sede.
  const preview = previewMove(board, HUB_ID, 'spoke-geografia-3', 4);
  assert.equal(preview.landingNodeId, 'hq-geografia');
  assert.equal(preview.junctionNodeId, null, 'el radio no se bifurca: destino seguro');
});

test('con menos pasos se cae antes de llegar a la sede', () => {
  const preview = previewMove(board, HUB_ID, 'spoke-geografia-3', 2);
  assert.equal(preview.landingNodeId, 'spoke-geografia-2');
  assert.equal(preview.junctionNodeId, null);
});

test('si sobran pasos al llegar a un cruce, el destino deja de estar determinado', () => {
  // 5 pasos: se llega a la sede (4) y sobra 1, donde hay que volver a elegir.
  const preview = previewMove(board, HUB_ID, 'spoke-geografia-3', 5);
  assert.equal(preview.landingNodeId, null, 'no se puede prometer un destino');
  assert.equal(preview.junctionNodeId, 'hq-geografia');
  assert.equal(preview.stepsAtJunction, 1);
});

test('un solo paso cae en la casilla elegida', () => {
  const preview = previewMove(board, HUB_ID, 'spoke-geografia-3', 1);
  assert.equal(preview.landingNodeId, 'spoke-geografia-3');
});

test('el recorrido no da marcha atrás: dos direcciones llevan a sitios distintos', () => {
  const [left, right] = forwardMoves(board, 'ring-1', null);
  const a = previewMove(board, 'ring-1', left, 2).landingNodeId;
  const b = previewMove(board, 'ring-1', right, 2).landingNodeId;
  assert.notEqual(a, b, 'ir por un lado o por el otro no puede acabar en la misma casilla');
});

test('la previsión coincide con recorrer el camino paso a paso', () => {
  // Comprobación cruzada: simular el avance real debe dar el mismo destino.
  const steps = 3;
  const from = 'ring-3';
  const to = forwardMoves(board, from, null)[0];

  let previous = from;
  let current = to;
  for (let used = 1; used < steps; used++) {
    const options = forwardMoves(board, current, previous);
    assert.equal(options.length, 1, 'este tramo no debería bifurcarse');
    previous = current;
    current = options[0];
  }
  assert.equal(previewMove(board, from, to, steps).landingNodeId, current);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, HUB_ID } from '../shared/board.js';
import { CATEGORIES } from '../shared/categories.js';
import { chooseBotFinalCategory, botAnswerIndex, chooseBotMove } from './bot.js';

const board = buildBoard();

// --- Respuestas -------------------------------------------------------------

const q = { options: ['a', 'b', 'c', 'd'], answerIndex: 2 };

test('con suerte alta el bot acierta; con suerte baja falla', () => {
  // random() < accuracy → acierta. Con dificultad difícil (0.9):
  assert.equal(botAnswerIndex(q, 'dificil', () => 0.1), 2, 'debería acertar');
  const fallo = botAnswerIndex(q, 'dificil', () => 0.95);
  assert.notEqual(fallo, 2, 'debería fallar');
  assert.ok(fallo >= 0 && fallo < 4, 'la opción errónea está en rango');
});

test('el bot fácil falla más que el difícil', () => {
  // Con random fijo 0.5: fácil (0.4) falla (0.5>=0.4), difícil (0.9) acierta.
  assert.notEqual(botAnswerIndex(q, 'facil', () => 0.5), 2, 'fácil falla con 0.5');
  assert.equal(botAnswerIndex(q, 'dificil', () => 0.5), 2, 'difícil acierta con 0.5');
});

test('al fallar nunca elige la respuesta correcta', () => {
  for (let r = 0.5; r < 1; r += 0.05) {
    const idx = botAnswerIndex(q, 'facil', () => 0.99);
    assert.notEqual(idx, q.answerIndex);
  }
});

// --- Movimiento -------------------------------------------------------------

test('el bot coge un queso que le falta si le cae al final del movimiento', () => {
  // Desde el centro, 4 pasos por el radio de Geografía caen en su sede.
  const move = chooseBotMove(board, HUB_ID, ['spoke-geografia-3', 'spoke-historia-3'], 4, []);
  assert.equal(move, 'spoke-geografia-3', 'debería ir a por la sede de Geografía');
});

test('con todos los quesos, el bot tira hacia el centro', () => {
  const todos = CATEGORIES.map((c) => c.id);
  // Desde la sede de Geografía: una opción entra al radio (hacia el centro), otra
  // sigue por el anillo (se aleja del centro).
  const move = chooseBotMove(board, 'hq-geografia', ['spoke-geografia-1', 'ring-1'], 3, todos);
  assert.equal(move, 'spoke-geografia-1', 'debería encaminarse al centro');
});

test('el bot se acerca a la sede que le falta más cercana', () => {
  // Le falta solo Historia; desde el centro, su radio la acerca.
  const wedges = CATEGORIES.filter((c) => c.id !== 'historia').map((c) => c.id);
  const move = chooseBotMove(board, HUB_ID, ['spoke-historia-3', 'spoke-geografia-3'], 2, wedges);
  assert.equal(move, 'spoke-historia-3');
});

test('chooseBotMove nunca devuelve una opción fuera de las dadas', () => {
  const options = ['ring-1', 'ring-3'];
  const move = chooseBotMove(board, 'ring-2', options, 1, []);
  assert.ok(options.includes(move));
});

// --- Categoría final --------------------------------------------------------

test('la categoría final del bot es una categoría válida', () => {
  const ids = new Set(CATEGORIES.map((c) => c.id));
  for (const r of [0, 0.3, 0.99]) assert.ok(ids.has(chooseBotFinalCategory(() => r)));
});

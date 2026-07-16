import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../shared/board.js';
import { legalMoves, rollDie } from './engine.js';

test('legalMoves excluye la casilla de la que se viene', () => {
  const board = buildBoard();
  const start = board.nodes['ring-1'];
  const [a, b] = start.neighbors;
  const moves = legalMoves(board, 'ring-1', a);
  assert.ok(!moves.includes(a), 'no debe permitir volver atrás');
  assert.ok(moves.includes(b), 'debe permitir seguir hacia adelante');
});

test('legalMoves sin origen previo devuelve todos los vecinos', () => {
  const board = buildBoard();
  const moves = legalMoves(board, 'hub', null);
  assert.deepEqual([...moves].sort(), [...board.nodes['hub'].neighbors].sort());
});

test('rollDie está siempre entre 1 y 6', () => {
  for (const r of [0, 0.16, 0.5, 0.83, 0.999]) {
    const value = rollDie(() => r);
    assert.ok(value >= 1 && value <= 6, `valor fuera de rango: ${value}`);
  }
});

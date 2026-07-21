import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_SIZE, MessageHistory, historyIndexFromKey } from './history.js';

test('el mensaje 1 es el último anunciado', () => {
  const history = new MessageHistory();
  history.record('Tu turno.');
  history.record('Has sacado un 4.');
  assert.equal(history.recall(1), 'Mensaje 1. Has sacado un 4.');
  assert.equal(history.recall(2), 'Mensaje 2. Tu turno.');
});

test('solo se guardan los diez últimos', () => {
  const history = new MessageHistory();
  for (let i = 1; i <= 12; i++) history.record(`aviso ${i}`);
  assert.equal(history.size, HISTORY_SIZE);
  assert.equal(history.recall(1), 'Mensaje 1. aviso 12');
  assert.equal(history.recall(10), 'Mensaje 10. aviso 3');
});

test('se avisa cuando aún no hay tantos mensajes', () => {
  const history = new MessageHistory();
  assert.equal(history.recall(3), 'Todavía no hay mensajes.');
  history.record('Tu turno.');
  assert.equal(history.recall(3), 'No hay mensaje 3. Solo hay 1 mensaje.');
  history.record('Has sacado un 4.');
  assert.equal(history.recall(3), 'No hay mensaje 3. Solo hay 2 mensajes.');
});

test('los avisos en blanco no ocupan sitio', () => {
  const history = new MessageHistory();
  history.record('   ');
  history.record('');
  assert.equal(history.size, 0);
});

test('el 0 es el décimo mensaje y las demás teclas no cuentan', () => {
  assert.equal(historyIndexFromKey('1'), 1);
  assert.equal(historyIndexFromKey('9'), 9);
  assert.equal(historyIndexFromKey('0'), 10);
  assert.equal(historyIndexFromKey('a'), null);
  assert.equal(historyIndexFromKey('F1'), null);
});

test('si Alt cambia el carácter, vale la tecla física', () => {
  assert.equal(historyIndexFromKey('¡', 'Digit1'), 1);
  assert.equal(historyIndexFromKey('º', 'Digit0'), 10);
  assert.equal(historyIndexFromKey('Dead', 'Numpad4'), 4);
  assert.equal(historyIndexFromKey('a', 'KeyA'), null);
});

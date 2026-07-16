import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, type Transport } from './room.js';
import { createDefaultRepository } from './questions_repo.js';

/** Transporte de prueba que descarta los mensajes (no nos interesan aquí). */
const silent: Transport = { broadcast: () => {} };

function newRoom(): Room {
  return new Room('TEST', createDefaultRepository(), silent);
}

test('la partida empieza con el turno del primer jugador', () => {
  const room = newRoom();
  const ana = room.addOrReattach('Ana');
  room.addOrReattach('Bea');
  room.start();
  const view = room.toView();
  assert.equal(view.phase, 'awaitRoll');
  assert.equal(view.players[view.currentPlayerIndex].id, ana);
});

test('si se desconecta el jugador con el turno, pasa al siguiente conectado', () => {
  const room = newRoom();
  const ana = room.addOrReattach('Ana');
  const bea = room.addOrReattach('Bea');
  room.start();

  // Se cae Ana, que tenía el turno: no debe quedar la mesa clavada.
  room.markDisconnected(ana!);
  const view = room.toView();
  assert.equal(view.phase, 'awaitRoll');
  assert.equal(view.players[view.currentPlayerIndex].id, bea, 'el turno debe pasar a Bea');
});

test('un jugador que se va en el vestíbulo desaparece de la lista', () => {
  const room = newRoom();
  const ana = room.addOrReattach('Ana');
  room.addOrReattach('Bea');
  room.markDisconnected(ana!);
  const view = room.toView();
  assert.equal(view.players.length, 1);
  assert.equal(view.players[0].name, 'Bea');
});

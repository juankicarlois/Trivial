import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Room, type Transport } from './room.js';
import { createDefaultRepository } from './questions_repo.js';
import { loadContent } from './content.js';
import { ProfileStore } from './profiles.js';

/** Transporte de prueba que descarta los mensajes (no nos interesan aquí). */
const silent: Transport = { broadcast: () => {}, sendTo: () => {} };

const content = loadContent();

/** Cada test usa su propio fichero de perfiles para no pisarse con los demás. */
function newStore(): ProfileStore {
  return new ProfileStore(join(tmpdir(), `trivial-test-${crypto.randomUUID()}.json`));
}

function newRoom(store: ProfileStore = newStore()): Room {
  return new Room('TEST', createDefaultRepository(content.packs), content, store, silent);
}

test('la partida empieza con el turno del primer jugador', () => {
  const room = newRoom();
  const ana = room.addOrReattach('Ana', 'perfil-ana');
  room.addOrReattach('Bea', 'perfil-bea');
  room.start();
  const view = room.toView();
  assert.equal(view.phase, 'awaitRoll');
  assert.equal(view.players[view.currentPlayerIndex].id, ana);
});

test('si se desconecta el jugador con el turno, pasa al siguiente conectado', () => {
  const room = newRoom();
  const ana = room.addOrReattach('Ana', 'perfil-ana');
  const bea = room.addOrReattach('Bea', 'perfil-bea');
  room.start();

  // Se cae Ana, que tenía el turno: no debe quedar la mesa clavada.
  room.markDisconnected(ana!);
  const view = room.toView();
  assert.equal(view.phase, 'awaitRoll');
  assert.equal(view.players[view.currentPlayerIndex].id, bea, 'el turno debe pasar a Bea');
});

test('un jugador que se va en el vestíbulo desaparece de la lista', () => {
  const room = newRoom();
  const ana = room.addOrReattach('Ana', 'perfil-ana');
  room.addOrReattach('Bea', 'perfil-bea');
  room.markDisconnected(ana!);
  const view = room.toView();
  assert.equal(view.players.length, 1);
  assert.equal(view.players[0].name, 'Bea');
});

test('reconectar con el mismo perfil recupera al jugador, no duplica', () => {
  const room = newRoom();
  const first = room.addOrReattach('Ana', 'perfil-ana');
  room.markDisconnected(first!);
  const again = room.addOrReattach('Ana', 'perfil-ana');
  assert.equal(room.toView().players.length, 1);
  assert.ok(again, 'debe devolver un id de jugador al reconectar');
});

test('los packs empiezan bloqueados y no se pueden activar sin el logro', () => {
  const room = newRoom();
  room.addOrReattach('Ana', 'perfil-ana');

  const packs = room.toView().packs;
  assert.ok(packs.length > 0, 'debería haber packs cargados');
  assert.ok(packs.every((p) => !p.unlocked), 'ningún pack debe estar desbloqueado de inicio');

  room.setPack(packs[0].id, true);
  assert.ok(
    !room.toView().packs[0].enabled,
    'un pack bloqueado no debe poder activarse',
  );
});

test('un pack se desbloquea cuando alguien de la sala tiene su logro', () => {
  const store = newStore();
  // Le damos a Ana el logro que desbloquea el pack, como si ya lo hubiera ganado.
  const pack = content.packs[0];
  store.getOrCreate('perfil-ana', 'Ana').achievements.push(pack.unlockedBy);

  const room = newRoom(store);
  room.addOrReattach('Ana', 'perfil-ana');

  const view = room.toView();
  const target = view.packs.find((p) => p.id === pack.id);
  assert.ok(target?.unlocked, `el pack "${pack.id}" debería estar desbloqueado`);

  room.setPack(pack.id, true);
  assert.ok(
    room.toView().packs.find((p) => p.id === pack.id)?.enabled,
    'el pack desbloqueado debe poder activarse',
  );
});

test('no se puede elegir la categoría final si no toca', () => {
  const msgs: { type: string; message?: string }[] = [];
  const room = new Room('TEST', createDefaultRepository(content.packs), content, newStore(), {
    broadcast: (m) => msgs.push(m as { type: string; message?: string }),
    sendTo: () => {},
  });
  room.addOrReattach('Ana', 'perfil-ana');
  const bea = room.addOrReattach('Bea', 'perfil-bea');
  room.start();

  // Nadie está a punto de ganar: elegir categoría final debe rechazarse.
  room.chooseFinalCategory(bea!, 'ciencia');
  assert.ok(
    msgs.some((m) => m.type === 'error' && /pregunta final/.test(m.message ?? '')),
    'debería rechazar la elección fuera de la fase de pregunta final',
  );
});

test('los packs no se pueden cambiar con la partida en curso', () => {
  const store = newStore();
  const pack = content.packs[0];
  store.getOrCreate('perfil-ana', 'Ana').achievements.push(pack.unlockedBy);

  const room = newRoom(store);
  room.addOrReattach('Ana', 'perfil-ana');
  room.start();

  room.setPack(pack.id, true);
  assert.ok(
    !room.toView().packs.find((p) => p.id === pack.id)?.enabled,
    'cambiar el repertorio a mitad de partida no debe permitirse',
  );
});

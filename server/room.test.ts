import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORIES } from '../shared/categories.js';
import { Room, type Scheduler, type Transport } from './room.js';
import { createDefaultRepository, QuestionRepository } from './questions_repo.js';
import { loadContent } from './content.js';
import { ProfileStore } from './profiles.js';

/** Transporte de prueba que descarta los mensajes (no nos interesan aquí). */
const silent: Transport = { broadcast: () => {}, sendTo: () => {} };

const content = loadContent();

/** Cada test usa su propio fichero de perfiles para no pisarse con los demás. */
function newStore(): ProfileStore {
  return new ProfileStore(join(tmpdir(), `trivial-test-${crypto.randomUUID()}.json`));
}

function newRoom(store: ProfileStore = newStore(), scheduler?: Scheduler): Room {
  return new Room('TEST', createDefaultRepository(content.packs), content, store, silent, {
    scheduler,
  });
}

/**
 * Scheduler manual para los tests: en vez de temporizadores reales, guarda la
 * acción pendiente del bot para dispararla a mano con `step()`.
 */
function manualScheduler() {
  let pending: (() => void) | null = null;
  const scheduler: Scheduler = (action) => {
    pending = action;
    return () => {
      pending = null;
    };
  };
  return {
    scheduler,
    hasPending: () => pending !== null,
    step: () => {
      const action = pending;
      pending = null;
      action?.();
    },
  };
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

// --- Tope de aciertos por turno --------------------------------------------

/**
 * Repositorio con una pregunta por categoría cuya respuesta correcta es siempre
 * el texto "CORRECTA". Como el juego baraja las opciones, el test la localiza
 * por su texto y puede acertar a propósito, de forma determinista.
 */
function stubRepository(): QuestionRepository {
  const questions = CATEGORIES.map((cat) => ({
    id: `stub-${cat.id}`,
    category: cat.id,
    text: `Pregunta de prueba de ${cat.name}`,
    options: ['CORRECTA', 'MAL 1', 'MAL 2', 'MAL 3'],
    answerIndex: 0,
  }));
  const path = join(tmpdir(), `trivial-stub-${crypto.randomUUID()}.json`);
  writeFileSync(path, JSON.stringify({ questions }), 'utf-8');
  const repo = new QuestionRepository();
  repo.loadBaseFile(path);
  return repo;
}

/** Avanza (tirando y moviendo) hasta que haya pregunta, y la acierta. */
function aciertaUnaPregunta(room: Room, playerId: string): void {
  for (let intentos = 0; intentos < 60; intentos++) {
    const view = room.toView();
    if (view.phase === 'awaitAnswer') break;
    if (view.phase === 'awaitRoll') room.roll(playerId);
    else if (view.phase === 'moving' && view.movement) {
      room.move(playerId, view.movement.options[0]);
    } else break;
  }
  const view = room.toView();
  assert.equal(view.phase, 'awaitAnswer', 'debería haberse planteado una pregunta');
  const correcta = view.question!.options.indexOf('CORRECTA');
  assert.ok(correcta >= 0, 'la pregunta de prueba debe tener la opción CORRECTA');
  room.answer(playerId, correcta);
}

test('al tercer acierto seguido, el turno pasa aunque se acierte', () => {
  const room = new Room('TEST', stubRepository(), content, newStore(), silent);
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  const bea = room.addOrReattach('Bea', 'perfil-bea')!;
  room.start();
  assert.equal(room.toView().players[room.toView().currentPlayerIndex].id, ana);

  aciertaUnaPregunta(room, ana);
  assert.equal(
    room.toView().players[room.toView().currentPlayerIndex].id,
    ana,
    'tras 1 acierto sigue siendo su turno',
  );

  aciertaUnaPregunta(room, ana);
  assert.equal(
    room.toView().players[room.toView().currentPlayerIndex].id,
    ana,
    'tras 2 aciertos sigue siendo su turno',
  );

  aciertaUnaPregunta(room, ana);
  assert.equal(
    room.toView().players[room.toView().currentPlayerIndex].id,
    bea,
    'al tercer acierto debe ceder la vez',
  );
});

test('el tope se reinicia en el turno siguiente', () => {
  const room = new Room('TEST', stubRepository(), content, newStore(), silent);
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  const bea = room.addOrReattach('Bea', 'perfil-bea')!;
  room.start();

  for (let i = 0; i < 3; i++) aciertaUnaPregunta(room, ana); // Ana agota su tope
  assert.equal(room.toView().players[room.toView().currentPlayerIndex].id, bea);

  // Bea empieza de cero: dos aciertos y sigue siendo suyo el turno.
  aciertaUnaPregunta(room, bea);
  aciertaUnaPregunta(room, bea);
  assert.equal(
    room.toView().players[room.toView().currentPlayerIndex].id,
    bea,
    'el contador no se arrastra de un turno a otro',
  );
});

test('los bots se añaden y se quitan en el vestíbulo', () => {
  const room = newRoom();
  room.addOrReattach('Ana', 'perfil-ana');
  room.addBot('facil');
  room.addBot('dificil');

  let view = room.toView();
  const bots = view.players.filter((p) => p.isBot);
  assert.equal(bots.length, 2);
  assert.equal(bots[0].difficulty, 'facil');
  assert.equal(view.players.find((p) => !p.isBot)?.name, 'Ana');

  room.removeBot(bots[0].id);
  view = room.toView();
  assert.equal(view.players.filter((p) => p.isBot).length, 1);
});

test('los bots no cuentan como presencia humana', () => {
  const room = newRoom();
  room.addBot('normal');
  assert.equal(room.hasConnectedHumans(), false, 'una sala solo con bots no tiene humanos');
  room.addOrReattach('Ana', 'perfil-ana');
  assert.equal(room.hasConnectedHumans(), true);
});

test('cuando le toca a un bot, el servidor lo hace jugar solo', () => {
  const manual = manualScheduler();
  const room = newRoom(newStore(), manual.scheduler);
  // Bot primero (jugador 0) para que le toque nada más empezar.
  room.addBot('dificil');
  room.addOrReattach('Ana', 'perfil-ana');
  room.start();

  // Al empezar, el turno es del bot: debe haber una acción de bot programada.
  assert.ok(manual.hasPending(), 'debería haber una acción de bot pendiente al empezar');
  assert.equal(room.toView().phase, 'awaitRoll');

  manual.step(); // el bot tira
  const afterRoll = room.toView().phase;
  assert.ok(
    afterRoll === 'moving' || afterRoll === 'awaitAnswer',
    `tras tirar, el bot debe estar moviéndose o respondiendo (fue ${afterRoll})`,
  );
});

test('un bot termina su turno sin intervención (juega hasta que pasa o gana)', () => {
  const manual = manualScheduler();
  const room = newRoom(newStore(), manual.scheduler);
  room.addBot('facil'); // falla a menudo → su turno acaba pronto al fallar
  room.addOrReattach('Ana', 'perfil-ana');
  room.start();

  // Se dispara la cadena de acciones del bot hasta que deja de haber pendientes
  // (cuando pasa el turno a Ana, que es humana, ya no hay acción programada).
  let pasos = 0;
  while (manual.hasPending() && pasos < 100) {
    manual.step();
    pasos += 1;
  }
  const view = room.toView();
  // O bien el turno ya es de Ana, o el bot está a mitad de su jugada válida.
  assert.ok(pasos > 0, 'el bot debería haber actuado al menos una vez');
  assert.ok(view.phase !== 'lobby', 'la partida sigue en curso o ha terminado');
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

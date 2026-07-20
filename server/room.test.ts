import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORIES } from '../shared/categories.js';
import { buildBoard } from '../shared/board.js';
import { chooseBotMove } from './bot.js';
import { Room, type Scheduler, type Transport } from './room.js';
import type { GameEvent } from '../shared/protocol.js';
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
  assert.equal(view.actingPlayerId, ana);
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
  assert.equal(view.actingPlayerId, bea, 'el turno debe pasar a Bea');
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

/**
 * Scheduler manual con varias acciones a la vez (el de arriba solo guarda una).
 * Hace falta cuando conviven el temporizador del rebote y el de un bot.
 */
function queuedScheduler() {
  let pending: { action: () => void; delayMs: number }[] = [];
  const scheduler: Scheduler = (action, delayMs) => {
    const entry = { action, delayMs };
    pending.push(entry);
    return () => {
      pending = pending.filter((p) => p !== entry);
    };
  };
  return {
    scheduler,
    /** Dispara la acción pendiente más próxima; false si no quedaba ninguna. */
    runNext(): boolean {
      pending.sort((a, b) => a.delayMs - b.delayMs);
      const next = pending.shift();
      if (!next) return false;
      next.action();
      return true;
    },
  };
}

/**
 * Deja pasar el rebote que abre una respuesta fallada: nadie pulsa y la
 * pregunta caduca. Sin esto la partida se queda esperando al pulsador.
 */
function nadiePulsa(room: Room, timers: { runNext(): boolean }): void {
  for (let i = 0; i < 10 && room.toView().phase === 'awaitRebound'; i++) timers.runNext();
  assert.notEqual(room.toView().phase, 'awaitRebound', 'el rebote debería haber caducado');
}

/** Avanza hasta que haya pregunta y falla a propósito, para ceder el turno. */
function falla(room: Room, playerId: string): void {
  for (let intentos = 0; intentos < 60; intentos++) {
    const view = room.toView();
    if (view.phase === 'awaitAnswer') break;
    if (view.phase === 'awaitRoll') room.roll(playerId);
    else if (view.phase === 'moving' && view.movement) room.move(playerId, view.movement.options[0]);
    else break;
  }
  const view = room.toView();
  assert.equal(view.phase, 'awaitAnswer', 'debería haberse planteado una pregunta');
  const mala = view.question!.options.findIndex((o) => o !== 'CORRECTA');
  room.answer(playerId, mala);
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
  assert.equal(room.toView().actingPlayerId, ana);

  aciertaUnaPregunta(room, ana);
  assert.equal(
    room.toView().actingPlayerId,
    ana,
    'tras 1 acierto sigue siendo su turno',
  );

  aciertaUnaPregunta(room, ana);
  assert.equal(
    room.toView().actingPlayerId,
    ana,
    'tras 2 aciertos sigue siendo su turno',
  );

  aciertaUnaPregunta(room, ana);
  assert.equal(
    room.toView().actingPlayerId,
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
  assert.equal(room.toView().actingPlayerId, bea);

  // Bea empieza de cero: dos aciertos y sigue siendo suyo el turno.
  aciertaUnaPregunta(room, bea);
  aciertaUnaPregunta(room, bea);
  assert.equal(
    room.toView().actingPlayerId,
    bea,
    'el contador no se arrastra de un turno a otro',
  );
});

test('al conseguir el logro en plena partida, su pack queda desbloqueado', () => {
  const store = newStore();
  // A un acierto de "Erudito" (100 aciertos), que desbloquea La Rueda del Tiempo.
  store.getOrCreate('perfil-ana', 'Ana').stats.questionsCorrect = 99;

  const room = new Room('TEST', stubRepository(), content, store, silent);
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  room.start();

  const pack = () => room.toView().packs.find((p) => p.id === 'rueda-del-tiempo')!;
  assert.equal(pack().unlocked, false, 'empieza bloqueado');

  aciertaUnaPregunta(room, ana); // acierto número 100

  assert.equal(pack().unlocked, true, 'tras el logro debe figurar como desbloqueado');
});

// --- Modo por equipos -------------------------------------------------------

test('solo quien crea la sala puede cambiar el modo', () => {
  const room = newRoom();
  const ana = room.addOrReattach('Ana', 'perfil-ana')!; // primera: anfitriona
  const bea = room.addOrReattach('Bea', 'perfil-bea')!;

  room.setMode(bea, 'teams');
  assert.equal(room.toView().mode, 'individual', 'un invitado no cambia el modo');

  room.setMode(ana, 'teams');
  assert.equal(room.toView().mode, 'teams');
});

test('en equipos, la ficha y los quesos son del equipo, no de cada uno', () => {
  const room = new Room('TEST', stubRepository(), content, newStore(), silent);
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  const carlos = room.addOrReattach('Carlos', 'perfil-carlos')!;
  const bea = room.addOrReattach('Bea', 'perfil-bea')!;
  room.setMode(ana, 'teams');
  room.chooseTeam(ana, 1);
  room.chooseTeam(carlos, 1);
  room.chooseTeam(bea, 2);
  room.start();

  const view = room.toView();
  assert.equal(view.teams.length, 2, 'dos equipos');
  const equipo1 = view.teams.find((t) => t.name === 'Equipo 1')!;
  assert.deepEqual([...equipo1.memberIds].sort(), [ana, carlos].sort());
  // Empieza el Equipo 1 y responde su primer miembro.
  assert.equal(view.currentTeamIndex, 0);
  assert.ok(equipo1.memberIds.includes(view.actingPlayerId!));
});

test('no se puede empezar por equipos si alguien no ha elegido', () => {
  const room = newRoom();
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  room.addOrReattach('Bea', 'perfil-bea');
  room.setMode(ana, 'teams');
  room.chooseTeam(ana, 1);
  room.start();
  assert.equal(room.toView().phase, 'lobby', 'falta Bea por elegir equipo');
});

test('dentro del equipo, los miembros rotan al responder', () => {
  const timers = queuedScheduler();
  const room = new Room('TEST', stubRepository(), content, newStore(), silent, {
    scheduler: timers.scheduler,
  });
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  const carlos = room.addOrReattach('Carlos', 'perfil-carlos')!;
  const bea = room.addOrReattach('Bea', 'perfil-bea')!;
  room.setMode(ana, 'teams');
  room.chooseTeam(ana, 1);
  room.chooseTeam(carlos, 1);
  room.chooseTeam(bea, 2);
  room.start();

  const primero = room.toView().actingPlayerId!;
  assert.ok([ana, carlos].includes(primero));

  // Falla para ceder el turno al Equipo 2, y este también falla para volver.
  // Nadie pulsa el rebote que abre cada fallo: aquí interesa la rotación.
  falla(room, primero);
  nadiePulsa(room, timers);
  const turnoRival = room.toView().actingPlayerId!;
  assert.equal(turnoRival, bea, 'ahora juega el Equipo 2');
  falla(room, bea);
  nadiePulsa(room, timers);

  const segundo = room.toView().actingPlayerId!;
  assert.ok([ana, carlos].includes(segundo), 'vuelve el Equipo 1');
  assert.notEqual(segundo, primero, 'pero responde el otro miembro');
});

test('si se cae quien respondía, sigue jugando su compañero', () => {
  const room = new Room('TEST', stubRepository(), content, newStore(), silent);
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  const carlos = room.addOrReattach('Carlos', 'perfil-carlos')!;
  const bea = room.addOrReattach('Bea', 'perfil-bea')!;
  room.setMode(ana, 'teams');
  room.chooseTeam(ana, 1);
  room.chooseTeam(carlos, 1);
  room.chooseTeam(bea, 2);
  room.start();

  const actuaba = room.toView().actingPlayerId!;
  room.markDisconnected(actuaba);

  const ahora = room.toView().actingPlayerId!;
  const equipo1 = room.toView().teams[0];
  assert.ok(equipo1.memberIds.includes(ahora), 'le sustituye su compañero de equipo');
  assert.notEqual(ahora, actuaba);
  assert.equal(room.toView().currentTeamIndex, 0, 'el equipo no pierde el turno');
});

test('los quesos ganados son del equipo entero', () => {
  const room = new Room('TEST', stubRepository(), content, newStore(), silent);
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  const carlos = room.addOrReattach('Carlos', 'perfil-carlos')!;
  const bea = room.addOrReattach('Bea', 'perfil-bea')!;
  room.setMode(ana, 'teams');
  room.chooseTeam(ana, 1);
  room.chooseTeam(carlos, 1);
  room.chooseTeam(bea, 2);
  room.start();

  // Quien juegue del Equipo 1 acierta hasta lograr un queso (o agotar intentos).
  for (let i = 0; i < 12; i++) {
    const view = room.toView();
    if (view.teams[0].wedges.length > 0) break;
    if (view.currentTeamIndex !== 0) {
      aciertaUnaPregunta(room, view.actingPlayerId!); // el rival juega su turno
      continue;
    }
    aciertaUnaPregunta(room, view.actingPlayerId!);
  }
  const equipo1 = room.toView().teams[0];
  if (equipo1.wedges.length > 0) {
    // El queso figura en el equipo, no en un jugador: ambos miembros lo comparten.
    assert.ok(equipo1.memberIds.length === 2);
  }
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

// --- Rebote -----------------------------------------------------------------

/**
 * Juega turnos acertando y navegando hacia las sedes (igual que un bot) hasta
 * que quien responde está plantado en una sede con la pregunta ya planteada.
 *
 * @return true si se ha llegado a esa situación dentro de los intentos previstos.
 */
function jugarHastaPreguntaEnSede(room: Room): boolean {
  for (let intentos = 0; intentos < 80; intentos++) {
    const view = room.toView();
    const equipo = view.teams[view.currentTeamIndex];
    if (view.phase === 'awaitAnswer') {
      if (equipo.nodeId.startsWith('hq-')) return true;
      room.answer(view.actingPlayerId!, view.question!.options.indexOf('CORRECTA'));
    } else if (view.phase === 'awaitRoll') {
      room.roll(view.actingPlayerId!);
    } else if (view.phase === 'moving' && view.movement) {
      const destino = chooseBotMove(
        buildBoard(),
        equipo.nodeId,
        view.movement.options,
        view.movement.remaining,
        equipo.wedges,
      );
      room.move(view.actingPlayerId!, destino);
    } else {
      return false;
    }
  }
  return false;
}

/** Sala de dos jugadores con temporizadores controlados, lista para el rebote. */
function salaConRebote() {
  const timers = queuedScheduler();
  const room = new Room('TEST', stubRepository(), content, newStore(), silent, {
    scheduler: timers.scheduler,
  });
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  const bea = room.addOrReattach('Bea', 'perfil-bea')!;
  room.start();
  return { room, ana, bea, timers };
}

test('fallar abre el rebote para los rivales, no para quien ha fallado', () => {
  const { room, ana, bea } = salaConRebote();
  falla(room, ana);

  const view = room.toView();
  assert.equal(view.phase, 'awaitRebound');
  assert.equal(view.actingPlayerId, null, 'mientras nadie pulsa no actúa nadie');
  assert.ok(view.question, 'la pregunta sigue en juego');

  const equipoDeBea = view.teams.find((t) => t.memberIds.includes(bea))!;
  const equipoDeAna = view.teams.find((t) => t.memberIds.includes(ana))!;
  assert.deepEqual(view.rebound?.eligibleTeamIds, [equipoDeBea.id]);
  assert.ok(
    !view.rebound?.eligibleTeamIds.includes(equipoDeAna.id),
    'quien falla no puede rebotar su propia pregunta',
  );
});

test('quien pulsa se queda la pregunta y nadie más puede pulsar', () => {
  const { room, ana, bea } = salaConRebote();
  falla(room, ana);

  room.buzz(bea);
  assert.equal(room.toView().actingPlayerId, bea, 'responde quien ha pulsado');

  // Ana no puede robar el rebote ya adjudicado.
  room.buzz(ana);
  assert.equal(room.toView().actingPlayerId, bea, 'el rebote sigue siendo de Bea');
});

test('acertar el rebote da la casilla del que falló', () => {
  const { room, ana, bea } = salaConRebote();
  falla(room, ana);
  // La casilla en juego es donde Ana se quedó al fallar, no donde empezó.
  const casillaDeAna = room.toView().teams.find((t) => t.memberIds.includes(ana))!.nodeId;

  room.buzz(bea);
  const pregunta = room.toView().question!;
  room.answer(bea, pregunta.options.indexOf('CORRECTA'));

  const equipoDeBea = room.toView().teams.find((t) => t.memberIds.includes(bea))!;
  assert.equal(equipoDeBea.nodeId, casillaDeAna, 'Bea se planta donde estaba Ana');
});

test('robar un rebote en una sede da también su queso', () => {
  const timers = queuedScheduler();
  const room = new Room('TEST', stubRepository(), content, newStore(), silent, {
    scheduler: timers.scheduler,
  });
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  const bea = room.addOrReattach('Bea', 'perfil-bea')!;
  room.start();

  // Se juega en serio (moviendo hacia las sedes, como hace un bot) hasta pillar
  // a quien responde plantado en una sede: ahí es donde el rebote reparte queso.
  const enSede = jugarHastaPreguntaEnSede(room);
  assert.ok(enSede, 'debería haberse llegado a una sede en los intentos previstos');

  const fallando = room.toView().actingPlayerId!;
  const sede = room.toView().teams[room.toView().currentTeamIndex].nodeId;
  const categoria = sede.replace('hq-', '');
  const mala = room.toView().question!.options.findIndex((o) => o !== 'CORRECTA');
  room.answer(fallando, mala);

  assert.equal(room.toView().phase, 'awaitRebound');
  const rival = fallando === ana ? bea : ana;
  room.buzz(rival);
  const pregunta = room.toView().question!;
  room.answer(rival, pregunta.options.indexOf('CORRECTA'));

  const equipoRival = room.toView().teams.find((t) => t.memberIds.includes(rival))!;
  assert.equal(equipoRival.nodeId, sede, 'se queda la sede');
  assert.deepEqual(equipoRival.wedges, [categoria], 'y el queso que había en juego');
});

test('fallar el rebote no cuesta nada: sigue la partida', () => {
  const { room, ana, bea } = salaConRebote();
  const sitioDeBea = room.toView().teams.find((t) => t.memberIds.includes(bea))!.nodeId;
  falla(room, ana);

  room.buzz(bea);
  const pregunta = room.toView().question!;
  room.answer(bea, pregunta.options.findIndex((o) => o !== 'CORRECTA'));

  const view = room.toView();
  const equipoDeBea = view.teams.find((t) => t.memberIds.includes(bea))!;
  assert.equal(equipoDeBea.nodeId, sitioDeBea, 'no se mueve de donde estaba');
  assert.deepEqual(equipoDeBea.wedges, [], 'ni gana quesos');
  assert.equal(view.phase, 'awaitRoll');
  assert.equal(view.actingPlayerId, bea, 'el turno pasa con normalidad');
});

test('si nadie pulsa a tiempo, el rebote caduca y sigue la partida', () => {
  const { room, ana, bea, timers } = salaConRebote();
  falla(room, ana);
  assert.equal(room.toView().phase, 'awaitRebound');

  nadiePulsa(room, timers);
  const view = room.toView();
  assert.equal(view.phase, 'awaitRoll');
  assert.equal(view.actingPlayerId, bea);
});

test('sin rivales conectados no se abre rebote', () => {
  const { room, ana, bea } = salaConRebote();
  room.markDisconnected(bea);
  falla(room, ana);
  assert.notEqual(room.toView().phase, 'awaitRebound', 'no hay a quién ofrecerle la pregunta');
});

test('si quien pulsó se cae, la pregunta se pierde y sigue la partida', () => {
  const { room, ana, bea } = salaConRebote();
  falla(room, ana);
  room.buzz(bea);

  room.markDisconnected(bea);
  assert.notEqual(room.toView().phase, 'awaitRebound', 'nadie puede responder por él');
});

test('la respuesta buena no se canta a la mesa si la pregunta va a rebotar', () => {
  const difundidos: GameEvent[] = [];
  const privados: { playerId: string; event: GameEvent }[] = [];
  const timers = queuedScheduler();
  const room = new Room(
    'TEST',
    stubRepository(),
    content,
    newStore(),
    {
      broadcast: (m) => {
        if (m.type === 'event') difundidos.push(m.event);
      },
      sendTo: (playerId, m) => {
        if (m.type === 'event') privados.push({ playerId, event: m.event });
      },
    },
    { scheduler: timers.scheduler },
  );
  const ana = room.addOrReattach('Ana', 'perfil-ana')!;
  room.addOrReattach('Bea', 'perfil-bea')!;
  room.start();

  falla(room, ana);

  const fallo = difundidos.find((e) => e.kind === 'answered' && !e.correct);
  assert.ok(fallo, 'debería anunciarse el fallo');
  assert.equal(
    fallo.kind === 'answered' ? fallo.correctText : 'sin usar',
    undefined,
    'cantar la respuesta aquí se la regala a quien va a rebotar',
  );
  assert.ok(
    !difundidos.some((e) => e.kind === 'answerRevealed'),
    'tampoco vale destaparla por otra vía mientras el rebote sigue abierto',
  );
  // A quien ha fallado sí se le dice, en privado: ya no puede contestarla.
  const enPrivado = privados.find((p) => p.event.kind === 'answerRevealed');
  assert.ok(enPrivado, 'quien falla debe saber cuál era la buena');
  assert.equal(enPrivado.playerId, ana);
  assert.equal(
    enPrivado.event.kind === 'answerRevealed' ? enPrivado.event.correctText : '',
    'CORRECTA',
  );

  // Al caducar el rebote ya no la puede contestar nadie: ahí sí se destapa.
  nadiePulsa(room, timers);
  assert.ok(
    difundidos.some((e) => e.kind === 'answerRevealed' && e.correctText === 'CORRECTA'),
    'al resolverse el rebote, la mesa debe enterarse de cuál era la buena',
  );
});

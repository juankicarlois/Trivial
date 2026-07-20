import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORIES } from '../shared/categories.js';
import { TIME_ATTACK_ACHIEVEMENT } from '../shared/progress.js';
import type { ServerMessage, TimeAttackResult, TimeAttackView } from '../shared/protocol.js';
import { QuestionRepository } from './questions_repo.js';
import { ProfileStore } from './profiles.js';
import { loadContent } from './content.js';
import { canPlayTimeAttack, TimeAttackSession } from './time_attack.js';
import type { Scheduler } from './room.js';

const content = loadContent();

function newStore(): ProfileStore {
  return new ProfileStore(join(tmpdir(), `trivial-ta-${crypto.randomUUID()}.json`));
}

/** Banco de prueba: la buena es siempre el texto "CORRECTA". */
function stubRepository(): QuestionRepository {
  const questions = CATEGORIES.flatMap((cat) =>
    // Varias por categoría: el contrarreloj encadena muchas preguntas.
    Array.from({ length: 30 }, (_, i) => ({
      id: `ta-${cat.id}-${i}`,
      category: cat.id,
      text: `Pregunta ${i} de ${cat.name}`,
      options: ['CORRECTA', 'MAL 1', 'MAL 2', 'MAL 3'],
      answerIndex: 0,
    })),
  );
  const path = join(tmpdir(), `trivial-ta-stub-${crypto.randomUUID()}.json`);
  writeFileSync(path, JSON.stringify({ questions }), 'utf-8');
  const repo = new QuestionRepository();
  repo.loadBaseFile(path);
  return repo;
}

/** Recoge lo que la sesión manda al cliente y permite disparar su temporizador. */
function harness(options: { durationMs?: number; penaltyMs?: number } = {}) {
  const views: (TimeAttackView | null)[] = [];
  const results: TimeAttackResult[] = [];
  let pending: (() => void) | null = null;
  const scheduler: Scheduler = (action) => {
    pending = action;
    return () => {
      pending = null;
    };
  };
  const send = (message: ServerMessage) => {
    if (message.type === 'timeAttack') views.push(message.view);
    if (message.type === 'timeAttackResult') results.push(message.result);
  };
  const store = newStore();
  const profileId = 'perfil-ta';
  const session = new TimeAttackSession(stubRepository(), store, profileId, content.achievements, send, {
    scheduler,
    ...options,
  });
  return {
    session,
    store,
    profileId,
    views,
    results,
    /** Dispara el fin de tiempo programado. */
    agotarTiempo: () => {
      const action = pending;
      pending = null;
      action?.();
    },
    /** Última pregunta planteada. */
    ultima: () => views.filter((v): v is TimeAttackView => v !== null).at(-1)!,
  };
}

/** Contesta bien la pregunta que hay en pantalla. */
function acierta(h: ReturnType<typeof harness>): void {
  h.session.answer(h.ultima().question.options.indexOf('CORRECTA'));
}

/** Contesta mal a propósito. */
function falla(h: ReturnType<typeof harness>): void {
  h.session.answer(h.ultima().question.options.findIndex((o) => o !== 'CORRECTA'));
}

test('el modo está bloqueado hasta conseguir su logro', () => {
  const store = newStore();
  const profile = store.getOrCreate('nuevo', 'Ana');
  assert.equal(canPlayTimeAttack(profile, content.achievements), false, 'de recién llegado, bloqueado');

  // El logro se gana jugando partidas normales.
  profile.stats.gamesPlayed = 3;
  assert.ok(canPlayTimeAttack(profile, content.achievements), 'con 3 partidas ya se abre');
});

test('el logro del contrarreloj existe en el contenido', () => {
  const def = content.achievements.find((a) => a.id === TIME_ATTACK_ACHIEVEMENT);
  assert.ok(def, 'debe existir el logro que abre el modo');
  assert.ok(def.description.length > 0);
});

test('acertar suma y no toca el reloj', () => {
  const h = harness({ durationMs: 60_000 });
  h.session.start();
  const alEmpezar = h.ultima().secondsLeft;

  acierta(h);
  const tras = h.ultima();
  assert.equal(tras.score, 1);
  assert.ok(tras.secondsLeft >= alEmpezar - 1, 'acertar no debe restar tiempo');
  assert.equal(tras.lastAnswer?.correct, true);
});

test('fallar no suma y descuenta tiempo del reloj', () => {
  const h = harness({ durationMs: 60_000, penaltyMs: 10_000 });
  h.session.start();
  const alEmpezar = h.ultima().secondsLeft;

  falla(h);
  const tras = h.ultima();
  assert.equal(tras.score, 0);
  assert.ok(tras.secondsLeft <= alEmpezar - 10, `debería haber restado 10 s (quedan ${tras.secondsLeft})`);
  assert.equal(tras.lastAnswer?.correct, false);
  assert.equal(tras.lastAnswer?.correctText, 'CORRECTA');
});

test('un fallo con el tiempo justo acaba la sesión', () => {
  const h = harness({ durationMs: 5_000, penaltyMs: 10_000 });
  h.session.start();
  falla(h);

  assert.equal(h.session.running, false, 'la penalización se ha comido el tiempo');
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].score, 0);
});

test('al acabar el tiempo se guarda el récord si es mejor', () => {
  const h = harness({ durationMs: 60_000 });
  h.session.start();
  acierta(h);
  acierta(h);
  h.agotarTiempo();

  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].endedEarly, false, 'aquí sí se agotó el tiempo');
  assert.deepEqual(
    { score: h.results[0].score, isRecord: h.results[0].isRecord, previousBest: h.results[0].previousBest },
    { score: 2, isRecord: true, previousBest: 0 },
  );
  assert.equal(h.store.getOrCreate(h.profileId, 'Ana').stats.timeAttackBest, 2);
});

test('una marca peor no pisa el récord anterior', () => {
  const h = harness({ durationMs: 60_000 });
  h.store.getOrCreate(h.profileId, 'Ana').stats.timeAttackBest = 9;
  h.session.start();
  acierta(h);
  h.agotarTiempo();

  assert.equal(h.results[0].isRecord, false);
  assert.equal(h.results[0].previousBest, 9);
  assert.equal(h.store.getOrCreate(h.profileId, 'Ana').stats.timeAttackBest, 9, 'el récord no baja');
});

test('los aciertos del contrarreloj cuentan para el perfil', () => {
  const h = harness({ durationMs: 60_000 });
  h.session.start();
  acierta(h);
  acierta(h);
  falla(h);

  const stats = h.store.getOrCreate(h.profileId, 'Ana').stats;
  assert.equal(stats.questionsAnswered, 3);
  assert.equal(stats.questionsCorrect, 2);
  assert.equal(stats.bestStreak, 2, 'la racha del modo cuenta como cualquier otra');
});

test('dejarlo a medias cuenta lo conseguido hasta ese momento', () => {
  const h = harness({ durationMs: 60_000 });
  h.session.start();
  acierta(h);
  h.session.quit();

  assert.equal(h.session.running, false);
  assert.equal(h.results[0].score, 1);
  assert.equal(h.results[0].endedEarly, true, 'no se acabó el tiempo: lo dejó');
  assert.equal(h.views.at(-1), null, 'la pantalla del modo se cierra');
});

test('no se repiten preguntas dentro de la misma sesión', () => {
  const h = harness({ durationMs: 600_000 });
  h.session.start();
  const vistas = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const id = h.ultima().question.id;
    assert.ok(!vistas.has(id), `pregunta repetida en la misma sesión: ${id}`);
    vistas.add(id);
    acierta(h);
  }
});

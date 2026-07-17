import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore } from './profiles.js';

/** Directorio temporal propio para cada test. */
function newDir(): string {
  return mkdtempSync(join(tmpdir(), 'trivial-perfiles-'));
}

/** Fuerza el guardado diferido sin esperar al temporizador real. */
function flush(store: ProfileStore): Promise<void> {
  store.scheduleSave();
  return new Promise((resolve) => setTimeout(resolve, 600));
}

test('un perfil nuevo empieza con las estadísticas a cero', () => {
  const store = new ProfileStore(join(newDir(), 'profiles.json'));
  const profile = store.getOrCreate('p1', 'Ana');
  assert.equal(profile.name, 'Ana');
  assert.equal(profile.stats.questionsCorrect, 0);
  assert.deepEqual(profile.achievements, []);
});

test('el progreso sobrevive a reiniciar el servidor', async () => {
  const path = join(newDir(), 'profiles.json');
  const first = new ProfileStore(path);
  const profile = first.getOrCreate('p1', 'Ana');
  profile.stats.questionsCorrect = 7;
  profile.stats.correct.arte = 3;
  profile.achievements.push('primer-queso');
  await flush(first);

  const second = new ProfileStore(path);
  const restored = second.getOrCreate('p1', 'Ana');
  assert.equal(restored.stats.questionsCorrect, 7);
  assert.equal(restored.stats.correct.arte, 3);
  assert.deepEqual(restored.achievements, ['primer-queso']);
});

test('el perfil se identifica por id, no por nombre', async () => {
  const path = join(newDir(), 'profiles.json');
  const store = new ProfileStore(path);
  store.getOrCreate('p1', 'Ana').stats.questionsCorrect = 5;

  // La misma persona cambia de nombre: conserva su progreso.
  const renamed = store.getOrCreate('p1', 'Anita');
  assert.equal(renamed.stats.questionsCorrect, 5);
  assert.equal(renamed.name, 'Anita');

  // Otra persona con el mismo nombre no hereda nada.
  const other = store.getOrCreate('p2', 'Anita');
  assert.equal(other.stats.questionsCorrect, 0);
});

test('un fichero con BOM se lee igual', () => {
  const path = join(newDir(), 'profiles.json');
  const contents = JSON.stringify([
    { id: 'p1', name: 'Ana', stats: { questionsCorrect: 4 }, achievements: ['duende'] },
  ]);
  // Con BOM: es lo que deja un editor de Windows al guardar el fichero a mano.
  writeFileSync(path, '﻿' + contents, 'utf-8');

  const store = new ProfileStore(path);
  const profile = store.getOrCreate('p1', 'Ana');
  assert.equal(profile.stats.questionsCorrect, 4);
  assert.deepEqual(profile.achievements, ['duende']);
});

test('un fichero ilegible se aparta en vez de sobrescribirse', async () => {
  const dir = newDir();
  const path = join(dir, 'profiles.json');
  writeFileSync(path, '{ esto no es json válido', 'utf-8');

  const store = new ProfileStore(path);
  store.getOrCreate('p1', 'Ana').stats.questionsCorrect = 1;
  await flush(store);

  const backups = readdirSync(dir).filter((f) => f.includes('.corrupto-'));
  assert.equal(backups.length, 1, 'debería haberse guardado una copia del fichero ilegible');
  assert.match(
    readFileSync(join(dir, backups[0]), 'utf-8'),
    /esto no es json/,
    'la copia debe conservar el contenido original para poder recuperarlo',
  );
});

test('un perfil antiguo al que le faltan campos no rompe', () => {
  const path = join(newDir(), 'profiles.json');
  // Perfil de una versión anterior: sin bestStreak ni algunas categorías.
  writeFileSync(
    path,
    JSON.stringify([{ id: 'p1', name: 'Ana', stats: { questionsCorrect: 2, correct: { arte: 1 } } }]),
    'utf-8',
  );

  const store = new ProfileStore(path);
  const profile = store.getOrCreate('p1', 'Ana');
  assert.equal(profile.stats.questionsCorrect, 2, 'conserva lo que sí había');
  assert.equal(profile.stats.correct.arte, 1);
  assert.equal(profile.stats.bestStreak, 0, 'rellena lo que falta');
  assert.equal(profile.stats.correct.ciencia, 0);
  assert.deepEqual(profile.achievements, []);
});

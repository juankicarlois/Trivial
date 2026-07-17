import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from './categories.js';
import { earnedAchievements, emptyStats, statValue, type AchievementDef } from './progress.js';

test('las estadísticas vacías tienen todas las categorías a cero', () => {
  const stats = emptyStats();
  for (const cat of CATEGORIES) {
    assert.equal(stats.correct[cat.id], 0, `${cat.name} debería empezar a 0`);
  }
  assert.equal(stats.gamesPlayed, 0);
  assert.equal(stats.bestStreak, 0);
});

test('statValue lee claves planas y por categoría', () => {
  const stats = emptyStats();
  stats.gamesWon = 3;
  stats.correct.arte = 7;
  assert.equal(statValue(stats, 'gamesWon'), 3);
  assert.equal(statValue(stats, 'correct.arte'), 7);
  assert.equal(statValue(stats, 'correct.ciencia'), 0);
});

test('un logro se consigue al alcanzar su umbral, no antes', () => {
  const defs: AchievementDef[] = [
    { id: 'diez-artes', name: 'Diez artes', description: '', stat: 'correct.arte', atLeast: 10 },
  ];
  const stats = emptyStats();

  stats.correct.arte = 9;
  assert.deepEqual(earnedAchievements(stats, defs), [], 'con 9 todavía no');

  stats.correct.arte = 10;
  assert.deepEqual(earnedAchievements(stats, defs), ['diez-artes'], 'con 10 se consigue');

  stats.correct.arte = 25;
  assert.deepEqual(earnedAchievements(stats, defs), ['diez-artes'], 'y se mantiene por encima');
});

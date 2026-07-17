import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from './content.js';

const content = loadContent();

test('se cargan logros y packs', () => {
  assert.ok(content.achievements.length > 0, 'debería haber logros definidos');
  assert.ok(content.packs.length > 0, 'debería haber packs definidos');
});

test('los ids de los logros son únicos', () => {
  const ids = content.achievements.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'hay logros con id repetido');
});

test('los ids de los packs son únicos', () => {
  const ids = content.packs.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'hay packs con id repetido');
});

test('cada logro tiene nombre, descripción y un umbral con sentido', () => {
  for (const a of content.achievements) {
    assert.ok(a.name.trim().length > 0, `${a.id}: sin nombre`);
    assert.ok(a.description.trim().length > 0, `${a.id}: sin descripción`);
    assert.ok(a.atLeast > 0, `${a.id}: el umbral debe ser mayor que 0`);
  }
});

test('cada pack se desbloquea con un logro que existe', () => {
  const known = new Set(content.achievements.map((a) => a.id));
  for (const pack of content.packs) {
    assert.ok(
      known.has(pack.unlockedBy),
      `el pack "${pack.id}" requiere el logro "${pack.unlockedBy}", que no existe: sería imposible de desbloquear`,
    );
  }
});

test('cada pack tiene nombre, descripción y preguntas', () => {
  for (const pack of content.packs) {
    assert.ok(pack.name.trim().length > 0, `${pack.id}: sin nombre`);
    assert.ok(pack.description.trim().length > 0, `${pack.id}: sin descripción`);
    assert.ok(pack.questions.length > 0, `${pack.id}: sin preguntas`);
  }
});

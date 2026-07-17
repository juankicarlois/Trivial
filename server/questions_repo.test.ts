import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES } from '../shared/categories.js';
import type { Question, QuestionBank } from '../shared/questions.js';
import { createDefaultRepository } from './questions_repo.js';
import { CONTENT_DIR, loadContent } from './content.js';

const base = JSON.parse(
  readFileSync(join(CONTENT_DIR, 'questions.base.json'), 'utf-8'),
) as QuestionBank;
const content = loadContent();

/** Mínimo por categoría en el banco base: por debajo se repetirían demasiado. */
const MIN_PER_CATEGORY = 20;

/** Todas las preguntas del juego, con la etiqueta de dónde salen (para errores). */
const allBanks: { label: string; questions: Question[] }[] = [
  { label: 'banco base', questions: base.questions },
  ...content.packs.map((p) => ({ label: `pack "${p.id}"`, questions: p.questions })),
];

test('los ids de las preguntas son únicos en todo el juego', () => {
  const seen = new Map<string, string>();
  for (const bank of allBanks) {
    for (const q of bank.questions) {
      const previous = seen.get(q.id);
      assert.ok(!previous, `id repetido "${q.id}" en ${bank.label} y en ${previous}`);
      seen.set(q.id, bank.label);
    }
  }
});

test('cada pregunta está bien formada', () => {
  const validCategories = new Set(CATEGORIES.map((c) => c.id));
  for (const bank of allBanks) {
    for (const q of bank.questions) {
      const where = `${bank.label}, ${q.id}`;
      assert.ok(q.text.trim().length > 0, `${where}: enunciado vacío`);
      assert.equal(q.options.length, 4, `${where}: debe tener exactamente 4 opciones`);
      assert.equal(new Set(q.options).size, q.options.length, `${where}: opciones repetidas`);
      assert.ok(
        Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < q.options.length,
        `${where}: answerIndex fuera de rango`,
      );
      for (const opt of q.options) {
        assert.ok(opt.trim().length > 0, `${where}: opción vacía`);
      }
      assert.ok(validCategories.has(q.category), `${where}: categoría desconocida "${q.category}"`);
    }
  }
});

test('el banco base tiene preguntas suficientes de cada categoría', () => {
  for (const cat of CATEGORIES) {
    const count = base.questions.filter((q) => q.category === cat.id).length;
    assert.ok(
      count >= MIN_PER_CATEGORY,
      `${cat.name}: solo ${count} preguntas (mínimo ${MIN_PER_CATEGORY})`,
    );
  }
});

test('al barajar las opciones, la respuesta correcta sigue siéndolo', () => {
  const repo = createDefaultRepository(content.packs);
  const byId = new Map(allBanks.flatMap((b) => b.questions).map((q) => [q.id, q]));
  const packIds = content.packs.map((p) => p.id);

  for (const cat of CATEGORIES) {
    for (let i = 0; i < 50; i++) {
      const picked = repo.pick(cat.id, packIds);
      const original = byId.get(picked.id);
      assert.ok(original, `pregunta servida con id desconocido: ${picked.id}`);
      assert.equal(
        picked.options[picked.answerIndex],
        original.options[original.answerIndex],
        `${picked.id}: la barajada perdió la respuesta correcta`,
      );
      assert.equal(
        new Set(picked.options).size,
        original.options.length,
        `${picked.id}: la barajada alteró las opciones`,
      );
    }
  }
});

test('activar un pack añade sus preguntas al repertorio', () => {
  const repo = createDefaultRepository(content.packs);
  const pack = content.packs[0];
  const category = pack.questions[0].category;

  const withoutPack = repo.count(category);
  const withPack = repo.count(category, [pack.id]);
  const added = pack.questions.filter((q) => q.category === category).length;

  assert.equal(withPack, withoutPack + added, 'el pack debe sumar sus preguntas a las base');
});

test('sin packs activos no salen preguntas temáticas', () => {
  const repo = createDefaultRepository(content.packs);
  const packQuestionIds = new Set(content.packs.flatMap((p) => p.questions.map((q) => q.id)));

  for (const cat of CATEGORIES) {
    for (let i = 0; i < 40; i++) {
      const picked = repo.pick(cat.id);
      assert.ok(
        !packQuestionIds.has(picked.id),
        `${picked.id}: pregunta de pack servida sin tener el pack activo`,
      );
    }
  }
});

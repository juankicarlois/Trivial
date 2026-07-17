import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATEGORIES } from '../shared/categories.js';
import type { QuestionBank } from '../shared/questions.js';
import { createDefaultRepository } from './questions_repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const bankPath = join(here, '..', 'content', 'questions.base.json');
const bank = JSON.parse(readFileSync(bankPath, 'utf-8')) as QuestionBank;

/** Mínimo por categoría: por debajo, las preguntas se repetirían demasiado. */
const MIN_PER_CATEGORY = 20;

test('los ids de las preguntas son únicos', () => {
  const ids = bank.questions.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'hay ids repetidos en el banco');
});

test('cada pregunta está bien formada', () => {
  for (const q of bank.questions) {
    assert.ok(q.text.trim().length > 0, `${q.id}: enunciado vacío`);
    assert.equal(q.options.length, 4, `${q.id}: debe tener exactamente 4 opciones`);
    assert.equal(
      new Set(q.options).size,
      q.options.length,
      `${q.id}: tiene opciones repetidas`,
    );
    assert.ok(
      Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < q.options.length,
      `${q.id}: answerIndex fuera de rango`,
    );
    for (const opt of q.options) {
      assert.ok(opt.trim().length > 0, `${q.id}: tiene una opción vacía`);
    }
  }
});

test('la categoría de cada pregunta existe', () => {
  const valid = new Set(CATEGORIES.map((c) => c.id));
  for (const q of bank.questions) {
    assert.ok(valid.has(q.category), `${q.id}: categoría desconocida "${q.category}"`);
  }
});

test('todas las categorías tienen preguntas suficientes', () => {
  for (const cat of CATEGORIES) {
    const count = bank.questions.filter((q) => q.category === cat.id).length;
    assert.ok(
      count >= MIN_PER_CATEGORY,
      `${cat.name}: solo ${count} preguntas (mínimo ${MIN_PER_CATEGORY})`,
    );
  }
});

test('al barajar las opciones, la respuesta correcta sigue siéndolo', () => {
  const repo = createDefaultRepository();
  const byId = new Map(bank.questions.map((q) => [q.id, q]));

  // Se piden muchas para cubrir varias barajadas de preguntas distintas.
  for (const cat of CATEGORIES) {
    for (let i = 0; i < 50; i++) {
      const picked = repo.pick(cat.id);
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

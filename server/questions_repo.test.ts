import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES } from '../shared/categories.js';
import type { Question, QuestionBank } from '../shared/questions.js';
import { baseQuestionFiles, createDefaultRepository, packShare } from './questions_repo.js';
import { loadContent } from './content.js';

// El banco base se reparte en varios ficheros: se validan todos.
const baseFiles = baseQuestionFiles();
const base: QuestionBank = {
  questions: baseFiles.flatMap(
    (file) => (JSON.parse(readFileSync(file, 'utf-8')) as QuestionBank).questions,
  ),
};
const content = loadContent();

/** Mínimo por categoría en el banco base: por debajo se repetirían demasiado. */
const MIN_PER_CATEGORY = 200;

/**
 * Enunciado normalizado: sin tildes, signos ni mayúsculas.
 *
 * Se compara así porque los duplicados reales no llegan con el texto idéntico,
 * sino reformulados ("¿Quién fue el primer presidente de los Estados Unidos?"
 * frente a "¿Quién fue el primer presidente de Estados Unidos?").
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

test('ninguna pregunta se repite en todo el banco', () => {
  // El banco se reparte en varios ficheros, así que la comprobación tiene que
  // ser global: comparar solo dentro de cada fichero deja pasar la misma
  // pregunta escrita dos veces en sitios distintos.
  const seen = new Map<string, string>();
  for (const bank of allBanks) {
    for (const q of bank.questions) {
      const key = normalizeText(q.text);
      const previous = seen.get(key);
      assert.ok(!previous, `pregunta repetida: "${q.text}" (${q.id} y ${previous})`);
      seen.set(key, q.id);
    }
  }
});

/**
 * Parejas que comparten respuesta y casi todas las palabras, pero preguntan
 * cosas distintas de verdad. Se listan aquí para que el test de reformulaciones
 * no las señale.
 */
const REFORMULACIONES_PERMITIDAS = new Set([
  'dep-001|dep-081', // Juegos Olímpicos de verano / de invierno.
  'dep-031|dep-223', // Mundial masculino de 2010 / femenino de 2023, los dos de España.
  'art-082|art-221', // "Aida" / "La traviata": dos óperas distintas de Verdi.
]);

test('ninguna pregunta es una reformulación de otra', () => {
  // El test de arriba solo pilla el texto idéntico. El duplicado que de verdad
  // se cuela es el mismo dato preguntado con otras palabras ("¿Qué arte marcial
  // de origen coreano…?" frente a "¿Qué arte marcial coreana…?"), así que aquí
  // se comparan las preguntas que comparten categoría y respuesta correcta.
  const PALABRAS_VACIAS = new Set(
    'el la los las un una de del que en y a al se es cual cuales cuantos cuantas quien como donde por para con su sus mas o mundo'.split(' '),
  );
  const contentWords = (text: string) =>
    new Set(
      normalizeText(text)
        .split(' ')
        .filter((w) => w.length > 3 && !PALABRAS_VACIAS.has(w)),
    );

  const questions = allBanks.flatMap((b) => b.questions);
  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      const a = questions[i];
      const b = questions[j];
      if (a.category !== b.category) continue;
      if (normalizeText(a.options[a.answerIndex]) !== normalizeText(b.options[b.answerIndex])) continue;
      if (REFORMULACIONES_PERMITIDAS.has(`${a.id}|${b.id}`)) continue;

      const wordsA = contentWords(a.text);
      const wordsB = contentWords(b.text);
      const comunes = [...wordsA].filter((w) => wordsB.has(w)).length;
      const parecido = comunes / (new Set([...wordsA, ...wordsB]).size || 1);

      assert.ok(
        parecido < 0.45,
        `${a.id} y ${b.id} preguntan lo mismo con otras palabras ` +
          `("${a.text}" / "${b.text}"). Si de verdad son distintas, añádelas a ` +
          'REFORMULACIONES_PERMITIDAS.',
      );
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
      const picked = repo.pick(cat.id, { packIds });
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

// --- No repetir preguntas ---------------------------------------------------

/** Ids del banco base de una categoría. */
function idsOf(category: string): string[] {
  return base.questions.filter((q) => q.category === category).map((q) => q.id);
}

test('una pregunta ya salida en la partida no se repite', () => {
  const repo = createDefaultRepository();
  const todas = idsOf('historia');
  const salidas = new Set(todas.slice(0, todas.length - 1));

  for (let i = 0; i < 30; i++) {
    const picked = repo.pick('historia', { askedThisGame: salidas });
    assert.ok(!salidas.has(picked.id), `${picked.id}: ya había salido en esta partida`);
  }
});

test('jugando una partida entera no se repite ninguna pregunta', () => {
  const repo = createDefaultRepository();
  const askedThisGame = new Set<string>();
  const total = idsOf('arte').length;

  for (let i = 0; i < total; i++) {
    const picked = repo.pick('arte', { askedThisGame });
    assert.ok(!askedThisGame.has(picked.id), `${picked.id} salió dos veces`);
    askedThisGame.add(picked.id);
  }
  assert.equal(askedThisGame.size, total, 'deberían haber salido todas, sin repetir');
});

test('agotada la categoría en una partida larga, se repite antes que atascarse', () => {
  // El banco es finito: si "no repetir" fuera condición y no preferencia, aquí
  // no habría pregunta que dar y la partida se quedaría clavada.
  const repo = createDefaultRepository();
  const todas = new Set(idsOf('ciencia'));

  const picked = repo.pick('ciencia', { askedThisGame: todas });
  assert.ok(todas.has(picked.id), 'debe repetir antes que dejar al jugador sin pregunta');
});

test('el historial de una partida no afecta a la siguiente', () => {
  // Cada partida empieza con el montón entero: si juegas hoy con alguien y
  // mañana con otra persona, las preguntas vuelven a estar disponibles.
  const repo = createDefaultRepository();
  const todas = idsOf('cultura');
  const partidaAnterior = new Set(todas);

  const vistas = new Set<string>();
  for (let i = 0; i < 60; i++) vistas.add(repo.pick('cultura', { askedThisGame: new Set() }).id);

  assert.ok(vistas.size > 1, 'la partida nueva debe volver a sortear entre todas');
  for (const id of vistas) {
    assert.ok(partidaAnterior.has(id), `${id}: debería seguir en el montón`);
  }
});

// --- Cuota de packs ---------------------------------------------------------

test('la cuota de packs crece con los packs activos, pero tiene tope', () => {
  assert.equal(packShare(0), 0, 'sin packs, todo sale del banco base');
  assert.ok(packShare(1) > 0.2, 'con un pack se debe notar');
  assert.ok(packShare(2) > packShare(1), 'más packs, más presencia temática');
  assert.ok(packShare(10) <= 0.4, 'el banco base nunca baja del 60 %');
  assert.equal(packShare(50), packShare(10), 'por encima del tope no sigue subiendo');
});

test('con un pack activo, sus preguntas salen de verdad', () => {
  const repo = createDefaultRepository(content.packs);
  const pack = content.packs[0];
  const packIds = [pack.id];
  const suyas = new Set(pack.questions.map((q) => q.id));
  const category = pack.questions[0].category;

  let temáticas = 0;
  for (let i = 0; i < 400; i++) {
    if (suyas.has(repo.pick(category, { packIds }).id)) temáticas += 1;
  }
  // Antes de la cuota salían ~1 de cada 100; ahora deben rondar la cuota.
  const proporción = temáticas / 400;
  assert.ok(
    proporción > 0.15,
    `demasiado pocas preguntas del pack: ${(proporción * 100).toFixed(1)} %`,
  );
  assert.ok(
    proporción < 0.45,
    `el pack se come la partida: ${(proporción * 100).toFixed(1)} %`,
  );
});

test('la cuota respeta las preguntas ya vistas: no repite si queda banco', () => {
  const repo = createDefaultRepository(content.packs);
  const pack = content.packs[0];
  const category = pack.questions[0].category;
  const packIds = [pack.id];

  // Se agotan las preguntas del pack en esta partida: debe tirar del banco base
  // en vez de repetir una temática ya salida.
  const askedThisGame = new Set(pack.questions.filter((q) => q.category === category).map((q) => q.id));
  const suyas = new Set(pack.questions.map((q) => q.id));
  for (let i = 0; i < 60; i++) {
    const picked = repo.pick(category, { packIds, askedThisGame, random: () => 0 });
    assert.ok(!suyas.has(picked.id), `repitió la temática ${picked.id} teniendo banco base sin usar`);
  }
});

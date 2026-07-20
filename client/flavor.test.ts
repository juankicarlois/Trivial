import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correctLines,
  diceLines,
  landedLines,
  nextIndex,
  reboundExpiredLines,
  startLines,
  theirTurnLines,
  wedgeLines,
  winLines,
  wrongLines,
  yourTurnLines,
  diceLine,
} from './flavor.js';

// --- La regla de oro: ninguna variante se deja el dato esencial --------------

test('toda variante de tirada lleva el nombre y el número', () => {
  for (const line of diceLines) {
    const texto = line('Ana', 4);
    assert.ok(texto.includes('Ana'), `sin nombre: "${texto}"`);
    assert.ok(texto.includes('4'), `sin número: "${texto}"`);
  }
});

test('toda variante de caída lleva el nombre y la casilla', () => {
  for (const line of landedLines) {
    const texto = line('Ana', 'Sede de Historia');
    assert.ok(texto.includes('Ana'), `sin nombre: "${texto}"`);
    assert.ok(texto.includes('Sede de Historia'), `sin casilla: "${texto}"`);
  }
});

test('todo acierto dice el nombre y deja claro que acertó', () => {
  for (const line of correctLines) {
    const texto = line('Ana').toLowerCase();
    assert.ok(texto.includes('ana'), `sin nombre: "${texto}"`);
    assert.ok(
      texto.includes('correcto') || texto.includes('acier'),
      `no deja claro el acierto: "${texto}"`,
    );
  }
});

test('todo fallo dice el nombre y deja claro que falló, sin cantar la respuesta', () => {
  for (const line of wrongLines) {
    const texto = line('Ana').toLowerCase();
    assert.ok(texto.includes('ana'), `sin nombre: "${texto}"`);
    assert.ok(
      texto.includes('falla') ||
        texto.includes('fallo') ||
        texto.includes('incorrecto') ||
        texto.includes('equivoca') ||
        texto.includes('no acierta'),
      `no deja claro el fallo: "${texto}"`,
    );
    assert.ok(!texto.includes('respuesta era'), 'el fallo no debe incluir la respuesta correcta');
  }
});

test('todo queso lleva el bando y la categoría', () => {
  for (const line of wedgeLines) {
    const texto = line('Equipo 2', 'Historia');
    assert.ok(texto.includes('Equipo 2'), `sin bando: "${texto}"`);
    assert.ok(texto.includes('Historia'), `sin categoría: "${texto}"`);
  }
});

test('toda victoria lleva el bando ganador', () => {
  for (const line of winLines) {
    assert.ok(line('Ana').includes('Ana'), `sin bando: "${line('Ana')}"`);
  }
});

test('todo turno ajeno lleva el nombre', () => {
  for (const line of theirTurnLines) {
    assert.ok(line('Ana').includes('Ana'), `sin nombre: "${line('Ana')}"`);
  }
});

// --- Variedad: repertorios de sobra y sin repetir seguido --------------------

test('cada repertorio tiene un buen puñado de variantes', () => {
  const repertorios = {
    start: startLines,
    dice: diceLines,
    landed: landedLines,
    correct: correctLines,
    wrong: wrongLines,
    wedge: wedgeLines,
    win: winLines,
    reboundExpired: reboundExpiredLines,
    yourTurn: yourTurnLines,
    theirTurn: theirTurnLines,
  };
  for (const [nombre, pool] of Object.entries(repertorios)) {
    assert.ok(pool.length >= 5, `"${nombre}" tiene solo ${pool.length} variantes`);
  }
});

test('nextIndex nunca devuelve el mismo índice dos veces seguidas', () => {
  // Con un azar que siempre pide el mismo índice, debe desviarse del anterior.
  let previo = -1;
  for (let i = 0; i < 20; i++) {
    const idx = nextIndex('prueba', 6, () => 0); // pide siempre el 0
    if (i > 0) assert.notEqual(idx, previo, 'ha repetido la variante anterior');
    previo = idx;
  }
});

test('con una sola variante, nextIndex devuelve 0 sin romperse', () => {
  assert.equal(nextIndex('unico', 1), 0);
  assert.equal(nextIndex('unico', 1), 0);
});

test('el narrador va cambiando de frase al repetir la misma situación', () => {
  const salidas = new Set<string>();
  let previa = '';
  for (let i = 0; i < 30; i++) {
    const linea = diceLine('Ana', 3);
    assert.notEqual(linea, previa, 'ha repetido la frase anterior en la misma situación');
    salidas.add(linea);
    previa = linea;
  }
  assert.ok(salidas.size >= 4, `poca variedad real: solo ${salidas.size} frases distintas`);
});

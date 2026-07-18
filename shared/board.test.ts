import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, HUB_ID } from './board.js';
import { CATEGORIES } from './categories.js';

test('el tablero tiene 61 nodos (1 hub + 42 anillo + 18 radios)', () => {
  const { nodes } = buildBoard();
  assert.equal(Object.keys(nodes).length, 61);
});

test('el hub conecta con los seis radios', () => {
  const { nodes } = buildBoard();
  assert.equal(nodes[HUB_ID].neighbors.length, CATEGORIES.length);
});

test('cada sede tiene grado 3 (dos del anillo + un radio)', () => {
  const { nodes } = buildBoard();
  const hqs = Object.values(nodes).filter((n) => n.kind === 'hq');
  assert.equal(hqs.length, CATEGORIES.length);
  for (const hq of hqs) assert.equal(hq.neighbors.length, 3);
});

test('las adyacencias son simétricas', () => {
  const { nodes } = buildBoard();
  for (const node of Object.values(nodes)) {
    for (const neighborId of node.neighbors) {
      const neighbor = nodes[neighborId];
      assert.ok(neighbor, `vecino inexistente: ${neighborId} desde ${node.id}`);
      assert.ok(
        neighbor.neighbors.includes(node.id),
        `adyacencia no recíproca entre ${node.id} y ${neighborId}`,
      );
    }
  }
});

test('el nodo de inicio es el hub', () => {
  const board = buildBoard();
  assert.equal(board.startNodeId, HUB_ID);
});

test('las casillas de un mismo radio tienen etiquetas distintas', () => {
  const { nodes } = buildBoard();
  // Antes las tres se llamaban igual ("Radio de Geografía") y no se distinguían.
  for (const cat of CATEGORIES) {
    const labels = [1, 2, 3].map((k) => nodes[`spoke-${cat.id}-${k}`].label);
    assert.equal(new Set(labels).size, labels.length, `radio de ${cat.name} con etiquetas repetidas`);
    for (const label of labels) {
      assert.ok(label.includes(cat.name), `"${label}" debería nombrar su categoría`);
    }
  }
});

test('los extremos del radio se sitúan respecto a la sede y al centro', () => {
  const { nodes } = buildBoard();
  assert.match(nodes['spoke-geografia-1'].label, /junto a la sede/);
  assert.match(nodes['spoke-geografia-3'].label, /junto al centro/);
});

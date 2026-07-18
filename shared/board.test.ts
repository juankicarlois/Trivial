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

// --- Geometría (posiciones para audio posicional y futuro tablero visual) ----

const radius = (p: { x: number; y: number }): number => Math.hypot(p.x, p.y);

test('el centro está en el origen y el anillo a radio 1', () => {
  const { nodes } = buildBoard();
  assert.equal(nodes[HUB_ID].position.x, 0);
  assert.equal(nodes[HUB_ID].position.y, 0);
  for (const node of Object.values(nodes)) {
    if (node.kind === 'ring' || node.kind === 'hq') {
      assert.ok(Math.abs(radius(node.position) - 1) < 1e-9, `${node.id} no está en el anillo`);
    }
  }
});

test('las casillas del radio se acercan al centro según avanzan', () => {
  const { nodes } = buildBoard();
  const r1 = radius(nodes['spoke-geografia-1'].position); // junto a la sede
  const r2 = radius(nodes['spoke-geografia-2'].position);
  const r3 = radius(nodes['spoke-geografia-3'].position); // junto al centro
  assert.ok(r1 > r2 && r2 > r3, 'el radio debe decrecer de la sede al centro');
  assert.ok(r1 < 1 && r3 > 0, 'quedan entre el anillo y el centro, sin tocarlos');
});

test('un radio apunta en la misma dirección que su sede', () => {
  const { nodes } = buildBoard();
  const hq = nodes['hq-geografia'].position;
  const spoke = nodes['spoke-geografia-1'].position;
  // Misma dirección: el coseno del ángulo entre ambos vectores es ~1.
  const cos = (hq.x * spoke.x + hq.y * spoke.y) / (radius(hq) * radius(spoke));
  assert.ok(cos > 0.999, 'la casilla del radio debe caer hacia su sede');
});

test('sedes opuestas quedan en lados opuestos de la rueda', () => {
  const { nodes } = buildBoard();
  // Geografía (segmento 0) queda al norte; Ciencia (segmento 3) al sur.
  const norte = nodes['hq-geografia'].position;
  const sur = nodes['hq-ciencia'].position;
  assert.ok(norte.y > 0.99, 'Geografía debería quedar arriba');
  assert.ok(sur.y < -0.99, 'Ciencia debería quedar abajo (opuesta)');
});

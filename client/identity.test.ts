import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfileId, randomId, type KeyValueStore } from './identity.js';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Almacén de prueba en memoria. */
function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

/** Como `crypto` al servir por IP de la red local: sin `randomUUID`. */
const insecureCrypto: Partial<Crypto> = {
  getRandomValues: (<T extends ArrayBufferView | null>(array: T): T => {
    const bytes = new Uint8Array((array as unknown as Uint8Array).buffer);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return array;
  }) as Crypto['getRandomValues'],
};

test('sin contexto seguro no hay randomUUID, y aun así se genera un id válido', () => {
  // Este era el fallo: al servir por http://192.168.x.x, crypto.randomUUID no
  // existe, y llamarlo tumbaba el cliente entero al cargar.
  assert.equal(typeof insecureCrypto.randomUUID, 'undefined');
  const id = randomId(insecureCrypto);
  assert.match(id, UUID_SHAPE, 'debe tener forma de UUID');
});

test('el id generado sin randomUUID marca versión 4 y variante', () => {
  const id = randomId(insecureCrypto);
  assert.equal(id[14], '4', 'la versión debe ser 4');
  assert.ok(['8', '9', 'a', 'b'].includes(id[19]), `variante inesperada: ${id[19]}`);
});

test('se usa randomUUID cuando está disponible', () => {
  const fixed = '11111111-2222-4333-8444-555555555555';
  const id = randomId({ randomUUID: () => fixed } as Partial<Crypto>);
  assert.equal(id, fixed);
});

test('sin crypto ninguno, sigue devolviendo un id en vez de reventar', () => {
  const id = randomId(undefined);
  assert.ok(id.length > 0, 'nadie debe quedarse sin jugar por esto');
});

test('los ids generados no se repiten', () => {
  const ids = new Set(Array.from({ length: 200 }, () => randomId(insecureCrypto)));
  assert.equal(ids.size, 200, 'no debería haber colisiones');
});

test('el perfil se guarda la primera vez y se reutiliza después', () => {
  const store = memoryStore();
  const first = loadProfileId(store, insecureCrypto);
  const second = loadProfileId(store, insecureCrypto);
  assert.equal(first, second, 'la identidad debe ser estable entre visitas');
});

test('se respeta el perfil ya guardado', () => {
  const store = memoryStore({ 'trivial.profileId': 'perfil-existente' });
  assert.equal(loadProfileId(store, insecureCrypto), 'perfil-existente');
});

test('si el navegador no deja guardar, se juega igual sin persistir', () => {
  // localStorage bloqueado (modo privado, permisos): lanza solo con leerlo.
  const broken: KeyValueStore = {
    getItem: () => {
      throw new Error('acceso denegado');
    },
    setItem: () => {
      throw new Error('acceso denegado');
    },
  };
  const id = loadProfileId(broken, insecureCrypto);
  assert.match(id, UUID_SHAPE, 'debe devolver una identidad de usar y tirar');
});

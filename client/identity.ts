/**
 * Identidad persistente del jugador en el navegador.
 *
 * Ojo con `crypto.randomUUID()`: **solo existe en contextos seguros** (HTTPS o
 * `localhost`). Como el juego se sirve por la IP de la red local
 * (`http://192.168.x.x:3000`), ahí no está, y usarlo directamente reventaba el
 * cliente entero al cargar: sin manejadores, el botón de entrar no hacía nada y
 * el formulario recargaba la página. `crypto.getRandomValues()` sí está
 * disponible sin contexto seguro, así que el UUID se genera a mano con él.
 */

/** Almacenamiento mínimo que necesita el perfil (lo cumple `localStorage`). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PROFILE_KEY = 'trivial.profileId';

/**
 * @brief Genera un identificador aleatorio con formato UUID v4.
 *
 * @param cryptoApi API criptográfica a usar; se inyecta para poder probar los
 *        distintos escenarios (con `randomUUID`, sin él, o sin `crypto`).
 * @return Identificador único.
 */
export function randomId(cryptoApi: Partial<Crypto> | undefined = globalThis.crypto): string {
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    // Marcas de versión (4) y variante que exige el formato UUID.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Sin criptografía disponible: sirve para no dejar a nadie sin jugar. No es
  // seguro, pero un id de perfil no protege nada.
  const random = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${random()}-${random()}-${random()}-${random()}`;
}

/**
 * @brief Recupera la identidad guardada del jugador, creándola la primera vez.
 *
 * Si el navegador no deja guardar (modo privado, permisos bloqueados), se usa
 * una identidad de usar y tirar: se puede jugar, pero el progreso no se acumula
 * entre sesiones. Nunca lanza: un fallo aquí dejaría el cliente inservible.
 *
 * @param store Almacén persistente; `localStorage` por defecto.
 * @param cryptoApi API criptográfica; la del navegador por defecto.
 * @return Identificador estable del perfil.
 */
export function loadProfileId(
  store: KeyValueStore | undefined = safeLocalStorage(),
  cryptoApi: Partial<Crypto> | undefined = globalThis.crypto,
): string {
  try {
    const saved = store?.getItem(PROFILE_KEY);
    if (saved) return saved;
    const created = randomId(cryptoApi);
    store?.setItem(PROFILE_KEY, created);
    return created;
  } catch {
    return randomId(cryptoApi);
  }
}

/** `localStorage` puede lanzar solo con leerlo si está bloqueado. */
function safeLocalStorage(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

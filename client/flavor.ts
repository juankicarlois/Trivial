/**
 * Chispa del narrador: para cada momento del juego hay un repertorio de frases y
 * se elige una al azar, evitando repetir la de la vez anterior. Así quien juega a
 * menudo no oye siempre lo mismo en la misma situación.
 *
 * Regla que no se negocia: **cada variante lleva el dato esencial** (quién, qué
 * número, qué categoría…). La gracia es la envoltura, nunca a costa de la
 * información: este es un juego que se juega oyendo, y una frase ingeniosa que se
 * come el dato deja a alguien sin poder seguir la partida. Por eso todas las
 * variantes de acierto dicen "acierta/correcto" y las de fallo "falla/incorrecto":
 * la señal clave siempre está, aunque cambie el ropaje.
 *
 * Va aparte de la interfaz y sin tocar el DOM para poder probarlo: un test
 * comprueba que ninguna variante se deja el dato por el camino.
 */

/** Último índice servido de cada repertorio, para no repetirlo seguido. */
const lastIndex = new Map<string, number>();

/**
 * @brief Elige un índice del repertorio distinto al último servido para esa clave.
 * @param key Identifica el repertorio (p. ej. "dice").
 * @param length Número de variantes.
 * @param rnd Fuente de azar, inyectable para test.
 * @return Índice válido; nunca el mismo dos veces seguidas si hay más de una.
 */
export function nextIndex(key: string, length: number, rnd: () => number = Math.random): number {
  if (length <= 1) return 0;
  const previous = lastIndex.get(key);
  let index = Math.floor(rnd() * length);
  if (index === previous) index = (index + 1) % length; // nunca la anterior
  lastIndex.set(key, index);
  return index;
}

/** Sirve una variante del repertorio, evitando la anterior. */
function fromPool<A extends unknown[]>(key: string, pool: Array<(...args: A) => string>, ...args: A): string {
  return pool[nextIndex(key, pool.length)](...args);
}

// --- Repertorios ------------------------------------------------------------
//
// Se exportan para poder auditarlos en los tests (que cada variante lleve su
// dato). El código normal usa las funciones de más abajo.

/** Arranque de la partida. Sin datos: pura entrada. */
export const startLines: Array<() => string> = [
  () => '¡Empieza la partida!',
  () => '¡Que empiece el juego!',
  () => '¡Arrancamos! Mucha suerte.',
  () => '¡A jugar!',
  () => '¡Se abre el telón: partida en marcha!',
  () => '¡Manos a la rueda!',
  () => '¡Dentro partida!',
  () => '¡Suena el pistoletazo: a por los quesos!',
];

/** Tirada de dado. Lleva siempre el nombre y el número. */
export const diceLines: Array<(name: string, value: number) => string> = [
  (name, value) => `${name} saca un ${value}.`,
  (name, value) => `${name} tira y salen ${value}.`,
  (name, value) => `Un ${value} para ${name}.`,
  (name, value) => `${name} rueda el dado: ${value}.`,
  (name, value) => `El dado le da un ${value} a ${name}.`,
  (name, value) => `${name} avanza ${value}.`,
  (name, value) => `${value} le toca a ${name}.`,
  (name, value) => `${name} saca ${value} en el dado.`,
];

/** Caída en una casilla. Lleva siempre el nombre y la casilla. */
export const landedLines: Array<(name: string, label: string) => string> = [
  (name, label) => `${name} cae en ${label}.`,
  (name, label) => `${name} aterriza en ${label}.`,
  (name, label) => `${name} para en ${label}.`,
  (name, label) => `${name} llega a ${label}.`,
  (name, label) => `${name} se planta en ${label}.`,
  (name, label) => `Le toca ${label} a ${name}.`,
  (name, label) => `${name} pisa ${label}.`,
];

/** Acierto. Toda variante dice "acierta" o "correcto". */
export const correctLines: Array<(name: string) => string> = [
  (name) => `${name} responde: ¡correcto!`,
  (name) => `¡Correcto, ${name}!`,
  (name) => `${name} acierta.`,
  (name) => `¡Acierto de ${name}!`,
  (name) => `${name} lo borda: correcto.`,
  (name) => `¡Bien! ${name} acierta.`,
  (name) => `Correcto: ${name}.`,
  (name) => `${name} acierta de pleno.`,
  (name) => `¡Toma acierto, ${name}!`,
];

/**
 * Fallo. Toda variante dice "falla", "fallo" o "incorrecto". No incluye la
 * respuesta correcta: eso lo añade quien llama (y solo cuando procede).
 */
export const wrongLines: Array<(name: string) => string> = [
  (name) => `${name} responde: incorrecto.`,
  (name) => `${name} falla.`,
  (name) => `Fallo de ${name}.`,
  (name) => `${name} no acierta.`,
  (name) => `Incorrecto, ${name}.`,
  (name) => `${name} se equivoca.`,
  (name) => `${name} falla esta.`,
  (name) => `No es esa: ${name} falla.`,
];

/** Queso ganado. Lleva siempre el bando y la categoría. */
export const wedgeLines: Array<(side: string, category: string) => string> = [
  (side, category) => `${side} gana el queso de ${category}.`,
  (side, category) => `${side} se lleva el queso de ${category}.`,
  (side, category) => `¡Queso de ${category} para ${side}!`,
  (side, category) => `${side} suma el queso de ${category}.`,
  (side, category) => `${side} conquista ${category}: queso al saco.`,
  (side, category) => `¡Un queso más para ${side}: ${category}!`,
  (side, category) => `${side} clava ${category} y se lleva el queso.`,
];

/** Victoria. Lleva siempre el bando ganador. */
export const winLines: Array<(side: string) => string> = [
  (side) => `¡${side} gana la partida!`,
  (side) => `¡Victoria de ${side}!`,
  (side) => `¡La partida es de ${side}!`,
  (side) => `¡${side} gana, se acabó!`,
  (side) => `¡Y gana… ${side}!`,
  (side) => `¡${side} se lleva el juego!`,
  (side) => `¡Se acabó: gana ${side}!`,
];

/** Rebote que nadie pulsó. Toda variante deja claro que la pregunta se pierde. */
export const reboundExpiredLines: Array<() => string> = [
  () => 'Nadie pulsa a tiempo. La pregunta se queda sin dueño.',
  () => 'Se agota el rebote: nadie la quiso.',
  () => 'Fin del rebote, la pregunta se pierde.',
  () => 'Nadie se lanza: la pregunta al limbo.',
  () => 'Ni un pulsador a tiempo: pregunta perdida.',
];

/** "Es tu turno", dirigido a quien juega. */
export const yourTurnLines: Array<() => string> = [
  () => 'Es tu turno.',
  () => 'Te toca.',
  () => '¡Tu turno!',
  () => 'Va por ti.',
  () => 'Adelante, es tu turno.',
  () => 'Tuya la tirada.',
];

/** "Turno de X", en partida individual. Lleva siempre el nombre. */
export const theirTurnLines: Array<(name: string) => string> = [
  (name) => `Turno de ${name}.`,
  (name) => `Le toca a ${name}.`,
  (name) => `Ahora va ${name}.`,
  (name) => `${name} al mando.`,
  (name) => `Turno para ${name}.`,
];

// --- Funciones que usa la interfaz ------------------------------------------

export const startLine = (): string => fromPool('start', startLines);
export const diceLine = (name: string, value: number): string => fromPool('dice', diceLines, name, value);
export const landedLine = (name: string, label: string): string => fromPool('landed', landedLines, name, label);
export const correctLine = (name: string): string => fromPool('correct', correctLines, name);
export const wrongLine = (name: string): string => fromPool('wrong', wrongLines, name);
export const wedgeLine = (side: string, category: string): string => fromPool('wedge', wedgeLines, side, category);
export const winLine = (side: string): string => fromPool('win', winLines, side);
export const reboundExpiredLine = (): string => fromPool('reboundExpired', reboundExpiredLines);
export const yourTurnLine = (): string => fromPool('yourTurn', yourTurnLines);
export const theirTurnLine = (name: string): string => fromPool('theirTurn', theirTurnLines, name);

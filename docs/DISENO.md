# Trivial accesible — documento de diseño

Fuente de verdad del proyecto. Se actualiza en cada cambio relevante.

## Visión

Juego de trivial estilo *Pursuit* (rueda, radios, quesos), **totalmente accesible
con lectores de pantalla** y jugable también por personas que ven. Multijugador en
red local (cada jugador desde su PC), con vistas a internet más adelante. Sonidos
para dado, movimiento de ficha, logros, acierto/fallo, queso ganado.

## Stack

- **Servidor:** Node + TypeScript. WebSocket (`ws`) para sincronizar la partida en
  tiempo real. Sirve también el frontend estático y aloja *salas* (join por código).
  Un solo puerto → la otra persona entra por `http://IP-LOCAL:PUERTO`.
- **Cliente:** TypeScript + DOM plano (sin framework). Regiones ARIA live para el
  lector, foco gestionado por teclado, Web Audio con paneo estéreo para sonidos.
- **Contenido:** JSON autorable — categorías, preguntas base, packs temáticos,
  logros. Se amplía sin recompilar.
- **Persistencia:** perfiles + logros + packs desbloqueados en disco (arranca en
  JSON; se puede migrar a SQLite si crece).

## Accesibilidad — reglas

- Todo estado relevante se **anuncia** por una región `aria-live` (turno actual,
  tirada, casilla al moverse, categoría, resultado). Nada depende de ver el tablero.
- Navegación 100% por teclado. El foco va siempre a un elemento con nombre accesible.
- El tablero visual es un complemento, no un requisito. Los dos modos (audio/visual)
  reflejan el mismo estado.
- Sonidos como refuerzo, nunca como único canal de información: cada sonido tiene su
  anuncio textual equivalente.
- Los avisos de una misma ráfaga (responder → revelar respuesta → cambio de turno)
  se **agrupan en un solo anuncio**: escritos de uno en uno en la región aria-live,
  cada uno pisaría al anterior y se perderían.
- **Regla de fondo: si quien ve el tablero puede deducir algo de un vistazo, hay
  que decirlo.** No basta con que el estado sea accesible; la *información que da
  el tablero* también tiene que serlo.

### Orientación: saber hacia dónde moverse

El problema central de este juego: quien ve la rueda cuenta casillas y sabe al
instante dónde caerá y dónde está cada sede. Con solo el nombre de la casilla de
al lado ("Casilla de Historia"), quien no ve elige a ciegas.

Dos piezas lo resuelven, ambas construidas sobre funciones puras del tablero
(`previewMove` y `distancesFrom` en `shared/board.ts`):

1. **Cada dirección dice su desenlace** (`describeDirection`): la casilla
   inmediata, dónde se cae con los pasos que quedan y qué hay allí (queso que
   falta, pregunta final, casilla libre). Si el camino se bifurca antes de gastar
   los pasos, se dice en vez de prometer un destino que no está decidido.
2. **Brújula** (tecla `B`, `boardRadarSummary`): posición actual y distancia a
   cada sede pendiente, de más cerca a más lejos. Usa recorrido en anchura, así
   que contempla el atajo por el centro (8 casillas cruzando, frente a 21 por el
   anillo).

La regla de por dónde se puede avanzar (`forwardMoves`) vive en `shared/` y el
servidor la usa a través de `legalMoves`: **una sola implementación**. Si el
cliente tuviera la suya para las previsiones, acabarían diciendo cosas distintas
y el juego mentiría al jugador.

Las frases están en `client/narration.ts`, **aparte del DOM y con tests**
(`client/narration.test.ts`). Son lo único que tiene quien no ve: un "a 0
casillas" o un plural mal puesto no es un detalle estético, y sin tests no se
detecta.

## Modelo del tablero (rueda Pursuit)

Grafo de nodos con adyacencias (`shared/board.ts` lo genera):

- **Hub** (centro): 1 nodo. Círculo del ganador; se responde aquí para ganar.
- **Anillo exterior:** 6 segmentos. Cada segmento = 6 casillas normales + 1 **sede**
  (HQ) de categoría al final → 6 sedes + 36 normales = **42 casillas** de anillo.
- **Radios:** 6 radios, cada uno con 3 casillas entre su sede y el hub → **18**.
- Total: 1 + 42 + 18 = **61 nodos**.

Grados: casilla normal = 2 vecinos; **sede** = 3 (dos del anillo + radio hacia
dentro); **hub** = 6 (un radio por categoría).

### Movimiento

- Se tira 1d6 y se avanza ese número de pasos.
- En cada paso, si el nodo tiene más de un vecino disponible, el jugador **elige**
  dirección (flechas + anuncio). No se puede deshacer el paso anterior (no
  retroceder a la casilla de la que se viene) para evitar oscilar en el sitio.
- Caer en una casilla → pregunta de su categoría. Acierto: sigues (regla clásica:
  turno extra al acertar). Fallo: pasa el turno.
- Caer en una **sede** y acertar → ganas el **queso** de esa categoría.
- Con los 6 quesos, al llegar al **hub** respondes una pregunta de categoría elegida
  por los rivales; si aciertas, ganas.

## Categorías base (2026)

1. Geografía
2. Historia
3. Arte y Literatura
4. Ciencia y Naturaleza
5. Deportes y Ocio
6. Cultura y Tecnología (moderniza el clásico "Entretenimiento")

### Banco de preguntas

`content/questions.base.json`: **120 preguntas, 20 por categoría**, de opción
múltiple (4 opciones, barajadas al plantearlas). Cada una lleva `difficulty` de
1 a 3.

Criterios al escribir preguntas:

- **Datos estables y comprobables.** Nada que caduque en unos meses ni cuya
  respuesta dependa de la interpretación (p. ej. "el río más largo del mundo",
  con el eterno debate Nilo/Amazonas, no entra).
- **Una sola respuesta indiscutible**, y tres distractores plausibles.
- La integridad del banco la comprueba `server/questions_repo.test.ts`: ids
  únicos, 4 opciones distintas y no vacías, `answerIndex` en rango, categoría
  válida, mínimo por categoría y que la barajada conserve la respuesta correcta.
  Un `answerIndex` mal puesto daría por buena una respuesta incorrecta sin que
  nadie lo note, de ahí el test.

## Logros → packs temáticos

### Perfiles

La identidad persistente es un `profileId` que **genera el cliente** y guarda en
`localStorage`; se envía al entrar en una sala. **No se usa el nombre como
identidad**: así el progreso sobrevive a un cambio de nombre y dos personas que
se llamen igual no comparten logros. El servidor guarda los perfiles en
`data/profiles.json` (fuera de git), con escritura diferida.

Si el fichero de perfiles no se puede leer, **se aparta una copia** antes de
empezar de cero: sobrescribirlo destruiría el progreso de todos sin remedio. Si
ni siquiera se puede apartar, el almacén queda en solo lectura.

### Logros

Un logro se mide contra una **estadística acumulada** (`stat`) y un **umbral**
(`atLeast`). Modelo deliberadamente simple: añadir logros es editar
`content/achievements.json`, sin tocar código.

Estadísticas: `gamesPlayed`, `gamesWon`, `wedgesEarned`, `questionsAnswered`,
`questionsCorrect`, `bestStreak`, `correct.<categoría>`.

Se comprueban tras responder y al terminar la partida; los nuevos se anuncian
(evento `achievementUnlocked`, con sonido propio).

### Packs

Cada pack (`content/packs/*.json`) lleva sus preguntas y el `unlockedBy` del
logro que lo abre. **Las preguntas del pack se reparten entre las 6 categorías
normales**, como en las ediciones temáticas del Trivial de mesa: así el tablero
no cambia y basta con sumarlas al repertorio. Un pack **no** tiene por qué cubrir
las 6 categorías.

Un pack está disponible en una sala si **cualquiera de los presentes** lo tiene
desbloqueado: quien se lo ganó lo trae a la mesa para todos. Se activa en el
vestíbulo (nunca a media partida: cambiar el repertorio sería injusto para quien
ya ha respondido). Al empezar se descartan los packs que ya nadie de la mesa
tenga desbloqueado.

## Fases

- **Fase 1 (MVP jugable):** salas en LAN, tablero+dado+movimiento por teclado,
  preguntas base desde JSON, quesos, condición de victoria. Accesibilidad completa
  + sonidos básicos.
- **Fase 2 (hecha):** perfiles persistentes + logros + desbloqueo y activación de
  packs temáticos.
- **Fase 3:** bots IA con dificultad; juego por internet (abrir puerto / túnel);
  más contenido y herramienta de autoría.

## Pendiente / ideas

- **Pregunta final del centro:** ahora la categoría es aleatoria; en el Trivial
  clásico la eligen los rivales.
- **Tablero visual** (rueda SVG) para quien ve: hoy la vista es funcional pero
  mínima (texto y listas).
- Bots, juego fuera de la LAN, más packs.

## Fuera de alcance por ahora

- Bots (fase 3).
- Juego fuera de la LAN (fase 3).

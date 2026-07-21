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
- **Audio posicional del movimiento** (`PannerNode` HRTF, oyente en el centro de la
  rueda): el sonido del paso suena en la posición de la casilla, así que orbita al
  moverse por el anillo y se acerca/aleja al entrar o salir del centro; también
  sitúa a los rivales al moverse. La geometría vive en `shared/board.ts`
  (`BoardNode.position`, centro en el origen, anillo a radio 1) y servirá también
  para el tablero visual. Limitación conocida: el HRTF de la web distingue bien
  izquierda/derecha y distancia, pero el delante/detrás es flojo (radios opuestos
  se proyectan al mismo lado); por eso es refuerzo y el texto sigue dando la
  posición exacta.
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
2. **Brújula** (`boardRadarSummary`): posición actual y distancia a cada sede
   pendiente, de más cerca a más lejos. Usa recorrido en anchura, así que
   contempla el atajo por el centro (8 casillas cruzando, frente a 21 por el
   anillo).

Cada casilla tiene una **etiqueta única y orientativa**. Las tres casillas de un
radio comparten categoría (coherencia de navegación) pero se distinguen por su
posición —"junto a la sede", "a medio camino", "junto al centro"—; si no, las
tres se llamarían igual y no se sabría en cuál se está.

Las consultas (situación, rivales, quesos, logros) se ofrecen como **botones**,
no como
atajos de una tecla. Los lectores de pantalla en **modo exploración** capturan
las teclas sueltas (`B`, `L`, `Q`, `H`…) como navegación rápida por la página, de
modo que un atajo de una letra nunca les llega. Activar un botón (Intro/Espacio)
sí funciona en ese modo. Las teclas se mantienen como vía secundaria (modo foco o
sin lector), nunca como única. Regla general: **no depender de teclas de un solo
carácter imprimible para funciones del juego.**

La regla de por dónde se puede avanzar (`forwardMoves`) vive en `shared/` y el
servidor la usa a través de `legalMoves`: **una sola implementación**. Si el
cliente tuviera la suya para las previsiones, acabarían diciendo cosas distintas
y el juego mentiría al jugador.

Las frases están en `client/narration.ts`, **aparte del DOM y con tests**
(`client/narration.test.ts`). Son lo único que tiene quien no ve: un "a 0
casillas" o un plural mal puesto no es un detalle estético, y sin tests no se
detecta.

**Narrador con chispa** (`client/flavor.ts`). Los avisos de cada momento —tirada,
acierto, fallo, queso, victoria, turno, arranque, rebote sin dueño— no son una
frase fija, sino un repertorio de variantes entre las que se elige al azar,
evitando repetir la anterior (`nextIndex`), para que quien juega a menudo no oiga
siempre lo mismo. La regla dura: **cada variante lleva el dato esencial** (quién,
qué número, qué categoría) y las de acierto/fallo dicen siempre "acierta/correcto"
o "falla/incorrecto"; la chispa es la envoltura, nunca a costa de la información.
`client/flavor.test.ts` audita variante por variante que el dato no se pierde, y
que hay repertorio de sobra (≥5 por situación). Las frases con lógica de persona
delicada (recordatorio de los seis quesos, instrucciones del rebote) siguen en
`main.ts`: ahí el riesgo de decir algo incorrecto pesa más que la variedad.

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
- **Tope de aciertos por turno** (`MAX_CORRECT_PER_TURN`, 3): al tercer acierto
  seguido se cede la vez aunque se haya acertado. Sin tope, quien domina el juego
  encadena turnos y el resto se aburre esperando. El contador es por turno (se
  reinicia al cambiar de jugador) y no afecta a la racha de los logros, que sigue
  contando aciertos seguidos a lo largo de la partida. La pregunta final para
  ganar queda fuera del tope: si se acierta, se gana.
- Caer en una **sede** y acertar → ganas el **queso** de esa categoría.
- **Comodines** (`WildcardId` en `protocol.ts`, inventario por jugador en `Room`).
  Cada jugador empieza la partida con un uso de cada comodín (`WILDCARDS`), que se
  reponen en `start()`. Se usan en `awaitAnswer` con `useWildcard`, solo el
  jugador del turno y **nunca en la pregunta final** (la decide la mesa, no se
  regala). Hay dos:
  - **`changeQuestion`**: descarta la pregunta y saca otra de la misma categoría.
    La actual ya está en `askedThisGame`, así que no repite mientras quede alguna
    sin usar. No re-emite `landed` (no te mueves).
  - **`fiftyFifty`**: descarta dos opciones incorrectas (`pickTwoWrongOptions`,
    nunca la correcta) y las manda en `PublicQuestion.eliminatedOptions` como
    **índices**, sin reordenar, para que `answer(optionIndex)` siga apuntando a la
    misma opción. **El cliente solo las oculta al jugador del turno**
    (`iAmCurrent`): si las ocultara a los rivales y la pregunta rebotara, sabrían
    que la buena es una de dos. Los descartes se borran al cambiar de pregunta.
  El enum y el andamiaje (mensaje `useWildcard`, evento `wildcardUsed`,
  `PlayerView.wildcards`, botones en el cliente) están pensados para añadir más
  comodines sin tocar la estructura.
- **Rebote** (fase `awaitRebound`): una pregunta fallada no se tira, queda en el
  aire. Se abre un **pulsador** de `REBOUND_MS` (8 s) para todos los bandos menos
  el que falló; el primero que pulsa se queda la pregunta y la responde. Si
  acierta, **se planta en la casilla del que falló** y, si era una sede cuyo queso
  le faltaba, se lo lleva. Fallar el rebote no cuesta nada: sin eso, nadie
  pulsaría nunca y el pulsador sobraría. Si no pulsa nadie, la pregunta caduca y
  el turno sigue su curso.
  - La **pregunta final no rebota**: decide la partida y no se regala.
  - Los bots pulsan con su probabilidad de acierto y **nunca antes de un tercio**
    de la ventana (`botBuzzDelayMs`): si se lanzaran al instante, una persona no
    llegaría jamás. Solo se programa el más rápido, porque el primer pulsador
    cierra la ventana.
  - Accesibilidad: la carrera arranca con el **anuncio** del rebote, que llega a
    toda la mesa a la vez, y el botón **recibe el foco** al aparecer, así que
    basta con Intro. Nadie tiene que leer nada antes de poder pulsar.
- Con los 6 quesos, al llegar al **hub** se abre la fase `awaitFinalCategory`:
  cualquier **rival** elige la categoría de la pregunta final (el primero que la
  elige la fija). Si aciertas, ganas. Sin rivales conectados (solitario o todos
  caídos) se elige al azar, para no atascar la partida esperando a nadie.

## Categorías base (2026)

1. Geografía
2. Historia
3. Arte y Literatura
4. Ciencia y Naturaleza
5. Deportes y Ocio
6. Cultura y Tecnología (moderniza el clásico "Entretenimiento")

### Banco de preguntas

Banco base: **1.242 preguntas, más de 200 por categoría**, con un fichero por categoría
(`content/questions.<categoria>.json`). Se cargan todos los `content/questions*.json`,
así que ampliar es añadir preguntas al fichero de su categoría (o un fichero nuevo).
De opción
múltiple (4 opciones, barajadas al plantearlas). Cada una lleva `difficulty` de
1 a 3.

### Qué pregunta sale

No se repite ninguna pregunta **dentro de la partida en curso**, se acierte o no:
como la carta usada del Trivial de mesa, no vuelve al montón. El historial vive
en la sala (`askedThisGame`) y se vacía al empezar cada partida.

**El alcance acaba ahí, y es deliberado.** Se probó a retirar del perfil las
preguntas acertadas, para siempre, y se descartó: el repertorio de cada jugador
solo encogería, y no hay motivo para que quien juega hoy con una persona no pueda
usar las mismas preguntas mañana con otra. Los perfiles guardan estadísticas y
logros; el historial de preguntas, no.

Es una **preferencia, no una condición**. El banco es finito y una partida larga
puede agotar una categoría; como condición, no habría pregunta que ofrecer y la
partida se quedaría clavada. Si no quedan candidatas se repite antes que fallar.
Nunca se lanza excepción.

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

**Qué categoría lleva cada pregunta de pack.** La categoría es el **tipo de saber
que se pregunta**, no el tema del pack: si caes en la sede de Deportes te tienen
que preguntar de deporte, aunque el pack sea de flamenco, y el queso que ganes
sea el de Deportes. Como guía:

| Categoría | Qué va aquí |
|-----------|-------------|
| Arte y Literatura | autores, obras, música, versos, títulos |
| Historia | fechas, fundadores, hechos y pueblos del pasado |
| Geografía | lugares, también los inventados (Hogwarts, Tatooine) |
| Ciencia y Naturaleza | animales, plantas, técnica |
| Deportes y Ocio | deportes y juegos |
| Cultura y Tecnología | personajes, marcas, tele, tecnología de consumo |

**No fuerces las categorías para cubrirlas todas**: un pack no tiene por qué
tener de las seis, y es normal que uno de cultura popular cargue en «Cultura y
Tecnología». Rellenar Deportes con una pregunta que no es de deportes es peor que
dejar Deportes vacío (pasó con la bulería de Camarón y el perro guía de
Tiflotecnología, y se corrigió).

**Cuota de packs** (`packShare` en `questions_repo.ts`). El sorteo va en dos
pasos: primero se decide si la pregunta sale del banco base o de los packs
activos, y luego cuál. Sorteando sobre los dos montones juntos los packs eran
invisibles: 2 preguntas por categoría contra ~205 del banco → 1 %, o sea ninguna
en toda la partida. La cuota es del 25 % con un pack, +5 % por cada pack de más y
tope del 40 %, para que la partida siga siendo de cultura general. Si la fuente
que toca está agotada (todas sus preguntas ya salieron), se tira de la otra antes
que repetir.

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

## Capa visual

Muchos jugadores usan lector de pantalla, pero no todos: la interfaz tiene una
**capa visual** (color, tarjetas, relieve, micro-animaciones) para que a quien ve
le entre por los ojos y le sea cómoda. **Regla que no se toca: la capa visual es
puro añadido.** No cambia el DOM semántico, ni las etiquetas, ni el foco, ni los
anuncios del lector; si se quitara entera, el juego sería idéntico para quien usa
lector. En la práctica:

- Casi todo vive en `public/styles.css` (un bloque «Capa visual» al final), que
  no toca el marcado.
- Lo que sí añade DOM es **solo decorativo y `aria-hidden`**: los avatares de
  color de la lista de jugadores (`avatarChip`, misma paleta que las fichas del
  tablero, `tokenColor`). El nombre sigue en texto al lado, así que el lector no
  pierde nada.
- El color de la **categoría en juego** se pasa como variable CSS `--cat-color`
  (la fija el cliente sobre la pregunta y los quesos); es apoyo visual, el título
  ya nombra la categoría.
- Respeta `prefers-color-scheme` (claro/oscuro) y `prefers-reduced-motion` (las
  animaciones —halo del turno, latido de la ficha— se apagan si se pide).

## Tablero visual

`client/board_view.ts` dibuja la rueda como un **SVG** a partir de
`BoardNode.position` (mismo origen que el audio posicional): anillo, radios,
sedes con el color de su categoría y su nombre, y las fichas de los jugadores
(inicial + color; la propia resaltada, la del turno con halo; las que comparten
casilla se reparten alrededor del punto). Es **complemento para quien ve** y se
marca `aria-hidden`: la misma información llega al lector por los anuncios, la
lista de jugadores y las consultas.

`client/dice_view.ts` enseña la **última tirada** como una cara de dado con sus
puntos y el nombre de quien la ha hecho. El volteo dura lo que el sonido del
dado, así que lo que se ve y lo que se oye acaban a la vez, y se salta entero si
quien mira pidió `prefers-reduced-motion`. También va `aria-hidden`: el resultado
ya llega al lector por el anuncio de la tirada.

Al elegir dirección, las casillas destino se marcan en el dibujo y se pueden
**pulsar** (`setMoveTargets`), lo que envía el mismo `move` que su botón de
texto. Es un atajo de ratón, nunca la única vía: el SVG sigue `aria-hidden` y
fuera del tabulador, así que para el lector no existe. Regla para lo que venga:
todo lo que se pueda hacer en el dibujo tiene que poder hacerse también con los
mandos de texto.

## Contrarreloj

Modo **en solitario** que se desbloquea con el logro `contrarreloj` (3 partidas
jugadas). Vive en `server/time_attack.ts`, **fuera de `Room`**: no comparte nada
con la partida de mesa salvo el banco de preguntas y el perfil, y meterlo en la
sala habría obligado a que cada regla del tablero preguntara antes "¿y si es
contrarreloj?". La sesión es de la **conexión**, no de la sala: se puede jugar
mientras la mesa está en el vestíbulo, y muere al cerrarse el socket.

Reglas: 3 minutos, preguntas encadenadas de categoría al azar. Cada acierto suma
un punto; cada fallo **descuenta 10 segundos** en vez de terminar la partida (un
fallo tonto no debe echarte, pero tiene que doler). La marca se guarda en
`stats.timeAttackBest` y solo sube. Los aciertos cuentan como cualquier otro para
el resto de estadísticas y logros, así que aquí también se desbloquean packs.

El desbloqueo se comprueba **en el servidor** (`canPlayTimeAttack`), no solo al
pintar el botón.

Accesibilidad del reloj: un número que baja en pantalla no sirve a quien juega
oyendo. El tiempo se avisa por voz solo en tres momentos (un minuto, 30 s, 10 s),
hay un botón para preguntarlo cuando se quiera, y el resto del rato hay silencio
para no pisar la lectura de la pregunta. Cada pregunta se lee entera con sus
opciones: aquí no hay tablero ni turnos que den contexto.

### El aviso del rebote

`public/sounds/rebound.ogg` es el único sonido propio del juego: dos notas
ascendentes (700 Hz y 1046 Hz) con caída exponencial, sintetizadas con ffmpeg.
Sube de tono porque anuncia una carrera, y dura medio segundo para no pisar al
lector de pantalla, que habla justo detrás. Receta para regenerarlo:

```sh
ffmpeg -y \
 -f lavfi -i "aevalsrc='0.85*(sin(2*PI*700*t)+0.3*sin(2*PI*1400*t))*exp(-16*t)':d=0.13:s=48000" \
 -f lavfi -i "aevalsrc='0.9*(sin(2*PI*1046*t)+0.35*sin(2*PI*2092*t)+0.12*sin(2*PI*3138*t))*exp(-6.5*t)':d=0.40:s=48000" \
 -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[c];[c]aformat=channel_layouts=stereo[out]" \
 -map "[out]" -af "volume=0.8dB" -c:a libvorbis -q:a 5 public/sounds/rebound.ogg
```

El `volume=0.8dB` deja el pico en −1,5 dBFS, que es como están nivelados los
demás sonidos cortos.

## Manual (pantalla de ayuda)

`client/help.ts` + la sección `#help-screen` de `index.html`. El **contenido es
HTML estático y semántico** (encabezados y listas), no generado en JS: así el
lector de pantalla lo recorre con su navegación por encabezados sin que haya que
construir ninguna estructura ARIA. El módulo solo abre, cierra y gestiona el
foco.

Se abre con el botón «Cómo se juega», presente en el vestíbulo y en la partida, y
tapa la pantalla que hubiera (guardándola para restaurarla al cerrar). Al abrir,
el foco va al título (`tabindex="-1"`) para leer desde el principio; al cerrar,
vuelve al botón que la abrió. Cierra con «Volver» (hay uno arriba y otro abajo,
para no recorrer todo el texto) o con `Escape`.

Mientras está abierta, los atajos de una letra (B/R/Q/L) se ignoran: el manual
los menciona como texto y no deben lanzar consultas al leerlos.

## Bandos: individual y por equipos

La ficha y los quesos pertenecen a un **bando**, no a una persona. En modo
individual hay un bando por jugador; en modo por equipos, uno por equipo. Esto da
**una sola ruta de código** para ambos modos, sin duplicar las reglas.

- El **modo lo fija quien crea la sala** (el primero que entra, `hostId`) y no se
  mezcla: o todos individuales o todos en equipos. Mezclar daría partidas
  desequilibradas y complicaría cada regla con casos especiales.
- Hasta `MAX_TEAMS` (4) equipos. En modo por equipos, `start()` exige que todos
  hayan elegido: nadie se queda fuera por descuido.
- Dentro de un equipo, los miembros **rotan** al responder
  (`activeMemberIndex`): cada turno del equipo contesta uno distinto, así juegan
  todos y con lector se sabe a quién le toca.
- Si el miembro de turno se cae, `actingPlayer()` pasa al siguiente conectado:
  la ausencia de uno no bloquea al equipo. Solo se cede el turno si el bando
  entero se queda sin nadie conectado.
- Estadísticas y logros son **de la persona** que responde; la victoria la suman
  todos los miembros del bando ganador.

## Bots

El servidor es la autoridad, así que un **bot es un jugador que el propio
servidor conduce**. En el vestíbulo se añaden/quitan (`addBot`/`removeBot`, solo
antes de empezar). Cada bot es un `InternalPlayer` con `isBot` y `difficulty`,
sin socket ni perfil (no acumula estadísticas ni logros).

- **Decisiones** en `server/bot.ts` (puras y testeables): a qué dirección mover
  (prioriza coger un queso que falta, si no se acerca a la sede que falta más
  cercana, y va al centro con los seis), qué responder (acierta con probabilidad
  `botAccuracy(difficulty)` — fácil 0.4, normal 0.65, difícil 0.9) y qué
  categoría elegir en la pregunta final.
- **Ritmo:** la sala programa la acción del bot con un retardo (`Scheduler`
  inyectable, `setTimeout` por defecto) para que la mesa pueda seguirlo. Cada
  estado ya asentado (`sync`) es un punto de decisión: si le toca a un bot, se
  programa. Se recalcula al dispararse, por si el estado cambió (una desconexión).
- **Presencia:** los bots no cuentan como personas (`hasConnectedHumans`), así
  que una sala que se queda solo con bots se recoge igual (y se descartan sus
  temporizadores con `dispose`).
- En la pregunta final, si todos los rivales son bots, elige un bot; si hay algún
  rival humano, se le deja elegir a él.

## Pendiente / ideas

- Juego fuera de la LAN (abrir puerto / túnel), más packs.

## Fuera de alcance por ahora

- Juego fuera de la LAN.

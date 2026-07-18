# Trivial accesible

Juego de trivial estilo *Pursuit* (rueda, radios, quesos, dado), **accesible con
lectores de pantalla** y jugable también por personas que ven. Multijugador en red
local: cada jugador desde su PC entra a la misma sala por el navegador. Con sonidos
para el dado, el movimiento de la ficha, los quesos y los aciertos.

Diseño completo en [`docs/DISENO.md`](docs/DISENO.md).

## Requisitos

- **Node.js 20 o superior** (incluye `npm`).

## Puesta en marcha

```bash
npm install          # instala dependencias
npm run dev          # compila el cliente y arranca el servidor
```

Al arrancar, la consola imprime las direcciones de acceso, por ejemplo:

```
Abre en este equipo:  http://localhost:3000
Desde la red local:   http://192.168.1.50:3000
```

- **Tú:** abre `http://localhost:3000`.
- **Otra persona en tu misma red (WiFi/cable):** que abra en su navegador la
  dirección `http://TU-IP-LOCAL:3000` (la que imprime la consola como «Desde la red
  local»). No necesita instalar nada.

Para jugar juntos, ambos escribís **el mismo código de sala** (por ejemplo `CASA`)
y vuestro nombre. El primero que pulse «Empezar partida» arranca la ronda.

En el vestíbulo puedes **añadir bots** (fácil, normal o difícil) para rellenar
mesa o jugar en solitario: el servidor los conduce (tiran, se mueven y responden
solos, a un ritmo seguible). La dificultad marca su probabilidad de acertar.

### Jugar por internet (fuera de tu red)

Sin desplegar nada en ningún servidor: tu PC sigue siendo el servidor y un **túnel**
le da una URL pública temporal. Se usa [`cloudflared`](https://github.com/cloudflare/cloudflared)
(gratis, sin registro para el modo rápido):

```bash
winget install Cloudflare.cloudflared   # instalar una sola vez
```

Después, cada vez que quieras jugar por internet, con el servidor ya levantado
(`npm run dev`), en **otra terminal**:

```bash
npm run tunnel
```

Imprime una URL tipo `https://algo-random.trycloudflare.com` y **la copia al
portapapeles** (solo tienes que pegarla con `Ctrl+V` a quien vaya a jugar; que la
abra en su navegador y entre con el mismo código de sala que tú). La salida es
limpia y sin adornos, pensada para leerse con lector de pantalla. Tú sigues
entrando por `http://localhost:3000`. Al cerrar el túnel (Ctrl+C) la URL
desaparece.

**Ten en cuenta:**

- Tu PC debe estar encendido y con el servidor corriendo mientras juguéis.
- No hay login: cualquiera con la URL puede entrar. La URL es aleatoria e
  imposible de adivinar, pero **compártela solo con quien quieras**.
- En el modo rápido la URL cambia cada vez que arrancas el túnel.

### Otros comandos

```bash
npm run watch:client   # recompila el cliente al guardar (en otra terminal)
npm run typecheck      # comprobación de tipos (tsc)
npm test               # tests del tablero y del motor
```

## Cómo se juega

- Todas las fichas empiezan en el centro. En tu turno **tiras el dado** y avanzas.
- En los cruces eliges dirección; los tramos sin desvío se recorren solos.
- Al caer en una casilla respondes una **pregunta** de su categoría (opción
  múltiple). Si aciertas, vuelves a tirar; si fallas, pasa el turno.
- Acertar en una **sede** de categoría te da su **queso**.
- Con los 6 quesos, vuelve al centro: **tus rivales eligen la categoría** de la
  pregunta final (para ponértelo difícil) y, si aciertas, **ganas**.
- La pregunta la ve **toda la mesa**, pero solo contesta quien tiene el turno. Al
  fallar se revela la respuesta correcta.
- Dentro de una partida **no se repite ninguna pregunta**, se acierte o no. Cada
  partida nueva empieza con el montón entero.

### Teclas

Durante la partida hay cuatro **botones de consulta** siempre disponibles —«Dónde
tengo cada sede», «Dónde están los rivales», «Mis quesos» y «Mis logros»— que
anuncian tu situación por el lector. Son botones (y no atajos de una tecla) a propósito: los lectores de
pantalla en modo exploración capturan las teclas sueltas como navegación rápida,
así que un atajo de una letra nunca les llegaría. Activar un botón sí funciona.

| Tecla | Acción |
|-------|--------|
| `Tab` / `Mayús+Tab` | Moverse entre los mandos |
| `Intro` / `Espacio` | Activar el mando o botón enfocado |
| `B` · `R` · `Q` · `L` | Sedes · rivales · quesos · logros (**vía secundaria**: solo con el lector en modo foco o sin lector) |

El foco salta solo al mando principal cuando te toca actuar (tirar, elegir
dirección o responder).

### Saber hacia dónde moverte sin ver el tablero

Quien ve la rueda cuenta las casillas de un vistazo y sabe dónde va a caer. Para
que esa información no se pierda, **cada dirección dice adónde te lleva**:

> «Radio de Geografía. Caes en: Sede de Geografía. ¡Queso que te falta!»
>
> «Casilla de Historia. Llegas a Sede de Historia y eliges de nuevo con 2 pasos.»

Es decir: la casilla de al lado, dónde acabarás con los pasos que te quedan y si
allí hay algo que te interese (un queso que te falta, la pregunta final, o una
casilla libre). Cuando el camino se bifurca antes de gastar los pasos, se dice —
en vez de prometer un destino que no está decidido.

La tecla `B` completa el mapa mental: te sitúa y te da la distancia a cada sede
que te falta, de más cerca a más lejos. Tiene en cuenta el atajo por el centro
(cruzar la rueda son 8 casillas, frente a 21 dando la vuelta por el anillo).

## Estructura

```
shared/        Tipos, tablero (grafo de la rueda), protocolo y categorías (cliente+servidor)
server/        Servidor HTTP + WebSocket, salas, reglas del juego, banco de preguntas
client/        Interfaz accesible (DOM), tablero visual (SVG), audio (Web Audio) y red
content/       Preguntas, packs temáticos y logros, en JSON autorable
public/        HTML, estilos, cliente compilado (app.js) y sonidos
public/sounds/ Muestras de audio (dado, pasos, acierto, queso, logro, victoria…)
docs/          Documento de diseño
```

### Sonidos

El cliente reproduce muestras `.ogg` desde `public/sounds/` con la Web Audio API.
El **paso de la ficha es posicional** (`PannerNode` con HRTF, oyente en el centro
de la rueda): al moverse, el sonido orbita a tu alrededor si recorres el anillo, o
se acerca y aleja si entras o sales del centro — y como suena para el movimiento
de todos, también oyes por dónde van los rivales. Es refuerzo, no el canal
principal: cada sonido tiene su anuncio de texto equivalente y el juego funciona
igual sin audio (si una muestra falta o el navegador no la decodifica, no suena).

Las muestras están **niveladas** para que ninguna retumbe ni desaparezca: los
sonidos con cuerpo se normalizaron por loudness a ~-17 LUFS (ffmpeg `loudnorm`) y
los muy cortos por pico a -1,5 dBFS. Si añades o sustituyes un sonido, conviene
nivelarlo igual.

> ⚠️ **Procedencia y licencia.** Las muestras incluidas provienen de la
> plataforma de audiojuegos **PlayPalace** y se usan aquí de forma provisional.
> Antes de distribuir el juego públicamente hay que **verificar su licencia** o
> sustituirlas por sonidos propios o de una biblioteca libre (p. ej. CC0). Para
> cambiar un sonido, reemplaza el fichero en `public/sounds/` (mismos nombres) —
> ver el mapa evento→fichero en `client/audio.ts`.

## Logros y packs temáticos

Tu progreso se guarda entre partidas (aciertos, quesos, rachas, victorias). Al
alcanzar ciertas metas consigues **logros**, y algunos desbloquean **packs
temáticos** de preguntas:

| Pack | Se desbloquea con |
|------|-------------------|
| Harry Potter | **Ratón de biblioteca** — 10 aciertos de Arte y Literatura |
| Disney | **Cinéfilo** — 10 aciertos de Cultura y Tecnología |
| Camarón de la Isla | **Duende** — gana tu primera partida |
| Star Wars | **Trotamundos** — 10 aciertos de Geografía |
| El Señor de los Anillos | **Aventurero** — gana 3 partidas |
| Los Simpson | **Maratoniano** — juega 10 partidas |
| Videojuegos clásicos | **Reflejos** — 8 aciertos seguidos en una partida |
| La Rueda del Tiempo | **Erudito** — 100 aciertos en total |
| Tiflotecnología | **Científico** — 10 aciertos de Ciencia y Naturaleza |
| Dibujos de nuestra infancia | **Historiador** — 10 aciertos de Historia |

Las preguntas de un pack están repartidas entre las 6 categorías (como las
ediciones temáticas del Trivial de mesa), así que el tablero no cambia: al
activarlo, sus preguntas se suman a las normales.

Los packs se activan **en el vestíbulo**, antes de empezar. Basta con que **una
persona de la sala** lo tenga desbloqueado para traerlo a la mesa: se juega con
él para todos. Pulsa `L` para oír tus logros y lo que te falta.

Tu identidad se guarda en el navegador, así que el progreso es por navegador y
equipo. Las estadísticas viven en el servidor (`data/profiles.json`).

### Añadir logros y packs

Ambos son JSON en `content/` (`achievements.json` y `packs/*.json`), sin tocar
código. Un logro se mide contra una estadística y un umbral:

```json
{ "id": "quesero", "name": "Quesero", "description": "Gana 10 quesos en total.",
  "stat": "wedgesEarned", "atLeast": 10 }
```

Estadísticas disponibles: `gamesPlayed`, `gamesWon`, `wedgesEarned`,
`questionsAnswered`, `questionsCorrect`, `bestStreak` y `correct.<categoría>`
(por ejemplo `correct.ciencia`). Un pack añade `unlockedBy` con el id del logro
que lo desbloquea, más sus `questions` en el mismo formato que el banco base.

## Estado

Fases 1 y 2 completas: salas en LAN, tablero, dado, movimiento por teclado, **120
preguntas base** (20 por categoría), quesos y victoria; perfiles persistentes,
logros y packs temáticos (Harry Potter, Disney, Camarón de la Isla). Todo con
accesibilidad y sonidos. Pendiente: bots e internet (fase 3), tablero visual y
que los rivales elijan la categoría de la pregunta final. Ver `docs/DISENO.md`.

### Añadir preguntas

Se editan en `content/questions.base.json` (no hace falta recompilar el servidor,
solo reiniciarlo). Formato:

```json
{
  "id": "geo-021",
  "category": "geografia",
  "text": "¿Cuál es la capital de Portugal?",
  "options": ["Oporto", "Lisboa", "Braga", "Coímbra"],
  "answerIndex": 1,
  "difficulty": 1
}
```

`answerIndex` es la posición (empezando en 0) de la opción correcta; el juego
baraja las opciones al plantear la pregunta. Categorías válidas: `geografia`,
`historia`, `arte`, `ciencia`, `deportes`, `cultura`. Ejecuta `npm test` después
de tocar el banco: valida ids únicos, opciones y respuestas.

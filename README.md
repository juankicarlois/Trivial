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

> Para que juegue alguien **fuera** de tu red harían falta pasos extra (abrir puerto
> del router o un túnel tipo tailscale/ngrok). Es una fase posterior.

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
- Con los 6 quesos, vuelve al centro y acierta la pregunta final para **ganar**.
- La pregunta la ve **toda la mesa**, pero solo contesta quien tiene el turno. Al
  fallar se revela la respuesta correcta.

### Teclas

| Tecla | Acción |
|-------|--------|
| `Q`   | Anuncia tus quesos (cuáles tienes y cuáles te faltan), en cualquier momento |
| `L`   | Anuncia tus logros y cuál tienes más a mano |
| `Tab` / `Mayús+Tab` | Moverse entre los mandos |
| `Intro` / `Espacio` | Activar el mando enfocado |

El foco salta solo al mando principal cuando te toca actuar (tirar, elegir
dirección o responder). También tienes tus quesos siempre visibles en el panel
«Tus quesos».

## Estructura

```
shared/    Tipos, tablero (grafo de la rueda), protocolo y categorías (cliente+servidor)
server/    Servidor HTTP + WebSocket, salas, reglas del juego, banco de preguntas
client/    Interfaz accesible (DOM), audio (Web Audio) y red
content/   Preguntas y (futuro) packs temáticos y logros, en JSON autorable
public/    HTML, estilos y cliente compilado (app.js)
docs/      Documento de diseño
```

## Logros y packs temáticos

Tu progreso se guarda entre partidas (aciertos, quesos, rachas, victorias). Al
alcanzar ciertas metas consigues **logros**, y algunos desbloquean **packs
temáticos** de preguntas:

| Pack | Se desbloquea con |
|------|-------------------|
| Harry Potter | **Ratón de biblioteca** — 10 aciertos de Arte y Literatura |
| Disney | **Cinéfilo** — 10 aciertos de Cultura y Tecnología |
| Camarón de la Isla | **Duende** — gana tu primera partida |

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

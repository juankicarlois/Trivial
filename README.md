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

## Estado

MVP en construcción (fase 1): salas en LAN, tablero, dado, movimiento por teclado,
preguntas base, quesos y victoria, con accesibilidad y sonidos. Pendiente: perfiles
+ logros + packs temáticos (fase 2); bots e internet (fase 3). Ver `docs/DISENO.md`.

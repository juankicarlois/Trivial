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

## Logros → packs temáticos

- Se rastrean estadísticas por perfil (aciertos por categoría, partidas jugadas/
  ganadas, rachas, queseras completas).
- Cada **pack temático** (Harry Potter, Disney, Camarón de la Isla…) es un JSON con
  sus preguntas + una **condición de desbloqueo** basada en logros.
- Al desbloquear un pack, sus preguntas entran en el repertorio (como categoría
  extra o modo temático).

## Fases

- **Fase 1 (MVP jugable):** salas en LAN, tablero+dado+movimiento por teclado,
  preguntas base desde JSON, quesos, condición de victoria. Accesibilidad completa
  + sonidos básicos.
- **Fase 2:** perfiles + logros + desbloqueo de packs temáticos.
- **Fase 3:** bots IA con dificultad; juego por internet (abrir puerto / túnel);
  más contenido y herramienta de autoría.

## Fuera de alcance por ahora

- Bots (fase 3).
- Juego fuera de la LAN (fase 3).

# Trivial accesible

Juego de trivial estilo *Pursuit* (rueda, radios, quesos, dado), **accesible con
lectores de pantalla** y jugable también por videntes. Multijugador en red local:
servidor Node + TypeScript con WebSocket (`server/`), cliente TypeScript + DOM plano
(`client/`), tipos y tablero compartidos (`shared/`), contenido en JSON (`content/`).
Diseño completo en `docs/DISENO.md`; puesta en marcha y controles en `README.md`.

Antes de dar algo por terminado, **verifícalo de verdad** (tests + prueba en el
navegador), no solo que compile — ver la skill `verification-before-completion`.

## graphify

Este proyecto tiene un grafo de conocimiento del código en `graphify-out/`
(comunidades y relaciones entre ficheros), generado por `graphify` a partir del
árbol de sintaxis (sin coste de API). Está fuera de git: se reconstruye en local.

Reglas:

- Para preguntas sobre el código, ejecuta primero `graphify query "<pregunta>"`
  cuando exista `graphify-out/graph.json`. Usa `graphify path "<A>" "<B>"` para
  relaciones y `graphify explain "<concepto>"` para un concepto concreto.
  Devuelven un subgrafo acotado, normalmente mucho más pequeño que
  `GRAPH_REPORT.md` o un grep en crudo.
- Usa `graphify affected "<X>"` para ver qué se ve afectado al tocar algo.
- Lee `graphify-out/GRAPH_REPORT.md` solo para una revisión amplia de la
  arquitectura o cuando query/path/explain no den contexto suficiente.
- **Después de modificar código, ejecuta `graphify update .`** para mantener el
  grafo al día (solo AST, sin coste de API).
- Cuando el usuario pida **traer cambios** (sync / `git pull`), ejecuta
  `graphify update .` después de **cada `git pull` que haya traído commits
  nuevos**, para que el grafo refleje el código recién traído. Si el pull no trae
  nada (`Already up to date`), no hace falta.

> La capa semántica (god nodes, `wiki/`, nombres de comunidades) requiere
> `graphify extract .`, que **usa un LLM y tiene coste**. No la ejecutes sin
> pedírselo al usuario.

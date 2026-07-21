/**
 * Tablero visual: dibuja la rueda como un SVG y coloca las fichas de los
 * jugadores. Es un complemento para quien ve; se marca `aria-hidden` porque la
 * misma información llega al lector por los anuncios, la lista de jugadores y las
 * consultas. Reutiliza la geometría de `BoardNode.position` (centro en el origen,
 * anillo a radio 1).
 */

import type { Board } from '../shared/board.js';
import { categoryById } from '../shared/categories.js';
import type { GameView } from '../shared/protocol.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Radio del anillo en unidades del viewBox. */
const RING_RADIUS = 100;
/** Colores de ficha, distintos entre sí; se reparten por orden de jugador. */
export const TOKEN_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#00b4b4'];

/** Color de la ficha del bando número `index` (se repite si hay muchos). */
export function tokenColor(index: number): string {
  return TOKEN_COLORS[index % TOKEN_COLORS.length];
}

/**
 * Marca de la ficha: el número en los equipos ("Equipo 2" → "2") y la inicial
 * cuando el bando es una persona.
 */
function tokenInitial(teamName: string): string {
  const equipo = teamName.match(/(\d+)/);
  if (equipo) return equipo[1];
  return (teamName.trim()[0] ?? '?').toUpperCase();
}

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export class BoardView {
  private readonly board: Board;
  private readonly tokenLayer: SVGGElement;
  private readonly targetLayer: SVGGElement;
  /** Ficha (`<g>`) de cada bando, reutilizada para animar su movimiento. */
  private readonly tokens = new Map<string, SVGGElement>();

  /**
   * @param container Elemento donde se inserta el SVG (se vacía y se rellena).
   * @param board Tablero, para las posiciones de las casillas.
   */
  constructor(container: HTMLElement, board: Board) {
    this.board = board;
    const root = svg('svg', {
      viewBox: '-135 -135 270 270',
      class: 'board-svg',
      'aria-hidden': 'true',
      role: 'presentation',
    });

    // Anillo exterior (pista).
    root.appendChild(svg('circle', { cx: 0, cy: 0, r: RING_RADIUS, class: 'board-ring' }));

    for (const node of Object.values(board.nodes)) {
      const px = node.position.x * RING_RADIUS;
      const py = -node.position.y * RING_RADIUS; // el eje Y del SVG crece hacia abajo

      if (node.kind === 'hub') {
        root.appendChild(svg('circle', { cx: px, cy: py, r: 10, class: 'board-hub' }));
        continue;
      }

      // Un solo trazo por radio (de la sede al centro) dibuja todo el radio, con
      // el color de su categoría: la rueda se lee de un vistazo (solo apoyo
      // visual; el lector nunca depende del color).
      if (node.kind === 'hq') {
        const spoke = svg('line', { x1: px, y1: py, x2: 0, y2: 0, class: 'board-spoke' });
        if (node.category) spoke.setAttribute('stroke', categoryById(node.category).color);
        root.appendChild(spoke);
      }

      const dot = svg('circle', {
        cx: px,
        cy: py,
        r: node.kind === 'hq' ? 8 : 5,
        class: node.kind === 'hq' ? 'board-hq' : 'board-node',
      });
      if (node.category) dot.setAttribute('fill', categoryById(node.category).color);
      root.appendChild(dot);

      // Nombre corto de la categoría junto a cada sede, por fuera del anillo.
      if (node.kind === 'hq' && node.category) {
        const label = svg('text', {
          x: node.position.x * RING_RADIUS * 1.26,
          y: -node.position.y * RING_RADIUS * 1.26,
          class: 'board-label',
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        });
        label.textContent = categoryById(node.category).name.split(' ')[0];
        root.appendChild(label);
      }
    }

    // Las fichas van en su propia capa, que se rehace en cada actualización.
    this.tokenLayer = svg('g', { class: 'board-tokens' });
    root.appendChild(this.tokenLayer);

    // Los destinos pulsables van encima de todo para que el clic no se lo coma
    // una ficha que esté en la misma casilla.
    this.targetLayer = svg('g', { class: 'board-targets' });
    root.appendChild(this.targetLayer);

    container.replaceChildren(root);
  }

  /**
   * @brief Redibuja las fichas, una por bando (jugador o equipo).
   * @param state Estado de la partida.
   * @param myId Id propio, para resaltar la ficha del bando en que juegas.
   *
   * Cada ficha es un `<g>` colocado con `transform: translate`, que se
   * **reutiliza** entre actualizaciones: así, al cambiar su posición, el CSS la
   * desliza a la casilla nueva en vez de saltar (se apaga con
   * `prefers-reduced-motion`). El contenido interior (color, inicial, halo) se
   * rehace en cada tick, que es barato y no corta la transición del `translate`.
   */
  update(state: GameView, myId: string | null): void {
    // Varias fichas pueden compartir casilla; se reparten alrededor del punto.
    const sameNode = new Map<string, string[]>();
    for (const team of state.teams) {
      const list = sameNode.get(team.nodeId) ?? [];
      list.push(team.id);
      sameNode.set(team.nodeId, list);
    }

    const currentTeamId = state.teams[state.currentTeamIndex]?.id;
    const anyMemberConnected = (memberIds: string[]) =>
      memberIds.some((id) => state.players.find((p) => p.id === id)?.connected);

    const vivos = new Set<string>();
    state.teams.forEach((team, index) => {
      const node = this.board.nodes[team.nodeId];
      if (!node) return;
      vivos.add(team.id);

      const group = sameNode.get(team.nodeId) ?? [team.id];
      const slot = group.indexOf(team.id);
      let px = node.position.x * RING_RADIUS;
      let py = -node.position.y * RING_RADIUS;
      if (group.length > 1) {
        const angle = (2 * Math.PI * slot) / group.length;
        px += 11 * Math.cos(angle);
        py += 11 * Math.sin(angle);
      }

      // Reutiliza el `<g>` del bando si ya existe: mover su transform lo desliza.
      let token = this.tokens.get(team.id);
      if (!token) {
        token = svg('g', {});
        this.tokenLayer.appendChild(token);
        this.tokens.set(team.id, token);
      }
      const isCurrent = team.id === currentTeamId;
      token.setAttribute('class', 'board-token' + (isCurrent ? ' current' : ''));
      token.setAttribute('transform', `translate(${px} ${py})`);

      // Contenido interior, dibujado en el origen local del grupo.
      token.replaceChildren();
      if (isCurrent) {
        token.appendChild(svg('circle', { cx: 0, cy: 0, r: 11, class: 'board-token-halo' }));
      }
      const dot = svg('circle', { cx: 0, cy: 0, r: 7.5, class: 'board-token-dot' });
      dot.setAttribute('fill', tokenColor(index));
      if (myId && team.memberIds.includes(myId)) dot.classList.add('me'); // tu bando
      if (!anyMemberConnected(team.memberIds)) dot.classList.add('offline');
      token.appendChild(dot);

      const initial = svg('text', {
        x: 0,
        y: 0,
        class: 'board-token-label',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      });
      initial.textContent = tokenInitial(team.name);
      token.appendChild(initial);
    });

    // Retira las fichas de bandos que ya no están (p. ej. al reiniciar partida).
    for (const [teamId, token] of this.tokens) {
      if (!vivos.has(teamId)) {
        token.remove();
        this.tokens.delete(teamId);
      }
    }
  }

  /**
   * @brief Marca en el dibujo las casillas a las que se puede mover y las hace
   *        pulsables.
   *
   * Es un atajo **solo para quien ve**: el SVG entero está `aria-hidden`, así que
   * ni aparece en el lector ni recibe el foco del tabulador. Los botones de texto
   * siguen siendo el camino completo — esto no añade ninguna acción que no esté
   * también ahí.
   *
   * @param nodeIds Casillas destino; lista vacía para quitar las marcas.
   * @param onPick Se llama con la casilla elegida al pulsarla.
   */
  setMoveTargets(nodeIds: readonly string[], onPick: (nodeId: string) => void): void {
    this.targetLayer.replaceChildren();

    for (const nodeId of nodeIds) {
      const node = this.board.nodes[nodeId];
      if (!node) continue;
      const px = node.position.x * RING_RADIUS;
      const py = -node.position.y * RING_RADIUS;

      // El círculo es más grande que la casilla: da margen de puntería, sobre
      // todo con el ratón o el dedo en pantallas pequeñas.
      const target = svg('circle', { cx: px, cy: py, r: 14, class: 'board-target' });
      target.addEventListener('click', () => onPick(nodeId));
      this.targetLayer.appendChild(target);
    }
  }
}

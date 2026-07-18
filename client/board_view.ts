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
const TOKEN_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#00b4b4'];

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

      // Un solo trazo por radio (de la sede al centro) dibuja todo el radio.
      if (node.kind === 'hq') {
        root.appendChild(svg('line', { x1: px, y1: py, x2: 0, y2: 0, class: 'board-spoke' }));
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

    container.replaceChildren(root);
  }

  /**
   * @brief Redibuja las fichas, una por bando (jugador o equipo).
   * @param state Estado de la partida.
   * @param myId Id propio, para resaltar la ficha del bando en que juegas.
   */
  update(state: GameView, myId: string | null): void {
    this.tokenLayer.replaceChildren();

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

    state.teams.forEach((team, index) => {
      const node = this.board.nodes[team.nodeId];
      if (!node) return;

      const group = sameNode.get(team.nodeId) ?? [team.id];
      const slot = group.indexOf(team.id);
      let px = node.position.x * RING_RADIUS;
      let py = -node.position.y * RING_RADIUS;
      if (group.length > 1) {
        const angle = (2 * Math.PI * slot) / group.length;
        px += 11 * Math.cos(angle);
        py += 11 * Math.sin(angle);
      }

      const isCurrent = team.id === currentTeamId;
      const token = svg('g', { class: 'board-token' + (isCurrent ? ' current' : '') });
      if (isCurrent) {
        token.appendChild(svg('circle', { cx: px, cy: py, r: 11, class: 'board-token-halo' }));
      }
      const dot = svg('circle', { cx: px, cy: py, r: 7.5, class: 'board-token-dot' });
      dot.setAttribute('fill', TOKEN_COLORS[index % TOKEN_COLORS.length]);
      if (myId && team.memberIds.includes(myId)) dot.classList.add('me'); // tu bando
      if (!anyMemberConnected(team.memberIds)) dot.classList.add('offline');
      token.appendChild(dot);

      const initial = svg('text', {
        x: px,
        y: py,
        class: 'board-token-label',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      });
      initial.textContent = tokenInitial(team.name);
      token.appendChild(initial);

      this.tokenLayer.appendChild(token);
    });
  }
}

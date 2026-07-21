/**
 * Orquestación del cliente: vestíbulo, render accesible de la partida, foco por
 * teclado y traducción de eventos del servidor a sonidos y anuncios para el
 * lector de pantalla.
 *
 * Principio de accesibilidad: el estado visible controla los mandos; los eventos
 * puntuales controlan los anuncios y sonidos. Nada del juego depende de ver el
 * tablero.
 */

import { buildBoard } from '../shared/board.js';
import { CATEGORIES, categoryById, type CategoryId } from '../shared/categories.js';
import { BOT_DIFFICULTIES, type BotDifficulty } from '../shared/bot.js';
import {
  MAX_TEAMS,
  type AchievementView,
  type GameEvent,
  type GameMode,
  type GameView,
  type PublicQuestion,
  type TeamView,
  type WildcardId,
} from '../shared/protocol.js';
import { SoundEngine } from './audio.js';
import { Net } from './net.js';
import { BoardView, tokenColor } from './board_view.js';
import { DiceView } from './dice_view.js';
import { TimeAttackScreen } from './time_attack.js';
import { HelpScreen } from './help.js';
import * as flavor from './flavor.js';
import { TIME_ATTACK_ACHIEVEMENT } from '../shared/progress.js';
import { loadProfileId } from './identity.js';
import {
  achievementsSummary,
  boardRadarSummary,
  describeDirection,
  rivalsSummary,
  wedgesSummary,
} from './narration.js';

const board = buildBoard();
const sound = new SoundEngine();

/**
 * Identidad persistente del jugador, para que las estadísticas y los logros
 * sobrevivan entre partidas aunque cambie de nombre. Ver `identity.ts`: no puede
 * usar `crypto.randomUUID()`, que no existe al servir por IP de la red local.
 */
const profileId = loadProfileId();

// --- Elementos del DOM ------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

const joinScreen = $('join-screen');
const gameScreen = $('game-screen');
const joinForm = $<HTMLFormElement>('join-form');
const roomInput = $<HTMLInputElement>('room-input');
const nameInput = $<HTMLInputElement>('name-input');
const joinError = $('join-error');
const roomLabel = $('room-label');
const announceRegion = $('announce');
const statusLine = $('status');
const myWedgesTitle = $('my-wedges-title');
const myWedgesList = $('my-wedges');
const wedgesWheel = $('my-wedges-wheel');
const playersTitle = $('players-title');
const playersList = $('players');
const boardPanel = $('board');
const dicePanel = $('dice');
const actions = $('actions');
const packsSection = $('packs-section');
const packsList = $('packs');
const achievementsTitle = $('achievements-title');
const achievementsList = $('achievements');

/** Manual del juego, superpuesto a la pantalla que hubiera. */
const help = new HelpScreen({
  help: $('help-screen'),
  others: [joinScreen, gameScreen, $('time-attack-screen')],
});
$<HTMLButtonElement>('btn-help-join').addEventListener('click', (ev) => help.show(ev.currentTarget as HTMLElement));
$<HTMLButtonElement>('btn-help-game').addEventListener('click', (ev) => help.show(ev.currentTarget as HTMLElement));

/** Tablero visual (rueda SVG); complemento para quien ve, oculto al lector. */
const boardView = new BoardView(boardPanel, board);

/** Dado visual; igual que el tablero, complemento para quien ve. */
const diceView = new DiceView(dicePanel);

/** Pantalla del contrarreloj (modo en solitario, al margen de la sala). */
const timeAttack = new TimeAttackScreen(
  $('time-attack-screen'),
  $('time-attack-status'),
  $('time-attack-actions'),
  {
    answer: (optionIndex) => net.send({ type: 'answerTimeAttack', optionIndex }),
    quit: () => net.send({ type: 'quitTimeAttack' }),
    announce: (text) => announce(text),
    sound: {
      correct: () => sound.correct(),
      wrong: () => sound.wrong(),
      turn: () => sound.turn(),
    },
  },
);

// --- Estado local -----------------------------------------------------------

/** Texto del botón de cada comodín. */
const WILDCARD_LABELS: Record<WildcardId, string> = {
  changeQuestion: 'Comodín: cambiar la pregunta',
  fiftyFifty: 'Comodín: cincuenta cincuenta',
};

let myId: string | null = null;
let roomCode = '';
let myName = '';
let lastState: GameView | null = null;
/** Logros propios con su progreso; solo el servidor los conoce. */
let myAchievements: AchievementView[] = [];
let lastActionKey = '';
/** Alterna un carácter invisible para forzar que el lector repita anuncios. */
let announceToggle = false;
/** Avisos acumulados de la ráfaga actual, pendientes de anunciarse juntos. */
let pendingAnnouncements: string[] = [];
let announceTimer: number | null = null;
/** Ventana de agrupación: cubre los mensajes de una acción sin notarse lento. */
const ANNOUNCE_BATCH_MS = 150;

// --- Red --------------------------------------------------------------------

const net = new Net({
  onOpen: () => {
    // Al (re)conectar, si ya elegimos sala y nombre, nos (re)unimos.
    if (roomCode && myName) net.send({ type: 'join', roomCode, name: myName, profileId });
  },
  onMessage: (message) => {
    switch (message.type) {
      case 'joined':
        myId = message.playerId;
        showGameScreen();
        break;
      case 'state':
        lastState = message.state;
        render(message.state);
        break;
      case 'profile':
        myAchievements = message.achievements;
        renderAchievements();
        // El progreso llega después del estado, y de él depende si se ofrece el
        // contrarreloj: sin repintar, el acceso no aparecería hasta el siguiente
        // cambio de estado.
        if (lastState) renderActions(lastState);
        break;
      case 'event':
        handleEvent(message.event);
        break;
      case 'timeAttack':
        timeAttack.update(message.view);
        // La sala sigue viva por debajo: al acabar hay que volver a verla.
        gameScreen.hidden = timeAttack.active;
        break;
      case 'timeAttackResult':
        timeAttack.finish(message.result);
        gameScreen.hidden = false;
        renderActions(lastState!);
        break;
      case 'error':
        showError(message.message);
        break;
    }
  },
  onClose: () => {
    const message = 'Conexión perdida. Reintentando…';
    // En el vestíbulo no hay región de anuncios a la vista: se dice en el hueco
    // de error del formulario, o el jugador se queda sin saber qué pasa.
    if (gameScreen.hidden) joinError.textContent = message;
    else announce(message);
  },
});
net.connect();

// --- Vestíbulo --------------------------------------------------------------

joinForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const code = roomInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  if (!code || !name) {
    showError('Escribe un código de sala y tu nombre.');
    return;
  }
  roomCode = code;
  myName = name;
  sound.unlock(); // gesto de usuario: habilita el audio

  // Si todavía no hay conexión, `onOpen` reintentará la entrada con estos datos;
  // mientras tanto hay que decirlo, o el botón parece roto.
  if (!net.send({ type: 'join', roomCode, name, profileId })) {
    joinError.textContent = 'Conectando con el servidor… entrarás en cuanto haya conexión.';
  }
});

function showGameScreen(): void {
  joinScreen.hidden = true;
  gameScreen.hidden = false;
  roomLabel.textContent = roomCode;
}

function showError(message: string): void {
  if (!gameScreen.hidden) {
    announce(message);
  } else {
    joinError.textContent = message;
  }
}

// --- Anuncios ---------------------------------------------------------------

/**
 * @brief Encola un aviso para que el lector de pantalla lo pronuncie.
 *
 * Una sola acción genera varios avisos casi a la vez (por ejemplo: responder →
 * "incorrecto, la respuesta era X" → "turno de Bea"). Si cada uno se escribiera
 * directamente en la región aria-live, el siguiente pisaría al anterior y el
 * jugador se perdería la mitad. Por eso los avisos de una misma ráfaga se
 * agrupan y se anuncian juntos, en orden, como una sola frase.
 */
function announce(text: string): void {
  pendingAnnouncements.push(text);
  if (announceTimer !== null) return;
  announceTimer = window.setTimeout(flushAnnouncements, ANNOUNCE_BATCH_MS);
}

function flushAnnouncements(): void {
  announceTimer = null;
  const text = pendingAnnouncements.join(' ');
  pendingAnnouncements = [];
  // El carácter invisible alterna el contenido: si el texto fuese idéntico al
  // anterior, el lector no lo repetiría.
  announceToggle = !announceToggle;
  announceRegion.textContent = announceToggle ? text : text + '​';
}

function nameOf(playerId: string): string {
  return lastState?.players.find((p) => p.id === playerId)?.name ?? 'Alguien';
}

/** Bando por id (equipo, o el jugador si la partida es individual). */
function teamById(teamId: string): TeamView | undefined {
  return lastState?.teams.find((t) => t.id === teamId);
}

/** Nombre del bando: "Equipo 2" en equipos, el nombre del jugador en individual. */
function sideName(teamId: string): string {
  return teamById(teamId)?.name ?? 'Alguien';
}

/** true si juego en ese bando. */
function isMySide(teamId: string): boolean {
  return myId != null && (teamById(teamId)?.memberIds.includes(myId) ?? false);
}

/** El bando en el que juego, si la partida ha empezado. */
function myTeam(): TeamView | undefined {
  return myId == null ? undefined : lastState?.teams.find((t) => t.memberIds.includes(myId!));
}


// --- Eventos → sonido + anuncio ---------------------------------------------

function handleEvent(event: GameEvent): void {
  switch (event.kind) {
    case 'playerJoined':
      if (event.playerId !== myId) {
        sound.join();
        announce(`${event.name} se ha unido a la sala.`);
      }
      break;
    case 'gameStarted':
      sound.start();
      diceView.clear(); // la tirada de la partida anterior ya no viene a cuento
      announce(flavor.startLine());
      break;
    case 'diceRolled':
      sound.dice();
      diceView.show(event.value, nameOf(event.playerId));
      announce(flavor.diceLine(nameOf(event.playerId), event.value));
      break;
    case 'moved':
      {
        const pos = board.nodes[event.toNodeId]?.position;
        sound.move(pos?.x ?? 0, pos?.y ?? 0);
      }
      break;
    case 'landed': {
      const label = board.nodes[event.nodeId]?.label ?? 'una casilla';
      announce(flavor.landedLine(nameOf(event.playerId), label));
      break;
    }
    case 'answered':
      if (event.correct) {
        sound.correct();
        announce(flavor.correctLine(nameOf(event.playerId)));
      } else {
        // Al fallar se revela la respuesta buena: si no, la mesa se queda sin
        // saberla. Cuando la pregunta va a rebotar no viene (la cantaría a quien
        // puede quedársela): llega luego, por `answerRevealed`.
        sound.wrong();
        const fallo = flavor.wrongLine(nameOf(event.playerId));
        announce(event.correctText ? `${fallo} La respuesta era: ${event.correctText}.` : fallo);
      }
      break;
    case 'answerRevealed':
      announce(`La respuesta era: ${event.correctText}.`);
      break;
    case 'wildcardUsed':
      // Lo que cambia en pantalla (pregunta nueva, opciones descartadas) se lee
      // solo al repintar; aquí se cuenta el uso del comodín.
      if (event.wildcard === 'changeQuestion') {
        announce(
          event.playerId === myId
            ? 'Cambias la pregunta.'
            : `${nameOf(event.playerId)} cambia la pregunta.`,
        );
      } else if (event.wildcard === 'fiftyFifty') {
        // A quien lo usa se lo dice su propio repintado ("Cincuenta cincuenta.
        // Quedan…"); a los demás, que solo ven la pregunta entera, se les avisa.
        if (event.playerId !== myId) announce(`${nameOf(event.playerId)} usa el cincuenta cincuenta.`);
      }
      break;
    case 'wedgeEarned': {
      sound.wedge();
      const queso = categoryById(event.category).name;
      // En equipos se nombra al equipo (chispa) y aparte a quien lo consiguió;
      // en individual el bando ya es la persona, así que basta con su nombre.
      const base = flavor.wedgeLine(sideName(event.teamId), queso);
      announce(esPorEquipos() ? `${base} Lo consigue ${nameOf(event.playerId)}.` : base);
      break;
    }
    case 'allWedgesEarned':
      announce(
        isMySide(event.teamId)
          ? esPorEquipos()
            ? '¡Ya tenéis los seis quesos! Ahora volved al centro de la rueda: al caer justo en él os harán la pregunta final para ganar.'
            : '¡Ya tienes los seis quesos! Ahora vuelve al centro de la rueda: al caer justo en él te harán la pregunta final para ganar.'
          : `${sideName(event.teamId)} ya tiene los seis quesos y va camino del centro a por la victoria.`,
      );
      break;
    case 'turnLimitReached':
      announce(
        isMySide(event.teamId)
          ? esPorEquipos()
            ? `¡${event.limit} aciertos seguidos! Habéis llegado al tope del turno y cedéis la vez.`
            : `¡${event.limit} aciertos seguidos! Has llegado al tope del turno y cedes la vez.`
          : `${sideName(event.teamId)} encadena ${event.limit} aciertos y cede la vez.`,
      );
      break;
    case 'reboundOpened': {
      sound.rebound();
      // El aviso es lo que arranca la carrera: llega a la vez a toda la mesa, y
      // dice ya qué hacer, para no gastar segundos preguntándose cómo se pulsa.
      const puedo = !isMySide(event.failedTeamId);
      announce(
        puedo
          ? `¡Rebote! ${event.seconds} segundos para pulsar y quedarte la pregunta.`
          : `¡Rebote! Tus rivales pueden quedarse la pregunta durante ${event.seconds} segundos.`,
      );
      break;
    }
    case 'reboundClaimed':
      announce(
        event.playerId === myId
          ? '¡Has pulsado primero! La pregunta es tuya.'
          : `${nameOf(event.playerId)} pulsa primero y se queda la pregunta.`,
      );
      break;
    case 'reboundExpired':
      announce(flavor.reboundExpiredLine());
      break;
    case 'reboundWon':
      announce(
        isMySide(event.teamId)
          ? `¡Rebote ganado! Te quedas su casilla: ${board.nodes[event.nodeId]?.label ?? 'la casilla'}.`
          : `${sideName(event.teamId)} gana el rebote y se queda la casilla: ${board.nodes[event.nodeId]?.label ?? 'la casilla'}.`,
      );
      break;
    case 'turnChanged': {
      const meToca = event.playerId === myId;
      if (meToca) sound.turn(); // aviso sonoro de que te toca
      // Con los seis quesos se recuerda el objetivo en cada turno: sin el
      // tablero a la vista es fácil olvidar que ya solo falta llegar al centro.
      const equipo = teamById(event.teamId);
      const conTodos = equipo != null && equipo.wedges.length === CATEGORIES.length;
      // El recordatorio va en la persona que corresponda: a quien le toca se le
      // habla de tú (o de vosotros si juega en equipo) y del resto en tercera.
      const recuerdoPropio = esPorEquipos()
        ? ' Tenéis los seis quesos: id al centro.'
        : ' Tienes los seis quesos: ve al centro.';
      const recuerdoAjeno = esPorEquipos()
        ? ' Tienen los seis quesos: van al centro.'
        : ' Tiene los seis quesos: va al centro.';
      const recuerdo = conTodos ? (isMySide(event.teamId) ? recuerdoPropio : recuerdoAjeno) : '';
      if (meToca) {
        announce(`${flavor.yourTurnLine()}${recuerdo}`);
      } else if (esPorEquipos()) {
        announce(`Turno de ${sideName(event.teamId)}: responde ${nameOf(event.playerId)}.${recuerdo}`);
      } else {
        announce(`${flavor.theirTurnLine(nameOf(event.playerId))}${recuerdo}`);
      }
      break;
    }
    case 'gameWon':
      sound.win();
      announce(flavor.winLine(sideName(event.teamId)));
      break;
    case 'awaitingFinalCategory':
      announce(
        isMySide(event.teamId)
          ? esPorEquipos()
            ? '¡Tenéis los seis quesos y llegáis al centro! Vuestros rivales van a elegir la categoría de la pregunta final.'
            : '¡Tienes los seis quesos y llegas al centro! Tus rivales van a elegir la categoría de la pregunta final.'
          : `${sideName(event.teamId)} llega al centro con los seis quesos. Elegid la categoría de su pregunta final.`,
      );
      break;
    case 'finalCategoryChosen':
      announce(`${nameOf(event.byPlayerId)} elige ${categoryById(event.category).name} para la pregunta final.`);
      break;
    case 'achievementUnlocked':
      sound.achievement();
      announce(
        event.playerId === myId
          ? `¡Logro conseguido! ${event.name}. ${event.description}`
          : `${nameOf(event.playerId)} consigue el logro ${event.name}.`,
      );
      break;
    case 'packUnlocked':
      // Se dice cuándo podrá activarse: durante la partida la casilla está
      // apagada a propósito, y prometer "puedes activarlo" ahora confunde.
      announce(
        event.playerId === myId
          ? `¡Pack desbloqueado: ${event.packName}! Al acabar esta partida podrás activarlo para la siguiente.`
          : `${nameOf(event.playerId)} desbloquea el pack ${event.packName} para la mesa.`,
      );
      break;
  }
}

// --- Render -----------------------------------------------------------------

function render(state: GameView): void {
  renderStatus(state);
  renderMyWedges(state);
  renderPacks(state);
  renderPlayers(state);
  renderBoard(state);
  renderActions(state);
}

/**
 * Lista de packs temáticos con su casilla para activarlos. Un pack solo se
 * puede activar si alguien de la sala lo ha desbloqueado, y solo antes de
 * empezar (cambiar el repertorio a media partida sería injusto).
 *
 * Repintar la lista destruye las casillas, así que se devuelve el foco a la que
 * lo tenía: si no, al marcar un pack el foco saltaría al principio de la página
 * y quien navega por teclado se perdería.
 */
function renderPacks(state: GameView): void {
  packsSection.hidden = state.packs.length === 0;
  if (state.packs.length === 0) return;

  const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  const editable = state.phase === 'lobby' || state.phase === 'gameOver';
  packsList.replaceChildren();

  for (const pack of state.packs) {
    const li = document.createElement('li');
    li.className = 'pack' + (pack.unlocked ? '' : ' locked');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `pack-${pack.id}`;
    checkbox.checked = pack.enabled;
    checkbox.disabled = !pack.unlocked || !editable;
    checkbox.addEventListener('change', () => {
      net.send({ type: 'setPack', packId: pack.id, enabled: checkbox.checked });
    });

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = pack.name;

    const head = document.createElement('div');
    head.className = 'pack-head';
    head.append(checkbox, label);

    const desc = document.createElement('p');
    desc.className = 'pack-desc';
    if (!pack.unlocked) {
      desc.textContent = `Bloqueado. Se consigue con el logro «${pack.requires}».`;
    } else if (!editable) {
      // Desbloqueado pero con la partida en marcha: la casilla está apagada a
      // propósito (el repertorio no se cambia a mitad). Sin decirlo, parece rota.
      desc.textContent = `${pack.description} Desbloqueado: podrás activarlo al acabar esta partida.`;
    } else {
      desc.textContent = pack.description;
    }
    // El motivo también en el mando, para quien navega por casillas con lector.
    if (checkbox.disabled) {
      checkbox.setAttribute(
        'aria-describedby',
        `${checkbox.id}-motivo`,
      );
      desc.id = `${checkbox.id}-motivo`;
    }

    li.append(head, desc);
    packsList.append(li);
  }

  if (focusedId) document.getElementById(focusedId)?.focus();
}

/** Panel de logros propios, con el progreso de los que faltan. */
function renderAchievements(): void {
  const unlocked = myAchievements.filter((a) => a.unlocked).length;
  achievementsTitle.textContent = `Tus logros (${unlocked} de ${myAchievements.length})`;
  achievementsList.replaceChildren();

  for (const ach of myAchievements) {
    const li = document.createElement('li');
    li.className = 'achievement' + (ach.unlocked ? ' unlocked' : '');

    const name = document.createElement('span');
    name.className = 'ach-name';
    name.textContent = ach.name;

    const desc = document.createElement('span');
    desc.className = 'ach-desc';
    desc.textContent = ach.unlocked
      ? `Conseguido. ${ach.description}`
      : `${ach.description} Llevas ${Math.min(ach.progress, ach.target)} de ${ach.target}.`;

    li.append(name, desc);
    achievementsList.append(li);
  }
}

/**
 * Panel propio con los seis quesos y su estado. A diferencia de los puntos de
 * color de la lista de jugadores, aquí cada categoría se nombra en texto y se
 * dice si está conseguida o pendiente, de modo que se puede consultar en
 * cualquier momento sin depender de haber oído el aviso al ganarla.
 */
function renderMyWedges(state: GameView): void {
  const yo = myId;
  const team = yo == null ? undefined : state.teams.find((t) => t.memberIds.includes(yo));
  myWedgesList.replaceChildren();
  wedgesWheel.replaceChildren();
  if (!team) {
    myWedgesTitle.textContent = 'Tus quesos';
    return;
  }

  // En equipos los quesos son del equipo, no tuyos: el título lo deja claro.
  const titulo = state.mode === 'teams' ? `Quesos de ${team.name}` : 'Tus quesos';
  myWedgesTitle.textContent = `${titulo} (${team.wedges.length} de ${CATEGORIES.length})`;
  wedgesWheel.append(buildWedgeWheel(new Set(team.wedges)));

  for (const cat of CATEGORIES) {
    const earned = team.wedges.includes(cat.id);
    const li = document.createElement('li');
    li.className = 'my-wedge' + (earned ? ' earned' : '');
    li.style.setProperty('--cat-color', cat.color);

    const pip = document.createElement('span');
    pip.className = 'wedge-pip' + (earned ? '' : ' empty');
    pip.style.background = cat.color;
    pip.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = `${cat.name}: ${earned ? 'conseguido' : 'pendiente'}`;

    li.append(pip, label);
    myWedgesList.append(li);
  }
}


/**
 * Dibuja la rueda de quesos como un SVG: seis porciones, una por categoría en su
 * color, encendidas las conseguidas y apagadas las que faltan. Es **apoyo visual
 * y va `aria-hidden`**: la lista de debajo (`#my-wedges`) es la fuente accesible,
 * con cada categoría nombrada y su estado.
 *
 * @param earned Categorías cuyo queso ya se tiene.
 * @return Elemento SVG de la rueda.
 */
function buildWedgeWheel(earned: Set<CategoryId>): SVGSVGElement {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const cx = 60;
  const cy = 60;
  const r = 52;
  const wheel = document.createElementNS(SVG_NS, 'svg');
  wheel.setAttribute('viewBox', '0 0 120 120');
  wheel.setAttribute('class', 'wedge-wheel-svg');
  wheel.setAttribute('role', 'presentation');

  // Cada porción abarca 60°; se empieza arriba (-90°) para que la primera
  // categoría quede en lo alto, igual que las sedes del tablero.
  const punto = (grados: number): [number, number] => {
    const a = ((grados - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  CATEGORIES.forEach((cat, i) => {
    const [x0, y0] = punto(i * 60);
    const [x1, y1] = punto((i + 1) * 60);
    const slice = document.createElementNS(SVG_NS, 'path');
    slice.setAttribute(
      'd',
      `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`,
    );
    slice.setAttribute('fill', cat.color);
    slice.setAttribute('class', 'wedge-slice' + (earned.has(cat.id) ? ' earned' : ''));
    wheel.appendChild(slice);
  });

  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', String(cx));
  ring.setAttribute('cy', String(cy));
  ring.setAttribute('r', String(r));
  ring.setAttribute('class', 'wedge-wheel-ring');
  wheel.appendChild(ring);

  const hub = document.createElementNS(SVG_NS, 'circle');
  hub.setAttribute('cx', String(cx));
  hub.setAttribute('cy', String(cy));
  hub.setAttribute('r', '13');
  hub.setAttribute('class', 'wedge-wheel-hub');
  wheel.appendChild(hub);

  return wheel;
}

/** true si la partida se juega por equipos. */
function esPorEquipos(): boolean {
  return lastState?.mode === 'teams';
}

function renderStatus(state: GameView): void {
  const team = state.teams[state.currentTeamIndex];
  let text: string;
  switch (state.phase) {
    case 'lobby':
      text = `Sala ${state.roomCode}. ${state.players.length} jugador(es). ${
        state.mode === 'teams' ? 'Partida por equipos.' : 'Partida individual.'
      } Esperando para empezar.`;
      break;
    case 'gameOver':
      text = state.winnerTeamId
        ? `Fin de la partida. Gana ${state.teams.find((t) => t.id === state.winnerTeamId)?.name ?? ''}.`
        : 'Fin de la partida.';
      break;
    default: {
      if (!team) {
        text = 'Partida en curso.';
        break;
      }
      const acting = state.players.find((p) => p.id === state.actingPlayerId);
      if (state.actingPlayerId === myId) text = 'Turno de ti.';
      else if (state.mode === 'teams') text = `Turno de ${team.name}: responde ${acting?.name ?? ''}.`;
      else text = `Turno de ${team.name}.`;
      // Quien tiene los seis quesos ya va a por la victoria: se indica aquí para
      // que el objetivo esté siempre a la vista, no solo en el aviso del momento.
      if (team.wedges.length === CATEGORIES.length) {
        text += myId && team.memberIds.includes(myId)
          ? state.mode === 'teams'
            ? ' Tenéis los seis quesos: id al centro para la pregunta final.'
            : ' Tienes los seis quesos: ve al centro para la pregunta final.'
          : ' ¡Tiene los seis quesos y va a por la victoria!';
      }
    }
  }
  statusLine.textContent = text;
}

/**
 * En el vestíbulo se listan los jugadores (con su equipo y los mandos para
 * quitar bots); en partida, los bandos con su ficha y sus quesos, que es lo que
 * de verdad compite.
 */
function renderPlayers(state: GameView): void {
  playersList.replaceChildren();
  playersTitle.textContent =
    state.phase === 'lobby' ? 'Jugadores' : state.mode === 'teams' ? 'Equipos' : 'Jugadores';

  if (state.phase === 'lobby') {
    state.players.forEach((player, index) => {
      const li = document.createElement('li');
      li.className = 'player';
      li.append(avatarChip(player, index));

      const name = document.createElement('span');
      name.className = 'name';
      const botTag = player.isBot
        ? ` (bot${player.difficulty ? ', ' + difficultyLabel(player.difficulty) : ''})`
        : player.id === myId
          ? ' (tú)'
          : '';
      name.textContent = player.name + botTag;

      const meta = document.createElement('span');
      meta.className = 'meta';
      if (state.mode === 'teams') {
        meta.textContent = player.team ? `Equipo ${player.team}` : 'sin equipo';
      } else {
        meta.textContent = player.connected ? '' : 'desconectado';
      }

      li.append(name, meta);

      // Los bots se quitan, y en equipos también se les asigna equipo.
      if (player.isBot) {
        if (state.mode === 'teams') li.append(buildTeamPicker(player.id, player.team));
        const remove = button('Quitar', () => net.send({ type: 'removeBot', playerId: player.id }), 'secondary');
        remove.setAttribute('aria-label', `Quitar ${player.name}`);
        li.append(remove);
      }
      playersList.append(li);
    });
    return;
  }

  state.teams.forEach((team, index) => {
    const li = document.createElement('li');
    li.className = 'player' + (index === state.currentTeamIndex ? ' current' : '');
    li.append(avatarChip(team, index));

    const name = document.createElement('span');
    name.className = 'name';
    const mio = myId != null && team.memberIds.includes(myId);
    name.textContent = team.name + (mio ? ' (tú)' : '');

    const meta = document.createElement('span');
    meta.className = 'meta';
    const donde = board.nodes[team.nodeId]?.label ?? '';
    const quienes =
      state.mode === 'teams'
        ? ' · ' + team.memberIds.map((id) => nameOf(id)).join(', ')
        : '';
    meta.textContent = donde + quienes;

    li.append(name, meta, buildWedges(team.wedges));
    playersList.append(li);
  });
}

/**
 * Ficha visual (círculo con inicial) de un jugador o bando, solo para quien ve:
 * el mismo color que su ficha en el tablero, para reconocerlo de un vistazo. Va
 * `aria-hidden` porque el nombre ya está en texto justo al lado.
 *
 * @param who Jugador (vestíbulo) o bando (partida).
 * @param index Posición, que fija el color (igual que la ficha del tablero).
 * @return Elemento del avatar.
 */
function avatarChip(who: { name: string; isBot?: boolean }, index: number): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'player-avatar';
  chip.setAttribute('aria-hidden', 'true');
  chip.style.background = tokenColor(index);
  // Bots con un robotito; personas y equipos con su número o inicial.
  const numero = who.name.match(/(\d+)/);
  chip.textContent = who.isBot ? '🤖' : (numero ? numero[1] : (who.name.trim()[0] ?? '?').toUpperCase());
  return chip;
}

/**
 * Mandos del vestíbulo para el modo de juego. El modo lo fija **quien creó la
 * sala** (a los demás solo se les informa), y si es por equipos, cada cual elige
 * el suyo.
 */
function buildModeControls(state: GameView): HTMLElement {
  const wrap = document.createElement('div');
  const soyAnfitrion = state.hostId != null && state.hostId === myId;

  if (soyAnfitrion) {
    const row = document.createElement('div');
    row.className = 'action-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Modo de juego');
    const modos: { id: GameMode; label: string }[] = [
      { id: 'individual', label: 'Partida individual' },
      { id: 'teams', label: 'Partida por equipos' },
    ];
    for (const modo of modos) {
      const btn = button(modo.label, () => net.send({ type: 'setMode', mode: modo.id }), 'secondary');
      btn.id = `mode-${modo.id}`;
      if (state.mode === modo.id) btn.setAttribute('aria-pressed', 'true');
      row.append(btn);
    }
    wrap.append(row);
  } else {
    const info = document.createElement('p');
    info.className = 'hint';
    info.textContent =
      state.mode === 'teams'
        ? 'Partida por equipos (lo decide quien creó la sala).'
        : 'Partida individual (lo decide quien creó la sala).';
    wrap.append(info);
  }

  if (state.mode === 'teams') {
    const yo = state.players.find((p) => p.id === myId);
    const mine = document.createElement('p');
    mine.className = 'hint';
    mine.textContent = yo?.team ? `Estás en el equipo ${yo.team}. Elige tu equipo:` : 'Elige tu equipo:';
    const picker = buildTeamPicker(myId ?? '', yo?.team ?? null);
    wrap.append(mine, picker);
  }
  return wrap;
}

/** Botones para elegir equipo (1..MAX_TEAMS) de un jugador o bot. */
function buildTeamPicker(playerId: string, current: number | null): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'team-picker';
  for (let n = 1; n <= MAX_TEAMS; n++) {
    const btn = button(
      String(n),
      () =>
        net.send(
          playerId === myId
            ? { type: 'chooseTeam', team: n }
            : { type: 'setBotTeam', playerId, team: n },
        ),
      'secondary',
    );
    btn.setAttribute('aria-label', `Poner en el equipo ${n}`);
    if (current === n) btn.setAttribute('aria-pressed', 'true');
    wrap.append(btn);
  }
  return wrap;
}

/** Nombre de una dificultad de bot. */
function difficultyLabel(id: BotDifficulty): string {
  return BOT_DIFFICULTIES.find((d) => d.id === id)?.label ?? id;
}

/** Puntos de color por categoría, con etiqueta accesible del recuento. */
function buildWedges(earned: CategoryId[]): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'wedges';
  const names = earned.map((id) => categoryById(id).name);
  wrap.setAttribute(
    'aria-label',
    earned.length ? `Quesos (${earned.length} de 6): ${names.join(', ')}` : 'Sin quesos todavía',
  );
  for (const cat of CATEGORIES) {
    const pip = document.createElement('span');
    const has = earned.includes(cat.id);
    pip.className = 'wedge-pip' + (has ? '' : ' empty');
    pip.style.background = cat.color;
    pip.setAttribute('aria-hidden', 'true');
    wrap.append(pip);
  }
  // Recuento visible: seis puntos de color por sí solos cuestan de leer.
  const count = document.createElement('span');
  count.className = 'wedge-count';
  count.textContent = `${earned.length}/${CATEGORIES.length}`;
  count.setAttribute('aria-hidden', 'true');
  wrap.append(count);
  return wrap;
}

function renderBoard(state: GameView): void {
  boardView.update(state, myId);
}

/**
 * Añade el acceso al contrarreloj cuando el logro que lo abre está conseguido.
 * Solo aparece fuera de partida: empezarlo a media mesa dejaría a los demás
 * esperando a alguien que se ha ido a jugar solo.
 */
function appendTimeAttackButton(): void {
  const logro = myAchievements.find((a) => a.id === TIME_ATTACK_ACHIEVEMENT);
  if (!logro?.unlocked) return;
  const btn = button('Contrarreloj (en solitario)', () => net.send({ type: 'startTimeAttack' }), 'secondary');
  btn.id = 'start-time-attack';
  actions.append(btn);
}

// --- Acciones ---------------------------------------------------------------

function renderActions(state: GameView): void {
  // Repintar destruye los mandos: se recuerda cuál tenía el foco para devolvérselo
  // si el conjunto de acciones no cambia (p. ej. al añadir un bot en el vestíbulo).
  const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  actions.replaceChildren();
  // El acento de color por categoría (--cat-color) solo aplica a la pregunta; se
  // limpia en cada repintado para que no tiña otras fases.
  actions.style.removeProperty('--cat-color');
  // Los destinos pulsables del tablero acompañan a los botones de dirección:
  // se quitan aquí y solo se vuelven a poner si toca elegir camino.
  boardView.setMoveTargets([], () => {});
  // "Me toca" es ser el miembro de turno de mi bando; "es mi bando" basta para
  // saber si me afecta la pregunta final (la eligen los rivales del bando).
  const iAmActingNow = state.actingPlayerId != null && state.actingPlayerId === myId;
  const currentTeam = state.teams[state.currentTeamIndex];
  const myTeamPlays = currentTeam != null && myId != null && currentTeam.memberIds.includes(myId);
  let focusTarget: HTMLElement | null = null;

  if (state.phase === 'lobby') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Comparte el código de la sala. Añade bots para rellenar mesa o jugar en solitario. Cuando estéis todos, pulsa Empezar.';

    actions.append(hint, buildModeControls(state));

    const bots = document.createElement('div');
    bots.className = 'action-row';
    bots.setAttribute('role', 'group');
    bots.setAttribute('aria-label', 'Añadir bot');
    for (const diff of BOT_DIFFICULTIES) {
      const botBtn = button(`Añadir bot ${diff.label.toLowerCase()}`, () => net.send({ type: 'addBot', difficulty: diff.id }), 'secondary');
      botBtn.id = `add-bot-${diff.id}`; // id estable para devolver el foco al repintar
      bots.append(botBtn);
    }

    const startBtn = button('Empezar partida', () => net.send({ type: 'start' }));
    actions.append(bots, startBtn);
    appendTimeAttackButton();
    focusTarget = startBtn;
  } else if (state.phase === 'gameOver') {
    const again = button('Jugar otra vez', () => net.send({ type: 'start' }));
    actions.append(again);
    appendTimeAttackButton();
    focusTarget = again;
  } else if (state.phase === 'awaitAnswer' && state.question) {
    renderQuestion(state, iAmActingNow, (btn) => (focusTarget = btn));
  } else if (state.phase === 'awaitRebound' && state.question) {
    renderRebound(state, (btn) => (focusTarget = btn));
  } else if (state.phase === 'awaitFinalCategory') {
    // La categoría de la pregunta final la eligen los rivales, no el bando que va
    // a ganar: por eso este caso va antes del "esperando" genérico de no-turno.
    if (myTeamPlays) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = esPorEquipos()
        ? 'Tenéis los seis quesos. Vuestros rivales eligen la categoría de la pregunta final…'
        : 'Tienes los seis quesos. Tus rivales eligen la categoría de la pregunta final…';
      actions.append(hint);
    } else {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = `${currentTeam?.name ?? 'El líder'} va a por la victoria. Elige la categoría de su pregunta final:`;
      const opts = document.createElement('div');
      opts.className = 'options';
      CATEGORIES.forEach((cat, i) => {
        const btn = button(cat.name, () => net.send({ type: 'chooseFinalCategory', category: cat.id }));
        if (i === 0) focusTarget = btn;
        opts.append(btn);
      });
      actions.append(hint, opts);
    }
  } else if (!iAmActingNow) {
    const wait = document.createElement('p');
    wait.className = 'hint';
    const quien = state.players.find((p) => p.id === state.actingPlayerId)?.name ?? 'otro jugador';
    // Si juega tu equipo pero responde un compañero, conviene decirlo.
    wait.textContent = myTeamPlays
      ? `Juega tu equipo: responde ${quien}…`
      : `Esperando a ${quien}…`;
    actions.append(wait);
  } else if (state.phase === 'awaitRoll') {
    const rollBtn = button('Tirar el dado', () => net.send({ type: 'roll' }));
    actions.append(rollBtn);
    focusTarget = rollBtn;
  } else if (state.phase === 'moving' && state.movement) {
    const h = document.createElement('p');
    h.className = 'hint';
    h.textContent = `Te quedan ${state.movement.remaining} paso(s). Elige dirección:`;
    const row = document.createElement('div');
    row.className = 'action-row';
    const from = currentTeam?.nodeId ?? '';
    const steps = state.movement.remaining;
    state.movement.options.forEach((nodeId, i) => {
      const label = describeDirection(board, from, nodeId, steps, currentTeam?.wedges ?? []);
      const btn = button(label, () => net.send({ type: 'move', toNodeId: nodeId }), 'secondary');
      if (i === 0) focusTarget = btn;
      row.append(btn);
    });
    actions.append(h, row);
    // Mismo movimiento, pulsando la casilla en el dibujo: atajo para quien ve
    // (el SVG está aria-hidden y fuera del tabulador, así que no cambia nada
    // para el lector). Solo para quien tiene el turno.
    if (iAmActingNow) boardView.setMoveTargets(state.movement.options, (nodeId) => net.send({ type: 'move', toNodeId: nodeId }));
  }

  manageFocus(state, focusTarget, focusedId);
}

/**
 * Pinta la pregunta activa para **toda la mesa**, como en el juego de tablero:
 * los rivales la leen y la siguen, pero solo el jugador del turno puede
 * contestar (a los demás se les muestran las opciones sin botón).
 *
 * @param state Estado actual de la partida.
 * @param iAmCurrent true si el turno es de este cliente.
 * @param setFocus Callback para marcar el mando que debe recibir el foco.
 */
function renderQuestion(
  state: GameView,
  iAmCurrent: boolean,
  setFocus: (el: HTMLElement) => void,
): void {
  const q = state.question!;
  const category = categoryById(q.category);
  const cat = category.name;
  // Quien responde es el miembro de turno del bando (en individual, él mismo).
  const asker = state.players.find((p) => p.id === state.actingPlayerId)?.name ?? 'el jugador';
  const title = q.forWin ? 'Pregunta final' : cat;
  // Acento de color de la categoría, solo visual (el título ya la nombra).
  actions.style.setProperty('--cat-color', category.color);

  const heading = document.createElement('p');
  heading.className = 'question-text';
  heading.textContent = `${title}: ${q.text}`;
  actions.append(heading);

  if (iAmCurrent) {
    // El 50/50 solo lo aplica quien responde: si se ocultaran opciones a los
    // rivales y la pregunta rebotara, sabrían que la buena es una de dos.
    const eliminated = new Set(q.eliminatedOptions ?? []);
    const opts = document.createElement('div');
    opts.className = 'options';
    let first: HTMLElement | null = null;
    q.options.forEach((text, index) => {
      if (eliminated.has(index)) return; // descartada por el 50/50
      const btn = button(`${index + 1}. ${text}`, () => net.send({ type: 'answer', optionIndex: index }));
      if (!first) {
        first = btn;
        setFocus(btn);
      }
      opts.append(btn);
    });
    actions.append(opts);
    appendWildcards(state, q);
    // Con el 50/50 se dicen las opciones que quedan (dos): el descarte cambia el
    // panorama y conviene oírlo sin tener que recorrer los botones. Sin él, el
    // foco cae en la primera y el lector las recorre, así que repetirlas es ruido.
    if (eliminated.size > 0) {
      const quedan = q.options
        .map((text, index) => ({ text, index }))
        .filter(({ index }) => !eliminated.has(index))
        .map(({ text, index }) => `${index + 1}, ${text}`)
        .join('. ');
      announce(`Cincuenta cincuenta. Quedan: ${quedan}.`);
    } else {
      announce(`${q.forWin ? 'Pregunta final' : 'Pregunta de ' + cat} para ti: ${q.text}`);
    }
  } else {
    const list = document.createElement('ol');
    list.className = 'options-readonly';
    for (const text of q.options) {
      const li = document.createElement('li');
      li.textContent = text;
      list.append(li);
    }
    const wait = document.createElement('p');
    wait.className = 'hint';
    wait.textContent = `Responde ${asker}…`;
    actions.append(list, wait);
    // El rival no tiene mandos donde poner el foco: se le lee todo de una vez.
    const spoken = q.options.map((o, i) => `${i + 1}, ${o}`).join('. ');
    announce(`${q.forWin ? 'Pregunta final' : 'Pregunta de ' + cat} para ${asker}: ${q.text}. Opciones: ${spoken}`);
  }
}

/**
 * Añade los botones de comodín disponibles bajo las opciones de respuesta.
 * Solo salen los que te quedan por gastar, y nunca en la pregunta final (ahí no
 * valen). Van tras las respuestas para que el foco caiga primero en éstas.
 *
 * @param state Estado actual.
 * @param q Pregunta en juego (para no ofrecerlos en la final).
 */
function appendWildcards(state: GameView, q: PublicQuestion): void {
  if (q.forWin) return;
  const mine = state.players.find((p) => p.id === myId)?.wildcards ?? [];
  if (mine.length === 0) return;

  const row = document.createElement('div');
  row.className = 'action-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Comodines');
  for (const wildcard of mine) {
    const btn = button(WILDCARD_LABELS[wildcard], () => net.send({ type: 'useWildcard', wildcard }), 'secondary');
    row.append(btn);
  }
  actions.append(row);
}

/**
 * Pinta el rebote: mientras el pulsador está abierto, quien puede quedarse la
 * pregunta ve un botón grande; cuando alguien pulsa, la pregunta pasa a ser suya
 * y se pinta como cualquier otra.
 *
 * El botón recibe el foco al aparecer para que baste con **Intro** o **espacio**:
 * en una carrera de segundos, buscar el botón con el lector de pantalla sería
 * perder de salida.
 *
 * @param state Estado actual de la partida.
 * @param setFocus Callback para marcar el mando que debe recibir el foco.
 */
function renderRebound(state: GameView, setFocus: (el: HTMLElement) => void): void {
  // Ya hay dueño: responde él y el resto mira, como en una pregunta normal.
  if (state.actingPlayerId != null) {
    renderQuestion(state, state.actingPlayerId === myId, setFocus);
    return;
  }

  const q = state.question!;
  const category = categoryById(q.category);
  const puedoPulsar =
    myTeam() != null && (state.rebound?.eligibleTeamIds.includes(myTeam()!.id) ?? false);
  actions.style.setProperty('--cat-color', category.color);

  const heading = document.createElement('p');
  heading.className = 'question-text';
  heading.textContent = `Rebote — ${category.name}: ${q.text}`;
  actions.append(heading);

  const list = document.createElement('ol');
  list.className = 'options-readonly';
  for (const text of q.options) {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
  }
  actions.append(list);

  if (puedoPulsar) {
    const buzzer = button('¡Pulsar! Quedarme la pregunta', () => net.send({ type: 'buzz' }));
    buzzer.classList.add('buzzer');
    actions.append(buzzer);
    setFocus(buzzer);
  } else {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Tus rivales pueden pulsar para quedarse la pregunta…';
    actions.append(hint);
  }
}

/**
 * @brief Describe una dirección diciendo dónde acabarías si la tomas.
/**
 * Mueve el foco al mando principal solo cuando cambia el conjunto de acciones,
 * para no robar el foco en cada actualización de estado.
 */
function manageFocus(state: GameView, target: HTMLElement | null, previousFocusId: string): void {
  const key = [
    state.phase,
    state.mode,
    state.actingPlayerId ?? '',
    state.question?.id ?? '',
    // El 50/50 no cambia la pregunta pero sí las opciones: cuenta como acción
    // nueva para que el foco baje a la primera respuesta que queda.
    (state.question?.eliminatedOptions ?? []).join(','),
    state.movement?.options.join(',') ?? '',
    String(state.movement?.remaining ?? ''),
  ].join('|');
  if (key !== lastActionKey && target) {
    target.focus();
  } else if (key === lastActionKey && previousFocusId) {
    // Mismo conjunto de acciones (p. ej. se añadió un bot): devolver el foco al
    // mando que lo tenía, que el repintado ha destruido.
    document.getElementById(previousFocusId)?.focus();
  }
  lastActionKey = key;
}

// --- Consultas rápidas (situación, quesos, logros) --------------------------

/** Anuncia dónde tiene tu bando cada sede que le falta. */
function announceRadar(): void {
  const team = myTeam();
  announce(team ? boardRadarSummary(board, team) : 'Todavía no estás en una partida.');
}

/** Anuncia dónde está cada bando rival y cómo va. */
function announceRivals(): void {
  announce(
    lastState
      ? rivalsSummary(board, lastState.teams, myTeam()?.id ?? null)
      : 'Todavía no estás en una partida.',
  );
}

/** Anuncia los quesos de tu bando y los que le faltan. */
function announceWedges(): void {
  announce(wedgesSummary(myTeam()));
}

/** Anuncia tus logros y el que tienes más a mano. */
function announceAchievements(): void {
  announce(achievementsSummary(myAchievements));
}

// Botones de consulta: la vía principal. Funcionan con el lector en modo
// exploración, donde las teclas sueltas se las queda el propio lector.
$<HTMLButtonElement>('btn-radar').addEventListener('click', announceRadar);
$<HTMLButtonElement>('btn-rivals').addEventListener('click', announceRivals);
$<HTMLButtonElement>('btn-wedges').addEventListener('click', announceWedges);
$<HTMLButtonElement>('btn-achievements').addEventListener('click', announceAchievements);

/**
 * Atajos de teclado como vía secundaria: B situación, R rivales, Q quesos, L
 * logros. Solo llegan con el lector en modo foco o sin lector; en modo
 * exploración los intercepta el lector (por eso los botones de arriba son lo
 * principal). Se ignoran al escribir en un campo y con modificadores, para no
 * pisar nada.
 */
document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
  // En el manual estas letras aparecen como texto (menciona las teclas B, R…):
  // no deben lanzar consultas mientras se lee.
  if (help.open) return;

  const key = ev.key.toLowerCase();
  if (key === 'q') {
    ev.preventDefault();
    announceWedges();
  } else if (key === 'l') {
    ev.preventDefault();
    announceAchievements();
  } else if (key === 'b') {
    ev.preventDefault();
    announceRadar();
  } else if (key === 'r') {
    ev.preventDefault();
    announceRivals();
  }
});

function button(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (variant) btn.className = variant;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

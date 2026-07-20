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
  type TeamView,
} from '../shared/protocol.js';
import { SoundEngine } from './audio.js';
import { Net } from './net.js';
import { BoardView } from './board_view.js';
import { DiceView } from './dice_view.js';
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
const playersTitle = $('players-title');
const playersList = $('players');
const boardPanel = $('board');
const dicePanel = $('dice');
const actions = $('actions');
const packsSection = $('packs-section');
const packsList = $('packs');
const achievementsTitle = $('achievements-title');
const achievementsList = $('achievements');

/** Tablero visual (rueda SVG); complemento para quien ve, oculto al lector. */
const boardView = new BoardView(boardPanel, board);

/** Dado visual; igual que el tablero, complemento para quien ve. */
const diceView = new DiceView(dicePanel);

// --- Estado local -----------------------------------------------------------

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
        break;
      case 'event':
        handleEvent(message.event);
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
      announce('¡Empieza la partida!');
      break;
    case 'diceRolled':
      sound.dice();
      diceView.show(event.value, nameOf(event.playerId));
      announce(`${nameOf(event.playerId)} saca un ${event.value}.`);
      break;
    case 'moved':
      {
        const pos = board.nodes[event.toNodeId]?.position;
        sound.move(pos?.x ?? 0, pos?.y ?? 0);
      }
      break;
    case 'landed': {
      const label = board.nodes[event.nodeId]?.label ?? 'una casilla';
      announce(`${nameOf(event.playerId)} cae en ${label}.`);
      break;
    }
    case 'answered':
      if (event.correct) {
        sound.correct();
        announce(`${nameOf(event.playerId)} responde: ¡correcto!`);
      } else {
        // Al fallar se revela la respuesta buena: si no, la mesa se queda sin saberla.
        sound.wrong();
        announce(`${nameOf(event.playerId)} responde: incorrecto. La respuesta era: ${event.correctText}.`);
      }
      break;
    case 'wedgeEarned': {
      sound.wedge();
      const queso = categoryById(event.category).name;
      // En equipos se nombra al equipo y a quien lo consiguió; en individual
      // ambos son la misma persona, así que basta con el nombre.
      announce(
        esPorEquipos()
          ? `${sideName(event.teamId)} gana el queso de ${queso}, con ${nameOf(event.playerId)}.`
          : `${nameOf(event.playerId)} gana el queso de ${queso}.`,
      );
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
        announce(`Es tu turno.${recuerdo}`);
      } else if (esPorEquipos()) {
        announce(`Turno de ${sideName(event.teamId)}: responde ${nameOf(event.playerId)}.${recuerdo}`);
      } else {
        announce(`Turno de ${nameOf(event.playerId)}.${recuerdo}`);
      }
      break;
    }
    case 'gameWon':
      sound.win();
      announce(`¡${sideName(event.teamId)} gana la partida!`);
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
  if (!team) {
    myWedgesTitle.textContent = 'Tus quesos';
    return;
  }

  // En equipos los quesos son del equipo, no tuyos: el título lo deja claro.
  const titulo = state.mode === 'teams' ? `Quesos de ${team.name}` : 'Tus quesos';
  myWedgesTitle.textContent = `${titulo} (${team.wedges.length} de ${CATEGORIES.length})`;

  for (const cat of CATEGORIES) {
    const earned = team.wedges.includes(cat.id);
    const li = document.createElement('li');
    li.className = 'my-wedge' + (earned ? ' earned' : '');

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
    for (const player of state.players) {
      const li = document.createElement('li');
      li.className = 'player';

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
    }
    return;
  }

  state.teams.forEach((team, index) => {
    const li = document.createElement('li');
    li.className = 'player' + (index === state.currentTeamIndex ? ' current' : '');

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

// --- Acciones ---------------------------------------------------------------

function renderActions(state: GameView): void {
  // Repintar destruye los mandos: se recuerda cuál tenía el foco para devolvérselo
  // si el conjunto de acciones no cambia (p. ej. al añadir un bot en el vestíbulo).
  const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  actions.replaceChildren();
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
    focusTarget = startBtn;
  } else if (state.phase === 'gameOver') {
    const again = button('Jugar otra vez', () => net.send({ type: 'start' }));
    actions.append(again);
    focusTarget = again;
  } else if (state.phase === 'awaitAnswer' && state.question) {
    renderQuestion(state, iAmActingNow, (btn) => (focusTarget = btn));
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
  const cat = categoryById(q.category).name;
  // Quien responde es el miembro de turno del bando (en individual, él mismo).
  const asker = state.players.find((p) => p.id === state.actingPlayerId)?.name ?? 'el jugador';
  const title = q.forWin ? 'Pregunta final' : cat;

  const heading = document.createElement('p');
  heading.className = 'question-text';
  heading.textContent = `${title}: ${q.text}`;
  actions.append(heading);

  if (iAmCurrent) {
    const opts = document.createElement('div');
    opts.className = 'options';
    q.options.forEach((text, index) => {
      const btn = button(`${index + 1}. ${text}`, () => net.send({ type: 'answer', optionIndex: index }));
      if (index === 0) setFocus(btn);
      opts.append(btn);
    });
    actions.append(opts);
    // Las opciones no se anuncian: el foco cae en la primera y el lector las
    // recorre una a una, así que repetirlas aquí sería ruido.
    announce(`${q.forWin ? 'Pregunta final' : 'Pregunta de ' + cat} para ti: ${q.text}`);
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

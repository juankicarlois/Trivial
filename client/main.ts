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
import type { GameEvent, GameView } from '../shared/protocol.js';
import { SoundEngine } from './audio.js';
import { Net } from './net.js';

const board = buildBoard();
const sound = new SoundEngine();

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
const playersList = $('players');
const boardPanel = $('board');
const actions = $('actions');

// --- Estado local -----------------------------------------------------------

let myId: string | null = null;
let roomCode = '';
let myName = '';
let lastState: GameView | null = null;
let lastActionKey = '';
/** Alterna un carácter invisible para forzar que el lector repita anuncios. */
let announceToggle = false;

// --- Red --------------------------------------------------------------------

const net = new Net({
  onOpen: () => {
    // Al (re)conectar, si ya elegimos sala y nombre, nos (re)unimos.
    if (roomCode && myName) net.send({ type: 'join', roomCode, name: myName });
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
      case 'event':
        handleEvent(message.event);
        break;
      case 'error':
        showError(message.message);
        break;
    }
  },
  onClose: () => announce('Conexión perdida. Reintentando…'),
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
  net.send({ type: 'join', roomCode, name });
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

/** Escribe en la región aria-live para que el lector lo pronuncie. */
function announce(text: string): void {
  announceToggle = !announceToggle;
  announceRegion.textContent = announceToggle ? text : text + '​';
}

function nameOf(playerId: string): string {
  return lastState?.players.find((p) => p.id === playerId)?.name ?? 'Alguien';
}

// --- Eventos → sonido + anuncio ---------------------------------------------

function handleEvent(event: GameEvent): void {
  switch (event.kind) {
    case 'playerJoined':
      if (event.playerId !== myId) announce(`${event.name} se ha unido a la sala.`);
      break;
    case 'gameStarted':
      announce('¡Empieza la partida!');
      break;
    case 'diceRolled':
      sound.dice();
      announce(`${nameOf(event.playerId)} saca un ${event.value}.`);
      break;
    case 'moved':
      sound.move(panForNode(event.toNodeId));
      break;
    case 'landed': {
      const label = board.nodes[event.nodeId]?.label ?? 'una casilla';
      announce(`${nameOf(event.playerId)} cae en ${label}.`);
      break;
    }
    case 'answered':
      if (event.correct) sound.correct();
      else sound.wrong();
      announce(`${nameOf(event.playerId)} responde: ${event.correct ? '¡correcto!' : 'incorrecto.'}`);
      break;
    case 'wedgeEarned':
      sound.wedge();
      announce(`${nameOf(event.playerId)} gana el queso de ${categoryById(event.category).name}.`);
      break;
    case 'turnChanged':
      announce(event.playerId === myId ? 'Es tu turno.' : `Turno de ${nameOf(event.playerId)}.`);
      break;
    case 'gameWon':
      sound.win();
      announce(`¡${nameOf(event.playerId)} gana la partida!`);
      break;
  }
}

/** Paneo estéreo (-1 izquierda … 1 derecha) según la posición de la casilla. */
function panForNode(nodeId: string): number {
  if (nodeId.startsWith('ring-')) {
    const pos = Number(nodeId.slice('ring-'.length));
    return Math.sin((2 * Math.PI * pos) / 42);
  }
  if (nodeId.startsWith('hq-')) {
    const cat = nodeId.slice('hq-'.length);
    const seg = CATEGORIES.findIndex((c) => c.id === cat);
    return seg >= 0 ? Math.sin((2 * Math.PI * (seg * 7)) / 42) : 0;
  }
  return 0; // radios y centro: sin paneo
}

// --- Render -----------------------------------------------------------------

function render(state: GameView): void {
  renderStatus(state);
  renderPlayers(state);
  renderBoard(state);
  renderActions(state);
}

function renderStatus(state: GameView): void {
  const current = state.players[state.currentPlayerIndex];
  let text: string;
  switch (state.phase) {
    case 'lobby':
      text = `Sala ${state.roomCode}. ${state.players.length} jugador(es). Esperando para empezar.`;
      break;
    case 'gameOver':
      text = state.winnerId ? `Fin de la partida. Gana ${nameOf(state.winnerId)}.` : 'Fin de la partida.';
      break;
    default:
      text = current
        ? `Turno de ${current.id === myId ? 'ti' : current.name}.`
        : 'Partida en curso.';
  }
  statusLine.textContent = text;
}

function renderPlayers(state: GameView): void {
  playersList.replaceChildren();
  state.players.forEach((player, index) => {
    const li = document.createElement('li');
    li.className = 'player' + (index === state.currentPlayerIndex ? ' current' : '');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = player.name + (player.id === myId ? ' (tú)' : '');

    const meta = document.createElement('span');
    meta.className = 'meta';
    const nodeLabel = board.nodes[player.nodeId]?.label ?? '';
    meta.textContent = `${player.connected ? '' : 'desconectado · '}${nodeLabel}`;

    li.append(name, meta, buildWedges(player.wedges));
    playersList.append(li);
  });
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
  return wrap;
}

function renderBoard(state: GameView): void {
  const current = state.players[state.currentPlayerIndex];
  boardPanel.textContent = current
    ? `Ficha en juego: ${current.name} en ${board.nodes[current.nodeId]?.label ?? ''}.`
    : '';
}

// --- Acciones ---------------------------------------------------------------

function renderActions(state: GameView): void {
  actions.replaceChildren();
  const iAmCurrent = state.players[state.currentPlayerIndex]?.id === myId;
  let focusTarget: HTMLElement | null = null;

  if (state.phase === 'lobby') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Comparte el código de la sala. Cuando estéis todos, pulsa Empezar.';
    const startBtn = button('Empezar partida', () => net.send({ type: 'start' }));
    actions.append(hint, startBtn);
    focusTarget = startBtn;
  } else if (state.phase === 'gameOver') {
    const again = button('Jugar otra vez', () => net.send({ type: 'start' }));
    actions.append(again);
    focusTarget = again;
  } else if (!iAmCurrent) {
    const wait = document.createElement('p');
    wait.className = 'hint';
    wait.textContent = `Esperando a ${state.players[state.currentPlayerIndex]?.name ?? 'otro jugador'}…`;
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
    state.movement.options.forEach((nodeId, i) => {
      const label = board.nodes[nodeId]?.label ?? nodeId;
      const btn = button(label, () => net.send({ type: 'move', toNodeId: nodeId }), 'secondary');
      if (i === 0) focusTarget = btn;
      row.append(btn);
    });
    actions.append(h, row);
  } else if (state.phase === 'awaitAnswer' && state.question) {
    const q = state.question;
    const cat = categoryById(q.category).name;
    const heading = document.createElement('p');
    heading.className = 'question-text';
    heading.textContent = `${q.forWin ? 'Pregunta final' : cat}: ${q.text}`;
    const opts = document.createElement('div');
    opts.className = 'options';
    q.options.forEach((text, index) => {
      const btn = button(`${index + 1}. ${text}`, () => net.send({ type: 'answer', optionIndex: index }));
      if (index === 0) focusTarget = btn;
      opts.append(btn);
    });
    actions.append(heading, opts);
    announce(`${q.forWin ? 'Pregunta final' : 'Pregunta de ' + cat} para ti: ${q.text}`);
  }

  manageFocus(state, focusTarget);
}

/**
 * Mueve el foco al mando principal solo cuando cambia el conjunto de acciones,
 * para no robar el foco en cada actualización de estado.
 */
function manageFocus(state: GameView, target: HTMLElement | null): void {
  const key = [
    state.phase,
    state.players[state.currentPlayerIndex]?.id ?? '',
    state.question?.id ?? '',
    state.movement?.options.join(',') ?? '',
    String(state.movement?.remaining ?? ''),
  ].join('|');
  if (key !== lastActionKey && target) {
    target.focus();
  }
  lastActionKey = key;
}

function button(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (variant) btn.className = variant;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

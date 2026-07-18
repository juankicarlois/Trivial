/**
 * Punto de entrada del servidor: sirve el cliente estático y aloja las salas de
 * juego por WebSocket. Escucha en todas las interfaces para que otros equipos de
 * la red local puedan conectarse por `http://IP-LOCAL:PUERTO`.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';

import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
import { Room, type Transport } from './room.js';
import { createDefaultRepository } from './questions_repo.js';
import { loadContent } from './content.js';
import { ProfileStore } from './profiles.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');
const DATA_DIR = join(here, '..', 'data');
const PORT = Number(process.env.PORT ?? 3000);

const content = loadContent();
const repo = createDefaultRepository(content.packs);
const profiles = new ProfileStore(join(DATA_DIR, 'profiles.json'));

// --- Gestión de salas -------------------------------------------------------

interface RoomEntry {
  room: Room;
  sockets: Set<WebSocket>;
  /** Socket de cada jugador, para enviarle datos solo a él (su progreso). */
  byPlayer: Map<string, WebSocket>;
}

const rooms = new Map<string, RoomEntry>();

function getOrCreateRoom(code: string): RoomEntry {
  let entry = rooms.get(code);
  if (!entry) {
    const sockets = new Set<WebSocket>();
    const byPlayer = new Map<string, WebSocket>();
    const transport: Transport = {
      broadcast(message: ServerMessage): void {
        const data = JSON.stringify(message);
        for (const socket of sockets) {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        }
      },
      sendTo(playerId: string, message: ServerMessage): void {
        const socket = byPlayer.get(playerId);
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      },
    };
    entry = { room: new Room(code, repo, content, profiles, transport), sockets, byPlayer };
    rooms.set(code, entry);
  }
  return entry;
}

/** Metadatos por conexión: a qué sala y jugador pertenece. */
interface SocketMeta {
  roomCode: string | null;
  playerId: string | null;
}

// --- Servidor HTTP estático -------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // Evita salir del directorio público.
  const safePath = normalize(join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Prohibido');
    return;
  }

  try {
    const body = await readFile(safePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(safePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}

const httpServer = createServer((req, res) => {
  void serveStatic(req, res);
});

// --- Servidor WebSocket -----------------------------------------------------

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (socket: WebSocket) => {
  const meta: SocketMeta = { roomCode: null, playerId: null };

  const send = (message: ServerMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      send({ type: 'error', message: 'Mensaje mal formado.' });
      return;
    }

    if (msg.type === 'join') {
      const code = msg.roomCode.trim().toUpperCase();
      const name = msg.name.trim();
      const profileId = msg.profileId?.trim();
      if (!code || !name || !profileId) {
        send({ type: 'error', message: 'Código de sala y nombre son obligatorios.' });
        return;
      }
      const entry = getOrCreateRoom(code);
      entry.sockets.add(socket);
      const playerId = entry.room.addOrReattach(name, profileId);
      if (!playerId) {
        send({ type: 'error', message: 'La partida ya ha empezado; no se puede unir.' });
        entry.sockets.delete(socket);
        return;
      }
      meta.roomCode = code;
      meta.playerId = playerId;
      entry.byPlayer.set(playerId, socket);
      send({ type: 'joined', playerId });
      // Envía el estado actual y su progreso al recién llegado.
      send({ type: 'state', state: entry.room.toView() });
      entry.room.sendProfileTo(playerId);
      return;
    }

    const entry = meta.roomCode ? rooms.get(meta.roomCode) : undefined;
    if (!entry || !meta.playerId) {
      send({ type: 'error', message: 'Primero únete a una sala.' });
      return;
    }
    const room = entry.room;

    switch (msg.type) {
      case 'start':
        room.start();
        break;
      case 'roll':
        room.roll(meta.playerId);
        break;
      case 'move':
        room.move(meta.playerId, msg.toNodeId);
        break;
      case 'answer':
        room.answer(meta.playerId, msg.optionIndex);
        break;
      case 'chooseFinalCategory':
        room.chooseFinalCategory(meta.playerId, msg.category);
        break;
      case 'setMode':
        room.setMode(meta.playerId, msg.mode);
        break;
      case 'chooseTeam':
        room.chooseTeam(meta.playerId, msg.team);
        break;
      case 'setBotTeam':
        room.setBotTeam(msg.playerId, msg.team);
        break;
      case 'addBot':
        room.addBot(msg.difficulty);
        break;
      case 'removeBot':
        room.removeBot(msg.playerId);
        break;
      case 'setPack':
        room.setPack(msg.packId, msg.enabled);
        break;
      default:
        send({ type: 'error', message: 'Acción desconocida.' });
    }
  });

  socket.on('close', () => {
    if (!meta.roomCode) return;
    const entry = rooms.get(meta.roomCode);
    if (!entry) return;
    entry.sockets.delete(socket);
    if (meta.playerId) {
      entry.byPlayer.delete(meta.playerId);
      entry.room.markDisconnected(meta.playerId);
    }
    // Recoge salas sin nadie: sin sockets y sin personas conectadas (los bots no
    // cuentan, o una sala llena de bots no se recogería nunca). Se descartan sus
    // temporizadores pendientes.
    if (entry.sockets.size === 0 && !entry.room.hasConnectedHumans()) {
      entry.room.dispose();
      rooms.delete(meta.roomCode);
    }
  });
});

// --- Arranque ---------------------------------------------------------------

httpServer.listen(PORT, () => {
  const addresses = lanAddresses();
  console.log(`Trivial accesible escuchando en el puerto ${PORT}`);
  console.log('Abre en este equipo:  http://localhost:' + PORT);
  for (const addr of addresses) {
    console.log(`Desde la red local:   http://${addr}:${PORT}`);
  }
});

/** Direcciones IPv4 no internas, para indicar cómo entrar desde la LAN. */
function lanAddresses(): string[] {
  const result: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const info of iface ?? []) {
      if (info.family === 'IPv4' && !info.internal) result.push(info.address);
    }
  }
  return result;
}

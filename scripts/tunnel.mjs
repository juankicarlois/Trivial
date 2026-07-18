/**
 * Arranca un túnel de Cloudflare hacia el servidor local y muestra la URL
 * pública de forma **accesible**: solo la URL, en una línea limpia, y copiada al
 * portapapeles para poder pegarla (Ctrl+V) a quien vaya a jugar.
 *
 * cloudflared imprime la URL dentro de un recuadro de rayitas, incómodo de leer
 * con un lector de pantalla; aquí se filtra esa salida y solo se anuncia la URL.
 *
 * Uso: `npm run tunnel` (con el servidor ya levantado con `npm run dev`).
 */

import { spawn } from 'node:child_process';

const PORT = process.env.PORT ?? '3000';
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
/** Si en este tiempo no aparece la URL, algo va mal (sin conexión, etc.). */
const URL_TIMEOUT_MS = 30000;

console.log('Arrancando el tunel, espera unos segundos a que aparezca la URL...');

const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let announced = false;

child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error('No se encuentra cloudflared. Instálalo con:  winget install Cloudflare.cloudflared');
  } else {
    console.error('No se pudo arrancar el túnel:', error.message);
  }
  process.exit(1);
});

const timeout = setTimeout(() => {
  if (!announced) {
    console.error('El túnel no ha dado una URL en 30 segundos. Revisa tu conexión e inténtalo de nuevo.');
    child.kill();
    process.exit(1);
  }
}, URL_TIMEOUT_MS);

/** Copia texto al portapapeles de Windows (best-effort). */
function copyToClipboard(text) {
  try {
    const clip = spawn('clip');
    clip.on('error', () => {}); // sin portapapeles: la URL ya está impresa
    clip.stdin.end(text);
  } catch {
    /* ignorado: la URL sigue visible en pantalla */
  }
}

function announce(url) {
  announced = true;
  clearTimeout(timeout);
  copyToClipboard(url);
  // Texto sin acentos a propósito: algunas consolas los muestran mal y con un
  // lector de pantalla eso es ruido. La URL es lo que importa y va limpia.
  console.log('');
  console.log('  URL para jugar por internet (ya copiada al portapapeles):');
  console.log('');
  console.log('    ' + url);
  console.log('');
  console.log('  Pegala (Ctrl+V) a quien quieras que juegue. Que la abra en su');
  console.log('  navegador y entre con el mismo codigo de sala que tu.');
  console.log('  El tunel sigue activo; pulsa Ctrl+C aqui para cerrarlo.');
  console.log('');
}

// cloudflared registra la URL en stderr; se leen ambas salidas por si acaso.
for (const stream of [child.stdout, child.stderr]) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!announced) {
        const match = line.match(URL_PATTERN);
        if (match) announce(match[0]);
      }
    }
  });
}

child.on('exit', (code) => {
  clearTimeout(timeout);
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill('SIGINT'));

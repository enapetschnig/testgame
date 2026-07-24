#!/usr/bin/env node
/**
 * Winziger Webserver ohne Abhaengigkeiten — startet das Spiel und macht den
 * Browser auf.
 *
 *   node scripts/serve.mjs
 *
 * Wozu ueberhaupt ein Server, wenn `dist/frojach-drive.html` doch per
 * Doppelklick laeuft? Wegen Google. Die Maps-JavaScript-API verweigert den
 * Dienst, wenn die Seite ueber `file://` geoeffnet wurde — es gibt dann
 * keinen gueltigen Referrer. Fuer den Panorama-Fahrmodus und die echten
 * Hausfassaden braucht es also http://localhost.
 *
 * Bedient wird `dist/`, falls vorhanden; sonst wird gesagt, was zu tun ist.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT) || 5180;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

try {
  await stat(join(ROOT, 'index.html'));
} catch {
  console.error('Es gibt noch keinen Build in dist/.');
  console.error('Bitte einmal ausführen:  npm install && npm run build');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    // Pfad einsperren: normalisieren und sicherstellen, dass er unterhalb
    // von dist/ bleibt. Sonst waere ../../ ein Weg ins Dateisystem.
    const file = resolve(join(ROOT, normalize(path)));
    if (file !== ROOT && !file.startsWith(ROOT + '/')) {
      res.writeHead(403).end('Verboten');
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log('');
  console.log('  Frojach Drive läuft.');
  console.log(`  ${url}`);
  console.log('');
  console.log('  Zum Beenden dieses Fenster schließen oder Strg+C drücken.');
  console.log('');
  openBrowser(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} ist belegt. Anderen Port wählen:  PORT=5181 node scripts/serve.mjs`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

/** Standardbrowser oeffnen — je nach Betriebssystem anders. */
function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    // Fehlt der Befehl (z. B. kein xdg-open auf einem nackten Server), meldet
    // sich spawn erst spaeter ueber ein 'error'-Ereignis. Ohne Zuhoerer
    // reisst das den ganzen Prozess mit — und der Server waere weg.
    child.on('error', () => {});
    child.unref();
  } catch {
    // Kein Drama — die Adresse steht oben und kann von Hand geöffnet werden.
  }
}

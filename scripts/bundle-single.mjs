#!/usr/bin/env node
/**
 * Packt den Vite-Build in eine einzige HTML-Datei.
 *
 *   npm run build && npm run build:single
 *
 * Ergebnis: `dist/frojach-drive.html` — anklicken und fahren. Praktisch zum
 * Weitergeben, fuer itch.io oder als Anhang; es gibt keine Nebendateien mehr.
 *
 * Mit `--fragment` entfaellt der Rahmen (doctype/html/head/body). Das
 * brauchen Umgebungen, die den Rahmen selbst mitbringen und nur den
 * Seiteninhalt einbetten.
 *
 * Mit `--embedded` wird der eingebettete Modus vorgegeben: das Spiel
 * verzichtet dann auf jeden Netzzugriff und nimmt die mitgelieferte Karte.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '../dist');

const args = new Set(process.argv.slice(2));
const fragment = args.has('--fragment');
const embedded = args.has('--embedded');
const outArg = process.argv.find((a) => a.startsWith('--out='));

let html;
try {
  html = await readFile(join(DIST, 'index.html'), 'utf8');
} catch {
  console.error('dist/index.html fehlt — bitte zuerst `npm run build` laufen lassen.');
  process.exit(1);
}

const assets = await readdir(join(DIST, 'assets'));
const jsName = assets.find((f) => f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));
if (!jsName) {
  console.error('Kein JavaScript-Bundle in dist/assets gefunden.');
  process.exit(1);
}

const js = await readFile(join(DIST, 'assets', jsName), 'utf8');
const css = cssName ? await readFile(join(DIST, 'assets', cssName), 'utf8') : '';

// Verweise auf die ausgelagerten Dateien entfernen — der Inhalt kommt gleich
// direkt in die Seite.
html = html
  .replace(/<script\b[^>]*src="[^"]*"[^>]*><\/script>\s*/g, '')
  .replace(/<link\b[^>]*rel="(stylesheet|modulepreload)"[^>]*>\s*/g, '');

/**
 * `</script>` im Bundle wuerde den umschliessenden Script-Block vorzeitig
 * beenden. Die Sequenz wird deshalb aufgetrennt; in JavaScript ist
 * `<\/script>` innerhalb eines Strings gleichbedeutend.
 */
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const bootstrap = embedded
  ? '<script>globalThis.__FROJACH_EMBEDDED = true;</script>\n'
  : '';

const inlined = `${bootstrap}<style>\n${css}\n</style>\n<script type="module">\n${safeJs}\n</script>`;

let out;
if (fragment) {
  // Nur der Seiteninhalt: alles zwischen <body> und </body>, plus Titel.
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? 'Frojach Drive';
  out = `<title>${title}</title>\n${body.trim()}\n${inlined}\n`;
} else {
  // Ersatztext als Funktion uebergeben. Mit einem String waeren `$&`, `$'`
  // und Verwandte Platzhalter — und die stehen im minifizierten Bundle
  // haufenweise drin (`$&&x`), was mitten im Code `</body>` einsetzen wuerde.
  out = html.replace('</body>', () => `${inlined}\n</body>`);
}

// Sicherheitsnetz: das eingebettete Skript muss Zeichen fuer Zeichen dem
// gebauten Bundle entsprechen. Sonst ist beim Zusammensetzen etwas
// verlorengegangen und die Datei waere unbrauchbar.
if (!out.includes(safeJs)) {
  console.error('Das eingebettete Bundle weicht vom Build ab — Abbruch.');
  process.exit(1);
}

const target = outArg ? outArg.slice('--out='.length) : join(DIST, 'frojach-drive.html');
await writeFile(target, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`✓ ${target}  (${kb} kB${fragment ? ', ohne Rahmen' : ''}${embedded ? ', eingebettet' : ''})`);

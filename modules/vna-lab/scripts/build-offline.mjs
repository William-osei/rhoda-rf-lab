import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';

// A classic inline bundle works when students double-click this file under file://.
// No server, ES-module imports, CDN, fonts, fetch or service worker is required.
const result = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  loader: { '.png': 'dataurl' },
  target: 'es2022',
  minify: true,
  write: false,
  outfile: 'vna.js',
  legalComments: 'inline',
});
const js = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text;
if (!js || !css) throw new Error('Offline bundle is incomplete.');
const notices = await readFile('THIRD-PARTY-NOTICES.txt', 'utf8');
const inlineJs = js.replace(/<\/script/gi, '<\\/script');
const page = (await readFile('index.html', 'utf8'))
  .replace('</head>', () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style></head>`)
  .replace('</body>', () => `<!--\n${notices.replace(/-->/g, '-- >')}\n-->\n</body>`)
  .replace(
    '<script type="module" src="/src/main.ts"></script>',
    () => `<script>${inlineJs}</script>`,
  );
// Replacement callbacks preserve literal $&, $` and $' sequences in bundled code.
// Validate the actual inserted script, not merely the esbuild input.
const embedded = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (embedded !== inlineJs) throw new Error('Offline script was altered during HTML embedding.');
new Script(embedded, { filename: 'VNA-Lab-Offline.html' });
await writeFile('dist/VNA-Lab-Offline.html', page);
await writeFile('dist/THIRD-PARTY-NOTICES.txt', notices);
console.log(
  `Offline double-click edition: dist/VNA-Lab-Offline.html (${(Buffer.byteLength(page) / 1024).toFixed(0)} KiB)`,
);

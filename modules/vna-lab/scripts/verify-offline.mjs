import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const page = await readFile('dist/VNA-Lab-Offline.html', 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(script, 'Expected one inline classic script');
new Script(script[1], { filename: 'offline-student-app.js' });
const markup = page.replace(script[0], '');
assert.equal((markup.match(/<script\b/gi) ?? []).length, 0, 'No other scripts');
assert.equal((markup.match(/<link\b[^>]*rel=["']stylesheet/gi) ?? []).length, 0);
assert.equal((markup.match(/@import\s+(?:url|["'])/gi) ?? []).length, 0);
assert.ok(page.includes('Permission is hereby granted'), 'Include Three.js license');
assert.ok(page.includes('THIRD-PARTY NOTICES'), 'Include attribution in the portable file');
assert.ok(!script[1].includes('<script type="module" src="/src/main.ts">'), 'No replacement-string corruption');
console.log(`PASS offline packaging: valid inline JavaScript, no external scripts/styles, retained license (${Buffer.byteLength(page)} bytes).`);

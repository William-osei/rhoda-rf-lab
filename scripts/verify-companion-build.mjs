/** Verify the served companion retains the complete authored rig, morphs and texture bytes. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const source=await readFile('public/gltf/lab-companion.glb');
const built=await readFile(resolve(process.argv[2]||'dist','gltf/lab-companion.glb'));
assert.equal(source.subarray(0,4).toString(),'glTF');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
assert.equal(built.byteLength,source.byteLength,'Build must retain the authored companion size');
assert.equal(hash(built),hash(source),'Build must retain all authored geometry, morph, rig and texture bytes');
assert.ok(built.equals(source));
console.log(`PASS authored companion source/build byte equality: ${source.byteLength} bytes, sha256 ${hash(source)}.`);

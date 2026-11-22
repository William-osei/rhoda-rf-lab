import type {Plugin} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/** The installed optimizer ignores exclude for public source files. Preserve the authored asset after it runs. */
export function preserveAuthoredGLTF():Plugin {
 const fileName='gltf/lab-companion.glb';let publicDir='';let expected:Buffer|null=null;
 return {name:'rhoda-preserve-authored-companion',apply:'build',configResolved(config){publicDir=config.publicDir;},generateBundle:{order:'post',handler(_options,bundle){
  expected=readFileSync(resolve(publicDir,fileName));
  const emitted=bundle[fileName];
  if(emitted?.type==='asset')emitted.source=expected;
  else this.emitFile({type:'asset',fileName,source:expected});
 }},writeBundle:{order:'post',handler(options){
  if(!expected)throw Error('Authored companion preservation did not run');
  const built=readFileSync(resolve(options.dir||'dist',fileName));
  const current=readFileSync(resolve(publicDir,fileName));
  if(!built.equals(expected)||!built.equals(current))throw Error('Build changed the authored lab companion bytes. Inspect optimizer ordering/source changes before shipping.');
  console.log(`RHODA authored companion preserved: ${built.byteLength.toLocaleString('en-US')} bytes, identical to public source.`);
 }}};
}

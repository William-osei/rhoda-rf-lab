import type {Plugin} from 'vite';
import {gzipSync} from 'node:zlib';

/** Opt-in build evidence, separate from browser transfer and runtime measurements. */
export function performanceBuildReport():Plugin {
 return {name:'rhoda-performance-report',apply:'build',generateBundle(_options,bundle){
  const chunks=Object.values(bundle).filter(item=>item.type==='chunk');
  const byName=new Map(chunks.map(chunk=>[chunk.fileName,chunk]));
  const entries=chunks.filter(chunk=>chunk.isEntry).map(entry=>{
   const included=new Set<string>();
   const collect=(name:string)=>{if(included.has(name))return;included.add(name);byName.get(name)?.imports.forEach(collect);};
   collect(entry.fileName);
   const initial=[...included].map(name=>byName.get(name)).filter(chunk=>!!chunk);
   return {name:entry.name,entry:entry.fileName,initialChunks:initial.map(chunk=>chunk.fileName),javascriptBytes:initial.reduce((n,chunk)=>n+Buffer.byteLength(chunk.code),0),gzipBytes:initial.reduce((n,chunk)=>n+gzipSync(chunk.code).byteLength,0)};
  });
  const packages=new Map<string,number>();
  for(const chunk of chunks)for(const [id,info] of Object.entries(chunk.modules)){
   const normalized=id.replaceAll('\\','/');
   const parts=normalized.split('/node_modules/');
   const name=parts.length>1?parts.at(-1)!.split('/').slice(0,parts.at(-1)!.startsWith('@')?2:1).join('/'):'application';
   packages.set(name,(packages.get(name)||0)+info.renderedLength);
  }
  this.emitFile({type:'asset',fileName:'performance-build-report.json',source:JSON.stringify({schemaVersion:1,explanation:'Static import closure only. Bytes describe generated JavaScript; gzip assumes compression per file. Module contributions are Rollup renderedLength before final chunk minification, not network bytes. Public models, fonts, runtime imports and emulation are not included.',entries,packages:[...packages].sort((a,b)=>b[1]-a[1]).map(([name,renderedBytes])=>({name,renderedBytes})),chunks:chunks.map(chunk=>({name:chunk.fileName,bytes:Buffer.byteLength(chunk.code),gzipBytes:gzipSync(chunk.code).byteLength,imports:chunk.imports,dynamicImports:chunk.dynamicImports}))},null,2)});
 }};
}

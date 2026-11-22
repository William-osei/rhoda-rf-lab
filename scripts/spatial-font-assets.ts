import type {Plugin} from 'vite';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/** Keep UIKit's exact bundled Inter glyphs, but fetch the font only when a panel needs it. */
export function spatialFontAssets():Plugin {
 const files=new Map<string,{body:Buffer|string;type:string}>();
 return {name:'rhoda-local-spatial-fonts',async config(){
  const require=createRequire(import.meta.url);
  const modulePath=require.resolve('@pmndrs/msdfonts');
  const {inter}=await import(pathToFileURL(modulePath).href);
  const urls:Record<string,string>={};
  for(const [weight,data] of Object.entries(inter) as [string,any][]){
   if(!/^[a-z-]+$/.test(weight)||data.pages.length!==1)throw Error('Unsupported bundled Inter format');
   const page=/^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(data.pages[0]);
   if(!page)throw Error('Bundled Inter texture must be local WebP');
   const texture=Buffer.from(page[1],'base64');
   const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,12);
   const stem=`rhoda-inter-${weight}-${hash}`;
   const info=JSON.stringify({...data,pages:[`${stem}.webp`]});
   files.set(`fonts/${stem}.json`,{body:info,type:'application/json'});
   files.set(`fonts/${stem}.webp`,{body:texture,type:'image/webp'});
   urls[weight]=`fonts/${stem}.json`;
  }
  files.set('fonts/LICENSE.txt',{body:readFileSync(resolve(dirname(modulePath),'../LICENSE'),'utf8'),type:'text/plain; charset=utf-8'});
  const generated=resolve('.tmp/rhoda-font-runtime.js');mkdirSync(dirname(generated),{recursive:true});
  writeFileSync(generated,`// Generated from installed @pmndrs/msdfonts; see fonts/LICENSE.txt.\nconst paths=${JSON.stringify(urls)};\nexport const inter=Object.fromEntries(Object.entries(paths).map(([weight,path])=>[weight,new URL(import.meta.env.BASE_URL+path,window.location.href).href]));\n`);
  return {resolve:{alias:[{find:/^@pmndrs\/msdfonts$/,replacement:generated}]}};
 },configureServer(server){
  server.middlewares.use((req,res,next)=>{
   const pathname=(req.url||'').split('?')[0].replace(/^\//,'');
   const file=files.get(pathname);if(!file)return next();
   res.setHeader('Content-Type',file.type);res.setHeader('Cache-Control','no-cache');res.end(file.body);
  });
 },generateBundle(){for(const [fileName,file] of files)this.emitFile({type:'asset',fileName,source:file.body});}};
}

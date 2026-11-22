import subprocess,json
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def run(*a):
 r=json.loads(subprocess.check_output([B,'--session','rhoda-avatar','--json',*a],text=True,encoding='utf-8',timeout=45));assert r['success'],r;return r['data']
script='''(async()=>{
 const {RhodeSchwarzAssistant}=await import('/src/rhode_schwarz.ts');
 const {default:manifest}=await import('/src/animation-manifest.json');
 const idle=manifest.idle.slice(1);const expected=[...manifest.expression,...idle,...manifest.locomotion];
 const failures=new Set([manifest.expression[0],idle[0],manifest.locomotion[0]]);
 let plays=0;const seen=[];const state={idleAction:null,currentAction:null,exprAnimations:[],idleAnimations:[],locoAnimations:[],mixer:{clipAction:clip=>({clip,setLoop(){},play(){plays++;}})}};
 const loader={load(path,resolve,progress,reject){seen.push(path);queueMicrotask(()=>{if(failures.has(path)){if(reject)reject(new Error('simulated unavailable clip'));}else resolve({animations:[{name:path}]});});}};
 await Promise.race([RhodeSchwarzAssistant.prototype.loadBackgroundAnimations.call(state,loader,idle),new Promise((_,reject)=>setTimeout(()=>reject(Error('animation loading stalled')),3000))]);
 if(JSON.stringify(seen)!==JSON.stringify(expected))throw Error('Later clips skipped');
 if(state.exprAnimations.length!==manifest.expression.length-1||state.idleAnimations.length!==idle.length-1||state.locoAnimations.length!==manifest.locomotion.length-1)throw Error('Successful clips not retained');
 if(!state.talkingAction)throw Error('Talking fallback missing');
 if(state.idleAction!==state.idleAnimations[0]||state.currentAction!==state.idleAction||plays!==1)throw Error('Primary idle fallback not started exactly once');
 const active={};state.idleAction=null;state.currentAction=active;plays=0;
 await RhodeSchwarzAssistant.prototype.loadBackgroundAnimations.call(state,loader,idle);
 if(!state.idleAction||state.currentAction!==active||plays!==0)throw Error('Fallback interrupted active animation');
 const existing=state.idleAction;
 await RhodeSchwarzAssistant.prototype.loadBackgroundAnimations.call(state,loader,idle);
 if(state.idleAction!==existing)throw Error('Existing idle replaced');
 return 'PASS failed expression, idle and locomotion clips skipped; successful clips retained; idle fallback and active-animation preservation';
})()'''
print(run('eval',script).get('result'))

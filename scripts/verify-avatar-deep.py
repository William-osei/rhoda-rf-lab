"""Bundled models, actual loading and controls; no physical XR/audio claims."""
import json,subprocess
from pathlib import Path
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
E=Path('.tmp/deep-avatar').resolve();E.mkdir(parents=True,exist_ok=True)
def r(*args):
 p=subprocess.run([B,'--session','avatar-deep','--json',*args],capture_output=True,text=True,encoding='utf-8',timeout=60)
 data=json.loads(p.stdout);assert data['success'],data;return data['data']
def e(code):return r('eval',code).get('result')
def ready():e('''(async()=>{for(let i=0;i<400;i++){if(!document.querySelector('#avatar-style option[value=human]').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('companion unavailable')})()''')
def click(selector):
 e('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center"})');r('click',selector)
r('set','viewport','1440','1000');r('open','http://127.0.0.1:8081/');ready()
entries=e('''(async()=>{for(let i=0;i<200;i++){const list=performance.getEntriesByType('resource').filter(r=>r.name.includes('/gltf/motion/'));if(list.some(r=>r.name.endsWith('F_Talking_Variations_001.glb')))return list.map(r=>({name:r.name.split('/').pop(),bytes:r.decodedBodySize}));await new Promise(r=>setTimeout(r,50));}throw Error('core clips unavailable')})()''')
assert len(entries)==3,entries
assert {entry['name'] for entry in entries}=={'F_Standing_Idle_001.glb','F_Walk_002.glb','F_Talking_Variations_001.glb'}
assert sum(entry['bytes'] for entry in entries)==780804,entries
print('PASS actual startup loads three required clips totaling 780804 bytes; no preview catalogue downloads')
result=e('''(async()=>{const {RhodeSchwarzAssistant}=await import('/src/rhode_schwarz.ts');const T=await import('/node_modules/three/build/three.module.js');const a=new RhodeSchwarzAssistant(new T.Scene());await a.init();for(let i=0;i<200&&!a.talkingAction;i++)await new Promise(r=>setTimeout(r,25));if(!a.locoAnimations.some(a=>a.getClip().name==='F_Walk_002'))throw Error('required gait missing');const before=a.animationLoads.size;await Promise.all([a.cycleIdleAnimation(),a.cycleIdleAnimation()]);if(a.idleAnimations.length!==10||a.animationLoads.size!==12)throw Error('variations not deduplicated');const count=a.animationLoads.size;await a.cycleIdleAnimation();if(a.animationLoads.size!==count)throw Error('repeated download');a.mixer.stopAllAction();a.mixer.uncacheRoot(a.mesh);a.mesh.removeFromParent();return {before,after:count,idleCount:a.idleAnimations.length};})()''')
assert result=={'before':3,'after':12,'idleCount':10},result
print('PASS real loader prioritizes walk, lazy idle previews deduplicate concurrent/repeated calls')
r('select','#avatar-style','human')
if not e('document.querySelector("#robot-motion").checked'):click('#robot-motion')
click('#robot-wave');r('wait','3650');assert e('document.querySelector("#robot-wave").disabled&&document.querySelector("#robot-wave").textContent==="Waving..."')
e('''(async()=>{for(let i=0;i<150;i++){if(!document.querySelector('#robot-wave').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('greeting incomplete')})()''')
r('wait','500');r('screenshot',str(E/'retargeted-human-desktop.png'));click('#robot-motion');click('#robot-reset');r('screenshot',str(E/'retargeted-human-paused.png'))
r('reload');ready();assert e('!document.querySelector("#robot-motion").checked'), 'saved animation pause'
click('#robot-face');r('screenshot',str(E/'retargeted-human-face.png'));click('#robot-hands');r('screenshot',str(E/'retargeted-human-hands.png'))
r('select','#avatar-style','robot');click('#robot-frame');r('set','viewport','390','844');click('#robot-frame');r('screenshot',str(E/'android-mobile.png'));assert e('document.documentElement.scrollWidth<=innerWidth')
assert not r('errors')['errors']
r('set','viewport','1440','1000')
blocked='**/gltf/motion/idle/F_Standing_Idle_001.glb'
try:
 r('network','route',blocked,'--abort');r('reload');ready()
 result=e('''(async()=>{const {RhodeSchwarzAssistant}=await import('/src/rhode_schwarz.ts');const T=await import('/node_modules/three/build/three.module.js');const a=new RhodeSchwarzAssistant(new T.Scene());await a.init();for(let i=0;i<200&&!a.talkingAction;i++)await new Promise(r=>setTimeout(r,25));if(!a.idleAction||!a.locoAnimations.some(a=>a.getClip().name==='F_Walk_002'))throw Error('core fallback failed');const name=a.idleAction.getClip().name;a.mixer.stopAllAction();a.mixer.uncacheRoot(a.mesh);a.mesh.removeFromParent();return name;})()''')
 assert result=='F_Standing_Idle_Variations_001',result
finally:r('network','unroute',blocked)
r('reload');ready();assert not r('errors')['errors']
print('PASS greeting duration, paused restart/reset, face/hands inspection, mobile fit, missing primary idle recovery and normal-path runtime errors empty')

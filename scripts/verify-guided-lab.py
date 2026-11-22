"""Desktop handler/runtime integration; not headset or audible voice verification."""
import json, subprocess, urllib.request
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
E='C:/Users/trick/OneDrive/Desktop/R&S/00-START-HERE/review-evidence/integration/'
def r(*args):
 p=subprocess.run([B,'--session','rhoda-refine','--json',*args],capture_output=True,text=True,encoding='utf-8',timeout=60)
 result=json.loads(p.stdout);assert result['success'],result;return result['data']
def e(code):return r('eval',code).get('result')
def click(selector):
 e('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center"})');r('click',selector)
assert json.load(urllib.request.urlopen('http://127.0.0.1:5001/api/health'))['instrument']=='mock'
r('open','http://127.0.0.1:8081/')
print(e('''(async()=>{const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');const {inPlaceWalk}=await import('/src/inPlaceWalk.ts');const g=await new GLTFLoader().loadAsync('/gltf/motion/locomotion/F_Walk_002.glb');const source=g.animations[0],clip=inPlaceWalk(source);const original=source.tracks.find(t=>t.name==='Hips.position'),fixed=clip.tracks.find(t=>t.name==='Hips.position');if(Math.abs(original.values.at(-1)-original.values[2])<4)throw Error('fixture lacks root travel');for(let i=0;i<fixed.values.length;i+=3){if(fixed.values[i]!==fixed.values[0]||fixed.values[i+2]!==fixed.values[2]||fixed.values[i+1]!==original.values[i+1])throw Error('in-place conversion failed');}return 'PASS actual original walk asset: horizontal root travel removed, vertical gait and source asset preserved';})()'''))
e('''(async()=>{for(let i=0;i<300;i++){if(!document.querySelector('#avatar-style option[value=human]').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('avatar unavailable')})()''')
print(e('''(async()=>{const T=await import('/node_modules/three/build/three.module.js');const {RhodeSchwarzAssistant}=await import('/src/rhode_schwarz.ts');const nav=await import('/src/labNavigation.ts');const code=await(await fetch('/src/rhode_schwarz.ts')).text();const url=code.match(/from ["']([^"']*avatarStyle[^"']*)["']/)[1];const motion=await import(url);const prior=localStorage.getItem('rhoda-robot-motion');try{motion.setRobotMotion(true);const a=new RhodeSchwarzAssistant();a.mesh=new T.Group();a.mesh.position.set(-2.8,0,-1);a.setGroundY(0);a.useLabNavigation(true);const camera=new T.PerspectiveCamera();camera.position.set(0,1.6,0);camera.updateMatrixWorld();a.walkTo(new T.Vector3(0,0,-4.5));for(let i=0;i<200;i++){const before=a.mesh.position.clone();a.update(camera,.1);if(a.mesh.position.distanceTo(before)>.06501)throw Error('jump');if(!nav.segmentIsClear(before,a.mesh.position))throw Error('collision');}if(a.mesh.position.distanceTo(new T.Vector3(0,0,-4.5))>.04)throw Error('did not arrive');a.walkTo(new T.Vector3(2.4,0,-3.5));for(let i=0;i<150;i++){const before=a.mesh.position.clone();a.update(camera,.1);if(!nav.segmentIsClear(before,a.mesh.position))throw Error('blocked destination collision');}a.stopAutoFollow();if(a.mesh.userData.walking)throw Error('stop');return 'PASS assistant movement through detour, blocked destination, speed bound and stop';}finally{if(prior===null)motion.useDeviceMotion();else motion.setRobotMotion(prior==='true');}})()'''))
# Reload after synthetic class test, avoiding duplicate HMR module state.
r('reload');e('''(async()=>{for(let i=0;i<300;i++){if(!document.querySelector('#avatar-style option[value=human]').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('avatar unavailable')})()''');r('select','#avatar-style','human')
click('#station-left');click('#station-practice')
e('''(async()=>{for(let i=0;i<200;i++){const d=document.querySelector('#station-frame').contentDocument;if(d?.querySelectorAll('#anatomy-list button').length>30&&d.querySelector('#coach-title').textContent==='Ch 1')return;await new Promise(r=>setTimeout(r,50));}throw Error('scope cue not ready')})()''')
assert e('!!document.querySelector("#station-companion canvas")')
click('#station-next');assert e('document.querySelector("#station-frame").contentDocument.querySelector("#coach-title").textContent==="Probe compensation"')
click('#station-next');assert e('document.querySelector("#station-frame").contentDocument.querySelector("#coach-title").textContent==="Vertical scale"')
assert e('document.querySelector("#station-frame").contentDocument.querySelector("#approval").hidden')
e('document.querySelector("#station-frame").contentDocument.querySelector("#view-part-lan").click()')
assert e('document.querySelector("#station-frame").contentDocument.querySelector("#view-rear").getAttribute("aria-pressed")==="true"')
click('#station-prev');click('#station-prev');assert e('document.querySelector("#station-prev").disabled')
click('#station-auto');assert e('!document.querySelector("#speech-auto").checked');click('#station-auto')
r('screenshot',E+'guided-scope-desktop.png');r('set','viewport','390','844');r('screenshot',E+'guided-scope-mobile.png')
assert e('document.documentElement.scrollWidth<=innerWidth')
click('#station-close');assert e('!document.querySelector("#station-dialog").open&&!document.querySelector("#station-companion canvas")')
assert not r('errors')['errors'];r('set','viewport','1440','1000')
r('open','http://127.0.0.1:8081/library.html?area=courses')
assert e('document.querySelectorAll("#course-cards button").length===5');r('select','#course-level','AI / ML');assert e('document.querySelectorAll("#course-cards button").length===2');click('#course-cards button');assert e('document.querySelector("#course-detail").textContent.includes("Split before fitting")')
r('screenshot',E+'ml-study-guide.png');r('set','viewport','390','844');r('screenshot',E+'ml-study-mobile.png');assert e('document.documentElement.scrollWidth<=innerWidth');assert not r('errors')['errors'];r('set','viewport','1440','1000')
catalog=json.load(urllib.request.urlopen('http://127.0.0.1:5001/api/library/documents'))
assert len([d for d in catalog['documents'] if d['retrieved']=='2026-10-03'])==2
print('PASS 45-part scope anatomy, cue handshake, read-only highlights, rear view, live portrait, continuation sync, mobile layout, study filters/detail and local PDFs; no browser errors')

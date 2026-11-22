"""Focused dev-browser regression for summoned arrival framing and feedback.

Uses one-shot wrappers to read the existing assistant/camera, then restores them.
No equipment or immersive session is connected. Does not build the application.
"""
import json,os,subprocess,tempfile
from pathlib import Path
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
SESSION=os.environ.get('RHODA_BROWSER_SESSION','avatar-arrival-fix')
BASE=os.environ.get('RHODA_BROWSER_URL','http://127.0.0.1:8081')
# Persistent browser files stay outside the watched development checkout.
# A caller can reuse its owned profile to warm the browser/assets before reruns.
PROFILE=os.environ.get('RHODA_BROWSER_PROFILE') or tempfile.mkdtemp(prefix='rhoda-arrival-profile-')
E=Path('.tmp/deep-avatar').resolve();E.mkdir(parents=True,exist_ok=True)
def run(*args):
 # Windows daemon startup can keep inherited pipe handles open after the CLI
 # exits. Files keep subprocess completion bounded without changing assertions.
 with tempfile.TemporaryFile(mode='w+',encoding='utf-8') as out,tempfile.TemporaryFile(mode='w+',encoding='utf-8') as err:
  subprocess.run([B,'--session',SESSION,'--profile',PROFILE,'--json',*args],stdout=out,stderr=err,timeout=60)
  out.seek(0);data=json.loads(out.read())
 assert data['success'],data;return data['data']
def ev(code):return run('eval',code).get('result')
def wait(test):return ev('(async()=>{for(let i=0;i<600;i++){if('+test+')return true;await new Promise(r=>setTimeout(r,50));}throw Error("Timed out: "+'+json.dumps(test)+');})()')
def click(selector):
 ev('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center"})');run('click',selector)
def snap():return ev('({camera:window.__arrivalCamera.position.toArray(),rotation:window.__arrivalCamera.quaternion.toArray(),avatar:window.__arrivalAssistant.mesh.position.toArray(),phase:window.__arrivalAssistant.getMovementSnapshot().phase,banner:document.querySelector("#xr-status").textContent})')
def arrival():
 wait('document.querySelector("#movement-status").textContent.startsWith("Arrived")&&document.querySelector("#xr-status").textContent.startsWith("Companion arrived")')
def inspect_runtime():
 # Import the exact cached module paths in the page's transformed entry.
 ev('''(async()=>{const entry=await(await fetch('/src/index.ts')).text();
 const url=entry.match(/from ["']([^"']*rhode_schwarz[^"']*)["']/)[1];
 window.__arrivalThree=await import(entry.match(/import \\* as THREE from ["']([^"']*)["']/)[1]);
 const {RhodeSchwarzAssistant:A}=await import(url),original=A.prototype.getMovementSnapshot;
 A.prototype.getMovementSnapshot=function(){A.prototype.getMovementSnapshot=original;window.__arrivalAssistant=this;const update=this.update;this.update=function(camera,delta){this.update=update;window.__arrivalCamera=camera;return update.call(this,camera,delta);};return original.call(this);};})()''')
 wait('!!window.__arrivalCamera')
report={'url':BASE,'hardware':'No immersive session or equipment tested.'}
try:
 run('open','about:blank');run('set','viewport','1440','1000');run('open',BASE+'/?arrival-regression=1')
 wait('!document.querySelector("#avatar-style").disabled')
 run('snapshot','-i')
 if not ev('document.querySelector("#robot-motion").checked'):click('#robot-motion')
 run('select','#avatar-style','human')
 wait('!document.querySelector("#avatar-style").disabled&&document.querySelector("#avatar-description").textContent.includes("Microsoft Rocketbox")')
 inspect_runtime();click('#robot-frame');run('select','#walk-speed','0.45')
 before=snap();click('#xr-recenter');after=snap()
 assert abs(before['camera'][0]-after['camera'][0])<1e-8 and abs(before['camera'][2]-after['camera'][2])<1e-8
 assert after['camera'][1]>before['camera'][1]+.3,'conversational height replaces low distant framing'
 # Raising/aiming happens after summon captures its unchanged 1.6m endpoint.
 target=ev('window.__arrivalAssistant.approachTarget?.toArray()')
 assert target and abs(target[0]-before['camera'][0])<.001 and abs(target[2]-(before['camera'][2]-1.6))<.001
 wait('document.querySelector("#movement-status").textContent.startsWith("Walking")')
 click('#robot-motion');wait('document.querySelector("#xr-status").textContent.startsWith("Companion approach paused")')
 paused=snap();run('wait','300');assert snap()['avatar']==paused['avatar']
 click('#robot-motion');wait('document.querySelector("#xr-status").textContent==="Companion approaching"');arrival()
 head=ev('''(()=>{const T=window.__arrivalThree,c=window.__arrivalCamera,a=window.__arrivalAssistant;c.updateMatrixWorld(true);const p=a.mesh.getWorldPosition(new T.Vector3());p.y+=1.68;p.project(c);const header=document.querySelector('header').getBoundingClientRect();return{headY:(1-p.y)*innerHeight/2,headerBottom:header.bottom,camera:c.position.toArray(),avatar:a.mesh.position.toArray(),banner:document.querySelector('#xr-status').textContent,footer:document.querySelector('#xr-loading').textContent};})()''')
 assert head['headY']>head['headerBottom']+12 and head['headY']<900,head
 assert abs(head['avatar'][0]-target[0])<.025 and abs(head['avatar'][2]-target[2])<.025
 assert head['banner']==head['footer']
 run('screenshot',str(E/'arrival-head-visible.png'));report['arrival']=head
 # A later explicit preset owns its camera and message; no delayed arrival reset.
 click('#robot-frame');click('#xr-recenter');click('#robot-face');preset=snap();run('wait','700');assert snap()==preset
 assert 'Face-detail desktop view' in preset['banner'];report['inspectionCancellation']='passed'
 # A later station choice keeps both its view and banner when its own route arrives.
 click('#robot-frame');click('#xr-recenter');click('#station-left');station=snap()
 wait('document.querySelector("#movement-status").textContent.startsWith("Arrived")');finished=snap()
 assert finished['camera']==station['camera'] and finished['rotation']==station['rotation']
 assert finished['banner']==station['banner'] and 'station A' in finished['banner'];report['stationPrecedence']='passed'
 # Stop cannot be overwritten by an earlier summoned arrival or its timer.
 click('#robot-frame');click('#xr-recenter');click('#companion-stop');stopped=snap();run('wait','700');assert snap()==stopped and stopped['banner']=='Companion stopped';report['stopCancellation']='passed'
 # An invalid test placement exercises the authored room's genuine blocked path.
 ev('window.__arrivalSavedPosition=window.__arrivalAssistant.mesh.position.clone();window.__arrivalAssistant.mesh.position.x=10')
 click('#xr-recenter');wait('document.querySelector("#xr-status").textContent.startsWith("Companion approach blocked")');report['blockedFeedback']='passed'
 click('#companion-stop');ev('window.__arrivalAssistant.mesh.position.copy(window.__arrivalSavedPosition)');click('#robot-frame')
 report['errors']=run('errors')['errors'];assert not report['errors'],report['errors']
 (E/'arrival-regression.json').write_text(json.dumps(report,indent=2))
 print('PASS arrival banner/head below navigation, unchanged camera X/Z and endpoint, pause/resume, blocked feedback, Stop, inspection and station precedence; runtime errors empty.')
finally:
 run('close')

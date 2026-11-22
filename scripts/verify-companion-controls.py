"""Real desktop browser controls; no audible speech/headset/hardware claims."""
import json, subprocess
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def r(*args):
 p=subprocess.run([B,'--session','avatar-audit','--json',*args],capture_output=True,text=True,encoding='utf-8',timeout=60)
 data=json.loads(p.stdout);assert data['success'],data;return data['data']
def e(code):return r('eval',code).get('result')
def ready():e('''(async()=>{for(let i=0;i<400;i++){if(!document.querySelector('#avatar-style option[value=human]').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('companion unavailable')})()''')
def click(selector):
 e('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center"})');r('click',selector)
r('set','viewport','1440','1000');r('open','http://127.0.0.1:8081/');ready();r('select','#avatar-style','human')
if not e('document.querySelector("#robot-motion").checked'):click('#robot-motion')
click('#robot-wave');assert e('document.querySelector("#robot-wave").disabled')
r('wait','3650');assert e('document.querySelector("#robot-wave").disabled&&document.querySelector("#robot-wave").textContent==="Waving..."')
e('''(async()=>{for(let i=0;i<150;i++){if(!document.querySelector('#robot-wave').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('greeting did not complete')})()''')
click('#robot-wave');r('select','#avatar-style','rhoda');r('select','#avatar-style','human')
assert e('!document.querySelector("#robot-wave").disabled'),'switching away cancels the greeting'
click('#station-left')
assert e('document.querySelector("#robot-wave").disabled&&document.querySelector("#robot-wave").textContent.includes("Stop walking")')
click('#companion-stop')
e('''(async()=>{for(let i=0;i<50;i++){if(!document.querySelector('#robot-wave').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('greeting did not resume after stop')})()''')
assert not r('errors')['errors']
blocked=['**/gltf/companion-motions.glb','**/gltf/companion-walk.glb']
try:
 for pattern in blocked:r('network','route',pattern,'--abort')
 r('reload');ready();r('select','#avatar-style','human')
 description=e('document.querySelector("#avatar-description").textContent')
 assert all(text in description for text in ['Idle animation unavailable.','Greeting animation unavailable.','Walking animation unavailable.'])
 assert e('document.querySelector("#robot-wave").disabled&&document.querySelector("#robot-wave").textContent==="Greeting unavailable"')
 r('select','#avatar-style','rhoda');r('select','#avatar-style','robot');r('select','#avatar-style','human')
 assert e('!document.querySelector("#avatar-style").disabled')
finally:
 for pattern in blocked:r('network','unroute',pattern)
r('reload');ready();r('select','#avatar-style','human')
assert e('!document.querySelector("#avatar-description").textContent.includes("unavailable")')
print('PASS real companion greeting duration, avatar-switch cancellation, walking lock/recovery, optional-clip failure disclosure, model switching and recovered clips; normal-path browser errors empty')

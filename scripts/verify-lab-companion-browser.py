"""Real textured model/UI checks in an independent browser session; no hardware."""
import json,os,subprocess,tempfile
from uuid import uuid4
from pathlib import Path
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
E=Path('.tmp/deep-avatar').resolve();E.mkdir(parents=True,exist_ok=True)
SESSION=os.environ.get('RHODA_BROWSER_SESSION','avatar-richer-'+uuid4().hex[:10])
PROFILE=Path(tempfile.mkdtemp(prefix='rhoda-richer-browser-')).resolve()
def run(*args,launch=False):
 command=[B,'--session',SESSION,'--json']
 if launch:command+=['--profile',str(PROFILE)]
 with tempfile.TemporaryFile(mode='w+',encoding='utf-8') as output,tempfile.TemporaryFile(mode='w+',encoding='utf-8') as error:
  p=subprocess.run(command+list(args),stdout=output,stderr=error,timeout=55)
  output.seek(0);raw=output.read();error.seek(0);diagnostic=error.read()
 data=json.loads(raw);assert p.returncode==0 and data['success'],(data,diagnostic[-1200:]);return data['data']
def evaluate(script):return run('eval',script).get('result')
def wait_for(expression):
 return evaluate('(async()=>{for(let i=0;i<600;i++){if('+expression+')return true;await new Promise(r=>setTimeout(r,50));}throw Error("Timed out: "+'+json.dumps(expression)+');})()')
def click(selector):
 evaluate('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center"})');run('click',selector)
def ready():wait_for('!document.querySelector("#avatar-style").disabled')
def screenshot(name):run('screenshot',str(E/name))
def main():
 run('open','about:blank',launch=True)
 try:
  run('set','viewport','1440','1000');run('open','http://127.0.0.1:8081/')
  evaluate('localStorage.setItem("rhoda-avatar-style","rhoda");localStorage.setItem("rhoda-robot-motion","true")');run('reload');ready()
  assert evaluate('performance.getEntriesByType("resource").filter(r=>r.name.includes("lab-companion.glb")||r.name.includes("research-companion.glb")).length')==0,'default avoids human downloads'
  run('select','#avatar-style','human');wait_for('document.querySelector("#avatar-description").textContent.includes("Microsoft Rocketbox")')
  assert evaluate('performance.getEntriesByType("resource").filter(r=>r.name.includes("lab-companion.glb")).length')==1
  assert evaluate('performance.getEntriesByType("resource").filter(r=>r.name.includes("companion-motions.glb")||r.name.includes("companion-walk.glb")||r.name.includes("research-companion.glb")).length')==0
  click('#robot-frame');run('wait','500');screenshot('richer-human-full-body.png')
  click('#robot-wave');wait_for('document.querySelector("#robot-wave").disabled');run('wait','600');screenshot('richer-human-greeting.png');wait_for('!document.querySelector("#robot-wave").disabled')
  click('#robot-face');run('wait','400');screenshot('richer-human-face.png')
  click('#robot-hands');run('wait','400');screenshot('richer-human-hands.png')
  click('#robot-reset');click('#robot-motion');run('reload');ready();wait_for('document.querySelector("#avatar-description").textContent.includes("Microsoft Rocketbox")')
  assert evaluate('!document.querySelector("#robot-motion").checked'),'saved pause applies to new model'
  click('#robot-face');screenshot('richer-human-paused-face.png')
  run('set','viewport','390','844');click('#robot-frame');run('wait','400');screenshot('richer-human-mobile.png');assert evaluate('document.documentElement.scrollWidth<=innerWidth')
  normal_errors=run('errors')['errors'];assert not normal_errors,normal_errors
  run('set','viewport','1440','1000')
  if evaluate('document.body.classList.contains("focus")'):click('#focus-view')
  blocked='**/gltf/lab-companion.glb';old='**/gltf/research-companion.glb'
  try:
   run('network','route',blocked,'--abort');run('reload');ready();wait_for('document.querySelector("#avatar-description").textContent.includes("lightweight CC0")')
   assert evaluate('document.querySelector("#avatar-style").value')=='human'
   assert evaluate('!document.querySelector("#robot-wave").textContent.includes("unavailable")')
   screenshot('richer-human-fallback.png')
   run('network','route',old,'--abort');evaluate('localStorage.setItem("rhoda-avatar-style","rhoda")');run('reload');ready();run('select','#avatar-style','human')
   wait_for('document.querySelector("#avatar-description").textContent.includes("Both human model")');assert evaluate('document.querySelector("#avatar-style").value')=='rhoda'
   run('select','#avatar-style','hidden');assert evaluate('document.querySelector("#avatar-style").value')=='hidden';run('select','#avatar-style','rhoda');assert evaluate('document.querySelector("#avatar-style").value')=='rhoda'
  finally:
   run('network','unroute',blocked);run('network','unroute',old)
  evaluate('localStorage.setItem("rhoda-avatar-style","human");localStorage.setItem("rhoda-robot-motion","true")');run('reload');ready();wait_for('document.querySelector("#avatar-description").textContent.includes("Microsoft Rocketbox")')
  assert not run('errors')['errors']
  (E/'richer-browser-check.json').write_text(json.dumps({'sourceBytes':Path('public/gltf/lab-companion.glb').stat().st_size,'defaultHumanRequests':0,'explicitHumanRequests':1,'legacyClipRequestsWithRichModel':0,'nativeGreeting':'completed','savedReducedMotion':'checked','desktopAndMobile':'screenshots captured; mobile fit asserted','detailedDownloadFailure':'independent CC0 fallback','bothHumanDownloadFailure':'original avatar remains; hide/original controls usable; no robot option','normalRuntimeErrors':normal_errors,'hardware':'unverified'},indent=2))
  print('PASS full textured MIT model, on-demand file loading, native greeting, full-body/face/hands controls, saved pause, mobile fit, rich-download fallback and both-download recovery; normal-path runtime errors empty')
 finally:
  run('close')

if __name__=='__main__':main()

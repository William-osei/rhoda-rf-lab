"""Built pages and notebook accessibility. Mock backend only; no physical media."""
import json, os, subprocess, tempfile
from pathlib import Path

B=str(Path.home()/'.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe')
E=Path('.tmp/deep-review').resolve();E.mkdir(parents=True,exist_ok=True)
SESSION=os.environ.get('RHODA_TEST_BROWSER_SESSION','rhoda-deep-root')

def r(*args):
 with tempfile.TemporaryFile(mode='w+',encoding='utf-8') as out, tempfile.TemporaryFile(mode='w+',encoding='utf-8') as err:
  subprocess.run([B,'--session',SESSION,'--json',*args],stdout=out,stderr=err,timeout=60)
  out.seek(0);d=json.loads(out.read())
 assert d['success'],d
 return d['data']

def e(code):return r('eval',code).get('result')
def wait(condition):
 e('(async()=>{for(let i=0;i<300;i++){if('+condition+')return;await new Promise(r=>setTimeout(r,50));}throw Error("Production readiness timed out");})()')
def fit():assert e('document.documentElement.scrollWidth<=innerWidth')
def errors():assert not r('errors').get('errors')
def a11y(name):
 data=r('a11y');(E/(name+'-a11y.json')).write_text(json.dumps(data,indent=2),encoding='utf-8')
 assert not data.get('violations'),data.get('violations')
 print('PASS '+name+' automated accessibility: no violations; '+str(len(data.get('incomplete',[])))+' incomplete checks')

r('set','viewport','1440','1000');r('open','http://127.0.0.1:4173/practice.html')
wait('document.querySelector("#data-status").dataset.fresh==="true"&&!document.querySelector("#capture-save").disabled')
assert e('(async()=>{return (await (await fetch("/api/health")).json()).instrument==="mock";})()')
r('fill','#capture-label','Production preview');r('fill','#capture-note','Frozen simulator readback');r('click','#capture-save')
assert e('document.querySelectorAll(".capture-card").length>0')
e('document.querySelector("#capture-title").scrollIntoView()');a11y('production-notebook-desktop')
r('screenshot',str(E/'production-notebook-desktop.png'));fit();errors()
r('set','viewport','390','844');a11y('production-notebook-mobile');r('screenshot',str(E/'production-notebook-mobile.png'));fit()
r('open','http://127.0.0.1:4173/spatial-bench.html')
wait('document.querySelector("#instrument-view canvas")&&document.querySelector("#anatomy-list button")&&document.querySelector("#data-status").dataset.fresh==="true"')
r('select','#panel-topic','Ch 2');assert 'Ch 2' in e('document.querySelector("#inspect-status").textContent')
r('select','#panel-topic','Standby');assert e('document.querySelector("#view-connectors").getAttribute("aria-pressed")==="true"')
fit();errors();r('screenshot',str(E/'production-scope-mobile.png'))
r('set','viewport','1440','1000');r('open','http://127.0.0.1:4173/library.html?area=courses&course=waveform')
wait('document.querySelectorAll("#study-route li").length===5&&!document.querySelector("#course-detail").hidden')
assert e('document.querySelector("#course-detail").textContent.includes("sampling")')
fit();errors()
r('open','http://127.0.0.1:4173/chat.html');wait('!document.querySelector("#send").disabled')
r('fill','#input','Explain probe compensation');r('click','#send')
wait('!document.querySelector("#send").disabled&&document.querySelectorAll(".msg").length>1')
assert 'compensation' in e('document.querySelector("#messages").textContent').lower()
fit();errors()
r('open','http://127.0.0.1:4173/instructor.html');wait('document.querySelector("#status").textContent.startsWith("Updated")')
fit();errors()
print('PASS built notebook, shared API proxy, spatial scope inspection, offline course/chat and instructor pages; no application runtime errors')

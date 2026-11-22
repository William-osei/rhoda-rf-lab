"""Local desktop diagnostics/loading behavior; no microphones, paid AI or physical XR."""
import json,subprocess,sys,tempfile
from pathlib import Path
B=str(Path.home()/'.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe')
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8081/'
E=Path('.tmp/performance').resolve();E.mkdir(parents=True,exist_ok=True)

def r(*args):
 with tempfile.TemporaryFile(mode='w+',encoding='utf-8') as out,tempfile.TemporaryFile(mode='w+',encoding='utf-8') as err:
  subprocess.run([B,'--session','rhoda-performance','--json',*args],stdout=out,stderr=err,timeout=60)
  out.seek(0);data=json.loads(out.read())
 assert data['success'],data
 return data['data']
def e(code):return r('eval',code).get('result')
def wait(condition):e('(async()=>{for(let i=0;i<500;i++){if('+condition+')return;await new Promise(r=>setTimeout(r,30));}throw Error("Performance readiness timed out");})()')
def click(selector):
 e('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center"})');r('click',selector)
def resources():return e('performance.getEntriesByType("resource").map(r=>({path:new URL(r.name).pathname,bytes:r.decodedBodySize,transfer:r.transferSize}))')
def ready():wait('document.querySelector("#performance-panel")&&!document.querySelector("#xr-panel").disabled&&document.querySelector("#perf-metrics").textContent.includes("Studio ready")&&!document.querySelector("#perf-metrics").textContent.includes("Preparing scene")')

r('set','viewport','1440','1000');r('open',BASE);ready()
e('localStorage.removeItem("rhoda.desktop.quality")');r('reload');ready();r('snapshot','-i')
initial=resources();assert not any('iwer' in row['path'] or row['path'].endswith('/dashboard.json') or '/fonts/' in row['path'] for row in initial),initial
assert not e('document.querySelector("#perf-enabled").checked')
print('PASS default studio fetches no IWER, spatial panel JSON or font assets; measurements off')
click('#performance-panel > summary');click('#perf-enabled');wait('Number(document.querySelector("#performance-panel").dataset.samples)>30')
assert e('document.querySelector("#performance-panel").dataset.sampling==="true"')
click('#performance-panel > summary');wait('document.querySelector("#performance-panel").dataset.sampling==="false"')
click('#performance-panel > summary');wait('document.querySelector("#performance-panel").dataset.sampling==="true"')
for quality in ['detail','economy','balanced']:
 r('select','#desktop-quality',quality)
 budget=8_000_000 if quality=='detail' else 1_500_000 if quality=='economy' else 4_000_000
 assert e('(()=>{const c=document.querySelector("#scene-container canvas");return c.width*c.height;})()')<=budget
r('select','#desktop-quality','economy');r('reload');ready()
assert e('document.querySelector("#desktop-quality").value==="economy"')
click('#performance-panel > summary');click('#perf-enabled');wait('Number(document.querySelector("#performance-panel").dataset.samples)>20')
e('''window.performanceBlobs=[];window.performanceFiles=[];window.originalPerfURL=URL.createObjectURL;window.originalPerfClick=HTMLAnchorElement.prototype.click;URL.createObjectURL=function(blob){window.performanceBlobs.push(blob);return window.originalPerfURL.call(this,blob)};HTMLAnchorElement.prototype.click=function(){if(this.download)window.performanceFiles.push(this.download);else window.originalPerfClick.call(this)};''')
click('#perf-export')
report=e('(async()=>JSON.parse(await window.performanceBlobs.at(-1).text()))()')
assert report['scope']=='visible-desktop-browser' and report['frames']['samples']>0 and report['frames']['p95Ms']>=report['frames']['medianMs']
assert report['startupMsSinceNavigation']['studio-ready']>=report['startupMsSinceNavigation']['avatar-ready']>=report['startupMsSinceNavigation']['world-ready']
assert e('window.performanceFiles.at(-1)')=='rhoda-desktop-performance.json'
assert all(token not in json.dumps(report) for token in ['127.0.0.1','sessionId','Authorization','Bearer'])
(E/'desktop-measurements.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
e('URL.createObjectURL=window.originalPerfURL;HTMLAnchorElement.prototype.click=window.originalPerfClick')
click('#perf-enabled');assert e('document.querySelector("#performance-panel").dataset.sampling==="false"')
print('PASS opt-in frame sampling, closing pause, live quality budgets/persistence, structured local export with no session/URL/token data')
click('#xr-panel');wait('performance.getEntriesByType("resource").some(r=>new URL(r.name).pathname.includes("/fonts/")&&r.decodedBodySize>0)')
fonts=resources();assert sum(row['path'].endswith('/dashboard.json') for row in fonts)==1
assert any(row['path'].endswith('.webp') and '/fonts/' in row['path'] and row['bytes']>0 for row in fonts)
for _ in range(4):click('#xr-panel')
assert sum(row['path'].endswith('/dashboard.json') for row in resources())==1
assert e('document.querySelector("#xr-panel").getAttribute("aria-pressed")==="true"')
click('#xr-panel');e('document.querySelector("#performance-panel").scrollIntoView({block:"end"})')
r('screenshot',str(E/'desktop-performance.png'))
data=r('a11y');(E/'desktop-a11y.json').write_text(json.dumps(data,indent=2),encoding='utf-8');assert not data.get('violations'),data.get('violations')
r('set','viewport','390','844');e('document.querySelector("#performance-panel").scrollIntoView({block:"end"})');assert e('document.documentElement.scrollWidth<=innerWidth')
r('screenshot',str(E/'mobile-performance.png'))
data=r('a11y');(E/'mobile-a11y.json').write_text(json.dumps(data,indent=2),encoding='utf-8');assert not data.get('violations'),data.get('violations')
assert not r('errors').get('errors')
r('set','viewport','1440','1000');r('select','#desktop-quality','balanced')
print('PASS deferred spatial panel, real local font JSON/WebP requests, one-time panel allocation, mobile fit, zero automated accessibility violations and runtime errors')

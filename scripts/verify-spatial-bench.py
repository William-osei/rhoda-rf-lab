import subprocess,json,urllib.request
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def r(*a):
 d=json.loads(subprocess.check_output([B,'--session','rhoda-scope','--json',*a],text=True,encoding='utf-8',timeout=40));assert d['success'],d;return d['data']
def ev(s):return r('eval',s).get('result')
def wait(s):ev('(async()=>{for(let i=0;i<180;i++){if('+s+')return;await new Promise(r=>setTimeout(r,50));}throw Error("timeout")})()')
def state():return json.load(urllib.request.urlopen('http://127.0.0.1:5001/api/instrument/state'))['result']
assert json.load(urllib.request.urlopen('http://127.0.0.1:5001/api/health'))['instrument']=='mock'
r('open','http://127.0.0.1:8081/spatial-bench.html');wait('!!document.querySelector("#instrument-view canvas")&&!document.querySelector("#load").disabled')
r('set','viewport','1440','1100');r('click','#view-front')
ev('window.aiCalls=0;window.origFetch=window.fetch;window.fetch=(u,o)=>{if(String(u).includes("/api/ai/")){window.aiCalls++;throw Error("Unexpected AI");}return window.origFetch(u,o)}')
before=state()['timebase_scale']
# Front-on projection of the timebase knob center, using the known camera and lens.
ev('''(()=>{const c=document.querySelector('#instrument-view canvas'),r=c.getBoundingClientRect();const f=r.height/(2*Math.tan(36*Math.PI/360));const z=.25+Math.max(.96,1.65/(r.width/r.height))/(2*Math.tan(Math.PI/10))*1.1;const x=r.left+r.width/2+.377*f/(z-.283),y=r.top+r.height/2-(.13-.03)*f/(z-.283);for(const type of ['pointerdown','pointerup'])c.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,bubbles:true,pointerId:1,button:0}));})()''')
wait('!document.querySelector("#approval").hidden')
assert state()['timebase_scale']==before
assert ev('document.querySelector("#coach-title").textContent')=='Horizontal scale'
r('click','#approve');wait('document.querySelector("#approval").hidden&&!document.querySelector("#load").disabled')
assert state()['timebase_scale']!=before
r('select','#scenario','sine');r('click','#load');wait('!document.querySelector("#load").disabled')
r('click','[data-measure="frequency"]');wait('!document.querySelector("#approval").hidden');r('click','#approve');wait('document.querySelector("#measurement").textContent.includes("1000")')
r('select','#bench-lesson','coupling');assert ev('document.querySelector("#lesson-guide").textContent.includes("+1 V")')
assert ev('window.aiCalls')==0
r('click','#view-controls');assert ev('document.querySelector("#view-controls").getAttribute("aria-pressed")')=='true'
r('click','#view-connectors');r('click','#view-screen');r('click','#view-front')
r('set','viewport','390','844');assert ev('document.documentElement.scrollWidth<=innerWidth')
assert not r('errors').get('errors')
print('PASS 3D ray control -> preview -> approve -> changed backend, simulated frequency, coupling guide, zero AI, mobile width, no errors')

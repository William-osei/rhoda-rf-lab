"""Mock-only browser regression for stale readbacks and scope interaction faults."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

BIN=os.environ.get('AGENT_BROWSER_BIN','C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe')
OUT=Path(os.environ.get('RHODA_TEST_OUTPUT','.tmp/instrument-audit')).resolve()
OUT.mkdir(parents=True,exist_ok=True)

def browser(*args):
 # On Windows the newly launched browser daemon can inherit a capture pipe.
 # File-backed output avoids waiting for that daemon to close the pipe.
 with tempfile.TemporaryFile(mode='w+',encoding='utf-8') as output, tempfile.TemporaryFile(mode='w+',encoding='utf-8') as errors:
  subprocess.run([BIN,'--session','instrument-audit','--json',*args],stdout=output,stderr=errors,timeout=50)
  output.seek(0);result=json.loads(output.read())
 assert result.get('success'),result
 return result['data']

def evaluate(script):return browser('eval',script).get('result')
def wait(condition):
 evaluate('(async()=>{for(let i=0;i<180;i++){if('+condition+')return true;await new Promise(r=>setTimeout(r,50));}throw Error("Timed out: "+'+json.dumps(condition)+');})()')
def idle():wait('!document.querySelector("#refresh").disabled')
def state():return json.load(urllib.request.urlopen('http://127.0.0.1:5001/api/instrument/state'))['result']

assert json.load(urllib.request.urlopen('http://127.0.0.1:5001/api/health'))['instrument']=='mock'
browser('open','http://127.0.0.1:8081/spatial-bench.html')
wait('!!document.querySelector("#instrument-view canvas")&&!document.querySelector("#load").disabled')
browser('set','viewport','1440','1100')
browser('snapshot','-i')
browser('select','#scenario','sine');browser('click','#load');idle()

# Invalid blank values must not turn into an accidental 0 V trigger preview.
evaluate('window.previewCount=0;window.auditFetch=window.fetch;window.fetch=(u,o)=>{if(String(u).includes("/api/instrument/set"))window.previewCount++;return window.auditFetch(u,o)}')
browser('fill','#level','');browser('click','[data-input="level"]')
assert evaluate('window.previewCount')==0
assert evaluate('document.querySelector("#approval").hidden')
browser('fill','#level','0')

# Failed reads preserve the last display but lock out evidence/actions and recover.
evaluate('window.fetch=(u,o)=>String(u).includes("/api/training/waveform")?Promise.reject(new Error("Injected waveform disconnect")):window.auditFetch(u,o)')
browser('click','#refresh')
wait('document.querySelector("#data-status").dataset.fresh==="false"&&!document.querySelector("#reconnect").disabled')
assert evaluate('document.querySelector("#export").disabled&&document.querySelector("#view-save-image").disabled&&document.querySelector("#load").disabled&&document.querySelector("[data-input=scale]").disabled')
assert 'stale' in evaluate('document.querySelector("#data-status").textContent')
assert evaluate('!document.querySelector("#model-data-status").hidden')
assert 'paused' in evaluate('document.querySelector("#lesson-check").textContent')
browser('select','#panel-topic','Ch 2')
assert 'Ch 2' in evaluate('document.querySelector("#inspect-status").textContent')
browser('select','#panel-topic','Standby')
assert evaluate('document.querySelector("#view-connectors").getAttribute("aria-pressed")')=='true'
evaluate('window.fetch=window.auditFetch');browser('click','#reconnect');idle()
assert evaluate('document.querySelector("#data-status").dataset.fresh==="true"&&document.querySelector("#model-data-status").hidden')

# A partially completed multi-setting approval must reconcile the changed state.
browser('fill','#timebase','0.001');browser('click','[data-input="timebase"]');browser('click','#approve');idle()
evaluate('window.confirmCount=0;window.fetch=(u,o)=>{if(String(u).includes("/api/instrument/set")&&JSON.parse(o.body).confirmed&&++window.confirmCount===2)return Promise.resolve(new Response(JSON.stringify({ok:false,error:"Injected second-setting failure"}),{status:409,headers:{"Content-Type":"application/json"}}));return window.auditFetch(u,o)}')
browser('click','#readable-setup');wait('!document.querySelector("#approval").hidden')
browser('click','#approve');idle()
assert state()['timebase_scale']==.0002
assert evaluate('document.querySelector("#timebase").value')=='0.0002'
assert 'earlier settings applied' in evaluate('document.querySelector("#notice").textContent')
assert evaluate('document.querySelector("#approval").hidden&&document.querySelector("#data-status").dataset.fresh==="true"')
evaluate('window.fetch=window.auditFetch')

# Orbit drags that return to their starting point must not activate a knob.
browser('click','#view-front')
evaluate('''(()=>{const c=document.querySelector('#instrument-view canvas'),r=c.getBoundingClientRect(),f=r.height/(2*Math.tan(36*Math.PI/360));const z=.25+Math.max(.96,1.65/(r.width/r.height))/(2*Math.tan(Math.PI/10))*1.1;window.knobPoint={x:r.left+r.width/2+.377*f/(z-.283),y:r.top+r.height/2-(.13-.03)*f/(z-.283)};const p=window.knobPoint;for(const [type,dx] of [['pointerdown',0],['pointermove',40],['pointermove',0],['pointerup',0]])c.dispatchEvent(new PointerEvent(type,{clientX:p.x+dx,clientY:p.y,bubbles:true,pointerId:1,button:0}));})()''')
assert evaluate('document.querySelector("#approval").hidden')
browser('click','#view-front')
evaluate('''(()=>{const c=document.querySelector('#instrument-view canvas'),p=window.knobPoint;for(const [type,id] of [['pointerdown',1],['pointerdown',2],['pointerup',2],['pointerup',1]])c.dispatchEvent(new PointerEvent(type,{clientX:p.x,clientY:p.y,bubbles:true,pointerId:id,pointerType:'touch',button:0}));})()''')
assert evaluate('document.querySelector("#approval").hidden')
browser('click','#view-front')
evaluate('''(()=>{const c=document.querySelector('#instrument-view canvas'),p=window.knobPoint;for(const type of ['pointerdown','pointerup'])c.dispatchEvent(new PointerEvent(type,{clientX:p.x,clientY:p.y,bubbles:true,pointerId:1,button:0}));})()''')
wait('!document.querySelector("#approval").hidden')
assert evaluate('document.querySelector("#panel-topic").value')==''
browser('click','#cancel');idle()

# A projected front control from the rear is blocked by the enclosure.
browser('click','#view-rear')
evaluate('''(()=>{const c=document.querySelector('#instrument-view canvas'),r=c.getBoundingClientRect(),f=r.height/(2*Math.tan(36*Math.PI/360)),distance=Math.max(.96,1.65/(r.width/r.height))/(2*Math.tan(Math.PI/10))*1.1;const x=r.left+r.width/2-.377*f/(.21+distance+.283),y=r.top+r.height/2-(.13-.03)*f/(.21+distance+.283);for(const type of ['pointerdown','pointerup'])c.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,bubbles:true,pointerId:1,button:0}));})()''')
assert evaluate('document.querySelector("#approval").hidden')

# Export includes the sample readback time, distinct from export time.
evaluate('window.evidenceBlob=null;window.auditCreate=URL.createObjectURL;window.auditAnchor=HTMLAnchorElement.prototype.click;URL.createObjectURL=(blob)=>{window.evidenceBlob=blob;return window.auditCreate(blob)};HTMLAnchorElement.prototype.click=function(){if(this.download!=="rhoda-training-evidence.json")window.auditAnchor.call(this)}')
browser('click','#export')
payload=evaluate('(async()=>JSON.parse(await window.evidenceBlob.text()))()')
assert payload['readback_at'] and payload['mode']=='training'
assert len(payload['frame']['voltage_v'])==1001
browser('click','#view-front');browser('set','viewport','390','844')
assert evaluate('document.documentElement.scrollWidth<=innerWidth')
assert evaluate('document.querySelector("#instrument-view").clientHeight')<300
errors=browser('errors');assert not errors.get('errors'),errors
browser('screenshot',str(OUT/'instrument-audit-mobile.png'))
browser('set','viewport','1440','1100');browser('screenshot',str(OUT/'instrument-audit-desktop.png'))
print('PASS blank-value validation, stale-display lockout/recovery, partial-approval reconciliation, drag/pinch/click distinction, rear occlusion, dated evidence and mobile width; no browser errors')

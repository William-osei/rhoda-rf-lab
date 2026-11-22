"""Same-origin mock integration, notebook, shared readback and malformed response recovery."""
import json, subprocess, tempfile
from pathlib import Path
B=str(Path.home()/'.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe')
E=Path('.tmp/deep-review');E.mkdir(parents=True,exist_ok=True)
def r(*args,session='rhoda-deep-root'):
 with tempfile.TemporaryFile(mode='w+',encoding='utf-8') as output,tempfile.TemporaryFile(mode='w+',encoding='utf-8') as errors:
  subprocess.run([B,'--session',session,'--json',*args],stdout=output,stderr=errors,timeout=60)
  output.seek(0);data=json.loads(output.read())
 assert data['success'],data;return data['data']
def e(code,session='rhoda-deep-root'):return r('eval',code,session=session).get('result')
def click(selector):e('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center"})');r('click',selector)
def fresh():e('''(async()=>{for(let i=0;i<200;i++){if(document.querySelector('#data-status').dataset.fresh==='true'&&!document.querySelector('#capture-save').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error(document.querySelector('#notice').textContent+' / '+document.querySelector('#data-status').textContent)})()''')
r('set','viewport','1440','1000');primary=r('open','http://127.0.0.1:8081/practice.html')['targetId'];fresh()
assert e('(async()=>{const response=await fetch("/api/health");return (await response.json()).instrument==="mock";})()')
e('sessionStorage.removeItem("rhoda-training-captures-v1")');r('reload');fresh()
# Exercise actual approval, backend, readback and immutable capture paths.
r('fill','#scale','0.5');click('[data-input="scale"]');r('wait','#approve');click('#approve');fresh()
r('fill','#capture-label','Baseline');r('fill','#capture-note','Before the scale change');click('#capture-save')
assert e('document.querySelectorAll(".capture-card").length===1')
r('fill','#scale','1');click('[data-input="scale"]');click('#approve');fresh()
r('fill','#capture-label','<img src=x onerror=alert(1)>');r('fill','#capture-note','=SUM(1,2)');click('#capture-save')
assert e('document.querySelectorAll(".capture-card").length===2&&!document.querySelector(".capture-card img")')
assert e('document.querySelector("#capture-difference").textContent.includes("0.5")&&document.querySelector("#capture-difference").textContent.includes("1")')
e('window.notebookBlobs=[];window.notebookDownloads=[];window.originalObjectURL=URL.createObjectURL;URL.createObjectURL=b=>{window.notebookBlobs.push(b);return window.originalObjectURL(b);};window.nativeAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.notebookDownloads.push(this.download);}else window.nativeAnchorClick.call(this);};')
click('#captures-json');click('#captures-csv')
result=e(r'''(async()=>{const data=JSON.parse(await notebookBlobs[0].text()),csv=await notebookBlobs[1].text();if(data.captures[0].frame.state.channels['1'].vertical_scale!==.5||data.captures[1].frame.state.channels['1'].vertical_scale!==1)throw Error('capture mutation');if(!csv.includes('time_s,voltage_v')||!csv.includes("'=SUM(1,2)"))throw Error('CSV schema/escaping');return {captures:data.captures.length,rows:csv.trim().split('\r\n').length};})()''');assert result=={'captures':2,'rows':2003},result
r('reload');fresh();assert e('document.querySelectorAll(".capture-card").length===2')
print('PASS notebook baseline/comparison, frozen snapshots, reload persistence, literal text and labelled JSON/CSV exports')
# A second page invalidates displayed readings without erasing saved captures.
secondary=r('tab','new','http://127.0.0.1:8081/practice.html')['targetId']
e('''(async()=>{const {api}=await import('/src/instrumentApi.ts');await api('/api/training/scenarios',{scenario:'offset'});})()''')
r('tab',primary)
e('''(async()=>{for(let i=0;i<100;i++){if(document.querySelector('#data-status').dataset.fresh==='false')return;await new Promise(r=>setTimeout(r,50));}throw Error('cross-page readback remained fresh')})()''')
assert e('document.querySelector("#export").disabled&&document.querySelector("#capture-save").disabled&&!document.querySelector("#captures-csv").disabled&&!document.querySelector("#refresh").disabled')
click('#refresh');fresh();assert e('document.querySelector("#scenario").value==="offset"')
# Some CLI versions retire the inactive target when switching tabs. The
# application assertions above do not depend on a later tab-cleanup command.
# Reject malformed JSON payloads without claiming the old screen is fresh.
print(e('''(async()=>{const real=window.fetch;try{window.fetch=async(url,...args)=>String(url).includes('/training/waveform')?new Response(JSON.stringify({source:'CH1',scenario:'sine',voltage_v:[0]}),{headers:{'Content-Type':'application/json'}}):real(url,...args);document.querySelector('#refresh').click();for(let i=0;i<100;i++){if(document.querySelector('#data-status').dataset.fresh==='false'&&!document.querySelector('#refresh').disabled)break;await new Promise(r=>setTimeout(r,20));}if(!document.querySelector('#notice').textContent.includes('invalid or incomplete')||!document.querySelector('#export').disabled)throw Error('malformed waveform freshness');return 'PASS shared-page invalidation, independent saved exports, refresh recovery and malformed-frame rejection';}finally{window.fetch=real;}})()'''))
click('#refresh');fresh()
# Failed cancellations retain the approval and allow connection recovery.
r('fill','#scale','0.2');click('[data-input="scale"]')
print(e('''(async()=>{const real=window.fetch;try{window.fetch=async(url,...args)=>String(url).endsWith('/cancel')?Promise.reject(Error('Inert cancellation outage')):real(url,...args);document.querySelector('#cancel').click();for(let i=0;i<100;i++){if(!document.querySelector('#cancel').disabled&&document.querySelector('#notice').textContent.includes('Cancellation could not be verified'))break;await new Promise(r=>setTimeout(r,20));}if(document.querySelector('#approval').hidden||document.querySelector('#cancel').disabled||document.querySelector('#reconnect').disabled)throw Error('cancel retry lost');return 'PASS cancellation outage retains review, Cancel retry and reconnect';}finally{window.fetch=real;}})()'''))
click('#cancel');fresh();assert e('document.querySelector("#approval").hidden')
click('#capture-save');r('screenshot',str((E/'notebook-desktop.png').resolve()));r('set','viewport','390','844');e('document.querySelector("#capture-title").scrollIntoView()');r('screenshot',str((E/'notebook-mobile.png').resolve()));assert e('document.documentElement.scrollWidth<=innerWidth');assert not r('errors')['errors']
r('open','http://127.0.0.1:8081/spatial-bench.html');fresh();r('wait','#instrument-view canvas');assert not r('errors')['errors'];r('screenshot',str((E/'scope-mobile.png').resolve()));assert e('document.documentElement.scrollWidth<=innerWidth')
print('PASS desktop/mobile notebook and spatial bench, no application runtime errors')

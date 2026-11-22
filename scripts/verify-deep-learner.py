"""Deep learner journey against local mock: no AI or physical equipment calls."""
import json, os, subprocess
from pathlib import Path
BIN=os.environ.get('AGENT_BROWSER_BIN',r'C:\Users\trick\.cache\rhoda-browser\node_modules\agent-browser\bin\agent-browser-win32-x64.exe')
OUT=Path(os.environ.get('RHODA_TEST_OUTPUT','.tmp/deep-learner')).resolve();OUT.mkdir(parents=True,exist_ok=True)
def browser(*args):
 r=subprocess.run([BIN,'--session','rhoda-deep-learner','--json',*args],capture_output=True,text=True,encoding='utf-8',timeout=45)
 d=json.loads(r.stdout);assert d['success'],d;return d['data']
def ev(js):return browser('eval',js).get('result')
def wait(js):return ev('(async()=>{for(let i=0;i<250;i++){if('+js+')return true;await new Promise(r=>setTimeout(r,40));}throw Error("Browser wait timed out");})()')
def activate(selector):
 ev("document.querySelector("+json.dumps(selector)+").focus()")
 browser("press","Enter")
def tab(area):activate("#tab-"+area)
def a11y(name):
 d=browser('a11y');(OUT/(name+'-accessibility.json')).write_text(json.dumps(d,indent=2),encoding='utf-8');assert not d['violations'],d
def upload(value):
 return ev('(()=>{const dt=new DataTransfer();dt.items.add(new File(['+json.dumps(json.dumps(value))+'],"study-backup.json",{type:"application/json"}));const input=document.querySelector("#study-backup-file");input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true;})()')
browser('network','unroute');browser('set','viewport','1440','1000');browser('open','http://127.0.0.1:8081/library.html?area=courses&course=waveform')
wait('!!document.querySelector("#course-read")')
tab('templates');assert ev('!new URL(location.href).searchParams.has("course")')
browser('reload');wait('document.querySelector("#tab-templates").getAttribute("aria-selected")==="true"')
tab('learning');browser('click','#concept-cards button');tab('templates');browser('reload')
wait('document.querySelector("#tab-templates").getAttribute("aria-selected")==="true"');assert ev('!new URL(location.href).searchParams.has("concept")')
tab('documents');wait('!!document.querySelector("#results .card button")');activate('#results .card button');wait('!!document.querySelector("#page-text")')
ev('window.realFetch=fetch;window.fetch=(u,o)=>String(u).includes("/api/library/page/")?new Promise(resolve=>{window.resolvePage=()=>resolve(new Response(JSON.stringify({text:"Delayed page two"}),{headers:{"Content-Type":"application/json"}}));}):window.realFetch(u,o);')
browser('fill','#reader input[type=number]','2');browser('press','Enter');wait('!!window.resolvePage');tab('templates');ev('window.resolvePage();window.fetch=window.realFetch;')
wait('document.querySelector("#tab-templates").getAttribute("aria-selected")==="true"');assert ev('document.querySelector("#reader").dataset.page==="1"&&!new URL(location.href).searchParams.has("doc")&&!document.querySelector("#reader").hasAttribute("aria-busy")')

browser('open','http://127.0.0.1:8081/library.html?area=courses&course=waveform');wait('!!document.querySelector("#study-evidence-note")')
browser('fill','#study-evidence-note','Existing local evidence')
record={'kind':'rhoda-study-backup','version':1,'selfReported':True,'lastTrack':'waveform','tracks':{'waveform':{'read':True,'checks':['scale','compare'],'note':'SIMULATION capture <img src=x onerror=alert(1)>','updatedAt':'2026-10-03T00:00:00.000Z'}}}
upload(record);wait('!document.querySelector("#study-backup-review").hidden');assert ev('document.querySelector("#study-evidence-note").value==="Existing local evidence"&&document.activeElement.id==="restore-study-backup"')
browser('click','#cancel-study-backup');assert ev('document.querySelector("#study-evidence-note").value==="Existing local evidence"&&document.querySelector("#study-backup-review").hidden')
upload(record);wait('!document.querySelector("#study-backup-review").hidden');browser('screenshot',str(OUT/'study-backup-review-desktop.png'));a11y('study-backup-review')
browser('click','#restore-study-backup');assert ev('document.querySelector("#course-read").checked&&document.querySelectorAll("[data-study-action]:checked").length===2&&document.querySelector("#study-evidence-note").value.includes("<img")&&!document.querySelector("#course-detail img")')
ev('window.realCreateURL=URL.createObjectURL;window.realAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.hasAttribute("download"))return window.realAnchorClick.call(this);};URL.createObjectURL=blob=>{window.backupBlob=blob;return window.realCreateURL(blob);};');activate('#download-study-backup');assert ev('(async()=>{const b=JSON.parse(await window.backupBlob.text());return b.kind==="rhoda-study-backup"&&b.tracks.waveform.read&&b.tracks.waveform.note.includes("SIMULATION capture");})()');ev('URL.createObjectURL=window.realCreateURL;HTMLAnchorElement.prototype.click=window.realAnchorClick;');
browser('reload');wait('document.querySelector("#course-read")?.checked');assert ev('document.querySelector("#study-evidence-note").value.includes("SIMULATION capture")')
invalid=json.loads(json.dumps(record));invalid['tracks']['waveform']['checks']=['foreign-action'];upload(invalid);wait('document.querySelector("#study-backup-status").textContent.includes("invalid")');assert ev('document.querySelector("#course-read").checked&&document.querySelector("#study-backup-review").hidden')
ev('const external=JSON.parse(localStorage.getItem("rhoda-study-progress-v1"));external.tracks.waveform.note="Evidence updated in another resource tab";external.tracks.ml={read:true,checks:["split"],note:"ML evidence",updatedAt:new Date().toISOString()};localStorage.setItem("rhoda-study-progress-v1",JSON.stringify(external));dispatchEvent(new StorageEvent("storage",{key:"rhoda-study-progress-v1"}));');assert ev('document.querySelector("#study-evidence-note").value.includes("another resource tab")&&document.querySelector("#study-progress-summary").textContent.includes("2 of 5")')
tab('templates');ev('dispatchEvent(new StorageEvent("storage",{key:"rhoda-study-progress-v1"}));');assert ev('document.querySelector("#tab-templates").getAttribute("aria-selected")==="true"');tab('courses')
browser('set','viewport','390','844');assert ev('document.documentElement.scrollWidth<=innerWidth');browser('screenshot',str(OUT/'study-backup-mobile.png'));a11y('study-backup-mobile')

# Exercise untrusted document metadata without changing the catalogue on disk.
doc={'id':'folder/name','title':'Reference <img src=x onerror=alert(1)>','family':'Test','category':'Manual','pages':2,'format':'PDF','source_kind':'Imported metadata','source_url':'javascript:alert(1)'}
browser('network','route','**/api/library/documents','--body',json.dumps({'documents':[doc]}));browser('network','route','**/api/library/page/**','--body',json.dumps({'text':'Plain reference text'}))
browser('open','http://127.0.0.1:8081/library.html');wait('!!document.querySelector("#results .card button")');assert ev('document.querySelector("#results .card a").getAttribute("href").includes("folder%2Fname")&&!document.querySelector("#results img")')
activate('#results .card button');wait('!!document.querySelector("#page-text")');assert ev('!document.querySelector("#reader a[href^=javascript]")');ev('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:()=>Promise.reject(Error("Injected clipboard unavailable"))}})');activate('#reader > button:nth-last-of-type(2)');wait('!!document.querySelector("#citation-fallback")');assert ev('document.activeElement.id==="citation-fallback"&&document.querySelector("#citation-fallback").textContent.includes("File page 1 of 2")&&!document.querySelector("#citation-fallback").textContent.includes("javascript:")');browser('network','unroute')

browser('network','route','**/api/health','--abort');browser('open','http://127.0.0.1:8081/chat.html');wait('document.querySelector("#lbl-be").textContent.includes("offline")')
browser('network','unroute');browser('click','#refresh-connection');wait('document.querySelector("#lbl-be").textContent.includes("online")&&document.querySelector("#scope-panel").textContent.includes("Readback received")')
ev('window.realFetch=fetch;window.aiCalls=0;window.fetch=(u,o)=>{if(String(u).includes("/api/ai/")){window.aiCalls++;throw Error("Unexpected AI request");}return window.realFetch(u,o);};')
# A response that resolves after a cross-tab session switch stays in its original journal.
ev('window.oldSession=localStorage.getItem("rhoda_active_session_v2");window.fetch=(u,o)=>String(u).includes("/api/library/search")?new Promise(resolve=>{window.resolveAnswer=()=>resolve(new Response(JSON.stringify({results:[{title:"Delayed source",family:"Test",page:1,excerpt:"Delayed reply evidence",id:"source"}]}),{headers:{"Content-Type":"application/json"}}));}):window.realFetch(u,o);')
browser('fill','#input','xyz-deep-delayed-query');browser('click','#send');wait('!!window.resolveAnswer')
ev('window.newSession="session_"+crypto.randomUUID();localStorage.setItem("rhoda_active_session_v2",window.newSession);dispatchEvent(new StorageEvent("storage",{key:"rhoda_active_session_v2",newValue:window.newSession}));window.resolveAnswer();')
wait('!document.querySelector("#send").disabled');assert ev('!document.querySelector("#messages").textContent.includes("Delayed reply evidence")')
assert ev('Object.keys(localStorage).filter(k=>k.startsWith("rhoda_event_v2_")).map(k=>JSON.parse(localStorage[k])).some(e=>e.session_id===window.oldSession&&e.role==="assistant"&&e.content.includes("Delayed reply evidence"))')
ev('window.fetch=window.realFetch;')
# Failed cancellation retains a cancel-only banner; its retry uses the original session.
assert ev('(async()=>{return (await (await fetch("/api/health")).json()).instrument==="mock";})()')
browser('fill','#input','set timebase to 1ms');browser('click','#send');wait('document.querySelector("#confirm-bar").classList.contains("active")')
ev('window.previewSession=localStorage.getItem("rhoda_active_session_v2");window.cancelHeaders=[];window.failCancel=true;window.fetch=(u,o)=>{if(String(u).includes("/api/instrument/cancel")){window.cancelHeaders.push(o.headers["X-Rhoda-Session"]);if(window.failCancel)return Promise.resolve(new Response(JSON.stringify({ok:false,error:"Injected cancellation failure"}),{status:503,headers:{"Content-Type":"application/json"}}));}return window.realFetch(u,o);};')
browser('click','#btn-n');wait('!document.querySelector("#send").disabled');assert ev('document.querySelector("#confirm-bar").classList.contains("active")&&document.querySelector("#btn-y").disabled&&!document.querySelector("#btn-n").disabled')
ev('localStorage.setItem("rhoda_active_session_v2","session_"+crypto.randomUUID());dispatchEvent(new StorageEvent("storage",{key:"rhoda_active_session_v2"}));window.failCancel=false;')
assert ev('document.querySelector("#btn-y").disabled');browser('click','#btn-n');wait('!document.querySelector("#send").disabled&&!document.querySelector("#confirm-bar").classList.contains("active")');assert ev('window.cancelHeaders.length===2&&window.cancelHeaders.every(id=>id===window.previewSession)')
ev('window.fetch=window.realFetch;');browser('fill','#input','Explain probe compensation');browser('click','#send');wait('!document.querySelector("#send").disabled');assert ev('document.querySelector("#prog-panel").textContent.includes("do not assess")')
browser('screenshot',str(OUT/'chat-reconnect-mobile.png'));a11y('chat-mobile');assert ev('document.documentElement.scrollWidth<=innerWidth')
browser('set','viewport','1440','1000');browser('screenshot',str(OUT/'chat-reconnect-desktop.png'));a11y('chat-desktop');assert not browser('errors').get('errors')
print('PASS learner deep check: tab reload, stale reader requests, backup review/cancel/restore/reload/rejection, untrusted references, reconnect, delayed cross-session journal isolation, cancellation retention/origin, topic-activity disclosure and desktop/mobile accessibility.')

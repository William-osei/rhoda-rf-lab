"""Browser recovery checks using local speech mocks; no AI, audible or headset tests."""
import json, subprocess
from pathlib import Path
B=str(Path.home()/'.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe')
E=Path('C:/Users/trick/OneDrive/Desktop/R&S/00-START-HERE/review-evidence/integration')
def r(*args):
 p=subprocess.run([B,'--session','rhoda-app-audit','--json',*args],capture_output=True,text=True,encoding='utf-8',timeout=60)
 data=json.loads(p.stdout);assert data['success'],data;return data['data']
def e(code):return r('eval',code).get('result')
def click(selector):
 e('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center"})');r('click',selector)
r('set','viewport','1440','1000');r('open','http://127.0.0.1:8081/?lesson=scope-tour')
e('''(async()=>{for(let i=0;i<300;i++){if(!document.querySelector('#avatar-style').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('studio unavailable')})()''')
assert e('document.querySelector("#lesson-pause").disabled&&document.querySelector("#lesson-resume").disabled&&document.querySelector("#lesson-stop").disabled')
click('#lesson-restart') if e('document.querySelector(".lesson-outline").open') else None
print(e('''(async()=>{const original=Object.getOwnPropertyDescriptor(window,'speechSynthesis'),utterance=window.SpeechSynthesisUtterance;const queue=[];try{Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){queue.length=0;},pause(){},resume(){},getVoices(){return [{localService:true,lang:'en-US',name:'Offline test voice'}];},speak(u){queue.push(u);u.onstart();}}});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};document.querySelector('#lesson-read').click();if(document.querySelector('#lesson-pause').disabled||!document.querySelector('#lesson-resume').disabled)throw Error('reading controls');document.querySelector('#lesson-pause').click();if(!document.querySelector('#lesson-pause').disabled||document.querySelector('#lesson-resume').disabled)throw Error('paused controls');queue.shift().onend();if(queue.length)throw Error('read ahead while paused');document.querySelector('#lesson-resume').click();if(!queue.length)throw Error('resume lost phrase');document.querySelector('#lesson-stop').click();if(!document.querySelector('#lesson-stop').disabled||!document.querySelector('#lesson-resume').disabled)throw Error('stopped controls');return 'PASS browser narration controls and paused phrase completion';}finally{document.querySelector('#lesson-stop').click();window.SpeechSynthesisUtterance=utterance;if(original)Object.defineProperty(window,'speechSynthesis',original);else delete window.speechSynthesis;}})()'''))
e('window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}))')
click('#companion-follow')
e('window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))')
assert e('document.querySelector("#companion-follow").getAttribute("aria-pressed")==="true"')
click('#companion-stop');r('wait','300');assert e('document.querySelector("#companion-follow").getAttribute("aria-pressed")==="false"')
print('PASS movement feedback after a restored-page lifecycle')
r('screenshot',str(E/'audit-studio-desktop.png'));r('set','viewport','390','844');r('screenshot',str(E/'audit-studio-mobile.png'));assert e('document.documentElement.scrollWidth<=innerWidth');assert not r('errors')['errors']
r('open','http://127.0.0.1:8081/instructor.html')
e('''(async()=>{for(let i=0;i<100;i++){if(document.querySelector('#status').textContent.startsWith('Updated'))return;await new Promise(r=>setTimeout(r,50));}throw Error(document.querySelector('#status').textContent)})()''')
assert e('document.documentElement.scrollWidth<=innerWidth')
print(e('''(async()=>{const original=window.fetch,prior=document.querySelector('#total-logs').textContent;try{window.fetch=async()=>{throw Error('browser-only outage')};document.querySelector('#refresh-records').click();await new Promise(r=>setTimeout(r,100));if(!document.querySelector('#status').textContent.includes('0 of 3 sections updated')||document.querySelector('#total-logs').textContent!==prior)throw Error('outage disclosure/preservation');document.querySelector('#export-all').click();await new Promise(r=>setTimeout(r,100));if(!document.querySelector('#status').textContent.includes('export failed')||document.querySelector('#export-all').disabled)throw Error('export error recovery');window.fetch=async(url,...args)=>String(url).endsWith('/progress')?new Response(JSON.stringify({topic_scores:{'<img src=x onerror=alert(1)>':-20},recommended_next:'Reading'}),{status:200,headers:{'Content-Type':'application/json'}}):original(url,...args);document.querySelector('#refresh-records').click();await new Promise(r=>setTimeout(r,400));if(document.querySelector('#progress-bars img')||!document.querySelector('#progress-bars').textContent.includes('<img'))throw Error('unsafe topic rendering');return 'PASS instructor failure disclosure, preserved records, export recovery and escaped topic content';}finally{window.fetch=original;document.querySelector('#refresh-records').click();}})()'''))
r('wait','300');r('screenshot',str(E/'audit-instructor-mobile.png'));r('set','viewport','1440','1000');r('screenshot',str(E/'audit-instructor-desktop.png'));assert not r('errors')['errors']
print('PASS desktop/mobile studio and instructor runtime checks')

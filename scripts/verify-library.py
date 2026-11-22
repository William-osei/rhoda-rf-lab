import json,os,subprocess
from pathlib import Path
B=os.environ['AGENT_BROWSER_BIN']; O=Path(os.environ.get('RHODA_TEST_OUTPUT','.tmp/library-check')).resolve();O.mkdir(parents=True,exist_ok=True)
def run(*a):
 r=json.loads(subprocess.check_output([B,'--session','rhoda-library','--json',*a],text=True,encoding='utf-8'));assert r['success'],r;return r['data']
def ev(s):return run('eval',s).get('result')
def wait(s):ev('(async()=>{for(let i=0;i<200;i++){if('+s+')return;await new Promise(r=>setTimeout(r,50));}throw Error("wait timeout")})()')
run('set','viewport','1280','900');run('open','http://127.0.0.1:8081/library.html');wait('document.querySelectorAll("#results .card").length>0')
assert ev('document.querySelectorAll("#results .card").length')>=101
run('select','#family','RTB24');run('fill','#query','trigger');run('click','form button');wait('document.querySelector("#status").textContent.includes("matching")')
assert ev('Array.from(document.querySelectorAll("#results .card .meta")).every(x=>x.textContent.includes("RTB24"))')
run('click','#results .card button');wait('!!document.querySelector("#page-text")');assert ev('document.querySelector("#page-text").textContent.length>0')
run('screenshot',str(O/'library-desktop.png'))
run('fill','#query','zznotawordxyz');run('click','form button');wait('document.querySelector("#results").textContent.includes("No matches")')
run('set','viewport','390','844');assert ev('document.documentElement.scrollWidth<=innerWidth');run('screenshot',str(O/'library-mobile.png'))
run('open','http://127.0.0.1:8081/chat.html');wait('document.querySelector("#send")&&!document.querySelector("#send").disabled')
ev('window.cloudCalls=0;window.realFetch=window.fetch;window.fetch=(u,o)=>{if(String(u).includes("/api/ai/")){window.cloudCalls++;throw Error("Unexpected AI");}return window.realFetch(u,o)}')
run('fill','#input','intruments');run('click','#send');wait('!document.querySelector("#send").disabled')
assert ev('document.querySelector("#messages").textContent.includes("From your local resources")')
assert ev('window.cloudCalls')==0
assert ev('Array.from(document.querySelectorAll(".msg-assistant a")).some(a=>a.href.includes("/api/library/file/"))')
assert not run('errors').get('errors')
print('PASS: catalogue, model filter, search, reader, no-match, mobile, offline chat, source links, zero AI calls')
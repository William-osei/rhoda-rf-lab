import json,subprocess,urllib.request
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def run(*a):
 r=json.loads(subprocess.check_output([B,'--session','rhoda-library','--json',*a],text=True,encoding='utf-8',timeout=45));assert r['success'],r;return r['data']
def ev(s):return run('eval',s).get('result')
def wait(s):ev('(async()=>{for(let i=0;i<200;i++){if('+s+')return;await new Promise(r=>setTimeout(r,50));}throw Error("timeout")})()')
data=json.load(urllib.request.urlopen('http://127.0.0.1:5001/api/library/documents',timeout=30));assert len(data['documents'])>=105
primer=next(d for d in data['documents'] if d['title'].startswith('Oscilloscope-Fundamentals_bro'));assert primer['pages']==24
run('open','http://127.0.0.1:8081/library.html?concept=rbw-vbw');wait('document.querySelectorAll("#results .card").length>0')
assert ev('document.querySelector("#concept-detail").textContent.includes("RBW versus VBW")')
ev('Array.from(document.querySelectorAll("#concept-detail button")).find(b=>b.textContent==="Resolution bandwidth").click()');assert 'Correct.' in ev('document.querySelector("#concept-detail").textContent')
run('reload');wait('!document.querySelector("#concept-detail").hidden');assert ev('location.search.includes("concept=rbw-vbw")')
run('set','viewport','390','844');assert ev('document.documentElement.scrollWidth<=innerWidth')
run('open','http://127.0.0.1:8081/chat.html');wait('document.querySelector("#send")&&!document.querySelector("#send").disabled')
ev('window.aiCalls=0;window.oldFetch=window.fetch;window.fetch=(u,o)=>{if(String(u).includes("/api/ai/")){window.aiCalls++;throw Error("Unexpected AI");}return window.oldFetch(u,o)}')
run('fill','#input','Explain RBW versus VBW');run('click','#send');wait('!document.querySelector("#send").disabled')
assert ev('document.querySelector("#messages").textContent.includes("Video bandwidth smooths")');assert ev('window.aiCalls')==0
assert ev('!!document.querySelector("#messages a[href*=rohde-schwarz]")')
assert not run('errors').get('errors')
print('PASS 105+ documents, primer pages, concept link/reload, quiz, mobile, source-linked chat, zero AI calls')

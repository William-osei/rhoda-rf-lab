import json,subprocess
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def run(*a):
 r=json.loads(subprocess.check_output([B,'--session','rhoda-refine','--json',*a],text=True,encoding='utf-8',timeout=60));assert r['success'],r;return r['data']
def ev(s):return run('eval',s).get('result')
def click(s):ev('document.querySelector('+json.dumps(s)+').scrollIntoView({block:"center"})');run('click',s)
run('open','http://127.0.0.1:8081/')
ev('(async()=>{for(let i=0;i<300;i++){if(!document.querySelector("#avatar-style option[value=human]").disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error("not ready")})()')
assert ev('!document.querySelector("#avatar-style option[value=ceramic]")')
for style in ['rhoda','robot','human','hidden','human']:run('select','#avatar-style',style)
click('#robot-wave');assert ev('document.querySelector("#robot-wave").getAttribute("aria-busy")==="true"')
ev('(async()=>{await new Promise(r=>setTimeout(r,3600));})()');assert ev('!document.querySelector("#robot-wave").disabled')
click('#robot-turn');assert ev('document.querySelector("#avatar-status").textContent.includes("quarter")')
click('#robot-reset');run('uncheck','#robot-motion');assert ev('document.querySelector("#robot-wave").disabled');run('check','#robot-motion')
assert not run('errors').get('errors')
run('open','http://127.0.0.1:8081/library.html')
ev('(async()=>{for(let i=0;i<200;i++){if(document.querySelectorAll("#results .card").length)return;await new Promise(r=>setTimeout(r,50));}throw Error("no docs")})()')
assert ev('document.querySelectorAll("#results .card").length')==12
first=ev('document.querySelector("#results .card").textContent');click('#results-next');assert ev('document.querySelector("#results .card").textContent')!=first
click('#results-prev');run('select','#library-sort','pages');click('#results .card button')
ev('(async()=>{for(let i=0;i<100;i++){if(document.querySelector("#page-text"))return;await new Promise(r=>setTimeout(r,50));}})()')
assert ev('document.querySelector("#page-text").textContent.length')>20
click('#tab-learning');click('#concept-cards button');assert ev('!document.querySelector("#concept-detail").hidden')
click('#concept-detail button');assert ev('document.querySelector("#concept-detail [role=status]").textContent.length')>10
click('#tab-templates');assert ev('document.querySelectorAll("#templates button").length')==4
click('#tab-documents');run('set','viewport','390','844');assert ev('document.documentElement.scrollWidth<=innerWidth')
run('screenshot','C:/Users/trick/OneDrive/Desktop/R&S/00-START-HERE/review-evidence/integration/library-mobile.png')
assert not run('errors').get('errors')
run('set','viewport','1440','1000');run('screenshot','C:/Users/trick/OneDrive/Desktop/R&S/00-START-HERE/review-evidence/integration/library-final.png')
print('PASS avatar switching, wave, rotation, reset, motion preference; library pagination, sorting, reading, concepts, quiz, templates, mobile width; no browser errors')


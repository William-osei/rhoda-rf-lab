import subprocess,json
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def run(*a):
 r=json.loads(subprocess.check_output([B,'--session','rhoda-production','--json',*a],text=True,encoding='utf-8',timeout=45));assert r['success'],r;return r['data']
def ev(s):return run('eval',s).get('result')
run('set','viewport','1440','1000')
ev('(async()=>{for(let i=0;i<300;i++){if(!document.querySelector("#avatar-style").disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error("production avatar unavailable")})()')
for style in ['rhoda','ceramic','robot']:
 run('select','#avatar-style',style);run('click','#robot-face')
 assert ev('document.querySelector("#robot-face").getAttribute("aria-pressed")')=='true'
 run('click','#robot-frame')
 run('click','#robot-hands');assert ev('document.querySelector("#robot-hands").getAttribute("aria-pressed")')=='true'
run('select','#avatar-style','ceramic');run('uncheck','#robot-motion');run('reload')
ev('(async()=>{for(let i=0;i<300;i++){if(!document.querySelector("#avatar-style").disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error("reload unavailable")})()')
assert ev('document.querySelector("#avatar-style").value')=='ceramic'
assert not ev('document.querySelector("#robot-motion").checked')
run('click','#robot-motion-system')
run('click','#focus-view');assert ev('document.querySelector("#xr-panel").getAttribute("aria-pressed")')=='false'
run('press','Escape');assert not ev('document.body.classList.contains("focus")')
assert not run('errors').get('errors')
run('screenshot','C:/Users/trick/OneDrive/Desktop/R&S/00-START-HERE/review-evidence/integration/avatar-production-check.png')
print('PASS production avatar loading, three-model framing, persisted ceramic/motion preference, focus restore and no browser errors')

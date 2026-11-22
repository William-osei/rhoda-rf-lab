import subprocess,json
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def run(*a):
 r=json.loads(subprocess.check_output([B,'--session','rhoda-avatar','--json',*a],text=True,encoding='utf-8',timeout=45));assert r['success'],r;return r['data']
def ev(s):return run('eval',s).get('result')
run('set','viewport','1440','1000')
ev('(async()=>{for(let i=0;i<200;i++){if(!document.querySelector("#avatar-style").disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error("not ready")})()')
run('select','#avatar-style','robot');assert ev('localStorage.getItem("rhoda-avatar-style")')=='robot'
run('screenshot','C:/Users/trick/OneDrive/Desktop/R&S/00-START-HERE/review-evidence/integration/xr-robot.png')
run('reload');ev('(async()=>{for(let i=0;i<200;i++){if(!document.querySelector("#avatar-style").disabled)return;await new Promise(r=>setTimeout(r,50));}})()')
assert ev('document.querySelector("#avatar-style").value')=='robot'
run('select','#avatar-style','hidden');assert ev('document.querySelector("#avatar-status").textContent.includes("hidden")')
run('select','#xr-path','0');run('click','#lesson-next');assert ev('document.querySelector("#lesson-count").textContent.includes("STEP 2")')
ev('(async()=>{const m=await import("/src/avatarStyle.ts");m.cycleAvatar();return m.avatarLabel();})()');assert ev('document.querySelector("#avatar-style").value')=='rhoda'
run('select','#avatar-style','robot');assert not run('errors').get('errors')
print('PASS switch, persistence, hidden-mode lesson navigation, shared XR cycle, no browser errors')

for style in ['ceramic','rhoda','robot']:
 run('select','#avatar-style',style)
 assert ev('!document.querySelector("#avatar-view-controls").hidden')
 assert ev('document.querySelector("#robot-motion").getClientRects().length>0')
 assert ev('document.querySelector("#robot-controls").hidden') == (style != 'robot')
 run('click','#robot-hands')
 assert ev('document.querySelector("#robot-hands").getAttribute("aria-pressed")')=='true'
 assert ev('document.querySelector("#xr-status").textContent.includes("Hands desktop view")')
 run('click','#robot-face')
 assert ev('document.querySelector("#robot-face").getAttribute("aria-pressed")')=='true'
 assert ev('document.querySelector("#robot-frame").getAttribute("aria-pressed")')=='false'
 assert ev('document.querySelector("#xr-status").textContent.includes("Face-detail")')
 run('click','#robot-frame')
 assert ev('document.querySelector("#robot-frame").getAttribute("aria-pressed")')=='true'
 assert ev('document.querySelector("#robot-face").getAttribute("aria-pressed")')=='false'
 assert ev('document.querySelector("#xr-status").textContent.includes("Full-body")')
run('select','#avatar-style','hidden')
assert ev('document.querySelector("#avatar-view-controls").hidden')
run('select','#avatar-style','ceramic')
assert not run('errors').get('errors')
print('PASS shared framing controls for all three avatars, robot-only gestures, hidden-mode controls')

for style, phrase in [('rhoda','Original animated human'),('robot','articulated hands'),('ceramic','pale ceramic finish'),('hidden','clear workspace')]:
 run('select','#avatar-style',style)
 assert phrase in ev('document.querySelector("#avatar-description").textContent')
assert ev('document.querySelector("#avatar-style").getAttribute("aria-describedby")')=='avatar-description'
run('select','#avatar-style','ceramic')
print('PASS model descriptions and accessible description association')

run('click','#xr-recenter')
assert ev('Array.from(document.querySelectorAll("#avatar-view-controls button[aria-pressed]")).every(b=>b.getAttribute("aria-pressed")==="false")')
print('PASS mutually exclusive inspection-view indicators and recenter reset')

run('click','#focus-view')
assert ev('document.body.classList.contains("focus")')
run('press','Escape')
assert ev('!document.body.classList.contains("focus")')
assert ev('document.activeElement.id')=='focus-view'
assert ev('document.querySelector("#focus-view").getAttribute("aria-pressed")')=='false'
run('press','Escape')
assert ev('!document.body.classList.contains("focus")')
print('PASS Escape exits focus view, restores keyboard focus and leaves normal view unchanged')

if ev('document.querySelector("#xr-panel").getAttribute("aria-pressed")')!='true':run('click','#xr-panel')
run('click','#focus-view')
assert ev('document.querySelector("#xr-panel").getAttribute("aria-pressed")')=='false'
run('press','Escape')
assert ev('document.querySelector("#xr-panel").getAttribute("aria-pressed")')=='true'
run('click','#xr-panel');run('click','#focus-view');run('press','Escape')
assert ev('document.querySelector("#xr-panel").getAttribute("aria-pressed")')=='false'
run('click','#xr-panel')
print('PASS focus hides spatial panel and restores its prior visible/hidden preference')

run('click','#robot-frame')
ev('(async()=>{const {RhodeSchwarzAssistant}=await import("/src/rhode_schwarz.ts");RhodeSchwarzAssistant.prototype.toggleAutoFollow.call({autoFollow:false});})()')
assert ev('document.querySelector("#robot-frame").getAttribute("aria-pressed")')=='false'
assert ev('document.querySelector("#xr-status").textContent.includes("Auto-follow enabled")')
run('click','#robot-face');run('click','#xr-recenter')
assert ev('document.querySelector("#robot-face").getAttribute("aria-pressed")')=='false'
assert ev('document.querySelector("#xr-status").textContent')=='Avatar recentered'
print('PASS follow activation invalidates inspection indicators; recenter clears view and status')

ev('(async()=>{const m=await import("/src/avatarStyle.ts");m.setAvatar("robot");document.querySelector("#robot-reset").focus();m.setAvatar("ceramic");})()')
assert ev('document.activeElement.id')=='avatar-style'
ev('(async()=>{const m=await import("/src/avatarStyle.ts");document.querySelector("#robot-hands").focus();m.setAvatar("hidden");})()')
assert ev('document.activeElement.id')=='avatar-style'
ev('(async()=>{const m=await import("/src/avatarStyle.ts");document.querySelector("#xr-path").focus();m.setAvatar("ceramic");})()')
assert ev('document.activeElement.id')=='xr-path'
print('PASS avatar changes recover focus from hidden controls without stealing lesson focus')

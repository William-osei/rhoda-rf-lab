import json,subprocess
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def run(*a):
 if a[0]=='click':
  # Keep the target fully inside the scrolling console, including after status text wraps.
  run('eval','document.querySelector('+json.dumps(a[1])+').scrollIntoView({block:"center"})')
 r=json.loads(subprocess.check_output([B,'--session','rhoda-avatar','--json',*a],text=True,encoding='utf-8',timeout=40));assert r['success'],r;return r['data']
def ev(s):return run('eval',s).get('result')
def ready():ev('(async()=>{for(let i=0;i<200;i++){if(!document.querySelector("#avatar-style").disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error("avatar not ready")})()')
ready();run('select','#avatar-style','robot')
original=ev('localStorage.getItem("rhoda-robot-motion")')
ev('(async()=>{const m=await import("/src/avatarStyle.ts");m.setRobotMotion(false);m.waveRobot()})()')
assert ev('!document.querySelector("#robot-motion").checked&&document.querySelector("#robot-wave").disabled')
assert ev('localStorage.getItem("rhoda-robot-motion")')=='false'
run('reload');ready();assert ev('!document.querySelector("#robot-motion").checked&&document.querySelector("#robot-wave").disabled')
run('click','#robot-motion');assert ev('document.querySelector("#robot-motion").checked&&!document.querySelector("#robot-wave").disabled')
run('click','#robot-wave');run('select','#avatar-style','rhoda');run('select','#avatar-style','robot')
assert not run('errors').get('errors')
ev('localStorage.'+('removeItem("rhoda-robot-motion")' if original is None else 'setItem("rhoda-robot-motion",'+json.dumps(original)+')'))
run('reload');ready()
print('PASS motion preference persistence, disabled greeting, re-enable, avatar switching, no browser errors; original preference restored')

assert ev('(async()=>{const {greetingPose:p}=await import("/src/robotMotion.ts");return [-1,0,3.4,100].every(t=>p(t,true).envelope===0)&&p(1,false).envelope===0&&p(.0001,true).shoulder<.00001&&p(3.3999,true).shoulder<.00001&&p(1,true).envelope>0})()')
print('PASS greeting endpoints, active pose, reduced motion and smooth endpoint approach')

run('select','#avatar-style','robot');before=ev('document.querySelector("#robot-motion").checked')
run('click','#robot-turn');assert 'quarter turn' in ev('document.querySelector("#avatar-status").textContent')
run('click','#robot-turn');assert 'back' in ev('document.querySelector("#avatar-status").textContent')
run('click','#robot-reset');assert 'front' in ev('document.querySelector("#avatar-status").textContent')
assert ev('document.querySelector("#robot-motion").checked')==before
print('PASS turn announcements and reset without changing animation preference')

run('click','#robot-frame');assert 'Full-body desktop view' in ev('document.querySelector("#xr-status").textContent')
assert not run('errors').get('errors')
print('PASS desktop full-body view action')

assert ev('(async()=>{const {eyeOpenness:b}=await import("/src/robotMotion.ts");return b(0,true)===1&&b(2.175,false)===1&&Math.abs(b(2.175,true)-.08)<.00001&&Math.abs(b(2.32,true)-1)<.00001&&Array.from({length:1201},(_,i)=>b(i/100,true)).every(v=>Number.isFinite(v)&&v>=.08&&v<=1)})()')
print('PASS blink bounds, closed/open endpoints and disabled-motion eyes')

original=ev('localStorage.getItem("rhoda-robot-motion")')
ev('(async()=>{const m=await import("/src/avatarStyle.ts");m.setRobotMotion(true);m.waveRobot()})()')
assert ev('document.querySelector("#robot-wave").disabled&&document.querySelector("#robot-wave").textContent==="Waving..."')
ev('(async()=>{for(let i=0;i<90;i++){if(!document.querySelector("#robot-wave").disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error("greeting button stuck")})()')
assert ev('document.querySelector("#robot-wave").textContent')=='Wave hello'
ev('(async()=>{const m=await import("/src/avatarStyle.ts");m.waveRobot();m.resetRobotPose()})()')
assert ev('!document.querySelector("#robot-wave").disabled')
ev('(async()=>{const m=await import("/src/avatarStyle.ts");'+('m.useDeviceMotion()' if original is None else 'm.setRobotMotion('+original+')')+'})()')
print('PASS greeting feedback, automatic button recovery and reset cancellation')

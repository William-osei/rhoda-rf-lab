import subprocess,json
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def run(*a):
 r=json.loads(subprocess.check_output([B,'--session','rhoda-avatar','--json',*a],text=True,encoding='utf-8',timeout=45));assert r['success'],r;return r['data']
def ev(s):return run('eval',s).get('result')
pattern='**/gltf/rhode_schwarz-character.glb'
try:
 run('network','route',pattern,'--abort');run('reload')
 ev('(async()=>{for(let i=0;i<200;i++){if(!document.querySelector("#avatar-retry").hidden)return;await new Promise(r=>setTimeout(r,50));}throw Error("missing recovery link")})()')
 assert ev('document.querySelector("#avatar-status").textContent.includes("unavailable")')
 assert ev('document.querySelector("#avatar-style").disabled')
 assert ev('document.querySelector("#xr-loading").textContent')=='Scene unavailable'
 run('select','#xr-path','1');run('select','#xr-path','0');run('click','#lesson-next');assert ev('document.querySelector("#lesson-count").textContent.includes("STEP 2")')
finally:
 run('network','unroute',pattern)
run('click','#avatar-retry')
ev('(async()=>{for(let i=0;i<200;i++){if(!document.querySelector("#avatar-style").disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error("retry failed")})()')
assert ev('document.querySelector("#avatar-retry").hidden')
print('PASS blocked model shows recovery, lessons remain usable, retry restores avatar')

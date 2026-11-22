import json,subprocess,urllib.request
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def r(*a):
 p=subprocess.run([B,'--session','rhoda-refine','--json',*a],capture_output=True,text=True,encoding='utf-8',timeout=60);x=json.loads(p.stdout);assert x['success'],x;return x['data']
in_frame=False
def e(s):
 if in_frame:s=s.replace('document.', 'document.querySelector("#station-frame").contentDocument.')
 return r('eval',s).get('result')
def click(s):
 e('document.querySelector('+json.dumps(s)+').scrollIntoView({block:"center"})')
 if in_frame:e('document.querySelector('+json.dumps(s)+').click()')
 else:r('click',s)
assert json.load(urllib.request.urlopen('http://127.0.0.1:5001/api/health'))['instrument']=='mock'
r('open','http://127.0.0.1:8081/');e('(async()=>{for(let i=0;i<300;i++){if(!document.querySelector("#avatar-style option[value=human]").disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error("not ready")})()');r('select','#avatar-style','human')
click('#station-left');click('#station-practice');r('frame','#station-frame');in_frame=True
e('(async()=>{for(let i=0;i<300;i++){if(document.querySelector("#load")&&!document.querySelector("#load").disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error("simulator unavailable")})()')
click('[data-measure="frequency"]');e('(async()=>{for(let i=0;i<150;i++){if(!document.querySelector("#approval").hidden)return;await new Promise(r=>setTimeout(r,50));}throw Error("preview failed")})()');click('#approve');e('(async()=>{for(let i=0;i<150;i++){if(document.querySelector("#measurement").textContent.includes("frequency"))return;await new Promise(r=>setTimeout(r,50));}throw Error("measurement failed")})()');print(e('document.querySelector("#measurement").textContent'))
r('frame','main');in_frame=False;r('set','viewport','390','844');r('screenshot','C:/Users/trick/OneDrive/Desktop/R&S/00-START-HERE/review-evidence/integration/station-mobile.png');click('#station-close');assert e('document.documentElement.scrollWidth<=innerWidth');click('#companion-follow');assert e('document.querySelector("#companion-follow").textContent.includes("Stop")');click('#companion-stop');assert e('document.querySelector("#companion-follow").textContent==="Follow me"');r('set','viewport','1440','1000');click('#robot-frame');e('document.querySelector(".console").scrollTop=0');click('#xr-panel');r('screenshot','C:/Users/trick/OneDrive/Desktop/R&S/00-START-HERE/review-evidence/integration/studio-panel-updated.png');assert not r('errors')['errors'];print('PASS embedded simulator measurement, mobile dialog, follow/stop controls, no overflow or browser errors')

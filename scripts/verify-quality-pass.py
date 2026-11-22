import os,json,subprocess
B=os.environ['AGENT_BROWSER_BIN']
def run(*a):
 r=json.loads(subprocess.check_output([B,'--session','rhoda-quality','--json',*a],text=True,encoding='utf-8'));assert r['success'],r;return r['data']
def ev(s):return run('eval',s).get('result')
def wait(s):ev('(async()=>{for(let i=0;i<200;i++){if('+s+')return;await new Promise(r=>setTimeout(r,50));}throw Error("timeout")})()')
run('open','http://127.0.0.1:8081/library.html');wait('document.querySelectorAll("#results .card").length>0')
run('click','#results .card button');wait('!!document.querySelector("#page-text")')
ev('Array.from(document.querySelectorAll("#reader button")).find(b=>b.textContent==="Save this page").click()')
saved=ev('localStorage.getItem("rhoda-reading-position")');assert saved
run('reload');wait('!document.querySelector("#resume-reading").hidden');run('click','#resume-reading');wait('!!document.querySelector("#page-text")')
d=json.loads(saved);run('open',f'http://127.0.0.1:8081/library.html?doc={d["id"]}&page={d["page"]}');wait('!!document.querySelector("#page-text")')
assert ev('document.querySelector("#reader input").value')==str(d['page'])
result=ev('''(async()=>{const {detectAction:p}=await import('/src/commandIntent.ts');return [p('Explain timebase 1ms'),p('Do not set timebase to 1ms'),p('set timebase to 3ms'),p('set trigger level to -250mv'),p('set coupling to ac on ch2'),p('set timebase to -1ms')];})()''')
assert result[0] is None and result[1] is None
assert result[2]['value']==0.003 and result[3]['value']==-0.25 and result[4]['path']=='channel.2.coupling' and result[5]['value']==-0.001
run('open','http://127.0.0.1:8081/');wait('document.querySelectorAll("#xr-path option").length===6');run('select','#xr-path','1');run('click','#lesson-next');run('reload');wait('document.querySelector("#lesson-count").textContent.includes("STEP 2")')
wait('!document.querySelector("#xr-panel").disabled');run('click','#xr-panel');assert ev('document.querySelector("#xr-panel").getAttribute("aria-pressed")')=='false';run('click','#xr-panel');assert ev('document.querySelector("#xr-panel").getAttribute("aria-pressed")')=='true'
assert not run('errors').get('errors')
print('PASS saved reading, reload resume, page deep link, question/negation exclusion, units/signs, XR progress, rapid panel toggles')

"""Opt-in role/access workflows on isolated synthetic accounts, simulator and journal."""
import json, os, subprocess, tempfile, time
from pathlib import Path

B=str(Path.home()/'.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe')
BASE='http://127.0.0.1:8082';API='http://127.0.0.1:5002'
PASSWORD='Synthetic browser pilot password 123!'
SESSION=os.environ.get('RHODA_TEST_BROWSER_SESSION','rhoda-pilot-auth')
E=Path('.tmp/pilot-browser').resolve();E.mkdir(parents=True,exist_ok=True)
def r(*args):
 with tempfile.TemporaryFile(mode='w+',encoding='utf-8') as out,tempfile.TemporaryFile(mode='w+',encoding='utf-8') as err:
  subprocess.run([B,'--session',SESSION,'--json',*args],stdout=out,stderr=err,timeout=60)
  out.seek(0);data=json.loads(out.read())
 assert data['success'],data
 return data['data']
def e(code):return r('eval',code).get('result')
def wait(condition):
 deadline=time.monotonic()+20
 while time.monotonic()<deadline:
  try:
   if e('Boolean('+condition+')'):return
  except AssertionError as error:
   if 'navigated or closed' not in str(error) and 'Execution context was destroyed' not in str(error):raise
  time.sleep(.05)
 raise AssertionError('Pilot condition timed out: '+condition)
def page(path):r('open',BASE+path);wait('document.querySelector("#lab-access-action")&&!document.querySelector("#lab-access").hidden')
def signin(user):
 r('click','#lab-access-action');wait('document.querySelector("#lab-sign-in")?.open');r('fill','#lab-username',user);r('fill','#lab-password',PASSWORD);e('window.__pilotOldDocument=true');r('click','#lab-login-submit');wait('!window.__pilotOldDocument&&document.querySelector("#lab-sign-in")&&!document.querySelector("#lab-sign-in").open&&document.querySelector("#lab-access-label")?.textContent.startsWith('+json.dumps(user+' ·')+')')
def signout():e('window.__pilotOldDocument=true');r('click','#lab-access-action');wait('!window.__pilotOldDocument&&document.querySelector("#lab-access-action")?.textContent==="Sign in"&&!document.querySelector("#lab-access-action").disabled')
def fresh():wait('document.querySelector("#data-status")?.dataset.fresh==="true"&&!document.querySelector("#refresh")?.disabled')
def status():return e('(async()=>await(await fetch('+json.dumps(API+'/api/auth/status')+',{credentials:"include"})).json())()')
def request(path,body=None,csrf=True):
 return e('(async()=>{const s=await(await fetch('+json.dumps(API+'/api/auth/status')+',{credentials:"include"})).json();const response=await fetch('+json.dumps(API+path)+',{credentials:"include",method:'+json.dumps('GET' if body is None else 'POST')+',headers:{"Content-Type":"application/json"'+(',"X-Rhoda-CSRF":s.csrfToken,"X-Rhoda-Session":s.sessionId' if csrf else '')+'},body:'+( 'undefined' if body is None else 'JSON.stringify('+json.dumps(body)+')')+'});return {status:response.status,data:await response.json()};})()')
def a11y(name):
 data=r('a11y');(E/(name+'-a11y.json')).write_text(json.dumps(data,indent=2),encoding='utf-8');assert not data['violations'],data['violations']

def verify_roles():
 page('/practice.html');assert 'sign-in required' in e('document.querySelector("#lab-access-label").textContent')
 assert not e('document.querySelector("#lab-access-action").disabled')
 assert request('/api/instrument/state')['status']==401
 r('click','#lab-access-action');r('fill','#lab-username','viewer');r('fill','#lab-password','deliberately invalid synthetic password');r('click','#lab-login-submit');wait('!document.querySelector("#lab-login-submit").disabled&&document.querySelector("#lab-login-status").textContent.includes("Invalid")')
 assert e('document.querySelector("#lab-sign-in").open&&document.querySelector("#lab-password").value===""');r('click','#lab-login-cancel');signin('viewer');fresh()
 assert e('document.querySelector("#load").disabled&&document.querySelector("[data-input=scale]").disabled&&document.querySelector("[data-measure=frequency]").disabled&&!document.querySelector("#refresh").disabled')
 assert request('/api/session/logs')['status']==403
 assert request('/api/instrument/set',{'path':'timebase.scale','value':.001,'confirmed':False})['status']==403
 assert request('/api/instrument/set',{'path':'timebase.scale','value':.001,'confirmed':False},csrf=False)['status']==403
 r('screenshot',str(E/'viewer-bench-desktop.png'));signout()
 print('PASS unsigned access, usable sign-in/retry, viewer readback and server/UX write restrictions')

 page('/chat.html');signin('learner');wait('!document.querySelector("#send").disabled');original=status()['sessionId']
 r('fill','#input','Explain probe compensation');r('click','#send');wait('!document.querySelector("#send").disabled&&document.querySelector("#messages").textContent.includes("compensation")')
 e('(async()=>{const {sessionLogger}=await import("/src/session.ts");for(let i=0;i<100;i++){await sessionLogger.flush();if(!sessionLogger.getSyncStatus().syncing)return;await new Promise(r=>setTimeout(r,30));}throw Error("Journal did not sync")})()')
 assert request('/api/session/logs')['data']['count']>0
 r('click','#btn-clear');wait('!document.querySelector("#send").disabled');rotated=status()['sessionId'];assert rotated!=original
 assert request('/api/session/logs')['data']['logs']==[] or all(row['session_id']==rotated for row in request('/api/session/logs')['data']['logs'])
 r('fill','#input','set timebase to 1ms');r('click','#send');wait('!document.querySelector("#send").disabled');assert not e('document.querySelector("#confirm-bar").classList.contains("active")');assert 'operator' in e('document.querySelector("#messages").textContent').lower()
 signout();assert e('!document.querySelector("#messages").textContent.includes("compensation")')
 signin('learner2');wait('!document.querySelector("#send").disabled');assert 'compensation' not in e('document.querySelector("#messages").textContent').lower()
 assert request('/api/session/logs?session_id='+original)['status']==403
 assert request('/api/session/log',{'session_id':original,'role':'user','content':'Inert cross-account injection'})['status']==403
 signout();print('PASS learner journal, server New Session, command denial, account-switch local isolation and server ownership')

 page('/practice.html');signin('operator');fresh();r('fill','#scale','0.5');r('click','[data-input=scale]');wait('!document.querySelector("#approval").hidden');r('click','#approve');fresh()
 assert request('/api/instrument/state')['data']['result']['channels']['1']['vertical_scale']==.5
 preview=request('/api/instrument/set',{'path':'timebase.scale','value':.002,'confirmed':False})['data'];assert preview['needsConfirmation'];token=preview['confirmationId'];signout();signin('operator');fresh()
 response=request('/api/instrument/set',{'path':'timebase.scale','value':.002,'confirmed':True,'confirmationId':token});assert response['status']>=400 or response['data']['ok'] is False
 assert request('/api/instrument/state')['data']['result']['timebase_scale']!=.002
 r('set','viewport','390','844');r('screenshot',str(E/'operator-bench-mobile.png'));assert e('document.documentElement.scrollWidth<=innerWidth');a11y('operator-mobile');signout()
 r('click','#lab-access-action');a11y('sign-in-mobile');r('screenshot',str(E/'sign-in-mobile.png'));r('click','#lab-login-cancel');r('set','viewport','1440','1000')
 print('PASS operator preview/approval, login-bound token revocation and mobile sign-in accessibility')

 page('/instructor.html');signin('instructor');wait('document.querySelector("#status").textContent.startsWith("Updated")');logs=request('/api/session/logs')['data']['logs'];assert any(row.get('content')=='Explain probe compensation' for row in logs)
 assert not status()['permissions']['operateInstrument'];r('screenshot',str(E/'instructor-authenticated-desktop.png'));assert not r('errors').get('errors');signout()
 print('PASS instructor aggregate inspection, role separation, logout and no application runtime errors')


def verify_peers():
 page('/chat.html')
 if status()['authenticated']:signout()
 signin('learner');wait('!document.querySelector("#send").disabled')
 first=status()['sessionId'];question='Explain trigger holdoff'
 r('fill','#input',question);r('click','#send');wait('!document.querySelector("#send").disabled&&document.querySelector("#messages").textContent.includes("Explain trigger holdoff")')
 primary=next(t['targetId'] for t in r('tab','list')['tabs'] if t['active'])
 peer=r('tab','new',BASE+'/chat.html')['targetId']
 try:
  wait('document.querySelector("#lab-access-label")?.textContent.startsWith("learner ·")&&!document.querySelector("#send")?.disabled')
  e('(async()=>{window.__pilotSessionLogger=(await import("/src/session.ts")).sessionLogger;})()')
  assert e('window.__pilotSessionLogger.getSessionId()')==first
  r('tab',primary);r('click','#btn-clear');wait('!document.querySelector("#send").disabled')
  second=status()['sessionId'];assert second!=first
  r('tab',peer);wait('window.__pilotSessionLogger.getSessionId()==='+json.dumps(second))
  assert question not in e('document.querySelector("#messages").textContent')
  r('tab',primary);signout();r('tab',peer)
  wait('document.querySelector("#lab-access-action")?.textContent==="Sign in"')
  assert e('(async()=>{return (await import("/src/session.ts")).sessionLogger.getAllLogs().length;})()')==0
  r('tab',primary);signin('learner2');r('tab',peer)
  wait('document.querySelector("#lab-access-label")?.textContent.startsWith("learner2 ·")')
  assert e('(async()=>{return (await import("/src/session.ts")).sessionLogger.getAllLogs().some(e=>e.content==="Explain trigger holdoff");})()') is False
  r('tab',primary);signout()
 finally:
  r('tab',primary)
  # Keep cleanup separate: some CLI versions retire targets during tab reconciliation.
  # The owner closes this entire test browser after the application assertions finish.
 print('PASS real peer-tab New Session, sign-out and account-change reconciliation; no local-pointer session override')

 # A privileged page must also discard rendered records when another page signs out.
 page('/instructor.html');signin('instructor');wait('document.querySelector("#status")?.textContent.startsWith("Updated")')
 assert 'Explain probe compensation' in e('document.querySelector("#transcript").textContent')
 private_page=next(t['targetId'] for t in r('tab','list')['tabs'] if t['active'])
 e('window.__pilotPrivateDocument=true')
 r('tab','new',BASE+'/chat.html');wait('document.querySelector("#lab-access-label")?.textContent.startsWith("instructor ·")');signout()
 r('tab',private_page);wait('!window.__pilotPrivateDocument&&document.querySelector("#lab-access-action")?.textContent==="Sign in"')
 assert 'Explain probe compensation' not in e('document.querySelector("#transcript").textContent')
 assert request('/api/session/logs')['status']==401
 print('PASS instructor records cleared after another tab signs out; old private document replaced')

if __name__=='__main__':
 if os.environ.get('RHODA_PILOT_PEER_ONLY')!='1':verify_roles()
 verify_peers()

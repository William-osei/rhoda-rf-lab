import json, os, subprocess
from pathlib import Path
BIN=os.environ['AGENT_BROWSER_BIN']
OUT=Path(os.environ.get('RHODA_TEST_OUTPUT','.tmp/browser-check'))
OUT=OUT.resolve()
OUT.mkdir(parents=True,exist_ok=True)
def browser(*args):
 p=subprocess.run([BIN,'--session','rhoda-ui','--json',*args],capture_output=True,text=True,encoding='utf-8',timeout=40)
 r=json.loads(p.stdout); assert r['success'],r; return r['data']
def ev(js): return browser('eval',js).get('result')
browser('open','http://127.0.0.1:8081/chat.html')
browser('click','#btn-clear')
browser('click','#chat-settings summary')
browser('select','#answer-source','ai')
browser('click','#chat-settings summary')
ev('''window.realFetch=window.fetch; window.aiCalls=0; window.fetch=(u,o)=>String(u).includes('/api/ai/chat')?(window.aiCalls++,window.aiPayload=JSON.parse(o.body),new Promise(r=>setTimeout(()=>r(new Response(JSON.stringify({ok:true,text:'## Test response (mock)\\nA **formatted** explanation.\\n\\n- First step\\n- Second step\\n\\n```python\\nprint("RHODA")\\n```\\n<img src=x onerror="window.unsafe=true">'}),{headers:{'Content-Type':'application/json'}})),700))):window.realFetch(u,o)''')
browser('fill','#input','Explain a measurement plan')
ev("document.querySelector('#send').click();document.querySelector('#input').value='Duplicate attempt';document.querySelector('#input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));")
ev("(async()=>{for(let i=0;i<80;i++){if(!document.querySelector('#send').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('timeout')})()")
assert ev('window.aiCalls')==1
assert ev("!!document.querySelector('.msg-assistant h2') && !!document.querySelector('.msg-assistant pre code')")
assert not ev("!!window.unsafe || !!document.querySelector('[onerror]')")
assert ev("!!document.querySelector('.copy-reply')")
assert ev("window.aiPayload.assistanceContext.length>0 && typeof window.aiPayload.instrumentState==='string'")
browser('click','#toggle-panel');assert ev("document.querySelector('#toggle-panel').getAttribute('aria-expanded')==='true'")
browser('click','#toggle-panel')
browser('screenshot',str(OUT/'chat-refined-desktop.png'))
ev("window.fetch=(u,o)=>String(u).includes('/api/ai/chat')?Promise.resolve(new Response(JSON.stringify({ok:false,error:'Test service unavailable'}),{status:503})):window.realFetch(u,o)")
browser('fill','#input','Keep this draft on failure');browser('click','#send')
ev("(async()=>{for(let i=0;i<80;i++){if(!document.querySelector('#send').disabled)return;await new Promise(r=>setTimeout(r,50));}})()")
assert ev("document.querySelector('#input').value==='Keep this draft on failure'")
assert ev("!document.querySelector('#btn-clear').disabled && document.querySelector('#messages').getAttribute('aria-busy')==='false'")
browser('set','viewport','390','844')
assert ev('document.documentElement.scrollWidth<=window.innerWidth')
browser('screenshot',str(OUT/'chat-refined-mobile.png'))
errors=browser('errors');assert not errors.get('errors'),errors
checks=['formatted Markdown','unsafe HTML removed','copy control','duplicate send prevented','context supplied','lab panel toggle','failure preserves draft','busy state cleared','mobile has no horizontal overflow','no browser errors']
(OUT/'chat-refined-results.json').write_text(json.dumps({'passed':checks,'ai_response':'mock','live_provider_result':'HTTP 429'},indent=2))
print(json.dumps(checks))
browser('set','viewport','1280','900')

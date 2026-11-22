"""Browser regressions for catalogue recovery, reading retention and local chat.

Uses an isolated browser session and the local mock backend. Never requests AI.
"""
import json
import os
import subprocess
from pathlib import Path

BIN = os.environ.get('AGENT_BROWSER_BIN', r'C:\Users\trick\.cache\rhoda-browser\node_modules\agent-browser\bin\agent-browser-win32-x64.exe')
OUT = Path(os.environ.get('RHODA_TEST_OUTPUT', '.tmp/library-chat-audit')).resolve()
OUT.mkdir(parents=True, exist_ok=True)

def browser(*args):
    result = subprocess.run([BIN, '--session', 'rhoda-audit-library', '--json', *args], capture_output=True, text=True, encoding='utf-8', timeout=45)
    response = json.loads(result.stdout)
    assert response['success'], response
    return response['data']

def ev(js):
    return browser('eval', js).get('result')

def wait(js):
    return ev('(async()=>{for(let i=0;i<200;i++){if('+js+')return true;await new Promise(r=>setTimeout(r,50));}throw Error("Browser wait timed out")})()')

def accessibility(name):
    result=browser('a11y')
    (OUT / (name+'-accessibility.json')).write_text(json.dumps(result, indent=2), encoding='utf-8')
    assert not result['violations'], result

browser('set', 'viewport', '1440', '1000')
browser('network', 'route', '**/api/library/documents', '--abort')
browser('open', 'http://127.0.0.1:8081/library.html')
wait('!document.querySelector("#catalogue-recovery").hidden')
assert ev('!document.querySelector("#retry-catalogue").disabled')
browser('click', '#tab-courses')
assert ev('document.querySelectorAll("#course-cards button").length===5')
browser('click', '#tab-documents')
browser('network', 'unroute', '**/api/library/documents')
try:
    browser('click', '#retry-catalogue')
except AssertionError:
    # Some CLI versions recheck a rapidly hidden retry target after dispatch.
    assert ev('document.querySelector("#catalogue-recovery").hidden && document.querySelectorAll("#results .card").length===12')
wait('document.querySelectorAll("#results .card").length===12 && document.querySelector("#catalogue-recovery").hidden')
assert ev('new Set(Array.from(document.querySelector("#family").options,x=>x.value)).size===document.querySelector("#family").options.length')
browser('click', '#results .card button')
wait('!!document.querySelector("#page-text")')
old_text = ev('document.querySelector("#page-text").textContent')
browser('network', 'route', '**/api/library/page/**/2', '--abort')
browser('fill', '#reader input[type=number]', '2')
browser('press', 'Enter')
wait('!!document.querySelector("#retry-page")')
assert ev('document.querySelector("#page-text").textContent') == old_text
assert ev('document.querySelector("#reader input[type=number]").value==="1"'), 'A failed request must not relabel retained page one as page two'
assert ev('document.querySelector("#reader-request-status").getAttribute("role")==="alert"')
browser('screenshot', str(OUT / 'reader-recovery-desktop.png'))
browser('network', 'unroute', '**/api/library/page/**/2')
browser('click', '#retry-page')
wait('document.querySelector("#reader input[type=number]").value==="2" && !document.querySelector("#reader-request-status")')
assert ev('document.querySelector("#page-text").textContent') != old_text
accessibility('document-reader')
browser('fill', '#reader input[type=number]', '0')
browser('press', 'Enter')
assert ev('!!document.querySelector("#reader input[type=number]").validationMessage')
browser('set', 'viewport', '390', '844')
assert ev('document.documentElement.scrollWidth<=innerWidth')
browser('screenshot', str(OUT / 'reader-recovery-mobile.png'))
for area in ['learning', 'templates', 'courses']:
    browser('click', '#tab-'+area)
    accessibility('library-'+area)
browser('click', '#course-cards button')
accessibility('study-guide')

browser('open', 'http://127.0.0.1:8081/chat.html')
wait('document.querySelector("#lbl-be").textContent.includes("online")')
ev('localStorage.setItem("rhoda-chat-draft","x".repeat(13000))')
browser('reload')
wait('document.querySelector("#input").value.length===12000')
assert ev('document.querySelector("#draft-status").textContent.includes("12,000 / 12,000")')
browser('click', '#btn-clear')
wait('!document.querySelector("#send").disabled')
ev('window.realFetch=window.fetch;window.aiCalls=0;window.fetch=(u,o)=>{if(String(u).includes("/api/ai/")){window.aiCalls++;throw Error("Unexpected AI request");}if(String(u).includes("/api/library/search"))return Promise.reject(Error("Test catalogue unavailable"));return window.realFetch(u,o);}')
for question, expected in [
    ('Explain the main lab instruments and when I would use each one.', 'Start with the available resources'),
    ('Help me plan a measurement. Ask me about my signal and available equipment first.', 'Define the measurement'),
    ('Help me outline a lab report using only the observations I provide.', 'Build a report'),
    ('xyz-undocumented topic', 'Local catalogue unavailable'),
]:
    browser('fill', '#input', question)
    browser('click', '#send')
    wait('!document.querySelector("#send").disabled')
    assert ev('document.querySelector(".msg-assistant:last-of-type")?.textContent.includes('+json.dumps(expected)+') || Array.from(document.querySelectorAll(".msg-assistant")).at(-1)?.textContent.includes('+json.dumps(expected)+')')
assert ev('window.aiCalls===0')
browser('click', '#prompt-library summary')
wait('document.querySelector("#prompt-dialog").open')
assert ev('document.activeElement.id==="prompt-search"')
browser('press', 'Shift+Tab')
assert ev('document.querySelector("#prompt-dialog").contains(document.activeElement)')
browser('screenshot', str(OUT / 'prompts-modal-mobile.png'))
accessibility('prompt-dialog')
browser('click', '#prompt-cards button')
wait('!document.querySelector("#prompt-dialog").open')
assert ev('document.activeElement.id==="input" && !!document.querySelector("#input").value')
browser('click', '#prompt-library summary')
wait('document.querySelector("#prompt-dialog").open')
browser('press', 'Escape')
wait('!document.querySelector("#prompt-dialog").open && !document.querySelector("#prompt-library").open')
assert ev('document.documentElement.scrollWidth<=innerWidth')
browser('click', '#toggle-panel')
browser('click', '.panel-section-toggle')
assert ev('document.querySelector(".panel-section-toggle").getAttribute("aria-expanded")==="false"')
browser('press', 'Enter')
assert ev('document.querySelector(".panel-section-toggle").getAttribute("aria-expanded")==="true"')
browser('click', '#toggle-panel')

# Confirm only against the development simulator, with a delayed real mock call.
assert ev('(async()=>{const d=await (await window.realFetch("http://127.0.0.1:5001/api/health")).json();return d.instrument==="mock";})()')
ev('window.fetch=window.realFetch')
browser('fill', '#input', 'set timebase to 1ms')
browser('click', '#send')
wait('document.querySelector("#confirm-bar").classList.contains("active")')
ev('window.confirmCalls=0;window.fetch=(u,o)=>{if(String(u).includes("/api/instrument/set")&&o?.body&&JSON.parse(o.body).confirmed){window.confirmCalls++;return new Promise(r=>setTimeout(()=>r(window.realFetch(u,o)),1500));}return window.realFetch(u,o);};document.querySelector("#btn-y").click();document.querySelector("#btn-y").click();')
assert ev('document.querySelector("#btn-y").disabled && document.querySelector("#btn-n").disabled && document.querySelector("#send").disabled && document.querySelector("#btn-clear").disabled')
assert ev('(async()=>{document.querySelector("#prompt-library").open=true;await new Promise(r=>setTimeout(r,30));if(!document.querySelector("#prompt-dialog").open)throw Error("Prompt dialog did not open");document.querySelector("#close-prompts").click();return !document.querySelector("#prompt-dialog").open&&document.querySelector("#send").disabled;})()'), 'Closing prompt picker does not clear the pending approval busy state'
wait('!document.querySelector("#send").disabled && !document.querySelector("#confirm-bar").classList.contains("active")')
assert ev('window.confirmCalls===1 && document.querySelector("#messages").getAttribute("aria-busy")==="false"')
ev('window.fetch=window.realFetch')
browser('set', 'viewport', '1440', '1000')
browser('screenshot', str(OUT / 'chat-recovery-desktop.png'))
accessibility('chat')
assert not browser('errors').get('errors')
print('PASS catalogue retry without reload, offline guides, retained reader on failure, page retry/validation, bounded draft, zero-AI local starters/fallback, modal keyboard focus/escape, serialized mock approval and mobile overflow.')

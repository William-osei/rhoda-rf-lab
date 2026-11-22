"""Verify the actual owned desktop Edge window, with a temporary test profile.

Start RHODA.exe with --data-dir <temporary directory> --debug-port 9876.
Normal user launches do not enable browser debugging. All practice is simulated.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8765')
parser.add_argument('--cdp', default='9876')
parser.add_argument('--output', default='.tmp/desktop-native')
args = parser.parse_args()
binary = str(Path.home()/'.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe')
output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True)
session = 'rhoda-desktop-native'
checks = []

def browser(*command):
    # Inherited anonymous capture pipes can keep a Windows CLI daemon call open.
    with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as stdout, tempfile.TemporaryFile(mode='w+', encoding='utf-8') as stderr:
        process = subprocess.run([binary, '--session', session, '--cdp', args.cdp, '--json', *command], stdout=stdout, stderr=stderr, timeout=60)
        stdout.seek(0); raw = stdout.read(); stderr.seek(0)
        assert process.returncode == 0, stderr.read()
        result = json.loads(raw)
    assert result['success'], result
    return result['data']

def evaluate(code): return browser('eval', code).get('result')

def wait(condition):
    evaluate('(async()=>{for(let i=0;i<300;i++){if('+condition+')return true;await new Promise(r=>setTimeout(r,50));}throw Error("Desktop UI did not become ready")})()')

def clean():
    assert not browser('errors').get('errors')
    assert evaluate('document.documentElement.scrollWidth<=innerWidth')

def home():
    browser('click', '.desktop-home-link')
    wait('document.querySelector("#service-card")?.dataset.state==="ready" && document.querySelector("#library-card")?.dataset.state==="ready" && document.querySelector("#knowledge-card")?.dataset.state==="ready"')

browser('get','url')  # Connect to the already-running native app, not a new browser.
assert args.url in browser('get','url')['url']
browser('errors','--clear')
browser('set','viewport','1440','1000')
wait('document.querySelector("#service-card")?.dataset.state==="ready" && document.querySelector("#library-card")?.dataset.state==="ready" && document.querySelector("#knowledge-card")?.dataset.state==="ready"')
assert evaluate('document.querySelectorAll(".workspace-card").length===6')
assert evaluate('document.querySelector("#knowledge-status").textContent.includes("Canonical") && document.querySelector("#knowledge-detail").textContent.includes("corpus")')
assert evaluate('(async()=>{const r=await fetch("/api/health");return r.headers.get("Content-Security-Policy")?.includes("connect-src \'self\'")&&(await r.json()).instrument==="mock"})()')
assert evaluate('(async()=>!(await (await fetch("/api/ai/status")).json()).configured)()')
browser('screenshot', str(output/'app-home-desktop.png')); clean()
accessibility=browser('a11y'); (output/'home-accessibility.json').write_text(json.dumps(accessibility,indent=2),encoding='utf-8')
assert not accessibility.get('violations'), accessibility.get('violations')
checks.append('Native app home: six sections, live simulator, local library, canonical corpus identity, cloud AI disabled, no accessibility violations')

browser('click','.workspace-card[href="chat.html"]'); wait('!!document.querySelector("#send")&&!document.querySelector("#send").disabled')
assert evaluate('document.querySelector("#link-xr").target!=="_blank"')
browser('fill','#input','Explain probe compensation'); browser('click','#send')
wait('!document.querySelector("#send").disabled&&document.querySelectorAll(".msg").length>1')
assert 'compensation' in evaluate('document.querySelector("#messages").textContent').lower()
clean(); checks.append('Source-linked offline chat and same-window section navigation')
home(); browser('click','.workspace-card[href="library.html"]')
wait('document.querySelectorAll("#results .card").length>0')
browser('fill','#query','probe compensation'); browser('click','#search-form .primary')
wait('document.querySelectorAll("#results .card").length>0 && !document.querySelector("#status").textContent.includes("Searching")')
browser('click','#results .card:first-child button'); wait('!!document.querySelector("#page-text")')
assert evaluate('document.querySelector("#page-text").textContent.length>30')
assert evaluate('(async()=>{const a=[...document.querySelectorAll("#reader a")].find(a=>a.textContent.includes("Open original at"));const r=await fetch(a.href);return r.ok&&r.headers.get("Content-Type").includes("application/pdf")&&(await r.blob()).size>100})()')
clean(); checks.append('Real catalogue search, extracted document page and original PDF from the same app service')

home(); browser('click','.workspace-card[href="practice.html"]')
wait('document.querySelector("#data-status")?.dataset.fresh==="true"')
browser('fill','#scale','0.5'); browser('click','[data-input="scale"]'); wait('!document.querySelector("#approval").hidden'); browser('click','#approve')
wait('document.querySelector("#approval").hidden&&document.querySelector("#data-status").dataset.fresh==="true"')
assert evaluate('document.querySelector("#readout").textContent.includes("0.5")')
clean(); checks.append('Same-origin simulator setting preview, approval and fresh readback')

home(); browser('click','.workspace-card[href="spatial-bench.html"]')
wait('document.querySelector("#instrument-view canvas")&&document.querySelector("#anatomy-list button")&&document.querySelector("#data-status").dataset.fresh==="true"')
browser('select','#panel-topic','Ch 2'); assert 'Ch 2' in evaluate('document.querySelector("#inspect-status").textContent')
clean(); checks.append('3D scope model and part inspection')

home(); browser('click','.workspace-card[href="instructor.html"]'); wait('document.querySelector("#status")?.textContent.startsWith("Updated")')
assert evaluate('Number(document.querySelector("#total-logs").textContent)>0'); clean()
checks.append('Desktop journal visible in instructor records')

home(); browser('click','.workspace-card[href="index.html"]')
wait('document.querySelector("#avatar-style")&&!document.querySelector("#avatar-style").disabled&&!document.querySelector("#avatar-style option[value=human]").disabled')
assert evaluate('document.querySelector("#scene-container canvas")!==null')
browser('select','#avatar-style','human'); wait('document.querySelector("#companion-animation").options.length>=5')
assert evaluate('document.querySelector("#avatar-style").value==="human"&&!document.querySelector("#avatar-status").textContent.includes("unavailable")')
clean(); checks.append('Spatial lab and bundled human companion load under the offline desktop policy')
home(); browser('screenshot',str(output/'app-home-desktop.png')); clean()
result={'url':args.url,'checks':checks,'runtime_errors':[],'home_accessibility_violations':len(accessibility.get('violations',[])),'home_accessibility_incomplete':len(accessibility.get('incomplete',[]))}
(output/'browser-verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))

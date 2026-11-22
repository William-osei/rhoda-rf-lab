"""Prompt library and guided-task regression. No live AI provider calls."""

import json
import os
import subprocess
import urllib.request
from pathlib import Path

BIN = os.environ["AGENT_BROWSER_BIN"]
OUT = Path(os.environ.get("RHODA_TEST_OUTPUT", ".tmp/browser-check"))
OUT.mkdir(parents=True, exist_ok=True)


def browser(*args):
    p = subprocess.run(
        [BIN, "--session", "rhoda-chrome", "--json", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=40,
    )
    result = json.loads(p.stdout)
    assert result.get("success"), result
    return result["data"]


def evaluate(js):
    return browser("eval", js).get("result")


def wait(js):
    evaluate(
        f"(async()=>{{for(let i=0;i<100;i++){{if({js})return true;await new Promise(r=>setTimeout(r,50));}}throw Error('UI timeout');}})()"
    )


def send(text):
    browser("fill", "#input", text)
    browser("click", "#send")
    wait("!document.querySelector('#send').disabled")


def state():
    return json.load(
        urllib.request.urlopen("http://127.0.0.1:5001/api/instrument/state")
    )["result"]


assert (
    json.load(urllib.request.urlopen("http://127.0.0.1:5001/api/health"))["instrument"]
    == "mock"
)
browser("open", "http://127.0.0.1:8081/chat.html")
wait("document.querySelector('#lab-domain').options.length===9")
evaluate("""window.originalFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('/api/ai/chat')?Promise.resolve(new Response(JSON.stringify({ok:false,error:'AI is not configured (test stub)'}),{status:503,headers:{'Content-Type':'application/json'}})):window.originalFetch(url,options)""")
evaluate("document.querySelector('#chat-settings').open=true")
browser("select", "#lab-domain", "general")
browser("click", "#btn-clear")
browser("click", "#prompt-library summary")
assert evaluate("document.querySelectorAll('[data-prompt]').length") == 36
assert evaluate("document.querySelector('#guide-picker').options.length") == 10
browser("select", "#lab-domain", "network")
assert evaluate("document.querySelectorAll('[data-prompt]').length") == 4
browser("fill", "#prompt-search", "calibration")
assert evaluate("document.querySelectorAll('[data-prompt]').length") >= 1
browser("click", '[data-prompt="network-2"]')
assert "calibration" in evaluate("document.querySelector('#input').value")
assert not evaluate("document.querySelector('#messages').textContent.includes('YOU')")
evaluate("document.querySelector('#prompt-library').open=true")
browser("fill", "#prompt-search", "zz-no-match")
assert evaluate("document.querySelectorAll('[data-prompt]').length") == 0
browser("fill", "#prompt-search", "")
before = state()
send("set timebase to 2ms")
assert state() == before and "guidance only" in evaluate(
    "document.querySelector('#messages').textContent"
)
assert not evaluate(
    "document.querySelector('#confirm-bar').classList.contains('active')"
)
browser("select", "#assistant-mode", "report")
browser("select", "#answer-depth", "detailed")
browser("fill", "#model-context", "Model not yet identified")
context = evaluate(
    "(async()=>{const m=await import('/src/labTopics.ts');return m.labContext(document.querySelector('#lab-domain').value,document.querySelector('#assistant-mode').value,document.querySelector('#model-context').value,document.querySelector('#answer-depth').value)})()"
)
assert (
    "supplied evidence" in context
    and "Detailed explanation" in context
    and "Model not yet identified" in context
)
browser("select", "#answer-source", "ai")
send("Explain S11 briefly")
assert "AI is not configured" in evaluate(
    "document.querySelector('#messages').textContent"
)
assert state() == before
browser("select", "#guide-picker", "experiment-record")
browser("click", "#start-guide")
assert "State the research question" in evaluate(
    "document.querySelector('#messages').textContent"
)
send("next step")
assert "[step 2/5]" in evaluate("document.querySelector('#messages').textContent")
send("stop workflow")
assert "Guided task stopped" in evaluate(
    "document.querySelector('#messages').textContent"
)
assert state() == before
browser("select", "#lab-domain", "general")
browser("screenshot", str((OUT / "chat-library.png").resolve()), "--full")
errors = browser("errors")
assert not errors.get("errors"), errors
checks = [
    "36 cards and 10 guides available",
    "topic filter",
    "text search and empty result",
    "card inserts editable draft without sending",
    "unsupported topic blocks device command",
    "mode/model/depth context assembled",
    "missing AI configuration is explicit",
    "offline guide advances and stops without device mutations",
]
(OUT / "chat-library-results.json").write_text(
    json.dumps(
        {"checks_passed": checks, "page_errors": errors, "live_ai_tested": False},
        indent=2,
    ),
    encoding="utf-8",
)
print(json.dumps({"checks_passed": checks}, indent=2))

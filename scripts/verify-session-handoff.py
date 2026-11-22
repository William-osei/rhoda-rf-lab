"""Local browser -> journal -> other RHODA surfaces. Requires mock backend."""

import json
import os
import subprocess
import urllib.request
import time
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
    r = json.loads(p.stdout)
    assert r.get("success"), r
    return r["data"]


def evaluate(js):
    return browser("eval", js).get("result")


def wait(js):
    evaluate(
        f"(async()=>{{for(let i=0;i<120;i++){{if({js})return true;await new Promise(r=>setTimeout(r,50));}}throw Error('Timeout');}})()"
    )


def logs(sid):
    return json.load(
        urllib.request.urlopen(
            "http://127.0.0.1:5001/api/session/logs?session_id=" + sid
        )
    )["logs"]


assert (
    json.load(urllib.request.urlopen("http://127.0.0.1:5001/api/health"))["instrument"]
    == "mock"
)
browser("open", "http://127.0.0.1:8081/chat.html")
wait("document.querySelector('#lab-domain').options.length===9")
browser("click", "#btn-clear")
browser("select", "#lab-domain", "network")
browser("select", "#assistant-mode", "diagnose")
browser("select", "#answer-depth", "detailed")
browser("fill", "#model-context", "Unidentified VNA")
browser("click", "#lab-domain")  # commit model field change
event = evaluate(
    "(async()=>{const {sessionLogger:s}=await import('/src/session.ts');return s.logUserInput('Handoff regression: <img src=x onerror=alert(1)>');})()"
)
sid = event["session_id"]
wait(
    "document.querySelector('#session-status').textContent.includes('local journal ready')"
)
for _ in range(50):
    if any(e.get("event_id") == event["event_id"] for e in logs(sid)):
        break
    time.sleep(0.1)
else:
    raise AssertionError("Event did not reach journal")
browser("open", "http://127.0.0.1:8081/practice.html")
same = evaluate(
    "(async()=>{const {sessionLogger:s}=await import('/src/session.ts');return {id:s.getSessionId(),history:s.getConversationHistory()};})()"
)
assert same["id"] == sid and any(
    "Handoff regression" in t["content"] for t in same["history"]
)
context = evaluate(
    "(async()=>{const m=await import('/src/assistantContext.ts');return m.sharedAssistanceContext();})()"
)
assert "Unidentified VNA" in context and "Detailed explanation" in context
result = evaluate(
    "(async()=>{const m=await import('/src/instrument.ts');return m.executeFunction({name:'set_timebase',params:{timebase_s_div:0.002}});})()"
)
assert result["status"] == "error" and "guidance only" in result["error"]
browser("open", "http://127.0.0.1:8081/chat.html")
wait("document.querySelector('#lab-domain').value==='network'")
assert "Handoff regression" in evaluate(
    "document.querySelector('#messages').textContent"
)
assert evaluate("document.querySelector('#messages img')===null")
# An acknowledged retry must not duplicate the same event.
data = json.dumps(event).encode()
req = urllib.request.Request(
    "http://127.0.0.1:5001/api/session/log",
    data=data,
    headers={"Content-Type": "application/json"},
)
assert json.load(urllib.request.urlopen(req))["inserted"] is False
assert len([e for e in logs(sid) if e.get("event_id") == event["event_id"]]) == 1
# Queue a record while the journal request fails, then retry the retained outbox.
evaluate(
    "window.savedFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('/api/session/log')?Promise.resolve(new Response('{}',{status:503})):window.savedFetch(url,options)"
)
offline = evaluate(
    "(async()=>{const {sessionLogger:s}=await import('/src/session.ts');return s.logUserInput('Offline outbox regression');})()"
)
wait("(await import('/src/session.ts')).sessionLogger.getSyncStatus().error?.includes('unavailable')")
evaluate("window.fetch=window.savedFetch")
evaluate(
    "(async()=>{const {sessionLogger:s}=await import('/src/session.ts');await s.flush();return true;})()"
)
assert any(e.get("event_id") == offline["event_id"] for e in logs(sid))
browser("open", "http://127.0.0.1:8081/instructor.html")
wait("document.querySelector('#transcript').textContent.includes('Handoff regression')")
assert evaluate("document.querySelector('#transcript img')===null")
browser("screenshot", str((OUT / "instructor-journal.png").resolve()))
browser("open", "http://127.0.0.1:8081/chat.html")
wait("document.querySelector('#lab-domain').options.length===9")
browser("click", "#btn-clear")
new = evaluate(
    "(async()=>{const {sessionLogger:s}=await import('/src/session.ts');return s.getSessionId()})()"
)
assert new != sid and any(e.get("event_id") == event["event_id"] for e in logs(sid))
browser("select", "#lab-domain", "general")
errors = browser("errors")
assert not errors.get("errors"), errors
checks = [
    "event reaches local journal",
    "same session survives page handoff",
    "shared conversation history",
    "shared assistance context",
    "avatar adapter honors topic boundary",
    "chat restores recorded text safely",
    "retries do not duplicate events",
    "instructor displays shared journal safely",
    "new session preserves earlier records",
    "offline journal failure retains record and retries",
]
(OUT / "session-handoff-results.json").write_text(
    json.dumps(
        {
            "checks_passed": checks,
            "session_id": sid,
            "page_errors": errors,
            "physical_voice_tested": False,
        },
        indent=2,
    ),
    encoding="utf-8",
)
print(json.dumps({"checks_passed": checks}, indent=2))

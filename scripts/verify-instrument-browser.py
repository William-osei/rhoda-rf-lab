"""Browser regression checks against a running mock backend only.

Set AGENT_BROWSER_BIN to the agent-browser executable. Start Flask on 5001
and Vite on 8081, then run this file. No cloud AI or hardware is used.
"""

import json
import os
from pathlib import Path
import subprocess
import urllib.request

BIN = os.environ["AGENT_BROWSER_BIN"]
OUT = Path(os.environ.get("RHODA_TEST_OUTPUT", ".tmp/browser-check"))
OUT.mkdir(parents=True, exist_ok=True)
SESSION = "rhoda-chrome"
checks = []


def browser(*args):
    p = subprocess.run(
        [BIN, "--session", SESSION, "--json", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=40,
    )
    result = json.loads(p.stdout)
    if not result.get("success"):
        raise AssertionError(result)
    return result["data"]


def evaluate(js):
    return browser("eval", js).get("result")


def state():
    return json.load(
        urllib.request.urlopen("http://127.0.0.1:5001/api/instrument/state", timeout=5)
    )["result"]


def wait(js):
    evaluate(
        f"(async()=>{{for(let i=0;i<100;i++){{if({js})return true;await new Promise(r=>setTimeout(r,50));}}throw new Error('UI wait timed out');}})()"
    )


def send(text):
    browser("fill", "#input", text)
    browser("click", "#send")
    wait("!document.querySelector('#send').disabled")


def approve():
    browser("click", "#btn-y")
    wait("!document.querySelector('#confirm-bar').classList.contains('active')")


def pending():
    return evaluate(
        "document.querySelector('#confirm-bar').classList.contains('active')"
    )


def record(name):
    checks.append(name)


health = json.load(
    urllib.request.urlopen("http://127.0.0.1:5001/api/health", timeout=5)
)
assert health["instrument"] == "mock", "Refusing browser mutations outside mock mode"
browser("open", "http://127.0.0.1:8081/chat.html")
browser("click", "#toggle-panel")
wait("document.querySelector('#lbl-be').textContent.includes('online')")
evaluate("document.querySelector('#chat-settings').open=true")
browser("select", "#lab-domain", "general")
browser("click", "#btn-clear")
initial = state()["timebase_scale"]
send("set timebase to 3ms")
assert pending() and state()["timebase_scale"] == initial
record("Preview does not mutate backend state")
send("not okay")
assert pending() and state()["timebase_scale"] == initial
record("Ambiguous/negative approval is not accepted")
browser("click", "#btn-n")
wait("!document.querySelector('#confirm-bar').classList.contains('active')")
assert state()["timebase_scale"] == initial
record("Denial preserves backend state")
send("set timebase to 3ms")
approve()
assert state()["timebase_scale"] == 0.003
assert "3.00 ms/div" in evaluate("document.body.innerText")
record("Approved change reaches backend and visible readback")
send("measure frequency on CH1")
assert pending()
approve()
assert "1000" in evaluate("document.querySelector('#messages').innerText")
record("Measurement preview/approval returns 1000 Hz mock result")
old = state()["channels"]["1"]["vertical_scale"]
send("set vertical scale to 200 V")
assert not pending() and state()["channels"]["1"]["vertical_scale"] == old
assert "Expected finite number" in evaluate(
    "document.querySelector('#messages').innerText"
)
record("Invalid scale rejected visibly without mutation")
# Deliberately change all trigger fields so the workflow must restore each one.
result = evaluate(
    "(async()=>{const m=await import('/src/instrument.ts');await m.executeFunction({name:'set_trigger',params:{source:2,slope:'falling',mode:'normal'}});return await m.confirmPending();})()"
)
assert result["status"] == "ok"
assert state()["trigger"]["source"] == "CH2"
assert state()["trigger"]["slope"] == "NEGative"
assert state()["trigger"]["mode"] == "NORMal"
browser("click", '[data-wf="measure-1khz-sine"]')
for step in range(2, 11):
    send("next step")
    if pending():
        approve()
send("next step")
final = state()
assert final["timebase_scale"] == 0.0005
assert final["channels"]["1"]["vertical_scale"] == 1.0
assert final["channels"]["1"]["probe_attenuation"] == 10.0
assert final["trigger"]["source"] == "CH1" and final["trigger"]["slope"] == "POSitive"
assert final["trigger"]["mode"] == "AUTO" and final["trigger"]["level"] == 0.0
assert "workflow complete" in evaluate("document.querySelector('#messages').innerText")
record("Ten-step sine workflow completes with all trigger fields and measurement")
browser("screenshot", str((OUT / "chat-workflow.png").resolve()))
# Exercise the exact shared module used by XR, without claiming a headset test.
result = evaluate(
    "(async()=>{const m=await import('/src/instrument.ts');const p=await m.executeFunction({name:'set_timebase',params:{timebase_s_div:0.004},confirmed:true});return p;})()"
)
assert (
    result["status"] == "confirmation_required" and state()["timebase_scale"] == 0.0005
)
result = evaluate(
    "(async()=>{const m=await import('/src/instrument.ts');return await m.confirmPending();})()"
)
assert result["status"] == "ok" and state()["timebase_scale"] == 0.004
record(
    "XR shared adapter uses backend; model-supplied confirmed flag cannot bypass approval"
)
errors = browser("errors")
(OUT / "browser-results.json").write_text(
    json.dumps(
        {
            "checks_passed": checks,
            "page_errors": errors,
            "mode": "mock; AI, voice and physical XR not tested",
        },
        indent=2,
    ),
    encoding="utf-8",
)
print(json.dumps({"checks_passed": checks, "page_errors": errors}, indent=2))

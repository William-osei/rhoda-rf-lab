"""Run against local mock mode; tests UI -> API -> model -> rendered result."""

import json
import os
from pathlib import Path
import subprocess
import urllib.request

BIN = os.environ["AGENT_BROWSER_BIN"]
OUT = Path(os.environ.get("RHODA_TEST_OUTPUT", ".tmp/browser-check"))
OUT.mkdir(parents=True, exist_ok=True)


def browser(*args):
    p = subprocess.run(
        [BIN, "--session", "rhoda-practice", "--json", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=45,
    )
    r = json.loads(p.stdout)
    assert r.get("success"), r
    return r["data"]


def evaluate(js):
    return browser("eval", js).get("result")


def wait(js):
    evaluate(
        f"(async()=>{{for(let i=0;i<100;i++){{if({js})return true;await new Promise(r=>setTimeout(r,50));}}throw Error('Timed out');}})()"
    )


def state():
    return json.load(
        urllib.request.urlopen("http://127.0.0.1:5001/api/instrument/state")
    )["result"]


def idle():
    wait("!document.querySelector('#refresh').disabled")


def approve():
    browser("click", "#approve")
    idle()


def scenario(name):
    browser("select", "#scenario", name)
    browser("click", "#load")
    idle()


def measure(kind):
    browser("click", f'[data-measure="{kind}"]')
    approve()
    return evaluate("document.querySelector('#measurement').textContent")


assert (
    json.load(urllib.request.urlopen("http://127.0.0.1:5001/api/health"))["instrument"]
    == "mock"
)
browser("open", "http://127.0.0.1:8081/practice.html")
idle()
scenario("sine")
browser("select", "#channel-select", "2")
assert evaluate("document.querySelector('#scale-label').textContent") == "CH2 scale (V/div)"
assert evaluate("document.querySelector('#measure-source').value") == "CH1"
browser("select", "#measure-source", "CH2")
assert "no_signal" in measure("frequency")
browser("click", "#channel-enabled")
approve()
assert state()["channels"]["2"]["enabled"] is True
assert "1000 Hz" in measure("frequency")
browser("click", "#channel-enabled")
approve()
assert state()["channels"]["2"]["enabled"] is False
assert "no_signal" in measure("frequency")
browser("select", "#measure-source", "CH1")
browser("select", "#channel-select", "1")
original = state()["timebase_scale"]
browser("fill", "#timebase", "0.0005")
browser("click", '[data-setting="timebase.scale"]')
wait("!document.querySelector('#approval').hidden")
assert state()["timebase_scale"] == original
browser("click", "#cancel")
idle()
assert state()["timebase_scale"] == original
browser("fill", "#timebase", "0.0005")
browser("click", '[data-setting="timebase.scale"]')
approve()
assert state()["timebase_scale"] == 0.0005
assert "1000 Hz" in measure("frequency")
scenario("offset")
assert "1 V" in measure("mean")
browser("select", "#coupling", "ACLimit")
browser("click", '[data-setting="channel.{channel}.coupling"]')
approve()
assert "0 V" in measure("mean")
scenario("square")
assert "500 Hz" in measure("frequency")
scenario("disconnected")
assert "no_signal" in measure("frequency")
scenario("sine")
browser("select", "#coupling", "DCLimit")
browser("click", '[data-setting="channel.{channel}.coupling"]')
approve()
assert "1000 Hz" in measure("frequency")
# Inspect the generated download payload without changing application code.
evaluate(
    "window.exported=null;window.originalCreate=URL.createObjectURL;URL.createObjectURL=(blob)=>{window.exported=blob;return window.originalCreate(blob)}"
)
browser("click", "#export")
payload = evaluate("(async()=>JSON.parse(await window.exported.text()))()")
assert payload["mode"] == "training" and len(payload["frame"]["voltage_v"]) == 1001
assert set(payload["frame"]["traces"]) == {"CH1", "CH2", "CH3", "CH4"}
assert payload["measurement"]["value"] == 1000
errors = browser("errors")
assert not errors.get("errors"), errors
browser("screenshot", str(OUT / "practice-bench.png"))
checks = [
    "preview and cancel preserve state",
    "CH2 selector updates controls, measurements and enabled state independently",
    "approval changes backend timebase",
    "sine frequency",
    "offset mean",
    "AC removes DC",
    "square frequency",
    "no signal returns no value",
    "evidence export contains samples and provenance",
    "evidence export contains coherent traces for all four channels",
]
(OUT / "practice-results.json").write_text(
    json.dumps({"checks_passed": checks, "page_errors": errors}, indent=2),
    encoding="utf-8",
)
print(json.dumps({"checks_passed": checks}, indent=2))

"""Production UI smoke check; no /src imports or model internals.

Uses an owned temporary browser profile, a local simulator, visible controls and
their live feedback. Does not accept headset/hardware or provider behavior.
"""
import importlib.util
import json
import os
from pathlib import Path

os.environ.setdefault('RHODA_BROWSER_URL', 'http://127.0.0.1:4173')
spec = importlib.util.spec_from_file_location('human_browser_helpers', Path(__file__).with_name('verify-human-animation-controls.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
run, evaluate, wait, click, ready = helpers.run, helpers.evaluate, helpers.wait, helpers.click, helpers.ready
EVIDENCE = Path('.tmp/human-animation-preview').resolve()
EVIDENCE.mkdir(parents=True, exist_ok=True)


def select_character(style, count):
    if evaluate('document.body.classList.contains("focus")'):
        click('#focus-view')
    run('select', '#avatar-style', style)
    wait('!document.querySelector("#avatar-style").disabled&&document.querySelector("#avatar-style").value===' + json.dumps(style))
    wait('document.querySelector("#companion-animation").options.length===' + str(count))


def play_nod():
    run('select', '#companion-animation', 'nod')
    wait('!document.querySelector("#companion-animation-play").disabled')
    click('#companion-animation-play')
    wait('document.querySelector("#companion-animation-status").textContent.startsWith("Playing Acknowledgement nod")&&!document.querySelector("#companion-animation-stop").disabled')


def main():
    report = {'url': helpers.BASE, 'scope': 'Production DOM/UI; no source module imports, rig instrumentation, hardware, speech or AI'}
    started = False
    try:
        run('open', 'about:blank', launch=True)
        started = True
        run('set', 'viewport', '1440', '1000')
        run('open', helpers.BASE + '/')
        ready()
        assert evaluate('Array.from(document.querySelector("#avatar-style").options).map(o=>o.value)') == ['rhoda', 'human', 'hidden']
        report['characters'] = {}
        for style, count in [('rhoda', 48), ('human', 5)]:
            select_character(style, count)
            if not evaluate('document.querySelector("#robot-motion").checked'):
                click('#robot-motion')
            play_nod()
            click('#companion-animation-stop')
            wait('document.querySelector("#companion-animation-stop").disabled&&document.querySelector("#companion-animation-status").textContent.startsWith("Ready")')
            # Use the longer silent explanation preview for pause/resume so
            # its natural bounded ending cannot race the short nod check.
            run('select', '#companion-animation', 'explain')
            click('#companion-animation-play')
            wait('document.querySelector("#companion-animation-status").textContent.startsWith("Playing")')
            click('#robot-motion')
            wait('document.querySelector("#companion-animation-status").textContent.startsWith("Animation paused")')
            assert not evaluate('document.querySelector("#robot-motion").checked')
            click('#robot-motion')
            wait('document.querySelector("#companion-animation-status").textContent.startsWith("Playing")')
            click('#companion-animation-stop')
            wait('document.querySelector("#companion-animation-stop").disabled&&document.querySelector("#companion-animation-status").textContent.startsWith("Ready")')
            click('#robot-frame')
            run('screenshot', str(EVIDENCE/(style + '-full-body.png')))
            run('select', '#walk-speed', '0.45')
            click('#station-left' if style == 'rhoda' else '#station-right')
            wait('document.querySelector("#movement-status").textContent.startsWith("Walking")')
            assert evaluate('document.querySelector("#robot-wave").disabled')
            click('#companion-stop')
            wait('document.querySelector("#movement-status").textContent.startsWith("Ready to walk")')
            report['characters'][style] = {'previewCount': count, 'nodPlayStop': 'passed', 'previewPauseResume': 'passed', 'navigationWalkStop': 'passed'}
            print('PASS production', style, count, 'previews, bounded nod, pause/resume and walk/Stop', flush=True)

        # A short landscape viewport leaves less room below the fixed header.
        # Save the actual renders for separate visual head/foot inspection.
        run('set', 'viewport', '615', '524')
        for style, count in [('rhoda', 48), ('human', 5)]:
            select_character(style, count)
            click('#robot-frame')
            wait('document.body.classList.contains("focus")')
            assert evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            run('screenshot', str(EVIDENCE/(style + '-short-focus.png')))
            click('#focus-view')
            click('#xr-recenter')
            if not evaluate('document.body.classList.contains("focus")'):
                click('#focus-view')
            wait('document.querySelector("#movement-status").textContent.startsWith("Arrived")&&document.querySelector("#xr-status").textContent.startsWith("Companion arrived")', timeout=45)
            run('screenshot', str(EVIDENCE/(style + '-short-arrival.png')))
        report['shortViewport'] = '615x524 Focus/full-body and summoned-arrival renders captured for both characters; horizontal fit and arrival feedback asserted'
        if evaluate('document.body.classList.contains("focus")'):
            click('#focus-view')
        # Explicit model hiding also removes its animation controls.
        run('select', '#avatar-style', 'hidden')
        assert evaluate('document.querySelector("#companion-animation").getClientRects().length===0')
        select_character('human', 5)
        run('set', 'viewport', '390', '844')
        assert evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        click('#robot-reset')
        run('screenshot', str(EVIDENCE/'human-controls-mobile.png'))
        mobile = run('a11y')
        assert not mobile.get('violations'), mobile.get('violations')
        (EVIDENCE/'mobile-a11y.json').write_text(json.dumps(mobile, indent=2), encoding='utf-8')
        run('set', 'viewport', '1440', '1000')
        desktop = run('a11y')
        assert not desktop.get('violations'), desktop.get('violations')
        (EVIDENCE/'desktop-a11y.json').write_text(json.dumps(desktop, indent=2), encoding='utf-8')
        report['runtimeErrors'] = run('errors').get('errors', [])
        assert not report['runtimeErrors'], report['runtimeErrors']
        report['productionSourceRequests'] = evaluate('performance.getEntriesByType("resource").filter(r=>new URL(r.name).pathname.startsWith("/src/")).map(r=>r.name)')
        assert not report['productionSourceRequests'], report['productionSourceRequests']
        report['accessibility'] = 'Zero desktop/mobile automated violations; 390px fit'
        (EVIDENCE/'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print('PASS production human-only controls, hide, mobile fit/accessibility and empty runtime errors; no /src requests', flush=True)
    except Exception:
        if started:
            diagnostic = {'console': run('console'), 'errors': run('errors'), 'snapshot': run('snapshot', '-i')}
            (EVIDENCE/'failure.json').write_text(json.dumps(diagnostic, indent=2), encoding='utf-8')
        raise
    finally:
        if started:
            run('close')


if __name__ == '__main__':
    main()

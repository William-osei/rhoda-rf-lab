"""Focused production framing renders, separate from broad animation checks.

Real DOM navigation/arrival only; no source imports, camera/rig instrumentation,
hardware or providers. The resulting renders need human visual inspection.
"""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('human_production_helpers', Path(__file__).with_name('verify-human-animation-preview.py'))
production = importlib.util.module_from_spec(spec)
spec.loader.exec_module(production)
helpers = production.helpers
run, evaluate, wait, click, ready = helpers.run, helpers.evaluate, helpers.wait, helpers.click, helpers.ready
EVIDENCE = Path('.tmp/human-framing-preview').resolve()
EVIDENCE.mkdir(parents=True, exist_ok=True)


def main():
    report = {'url': helpers.BASE, 'scope': 'Focused production DOM/UI renders for separate visual inspection; no /src module imports or rig/camera instrumentation'}
    started = False
    try:
        run('open', 'about:blank', launch=True)
        started = True
        run('set', 'viewport', '615', '524')
        run('open', helpers.BASE + '/')
        ready()
        report['characters'] = {}
        for style, count in [('rhoda', 48), ('human', 5)]:
            production.select_character(style, count)
            if not evaluate('document.querySelector("#robot-motion").checked'):
                click('#robot-motion')
            run('select', '#walk-speed', '0.45')
            click('#station-left' if style == 'rhoda' else '#station-right')
            wait('document.querySelector("#movement-status").textContent.startsWith("Arrived")', timeout=45)
            click('#robot-frame')
            wait('document.body.classList.contains("focus")')
            assert evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            run('screenshot', str(EVIDENCE/(style + '-615x524-full-body.png')))
            click('#focus-view')
            click('#xr-recenter')
            if not evaluate('document.body.classList.contains("focus")'):
                click('#focus-view')
            wait('document.querySelector("#movement-status").textContent.startsWith("Arrived")&&document.querySelector("#xr-status").textContent.startsWith("Companion arrived")', timeout=45)
            run('screenshot', str(EVIDENCE/(style + '-615x524-arrival.png')))
            feedback = evaluate('({movement:document.querySelector("#movement-status").textContent,arrival:document.querySelector("#xr-status").textContent,headerBottom:document.querySelector("#xr-shell > header").getBoundingClientRect().bottom,footerTop:document.querySelector("#xr-shell > footer").getBoundingClientRect().top})')
            report['characters'][style] = {'viewport': '615x524', 'fullBody': 'Render captured for head/foot inspection', 'summonedArrival': 'Actual route arrived; render captured for head/header inspection', **feedback}
            print('PASS production framing route/feedback and renders', style, flush=True)
        report['runtimeErrors'] = run('errors').get('errors', [])
        assert not report['runtimeErrors'], report['runtimeErrors']
        report['productionSourceRequests'] = evaluate('performance.getEntriesByType("resource").filter(r=>new URL(r.name).pathname.startsWith("/src/")).map(r=>r.name)')
        assert not report['productionSourceRequests'], report['productionSourceRequests']
        (EVIDENCE/'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
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

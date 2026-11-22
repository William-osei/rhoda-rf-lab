"""Real mounted human rigs and desktop controls; local simulator only.

Creates its own browser profile, warms about:blank before navigation, and closes
only that session. Runtime wrappers are restored immediately after capturing the
existing assistant. No app source/build, speech, camera or equipment is changed.
"""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import urlparse
from uuid import uuid4

BROWSER = os.environ.get('RHODA_TEST_BROWSER', str(Path.home()/'.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'))
BASE = os.environ.get('RHODA_BROWSER_URL', 'http://127.0.0.1:8081').rstrip('/')
assert urlparse(BASE).hostname in ('127.0.0.1', 'localhost'), 'This harness only navigates the local development server'
SESSION = 'rhoda-human-controls-' + uuid4().hex[:10]
EVIDENCE = Path('.tmp/human-animation-controls').resolve()
EVIDENCE.mkdir(parents=True, exist_ok=True)
PROFILE = Path(tempfile.mkdtemp(prefix='rhoda-human-browser-')).resolve()


def run(*args, launch=False):
    command = [BROWSER, '--session', SESSION, '--json']
    if launch:
        command += ['--profile', str(PROFILE)]
    with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as output, tempfile.TemporaryFile(mode='w+', encoding='utf-8') as error:
        result = subprocess.run(command + list(args), stdout=output, stderr=error, timeout=55)
        output.seek(0)
        raw = output.read()
        error.seek(0)
        diagnostic = error.read()
    try:
        payload = json.loads(raw)
    except ValueError as problem:
        raise AssertionError(f'Browser {args[0]} returned invalid JSON: {raw[-1200:]} {diagnostic[-1200:]}') from problem
    assert result.returncode == 0 and payload.get('success'), payload
    return payload['data']


def evaluate(code):
    return run('eval', code).get('result')


def wait(condition, timeout=35):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if evaluate('Boolean(' + condition + ')'):
                return
        except AssertionError as error:
            if 'Execution context was destroyed' not in str(error) and 'navigated or closed' not in str(error):
                raise
        time.sleep(.08)
    raise AssertionError('Human animation condition timed out: ' + condition)


def click(selector):
    evaluate('document.querySelector(' + json.dumps(selector) + ').scrollIntoView({block:"center"})')
    run('click', selector)


def ready():
    wait('document.querySelector("#avatar-style")&&!document.querySelector("#avatar-style").disabled&&document.querySelector("#companion-animation")')


def capture_runtime():
    evaluate('''(async()=>{
      const entry=await(await fetch('/src/index.ts')).text();
      const assistantURL=entry.match(/from ["']([^"']*rhode_schwarz[^"']*)["']/)[1];
      const styleURL=entry.match(/from ["']([^"']*avatarStyle[^"']*)["']/)[1];
      const styleText=await(await fetch(styleURL)).text();
      const animationURL=styleText.match(/from ["']([^"']*avatarAnimations[^"']*)["']/)[1];
      window.__humanStyles=await import(styleURL);
      window.__humanAnimations=await import(animationURL);
      const {RhodeSchwarzAssistant:A}=await import(assistantURL);
      const original=A.prototype.getMovementSnapshot;
      A.prototype.getMovementSnapshot=function(){
        A.prototype.getMovementSnapshot=original;
        window.__humanAssistant=this;
        return original.call(this);
      };
    })()''')
    wait('!!window.__humanAssistant')
    evaluate('''window.__humanPose=()=>{
      const style=window.__humanStyles.selectedAvatarStyle();
      const root=window.__humanAssistant.mesh;
      const target=style==='human'?root.getObjectByName('RHODA_ResearchCompanion'):root;
      const bones=[];
      target?.traverse(o=>{
        if(!o.isBone)return;
        let inCompanion=false;
        for(let p=o;p;p=p.parent)if(p.name==='RHODA_ResearchCompanion')inCompanion=true;
        if(style==='rhoda'&&inCompanion)return;
        bones.push({name:o.name,values:[...o.position.toArray(),...o.quaternion.toArray()]});
      });
      return {bones,position:root.position.toArray(),rotation:root.quaternion.toArray(),movement:window.__humanAssistant.getMovementSnapshot()};
    };
    window.__humanDelta=(a,b)=>{
      if(a.bones.length!==b.bones.length)throw Error('Rig changed while sampling pose');
      let all=0,legs=0;
      for(let i=0;i<a.bones.length;i++){
        if(a.bones[i].name!==b.bones[i].name)throw Error('Bone ordering changed');
        const delta=Math.max(...a.bones[i].values.map((v,j)=>Math.abs(v-b.bones[i].values[j])));
        all=Math.max(all,delta);
        if(/thigh|calf|foot|leg|knee/i.test(a.bones[i].name))legs=Math.max(legs,delta);
      }
      return {all,legs};
    };''')


def selected(style):
    run('select', '#avatar-style', style)
    wait('window.__humanStyles.selectedAvatarStyle()===' + json.dumps(style))
    if style != 'hidden':
        wait('window.__humanAnimations.getAvatarAnimationOptions(' + json.dumps(style) + ').length>0')


def animation_state(style):
    return evaluate('window.__humanAnimations.getAvatarAnimationSnapshot(' + json.dumps(style) + ')')


def pose_delta(duration=450):
    return evaluate('''(async()=>{const a=window.__humanPose();await new Promise(r=>setTimeout(r,'''+str(duration)+'''));const b=window.__humanPose();return {...window.__humanDelta(a,b),boneCount:a.bones.length,translation:Math.hypot(...a.position.map((v,i)=>v-b.position[i])),before:a.movement.phase,after:b.movement.phase};})()''')


def ensure_motion(enabled):
    if evaluate('document.querySelector("#robot-motion").checked') != enabled:
        click('#robot-motion')
    assert evaluate('document.querySelector("#robot-motion").checked') == enabled


def play(style, ident):
    run('select', '#companion-animation', ident)
    wait('!document.querySelector("#companion-animation-play").disabled')
    click('#companion-animation-play')
    wait('window.__humanAnimations.getAvatarAnimationSnapshot(' + json.dumps(style) + ').activeId===' + json.dumps(ident) + '&&window.__humanAnimations.getAvatarAnimationSnapshot(' + json.dumps(style) + ').phase==="playing"&&!document.querySelector("#companion-animation-stop").disabled&&document.querySelector("#companion-animation-status").textContent.trim().length>0')


def stop(style):
    if evaluate('!document.querySelector("#companion-animation-stop").disabled'):
        click('#companion-animation-stop')
    wait('!window.__humanAnimations.getAvatarAnimationSnapshot(' + json.dumps(style) + ').activeId')


def verify_character(style, report):
    selected(style)
    ensure_motion(True)
    click('#companion-stop')
    click('#robot-frame')
    assert evaluate('document.querySelector("#robot-controls").getClientRects().length>0')
    assert evaluate('!window.__humanAssistant.mesh.getObjectByName("RHODA_MasculineAndroid")')
    choices = evaluate('window.__humanAnimations.getAvatarAnimationOptions(' + json.dumps(style) + ')')
    ids = {choice['id'] for choice in choices}
    assert {'idle', 'nod', 'explain', 'walk'} <= ids, (style, choices)
    if style == 'rhoda':
        manifest = json.loads(Path('src/animation-manifest.json').read_text(encoding='utf-8'))
        expected = {'clip:' + category + ':' + Path(filename).stem for category, filenames in manifest.items() for filename in filenames}
        assert expected <= ids and len(choices) == len(expected) + 4, (style, len(choices), len(expected))
        assert evaluate('document.querySelector("#robot-wave").textContent.trim()') == 'Friendly gesture'
    else:
        assert len(choices) == 5 and 'greeting' in ids, choices
        assert evaluate('document.querySelector("#robot-wave").textContent.trim()') == 'Wave hello'
    assert evaluate('document.querySelector("#companion-animation").options.length') == len(choices)
    wait('window.__humanPose().bones.length>20')
    observations = {}
    for ident in ('idle', 'nod', 'explain', 'walk') + (('greeting',) if style == 'human' else ()):
        play(style, ident)
        delta = pose_delta(300)
        assert delta['all'] > 1e-5, (style, ident, delta)
        assert delta['translation'] < 1e-10, ('Preview translated the navigator', style, ident, delta)
        if ident == 'walk':
            assert delta['legs'] > 1e-4, ('Walking preview did not move leg bones', style, delta)
        observations[ident] = delta
        stop(style)

    play(style, 'walk')
    ensure_motion(False)
    wait('window.__humanAnimations.getAvatarAnimationSnapshot(' + json.dumps(style) + ').phase==="paused"')
    paused = pose_delta(600)
    assert paused['all'] < 1e-10 and paused['translation'] < 1e-10, (style, paused)
    ensure_motion(True)
    wait('window.__humanAnimations.getAvatarAnimationSnapshot(' + json.dumps(style) + ').phase==="playing"')
    assert pose_delta(500)['legs'] > 1e-4, ('Preview failed to resume', style)
    click('#robot-reset')
    wait('!window.__humanAnimations.getAvatarAnimationSnapshot(' + json.dumps(style) + ').activeId')
    assert evaluate('document.querySelector("#robot-motion").checked')
    click('#robot-turn')
    assert 'quarter turn' in evaluate('document.querySelector("#avatar-status").textContent')
    ensure_motion(False)
    click('#robot-reset')
    assert not evaluate('document.querySelector("#robot-motion").checked'), 'Reset changed saved pause'
    assert 'front' in evaluate('document.querySelector("#avatar-status").textContent')
    run('screenshot', str(EVIDENCE/(style+'-paused.png')))
    ensure_motion(True)

    # Navigation is a real UI route; bone checks use that mounted character.
    run('select', '#walk-speed', '0.45')
    click('#station-left' if style == 'rhoda' else '#station-right')
    wait('window.__humanAssistant.getMovementSnapshot().phase==="walking"')
    assert evaluate('document.querySelector("#robot-wave").disabled'), 'Gesture controls must defer to walking'
    assert evaluate('document.querySelector("#robot-wave").textContent.trim()') == ('Stop walking to gesture' if style == 'rhoda' else 'Stop walking to wave')
    walk = pose_delta(650)
    assert walk['translation'] > .02 and walk['legs'] > 1e-4, ('Navigation/gait did not advance', style, walk)
    ensure_motion(False)
    wait('window.__humanAssistant.getMovementSnapshot().phase==="paused"')
    pause_route = pose_delta(600)
    assert pause_route['translation'] < 1e-10 and pause_route['all'] < 1e-10, (style, pause_route)
    ensure_motion(True)
    wait('window.__humanAssistant.getMovementSnapshot().phase==="arrived"', timeout=45)
    click('#robot-frame')
    run('screenshot', str(EVIDENCE/(style+'-full-body.png')))
    report['characters'][style] = {'availableOptions': len(choices), 'optionLabels': [choice['label'] for choice in choices], 'previews': observations, 'pausedPreview': paused, 'walkingRoute': walk, 'pausedRoute': pause_route, 'arrival': 'passed', 'resetPreservesMotion': 'passed'}
    print('PASS', style, 'real idle/nod/explain/walk, stationary preview, frozen pause/resume, reset/turn and walking route/arrival', flush=True)


def verify_pending_switch(report):
    selected('rhoda')
    ensure_motion(True)
    click('#companion-stop')
    # Delay just one real lazy GLB fetch before releasing its original browser
    # transport. This exercises the real loader without abort/network errors.
    ident = evaluate('window.__humanAnimations.getAvatarAnimationOptions("rhoda").find(o=>o.id.startsWith("clip:dance:")&&o.availability==="lazy")?.id')
    assert ident, 'No unloaded catalogue clip remains for the late-load regression'
    filename = ident.rsplit(':', 1)[1] + '.glb'
    evaluate('''window.__humanHeldFetch=window.fetch;window.__humanClipHeld=false;
      window.fetch=function(input,init){
        const url=typeof input==='string'?input:input.url;
        if(url.includes(''' + json.dumps(filename) + ''')&&!window.__humanClipHeld){
          window.__humanClipHeld=true;
          return new Promise(resolve=>{window.__humanReleaseClip=()=>resolve(window.__humanHeldFetch.call(window,input,init));});
        }
        return window.__humanHeldFetch.call(window,input,init);
      };''')
    try:
        run('select', '#companion-animation', ident)
        click('#companion-animation-play')
        wait('window.__humanClipHeld&&window.__humanAnimations.getAvatarAnimationSnapshot("rhoda").phase==="loading"')
        selected('human')
        evaluate('window.fetch=window.__humanHeldFetch;const release=window.__humanReleaseClip;window.__humanReleaseClip=null;release()')
        wait('window.__humanAnimations.getAvatarAnimationOptions("rhoda").find(o=>o.id===' + json.dumps(ident) + ')?.availability==="ready"')
        assert not animation_state('rhoda')['activeId']
        assert evaluate('window.__humanStyles.selectedAvatarStyle()') == 'human'
        selected('rhoda')
        assert evaluate('window.__humanAssistant.currentAction===window.__humanAssistant.idleAction&&window.__humanAssistant.idleAction.isRunning()'), 'Late loaded clip interrupted restored original idle'
        assert pose_delta(450)['all'] > 1e-5, 'Restored idle did not animate'
        report['pendingClipSwitch'] = {'clip': ident, 'result': 'Real lazy GLB completion stayed cached; did not revive preview or override selected character/idle'}
    finally:
        evaluate('window.fetch=window.__humanHeldFetch;if(window.__humanReleaseClip){const release=window.__humanReleaseClip;window.__humanReleaseClip=null;release();}')
    print('PASS real pending-clip character switch, cached late completion and original idle restoration', flush=True)


def main():
    report = {'url': BASE, 'characters': {}, 'scope': 'Visible desktop browser, real mounted rigs; no speech, AI, headset or instrument acceptance'}
    started = False
    try:
        run('open', 'about:blank', launch=True)
        started = True
        run('set', 'viewport', '1440', '1000')
        run('open', BASE+'/')
        ready()
        run('snapshot', '-i')
        evaluate('localStorage.setItem("rhoda-avatar-style","robot");localStorage.setItem("rhoda-robot-motion","false")')
        run('reload')
        ready()
        capture_runtime()
        wait('window.__humanStyles.selectedAvatarStyle()==="human"')
        assert evaluate('Array.from(document.querySelector("#avatar-style").options).map(o=>o.value)') == ['rhoda', 'human', 'hidden']
        assert evaluate('localStorage.getItem("rhoda-avatar-style")') == 'human'
        assert not evaluate('document.querySelector("#robot-motion").checked')
        assert evaluate('!window.__humanAssistant.mesh.getObjectByName("RHODA_MasculineAndroid")')
        report['legacyPreference'] = 'robot migrated to human; saved pause retained; no android subtree'
        print('PASS saved robot migration, human-only menu, no android subtree and saved pause', flush=True)

        for style in ('rhoda', 'human'):
            verify_character(style, report)
        verify_pending_switch(report)
        selected('human')
        play('human', 'walk')
        selected('rhoda')
        assert not animation_state('human')['activeId'], 'Character switch left old preview running'
        play('rhoda', 'explain')
        selected('hidden')
        assert not animation_state('rhoda')['activeId'], 'Hidden character retained an active preview'
        assert evaluate('document.querySelector("#companion-animation").getClientRects().length===0')
        selected('human')
        assert not animation_state('human')['activeId'], 'Showing character revived cancelled preview'
        report['selectionCancellation'] = 'switch/hide clear previews; showing character does not revive them'

        # Device reduced-motion preference only takes effect when saved choice is cleared.
        run('set', 'media', 'light', 'reduced-motion')
        click('#robot-motion-system')
        wait('!document.querySelector("#robot-motion").checked')
        assert evaluate('localStorage.getItem("rhoda-robot-motion")') is None
        assert pose_delta(500)['all'] < 1e-10
        ensure_motion(True)
        run('set', 'viewport', '390', '844')
        assert evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        click('#robot-reset')
        run('screenshot', str(EVIDENCE/'human-controls-mobile.png'))
        audit = run('a11y')
        (EVIDENCE/'mobile-a11y.json').write_text(json.dumps(audit, indent=2), encoding='utf-8')
        assert not audit.get('violations'), audit.get('violations')
        report['mobileA11y'] = 'No automated violations; controls fit390px'
        run('set', 'viewport', '1440', '1000')
        desktop_audit = run('a11y')
        (EVIDENCE/'desktop-a11y.json').write_text(json.dumps(desktop_audit, indent=2), encoding='utf-8')
        assert not desktop_audit.get('violations'), desktop_audit.get('violations')
        report['runtimeErrors'] = run('errors').get('errors', [])
        assert not report['runtimeErrors'], report['runtimeErrors']
        (EVIDENCE/'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print('PASS switch/hide cancellation, device preference, mobile layout/accessibility and empty normal-path runtime errors', flush=True)
    except Exception:
        if started:
            try:
                diagnostic = {'errors': run('errors'), 'console': run('console'), 'snapshot': run('snapshot', '-i'), 'ui': evaluate('({url:location.href,avatarDisabled:document.querySelector("#avatar-style")?.disabled,description:document.querySelector("#avatar-description")?.textContent,status:document.querySelector("#avatar-status")?.textContent,animation:document.querySelector("#companion-animation-status")?.textContent})')}
                (EVIDENCE/'failure.json').write_text(json.dumps(diagnostic, indent=2), encoding='utf-8')
                print('FAIL diagnostic', json.dumps(diagnostic['ui']), json.dumps(diagnostic['errors']), json.dumps(diagnostic['console']), flush=True)
            except Exception:
                pass
        raise
    finally:
        if started:
            run('close')
        # Keep this isolated temporary profile for diagnostics; never remove an
        # unrelated browser/profile directory or close another test session.


if __name__ == '__main__':
    main()

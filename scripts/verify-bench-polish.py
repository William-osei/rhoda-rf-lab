import runpy
h=runpy.run_path('scripts/verify-spatial-bench.py');r,ev,wait,state=[h[k] for k in ('r','ev','wait','state')]
r('set','viewport','1440','1100')
r('select','#panel-topic','FFT');assert 'time-domain only' in ev('document.querySelector("#coach-text").textContent')
assert ev('document.querySelector("#approval").hidden')
r('click','#readable-setup');wait('!document.querySelector("#approval").hidden')
assert 'Readable training setup' in ev('document.querySelector("#summary").textContent')
r('click','#view-screen');assert ev('document.querySelector("#view-screen").getAttribute("aria-pressed")')=='true'
r('click','#approve');wait('document.querySelector("#approval").hidden&&!document.querySelector("#load").disabled')
assert state()['timebase_scale']==.0002 and state()['channels']['1']['vertical_scale']==.5
r('select','#bench-lesson','time');r('fill','#timebase','0.0001');r('click','[data-input="timebase"]');r('click','#approve');wait('!document.querySelector("#load").disabled')
assert 'Complete: Approve 100 us/div' in ev('document.querySelector("#lesson-check").textContent')
ev('window.recoveryFetch=window.fetch;window.fetch=(u,o)=>String(u).includes("/api/instrument/diagnostics")?Promise.reject(new Error("Test disconnect")):window.recoveryFetch(u,o)')
r('click','#reconnect');wait('document.querySelector("#mode").textContent.includes("Simulator unavailable")')
assert ev('document.querySelector("#load").disabled&&!document.querySelector("#reconnect").disabled')
r('click','#view-controls');r('select','#panel-topic','Acquisition')
ev('window.fetch=window.recoveryFetch');r('click','#reconnect');wait('!document.querySelector("#load").disabled')
assert 'TRAINING MODE' in ev('document.querySelector("#mode").textContent')
assert not r('errors').get('errors')
print('PASS control help, approved preset, camera during pending approval, state-based lesson, disconnect/reconnect recovery')

ev("window.savedImage=null;window.realAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download==='rhoda-simulated-display.png'){window.savedImage=this.href;return;}window.realAnchorClick.call(this)}")
r('click','#view-save-image');assert ev("window.savedImage.startsWith('data:image/png;base64,')")
assert ev("(async()=>{const i=new Image();i.src=window.savedImage;await i.decode();return i.width===1600&&i.height===1000})()")
ev('HTMLAnchorElement.prototype.click=window.realAnchorClick')
print('PASS PNG export is a decodable 1600 x 1000 image')

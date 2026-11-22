import subprocess,json
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
s=r'''(async()=>{
 const {DashboardSystem}=await import('/src/dashboard.ts');
 const source=await (await fetch('/src/dashboard.ts')).text();const path=source.match(/from ["']([^"']*avatarStyle[^"']*)["']/)?.[1];const motion=await import(path);
 const prior=localStorage.getItem('rhoda-robot-motion');let click;let label='';
 const control={addEventListener(name,fn){if(name==='click')click=fn},setProperties(p){label=p.text}};
 const doc={getElementById(id){return id==='btn-motion'?control:null}};
 const state={document:doc,refreshStatus(){}};
 try{
  DashboardSystem.prototype.wire.call(state,doc);motion.setRobotMotion(true);
  DashboardSystem.prototype.update.call(state,0,0);if(label!=='Pause animation')throw Error('Pause label missing');
  click();DashboardSystem.prototype.update.call(state,0,0);
  if(motion.avatarMotionEnabled()||label!=='Enable animation'||document.querySelector('#robot-motion').checked)throw Error('Spatial pause did not sync');
  click();DashboardSystem.prototype.update.call(state,0,0);
  if(!motion.avatarMotionEnabled()||label!=='Pause animation'||!document.querySelector('#robot-motion').checked)throw Error('Spatial resume did not sync');
  let following=false;let followLabel='';let followClick;
  const followControl={setProperties(p){if(p.text)followLabel=p.text},addEventListener(name,fn){if(name==='click')followClick=fn}};
  const followDoc={getElementById(id){return id==='btn-follow'?followControl:null}};
  const rs={getState(){return 'READY'},getStatusLabel(){return 'Ready'},isMuted(){return true},isAutoFollowEnabled(){return following},toggleAutoFollow(){following=!following;return following}};
  const followState={document:followDoc,getRhoda(){return rs},logStatus(){},setStatus(){}};
  DashboardSystem.prototype.wire.call(followState,followDoc);
  DashboardSystem.prototype.refreshStatus.call(followState);if(followLabel!=='Follow me')throw Error('Idle follow label');
  followClick();DashboardSystem.prototype.refreshStatus.call(followState);if(followLabel!=='Stop following')throw Error('Active follow label');
  motion.setRobotMotion(false);DashboardSystem.prototype.refreshStatus.call(followState);if(followLabel!=='Stop follow (paused)')throw Error('Paused follow label');
  followClick();DashboardSystem.prototype.refreshStatus.call(followState);if(following||followLabel!=='Follow me')throw Error('Cannot cancel paused following');
  let writes=0;let muted=true;let status='Ready';let follows=false;
  const cachedRs={getState(){return 'READY'},getStatusLabel(){return status},isMuted(){return muted},isAutoFollowEnabled(){return follows}};
  const cachedDoc={getElementById(id){return ['status-mode','btn-talk','btn-follow'].includes(id)?{setProperties(){writes++}}:null}};
  const cached={document:cachedDoc,getRhoda(){return cachedRs},logStatus(){},setStatus:DashboardSystem.prototype.setStatus};
  for(let i=0;i<120;i++)DashboardSystem.prototype.refreshStatus.call(cached);
  if(writes!==3)throw Error('Unchanged panel labels rewritten: '+writes);
  muted=false;DashboardSystem.prototype.refreshStatus.call(cached);if(writes!==4)throw Error('Mute change missed');
  follows=true;DashboardSystem.prototype.refreshStatus.call(cached);if(writes!==5)throw Error('Follow change missed');
  status='Processing';DashboardSystem.prototype.refreshStatus.call(cached);if(writes!==6)throw Error('Status change missed');
  return 'PASS unchanged-label update suppression; follow active/paused/cancel feedback; spatial motion callback, state labels and shared desktop preference';
 }finally{if(prior===null)motion.useDeviceMotion();else motion.setRobotMotion(prior==='true');}
})()'''
p=subprocess.run([B,'--session','rhoda-avatar','--json','eval',s],capture_output=True,text=True,encoding='utf-8',timeout=45);r=json.loads(p.stdout);assert r['success'],r;print(r['data'].get('result'))

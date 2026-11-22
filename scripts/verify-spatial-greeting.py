import subprocess,json
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
s='''(async()=>{
 const m=await import('/src/avatarStyle.ts');const style=localStorage.getItem('rhoda-avatar-style')||'rhoda';const motion=localStorage.getItem('rhoda-robot-motion');
 try{
  m.setAvatar('ceramic');m.setRobotMotion(false);
  if(m.robotGreetingLabel()!=='Show android')throw Error('Human action unclear');
  m.activateRobotGreeting();if(m.avatarLabel()!=='Masculine android'||m.avatarMotionEnabled())throw Error('Selecting robot changed motion preference');
  if(m.robotGreetingLabel()!=='Enable animation')throw Error('Paused action unclear');
  m.activateRobotGreeting();if(!m.avatarMotionEnabled()||m.robotGreetingLabel()!=='Wave hello')throw Error('Explicit enable failed');
  m.activateRobotGreeting();if(m.robotGreetingLabel()!=='Waving...')throw Error('Greeting feedback missing');
  m.resetRobotPose();if(m.robotGreetingLabel()!=='Wave hello')throw Error('Reset feedback stale');
  return 'PASS contextual spatial greeting actions, preserved motion preference on model switch, enable/wave/reset feedback';
 }finally{m.resetRobotPose();m.setAvatar(style);if(motion===null)m.useDeviceMotion();else m.setRobotMotion(motion==='true');}
})()'''
p=subprocess.run([B,'--session','rhoda-avatar','--json','eval',s],capture_output=True,text=True,encoding='utf-8',timeout=45);r=json.loads(p.stdout);assert r['success'],r;print(r['data'].get('result'))

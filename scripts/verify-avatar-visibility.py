import subprocess,json
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
def run(*a):
 r=json.loads(subprocess.check_output([B,'--session','rhoda-avatar','--json',*a],text=True,encoding='utf-8',timeout=45));assert r['success'],r;return r['data']
script='''(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const avatar=await import('/src/avatarStyle.ts');
 const root=new THREE.Group();const material=new THREE.MeshStandardMaterial();material.name='Wolf3D_Skin';
 const eye=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1),material);root.add(eye);
 avatar.installAvatarStyles(root,()=>{});
 avatar.setAvatar('ceramic');const ceramic=eye.material;
 eye.visible=false;avatar.updateAvatarVisual(1);
 if(eye.visible)throw Error('Ceramic overrides closed-eye visibility');
 eye.visible=true;avatar.updateAvatarVisual(2);
 if(!eye.visible||eye.material!==ceramic)throw Error('Ceramic reopened-eye/material mismatch');
 for(const style of ['robot','hidden']){avatar.setAvatar(style);eye.visible=true;avatar.updateAvatarVisual(3);if(eye.visible)throw Error(style+' leaks human mesh');}
 avatar.setAvatar('rhoda');if(!eye.visible||eye.material!==material)throw Error('Original not restored');
 return 'PASS ceramic animation visibility, hidden mesh enforcement, original material restoration';
})()'''
saved=run('eval','localStorage.getItem("rhoda-avatar-style")').get('result')
try:print(run('eval',script).get('result'))
finally:
 run('eval','localStorage.setItem("rhoda-avatar-style",'+json.dumps(saved or 'rhoda')+')');run('reload')

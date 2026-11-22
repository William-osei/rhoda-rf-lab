import {labAccess,getLabAccess} from './labAccess';
import './labAccess.css';

// A visit to the desktop home keeps subsequent sections in the app window.
// Regular browser users retain the existing navigation behavior.
try {
  if (sessionStorage.getItem('rhoda-desktop-home') === '1' && !new URLSearchParams(location.search).has('embedded')) {
    const pages = new Set(['/', '/index.html', '/chat.html', '/library.html', '/practice.html', '/spatial-bench.html', '/instruments.html', '/instructor.html']);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')) {
      const target = new URL(link.href, location.href);
      if (target.origin === location.origin && pages.has(target.pathname)) link.removeAttribute('target');
    }
    if (!location.pathname.endsWith('/desktop.html')) {
      const navigation = document.querySelector('header nav, nav[aria-label="Workspace"], .topbar-r');
      if (navigation) {
        const home = document.createElement('a');
        home.href = 'desktop.html'; home.textContent = 'App home'; home.className = 'desktop-home-link';
        navigation.prepend(home);
      }
    }
  }
} catch { /* Storage restrictions do not prevent the lab from opening. */ }

const strip=document.createElement('aside');strip.id='lab-access';strip.hidden=true;strip.setAttribute('aria-label','Lab account');
const label=document.createElement('span');label.id='lab-access-label';label.setAttribute('role','status');
const action=document.createElement('button');action.type='button';action.id='lab-access-action';
strip.append(label,action);document.body.append(strip);
const dialog=document.createElement('dialog');dialog.id='lab-sign-in';dialog.setAttribute('aria-labelledby','lab-sign-in-title');
dialog.innerHTML='<form><h2 id="lab-sign-in-title">Sign in to the lab</h2><p>Use the account supplied by your lab administrator.</p><label for="lab-username">Username</label><input id="lab-username" name="username" autocomplete="username" maxlength="80" required><label for="lab-password">Password</label><input id="lab-password" name="password" type="password" autocomplete="current-password" maxlength="1024" required><p id="lab-login-status" role="status"></p><div class="lab-login-actions"><button id="lab-login-submit" type="submit">Sign in</button><button id="lab-login-cancel" type="button">Cancel</button></div></form>';
document.body.append(dialog);
const form=dialog.querySelector('form')!,username=dialog.querySelector<HTMLInputElement>('#lab-username')!,password=dialog.querySelector<HTMLInputElement>('#lab-password')!,message=dialog.querySelector<HTMLElement>('#lab-login-status')!,submit=dialog.querySelector<HTMLButtonElement>('#lab-login-submit')!;
let busy=false,renderedIdentity:string|null=null,resetQueued=false;
function render(){
  const s=getLabAccess();if(!s)return;
  const identity=s.enabled?(s.authenticated?`${s.user!.username}:${s.user!.role}`:'signed-out'):'offline';
  // Clear previously rendered private records and pending UI when account permissions change,
  // including expiry or a login/logout initiated in a different page.
  if(renderedIdentity!==null&&renderedIdentity!==identity&&!resetQueued){resetQueued=true;queueMicrotask(()=>location.reload());}
  renderedIdentity=identity;
  strip.hidden=!s.enabled;document.body.classList.toggle('rhoda-auth-enabled',s.enabled);
  label.textContent=s.authenticated?`${s.user!.username} · ${s.user!.role}`:'Shared lab · sign-in required';
  action.textContent=s.authenticated?'Sign out':'Sign in';action.disabled=busy;
  // Permissions are also enforced by the backend; these help explain read-only surfaces.
  document.body.dataset.labRole=s.user?.role||'';
}
function broadcast(){try{localStorage.setItem('rhoda-access-revision',crypto.randomUUID());}catch{}}
action.onclick=async()=>{
  let s=getLabAccess();if(busy)return;
  if(!s){try{s=await labAccess.refresh(true);render();}catch(error){label.textContent=(error as Error).message;}return;}
  if(!s?.authenticated){message.textContent='';dialog.showModal();username.focus();return;}
  busy=true;render();
  try{await labAccess.logout();broadcast();location.reload();}
  catch(error){label.textContent=(error as Error).message;}
  finally{busy=false;action.disabled=false;}
};
form.onsubmit=async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  busy=true;submit.disabled=true;username.disabled=true;password.disabled=true;message.textContent='Signing in…';
  try{await labAccess.login(username.value,password.value);password.value='';dialog.close();broadcast();location.reload();}
  catch(error){password.value='';message.textContent=(error as Error).message;}
  finally{busy=false;submit.disabled=false;username.disabled=false;password.disabled=false;if(dialog.open)password.focus();}
};
dialog.querySelector<HTMLButtonElement>('#lab-login-cancel')!.onclick=()=>{if(busy)return;password.value='';dialog.close();action.focus();};
dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else password.value='';});
dialog.addEventListener('close',()=>{password.value='';});
window.addEventListener('rhoda-access-updated',render);
window.addEventListener('storage',event=>{if(event.key==='rhoda-access-revision'){labAccess.invalidate();void labAccess.refresh(true).catch(()=>labAccess.refresh(true)).catch(()=>{label.textContent='Account changed in another page. Reconnect to the lab.';});}});
window.addEventListener('focus',()=>void labAccess.refresh().catch(()=>{}));
void labAccess.refresh().catch(error=>{strip.hidden=false;document.body.classList.add('rhoda-auth-enabled');label.textContent=(error as Error).message;action.textContent='Reconnect';});


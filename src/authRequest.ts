import { labAccess } from './labAccess';

/** Shared API transport. Never automatically replays a write after authentication changes. */
export async function labFetch(input:RequestInfo|URL,init:RequestInit={}):Promise<Response>{
  const status=await labAccess.refresh();
  const generation=labAccess.revision();
  const method=(init.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  const source=init.headers||(input instanceof Request?input.headers:undefined);
  const headers:Record<string,string>=source instanceof Headers?Object.fromEntries(source.entries()):Array.isArray(source)?Object.fromEntries(source):{...source};
  if(status.enabled&&status.authenticated&&!['GET','HEAD','OPTIONS'].includes(method))headers['X-Rhoda-CSRF']=status.csrfToken!;
  const response=await fetch(input,{...init,headers,credentials:'include'});
  if(response.status===401){labAccess.invalidate();void labAccess.refresh(true).catch(()=>{});}
  else if(generation!==labAccess.revision())throw Error('The signed-in lab session changed during this request. Refresh before continuing.');
  return response;
}


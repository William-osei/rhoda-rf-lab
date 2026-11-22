type XRSessionSource = {
  getSession(): XRSession|null;
  addEventListener(type:'sessionstart'|'sessionend', listener:()=>void):void;
  removeEventListener(type:'sessionstart'|'sessionend', listener:()=>void):void;
};

/** The SDK input manager is not an EventTarget; selection comes from XRSession. */
export function bindXRSessionSelect(source:XRSessionSource, select:(event:XRInputSourceEvent)=>void) {
  let session:XRSession|null=null;
  const detach=()=>{session?.removeEventListener('selectstart',select);session=null;};
  const attach=()=>{const current=source.getSession();if(current===session)return;detach();session=current;session?.addEventListener('selectstart',select);};
  source.addEventListener('sessionstart',attach);source.addEventListener('sessionend',detach);attach();
  return ()=>{detach();source.removeEventListener('sessionstart',attach);source.removeEventListener('sessionend',detach);};
}

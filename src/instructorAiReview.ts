/** Optional, explicit instructor review. Credentials and model calls stay on the server. */
import { REVIEW_EXAMPLES, type ReviewExampleId } from './instructorReviewExamples';
type Access = {enabled?:boolean;authenticated?:boolean;user?:{username?:string;role?:string}|null;sessionId?:string|null;permissions?:{inspectAllSessions?:boolean}}|null;
type InputMode = 'synthetic-only'|'session-log';
type ReviewOptions = {
  request:(url:string,init:RequestInit)=>Promise<Response>;
  getAccess:()=>Access;
  getPreviewedLog:()=>string|null;
  base?:string;
};
const INPUT_LIMIT=20_000,OUTPUT_LIMIT=24_000,STREAM_LIMIT=131_072,FRAME_LIMIT=65_536;
const PRIVACY='Private session review requires an administrator-approved paid Gemini API project. Input/results are not saved by RHODA; provider terms apply.';
const FREE_PRIVACY='Free Gemini mode accepts only public fictional teaching examples. It cannot review actual learner logs. Google may use free API inputs and responses to improve its products, and human reviewers may read them. Use the local authored checklist for private logs.';
const PREVIEW_HINT='Check availability, then preview an allowed input before sending anything to Google.';
const ABORT=()=>new DOMException('Request stopped.','AbortError');

function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T> {
  if(signal.aborted)return Promise.reject(ABORT());
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(ABORT());};
    const cleanup=()=>signal.removeEventListener('abort',abort);
    signal.addEventListener('abort',abort,{once:true});
    work.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}
function record(value:unknown):value is Record<string,unknown> {
  return !!value&&typeof value==='object'&&!Array.isArray(value);
}
function safeMessage(value:unknown,fallback:string) {
  if(!record(value))return fallback;
  const message=typeof value['message']==='string'?value['message']:typeof value['error']==='string'?value['error']:null;
  return message?.slice(0,400)||fallback;
}

export function installAiReviewUI(options:ReviewOptions) {
  const section=document.getElementById('ai-review');
  // Preserved dashboard fixtures and older embedded pages need not include this optional panel.
  if(!section)return undefined;
  const find=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const input=find<HTMLTextAreaElement>('ai-review-log');
  const privateInput=find<HTMLElement>('ai-review-private-input');
  const syntheticInput=find<HTMLElement>('ai-review-synthetic-input');
  const example=find<HTMLSelectElement>('ai-review-example');
  const copy=find<HTMLButtonElement>('ai-review-use-preview');
  const previewButton=find<HTMLButtonElement>('ai-review-preview');
  const check=find<HTMLButtonElement>('ai-review-check');
  const start=find<HTMLButtonElement>('ai-review-start');
  const cancel=find<HTMLButtonElement>('ai-review-cancel');
  const clearButton=find<HTMLButtonElement>('ai-review-clear');
  const consent=find<HTMLInputElement>('ai-review-consent');
  const consentText=find<HTMLElement>('ai-review-consent-text');
  const preview=find<HTMLElement>('ai-review-input-preview');
  const output=find<HTMLElement>('ai-review-output');
  const status=find<HTMLElement>('ai-review-status');
  const availability=find<HTMLElement>('ai-review-availability');
  const limits=find<HTMLElement>('ai-review-limits');
  const count=find<HTMLElement>('ai-review-count');
  const endpoint=`${options.base||''}/api/instructor/review`;
  let available=false,mode:InputMode|null=null,prepared:string|null=null,preparedExample:ReviewExampleId|null=null,busy:'status'|'review'|null=null,generation=0;
  let active:AbortController|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let timeout:number|undefined;
  const permitted=()=>{const access=options.getAccess();return !!access?.enabled&&!!access.authenticated&&access.permissions?.inspectAllSessions===true;};
  const accessKey=()=>{const access=options.getAccess();return JSON.stringify([access?.enabled,access?.authenticated,access?.user?.username,access?.user?.role,access?.sessionId,access?.permissions?.inspectAllSessions]);};
  let account=accessKey();
  for(const item of REVIEW_EXAMPLES)example.add(new Option(item.title,item.id));
  function controls() {
    const allowed=permitted(),privateAllowed=allowed&&available&&mode==='session-log',syntheticAllowed=allowed&&available&&mode==='synthetic-only';
    privateInput.hidden=!privateAllowed;syntheticInput.hidden=!syntheticAllowed;
    input.disabled=!privateAllowed||!!busy;consent.disabled=!allowed||!available||!mode||!prepared;
    copy.hidden=!privateAllowed;copy.disabled=!privateAllowed||!!busy||!options.getPreviewedLog();
    example.disabled=!syntheticAllowed||!!busy;
    previewButton.disabled=!privateAllowed||!!busy||!input.value.trim();
    check.disabled=!allowed||!!busy;
    start.disabled=!allowed||!!busy||!available||!mode||!prepared||!consent.checked;
    cancel.disabled=!busy;
    clearButton.disabled=!input.value&&!example.value&&!prepared&&output.hidden&&!busy;
    const bytes=input.value.length<=INPUT_LIMIT?`${new TextEncoder().encode(input.value).byteLength.toLocaleString()} / 20,000 UTF-8 bytes`:'Shorten the text to check its UTF-8 size';
    count.textContent=`${input.value.length.toLocaleString()} / ${INPUT_LIMIT.toLocaleString()} characters · ${bytes}`;
    section!.setAttribute('aria-busy',String(!!busy));
  }
  function stop() {
    generation++;active?.abort();active=undefined;
    const prior=reader;reader=undefined;void prior?.cancel().catch(()=>{});
    clearTimeout(timeout);timeout=undefined;busy=null;
  }
  function invalidate(message:string,resetAvailability=false) {
    stop();prepared=null;preparedExample=null;consent.checked=false;output.textContent='';output.hidden=true;
    preview.textContent=PREVIEW_HINT;
    if(resetAvailability){available=false;mode=null;example.value='';availability.textContent='Check availability for the current instructor account before starting.';consentText.textContent='Check availability and preview the allowed input before consenting.';}
    status.textContent=message;controls();
  }
  function clear(message='AI input and results cleared.') {
    input.value='';example.value='';invalidate(message,true);
  }
  function prepare() {
    invalidate('Checking AI input…');
    if(!permitted()||!available||mode!=='session-log'){input.value='';status.textContent='Check availability for an approved session-log mode. Free mode cannot review actual learner logs.';controls();return;}
    if(input.value.trim().length<20||input.value.length>INPUT_LIMIT){
      status.textContent='Use between 20 and 20,000 characters. Input has not been sent.';return;
    }
    if(new TextEncoder().encode(input.value).byteLength>INPUT_LIMIT){status.textContent='Use no more than 20,000 UTF-8 bytes. Input has not been sent.';return;}
    prepared=input.value;preview.textContent=prepared;
    status.textContent='Exact input is ready. Review it and consent before starting; previewing sends nothing.';
    controls();
  }
  async function checkAvailability() {
    if(!permitted()||busy)return;
    clear('Availability is being checked. Previous AI input, preview, consent and results were cleared.');
    stop();const run=generation,controller=new AbortController();active=controller;busy='status';available=false;
    availability.textContent='Checking the server configuration and pilot availability…';controls();
    timeout=window.setTimeout(()=>controller.abort(),8000);
    try {
      const response=await abortable(options.request(`${endpoint}/status`,{method:'GET',cache:'no-store',signal:controller.signal}),controller.signal);
      const value:unknown=await abortable(response.json(),controller.signal);
      if(run!==generation||!permitted())return;
      if(!response.ok)throw Error(safeMessage(value,'AI availability could not be checked. Use the local authored checklist.'));
      if(!record(value)||typeof value['available']!=='boolean'||value['provider']!=='Google Gemini')throw Error('The AI service returned an unsupported availability response.');
      if(value['available']&&value['inputMode']!=='synthetic-only'&&value['inputMode']!=='session-log')throw Error('The AI service did not identify an approved input mode. Use the local authored checklist.');
      available=value['available'];
      mode=available?value['inputMode'] as InputMode:null;
      consentText.textContent=mode==='synthetic-only'?'I consent to send this exact public fictional example to Google Gemini through the free API. I understand that Google may use the input and response to improve its products and that human reviewers may read them. No actual learner log will be sent.':mode==='session-log'?'I have permission to share this exact preview with Google Gemini for this AI draft. I understand that a request uses the pilot API allowance, separate from Gemini Pro or Lovable credits, and provider data terms apply.':'Check availability and preview the allowed input before consenting.';
      const model=typeof value['model']==='string'?` · ${value['model'].slice(0,100)}`:'';
      availability.textContent=`Google Gemini${model}: ${safeMessage(value,available?'Available for this pilot.':'Unavailable. Use the local authored checklist.')}`;
      limits.textContent=`${mode==='synthetic-only'?FREE_PRIVACY:mode==='session-log'?PRIVACY:'No input mode is currently available. Use the local authored checklist for private logs.'} Pilot limits: 20,000 input characters and 20,000 UTF-8 bytes, 2,048 output tokens, 5 requests per instructor/day and 20 across the pilot/day. No automatic retries.`;
    } catch(error) {
      if(run===generation){available=false;mode=null;availability.textContent=error instanceof Error&&error.name!=='AbortError'?error.message:'The availability check timed out or was stopped. Check again when ready.';}
    } finally {
      if(run===generation){clearTimeout(timeout);timeout=undefined;active=undefined;busy=null;controls();}
    }
  }
  async function runReview() {
    if(!permitted()||busy||!available||!mode||!prepared||!consent.checked)return;
    const log=prepared;
    const selected=REVIEW_EXAMPLES.find(item=>item.id===example.value);
    if(mode==='session-log'?log!==input.value:!selected||selected.id!==preparedExample||selected.log!==log){invalidate('Input changed. Preview it again before sending.');return;}
    const payload=mode==='synthetic-only'?{exampleId:preparedExample,consent:true,provider:'google-gemini',requestId:crypto.randomUUID()}:{log,consent:true,provider:'google-gemini',requestId:crypto.randomUUID()};
    stop();const run=generation,controller=new AbortController();active=controller;busy='review';
    output.textContent='';output.hidden=false;status.textContent='Requesting an AI draft from Google Gemini. Review its claims against the original record.';controls();
    let timedOut=false;
    timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},95_000);
    let terminal=false,total=0,buffer='';
    const current=()=>run===generation&&permitted()&&!controller.signal.aborted;
    const interrupted=(message:string)=>{status.textContent=`${message}${output.textContent?' Partial draft retained; it is incomplete.':''}`;};
    function frame(text:string) {
      if(!current()||terminal)return;
      let event='message';const data:string[]=[];
      for(const line of text.split(/\r\n|\r|\n/)) {
        if(line.startsWith('event:'))event=line.slice(6).trim();
        if(line.startsWith('data:'))data.push(line.slice(5).trimStart());
      }
      if(!data.length)return;
      if(!['delta','complete','stopped','error'].includes(event))return;
      let payload:unknown;try{payload=JSON.parse(data.join('\n'));}catch{throw Error('The AI response was interrupted by an unreadable event.');}
      if(event==='delta') {
        if(!record(payload)||typeof payload['text']!=='string')throw Error('The AI response returned an unreadable text event.');
        if((output.textContent?.length||0)+payload['text'].length>OUTPUT_LIMIT)throw Error('The AI draft exceeded the display limit.');
        output.append(document.createTextNode(payload['text']));
      } else if(event==='complete') {
        if(!record(payload)||(payload['truncated']!==undefined&&typeof payload['truncated']!=='boolean'))throw Error('The AI response returned an unreadable completion event.');
        if(!output.textContent?.trim())throw Error('The AI service completed without a readable draft.');
        terminal=true;
        if(payload['truncated']===true)interrupted('The AI draft reached the output token limit.');
        else status.textContent='AI draft complete. This is not a grade or verified learner achievement; check the original evidence and simulator assumptions.';
      } else if(event==='stopped') {
        terminal=true;interrupted('Google stopped the draft.');
      } else if(event==='error') {
        terminal=true;interrupted(safeMessage(payload,'AI review failed. Use the local authored checklist.'));
      }
      // Unrecognized events (including any reasoning metadata) are never rendered.
    }
    try {
      const response=await abortable(options.request(endpoint,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify(payload),signal:controller.signal}),controller.signal);
      if(!current())return;
      if(!response.ok) {
        let error:unknown;try{error=await abortable(response.json(),controller.signal);}catch{error=null;}
        throw Error(safeMessage(error,response.status===429?'The AI pilot quota is exhausted. Use the local authored checklist.':'AI review is unavailable. Check availability before trying again.'));
      }
      if(!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')||!response.body)throw Error('The AI service did not return a readable event stream.');
      const streamReader=response.body.getReader();reader=streamReader;
      const decoder=new TextDecoder('utf-8',{fatal:true});
      while(current()&&!terminal) {
        const chunk=await abortable(streamReader.read(),controller.signal);
        if(!current())return;
        buffer+=decoder.decode(chunk.value,{stream:!chunk.done});total+=chunk.value?.byteLength||0;
        if(total>STREAM_LIMIT)throw Error('The AI response exceeded the stream limit.');
        let boundary:RegExpExecArray|null;
        while((boundary=/\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
          if(boundary.index>FRAME_LIMIT)throw Error('The AI response exceeded the event limit.');
          frame(buffer.slice(0,boundary.index));buffer=buffer.slice(boundary.index+boundary[0].length);
          if(terminal)break;
        }
        if(buffer.length>FRAME_LIMIT)throw Error('The AI response exceeded the event limit.');
        if(chunk.done){if(!terminal)interrupted('The AI stream ended before completion.');break;}
      }
    } catch(error) {
      if(run===generation)interrupted(controller.signal.aborted?(timedOut?'The AI review timed out.':'AI review stopped.'):error instanceof Error?error.message:'AI review failed. Use the local authored checklist.');
    } finally {
      if(run===generation){
        const prior=reader;reader=undefined;void prior?.cancel().catch(()=>{});
        clearTimeout(timeout);timeout=undefined;active=undefined;busy=null;consent.checked=false;controls();
      }
    }
  }
  const onInput=()=>{if(mode!=='session-log'||!available)input.value='';invalidate('Input changed. Preview it again; nothing is sent automatically.');};
  const onExample=()=>{
    input.value='';invalidate('Choose a public fictional example to preview. Nothing is sent automatically.');
    if(!permitted()||!available||mode!=='synthetic-only'){example.value='';controls();return;}
    const selected=REVIEW_EXAMPLES.find(item=>item.id===example.value);
    if(selected){prepared=selected.log;preparedExample=selected.id;preview.textContent=selected.log;status.textContent='Exact public fictional example is ready. Read it and consent before sending; selecting an example makes no model request.';}
    controls();
  };
  const onConsent=()=>{if(!consent.checked&&busy==='review'){stop();status.textContent=`Consent withdrawn. Review stopped.${output.textContent?' Partial draft retained; it is incomplete.':''}`;}controls();};
  const onCopy=()=>{if(!permitted()||busy||!available||mode!=='session-log')return;const text=options.getPreviewedLog();if(!text)return;input.value=text;prepare();};
  const onCancel=()=>{const kind=busy;stop();consent.checked=false;status.textContent=kind==='review'?`AI review stopped.${output.textContent?' Partial draft retained; it is incomplete.':''}`:'Availability check cancelled.';controls();};
  const onClear=()=>clear();
  const onCheck=()=>void checkAvailability();
  const onStart=()=>void runReview();
  const onPageHide=()=>clear('AI input and results cleared when leaving this page.');
  const onAccessChange=()=>{const next=accessKey();if(next!==account||!permitted()){account=next;clear('Instructor account access changed. AI input and results cleared.');}else controls();};
  const listeners:Array<[EventTarget,string,EventListener]>=[
    [input,'input',onInput],[example,'change',onExample],[consent,'change',onConsent],[copy,'click',onCopy],
    [previewButton,'click',prepare],[check,'click',onCheck],[start,'click',onStart],
    [cancel,'click',onCancel],[clearButton,'click',onClear],[window,'pagehide',onPageHide],
    [window,'rhoda-access-updated',onAccessChange],
  ];
  for(const [target,event,listener] of listeners)target.addEventListener(event,listener);
  controls();
  return {clear,syncPreview:controls,dispose:()=>{clear();for(const [target,event,listener] of listeners)target.removeEventListener(event,listener);}};
}

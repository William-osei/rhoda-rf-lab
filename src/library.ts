import { CONCEPTS } from './concepts';
import { installStudyLibrary } from './studyLibrary';
import { documentCitation, safeReferenceUrl } from './libraryCitation';
import { READING_PATHS } from './readingPaths';
import './labAccessUI';
import {labFetch} from './authRequest';
import { BACKEND } from './runtimeConfig';
type Doc={id:string;title:string;family:string;category:string;pages:number;format:string;source_kind:string;source_url?:string;retrieved?:string;page?:number;excerpt?:string};
const get=(id:string)=>document.getElementById(id)!;
const query=get('query') as HTMLInputElement, family=get('family') as HTMLSelectElement, category=get('category') as HTMLSelectElement;
let docs:Doc[]=[], request=0, visibleItems:Doc[]=[], resultPage=0;
let readerRequest=0;
const pageSize=12;
const sort=get('library-sort') as HTMLSelectElement;
function displayTitle(doc:Doc){return doc.title.replace(/\.(pdf|docx?|pptx?|xlsx?)$/i,'').replace(/_/g,' ').replace(/\s+/g,' ').trim();}
function switchArea(area:string,moveFocus=false){
 if(area!=='documents') { ++readerRequest; get('reader').removeAttribute('aria-busy'); get('reader').querySelector('#reader-request-status')?.remove(); }
 for(const button of document.querySelectorAll<HTMLButtonElement>('[data-library-tab]')){
  const active=button.dataset.libraryTab===area;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
  get(button.dataset.libraryTab+'-area').hidden=!active;if(active&&moveFocus)button.focus();
 }
 const url=new URL(location.href);if(area==='documents')url.searchParams.delete('area');else url.searchParams.set('area',area);
 if(area!=='documents'){url.searchParams.delete('doc');url.searchParams.delete('page');}
 if(area!=='learning')url.searchParams.delete('concept');
 if(area!=='courses')url.searchParams.delete('course');
 url.hash=''; history.replaceState(null,'',url);
}
const tabs=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-library-tab]'));
for(const [i,button] of tabs.entries()){
 button.onclick=()=>switchArea(button.dataset.libraryTab!);
 button.onkeydown=event=>{let next=i;if(event.key==='ArrowRight')next=(i+1)%tabs.length;else if(event.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();switchArea(tabs[next].dataset.libraryTab!,true);};
}
const area=new URLSearchParams(location.search).get('area');if(area==='learning'||area==='templates'||area==='courses')switchArea(area);
function updatePagination(){
 const total=visibleItems.length,max=Math.max(0,Math.ceil(total/pageSize)-1);resultPage=Math.min(resultPage,max);
 get('result-pagination').hidden=total<=pageSize;
 (get('results-prev') as HTMLButtonElement).disabled=resultPage===0;
 (get('results-next') as HTMLButtonElement).disabled=resultPage===max;
 get('results-range').textContent=total?`${resultPage*pageSize+1}–${Math.min(total,(resultPage+1)*pageSize)} of ${total}`:'0 documents';
}
function renderPage(){updatePagination();render(visibleItems.slice(resultPage*pageSize,(resultPage+1)*pageSize));}
for(const [id,delta] of [['results-prev',-1],['results-next',1]] as const)get(id).onclick=()=>{resultPage+=delta;renderPage();get('results').scrollIntoView({block:'start',behavior:'smooth'});};
sort.onchange=()=>{sortItems();resultPage=0;renderPage();};
function sortItems(){visibleItems.sort((a,b)=>sort.value==='pages'?b.pages-a.pages:sort.value==='family'?a.family.localeCompare(b.family)||displayTitle(a).localeCompare(displayTitle(b)):displayTitle(a).localeCompare(displayTitle(b)));}

async function json(url:string){const r=await labFetch(BACKEND+url,{signal:AbortSignal.timeout(20000)});if(!r.ok){const data=await r.json().catch(()=>null);throw Error(data?.error||'Local library unavailable. Start the RHODA backend and check its resource folder configuration.');}return r.json();}
function element(tag:string,text:string){const e=document.createElement(tag);e.textContent=text;return e;}
function link(text:string,url:string){const a=document.createElement('a');a.textContent=text;a.href=url;a.target='_blank';a.rel='noopener';return a;}
function originalUrl(doc:Doc,page:number){return `${BACKEND}/api/library/file/${encodeURIComponent(doc.id)}#page=${page}`;}
function render(items:Doc[]){get('results').replaceChildren();for(const doc of items){const card=element('article','');card.className='card';card.dataset.documentId=doc.id;card.classList.toggle('selected',get('reader').dataset.documentId===doc.id);const meta=element('div',`${doc.family} · ${doc.category} · ${doc.page ? 'File page '+doc.page : doc.pages+' pages'}`);meta.className='meta';card.append(meta,element('h2',displayTitle(doc)));if(doc.excerpt)card.append(element('p',doc.excerpt));const b=element('button','Read '+(doc.page?'page':'document'));b.onclick=()=>void read(doc,doc.page||1);card.append(b,link('Open original ↗',originalUrl(doc,doc.page||1)));get('results').append(card);}if(!items.length)get('results').append(element('p','No matches. Try a model number or a shorter technical term, or clear the filters.'));}
async function read(doc:Doc,page:number){const token=++readerRequest;document.querySelectorAll<HTMLElement>('#results .card').forEach(c=>c.classList.toggle('selected',c.dataset.documentId===doc.id));const reader=get('reader');reader.setAttribute('aria-busy','true');reader.querySelector('#reader-request-status')?.remove();const loading=element('div',`Opening ${displayTitle(doc)}, file page ${page}…`);loading.id='reader-request-status';loading.className='notice';loading.setAttribute('role','status');reader.prepend(loading);try{const data=await json(`/api/library/page/${encodeURIComponent(doc.id)}/${page}`);if(token!==readerRequest)return;if(typeof data.text!=='string')throw Error('The page response did not contain readable text. Retry or open the original.');const pageUrl=new URL(location.href);pageUrl.searchParams.set('doc',doc.id);pageUrl.searchParams.set('page',String(page));history.replaceState(null,'',pageUrl);reader.dataset.documentId=doc.id;reader.dataset.page=String(page);reader.replaceChildren(element('div',doc.source_kind),element('h2',displayTitle(doc)),element('p',`File page ${page} of ${doc.pages}`));const toolbar=element('div','');toolbar.className='reader-tools';const prev=document.createElement('button');prev.textContent='← Previous';prev.disabled=page<=1;prev.onclick=()=>void read(doc,page-1);const next=document.createElement('button');next.textContent='Next →';next.disabled=page>=doc.pages;next.onclick=()=>void read(doc,page+1);const num=document.createElement('input');num.type='number';num.min='1';num.max=String(doc.pages);num.value=String(page);num.setAttribute('aria-label','File page number');const go=element('button','Go');go.onclick=()=>{const n=Number(num.value);if(Number.isInteger(n)&&n>=1&&n<=doc.pages)void read(doc,n);else{num.setCustomValidity(`Choose a whole file page from 1 to ${doc.pages}.`);num.reportValidity();}};num.oninput=()=>num.setCustomValidity('');num.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go.click();}};toolbar.append(prev,num,element('span',`/ ${doc.pages}`),go,next);const source=safeReferenceUrl(doc.source_url);if(source){reader.append(link('Recorded download source ↗',source));if(doc.retrieved)reader.append(element('p','Retrieved '+doc.retrieved));}reader.append(toolbar,link('Open original at this page ↗',originalUrl(doc,page)));const note=element('p','Extracted text. Check original layout, safety context, figures and table columns before using this information.');note.className='notice';reader.append(note);const text=element('div',data.text||'No extractable text on this page. Open the original to view it.');text.id='page-text';reader.append(text);const copy=element('button','Copy source citation');copy.onclick=async()=>{const citation=documentCitation(doc,page);try{await navigator.clipboard.writeText(citation);if(copy.isConnected)copy.textContent='Copied';}catch{if(!copy.isConnected)return;copy.textContent='Select citation below';reader.querySelector('#citation-fallback')?.remove();const fallback=element('pre',citation);fallback.id='citation-fallback';fallback.className='citation-fallback';fallback.tabIndex=0;fallback.setAttribute('aria-label','Source citation to select and copy');reader.append(fallback);fallback.focus({preventScroll:true});}};reader.append(copy);
const bookmark=element('button','Save this page');bookmark.onclick=()=>{try{localStorage.setItem('rhoda-reading-position',JSON.stringify({id:doc.id,page}));bookmark.textContent='Reading position saved';get('resume-reading').hidden=false;}catch{bookmark.textContent='Storage unavailable';}};reader.append(bookmark);
const share=link('Link to this page',`library.html?doc=${encodeURIComponent(doc.id)}&page=${page}`);reader.append(element('span',' · '),share);
if(innerWidth<800){reader.scrollIntoView({behavior:'smooth'});reader.focus({preventScroll:true});}}catch(e){if(token!==readerRequest)return;loading.replaceChildren(element('p',`Could not open ${displayTitle(doc)}, file page ${page}. ${(e as Error).message}`));loading.setAttribute('role','alert');const previousPage=reader.querySelector<HTMLInputElement>('input[type=number]');if(previousPage&&reader.dataset.page)previousPage.value=reader.dataset.page;document.querySelectorAll<HTMLElement>('#results .card').forEach(c=>c.classList.toggle('selected',c.dataset.documentId===reader.dataset.documentId));const retry=element('button','Retry this page');retry.id='retry-page';retry.onclick=()=>void read(doc,page);loading.append(retry,element('span',' · '),link('Open original at requested page ↗',originalUrl(doc,page)));}finally{if(token===readerRequest)reader.removeAttribute('aria-busy');}}
async function search(){const token=++request;get('status').textContent='Searching local resources…';try{let items:Doc[];if(query.value.trim()){const result=await json(`/api/library/search?${new URLSearchParams({q:query.value,family:family.value,category:category.value})}`);items=result.results;}else items=docs.filter(d=>(!family.value||d.family===family.value)&&(!category.value||d.category===category.value));if(token!==request)return;visibleItems=[...items];resultPage=0;sortItems();renderPage();document.querySelectorAll<HTMLButtonElement>('#family-shortcuts button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.family===family.value)));get('status').textContent=`${items.length} ${query.value.trim()?'matching pages (up to 30)':'documents'} · local search · no AI request`;if(get('documents-area').hidden)return;const url=new URL(location.href);url.searchParams.set('q',query.value);url.searchParams.set('family',family.value);url.searchParams.set('category',category.value);url.searchParams.delete('doc');url.searchParams.delete('page');history.replaceState(null,'',url);}catch(e){if(token!==request)return;get('status').textContent=(e as Error).message;}}
get('search-form').onsubmit=e=>{e.preventDefault();void search();};get('browse').onclick=()=>{query.value='';family.value='';category.value='';void search();};family.onchange=category.onchange=()=>void search();
const templates:Record<string,string>={
'Experiment record':'# Experiment record\n\nDate:\nResearch question:\nOperator:\nSupervisor / approval:\n\n## Equipment\nModel, serial, firmware, probe, options, calibration status:\n\n## Setup and conditions\nConnections, ratings checked, environment:\n\n## Procedure\nSteps actually performed:\n\n## Observations\nRaw data location, units, settings, timestamps:\n\n## Analysis\nCalculations, uncertainty, assumptions:\n\n## Limitations and next steps\n\n## Sources\nManual title, revision, file page:\n',
'Equipment inventory':'Instrument,Manufacturer,Model,Serial,Firmware,Options,Accessories,Calibration status,Connection,Location,Notes\n',
'Service learning log':'# Service learning log\n\nDate:\nAssigned task (confirm with supervisor):\nActivities actually completed:\nEvidence / files:\nWhat I learned:\nQuestions / blockers:\nNext actions:\nSupervisor feedback:\n',
'Connection checklist':'# Connection preparation\n\nExact model / serial / firmware:\nMatching manual and revision:\nSupported interface and resource address:\nDriver compatibility evidence:\nLab network / access approval:\nSafe initial instrument state:\nRead-only identity check planned:\nTimeout and disconnect behavior:\nApproved test and expected readback:\nActual result (leave blank until performed):\n'};
const templateDescriptions:Record<string,string>={'Experiment record':'Record your question, setup, observations and analysis.','Equipment inventory':'Track models, accessories, interfaces and calibration status.','Service learning log':'Keep a daily record of tasks, evidence and what you learned.','Connection checklist':'Prepare an identity check and document the connection details.'};
for(const [title,content] of Object.entries(templates)){const b=element('button','');b.append(element('strong',title),element('span',templateDescriptions[title]),element('span',title==='Equipment inventory'?'Download CSV ↘':'Download Markdown ↘'));b.onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));a.download=title.toLowerCase().replace(/ /g,'-')+(title==='Equipment inventory'?'.csv':'.md');a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};get('templates').append(b);}
const retryCatalogue=get('retry-catalogue') as HTMLButtonElement;
async function loadCatalogue(){if(retryCatalogue.disabled)return;retryCatalogue.disabled=true;get('status').textContent='Loading your local catalogue…';get('documents-area').setAttribute('aria-busy','true');try{
 const data=await json('/api/library/documents');docs=data.documents;get('catalogue-count').textContent=docs.length.toLocaleString();get('catalogue-pages').textContent=docs.reduce((n,d)=>n+d.pages,0).toLocaleString();
 get('family-shortcuts').replaceChildren();family.replaceChildren(new Option('All instruments',''));category.replaceChildren(new Option('All document types',''));
 const shortcuts=['',...new Set(docs.map(d=>d.family))].sort((a,b)=>a.localeCompare(b));for(const value of shortcuts){const b=element('button',value||'All resources');b.dataset.family=value;b.setAttribute('aria-pressed','false');b.onclick=()=>{family.value=value;query.value='';void search();};get('family-shortcuts').append(b);}
 for(const value of [...new Set(docs.map(d=>d.family))].sort())family.add(new Option(value,value));
 for(const value of [...new Set(docs.map(d=>d.category))].sort())category.add(new Option(value,value));
 const params=new URLSearchParams(location.search);query.value=params.get('q')||'';family.value=params.get('family')||'';category.value=params.get('category')||'';
 await search();
 const id=params.get('doc');const page=Number(params.get('page')||1);const doc=docs.find(d=>d.id===id);
 if(!get('documents-area').hidden&&doc&&Number.isInteger(page)&&page>=1&&page<=doc.pages)await read(doc,page);
 try{const saved=JSON.parse(localStorage.getItem('rhoda-reading-position')||'null');get('resume-reading').hidden=!docs.some(d=>d.id===saved?.id&&Number.isInteger(saved.page)&&saved.page>=1&&saved.page<=d.pages);}catch{get('resume-reading').hidden=true;}
 get('catalogue-recovery').hidden=true;
}catch(e){get('status').textContent=(e as Error).message;get('catalogue-recovery').hidden=false;}finally{retryCatalogue.disabled=false;get('documents-area').removeAttribute('aria-busy');}}
retryCatalogue.onclick=()=>void loadCatalogue();
void loadCatalogue();


for(const path of READING_PATHS){
 const button=element('button','');button.append(element('small',path.family),element('strong',path.title),element('span',`${path.steps.length} steps · evidence checklist`));button.setAttribute('aria-pressed','false');get('path-cards').append(button);
 button.onclick=()=>{
  get('path-cards').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));const detail=get('path-detail');detail.hidden=false;detail.replaceChildren(element('h2',path.title),element('p',path.intro));
  const list=document.createElement('ol');for(const step of path.steps)list.append(element('li',step));detail.append(list,element('p','Record: '+path.evidence));
  const find=element('button','Find matching local pages');find.onclick=()=>{switchArea('documents');query.value=path.search;family.value='';category.value='';void search();get('search-form').scrollIntoView();};
  detail.append(find,element('span',' · '),link('Official reference ↗',path.url),element('p','RHODA-authored study plan · check it against the matching instrument manual.'));detail.scrollIntoView({block:'nearest',behavior:'smooth'});detail.focus({preventScroll:true});
 };
}

get('resume-reading').onclick=()=>{try{const saved=JSON.parse(localStorage.getItem('rhoda-reading-position')||'null');const doc=docs.find(d=>d.id===saved?.id);if(doc&&Number.isInteger(saved.page)&&saved.page>=1&&saved.page<=doc.pages)void read(doc,saved.page);else get('status').textContent='The saved document is no longer in this catalogue.';}catch{get('status').textContent='The saved reading position could not be loaded.';}};

function showConcept(c:typeof CONCEPTS[number]){
 switchArea('learning');get('concept-cards').querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.concept===c.id)));
 const detail=get('concept-detail');detail.hidden=false;detail.replaceChildren(element('div',c.family+' / RHODA study note'),element('h2',c.title),element('p',c.answer),element('p',c.example),link('Official source (online)',c.source),element('span',' | '),link('Find local manual pages',`library.html?${new URLSearchParams({q:c.query})}`),element('p','Source checked 1 October 2026. General principles; check the exact model manual.'),element('h3','Check your understanding'),element('p',c.question));
 const choices=element('div','');choices.className='templates';const result=element('p','');result.setAttribute('role','status');
 c.options.forEach((answer,i)=>{const b=element('button',answer);b.onclick=()=>{result.textContent=(i===c.correct?'Correct. ':'Try again. ')+c.why;};choices.append(b);});detail.append(choices,result);detail.scrollIntoView({block:"nearest",behavior:"smooth"});detail.focus({preventScroll:true});
 const u=new URL(location.href);u.searchParams.set('concept',c.id);u.hash='concepts';history.replaceState(null,'',u);
}
for(const c of CONCEPTS){const b=element('button','');b.append(element('small',c.family),element('strong',c.title),element('span','Explanation · example · self-check'));b.dataset.concept=c.id;b.setAttribute('aria-pressed','false');b.onclick=()=>showConcept(c);get('concept-cards').append(b);}
const selectedConcept=CONCEPTS.find(c=>c.id===new URLSearchParams(location.search).get('concept'));if(selectedConcept)showConcept(selectedConcept);

installStudyLibrary(switchArea);

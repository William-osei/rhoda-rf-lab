import { STUDY_TRACKS, type StudyTrack } from './learningTracks';
import { STUDY_ACTIONS, StudyProgressStore, type StudyBackupPreview } from './studyProgress';

const get = (id: string) => document.getElementById(id)!;
const node = <Tag extends keyof HTMLElementTagNameMap>(tag: Tag, text: string) => { const e = document.createElement(tag); e.textContent = text; return e; };
function link(text: string, href: string, external = false) { const a = document.createElement('a'); a.textContent = text; a.href = href; if (external) { a.target = '_blank'; a.rel = 'noopener'; } return a; }
function download(name: string, text: string, type='text/markdown;charset=utf-8') {
 const url = URL.createObjectURL(new Blob([text], {type}));
 const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function guideText(track: StudyTrack) {
 return '# '+track.title+'\n\n'+track.summary+'\n\nPrerequisite: '+track.prerequisite+'\n\n'+track.sections.map(s=>'## '+s.title+'\n\n'+s.text).join('\n\n')+'\n\n## Exercise\n'+track.exercise+'\n\n## Evidence\n'+track.evidence+'\n\n## Action checklist\n'+STUDY_ACTIONS[track.id].map(a=>'- [ ] '+a.label).join('\n')+'\n\n## Common mistake\n'+track.pitfall+'\n\n## References\n'+track.sources.map(s=>'- '+s.title+': '+s.url+' — '+s.purpose).join('\n')+'\n\nRHODA-authored guide. General learning material; not a validated hardware procedure.\n';
}

export function installStudyLibrary(switchArea: (area:string) => void) {
 const store = new StudyProgressStore(Object.fromEntries(Object.entries(STUDY_ACTIONS).map(([id, actions]) => [id, actions.map(a => a.id)])));
 let selected: StudyTrack | undefined;
 let backupPreview: StudyBackupPreview | null=null, fileRequest=0;
 const backupTools=node('section','');backupTools.className='study-backup';backupTools.setAttribute('aria-labelledby','study-backup-title');
 const backupTitle=node('h3','Keep your study progress across browsers');backupTitle.id='study-backup-title';
 const backupHelp=node('p','Download a JSON backup to restore read marks, exercise checks and evidence notes on another browser. The Markdown study record remains your readable report. Notes are included in both files.');
 const backupButton=node('button','Download progress backup');backupButton.type='button';backupButton.id='download-study-backup';backupButton.onclick=()=>download('rhoda-study-backup.json',store.exportBackup(),'application/json');
 const fileLabel=node('label','Select a progress backup to review');const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='.json,application/json';fileInput.id='study-backup-file';fileLabel.append(fileInput);
 const backupStatus=node('p','');backupStatus.id='study-backup-status';backupStatus.setAttribute('role','status');
 const review=node('div','');review.id='study-backup-review';review.hidden=true;
 const restore=node('button','Restore these guide records');restore.id='restore-study-backup';restore.type='button';
 const cancel=node('button','Cancel');cancel.type='button';cancel.id='cancel-study-backup';
 function clearBackupReview(){++fileRequest;backupPreview=null;review.hidden=true;fileInput.value='';}
 cancel.onclick=()=>{clearBackupReview();backupStatus.textContent='Restore cancelled. Your current progress is unchanged.';fileInput.focus();};
 restore.onclick=()=>{
  if(!backupPreview)return;
  try{store.restoreBackup(backupPreview);clearBackupReview();if(selected)showTrack(selected);else refreshProgress();backupStatus.textContent='Backup restored. '+store.storageMessage;restore.disabled=false;fileInput.focus();}
  catch(error){backupStatus.textContent=(error as Error).message;}
 };
 fileInput.onchange=async()=>{
  const token=++fileRequest;backupPreview=null;review.hidden=true;const file=fileInput.files?.[0];if(!file){backupStatus.textContent='';return;}
  backupStatus.textContent='Checking the selected backup…';
  try{if(file.size>150000)throw Error('Choose a RHODA study backup smaller than 150 KB.');const text=await file.text();if(token!==fileRequest)return;backupPreview=store.previewBackup(text);
   const explanation=node('p',`${backupPreview.guideCount} guides · ${backupPreview.readCount} marked read · ${backupPreview.actionCount} exercise actions · ${backupPreview.noteCount} evidence notes. Restoring replaces progress and notes for the guides listed below. Other guides are kept.`);
   const list=node('ul','');for(const id of Object.keys(backupPreview.tracks)){const track=STUDY_TRACKS.find(t=>t.id===id)!;list.append(node('li',track.title));}
   review.replaceChildren(explanation,list,restore,cancel);review.hidden=false;backupStatus.textContent='Review the records, then restore or cancel. No progress has changed yet.';restore.focus();
  }catch(error){if(token===fileRequest)backupStatus.textContent=(error as Error).message;}
 };
 backupTools.append(backupTitle,backupHelp,backupButton,fileLabel,backupStatus,review);get('study-storage-status').after(backupTools);
 function courseHref(id: string) { return `library.html?area=courses&course=${encodeURIComponent(id)}#course-detail`; }
 function summary() {
  const read = STUDY_TRACKS.filter(t => store.get(t.id).read).length;
  const exercised = STUDY_TRACKS.filter(t => store.exerciseComplete(t.id)).length;
  get('study-progress-summary').textContent = `${read} of ${STUDY_TRACKS.length} guides marked read · ${exercised} of ${STUDY_TRACKS.length} exercises recorded`;
  (get('study-progress-meter') as HTMLProgressElement).value = exercised;
  (get('study-progress-meter') as HTMLProgressElement).max = STUDY_TRACKS.length;
  get('study-storage-status').textContent = store.storageMessage;
  const last = STUDY_TRACKS.find(t => t.id === store.lastTrack);
  const resume = get('resume-study') as HTMLAnchorElement;
  resume.hidden = !last; if (last) { resume.href = courseHref(last.id); resume.textContent = 'Resume: '+last.title; }
  const next = STUDY_TRACKS.find(t => !store.get(t.id).read || !store.exerciseComplete(t.id));
  const nextLink = get('next-study') as HTMLAnchorElement;
  nextLink.hidden = !next; if (next) { nextLink.href = courseHref(next.id); nextLink.textContent = 'Continue route: '+next.title; }
  get('study-route').replaceChildren();
  for (const [index, track] of STUDY_TRACKS.entries()) {
   const item = node('li', '');
   const routeLink = link(`${index+1}. ${track.level}`, courseHref(track.id));
   routeLink.append(node('strong', track.title));
   if (selected?.id === track.id) routeLink.setAttribute('aria-current', 'step');
   const record = store.get(track.id);
   const status = node('span', `${record.read?'Reading saved':'Read the guide'} · ${store.exerciseComplete(track.id)?'Exercise recorded':`${record.checks.length}/${STUDY_ACTIONS[track.id].length} actions recorded`}`);
   status.className = 'route-status'; item.append(routeLink, status); get('study-route').append(item);
  }
 }
 function renderTracks() {
  const q = (get('course-query') as HTMLInputElement).value.toLowerCase().trim(), level = (get('course-level') as HTMLSelectElement).value;
  const tracks = STUDY_TRACKS.filter(t => (!level || t.level===level) && JSON.stringify(t).toLowerCase().includes(q));
  get('course-cards').replaceChildren(); get('course-count').textContent = tracks.length+' study guides';
  for (const track of tracks) {
   const b = node('button', ''); b.setAttribute('aria-pressed', String(selected?.id===track.id)); b.dataset.course = track.id;
   b.append(node('small', track.level), node('strong', track.title), node('span', track.summary));
   const record = store.get(track.id), state = node('span', `${record.read?'Read':'Not marked read'} · ${store.exerciseComplete(track.id)?'Exercise recorded':`${record.checks.length}/${STUDY_ACTIONS[track.id].length} exercise actions`}`);
   state.className = 'course-state'; b.append(state); b.onclick = () => showTrack(track); get('course-cards').append(b);
  }
  if (!tracks.length) get('course-cards').append(node('p', 'No guides match. Try a broader topic or select All levels.'));
 }
 function refreshProgress() { summary(); renderTracks(); }
 function showTrack(track: StudyTrack) {
  selected = track; switchArea('courses'); store.visit(track.id); refreshProgress();
  const detail = get('course-detail'); detail.hidden = false;
  detail.replaceChildren(node('div',track.level+' · RHODA-authored study guide'),node('h2',track.title),node('p',track.summary),node('h3','Before you begin'),node('p',track.prerequisite));
  const guidedSteps=[...track.sections,{title:'Your exercise',text:track.exercise},{title:'Evidence to record',text:track.evidence},{title:'Common mistake',text:track.pitfall}];
  const stepKey='rhoda-learning-step:'+track.id;
  let stepIndex=0;
  try{const saved=Number(localStorage.getItem(stepKey));if(Number.isInteger(saved)&&saved>=0&&saved<guidedSteps.length)stepIndex=saved;}catch{}
  const walkthrough=node('section','');walkthrough.className='guided-walkthrough';walkthrough.setAttribute('aria-label','Step-by-step walkthrough');
  const walkthroughHeader=node('div','');walkthroughHeader.className='guided-walkthrough-header';
  const walkthroughTitle=node('h3','Guided walkthrough');
  const stepStatus=node('span','');stepStatus.className='guided-step-status';stepStatus.setAttribute('role','status');stepStatus.setAttribute('aria-live','polite');
  const stepProgress=document.createElement('progress');stepProgress.className='guided-step-progress';stepProgress.max=guidedSteps.length;stepProgress.setAttribute('aria-label','Walkthrough progress');
  const stepView=node('article','');stepView.className='guided-step';stepView.setAttribute('aria-live','polite');stepView.setAttribute('aria-atomic','true');
  const stepHeading=node('h4','');stepHeading.tabIndex=-1;
  const stepText=node('p','');
  stepView.append(stepHeading,stepText);
  const stepNavigation=node('div','');stepNavigation.className='guided-step-navigation';
  const previous=node('button','Previous step');previous.type='button';
  const jump=document.createElement('select');jump.className='guided-step-jump';jump.setAttribute('aria-label','Jump to a walkthrough step');
  guidedSteps.forEach((step,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${index+1}. ${step.title}`;jump.append(option);});
  const nextStep=node('button','Next step');nextStep.type='button';nextStep.className='primary';
  function renderStep(focusHeading=false){
   const step=guidedSteps[stepIndex];stepHeading.textContent=step.title;stepText.textContent=step.text;
   stepStatus.textContent=`Step ${stepIndex+1} of ${guidedSteps.length}`;stepProgress.value=stepIndex+1;jump.value=String(stepIndex);
   previous.disabled=stepIndex===0;nextStep.textContent=stepIndex===guidedSteps.length-1?'Review exercise checklist':'Next step';
   stepView.classList.remove('guided-step-enter');void stepView.offsetWidth;stepView.classList.add('guided-step-enter');
   try{localStorage.setItem(stepKey,String(stepIndex));}catch{}
   if(focusHeading)stepHeading.focus({preventScroll:true});
  }
  previous.onclick=()=>{if(stepIndex>0){stepIndex--;renderStep(true);}};
  nextStep.onclick=()=>{if(stepIndex<guidedSteps.length-1){stepIndex++;renderStep(true);}else progress.scrollIntoView({behavior:'smooth',block:'center'});};
  jump.onchange=()=>{const chosen=Number(jump.value);if(Number.isInteger(chosen)&&chosen>=0&&chosen<guidedSteps.length){stepIndex=chosen;renderStep(true);}};
  stepNavigation.append(previous,jump,nextStep);walkthroughHeader.append(walkthroughTitle,stepStatus);walkthrough.append(walkthroughHeader,stepProgress,stepView,stepNavigation);detail.append(walkthrough);
  renderStep();
  const progress = node('section', ''); progress.className = 'study-checklist'; progress.setAttribute('aria-label','Your progress for '+track.title);
  progress.append(node('h3','Keep your place and your evidence'),node('p','Mark the guide read after reviewing it. Record each action only after doing it and keeping the evidence. These checks are self-reported; they do not certify lab competency.'));
  const readLabel = node('label', ''); readLabel.className = 'study-check';
  const read = document.createElement('input'); read.type='checkbox'; read.id='course-read'; read.checked=store.get(track.id).read;
  read.onchange = () => { store.update(track.id,{read:read.checked}); refreshProgress(); };
  readLabel.append(read,node('span','I have read this guide')); progress.append(readLabel);
  const fieldset = document.createElement('fieldset'); fieldset.append(node('legend','Exercise action checklist'));
  const actions = STUDY_ACTIONS[track.id];
  for (const action of actions) {
   const label = node('label', ''); label.className='study-check';
   const input = document.createElement('input'); input.type='checkbox'; input.dataset.studyAction=action.id; input.checked=store.get(track.id).checks.includes(action.id);
   input.onchange = () => { const checks = store.get(track.id).checks.filter(id=>id!==action.id); if(input.checked)checks.push(action.id); store.update(track.id,{checks}); refreshProgress(); };
   label.append(input,node('span',action.label)); fieldset.append(label);
  }
  progress.append(fieldset);
  const noteLabel = node('label','Evidence location or learning note'); noteLabel.className='study-note';
  const note = document.createElement('textarea'); note.id='study-evidence-note'; note.maxLength=1500; note.rows=3; note.value=store.get(track.id).note; note.placeholder='Example: simulated-capture-01.png; period estimate 1 ms; still need a physical probe check.';
  note.setAttribute('aria-describedby','study-note-help');
  const help = node('p','Keep file names, observations and questions here. Notes stay in this browser and are included in your download.'); help.id='study-note-help';
  note.oninput = () => { store.update(track.id,{note:note.value}); if(get('study-storage-status').textContent!==store.storageMessage)get('study-storage-status').textContent=store.storageMessage; };
  noteLabel.append(note); progress.append(noteLabel,help);
  const reset = node('button','Clear this guide’s progress'); reset.type='button'; reset.onclick=()=>{store.reset(track.id); read.checked=false; fieldset.querySelectorAll<HTMLInputElement>('input').forEach(c=>c.checked=false); note.value=''; refreshProgress();}; progress.append(reset);
  detail.append(progress,node('h3','Read the primary references'));
  for(const source of track.sources) detail.append(link(source.title+' ↗',source.url,true),node('p',source.purpose+' Online reference; source checked 3 October 2026.'));
  const guideDownload = node('button','Download this study guide'); guideDownload.onclick=()=>download(track.id+'-study-guide.md',guideText(track));
  const controls = node('div',''); controls.className='study-guide-actions'; controls.append(guideDownload,link('Open the narrated scope tour','./?lesson=scope-tour'),link('Open the practice bench','spatial-bench.html'));
  const next = STUDY_TRACKS[STUDY_TRACKS.findIndex(t=>t.id===track.id)+1]; if(next)controls.append(link('Next guide: '+next.title,courseHref(next.id)));
  detail.append(controls);
  const url = new URL(location.href); url.searchParams.set('course',track.id); url.hash='course-detail'; history.replaceState(null,'',url);
  detail.scrollIntoView({block:'start',behavior:'smooth'}); detail.focus({preventScroll:true});
 }
 get('download-study-record').onclick=()=>{
  const text='# RHODA study record\n\nExported: '+new Date().toISOString()+'\n\nSelf-reported learning progress. A checked exercise records the learner’s claim; it is not an assessment, physical test or certification.\n\n'+STUDY_TRACKS.map(track=>{
   const record=store.get(track.id);
   return '## '+track.title+'\n\nGuide marked read: '+(record.read?'yes':'no')+'\nExercise actions recorded: '+record.checks.length+'/'+STUDY_ACTIONS[track.id].length+'\n\n'+STUDY_ACTIONS[track.id].map(a=>'- ['+(record.checks.includes(a.id)?'x':' ')+'] '+a.label).join('\n')+'\n\nEvidence note:\n'+(record.note||'(not recorded)')+'\n\nLast progress change: '+(record.updatedAt||'(not recorded)')+'\nGuide: '+new URL(courseHref(track.id),location.href).href;
  }).join('\n\n')+'\n';
  download('rhoda-study-record.md',text);
 };
 get('course-query').oninput=renderTracks; get('course-level').onchange=renderTracks; refreshProgress();
 window.addEventListener('storage',event=>{
  if(event.key!=='rhoda-study-progress-v1'&&event.key!==null)return;store.refresh();refreshProgress();
  if(!selected)return;const record=store.get(selected.id),read=get('course-read') as HTMLInputElement|null,note=get('study-evidence-note') as HTMLTextAreaElement|null;
  if(read)read.checked=record.read;if(note)note.value=record.note;
  get('course-detail').querySelectorAll<HTMLInputElement>('[data-study-action]').forEach(input=>input.checked=record.checks.includes(input.dataset.studyAction!));
 });
 const selectedTrack = STUDY_TRACKS.find(t=>t.id===new URLSearchParams(location.search).get('course')); if(selectedTrack)showTrack(selectedTrack);
}

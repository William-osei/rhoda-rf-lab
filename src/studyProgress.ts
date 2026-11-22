/** Local, self-reported study progress. Reading and exercise evidence stay separate. */
export type StudyProgress = { read: boolean; checks: string[]; note: string; updatedAt: string };
type ProgressFile = { version: 1; lastTrack: string | null; tracks: Record<string, StudyProgress> };
export type StudyBackupPreview = { tracks: Record<string, StudyProgress>; lastTrack: string | null; guideCount: number; readCount: number; actionCount: number; noteCount: number };
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'rhoda-study-progress-v1';
const empty = (): ProgressFile => ({ version: 1, lastTrack: null, tracks: Object.create(null) });
const blank = (): StudyProgress => ({ read: false, checks: [], note: '', updatedAt: '' });

export class StudyProgressStore {
 private data = empty();
 private message = 'Saved on this browser. Exercise checks are your own record, not an assessment.';
 private loadedRaw: string|null|undefined=undefined;
 private unsaved = new Map<string,StudyProgress|null>();
 private unsavedLastTrack: string|undefined=undefined;
 constructor(private allowed: Record<string, readonly string[]>, private storage: () => StorageAccess = () => localStorage) {
  this.reload();
 }
 private reload() {
  try {
   const raw = this.storage().getItem(KEY);
   if(raw===this.loadedRaw)return;
   const parsed: unknown = raw?JSON.parse(raw):empty();
   if (!parsed || typeof parsed !== 'object' || (parsed as {version?:unknown}).version !== 1) throw new Error('Unsupported progress format');
   const file = parsed as Partial<ProgressFile>;
   if (!file.tracks || typeof file.tracks !== 'object' || Array.isArray(file.tracks)) throw new Error('Invalid progress');
   const loaded=empty();
   for (const [id, ids] of Object.entries(this.allowed)) {
    const value = Object.prototype.hasOwnProperty.call(file.tracks,id) ? file.tracks[id] : undefined;
    if (!value || typeof value !== 'object') continue;
    loaded.tracks[id] = {
     read: value.read === true,
     checks: Array.isArray(value.checks) ? [...new Set(value.checks.filter(c => typeof c === 'string' && ids.includes(c)))] : [],
     note: typeof value.note === 'string' ? value.note.slice(0, 1500) : '',
     updatedAt: typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : '',
    };
   }
   loaded.lastTrack = typeof file.lastTrack === 'string' && Object.prototype.hasOwnProperty.call(this.allowed,file.lastTrack) ? file.lastTrack : null;
   for(const [id,record] of this.unsaved){if(record)loaded.tracks[id]={...record,checks:[...record.checks]};else delete loaded.tracks[id];}
   if(this.unsavedLastTrack)loaded.lastTrack=this.unsavedLastTrack;
   this.data=loaded;this.loadedRaw=raw;
  } catch {
   this.message = this.unsaved.size||this.unsavedLastTrack ? 'Browser storage is unavailable. Progress is kept only until this page closes; download your study record to keep a copy.' : 'Saved progress could not be loaded. New changes will stay in this session if browser storage is unavailable.';
  }
 }
 refresh() { this.reload(); }
 get(id: string): StudyProgress { this.reload(); const value = Object.prototype.hasOwnProperty.call(this.allowed,id) && Object.prototype.hasOwnProperty.call(this.data.tracks,id) ? this.data.tracks[id] : blank(); return {...value, checks: [...value.checks]}; }
 get lastTrack() { this.reload(); return this.data.lastTrack; }
 get storageMessage() { return this.message; }
 exportBackup() {
  this.reload();
  return JSON.stringify({kind:'rhoda-study-backup',version:1,exportedAt:new Date().toISOString(),selfReported:true,lastTrack:this.data.lastTrack,tracks:this.data.tracks},null,2);
 }
 /** Validate the entire file before touching browser progress. Unknown guides are ignored. */
 previewBackup(text: string): StudyBackupPreview {
  if(text.length>150000)throw Error('Choose a RHODA study backup smaller than 150 KB.');
  let file: unknown; try { file=JSON.parse(text); } catch { throw Error('The selected file is not valid JSON. Choose a RHODA study backup.'); }
  if(!file||typeof file!=='object')throw Error('This is not a RHODA study backup.');
  const backup=file as Record<string,unknown>;
  if(backup.kind!=='rhoda-study-backup'||backup.version!==1||backup.selfReported!==true||!backup.tracks||typeof backup.tracks!=='object'||Array.isArray(backup.tracks))throw Error('This is not a supported RHODA study backup.');
  const tracks: Record<string,StudyProgress>=Object.create(null);
  for(const [id,raw] of Object.entries(backup.tracks)) {
   if(!Object.prototype.hasOwnProperty.call(this.allowed,id))continue;
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error(`The ${id} guide record is invalid. No progress was changed.`);
   const value=raw as Record<string,unknown>;
   if(typeof value.read!=='boolean'||!Array.isArray(value.checks)||value.checks.some(c=>typeof c!=='string'||!this.allowed[id].includes(c))||typeof value.note!=='string'||value.note.length>1500||typeof value.updatedAt!=='string'||(value.updatedAt&&!Number.isFinite(Date.parse(value.updatedAt))))throw Error(`The ${id} guide record is invalid. No progress was changed.`);
   tracks[id]={read:value.read,checks:[...new Set(value.checks as string[])],note:value.note,updatedAt:value.updatedAt};
  }
  const records=Object.values(tracks); if(!records.length)throw Error('No matching guide records were found. Your current progress is unchanged.');
  return {tracks,lastTrack:typeof backup.lastTrack==='string'&&Object.prototype.hasOwnProperty.call(tracks,backup.lastTrack)?backup.lastTrack:null,guideCount:records.length,readCount:records.filter(r=>r.read).length,actionCount:records.reduce((n,r)=>n+r.checks.length,0),noteCount:records.filter(r=>r.note.trim()).length};
 }
 restoreBackup(preview: StudyBackupPreview) {
  // Revalidate even programmatic callers; import cannot introduce unknown or inherited IDs.
  const checked=this.previewBackup(JSON.stringify({kind:'rhoda-study-backup',version:1,selfReported:true,lastTrack:preview.lastTrack,tracks:preview.tracks}));
  this.reload();
  for(const [id,record] of Object.entries(checked.tracks)){this.data.tracks[id]={...record,checks:[...record.checks]};this.unsaved.set(id,this.data.tracks[id]);}
  if(checked.lastTrack){this.data.lastTrack=checked.lastTrack;this.unsavedLastTrack=checked.lastTrack;}
  this.persist();
 }
 private persist() {
  try { const raw=JSON.stringify(this.data);this.storage().setItem(KEY,raw);this.loadedRaw=raw;this.unsaved.clear();this.unsavedLastTrack=undefined;this.message = 'Saved on this browser. Exercise checks are your own record, not an assessment.'; }
  catch { this.message = 'Browser storage is unavailable. Progress is kept only until this page closes; download your study record to keep a copy.'; }
 }
 visit(id: string) { if (!Object.prototype.hasOwnProperty.call(this.allowed,id)) return; this.reload();this.data.lastTrack = id;this.unsavedLastTrack=id;this.persist(); }
 update(id: string, change: Partial<Pick<StudyProgress, 'read' | 'checks' | 'note'>>) {
  if (!Object.prototype.hasOwnProperty.call(this.allowed,id)) return;
  const current = this.get(id);
  this.data.tracks[id] = {
   read: typeof change.read === 'boolean' ? change.read : current.read,
   checks: change.checks ? [...new Set(change.checks.filter(c => this.allowed[id].includes(c)))] : current.checks,
   note: change.note !== undefined ? change.note.slice(0, 1500) : current.note,
   updatedAt: new Date().toISOString(),
  };
  this.data.lastTrack = id;
  this.unsavedLastTrack=id;this.unsaved.set(id,this.data.tracks[id]);
  this.persist();
 }
 reset(id: string) { if (!Object.prototype.hasOwnProperty.call(this.allowed,id)) return; this.reload();delete this.data.tracks[id];this.unsaved.set(id,null);this.persist(); }
 exerciseComplete(id: string) { return Object.prototype.hasOwnProperty.call(this.allowed,id) && Boolean(this.allowed[id]?.length) && this.allowed[id].every(c => this.get(id).checks.includes(c)); }
}

export const STUDY_ACTIONS: Record<string, {id:string; label:string}[]> = {
 waveform: [
  {id:'scale',label:'Preview and approve 100 µs/div and 0.5 V/div on the simulated bench.'},
  {id:'compare',label:'Record the period/division estimate alongside frequency and peak-to-peak readouts.'},
  {id:'explain',label:'Save a record marked SIMULATION and explain why scale changes leave the signal unchanged.'},
 ],
 measurement: [
  {id:'record',label:'Complete an Experiment record with the question, signal chain and simulated settings.'},
  {id:'evidence',label:'Record repeated observations and where the raw evidence is saved.'},
  {id:'limits',label:'List the model-specific checks still required before any physical lab exercise.'},
 ],
 dsp: [
  {id:'data',label:'Run the offline Python starter and inspect its waveform CSV and session metadata.'},
  {id:'units',label:'Explain the sample interval, voltage units and nominal frequency-bin spacing.'},
  {id:'features',label:'Record feature units, analysis version and assumptions in your study record.'},
 ],
 ml: [
  {id:'split',label:'Check that no acquisition session appears in both training and test sets.'},
  {id:'baseline',label:'Run the baseline and save its held-out confusion matrix.'},
  {id:'shift',label:'Change synthetic noise or distribution and describe errors and real-signal limitations.'},
 ],
 automation: [
  {id:'preview',label:'Inspect one proposed timebase change and approve it on the mock bench.'},
  {id:'readback',label:'Compare the execution result with readback and keep the structured transaction.'},
  {id:'boundary',label:'Write the physical identity, approval and recovery evidence that is still missing.'},
 ],
};

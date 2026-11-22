import { avatarLabel, cycleAvatar, companionGreetingLabel, activateCompanionGreeting, avatarMotionEnabled, setAvatarMotion } from './avatarStyle';
import { lessonSnapshot, stepLesson, nextLesson, readLessonAloud, stopLessonSpeech, pauseLessonSpeech, resumeLessonSpeech } from './xrDesk';
import {
  PanelDocument,
  PanelUI,
  UIKitDocument,
  createSystem,
  eq,
} from "@iwsdk/core";
import type { RhodeSchwarzAssistant, RhodeSchwarzState } from "./rhode_schwarz";
import { captureFrame, identifyComponent } from "./vision";
import { confirmPending, denyPending, getPendingConfirmation } from "./instrument";
import { geminiTTS } from "./genai";

export class DashboardSystem extends createSystem({
  dashboard: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "/ui/dashboard.json")],
  },
}) {
  private document: UIKitDocument | null = null;
  private autoFollowEnabled: boolean = false;
  private lastAvatar = "";
  private lastGreeting = "";
  private lastMotion = "";
  private lastLesson = '';
  private lastStatusSnapshot: string = '';
  private lastRenderedStatus = '';
  private lastMuted: boolean | null = null;
  private lastFollow = '';
  private lastSpeech='';
  private confirmationBusy=false;
  private statusOverride:{text:string;until:number}|null=null;

  init() {
    this.queries.dashboard.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument | undefined;
      if (!doc) return;
      this.document = doc;
      this.lastLesson = "";this.lastAvatar="";this.lastGreeting="";this.lastMotion="";this.lastRenderedStatus="";this.lastMuted=null;this.lastFollow="";
      this.wire(doc);
      this.refreshStatus();
    });
    this.queries.dashboard.subscribe("disqualify", () => { this.document = null; });
  }

  update(_delta: number, _time: number) {
    this.refreshStatus();
    const speech=document.getElementById('speech-status')?.textContent||'';
    if(this.document&&speech!==this.lastSpeech){this.lastSpeech=speech;(this.document.getElementById('speech-state') as any)?.setProperties?.({text:speech});}
    const avatar=avatarLabel();
    if(this.document && avatar!==this.lastAvatar){this.lastAvatar=avatar;(this.document.getElementById('btn-avatar') as any)?.setProperties?.({text:avatar+' - change'});}
    const greeting=companionGreetingLabel();
    if(this.document&&greeting!==this.lastGreeting){this.lastGreeting=greeting;(this.document.getElementById('btn-wave') as any)?.setProperties?.({text:greeting});}
    const motion=avatarMotionEnabled()?'Pause animation':'Enable animation';
    if(this.document&&motion!==this.lastMotion){this.lastMotion=motion;(this.document.getElementById('btn-motion') as any)?.setProperties?.({text:motion});}
    const lesson=lessonSnapshot();const snapshot=JSON.stringify(lesson);
    if(this.document && snapshot!==this.lastLesson){this.lastLesson=snapshot;
      (this.document.getElementById('lesson-title') as any)?.setProperties?.({text:lesson.title});
      (this.document.getElementById('lesson-position') as any)?.setProperties?.({text:lesson.count});
      (this.document.getElementById('lesson-body') as any)?.setProperties?.({text:lesson.text});
    }
  }

  private wire(doc: UIKitDocument) {
    const el = (id: string) => doc.getElementById(id) as any;

    el('btn-motion')?.addEventListener('click',()=>setAvatarMotion(!avatarMotionEnabled()));
    el('btn-wave')?.addEventListener('click',activateCompanionGreeting);
    el('btn-avatar')?.addEventListener('click',cycleAvatar);
    el('lesson-back')?.addEventListener('click',()=>stepLesson(-1));
    el('lesson-forward')?.addEventListener('click',()=>stepLesson(1));
    el('lesson-read')?.addEventListener('click',readLessonAloud);
    el('lesson-stop')?.addEventListener('click',stopLessonSpeech);
    el('lesson-pause')?.addEventListener('click',pauseLessonSpeech);
    el('lesson-resume')?.addEventListener('click',resumeLessonSpeech);
    el('btn-station')?.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('rhoda-station',{detail:'right'})));
    el('lesson-switch')?.addEventListener('click',()=>nextLesson());
    el("btn-talk")?.addEventListener("click", () => {
      const rs = this.getRhoda();
      if (!rs) return;
      const newMuted = !rs.isMuted();
      rs.setMuted(newMuted);
      el("btn-talk")?.setProperties?.({
        text: newMuted ? 'Start Mic' : 'Stop Mic',
        class: newMuted ? 'btn-mic-off' : 'btn-mic-on',
      });
    });

    el("btn-lang")?.addEventListener("click", () => {
      const rs = this.getRhoda();
      if (!rs) return;
      const next = rs.getLanguage() === 'en' ? 'tw' : 'en';
      rs.setLanguage(next);
      el("btn-lang")?.setProperties?.({
        text: next === 'en' ? 'Switch to Twi' : 'Switch to English',
        class: next === 'tw' ? 'btn-on' : 'btn',
      });
    });

    el("btn-identify")?.addEventListener("click", () => this.handleIdentify());

    el("btn-summon")?.addEventListener("click", () => {
      const rs = this.getRhoda();
      if (rs && this.world.camera) rs.summon(this.world.camera, rs.getGroundY());
    });

    el("btn-follow")?.addEventListener("click", () => {
      const rs = this.getRhoda();
      if (!rs) return;
      const on = rs.toggleAutoFollow();
      this.autoFollowEnabled = on;
      el("btn-follow")?.setProperties?.({ class: on ? 'btn-on' : 'btn' });
    });

    el("btn-reset")?.addEventListener("click", () => {
      const rs = this.getRhoda();
      if (rs) rs.resetConversation();
    });

    el("btn-allow")?.addEventListener("click", () => this.resolveConfirmation(true));
    el("btn-deny")?.addEventListener("click", () => this.resolveConfirmation(false));
  }

  private async resolveConfirmation(allow:boolean) {
    if(this.confirmationBusy||!getPendingConfirmation())return;
    this.confirmationBusy=true;
    this.setTemporaryStatus(allow?'Applying approved operation…':'Cancelling pending operation…',Infinity);
    this.hideConfirmButtons();
    try {
      const result=await (allow?confirmPending():denyPending());
      this.setTemporaryStatus(result.status==='ok'?(allow?'Confirmed':'Cancelled'):
        `${allow?'Approval':'Cancellation'} failed: ${result.error||'Operation could not be completed.'}`,result.status==='ok'?3000:6000);
    } catch(error) {
      this.setTemporaryStatus(`${allow?'Approval':'Cancellation'} failed: ${error instanceof Error?error.message:String(error)}`,6000);
    } finally {
      this.confirmationBusy=false;
      this.refreshStatus();
    }
  }

  private setTemporaryStatus(text:string,duration:number) {
    this.statusOverride={text,until:performance.now()+duration};
    this.setStatus(text);
  }

  private async handleIdentify() {
    const rs = this.getRhoda();
    this.setStatus('Capturing...');

    try {
      const frame = await captureFrame();
      if (!frame) {
        this.setStatus('No camera');
        setTimeout(() => this.setStatus('Ready'), 3000);
        return;
      }

      this.setStatus('Analyzing...');
      const result = await identifyComponent(frame);
      this.setStatus(result.label);

      const speech = `${result.description || result.label}${result.safety_note ? '. ' + result.safety_note : ''}`;
      if (rs) {
        try {
          rs.setState('SPEAKING');
          rs.setStatusLabel('Speaking...');
          const audio = await geminiTTS(speech);
          // playAudioBlob starts talking animation + lip sync, returns to idle on end
          await rs.playAudioBlob(audio);
        } catch (_) {
          const u = new SpeechSynthesisUtterance(speech);
          u.lang = 'en-US';
          speechSynthesis.speak(u);
        }
        rs.setState('READY');
        rs.setStatusLabel('Ready');
      }

      setTimeout(() => this.setStatus('Ready'), 6000);
    } catch {
      this.setStatus('Failed');
      setTimeout(() => this.setStatus('Ready'), 3000);
    }
  }

  private setStatus(text: string) {
    if(text===this.lastRenderedStatus)return;
    const node = this.document?.getElementById("status-mode") as any;
    if(node){node.setProperties?.({ text });this.lastRenderedStatus=text;}
  }

  private showConfirmButtons() {
    if (!this.document) return;
    (this.document.getElementById("btn-allow") as any)?.setProperties?.({ class: 'btn-yes',pointerEvents:'auto' });
    (this.document.getElementById("btn-deny") as any)?.setProperties?.({ class: 'btn-no',pointerEvents:'auto' });
  }

  private hideConfirmButtons() {
    if (!this.document) return;
    (this.document.getElementById("btn-allow") as any)?.setProperties?.({ class: 'btn-hidden',pointerEvents:'none' });
    (this.document.getElementById("btn-deny") as any)?.setProperties?.({ class: 'btn-hidden',pointerEvents:'none' });
  }

  private refreshStatus() {
    if (!this.document) return;
    const rs = this.getRhoda();
    const talkBtn = this.document.getElementById("btn-talk") as any;
    const followBtn = this.document.getElementById("btn-follow") as any;
    if(this.statusOverride&&performance.now()>=this.statusOverride.until)this.statusOverride=null;

    if (rs) {
      const state = rs.getState();
      const label = typeof rs.getStatusLabel === 'function' ? rs.getStatusLabel() : undefined;
      const text = label || state || 'Ready';
      const muted = rs.isMuted ? rs.isMuted() : true;

      this.logStatus(state as any, text);
      this.setStatus(this.statusOverride?.text||text);
      if(talkBtn&&muted!==this.lastMuted){
        talkBtn.setProperties?.({text:muted?'Start Mic':'Stop Mic',class:muted?'btn-mic-off':'btn-mic-on'});
        this.lastMuted=muted;
      }

      const following = typeof rs.isAutoFollowEnabled === 'function'
        ? rs.isAutoFollowEnabled() : this.autoFollowEnabled;
      this.autoFollowEnabled = following;
      const followText=following?(avatarMotionEnabled()?'Stop following':'Stop follow (paused)'):'Follow me';
      if(followBtn&&followText!==this.lastFollow){
        followBtn.setProperties?.({text:followText,class:following?'btn-on':'btn'});
        this.lastFollow=followText;
      }

    } else {
      this.setStatus(this.statusOverride?.text||'Offline');
    }
    if(getPendingConfirmation()&&!this.confirmationBusy)this.showConfirmButtons();else this.hideConfirmButtons();
  }

  private getRhoda(): RhodeSchwarzAssistant | undefined {
    return (this.world as any).rhodeSchwarz as RhodeSchwarzAssistant | undefined;
  }

  private logStatus(state: RhodeSchwarzState, text: string) {
    const s = `${state}|${text}`;
    if (this.lastStatusSnapshot === s) return;
    this.lastStatusSnapshot = s;
  }
}

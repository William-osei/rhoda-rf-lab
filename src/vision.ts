/**
 * AR / Vision — Component Identification + Live Camera Stream (Core 4a)
 *
 * Two modes:
 * 1. One-shot identify: capture a frame, send to Gemini vision, get a detailed description
 * 2. Live stream: open a persistent Gemini Live API session, stream camera frames at ~1fps,
 *    get real-time narration of what the camera sees
 */

import { sessionLogger } from './session';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
async function getGemini() {
  if (!GEMINI_API_KEY) throw new Error('Configure VITE_GEMINI_API_KEY to use AI features');
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

export interface IdentifyResult {
  label: string;
  confidence: number;
  safety_note?: string;
  description?: string;
}

const VISION_PROMPT = `You are Rhoda, an expert Rohde & Schwarz oscilloscope lab assistant at KNUST.

Examine this image carefully and describe what you see in detail.

If it shows oscilloscope components, ports, knobs, or connectors:
- Name the specific component (e.g. "CH1 BNC Input", "Horizontal Scale Knob", "USB 3.0 Port")
- Explain what it does and how a student would use it
- Include any safety warnings relevant to that component

If it shows a waveform or trace on screen:
- Describe the waveform shape, amplitude, frequency if visible
- Note any anomalies (clipping, noise, triggering issues)

If it shows something else:
- Describe what you see and how it relates to the lab setup

Respond ONLY in this JSON format:
{
  "label": "short component name",
  "description": "2-3 sentence detailed explanation of what this is and how to use it",
  "confidence": 0.0 to 1.0,
  "safety_note": "safety tip if relevant, or null"
}`;

export async function identifyComponent(image_base64: string): Promise<IdentifyResult> {
  console.log('🔍 [VISION] Identifying component from image...');
  sessionLogger.logToolCall('identify_component', {}, 'READ');

  try {
    const result = await (await getGemini()).models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { text: VISION_PROMPT },
          { inlineData: { mimeType: 'image/jpeg', data: image_base64 } },
        ],
      }],
      config: { thinkingConfig: { thinkingBudget: 0 } },
    });

    const responseText = result.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in vision response');

    const parsed = JSON.parse(jsonMatch[0]);
    const out: IdentifyResult = {
      label: parsed.label || 'Unknown',
      description: parsed.description || '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      safety_note: parsed.safety_note || undefined,
    };

    sessionLogger.logAssistantResponse(
      `Identified: ${out.label} — ${out.description}`,
      'component_identification'
    );
    console.log('✅ [VISION] Identified:', out.label);
    return out;
  } catch (err) {
    console.error('❌ [VISION] Identification failed:', err);
    sessionLogger.logSystemEvent(`Vision error: ${(err as Error).message}`);
    return {
      label: 'Could not identify',
      description: 'Please try again with a clearer image.',
      confidence: 0,
    };
  }
}

// ── Live Camera Stream via Gemini Live API ──

type LiveStreamCallback = (text: string) => void;

let liveSession: any = null;
let cameraStream: MediaStream | null = null;
let frameIntervalId: number | null = null;
let videoEl: HTMLVideoElement | null = null;
let liveStart: Promise<void> | null = null;
let liveRevision = 0;
let captureRevision = 0;
let capturePending: Promise<string | null> | null = null;
const captureStreams = new Set<MediaStream>();
const captureVideos = new Set<HTMLVideoElement>();

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => { try { if (track.readyState !== 'ended') track.stop(); } catch { /* Best effort. */ } });
}

function detachVideo(video: HTMLVideoElement | null): void {
  if (!video) return;
  try { video.pause(); } catch { /* Best effort. */ }
  video.srcObject = null;
}

function emitText(callback: LiveStreamCallback, text: string): void {
  try { callback(text); } catch (error) { console.warn('Live vision callback failed', error); }
}

export function isLiveStreamActive(): boolean {
  return liveSession !== null || liveStart !== null;
}

export function startLiveStream(onText: LiveStreamCallback): Promise<void> {
  if (liveStart) return liveStart;
  if (liveSession) return Promise.resolve();
  const revision = ++liveRevision;
  const pending = beginLiveStream(revision, onText);
  liveStart = pending;
  void pending.then(() => { if (liveStart === pending) liveStart = null; },
    () => { if (liveStart === pending) liveStart = null; });
  return pending;
}

async function beginLiveStream(revision: number, onText: LiveStreamCallback): Promise<void> {
  let acquired: MediaStream | null = null;
  let connected: any = null;
  try {
    // Configuration is checked before asking the user to enable a camera.
    const ai = await getGemini();
    const { Modality } = await import('@google/genai');
    if (revision !== liveRevision) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable in this browser or context.');
    acquired = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: 640, height: 480 },
    });
    if (revision !== liveRevision) { stopTracks(acquired); return; }
    cameraStream = acquired;
    const video = document.createElement('video');
    videoEl = video;
    video.srcObject = acquired;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    if (revision !== liveRevision) return;
    connected = await ai.live.connect({
      model: 'gemini-2.5-flash-preview-native-audio-dialog',
      callbacks: {
        onopen: () => { if (revision === liveRevision) console.log('Live vision session opened'); },
        onmessage: (message: any) => {
          if (revision !== liveRevision) return;
          const content = message?.serverContent;
          if (content?.outputTranscription?.text) emitText(onText, content.outputTranscription.text);
          for (const part of content?.modelTurn?.parts || []) {
            if (typeof part.text === 'string' && part.text) emitText(onText, part.text);
          }
        },
        onerror: () => {
          if (revision !== liveRevision) return;
          cleanupLiveStream();
          emitText(onText, 'Live vision failed and the camera was stopped. Start it again to retry.');
        },
        onclose: () => {
          if (revision !== liveRevision) return;
          cleanupLiveStream();
          emitText(onText, 'Live vision ended. The camera is stopped.');
        },
      },
      config: {
        responseModalities: [Modality.TEXT],
        systemInstruction: {
          parts: [{
            text: 'You are Rhoda, a lab assistant for Rohde & Schwarz oscilloscopes at KNUST. '
              + 'The student is showing you their lab setup through a camera. '
              + 'Describe what you see clearly and concisely. '
              + 'Identify oscilloscope components, waveforms, or lab equipment. '
              + 'Separate visible evidence from assumptions and flag uncertain identification. '
              + 'Keep responses to 1-2 sentences per observation.',
          }],
        },
      },
    });
    // Stop may occur during permission, video playback or provider connection.
    if (revision !== liveRevision) return;
    liveSession = connected;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Camera frame capture is unavailable.');
    let sending = false;
    frameIntervalId = window.setInterval(() => {
      if (revision !== liveRevision || !videoEl || !liveSession || sending || video.readyState < 2) return;
      sending = true;
      try {
        context.drawImage(video, 0, 0, 640, 480);
        const data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
        const sent = liveSession.sendRealtimeInput({ video: { data, mimeType: 'image/jpeg' } });
        void Promise.resolve(sent).then(() => { sending = false; }, () => {
          sending = false;
          if (revision !== liveRevision) return;
          cleanupLiveStream();
          emitText(onText, 'Camera frame delivery failed. The camera was stopped; retry when the connection is available.');
        });
      } catch {
        sending = false;
        cleanupLiveStream();
        emitText(onText, 'Camera frame delivery failed. The camera was stopped; retry when the connection is available.');
      }
    }, 1000);
    sessionLogger.logSystemEvent('Live camera stream started');
  } catch (error) {
    if (revision !== liveRevision) return;
    const cleanedConnection = liveSession;
    cleanupLiveStream();
    if (connected === cleanedConnection) connected = null;
    emitText(onText, 'Live vision could not start. Camera access or AI configuration may be unavailable.');
    sessionLogger.logSystemEvent('Live camera stream failed to start');
  } finally {
    // Late permission results are owned by this attempt, never by a newer stream.
    if (acquired && acquired !== cameraStream) stopTracks(acquired);
    if (connected && connected !== liveSession) { try { connected.close(); } catch { /* Best effort. */ } }
  }
}

export function stopLiveStream(): void {
  const wasActive = isLiveStreamActive() || cameraStream !== null;
  cleanupLiveStream();
  if (wasActive) sessionLogger.logSystemEvent('Live camera stream stopped');
}

function cleanupLiveStream(): void {
  ++liveRevision;
  liveStart = null;
  if (frameIntervalId !== null) window.clearInterval(frameIntervalId);
  frameIntervalId = null;
  const session = liveSession;
  liveSession = null; // Invalidate callbacks before close can synchronously invoke one.
  stopTracks(cameraStream);
  cameraStream = null;
  detachVideo(videoEl);
  videoEl = null;
  try { session?.close(); } catch { /* Camera cleanup does not depend on transport close. */ }
}

function nextVideoFrame(): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    let frame = 0;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
      resolve();
    };
    const timer = window.setTimeout(finish, 1000);
    frame = requestAnimationFrame(finish);
  });
}

export function captureFrame(): Promise<string | null> {
  if (capturePending) return capturePending;
  const revision = ++captureRevision;
  const pending = captureOnce(revision);
  capturePending = pending;
  void pending.then(() => { if (capturePending === pending) capturePending = null; },
    () => { if (capturePending === pending) capturePending = null; });
  return pending;
}

async function captureOnce(revision: number): Promise<string | null> {
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  try {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    if (revision !== captureRevision) return null;
    captureStreams.add(stream);
    video = document.createElement('video');
    captureVideos.add(video);
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    if (revision !== captureRevision) return null;
    await nextVideoFrame();
    if (revision !== captureRevision) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] || null;
  } catch {
    return null;
  } finally {
    stopTracks(stream);
    if (stream) captureStreams.delete(stream);
    detachVideo(video);
    if (video) captureVideos.delete(video);
  }
}

window.addEventListener('pagehide', () => {
  stopLiveStream();
  ++captureRevision;
  capturePending = null;
  captureStreams.forEach(stopTracks);
  captureStreams.clear();
  captureVideos.forEach(detachVideo);
  captureVideos.clear();
});

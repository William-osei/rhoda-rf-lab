import { sessionLogger } from './session';
import { RESEARCH_WORKFLOWS } from './researchWorkflows';

export interface WorkflowStep {
  id: number;
  instruction: string;
  detail: string;
  instrumentAction?: { name: string; params: Record<string, unknown> };
  safetyCheck?: string;
}

export interface Workflow {
  id: string;
  title: string;
  description: string;
  category: 'simple' | 'safety-critical';
  steps: WorkflowStep[];
}

const WORKFLOWS: Workflow[] = [
  ...RESEARCH_WORKFLOWS,
  {
    id: 'measure-1khz-sine',
    title: 'Measure a 1 kHz Sine Wave',
    description: 'Step-by-step guide to measure a 1 kHz sine wave on CH1 using an R&S oscilloscope.',
    category: 'simple',
    steps: [
      {
        id: 1,
        instruction: 'Connect the probe to the CH1 BNC input.',
        detail: 'Attach the probe tip to your signal source and clip the ground lead to the circuit ground.',
      },
      {
        id: 2,
        instruction: 'Set probe attenuation to 10X.',
        detail: 'Make sure the physical probe switch matches the oscilloscope channel setting.',
        instrumentAction: { name: 'set_probe_attenuation', params: { channel: 1, attenuation: '10X' } },
      },
      {
        id: 3,
        instruction: 'Enable CH1.',
        detail: 'Press the CH1 button on the front panel or confirm below.',
        instrumentAction: { name: 'set_channel_enabled', params: { channel: 1, enabled: true } },
      },
      {
        id: 4,
        instruction: 'Set vertical scale to 1 V/div.',
        detail: 'This gives a good starting view for a typical 1 kHz test signal.',
        instrumentAction: { name: 'set_vertical_scale', params: { channel: 1, scale_v_div: 1.0 } },
      },
      {
        id: 5,
        instruction: 'Set timebase to 500 µs/div.',
        detail: 'At 500 µs/div, a 1 kHz signal occupies two horizontal divisions per cycle.',
        instrumentAction: { name: 'set_timebase', params: { timebase_s_div: 0.0005 } },
      },
      {
        id: 6,
        instruction: 'Set trigger to CH1, rising edge, auto mode.',
        detail: 'This synchronizes the display so the waveform appears stable.',
        instrumentAction: { name: 'set_trigger', params: { source: 1, slope: 'rising', mode: 'auto' } },
      },
      {
        id: 7,
        instruction: 'Adjust trigger level to the signal midpoint.',
        detail: 'For a centered 2 Vpp sine wave, use 0 V. For other signals use the midpoint between the minimum and maximum voltage.',
        instrumentAction: { name: 'set_trigger', params: { source: 1, level_v: 0.0 } },
      },
      {
        id: 8,
        instruction: 'Verify the waveform is stable on screen.',
        detail: 'You should see a clean sine wave. If it drifts, readjust the trigger level.',
      },
      {
        id: 9,
        instruction: 'Read the measurement values.',
        detail: 'Approve measurement setup to read frequency (expect ~1 kHz).',
        instrumentAction: { name: 'get_measurement', params: {} },
      },
      {
        id: 10,
        instruction: 'Done! Review your results.',
        detail: 'Expected: stable sine wave, frequency ~1000 Hz. Fine-tune vertical scale and timebase as needed.',
      },
    ],
  },
  {
    id: 'safety-overvoltage',
    title: 'Handle an Overvoltage Warning',
    description: 'Safety-critical workflow: what to do when the oscilloscope shows an overload or overvoltage warning.',
    category: 'safety-critical',
    steps: [
      {
        id: 1,
        instruction: 'STOP — Stop work and follow the lab shutdown procedure.',
        detail: 'Do not touch exposed connections. Have the circuit safely de-energized before changing probe connections; consult the supervisor. RTB2 manual version 14, pages 17–19.',
        safetyCheck: 'Overvoltage can damage the instrument and create a safety hazard.',
      },
      {
        id: 2,
        instruction: 'Establish an approved verification method.',
        detail: 'Ask the lab supervisor to review the source, expected energy and an appropriately rated verification method before further contact or measurement.',
        safetyCheck: 'Never assume the voltage is safe — always verify.',
      },
      {
        id: 3,
        instruction: 'Verify the voltage is within safe limits.',
        detail: 'Check the exact oscilloscope, probe and accessory ratings, measurement category and frequency derating in their specifications. Attenuation alone does not establish a safe voltage.',
        safetyCheck: 'Exceeding input limits can permanently damage the input amplifier.',
      },
      {
        id: 4,
        instruction: 'Review the complete probe and input configuration.',
        detail: 'Match the actual probe configuration to its manual and the instrument. Changing an attenuation setting alone does not establish that the setup is safe.',
      },
      {
        id: 5,
        instruction: 'Review display settings only after the setup is approved.',
        detail: 'Display scale does not protect the input from overvoltage. Reconnection requires a supervisor-approved setup within all equipment ratings.',
      },
      {
        id: 6,
        instruction: 'Record the incident and the approved recovery plan.',
        detail: 'Record the warning, setup and actions taken. Resume only through the lab-approved procedure; this checklist does not clear a hardware fault or authorize reconnection.',
      },
    ],
  },
];

let activeWorkflow: Workflow | null = null;
let currentStepIndex = 0;

export function getAvailableWorkflows(): { id: string; title: string; category: string }[] {
  return WORKFLOWS.map(w => ({ id: w.id, title: w.title, category: w.category }));
}

export function startWorkflow(id: string): Workflow | null {
  const wf = WORKFLOWS.find(w => w.id === id);
  if (!wf) return null;
  activeWorkflow = wf;
  currentStepIndex = 0;
  sessionLogger.logSystemEvent(`Workflow started: ${wf.title}`);
  return wf;
}

export function getActiveWorkflow(): Workflow | null {
  return activeWorkflow;
}

export function getCurrentStep(): WorkflowStep | null {
  if (!activeWorkflow) return null;
  return activeWorkflow.steps[currentStepIndex] || null;
}

export function advanceStep(): WorkflowStep | null {
  if (!activeWorkflow) return null;
  if (currentStepIndex < activeWorkflow.steps.length - 1) {
    currentStepIndex++;
    sessionLogger.logSystemEvent(`Workflow step ${currentStepIndex + 1}: ${activeWorkflow.steps[currentStepIndex].instruction}`);
    return activeWorkflow.steps[currentStepIndex];
  }
  sessionLogger.logSystemEvent(`Workflow completed: ${activeWorkflow.title}`);
  activeWorkflow = null;
  currentStepIndex = 0;
  return null;
}

export function getStepIndex(): number {
  return currentStepIndex;
}

export function getTotalSteps(): number {
  return activeWorkflow?.steps.length || 0;
}

export function stopWorkflow(): void {
  if (activeWorkflow) {
    sessionLogger.logSystemEvent(`Workflow stopped: ${activeWorkflow.title}`);
  }
  activeWorkflow = null;
  currentStepIndex = 0;
}

export function getWorkflowContext(): string | null {
  if (!activeWorkflow) return null;
  const step = getCurrentStep();
  if (!step) return null;
  return `[ACTIVE WORKFLOW: "${activeWorkflow.title}"]\nThe student is on step ${step.id} of ${activeWorkflow.steps.length}.\nCurrent step: ${step.instruction}\nDetail: ${step.detail}${step.safetyCheck ? '\nSAFETY: ' + step.safetyCheck : ''}\nGuide the student through this specific step. When they complete it, tell them and move to the next step.`;
}

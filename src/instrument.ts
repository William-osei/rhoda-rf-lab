/**
 * Instrument API + Function Calling (Core 3)
 * Flask instrument interface shared with text chat.
 * Mutations require a backend preview token and explicit user approval.
 */

import { readState, getCachedState, hasPending, previewOperations, confirmOperations, cancelOperations, operationsFor } from './instrumentApi';
import { assertControlTopic } from './assistantContext';

export type FunctionCategory = 'READ' | 'WRITE';

export interface InstrumentFunction {
  name: string;
  category: FunctionCategory;
  description: string;
  params: Record<string, { type: string; description: string; enum?: string[] }>;
  requires_confirmation: boolean;
  safety_limits?: Record<string, { min: number; max: number }>;
}

export interface CallFunctionRequest {
  name: string;
  params: Record<string, unknown>;
  confirmed?: boolean;
}

export interface CallFunctionResult {
  status: 'ok' | 'error' | 'confirmation_required';
  result?: unknown;
  error?: string;
  confirmation_prompt?: string;
}

// ── Function catalogue ──

export const INSTRUMENT_FUNCTIONS: InstrumentFunction[] = [
  {
    name: 'get_instrument_state',
    category: 'READ',
    description: 'Read the full current state of the oscilloscope (all channels, timebase, trigger, measurements)',
    params: {},
    requires_confirmation: false,
  },
  {
    name: 'get_channel_state',
    category: 'READ',
    description: 'Read the state of a specific channel',
    params: { channel: { type: 'number', description: 'Channel number (1-4)' } },
    requires_confirmation: false,
  },
  {
    name: 'get_measurement',
    category: 'WRITE',
    description: 'Configure and measure frequency after approval',
    params: {},
    requires_confirmation: true,
  },
  {
    name: 'set_channel_enabled',
    category: 'WRITE',
    description: 'Enable or disable a channel',
    params: {
      channel: { type: 'number', description: 'Channel number (1-4)' },
      enabled: { type: 'boolean', description: 'true to enable, false to disable' },
    },
    requires_confirmation: true,
  },
  {
    name: 'set_channel_coupling',
    category: 'WRITE',
    description: 'Set channel coupling mode',
    params: {
      channel: { type: 'number', description: 'Channel number (1-4)' },
      coupling: { type: 'string', description: 'Coupling mode', enum: ['AC', 'DC'] },
    },
    requires_confirmation: true,
  },
  {
    name: 'set_vertical_scale',
    category: 'WRITE',
    description: 'Set the vertical scale (volts per division) for a channel',
    params: {
      channel: { type: 'number', description: 'Channel number (1-4)' },
      scale_v_div: { type: 'number', description: 'Volts per division' },
    },
    requires_confirmation: true,
    safety_limits: { scale_v_div: { min: 0.001, max: 100 } },
  },
  {
    name: 'set_timebase',
    category: 'WRITE',
    description: 'Set the horizontal timebase (seconds per division)',
    params: {
      timebase_s_div: { type: 'number', description: 'Seconds per division' },
    },
    requires_confirmation: true,
    safety_limits: { timebase_s_div: { min: 0.000000001, max: 50 } },
  },
  {
    name: 'set_trigger',
    category: 'WRITE',
    description: 'Configure trigger settings',
    params: {
      source: { type: 'number', description: 'Trigger source channel (1-4)' },
      level_v: { type: 'number', description: 'Trigger level in volts' },
      slope: { type: 'string', description: 'Trigger slope', enum: ['rising', 'falling'] },
      mode: { type: 'string', description: 'Trigger mode', enum: ['auto', 'normal', 'single'] },
    },
    requires_confirmation: true,
    safety_limits: { level_v: { min: -100, max: 100 } },
  },
  {
    name: 'set_probe_attenuation',
    category: 'WRITE',
    description: 'Set probe attenuation for a channel',
    params: {
      channel: { type: 'number', description: 'Channel number (1-4)' },
      attenuation: { type: 'string', description: 'Probe attenuation', enum: ['1X', '10X'] },
    },
    requires_confirmation: true,
  },

];

// Both XR and text chat use the Flask backend and the same approval protocol.
export function getPendingConfirmation() { return hasPending() ? { pending: true } : null; }
export async function confirmPending(): Promise<CallFunctionResult> {
  try { return { status: 'ok', result: (await confirmOperations()).result }; }
  catch (error) { return { status: 'error', error: (error as Error).message }; }
}
export async function denyPending(): Promise<CallFunctionResult> {
  try { await cancelOperations(); return { status: 'ok', result: 'Action cancelled.' }; }
  catch (error) { return { status: 'error', error: (error as Error).message }; }
}
export async function executeFunction(request: CallFunctionRequest): Promise<CallFunctionResult> {
  try {
    if (request.name === 'get_instrument_state') return { status: 'ok', result: (await readState()).result };
    if (request.name === 'get_channel_state') {
      const data = (await readState()).result;
      const channel = data.channels?.[String(request.params.channel)];
      if (!channel) throw new Error('Invalid channel');
      return { status: 'ok', result: channel };
    }
    // A model-provided confirmed flag never bypasses the user approval step.
    assertControlTopic();
    const preview = await previewOperations(operationsFor(request.name, request.params));
    return { status: 'confirmation_required', confirmation_prompt: preview.summary };
  } catch (error) { return { status: 'error', error: (error as Error).message }; }
}
export function getInstrumentState() { return getCachedState(); }
export function getFunctionDescriptions(): string {
  return INSTRUMENT_FUNCTIONS.map(f => `- ${f.name} [${f.category}]: ${f.description}`).join('\n');
}

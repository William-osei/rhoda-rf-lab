import { MAX_FREQUENCY_HZ, MIN_FREQUENCY_HZ, validateSweep, type SweepSettings } from './simulation';

/** Range tools prepare a draft. Acquisitions and correction state change only on Run sweep. */
export function rangeFromMarkers(sweep: SweepSettings, firstHz: number, secondHz: number): SweepSettings {
  const next = { ...sweep, startHz: Math.min(firstHz, secondHz), stopHz: Math.max(firstHz, secondHz) };
  const errors = validateSweep(next);
  if (errors.length) throw new RangeError(errors.join(' '));
  return next;
}

/** Preserve the current span, shifting at the instrument boundary instead of silently truncating it. */
export function rangeCenteredOnMarker(sweep: SweepSettings, markerHz: number): SweepSettings {
  if (!Number.isFinite(markerHz) || markerHz < MIN_FREQUENCY_HZ || markerHz > MAX_FREQUENCY_HZ)
    throw new RangeError('Choose a marker inside 1 MHz–6 GHz.');
  const span = sweep.stopHz - sweep.startHz;
  const startHz = Math.max(MIN_FREQUENCY_HZ, Math.min(MAX_FREQUENCY_HZ - span, markerHz - span / 2));
  const next = { ...sweep, startHz, stopHz: startHz + span };
  const errors = validateSweep(next);
  if (errors.length) throw new RangeError(errors.join(' '));
  return next;
}

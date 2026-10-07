import { ForgeBridgeError, ForgeBridgeProcessError } from '../forge/forge-bridge-client.js';
import type { PlaytestFailure } from '../../../shared/playtest-failure.mjs';

export const diagnosticText = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 2000);
export function describePlaytestFailure(error: unknown, seed: number): PlaytestFailure {
  // The runner wraps game errors; a failed cancellation is secondary to the original fault.
  const seen = new Set<unknown>(); let current = error;
  for (let i = 0; i < 8 && current instanceof Error && !seen.has(current); i++) {
    seen.add(current);
    if (current instanceof ForgeBridgeError || current instanceof ForgeBridgeProcessError) { error = current; break; }
    current = current instanceof AggregateError ? current.errors[0] : current.cause;
  }
  const details: string[] = [];
  if (error instanceof ForgeBridgeError) {
    if (typeof error.details === 'string') details.push(diagnosticText(error.details));
    else if (error.details && typeof error.details === 'object') {
      const d = error.details as Record<string, unknown>;
      for (const k of ['exception', 'message', 'first', 'second', 'cards']) {
        const value = d[k];
        if (typeof value === 'string') details.push(`${k}: ${diagnosticText(value)}`);
        else if (k === 'cards' && Array.isArray(value)) details.push(`cards: ${value.filter(v => typeof v === 'string').slice(0, 20).map(v => diagnosticText(v).slice(0, 200)).join(', ')}`);
      }
    }
  }
  return { code: error instanceof ForgeBridgeError ? diagnosticText(error.code) : error instanceof ForgeBridgeProcessError ? 'FORGE_PROCESS_ERROR' : 'PLAYTEST_EXECUTION_ERROR',
    message: diagnosticText(error instanceof Error ? error.message : String(error)), details, seed, capturedAt: new Date().toISOString(),
    ...(error instanceof ForgeBridgeError && error.requestType ? { requestType: error.requestType } : {}) };
}

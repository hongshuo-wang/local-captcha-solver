import { describe, expect, it } from 'vitest';

import type { ModelStatusSnapshot } from '../../src/background/model-status';
import { warmupDuration } from './recognition-support';

function snapshot(logs: ModelStatusSnapshot['logs']): ModelStatusSnapshot {
  return { status: 'ready', progress: 100, message: 'ready', logs };
}

describe('warmupDuration', () => {
  it('measures model warmup without including browser process startup', () => {
    expect(warmupDuration(snapshot([
      { at: 10_000, kind: 'warmup', outcome: 'started', message: 'started' },
      { at: 10_142, kind: 'warmup', outcome: 'success', message: 'ready' },
    ]))).toBe(142);
  });

  it('rejects incomplete warmup telemetry', () => {
    expect(() => warmupDuration(snapshot([]))).toThrow('Model warmup timing is unavailable');
  });
});

import type { ModelStatusSnapshot } from '../../src/background/model-status';

export function warmupDuration(snapshot: ModelStatusSnapshot): number {
  const started = snapshot.logs.find((log) => log.kind === 'warmup' && log.outcome === 'started');
  const succeeded = snapshot.logs.find((log) => log.kind === 'warmup' && log.outcome === 'success');
  if (started === undefined || succeeded === undefined || succeeded.at < started.at) {
    throw new Error('Model warmup timing is unavailable');
  }
  return succeeded.at - started.at;
}

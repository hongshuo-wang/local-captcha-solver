import { canAutoFill, type ConfidenceCandidate } from '../core/confidence-policy';
import { AUTOMATIC_CANDIDATE_THRESHOLD, scoreCaptchaCandidate } from '../core/candidate-scorer';
import { matchCaptchaField } from '../core/field-matcher';
import { resultInterpreter } from '../core/result-interpreter';
import type { OcrResult, RecognitionMode, WorkflowResult } from '../core/types';
import { fillEmptyField } from './field-fill';
import type { ImageAcquisitionResult } from './image-source';
import { snapshotForImage, type ImageDetailSnapshot } from './dom-snapshot';

export type WorkflowTrigger = 'automatic' | 'explicit' | 'context';
export interface CaptchaWorkflow { run(image: HTMLImageElement, trigger: WorkflowTrigger): Promise<WorkflowResult>; cancel?(image: HTMLImageElement): void; cancelAll?(): void; invalidate?(image: HTMLImageElement): void; }
export interface CaptchaWorkflowOptions { snapshot?: (image: HTMLImageElement) => ImageDetailSnapshot | undefined; acquire: (image: HTMLImageElement) => Promise<ImageAcquisitionResult>; recognize: (dataUrl: string, revision: string, modes: readonly RecognitionMode[]) => Promise<readonly OcrResult[]>; }
interface RequestRecord { revision: string; priority: number; token: number; promise: Promise<WorkflowResult>; generation: number; settled: boolean; }
const MODES: readonly RecognitionMode[] = ['digits', 'letters', 'alphanumeric', 'arithmetic'];
const priority = (trigger: WorkflowTrigger): number => trigger === 'automatic' ? 0 : 1;
function errorResult(candidateId: string, error: unknown): WorkflowResult { const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined; return code === 'model_unavailable' ? { state: 'model_unavailable', candidateId } : { state: 'recognition_failed', candidateId }; }
function choose(results: readonly OcrResult[]): { candidate: Exclude<ConfidenceCandidate, { kind: 'invalid' }>; safe: boolean } | undefined { const valid = resultInterpreter.interpret(results).map((result, index) => result.kind === 'invalid' ? result : { ...result, mode: results[index]!.mode }).filter((result): result is Exclude<ConfidenceCandidate, { kind: 'invalid' }> => result.kind !== 'invalid'); const values = new Map<string, Exclude<ConfidenceCandidate, { kind: 'invalid' }>>(); for (const result of valid) { const old = values.get(result.fillValue); if (!old || result.confidence > old.confidence) values.set(result.fillValue, result); } const ranked = [...values.values()].sort((left, right) => right.confidence - left.confidence); const winner = ranked[0]; if (winner === undefined) return undefined; return { candidate: winner, safe: canAutoFill(winner) && (!ranked[1] || winner.confidence - ranked[1].confidence + 1e-12 >= .1) }; }
export function createCaptchaWorkflow(options: CaptchaWorkflowOptions): CaptchaWorkflow {
  const snapshot = options.snapshot ?? snapshotForImage; const records = new WeakMap<HTMLImageElement, RequestRecord>(); let generation = 0; let sequence = 0;
  const stale = (candidateId: string): WorkflowResult => ({ state: 'stale', candidateId });
  const valid = (image: HTMLImageElement, record: RequestRecord) => records.get(image) === record && generation === record.generation;
  async function execute(image: HTMLImageElement, first: ImageDetailSnapshot, record: RequestRecord, trigger: WorkflowTrigger): Promise<WorkflowResult> {
    const candidateId = first.candidate.id;
    let acquired: ImageAcquisitionResult; try { acquired = await options.acquire(image); } catch { return { state: 'image_unavailable', candidateId }; }
    if (!valid(image, record)) return stale(candidateId);
    if (acquired.state !== 'ready') return acquired.reason === 'permission' ? { state: 'permission_denied', candidateId } : { state: 'image_unavailable', candidateId };
    let results: readonly OcrResult[]; try { results = await options.recognize(acquired.dataUrl, acquired.revision, MODES); } catch (error) { return errorResult(candidateId, error); }
    const current = snapshot(image); if (!valid(image, record) || current === undefined || current.candidate.revision !== first.candidate.revision) return stale(candidateId);
    const chosen = choose(results); if (!chosen) return { state: 'needs_confirmation', candidateId, displayText: '', fieldIds: current.fields.map((field) => field.id) }; const selected = chosen.candidate;
    const match = matchCaptchaField(image, current.fields.map((field) => field.field));
    if (match.state === 'none') return { state: 'no_field', candidateId, displayText: selected.displayText, fillValue: selected.fillValue };
    if (!chosen.safe) return { state: 'needs_confirmation', candidateId, displayText: selected.displayText, fillValue: selected.fillValue, fieldIds: match.state === 'unique' ? [match.winner.id] : match.candidates.map((item) => item.field.id) };
    if (match.state !== 'unique' && trigger !== 'automatic' && document.activeElement instanceof HTMLInputElement) {
      const focused = document.activeElement;
      const focusedId = current.fields.find((field) => field.element === focused)?.id ?? 'focused-field';
      const focusedFill = fillEmptyField(focused, selected.fillValue);
      if (focusedFill.state === 'filled') return { state: 'filled', candidateId, fieldId: focusedId, displayText: selected.displayText, fillValue: selected.fillValue };
    }
    if (match.state === 'ambiguous') return { state: 'needs_confirmation', candidateId, displayText: selected.displayText, fillValue: selected.fillValue, fieldIds: match.candidates.map((item) => item.field.id) };
    const target = current.fields.find((field) => field.id === match.winner.id); if (!target || !valid(image, record)) return stale(candidateId);
    const fill = fillEmptyField(target.element, selected.fillValue);
    return fill.state === 'filled' ? { state: 'filled', candidateId, fieldId: target.id, displayText: selected.displayText, fillValue: selected.fillValue } : fill.state === 'stale' ? stale(candidateId) : { state: 'no_field', candidateId, displayText: selected.displayText, fillValue: selected.fillValue };
  }
  return { cancel(image) { const record = records.get(image); if (record) records.delete(image); }, invalidate(image) { records.delete(image); }, cancelAll() { generation += 1; }, run(image, trigger) { const first = snapshot(image); if (!first || (trigger === 'automatic' && scoreCaptchaCandidate(first.candidate.candidate).score < AUTOMATIC_CANDIDATE_THRESHOLD)) return Promise.resolve({ state: 'no_candidate' }); const current = records.get(image); const requestPriority = priority(trigger); if (current && !current.settled && current.generation === generation && current.revision === first.candidate.revision && current.priority >= requestPriority) return current.promise; const record = { revision: first.candidate.revision, priority: requestPriority, token: ++sequence, generation, settled: false, promise: Promise.resolve<WorkflowResult>({ state: 'stale', candidateId: first.candidate.id }) }; record.promise = execute(image, first, record, trigger); record.promise.then(() => { record.settled = true; }, () => { record.settled = true; }); records.set(image, record); return record.promise; } };
}

import { canAutoFill, type ConfidenceCandidate } from '../core/confidence-policy';
import { AUTOMATIC_CANDIDATE_THRESHOLD, scoreCaptchaCandidate } from '../core/candidate-scorer';
import { matchCaptchaField } from '../core/field-matcher';
import { resultInterpreter } from '../core/result-interpreter';
import type { OcrResult, RecognitionMode, WorkflowResult } from '../core/types';
import { fillEmptyField, fillPlaceholderField } from './field-fill';
import type { ImageAcquisitionResult } from './image-source';
import { snapshotForImage, type ImageDetailSnapshot } from './dom-snapshot';

export type WorkflowTrigger = 'automatic' | 'explicit' | 'context';
export interface CaptchaWorkflow { run(image: HTMLImageElement, trigger: WorkflowTrigger): Promise<WorkflowResult>; cancel?(image: HTMLImageElement): void; cancelAll?(): void; invalidate?(image: HTMLImageElement): void; }
export interface CaptchaWorkflowOptions { snapshot?: (image: HTMLImageElement) => ImageDetailSnapshot | undefined; acquire: (image: HTMLImageElement) => Promise<ImageAcquisitionResult>; recognize: (dataUrl: string, revision: string, modes: readonly RecognitionMode[]) => Promise<readonly OcrResult[]>; recognitionModes?: () => readonly RecognitionMode[]; autoFillEnabled?: () => boolean; }
interface RequestRecord { revision: string; priority: number; token: number; promise: Promise<WorkflowResult>; generation: number; settled: boolean; }
const MODES: readonly RecognitionMode[] = ['digits', 'letters', 'alphanumeric', 'arithmetic'];
const ARITHMETIC_CONFIDENCE_DEFICIT = 0.1;
const CONFIDENCE_EPSILON = 1e-12;
type SelectableCandidate = Exclude<ConfidenceCandidate, { kind: 'invalid' }> & {
  requiresConfirmation: boolean;
};
const priority = (trigger: WorkflowTrigger): number => trigger === 'automatic' ? 0 : 1;
function errorResult(candidateId: string, error: unknown): WorkflowResult { const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined; return code === 'model_unavailable' ? { state: 'model_unavailable', candidateId } : { state: 'recognition_failed', candidateId }; }
function choose(results: readonly OcrResult[]): { candidate: Exclude<ConfidenceCandidate, { kind: 'invalid' }>; safe: boolean } | undefined {
  const interpreted = resultInterpreter.interpret(results);
  const valid: SelectableCandidate[] = [];
  for (let index = 0; index < interpreted.length; index += 1) {
    const candidate = interpreted[index];
    if (candidate.kind === 'invalid') continue;
    valid.push({
      ...candidate,
      mode: results[index]!.mode,
      requiresConfirmation: results[index]!.requiresConfirmation === true,
    });
  }
  const values = new Map<string, SelectableCandidate>();
  for (const result of valid) {
    const old = values.get(result.fillValue);
    if (!old || result.confidence > old.confidence) values.set(result.fillValue, result);
  }

  const ranked = [...values.values()].sort((left, right) => right.confidence - left.confidence);
  const bestPlain = valid
    .filter((candidate) => candidate.kind === 'plain')
    .sort((left, right) => right.confidence - left.confidence)[0];
  const bestArithmetic = valid
    .filter((candidate) => candidate.kind === 'arithmetic')
    .sort((left, right) => right.confidence - left.confidence)[0];
  const preferArithmetic = bestArithmetic !== undefined && (
    bestPlain === undefined ||
    bestPlain.confidence - bestArithmetic.confidence <=
      ARITHMETIC_CONFIDENCE_DEFICIT + CONFIDENCE_EPSILON
  );
  const winner = preferArithmetic ? bestArithmetic : ranked[0];
  if (winner === undefined) return undefined;

  const safe = winner.kind === 'arithmetic'
    ? !winner.requiresConfirmation && canAutoFill(winner) && preferArithmetic
    : !winner.requiresConfirmation && canAutoFill(winner) && (
        !ranked[1] ||
        winner.confidence - ranked[1].confidence + CONFIDENCE_EPSILON >=
          ARITHMETIC_CONFIDENCE_DEFICIT
      );
  return { candidate: winner, safe };
}
export function createCaptchaWorkflow(options: CaptchaWorkflowOptions): CaptchaWorkflow {
  const snapshot = options.snapshot ?? snapshotForImage; const records = new WeakMap<HTMLImageElement, RequestRecord>(); let generation = 0; let sequence = 0;
  const stale = (candidateId: string): WorkflowResult => ({ state: 'stale', candidateId });
  const valid = (image: HTMLImageElement, record: RequestRecord) => records.get(image) === record && generation === record.generation;
  async function execute(image: HTMLImageElement, first: ImageDetailSnapshot, record: RequestRecord, trigger: WorkflowTrigger): Promise<WorkflowResult> {
    const candidateId = first.candidate.id;
    let acquired: ImageAcquisitionResult; try { acquired = await options.acquire(image); } catch { return { state: 'image_unavailable', candidateId }; }
    if (!valid(image, record)) return stale(candidateId);
    if (acquired.state !== 'ready') return acquired.reason === 'permission' ? { state: 'permission_denied', candidateId } : { state: 'image_unavailable', candidateId };
    let results: readonly OcrResult[]; try { results = await options.recognize(acquired.dataUrl, acquired.revision, options.recognitionModes?.() ?? MODES); } catch (error) { return errorResult(candidateId, error); }
    const current = snapshot(image); if (!valid(image, record) || current === undefined || current.candidate.revision !== first.candidate.revision) return stale(candidateId);
    const chosen = choose(results); if (!chosen) return { state: 'needs_confirmation', candidateId, displayText: '', fieldIds: current.fields.map((field) => field.id), reason: 'unusable_result' }; const selected = chosen.candidate;
    const match = matchCaptchaField(image, current.fields.map((field) => field.field));
    if (match.state === 'none') return { state: 'no_field', candidateId, displayText: selected.displayText, fillValue: selected.fillValue, confidence: selected.confidence };
    if (!chosen.safe) return { state: 'needs_confirmation', candidateId, displayText: selected.displayText, fillValue: selected.fillValue, confidence: selected.confidence, fieldIds: match.state === 'unique' ? [match.winner.id] : match.candidates.map((item) => item.field.id), reason: 'low_confidence' };
    if (options.autoFillEnabled?.() === false) return { state: 'needs_confirmation', candidateId, displayText: selected.displayText, fillValue: selected.fillValue, confidence: selected.confidence, fieldIds: match.state === 'unique' ? [match.winner.id] : match.candidates.map((item) => item.field.id), reason: 'auto_fill_disabled' };
    if (match.state !== 'unique' && trigger !== 'automatic' && (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) {
      const focused = document.activeElement;
      const focusedId = current.fields.find((field) => field.element === focused)?.id ?? 'focused-field';
      const focusedFill = fillEmptyField(focused, selected.fillValue);
      if (focusedFill.state === 'filled') return { state: 'filled', candidateId, fieldId: focusedId, displayText: selected.displayText, fillValue: selected.fillValue, confidence: selected.confidence };
    }
    if (match.state === 'ambiguous') return { state: 'needs_confirmation', candidateId, displayText: selected.displayText, fillValue: selected.fillValue, confidence: selected.confidence, fieldIds: match.candidates.map((item) => item.field.id), reason: 'ambiguous_field' };
    const target = current.fields.find((field) => field.id === match.winner.id); if (!target || !valid(image, record)) return stale(candidateId);
    const placeholderValue = target.field.placeholderValue;
    if (target.element.value !== '' && target.element.value !== placeholderValue) return { state: 'needs_confirmation', candidateId, displayText: selected.displayText, fillValue: selected.fillValue, confidence: selected.confidence, fieldIds: [target.id], reason: 'field_not_empty' };
    const fill = target.element.value === ''
      ? fillEmptyField(target.element, selected.fillValue)
      : fillPlaceholderField(target.element, selected.fillValue, placeholderValue!);
    return fill.state === 'filled' ? { state: 'filled', candidateId, fieldId: target.id, displayText: selected.displayText, fillValue: selected.fillValue, confidence: selected.confidence } : fill.state === 'stale' ? stale(candidateId) : fill.state === 'not_empty' ? { state: 'needs_confirmation', candidateId, displayText: selected.displayText, fillValue: selected.fillValue, confidence: selected.confidence, fieldIds: [target.id], reason: 'field_not_empty' } : { state: 'no_field', candidateId, displayText: selected.displayText, fillValue: selected.fillValue, confidence: selected.confidence };
  }
  return { cancel(image) { const record = records.get(image); if (record) records.delete(image); }, invalidate(image) { records.delete(image); }, cancelAll() { generation += 1; }, run(image, trigger) { const first = snapshot(image); if (!first || (trigger === 'automatic' && scoreCaptchaCandidate(first.candidate.candidate).score < AUTOMATIC_CANDIDATE_THRESHOLD)) return Promise.resolve({ state: 'no_candidate' }); const current = records.get(image); const requestPriority = priority(trigger); if (current && !current.settled && current.generation === generation && current.revision === first.candidate.revision && current.priority >= requestPriority) return current.promise; const record = { revision: first.candidate.revision, priority: requestPriority, token: ++sequence, generation, settled: false, promise: Promise.resolve<WorkflowResult>({ state: 'stale', candidateId: first.candidate.id }) }; record.promise = execute(image, first, record, trigger); record.promise.then(() => { record.settled = true; }, () => { record.settled = true; }); records.set(image, record); return record.promise; } };
}

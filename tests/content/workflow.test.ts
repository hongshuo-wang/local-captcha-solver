import { describe, expect, it, vi } from 'vitest';
import { createCaptchaWorkflow } from '../../src/content/workflow';

const image = document.createElement('img');
const field = document.createElement('input');
document.body.append(image, field);
const base = {
  snapshot: vi.fn(() => ({ candidate: { id: 'image-1', element: image, revision: 'same', candidate: { attrText: 'captcha', nearbyText: '', width: 120, height: 40, inForm: true, nearShortInput: true } }, fields: [{ id: 'field-1', element: field, field: { id: 'field-1', type: 'text', value: '', visible: true, disabled: false, readOnly: false, distance: 10, sameForm: true, labelText: 'captcha' } }] })),
  acquire: vi.fn(async () => ({ state: 'ready' as const, dataUrl: 'data:image/png;base64,AQ==', mimeType: 'image/png', revision: 'bytes' })),
  recognize: vi.fn(async () => [{ mode: 'digits' as const, text: '1234', confidence: .9 }]),
};
function workflow(overrides = {}) { field.value = ''; return createCaptchaWorkflow({ ...base, ...overrides }); }

describe('captcha workflow', () => {
  it('fills a uniquely matched high-confidence result after one all-mode inference', async () => {
    const result = await workflow().run(image, 'automatic');
    expect(result).toMatchObject({ state: 'filled', fieldId: 'field-1', fillValue: '1234' });
    expect(base.recognize).toHaveBeenCalledWith('data:image/png;base64,AQ==', 'bytes', ['digits', 'letters', 'alphanumeric', 'arithmetic']);
  });
  it('rejects automatic candidates below the scorer threshold', async () => {
    const snapshot = vi.fn(() => ({ ...base.snapshot(), candidate: { ...base.snapshot().candidate, candidate: { ...base.snapshot().candidate.candidate, attrText: '', width: 1, height: 1, inForm: false, nearShortInput: false } } }));
    await expect(workflow({ snapshot }).run(image, 'automatic')).resolves.toEqual({ state: 'no_candidate' });
  });
  it('does not fill low confidence or conflicting values', async () => {
    await expect(workflow({ recognize: async () => [{ mode: 'letters', text: 'ABC', confidence: .94 }] }).run(image, 'explicit')).resolves.toMatchObject({ state: 'needs_confirmation' });
    await expect(workflow({ recognize: async () => [{ mode: 'digits', text: '123', confidence: .98 }, { mode: 'letters', text: 'ABC', confidence: .94 }] }).run(image, 'explicit')).resolves.toMatchObject({ state: 'needs_confirmation' });
    expect(field.value).toBe('');
  });
  it('returns no_field and preserves a field made nonempty before fill', async () => {
    await expect(workflow({ snapshot: () => ({ ...base.snapshot(), fields: [] }) }).run(image, 'explicit')).resolves.toMatchObject({ state: 'no_field' });
    await expect(workflow({ recognize: async () => { field.value = 'taken'; return [{ mode: 'digits', text: '1234', confidence: .9 }]; } }).run(image, 'explicit')).resolves.toMatchObject({ state: 'no_field' });
    expect(field.value).toBe('taken');
  });
  it('maps acquisition and inference failures', async () => {
    await expect(workflow({ acquire: async () => ({ state: 'image_unavailable', reason: 'permission' }) }).run(image, 'explicit')).resolves.toMatchObject({ state: 'permission_denied' });
    await expect(workflow({ recognize: async () => { throw Object.assign(new Error(), { code: 'model_unavailable' }); } }).run(image, 'explicit')).resolves.toMatchObject({ state: 'model_unavailable' });
  });
  it('returns stale when the source changes during recognition', async () => {
    let revision = 'first';
    const snapshot = () => ({ ...base.snapshot(), candidate: { ...base.snapshot().candidate, revision } });
    const recognize = async () => { revision = 'second'; return [{ mode: 'digits' as const, text: '1', confidence: .9 }]; };
    await expect(workflow({ snapshot, recognize }).run(image, 'explicit')).resolves.toMatchObject({ state: 'stale' });
  });

  it('deduplicates same-revision automatic work and does not let it supersede explicit work', async () => {
    const localImage = document.createElement('img'); const localField = document.createElement('input'); document.body.append(localImage, localField);
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const acquire = vi.fn(async () => { await gate; return { state: 'ready' as const, dataUrl: 'data:image/png;base64,AQ==', mimeType: 'image/png', revision: 'bytes' }; });
    const snapshot = () => ({ candidate: { id: 'i', element: localImage, revision: 'r', candidate: { attrText: 'captcha', nearbyText: '', width: 120, height: 40, inForm: true, nearShortInput: true } }, fields: [{ id: 'f', element: localField, field: { id: 'f', type: 'text', value: localField.value, visible: true, disabled: false, readOnly: false, distance: 10, sameForm: true, labelText: 'captcha' } }] });
    const instance = createCaptchaWorkflow({ snapshot, acquire, recognize: async () => [{ mode: 'digits' as const, text: '7', confidence: .9 }] });
    const explicit = instance.run(localImage, 'explicit'); const automatic = instance.run(localImage, 'automatic');
    release();
    await expect(explicit).resolves.toMatchObject({ state: 'filled' });
    await expect(automatic).resolves.toMatchObject({ state: 'filled' });
    expect(acquire).toHaveBeenCalledOnce();
  });
  it('lets explicit work supersede an older automatic request', async () => {
    const localImage = document.createElement('img'); const localField = document.createElement('input'); document.body.append(localImage, localField);
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const snapshot = () => ({ candidate: { id: 'i2', element: localImage, revision: 'r', candidate: { attrText: 'captcha', nearbyText: '', width: 120, height: 40, inForm: true, nearShortInput: true } }, fields: [{ id: 'f2', element: localField, field: { id: 'f2', type: 'text', value: localField.value, visible: true, disabled: false, readOnly: false, distance: 10, sameForm: true, labelText: 'captcha' } }] });
    const instance = createCaptchaWorkflow({ snapshot, acquire: async () => { await gate; return { state: 'ready' as const, dataUrl: 'data:image/png;base64,AQ==', mimeType: 'image/png', revision: 'bytes' }; }, recognize: async () => [{ mode: 'digits' as const, text: '8', confidence: .9 }] });
    const automatic = instance.run(localImage, 'automatic'); const explicit = instance.run(localImage, 'explicit'); release();
    await expect(automatic).resolves.toMatchObject({ state: 'stale' }); await expect(explicit).resolves.toMatchObject({ state: 'filled' });
  });
  it('deduplicates equal-priority requests and collapses identical OCR values', async () => {
    const localImage = document.createElement('img'); const localField = document.createElement('input'); document.body.append(localImage, localField);
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); const acquire = vi.fn(async () => { await gate; return { state: 'ready' as const, dataUrl: 'data:image/png;base64,AQ==', mimeType: 'image/png', revision: 'bytes' }; });
    const snapshot = () => ({ candidate: { id: 'i3', element: localImage, revision: 'r', candidate: { attrText: 'captcha', nearbyText: '', width: 120, height: 40, inForm: true, nearShortInput: true } }, fields: [{ id: 'f3', element: localField, field: { id: 'f3', type: 'text', value: localField.value, visible: true, disabled: false, readOnly: false, distance: 10, sameForm: true, labelText: 'captcha' } }] });
    const instance = createCaptchaWorkflow({ snapshot, acquire, recognize: async () => [{ mode: 'digits' as const, text: '19', confidence: .9 }, { mode: 'alphanumeric' as const, text: '19', confidence: .99 }] });
    const first = instance.run(localImage, 'automatic'); const second = instance.run(localImage, 'automatic'); release();
    await expect(first).resolves.toMatchObject({ state: 'filled', fillValue: '19' }); await expect(second).resolves.toMatchObject({ state: 'filled', fillValue: '19' }); expect(acquire).toHaveBeenCalledOnce();
  });
  it('returns confirmation for an ambiguous matched field', async () => {
    const other = document.createElement('input'); document.body.append(other);
    const snapshot = () => ({ ...base.snapshot(), fields: [base.snapshot().fields[0], { id: 'field-2', element: other, field: { id: 'field-2', type: 'text', value: '', visible: true, disabled: false, readOnly: false, distance: 10, sameForm: true, labelText: 'captcha' } }] });
    await expect(workflow({ snapshot }).run(image, 'explicit')).resolves.toMatchObject({ state: 'needs_confirmation', fieldIds: ['field-1', 'field-2'] });
  });
  it('resumes with fresh acquisition after cancelAll invalidates a completed revision', async () => {
    const localImage = document.createElement('img'); const localField = document.createElement('input'); document.body.append(localImage, localField);
    const acquire = vi.fn(async () => ({ state: 'ready' as const, dataUrl: 'data:image/png;base64,AQ==', mimeType: 'image/png', revision: 'bytes' }));
    const snapshot = () => ({ candidate: { id: 'restart', element: localImage, revision: 'same', candidate: { attrText: 'captcha', nearbyText: '', width: 120, height: 40, inForm: true, nearShortInput: true } }, fields: [{ id: 'restart-field', element: localField, field: { id: 'restart-field', type: 'text', value: localField.value, visible: true, disabled: false, readOnly: false, distance: 10, sameForm: true, labelText: 'captcha' } }] });
    const instance = createCaptchaWorkflow({ snapshot, acquire, recognize: async () => [{ mode: 'digits' as const, text: '9', confidence: .9 }] });
    await instance.run(localImage, 'automatic'); localField.value = ''; instance.cancelAll?.();
    await expect(instance.run(localImage, 'automatic')).resolves.toMatchObject({ state: 'filled' }); expect(acquire).toHaveBeenCalledTimes(2);
  });
  it('accepts an exact 0.10 confidence margin', async () => {
    await expect(workflow({ recognize: async () => [{ mode: 'digits', text: '1', confidence: .9 }, { mode: 'letters', text: 'A', confidence: .8 }] }).run(image, 'explicit')).resolves.toMatchObject({ state: 'filled', fillValue: '1' });
  });
});

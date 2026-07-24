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
});

import { describe, expect, it } from 'vitest';
import { snapshotForImage, snapshotImages } from '../../src/content/dom-snapshot';
import { fillEmptyField } from '../../src/content/field-fill';

describe('DOM snapshots', () => {
  it('discovers visible images with stable ids and maps nearby field context', () => {
    document.body.innerHTML = '<form><label for="answer">Verification code</label><img id="captcha" alt="captcha" src="data:image/png;base64,AQ==" width="120" height="40"><input id="answer" name="answer"></form><img hidden src="x">';
    const image = document.querySelector('#captcha') as HTMLImageElement;
    const first = snapshotImages(document);
    const second = snapshotImages(document);
    const detail = snapshotForImage(image, document);

    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(detail).toBeDefined();
    expect(detail?.candidate.candidate).toMatchObject({ attrText: expect.stringContaining('captcha'), inForm: true, nearShortInput: true, width: 120, height: 40 });
    expect(detail?.fields).toHaveLength(1);
    expect(detail?.fields[0]?.field).toMatchObject({ type: 'text', sameForm: true, labelText: expect.stringContaining('Verification'), value: '' });
  });

  it('excludes hidden images and ineligible fields', () => {
    document.body.innerHTML = '<img id="image" src="x"><input type="password"><input hidden><input disabled><input id="ok">';
    const image = document.querySelector('#image') as HTMLImageElement;
    expect(snapshotForImage(image, document)?.fields.map(({ element }) => element.id)).toEqual(['ok']);
  });
  it('does not snapshot a hidden image as a fallback candidate', () => {
    document.body.innerHTML = '<img id="hidden" hidden src="x">';
    expect(snapshotForImage(document.querySelector('#hidden') as HTMLImageElement, document)).toBeUndefined();
  });

  it('collects visible textarea and semantic context beyond the image form', () => {
    document.body.innerHTML = '<div>验证码</div><img id="captcha" src="x" width="120" height="40"><textarea id="answer" name="verify_code" placeholder="请输入校验码" aria-label="验证码"></textarea>';
    const image = document.querySelector('#captcha') as HTMLImageElement;
    const detail = snapshotForImage(image, document);

    expect(detail?.fields).toHaveLength(1);
    expect(detail?.fields[0]?.element).toBeInstanceOf(HTMLTextAreaElement);
    expect(detail?.fields[0]?.field).toMatchObject({
      type: 'textarea',
      sameForm: false,
      labelText: expect.stringContaining('请输入校验码'),
    });
    expect(detail?.candidate.candidate.nearShortInput).toBe(true);
  });

  it('keeps visible editable text controls, including non-empty replacement candidates', () => {
    document.body.innerHTML = '<img id="captcha" src="x"><input id="filled" value="x"><input id="readonly" readonly><input id="disabled" disabled><input id="password" type="password"><textarea id="hidden" hidden></textarea><textarea id="ok"></textarea>';
    const image = document.querySelector('#captcha') as HTMLImageElement;

    expect(snapshotForImage(image, document)?.fields.map(({ element }) => element.id)).toEqual(['filled', 'ok']);
  });

  it('keeps both extension-filled and user-edited fields available only as replacement candidates', () => {
    document.body.innerHTML = '<form><img id="captcha" alt="captcha" src="x" width="120" height="40"><input id="answer" aria-label="验证码"></form>';
    const image = document.querySelector('#captcha') as HTMLImageElement;
    const field = document.querySelector('#answer') as HTMLInputElement;

    expect(fillEmptyField(field, '1234')).toEqual({ state: 'filled' });
    expect(snapshotForImage(image, document)?.fields[0]?.field).toMatchObject({ value: '1234', replaceable: true });

    field.value = 'user edited';
    expect(snapshotForImage(image, document)?.fields[0]?.field).toMatchObject({ value: 'user edited', replaceable: true });
  });
});

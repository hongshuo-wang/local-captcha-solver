import { describe, expect, it } from 'vitest';
import { snapshotForImage, snapshotImages } from '../../src/content/dom-snapshot';

describe('DOM snapshots', () => {
  it('discovers visible images with stable ids and maps nearby field context', () => {
    document.body.innerHTML = '<form><label for="answer">Verification code</label><img id="captcha" alt="captcha" src="data:image/png;base64,AQ==" width="120" height="40"><input id="answer" name="answer"></form><img hidden src="x">';
    const image = document.querySelector('#captcha') as HTMLImageElement;
    const first = snapshotImages(document);
    const second = snapshotImages(document);
    const detail = snapshotForImage(image, document);

    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(detail.candidate.candidate).toMatchObject({ attrText: expect.stringContaining('captcha'), inForm: true, nearShortInput: true, width: 120, height: 40 });
    expect(detail.fields).toHaveLength(1);
    expect(detail.fields[0]?.field).toMatchObject({ type: 'text', sameForm: true, labelText: expect.stringContaining('Verification'), value: '' });
  });

  it('excludes hidden images and ineligible fields', () => {
    document.body.innerHTML = '<img id="image" src="x"><input type="password"><input hidden><input disabled><input id="ok">';
    const image = document.querySelector('#image') as HTMLImageElement;
    expect(snapshotForImage(image, document).fields.map(({ element }) => element.id)).toEqual(['ok']);
  });
});

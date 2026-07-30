import { describe, expect, it } from 'vitest';

import {
  CAPTCHA_VISIBLE_CHARACTERS,
  auditCaptchaCharset,
  decodePpOcrV6Ctc,
  parsePpOcrV6Config,
  preprocessRgbaForPpOcrV6,
} from '../../benchmark/ppocrv6-adapter';

const CONFIG = `
Global:
  model_name: PP-OCRv6_tiny_rec
PreProcess:
  transform_ops:
    - DecodeImage:
        img_mode: BGR
    - RecResizeImg:
        image_shape: [3, 48, 320]
PostProcess:
  name: CTCLabelDecode
  character_dict:
    - '*'
    - +
    - '-'
    - /
    - '='
    - '?'
    - X
    - x
    - ×
    - ÷
    - '0'
    - A
    - a
`;

describe('PP-OCRv6 recognition-only adapter', () => {
  it('parses official inference YAML and constructs the blank-prefixed CTC charset', () => {
    const config = parsePpOcrV6Config(CONFIG);
    expect(config.modelName).toBe('PP-OCRv6_tiny_rec');
    expect(config.imageShape).toEqual([3, 48, 320]);
    expect(config.charset).toEqual(['', '*', '+', '-', '/', '=', '?', 'X', 'x', '×', '÷', '0', 'A', 'a', ' ']);
  });

  it('audits all 70 visible CAPTCHA characters without treating blank as visible', () => {
    expect(CAPTCHA_VISIBLE_CHARACTERS).toHaveLength(70);
    expect(new Set(CAPTCHA_VISIBLE_CHARACTERS).size).toBe(70);
    const complete = auditCaptchaCharset(['', ...CAPTCHA_VISIBLE_CHARACTERS, ' ']);
    expect(complete).toEqual({ supported: true, missing: [] });
    const withoutDivision = auditCaptchaCharset(['', ...CAPTCHA_VISIBLE_CHARACTERS.filter((value) => value !== '÷')]);
    expect(withoutDivision).toEqual({ supported: false, missing: ['÷'] });
  });

  it('uses BGR [-1,1] normalization and zero right padding at the official width', () => {
    const result = preprocessRgbaForPpOcrV6(
      new Uint8ClampedArray([255, 128, 0, 255]),
      1,
      1,
      [3, 48, 320],
    );
    expect(result.dims).toEqual([1, 3, 48, 320]);
    expect(result.resizedWidth).toBe(48);
    const plane = 48 * 320;
    expect(result.data[0]).toBeCloseTo(-1, 6);
    expect(result.data[plane]).toBeCloseTo(128 / 127.5 - 1, 6);
    expect(result.data[plane * 2]).toBeCloseTo(1, 6);
    expect(result.data[48]).toBe(0);
    expect(result.data[plane + 48]).toBe(0);
    expect(result.data[plane * 2 + 48]).toBe(0);
  });

  it('decodes CTC blank and duplicate runs using official class probabilities', () => {
    const probabilities = new Float32Array([
      0.05, 0.90, 0.03, 0.02,
      0.01, 0.95, 0.02, 0.02,
      0.90, 0.05, 0.03, 0.02,
      0.05, 0.80, 0.10, 0.05,
      0.05, 0.10, 0.70, 0.15,
    ]);
    expect(decodePpOcrV6Ctc(probabilities, [1, 5, 4], ['', 'A', 'B', ' '])).toEqual({
      text: 'AAB',
      confidence: expect.closeTo((0.9 + 0.8 + 0.7) / 3, 6),
    });
  });

  it('rejects a class dimension that does not match the parsed charset', () => {
    expect(() => decodePpOcrV6Ctc(new Float32Array(6), [1, 2, 3], ['', 'A'])).toThrow(/class/i);
  });
});

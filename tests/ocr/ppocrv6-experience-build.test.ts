import { describe, expect, it } from 'vitest';

import {
  createPpOcrV6RuntimeConfig,
  ppocrv6SmallOutputDirectory,
} from '../../scripts/build-ppocrv6-small';

describe('PP-OCRv6 small experience build assets', () => {
  it('uses WXT mode-specific output instead of contaminating the normal build', () => {
    expect(ppocrv6SmallOutputDirectory('/project')).toBe(
      '/project/.output/chrome-mv3-ppocrv6-small',
    );
  });

  it('derives the browser config from the pinned official inference YAML', () => {
    const runtime = createPpOcrV6RuntimeConfig(`
Global:
  model_name: PP-OCRv6_small_rec
PreProcess:
  transform_ops:
    - RecResizeImg:
        image_shape: [3, 48, 320]
PostProcess:
  name: CTCLabelDecode
  character_dict: ['*', '7', 'A']
`);

    expect(runtime).toEqual({
      schemaVersion: 1,
      modelName: 'PP-OCRv6_small_rec',
      imageShape: [3, 48, 320],
      charset: ['', '*', '7', 'A', ' '],
    });
  });

  it('rejects configs that are not the pinned small CTC model', () => {
    expect(() => createPpOcrV6RuntimeConfig(`
Global: { model_name: PP-OCRv6_tiny_rec }
PreProcess: { transform_ops: [{ RecResizeImg: { image_shape: [3, 48, 320] } }] }
PostProcess: { name: CTCLabelDecode, character_dict: ['7'] }
`)).toThrow(/small/i);
  });
});

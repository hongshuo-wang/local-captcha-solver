import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateTrainingContract } from '../../training/ppocrv6-captcha/contract';

const ROOT = process.cwd();

describe('PP-OCRv6 CAPTCHA training contract', () => {
  it('defines exactly 70 visible classes plus the implicit CTC blank', async () => {
    const charsetText = await readFile(path.join(ROOT, 'training/ppocrv6-captcha/charset.txt'), 'utf8');
    const configText = await readFile(path.join(ROOT, 'training/ppocrv6-captcha/config.yml'), 'utf8');
    const contract = validateTrainingContract(configText, charsetText);

    expect(contract.visibleCharacters).toHaveLength(70);
    expect(new Set(contract.visibleCharacters).size).toBe(70);
    expect(contract.visibleCharacters.join('')).toBe(
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-*/×÷=?',
    );
    expect(contract.ctcClassCount).toBe(71);
  });

  it('preserves the official tiny MultiHead recipe with no extra space class', async () => {
    const charsetText = await readFile(path.join(ROOT, 'training/ppocrv6-captcha/charset.txt'), 'utf8');
    const configText = await readFile(path.join(ROOT, 'training/ppocrv6-captcha/config.yml'), 'utf8');
    const contract = validateTrainingContract(configText, charsetText);

    expect(contract).toMatchObject({
      modelName: 'PP-OCRv6_tiny_rec_captcha_71',
      backboneName: 'PPLCNetV4',
      backboneSize: 'tiny',
      headName: 'MultiHead',
      useSpaceCharacter: false,
      maxTextLength: 12,
      seed: 20260728,
      trainLabels: ['training/ppocrv6-captcha/data/train-balanced.txt'],
      validationLabels: ['training/ppocrv6-captcha/data/validation.txt'],
    });
  });

  it('rejects duplicate, blank, space, and config-enabled extra characters', () => {
    const validCharset = Array.from(new Set(
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-*/xX×÷=?',
    )).join('\n');
    const validConfig = `
Global:
  model_name: PP-OCRv6_tiny_rec_captcha_71
  character_dict_path: training/ppocrv6-captcha/charset.txt
  use_space_char: false
  max_text_length: 12
  seed: 20260728
Architecture:
  Backbone: {name: PPLCNetV4, model_size: tiny}
  Head: {name: MultiHead}
Train: {dataset: {label_file_list: [training/ppocrv6-captcha/data/train-balanced.txt]}}
Eval: {dataset: {label_file_list: [training/ppocrv6-captcha/data/validation.txt]}}
`;
    expect(() => validateTrainingContract(validConfig, '0\n0\n')).toThrow(/duplicate/i);
    expect(() => validateTrainingContract(validConfig, '0\n \n')).toThrow(/space|blank/i);
    expect(() => validateTrainingContract(
      validConfig.replace('use_space_char: false', 'use_space_char: true'),
      `${validCharset}\n`,
    )).toThrow(/space/i);
  });
});

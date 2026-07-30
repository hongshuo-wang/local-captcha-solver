import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildTrainingCommands } from '../../training/ppocrv6-captcha/commands';

describe('PP-OCRv6 two-stage training command contract', () => {
  it('renders a three-epoch head warmup and sixty-epoch full fine-tune without executing them', () => {
    const commands = buildTrainingCommands({
      projectRoot: '/project',
      paddleOcrRoot: '/opt/PaddleOCR',
      cudaVisibleDevices: '0',
    });
    expect(commands.warmup).toEqual({
      cwd: '/project',
      env: { PADDLEOCR_ROOT: '/opt/PaddleOCR', CUDA_VISIBLE_DEVICES: '0' },
      argv: [
        'python3',
        'training/ppocrv6-captcha/train_head_warmup.py',
        '-c',
        'training/ppocrv6-captcha/config.yml',
        '-o',
        'Global.epoch_num=3',
        'Global.save_model_dir=./training/ppocrv6-captcha/output/warmup',
      ],
    });
    expect(commands.finetune.argv).toEqual([
      'python3',
      '/opt/PaddleOCR/tools/train.py',
      '-c',
      'training/ppocrv6-captcha/config.yml',
      '-o',
      'Global.epoch_num=60',
      'Global.pretrained_model=./training/ppocrv6-captcha/output/warmup/latest.pdparams',
      'Global.save_model_dir=./training/ppocrv6-captcha/output/full',
    ]);
    expect(commands.evaluate.argv).toEqual([
      'python3',
      '/opt/PaddleOCR/tools/eval.py',
      '-c',
      'training/ppocrv6-captcha/config.yml',
      '-o',
      'Global.checkpoints=./training/ppocrv6-captcha/output/full/best_accuracy.pdparams',
    ]);
    expect(commands.exportPaddle.argv).toEqual([
      'python3',
      '/opt/PaddleOCR/tools/export_model.py',
      '-c',
      'training/ppocrv6-captcha/config.yml',
      '-o',
      'Global.pretrained_model=./training/ppocrv6-captcha/output/full/best_accuracy.pdparams',
      'Global.save_inference_dir=./training/ppocrv6-captcha/output/exported',
    ]);
  });

  it('requires an explicit CUDA device and absolute PaddleOCR checkout', () => {
    expect(() => buildTrainingCommands({ projectRoot: '/project', paddleOcrRoot: 'relative', cudaVisibleDevices: '0' })).toThrow(/absolute/i);
    expect(() => buildTrainingCommands({ projectRoot: '/project', paddleOcrRoot: '/opt/PaddleOCR', cudaVisibleDevices: '' })).toThrow(/CUDA/i);
  });

  it('freezes only the official backbone and asserts the head remains trainable', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'training/ppocrv6-captcha/train_head_warmup.py'),
      'utf8',
    );
    expect(source).toContain('for parameter in model.backbone.parameters():');
    expect(source).toContain('parameter.stop_gradient = True');
    expect(source).toContain('for parameter in model.head.parameters()');
    expect(source).toContain('No trainable head parameters');
    expect(source).toContain('paddle_train.build_model = build_model_with_frozen_backbone');
    expect(source).toContain("if __name__ == '__main__':");
    expect(source).toContain('main()');
  });
});

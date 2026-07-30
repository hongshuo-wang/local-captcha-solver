import path from 'node:path';

export interface TrainingCommand {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly argv: readonly string[];
}

export interface TrainingCommandSet {
  readonly warmup: TrainingCommand;
  readonly finetune: TrainingCommand;
  readonly evaluate: TrainingCommand;
  readonly exportPaddle: TrainingCommand;
}

export function buildTrainingCommands(options: {
  readonly projectRoot: string;
  readonly paddleOcrRoot: string;
  readonly cudaVisibleDevices: string;
}): TrainingCommandSet {
  if (!path.isAbsolute(options.projectRoot) || !path.isAbsolute(options.paddleOcrRoot)) {
    throw new TypeError('Project and PaddleOCR roots must be absolute paths');
  }
  if (!/^\d+(?:,\d+)*$/.test(options.cudaVisibleDevices)) {
    throw new TypeError('CUDA_VISIBLE_DEVICES must explicitly list numeric device ids');
  }
  const env = {
    PADDLEOCR_ROOT: options.paddleOcrRoot,
    CUDA_VISIBLE_DEVICES: options.cudaVisibleDevices,
  };
  const common = ['-c', 'training/ppocrv6-captcha/config.yml', '-o'] as const;
  return {
    warmup: {
      cwd: options.projectRoot,
      env,
      argv: [
        'python3',
        'training/ppocrv6-captcha/train_head_warmup.py',
        ...common,
        'Global.epoch_num=3',
        'Global.save_model_dir=./training/ppocrv6-captcha/output/warmup',
      ],
    },
    finetune: {
      cwd: options.projectRoot,
      env,
      argv: [
        'python3',
        path.join(options.paddleOcrRoot, 'tools', 'train.py'),
        ...common,
        'Global.epoch_num=60',
        'Global.pretrained_model=./training/ppocrv6-captcha/output/warmup/latest.pdparams',
        'Global.save_model_dir=./training/ppocrv6-captcha/output/full',
      ],
    },
    evaluate: {
      cwd: options.projectRoot,
      env,
      argv: [
        'python3',
        path.join(options.paddleOcrRoot, 'tools', 'eval.py'),
        ...common,
        'Global.checkpoints=./training/ppocrv6-captcha/output/full/best_accuracy.pdparams',
      ],
    },
    exportPaddle: {
      cwd: options.projectRoot,
      env,
      argv: [
        'python3',
        path.join(options.paddleOcrRoot, 'tools', 'export_model.py'),
        ...common,
        'Global.pretrained_model=./training/ppocrv6-captcha/output/full/best_accuracy.pdparams',
        'Global.save_inference_dir=./training/ppocrv6-captcha/output/exported',
      ],
    },
  };
}
